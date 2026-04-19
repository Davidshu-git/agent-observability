import asyncio
import logging
import os
from contextlib import asynccontextmanager

logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s: %(message)s")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import router, run_mhxy_ingest
from app.watcher import LogWatcher

log = logging.getLogger(__name__)

_watcher: LogWatcher | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _watcher
    log_dir = os.getenv("MHXY_LOG_DIR", "/logs/mhxy/sessions")

    # Startup: run one initial sync, then start file watcher
    log.info("startup: running initial mhxy ingest")
    try:
        await run_mhxy_ingest(force=False)
    except Exception as e:
        log.warning("startup ingest failed (non-fatal): %s", e)

    loop = asyncio.get_running_loop()
    _watcher = LogWatcher(
        log_dir=log_dir,
        ingest_fn=lambda: run_mhxy_ingest(force=False),
    )
    _watcher.start(loop)

    yield

    # Shutdown
    if _watcher:
        _watcher.stop()


app = FastAPI(title="Agent Observability API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/health")
async def health():
    return {"status": "ok"}
