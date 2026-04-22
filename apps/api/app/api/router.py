"""
Query API + ingest triggers.

All responses are based on the unified schema; no source-specific fields leak here.
"""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select, distinct, String
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import get_db, AsyncSessionLocal
from app.db.models import Agent, DataSource, Event, Project, Session

router = APIRouter(prefix="/api")

# SSE 订阅者队列
_sse_subscribers: list[asyncio.Queue] = []


def _broadcast_ingest():
    """ingest 完成后广播通知所有 SSE 订阅者。"""
    for q in _sse_subscribers:
        try:
            q.put_nowait("ingest")
        except asyncio.QueueFull:
            pass


@router.get("/stream")
async def sse_stream():
    """SSE 端点：日志有更新时推送 ingest 事件，前端订阅后自动刷新。"""
    q: asyncio.Queue = asyncio.Queue(maxsize=10)
    _sse_subscribers.append(q)

    async def event_generator():
        try:
            yield "data: connected\n\n"
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=25)
                    yield f"data: {msg}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"  # 保活
        finally:
            _sse_subscribers.remove(q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

@router.get("/projects")
async def list_projects(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Project).where(Project.is_active == True))
    projects = result.scalars().all()
    return [
        {
            "id": p.id,
            "display_name": p.display_name,
            "source_type": p.source_type,
            "created_at": p.created_at,
        }
        for p in projects
    ]


@router.get("/projects/{project_id}/agents")
async def list_agents(project_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Agent).where(Agent.project_id == project_id)
    )
    agents = result.scalars().all()
    return [
        {
            "id": a.id,
            "name": a.name,
            "display_name": a.display_name,
            "kind": a.kind,
        }
        for a in agents
    ]


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------

@router.get("/sessions")
async def list_sessions(
    project_id: Optional[str] = Query(None),
    agent_id: Optional[str] = Query(None),
    since: Optional[datetime] = Query(None),
    until: Optional[datetime] = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    db: AsyncSession = Depends(get_db),
):
    # Sort by most recent event timestamp (last-active semantics).
    # Uses a correlated subquery on events(session_id, timestamp) index — no migration needed.
    # If sessions table grows large (>10k), consider adding a last_event_at column instead.
    from sqlalchemy import func, select as sa_select, nulls_last
    last_event_subq = (
        sa_select(func.max(Event.timestamp))
        .where(Event.session_id == Session.id)
        .correlate(Session)
        .scalar_subquery()
    )
    q = select(Session).order_by(nulls_last(last_event_subq.desc()))
    if project_id:
        q = q.where(Session.project_id == project_id)
    if agent_id:
        q = q.where(Session.agent_id == agent_id)
    if since:
        q = q.where(Session.started_at >= since)
    if until:
        q = q.where(Session.started_at <= until)
    q = q.limit(limit).offset(offset)

    result = await db.execute(q)
    sessions = result.scalars().all()
    return [
        {
            "id": s.id,
            "project_id": s.project_id,
            "agent_id": s.agent_id,
            "started_at": s.started_at,
            "ended_at": s.ended_at,
            "status": s.status,
        }
        for s in sessions
    ]


@router.get("/sessions/{session_id}")
async def get_session(session_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return {
        "id": session.id,
        "project_id": session.project_id,
        "agent_id": session.agent_id,
        "started_at": session.started_at,
        "ended_at": session.ended_at,
        "status": session.status,
        "metadata": session.metadata_,
    }


@router.get("/sessions/{session_id}/timeline")
async def session_timeline(session_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Event)
        .where(Event.session_id == session_id)
        .order_by(Event.timestamp.desc(), Event.id.desc())
    )
    events = result.scalars().all()
    return [
        {
            "event_id": e.event_id,
            "event_type": e.event_type,
            "timestamp": e.timestamp,
            "trace_id": e.trace_id,
            "run_id": e.run_id,
            "payload": e.payload_json,
            "extra": e.extra,
        }
        for e in events
    ]


