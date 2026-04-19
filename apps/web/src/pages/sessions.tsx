import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { api } from "@/lib/api";
import type { SessionSummary, NormalizedEvent } from "@/types/events";

const EVENT_COLORS: Record<string, string> = {
  session_started: "#4ade80",
  session_ended: "#f87171",
  message: "#7dd3fc",
  thought: "#c4b5fd",
  model_call: "#fbbf24",
  tool_call: "#fb923c",
  tool_result: "#f97316",
  metric: "#a3e635",
  event: "#6ee7b7",
  error: "#f87171",
};

// Stable color per agent/project key
const AGENT_PALETTE = [
  "#7dd3fc", "#86efac", "#fbbf24", "#c4b5fd",
  "#fb923c", "#f472b6", "#34d399", "#a3e635",
];
const _colorCache: Record<string, string> = {};
let _colorIdx = 0;
function agentColor(key: string): string {
  if (!_colorCache[key]) {
    _colorCache[key] = AGENT_PALETTE[_colorIdx++ % AGENT_PALETTE.length];
  }
  return _colorCache[key];
}

function shortId(id: string): string {
  // tg_session_stock_bot_1095093501 → stock_bot / 1095…
  const parts = id.split("_");
  if (parts.length >= 4) return parts.slice(2, -1).join("_");
  return id.length > 22 ? id.slice(0, 10) + "…" + id.slice(-6) : id;
}

function fmtTime(s: string) {
  const d = new Date(s);
  return d.toLocaleTimeString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" });
}

function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" });
}

// -----------------------------------------------------------------------
// Event payload renderer
// -----------------------------------------------------------------------
function EventDetail({ event }: { event: NormalizedEvent }) {
  const p = event.payload as Record<string, unknown>;
  const t = event.event_type;

  if (t === "message") {
    const role = p.role as string;
    return (
      <div>
        <span style={{
          background: role === "user" ? "#1e3a5f" : "#1a2e1a",
          color: role === "user" ? "#7dd3fc" : "#86efac",
          padding: "1px 6px", borderRadius: 3, fontSize: 10, marginRight: 6,
        }}>
          {role}
        </span>
        <span style={{ color: "#ddd", whiteSpace: "pre-wrap" }}>{p.content as string}</span>
      </div>
    );
  }

  if (t === "thought") {
    return (
      <div>
        <div style={{ color: "#a78bfa", fontSize: 10, marginBottom: 4 }}>
          [{p.kind as string}] {p.provider as string}
        </div>
        <div style={{ color: "#c4b5fd", whiteSpace: "pre-wrap", maxHeight: 200, overflow: "auto" }}>
          {p.content as string}
        </div>
      </div>
    );
  }

  if (t === "model_call") {
    const durMs = p.duration_ms as number | null;
    const cacheHit = p.cache_read_tokens as number;
    return (
      <div style={{ fontSize: 12 }}>
        <span style={{ color: "#fbbf24" }}>{p.model as string}</span>
        <span style={{ color: "#666", marginLeft: 8 }}>
          in:{p.input_tokens as number} out:{p.output_tokens as number}
          {cacheHit > 0 ? ` cache:${cacheHit}` : ""}
          {durMs != null ? ` ${Math.round(durMs)}ms` : ""}
        </span>
        {!(p.success as boolean) && (
          <span style={{ color: "#f87171", marginLeft: 8 }}>FAILED</span>
        )}
      </div>
    );
  }

  if (t === "tool_call") {
    return (
      <div style={{ fontSize: 12 }}>
        <span style={{ color: "#fb923c", fontWeight: "bold" }}>{p.tool_name as string}</span>
        {p.arguments != null && (
          <pre style={{ color: "#aaa", margin: "4px 0 0", fontSize: 11, overflow: "auto", maxHeight: 120 }}>
            {JSON.stringify(p.arguments, null, 2)}
          </pre>
        )}
      </div>
    );
  }

  if (t === "tool_result") {
    const ok = p.success as boolean;
    const durMs = p.duration_ms as number | null;
    return (
      <div style={{ fontSize: 12 }}>
        <span style={{ color: ok ? "#4ade80" : "#f87171" }}>{ok ? "✓" : "✗"}</span>
        <span style={{ color: "#aaa", marginLeft: 6 }}>{p.tool_name as string}</span>
        {durMs != null && (
          <span style={{ color: "#666", marginLeft: 6 }}>{Math.round(durMs)}ms</span>
        )}
        <div style={{ color: "#9ca3af", marginTop: 4, whiteSpace: "pre-wrap", maxHeight: 100, overflow: "auto" }}>
          {typeof p.result === "string" ? p.result : JSON.stringify(p.result)}
        </div>
      </div>
    );
  }

  if (t === "error") {
    return (
      <div style={{ color: "#f87171", fontSize: 12 }}>
        <span style={{ fontWeight: "bold" }}>{p.name as string}: </span>
        {p.message as string}
      </div>
    );
  }

  return (
    <pre style={{ color: "#888", fontSize: 11, margin: 0, overflow: "auto", maxHeight: 120 }}>
      {JSON.stringify(p, null, 2)}
    </pre>
  );
}

