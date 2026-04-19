"""
File watcher — monitors the mhxy log directory via inotify (watchdog).

When a .jsonl file is created or modified, a debounced ingest is triggered.
Debounce window: 2 seconds after the last write event on the same file,
so a single session being actively written only triggers one ingest.

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

# Debounce window in seconds
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
        asyncio.run_coroutine_threadsafe(self._ingest_fn(), self._loop)

    def on_modified(self, event: FileSystemEvent) -> None:
        if not event.is_directory and str(event.src_path).endswith(".jsonl"):
            self._schedule(str(event.src_path))

    def on_created(self, event: FileSystemEvent) -> None:
        if not event.is_directory and str(event.src_path).endswith(".jsonl"):
            self._schedule(str(event.src_path))


class LogWatcher:
    def __init__(self, log_dir: str, ingest_fn):
        self._log_dir = log_dir
        self._ingest_fn = ingest_fn
        self._observer: Observer | None = None

    def start(self, loop: asyncio.AbstractEventLoop) -> None:
        if not os.path.isdir(self._log_dir):
            log.warning("watcher: log_dir not found: %s — watcher disabled", self._log_dir)
            return

        handler = _JsonlHandler(loop=loop, ingest_fn=self._ingest_fn)
        self._observer = Observer()
        self._observer.schedule(handler, self._log_dir, recursive=True)
        self._observer.start()
        log.info("watcher: watching %s", self._log_dir)

    def stop(self) -> None:
        if self._observer and self._observer.is_alive():
            self._observer.stop()
            self._observer.join()
            log.info("watcher: stopped")
