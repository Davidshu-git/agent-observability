"""
File watcher — monitors log directories via inotify (watchdog).

When a .jsonl file is created or modified, a debounced ingest is triggered.
Debounce window: 2 seconds after the last write event on the same file.

Bridge: watchdog runs in a background thread; ingest runs as an asyncio
coroutine. We use asyncio.run_coroutine_threadsafe() to cross the boundary.
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
from pathlib import Path

from watchdog.events import FileSystemEventHandler, FileSystemEvent
from watchdog.observers import Observer

log = logging.getLogger(__name__)

DEBOUNCE_SECONDS = 2.0


class _JsonlHandler(FileSystemEventHandler):
    def __init__(self, loop: asyncio.AbstractEventLoop, ingest_fn):
        super().__init__()
        self._loop = loop
        self._ingest_fn = ingest_fn
        self._timers: dict[str, threading.Timer] = {}
        self._lock = threading.Lock()

    def _schedule(self, path: str) -> None:
        with self._lock:
            existing = self._timers.pop(path, None)
            if existing:
                existing.cancel()
            t = threading.Timer(DEBOUNCE_SECONDS, self._fire, args=(path,))
            self._timers[path] = t
            t.start()

    def _fire(self, path: str) -> None:
        with self._lock:
            self._timers.pop(path, None)
        log.info("watcher: change detected → %s", path)
        future = asyncio.run_coroutine_threadsafe(self._ingest_fn(), self._loop)

        def _done(fut):
            try:
                result = fut.result()
                log.info("watcher: ingest complete for %s: %s", path, result)
            except Exception:
                log.exception("watcher: ingest failed for %s", path)

        future.add_done_callback(_done)

    def on_modified(self, event: FileSystemEvent) -> None:
        if not event.is_directory and str(event.src_path).endswith(".jsonl"):
            self._schedule(str(event.src_path))

    def on_created(self, event: FileSystemEvent) -> None:
        if not event.is_directory and str(event.src_path).endswith(".jsonl"):
            self._schedule(str(event.src_path))


class MultiLogWatcher:
    """Watches multiple (log_dir, ingest_fn) pairs with a single Observer."""

    def __init__(self, targets: list[tuple[str, object]]) -> None:
        """
        targets: list of (log_dir, ingest_fn) pairs.
        ingest_fn must be a zero-argument callable returning a coroutine.
        """
        self._targets = targets
        self._observer: Observer | None = None

    def start(self, loop: asyncio.AbstractEventLoop) -> None:
        self._observer = Observer()
        scheduled = 0
        for log_dir, ingest_fn in self._targets:
            if not os.path.isdir(log_dir):
                log.warning("watcher: log_dir not found: %s — skipping", log_dir)
                continue
            handler = _JsonlHandler(loop=loop, ingest_fn=ingest_fn)
            self._observer.schedule(handler, log_dir, recursive=True)
            log.info("watcher: watching %s", log_dir)
            scheduled += 1

        if scheduled > 0:
            self._observer.start()
        else:
            log.warning("watcher: no valid directories to watch — observer not started")

    def stop(self) -> None:
        if self._observer and self._observer.is_alive():
            self._observer.stop()
            self._observer.join()
            log.info("watcher: stopped")


# Backward-compatible alias
class LogWatcher(MultiLogWatcher):
    def __init__(self, log_dir: str, ingest_fn) -> None:
        super().__init__([(log_dir, ingest_fn)])