// -----------------------------------------------------------------------
// Timeline
// -----------------------------------------------------------------------
function Timeline({ events }: { events: NormalizedEvent[] }) {
  const [filter, setFilter] = useState<string>("all");
  const types = Array.from(new Set(events.map((e) => e.event_type)));
  const visible = filter === "all" ? events : events.filter((e) => e.event_type === filter);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: "0.75rem" }}>
        {["all", ...types].map((t) => (
          <button key={t} onClick={() => setFilter(t)} style={{
            padding: "2px 8px", fontSize: 11, border: "1px solid #333", borderRadius: 3,
            background: filter === t ? "#1e3a5f" : "#1a1a1a",
            color: filter === t ? "#7dd3fc" : EVENT_COLORS[t] ?? "#aaa",
            cursor: "pointer",
          }}>
            {t}
          </button>
        ))}
        <span style={{ color: "#555", fontSize: 11, marginLeft: "auto" }}>
          {visible.length} / {events.length} 条
        </span>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {visible.map((e) => (
          <div key={e.event_id} style={{
            display: "flex", gap: "0.75rem", marginBottom: "0.5rem",
            borderLeft: `3px solid ${EVENT_COLORS[e.event_type] ?? "#555"}`,
            paddingLeft: "0.75rem",
          }}>
            <div style={{ color: "#555", fontSize: 10, width: 60, flexShrink: 0, paddingTop: 2 }}>
              {fmtTime(e.timestamp)}
            </div>
            <div style={{ color: EVENT_COLORS[e.event_type] ?? "#aaa", fontSize: 10, width: 88, flexShrink: 0, paddingTop: 2 }}>
              {e.event_type}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <EventDetail event={e} />
              {e.trace_id && (
                <div style={{ marginTop: 4, fontSize: 10, color: "#444" }}>
                  <Link href={`/traces/${e.trace_id}`} style={{ color: "#3b82f6" }}>
                    trace:{e.trace_id}
                  </Link>
                </div>
              )}
            </div>
          </div>
        ))}
        {visible.length === 0 && <p style={{ color: "#555" }}>无匹配事件</p>}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Agent badge
// -----------------------------------------------------------------------
function AgentBadge({ label }: { label: string }) {
  const color = agentColor(label);
  return (
    <span style={{
      display: "inline-block",
      padding: "1px 6px",
      borderRadius: 3,
      fontSize: 10,
      background: color + "22",
      color,
      border: `1px solid ${color}44`,
    }}>
      {label}
    </span>
  );
}