# ---------------------------------------------------------------------------
# Traces
# ---------------------------------------------------------------------------

@router.get("/traces/{trace_id}")
async def get_trace(trace_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Event)
        .where(Event.trace_id == trace_id)
        .order_by(Event.timestamp, Event.id)
    )
    events = result.scalars().all()
    if not events:
        raise HTTPException(status_code=404, detail="Trace not found")
    return {
        "trace_id": trace_id,
        "events": [
            {
                "event_id": e.event_id,
                "event_type": e.event_type,
                "timestamp": e.timestamp,
                "run_id": e.run_id,
                "payload": e.payload_json,
            }
            for e in events
        ],
    }


# ---------------------------------------------------------------------------
# Stats — tokens
# ---------------------------------------------------------------------------

@router.get("/stats/tokens/overview")
async def tokens_overview(
    project_id: Optional[str] = Query(None),
    since: Optional[datetime] = Query(None),
    until: Optional[datetime] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    q = select(
        func.sum(Event.payload_json["input_tokens"].as_integer()).label("input_tokens"),
        func.sum(Event.payload_json["output_tokens"].as_integer()).label("output_tokens"),
        func.sum(Event.payload_json["cache_read_tokens"].as_integer()).label("cache_read_tokens"),
        func.count().label("calls"),
    ).where(Event.event_type == "model_call")
    if project_id:
        q = q.where(Event.project_id == project_id)
    if since:
        q = q.where(Event.timestamp >= since)
    if until:
        q = q.where(Event.timestamp <= until)
    result = await db.execute(q)
    row = result.one()
    return {
        "input_tokens": row.input_tokens or 0,
        "output_tokens": row.output_tokens or 0,
        "cache_read_tokens": row.cache_read_tokens or 0,
        "calls": row.calls,
    }


@router.get("/stats/tokens/daily")
async def tokens_daily(
    project_id: Optional[str] = Query(None),
    days: int = Query(14),
    db: AsyncSession = Depends(get_db),
):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    day_col = func.date(Event.timestamp).label("date")
    q = (
        select(
            day_col,
            func.sum(Event.payload_json["input_tokens"].as_integer()).label("input_tokens"),
            func.sum(Event.payload_json["output_tokens"].as_integer()).label("output_tokens"),
            func.count().label("calls"),
        )
        .where(Event.event_type == "model_call", Event.timestamp >= since)
        .group_by(func.date(Event.timestamp))
        .order_by(func.date(Event.timestamp).desc())
    )
    if project_id:
        q = q.where(Event.project_id == project_id)
    result = await db.execute(q)
    return [
        {
            "date": str(r.date),
            "input_tokens": r.input_tokens or 0,
            "output_tokens": r.output_tokens or 0,
            "calls": r.calls,
        }
        for r in result.all()
    ]


@router.get("/stats/tokens/by-model")
async def tokens_by_model(
    project_id: Optional[str] = Query(None),
    since: Optional[datetime] = Query(None),
    until: Optional[datetime] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    model_col = Event.payload_json["model"].as_string().label("model")
    q = (
        select(
            model_col,
            func.sum(Event.payload_json["input_tokens"].as_integer()).label("input_tokens"),
            func.sum(Event.payload_json["output_tokens"].as_integer()).label("output_tokens"),
            func.sum(Event.payload_json["cache_read_tokens"].as_integer()).label("cache_read_tokens"),
            func.count().label("calls"),
        )
        .where(Event.event_type == "model_call")
        .group_by(model_col)
        .order_by(func.sum(Event.payload_json["input_tokens"].as_integer() + Event.payload_json["output_tokens"].as_integer()).desc())
    )
    if project_id:
        q = q.where(Event.project_id == project_id)
    if since:
        q = q.where(Event.timestamp >= since)
    if until:
        q = q.where(Event.timestamp <= until)
    result = await db.execute(q)
    return [
        {
            "model": r.model or "unknown",
            "input_tokens": r.input_tokens or 0,
            "output_tokens": r.output_tokens or 0,
            "cache_read_tokens": r.cache_read_tokens or 0,
            "calls": r.calls,
        }
        for r in result.all()
    ]


# ---------------------------------------------------------------------------
# Stats — tools
# ---------------------------------------------------------------------------

@router.get("/stats/tools")
async def tools_stats(
    project_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import text
    if project_id:
        sql = text("""
            SELECT payload_json->>'tool_name' AS tool_name, count(*) AS calls
            FROM events
            WHERE event_type = 'tool_call' AND project_id = :project_id
            GROUP BY payload_json->>'tool_name'
            ORDER BY calls DESC
        """)
        result = await db.execute(sql, {"project_id": project_id})
    else:
        sql = text("""
            SELECT payload_json->>'tool_name' AS tool_name, count(*) AS calls
            FROM events
            WHERE event_type = 'tool_call'
            GROUP BY payload_json->>'tool_name'
            ORDER BY calls DESC
        """)
        result = await db.execute(sql)
    return [{"tool_name": r.tool_name, "calls": r.calls} for r in result.all()]


# ---------------------------------------------------------------------------
# Think
# ---------------------------------------------------------------------------

@router.get("/think")
async def list_think(
    project_id: Optional[str] = Query(None),
    session_id: Optional[str] = Query(None),
    limit: int = Query(50, le=200),
    db: AsyncSession = Depends(get_db),
):
    q = (
        select(Event)
        .where(Event.event_type == "thought")
        .order_by(Event.timestamp.desc())
        .limit(limit)
    )
    if project_id:
        q = q.where(Event.project_id == project_id)
    if session_id:
        q = q.where(Event.session_id == session_id)
    result = await db.execute(q)
    events = result.scalars().all()
    return [
        {
            "event_id": e.event_id,
            "session_id": e.session_id,
            "timestamp": e.timestamp,
            "payload": e.payload_json,
        }
        for e in events
    ]


# ---------------------------------------------------------------------------
# Generic JSONL ingest — shared by all JSONL-based data sources
# ---------------------------------------------------------------------------

async def run_jsonl_ingest(
    *,
    project_id: str,
    source_type: str,
    display_name: str,
    log_dir: str,
    adapter,
    agents: list[dict],  # list of {id, name, display_name, kind}
    force: bool = False,
) -> dict:
    """
    Incremental JSONL ingest for any adapter that implements the discover/scan/load interface.
    Uses data_sources.last_sync_cursor (file mtime map) to skip unchanged files.
    Idempotent — event-level deduplication via ON CONFLICT DO NOTHING.
    """
    import json as _json
    from datetime import timezone
    from sqlalchemy import update as sa_update
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    from app.ingestion.service import ingest_batch, upsert_session
    from app.db.models import DataSource

    async with AsyncSessionLocal() as db:
        await _ensure_project(db, project_id, display_name, source_type)
        for ag in agents:
            await _ensure_agent(db, ag["id"], project_id, ag["name"], ag["display_name"], ag["kind"])

        await db.execute(
            pg_insert(DataSource).values(
                project_id=project_id,
                source_type=source_type,
                display_name=display_name,
                enabled=True,
                config_json={"log_dir": log_dir},
            ).on_conflict_do_nothing()
        )
        await db.commit()

        ds_result = await db.execute(
            select(DataSource)
            .where(DataSource.project_id == project_id, DataSource.source_type == source_type)
            .order_by(DataSource.id.desc())
            .limit(1)
        )
        ds = ds_result.scalars().first()

        cursor: dict[str, str] = {}
        if ds and ds.last_sync_cursor and not force:
            try:
                cursor = _json.loads(ds.last_sync_cursor)
            except Exception:
                cursor = {}

        total = {"raw_inserted": 0, "raw_updated": 0, "events_inserted": 0, "events_skipped": 0}
        sources_scanned = sources_skipped = 0
        new_cursor: dict[str, str] = {}

        sources = adapter.discover_sources()
        for source in sources:
            mtime = str(os.path.getmtime(source.path))
            new_cursor[source.path] = mtime

            if not force and cursor.get(source.path) == mtime:
                sources_skipped += 1
                continue

            sources_scanned += 1
            for session_ref in adapter.scan_sessions(source):
                # Determine agent_id: use session metadata if available, else first agent
                session_agent_id = (
                    session_ref.metadata.get("agent_id")
                    or (agents[0]["id"] if agents else None)
                )
                await upsert_session(
                    db,
                    session_id=session_ref.session_id,
                    project_id=project_id,
                    agent_id=session_agent_id,
                    external_session_id=session_ref.session_id,
                )

                raw_blobs, events = adapter.load_events(session_ref)

                for ev in events:
                    if ev.event_type.value == "session_started":
                        await upsert_session(
                            db,
                            session_id=session_ref.session_id,
                            project_id=project_id,
                            agent_id=session_agent_id,
                            external_session_id=session_ref.session_id,
                            started_at=ev.timestamp,
                        )
                        break

                counts = await ingest_batch(db, raw_blobs=raw_blobs, events=events)
                for k in total:
                    total[k] += counts[k]

        if ds is not None:
            await db.execute(
                sa_update(DataSource).where(DataSource.id == ds.id).values(
                    last_sync_cursor=_json.dumps(new_cursor),
                    last_sync_at=datetime.now(timezone.utc),
                    last_error=None,
                )
            )
            await db.commit()

    result = {
        "sources_total": len(sources),
        "sources_scanned": sources_scanned,
        "sources_skipped": sources_skipped,
        **total,
    }
    if total.get("events_inserted", 0) > 0:
        _broadcast_ingest()
    return result


# ---------------------------------------------------------------------------
# Per-source ingest wrappers — used by HTTP endpoints and startup/watcher
# ---------------------------------------------------------------------------

async def run_mhxy_ingest(force: bool = False) -> dict:
    from app.adapters.mhxy_jsonl import MhxyJsonlAdapter
    log_dir = os.getenv("MHXY_LOG_DIR", "/logs/mhxy/sessions")
    return await run_jsonl_ingest(
        project_id="mhxy",
        source_type="mhxy_jsonl",
        display_name="梦幻西游 Bot JSONL logs",
        log_dir=log_dir,
        adapter=MhxyJsonlAdapter(log_dir=log_dir),
        agents=[{"id": "game-bot", "name": "game-bot", "display_name": "游戏操控 Bot", "kind": "bot"}],
        force=force,
    )


async def run_stock_bot_ingest(force: bool = False) -> dict:
    from app.adapters.omnibot_jsonl import OmnibotJsonlAdapter
    stock_dir = os.getenv("OMNIBOT_STOCK_LOG_DIR", "/logs/omnibot/stock/sessions")
    return await run_jsonl_ingest(
        project_id="stock-bot",
        source_type="omnibot_jsonl",
        display_name="OmniStock 量化助理",
        log_dir=stock_dir,
        adapter=OmnibotJsonlAdapter(log_dir=stock_dir, project_id="stock-bot"),
        agents=[{"id": "stock-bot", "name": "stock-bot", "display_name": "OmniStock 量化助理", "kind": "assistant"}],
        force=force,
    )


async def run_ehs_bot_ingest(force: bool = False) -> dict:
    from app.adapters.omnibot_jsonl import OmnibotJsonlAdapter
    ehs_dir = os.getenv("OMNIBOT_EHS_LOG_DIR", "/logs/omnibot/ehs/sessions")
    return await run_jsonl_ingest(
        project_id="ehs-bot",
        source_type="omnibot_jsonl",
        display_name="OmniEHS 安全合规助理",
        log_dir=ehs_dir,
        adapter=OmnibotJsonlAdapter(log_dir=ehs_dir, project_id="ehs-bot"),
        agents=[{"id": "ehs-bot", "name": "ehs-bot", "display_name": "OmniEHS 安全合规助理", "kind": "assistant"}],
        force=force,
    )


async def run_omnibot_ingest(force: bool = False) -> dict:
    r1 = await run_stock_bot_ingest(force=force)
    r2 = await run_ehs_bot_ingest(force=force)
    merged = {}
    for key in ("sources_total", "sources_scanned", "sources_skipped",
                "raw_inserted", "raw_updated", "events_inserted", "events_skipped"):
        merged[key] = r1.get(key, 0) + r2.get(key, 0)
    return merged


# ---------------------------------------------------------------------------
# HTTP ingest endpoints
# ---------------------------------------------------------------------------

@router.post("/ingest/mhxy")
async def ingest_mhxy(
    force: bool = Query(False, description="Force full re-scan even if file unchanged"),
):
    result = await run_mhxy_ingest(force=force)
    return {"status": "ok", **result}


@router.post("/ingest/stock-bot")
async def ingest_stock_bot(force: bool = Query(False)):
    result = await run_stock_bot_ingest(force=force)
    return {"status": "ok", **result}


@router.post("/ingest/ehs-bot")
async def ingest_ehs_bot(force: bool = Query(False)):
    result = await run_ehs_bot_ingest(force=force)
    return {"status": "ok", **result}


@router.post("/ingest/omnibot")
async def ingest_omnibot(force: bool = Query(False)):
    result = await run_omnibot_ingest(force=force)
    return {"status": "ok", **result}


# ---------------------------------------------------------------------------
# Stats — overview (per-project summary for the dashboard)
# ---------------------------------------------------------------------------

@router.get("/stats/overview")
async def stats_overview(db: AsyncSession = Depends(get_db)):
    """
    Returns a per-project summary: session count, today's sessions,
    token totals, last session time.
    """
    from datetime import date, timezone
    today = date.today()  # Python date object, binds as DATE in PostgreSQL

    projects_result = await db.execute(select(Project).where(Project.is_active == True))
    projects = projects_result.scalars().all()

    output = []
    for p in projects:
        # total sessions
        total_sessions_r = await db.execute(
            select(func.count()).select_from(Session).where(Session.project_id == p.id)
        )
        total_sessions = total_sessions_r.scalar() or 0

        # today's sessions
        from sqlalchemy import cast, Date as SADate
        today_sessions_r = await db.execute(
            select(func.count()).select_from(Session).where(
                Session.project_id == p.id,
                cast(Session.started_at, SADate) == today,
            )
        )
        today_sessions = today_sessions_r.scalar() or 0

        # last session
        last_session_r = await db.execute(
            select(Session.started_at)
            .where(Session.project_id == p.id)
            .order_by(Session.started_at.desc())
            .limit(1)
        )
        last_session_at = last_session_r.scalar()

        # token totals
        tokens_r = await db.execute(
            select(
                func.sum(Event.payload_json["input_tokens"].as_integer()),
                func.sum(Event.payload_json["output_tokens"].as_integer()),
            ).where(
                Event.project_id == p.id,
                Event.event_type == "model_call",
            )
        )
        tok = tokens_r.one()

        output.append({
            "project_id": p.id,
            "display_name": p.display_name,
            "total_sessions": total_sessions,
            "today_sessions": today_sessions,
            "last_session_at": last_session_at,
            "total_input_tokens": tok[0] or 0,
            "total_output_tokens": tok[1] or 0,
        })

    return output


async def _ensure_project(db: AsyncSession, pid: str, display_name: str, source_type: str):
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    stmt = pg_insert(Project).values(
        id=pid, display_name=display_name, source_type=source_type
    ).on_conflict_do_nothing(index_elements=["id"])
    await db.execute(stmt)
    await db.commit()


async def _ensure_agent(
    db: AsyncSession, aid: str, project_id: str, name: str, display_name: str, kind: str
):
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    stmt = pg_insert(Agent).values(
        id=aid, project_id=project_id, name=name, display_name=display_name, kind=kind
    ).on_conflict_do_nothing(index_elements=["id"])
    await db.execute(stmt)
    await db.commit()
