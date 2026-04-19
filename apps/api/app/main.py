import asyncio
import logging
import os
from contextlib import asynccontextmanager

logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s: %(message)s")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import router, run_mhxy_ingest, run_omnibot_ingest
from app.watcher import MultiLogWatcher

log = logging.getLogger(__name__)

_watcher: MultiLogWatcher | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _watcher

    mhxy_log_dir = os.getenv("MHXY_LOG_DIR", "/logs/mhxy/sessions")
    omnibot_stock_dir = os.getenv("OMNIBOT_STOCK_LOG_DIR", "/logs/omnibot/stock/sessions")
    omnibot_ehs_dir = os.getenv("OMNIBOT_EHS_LOG_DIR", "/logs/omnibot/ehs/sessions")

    # Startup: run initial ingests for all sources
    for label, coro_fn in [
        ("mhxy", lambda: run_mhxy_ingest(force=False)),
        ("omnibot", lambda: run_omnibot_ingest(force=False)),
    ]:
        log.info("startup: running initial %s ingest", label)
        try:
            await coro_fn()
        except Exception as e:
            log.warning("startup ingest failed for %s (non-fatal): %s", label, e)

    # Start file watchers for all source directories
    loop = asyncio.get_running_loop()
    _watcher = MultiLogWatcher([
        (mhxy_log_dir, lambda: run_mhxy_ingest(force=False)),
        (omnibot_stock_dir, lambda: run_omnibot_ingest(force=False)),
        (omnibot_ehs_dir, lambda: run_omnibot_ingest(force=False)),
    ])
    _watcher.start(loop)

    yield

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