// -----------------------------------------------------------------------
// Main page
// -----------------------------------------------------------------------
export default function SessionsPage() {
  const router = useRouter();
  const projectId = (router.query.project_id as string) ?? "";
  const selectedId = (router.query.session_id as string) ?? "";

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [events, setEvents] = useState<NormalizedEvent[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [err, setErr] = useState("");

  // Reset agent filter when project changes
  useEffect(() => { setAgentFilter("all"); }, [projectId]);

  useEffect(() => {
    if (!router.isReady) return;
    setLoadingSessions(true);
    api
      .sessions({ project_id: projectId || undefined, limit: 100 })
      .then(setSessions)
      .catch((e) => setErr(String(e)))
      .finally(() => setLoadingSessions(false));
  }, [router.isReady, projectId]);

  useEffect(() => {
    if (!selectedId) return;
    setLoadingEvents(true);
    api
      .timeline(selectedId)
      .then(setEvents)
      .catch((e) => setErr(String(e)))
      .finally(() => setLoadingEvents(false));
  }, [selectedId]);

  function selectSession(id: string) {
    router.push(
      { pathname: "/sessions", query: { ...(projectId ? { project_id: projectId } : {}), session_id: id } },
      undefined,
      { shallow: true }
    );
  }

  // Derive distinct agent keys for tab bar
  const agentKeys = Array.from(
    new Set(sessions.map((s) => s.agent_id ?? s.project_id).filter(Boolean))
  );

  const visible = agentFilter === "all"
    ? sessions
    : sessions.filter((s) => (s.agent_id ?? s.project_id) === agentFilter);

  const selectedSession = sessions.find((s) => s.id === selectedId);

  return (
    <div style={{ height: "calc(100vh - 3rem)", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, color: "#fff", fontSize: 16 }}>会话时间线</h2>
        {projectId && <AgentBadge label={projectId} />}
        {err && <span style={{ color: "#f87171", fontSize: 12 }}>{err}</span>}
      </div>

      <div style={{ flex: 1, display: "flex", gap: "1rem", minHeight: 0 }}>
        {/* Left: session list */}
        <div style={{
          width: 230, flexShrink: 0, display: "flex", flexDirection: "column",
          borderRight: "1px solid #222", paddingRight: "0.75rem",
        }}>
          {/* Bot filter tabs */}
          {agentKeys.length > 1 && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: "0.5rem" }}>
              {["all", ...agentKeys].map((k) => (
                <button key={k} onClick={() => setAgentFilter(k)} style={{
                  padding: "2px 8px", fontSize: 10, borderRadius: 3, cursor: "pointer",
                  border: agentFilter === k ? `1px solid ${agentColor(k)}88` : "1px solid #333",
                  background: agentFilter === k ? agentColor(k) + "22" : "transparent",
                  color: agentFilter === k ? agentColor(k) : "#666",
                }}>
                  {k === "all" ? `全部 (${sessions.length})` : k}
                </button>
              ))}
            </div>
          )}

          {/* Session list */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {loadingSessions && <p style={{ color: "#555" }}>加载中…</p>}
            {visible.map((s) => {
              const botKey = s.agent_id ?? s.project_id;
              const color = agentColor(botKey);
              return (
                <div
                  key={s.id}
                  onClick={() => selectSession(s.id)}
                  style={{
                    padding: "6px 8px", borderRadius: 4, marginBottom: 4, cursor: "pointer",
                    background: selectedId === s.id ? "#1e3a5f" : "#1a1a1a",
                    borderLeft: `3px solid ${selectedId === s.id ? "#7dd3fc" : color + "66"}`,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 3 }}>
                    <AgentBadge label={botKey} />
                    {!projectId && s.project_id !== botKey && (
                      <span style={{ color: "#444", fontSize: 10 }}>{s.project_id}</span>
                    )}
                  </div>
                  <div
                    style={{ color: selectedId === s.id ? "#7dd3fc" : "#aaa", fontSize: 11 }}
                    title={s.id}
                  >
                    {shortId(s.id)}
                  </div>
                  <div style={{ color: "#555", fontSize: 10, marginTop: 2 }}>
                    {fmtDate(s.started_at)}
                  </div>
                </div>
              );
            })}
            {!loadingSessions && visible.length === 0 && (
              <p style={{ color: "#555", fontSize: 12 }}>无会话数据</p>
            )}
          </div>
        </div>

        {/* Right: timeline */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {selectedSession && (
            <div style={{
              display: "flex", gap: 8, alignItems: "center",
              marginBottom: "0.5rem", paddingBottom: "0.5rem", borderBottom: "1px solid #222",
            }}>
              <AgentBadge label={selectedSession.agent_id ?? selectedSession.project_id} />
              <span style={{ color: "#555", fontSize: 11 }} title={selectedSession.id}>
                {selectedSession.id}
              </span>
              <span style={{ color: "#444", fontSize: 10, marginLeft: "auto" }}>
                {fmtDate(selectedSession.started_at)}
              </span>
            </div>
          )}
          {!selectedId && <p style={{ color: "#555" }}>← 选择左侧会话查看时间线</p>}
          {loadingEvents && <p style={{ color: "#555" }}>加载中…</p>}
          {!loadingEvents && selectedId && events.length > 0 && <Timeline events={events} />}
          {!loadingEvents && selectedId && events.length === 0 && (
            <p style={{ color: "#555" }}>该会话暂无事件</p>
          )}
        </div>
      </div>
    </div>
  );
}
