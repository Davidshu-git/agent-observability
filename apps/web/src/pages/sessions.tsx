import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { marked } from "marked";
import { api } from "@/lib/api";
import type { SessionSummary, NormalizedEvent } from "@/types/events";
import CopyableId from "@/components/CopyableId";
import { SkeletonSessionItem } from "@/components/Skeleton";

marked.use({ breaks: true, gfm: true });

// ── colors ────────────────────────────────────────────────────────────────────

const EVENT_COLORS: Record<string, string> = {
  session_started: "var(--green)",
  session_ended:   "var(--red)",
  message:         "var(--blue)",
  thought:         "var(--purple)",
  model_call:      "var(--amber)",
  tool_call:       "var(--orange)",
  tool_result:     "var(--orange)",
  metric:          "var(--teal)",
  event:           "var(--teal)",
  error:           "var(--red)",
};

const AGENT_PALETTE = ["var(--blue)", "var(--green)", "var(--amber)", "var(--purple)", "var(--orange)", "var(--teal)"];
const _colorCache: Record<string, string> = {};
let _colorIdx = 0;
function agentColor(key: string): string {
  if (!_colorCache[key]) _colorCache[key] = AGENT_PALETTE[_colorIdx++ % AGENT_PALETTE.length];
  return _colorCache[key];
}

// ── helpers ───────────────────────────────────────────────────────────────────

function shortId(id: string): string {
  const parts = id.split("_");
  if (parts.length >= 4) return parts.slice(2, -1).join("_");
  return id.length > 22 ? id.slice(0, 10) + "…" + id.slice(-6) : id;
}
function fmtTime(s: string) {
  return new Date(s).toLocaleTimeString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" });
}
function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  return new Date(s).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" });
}
function parseMd(text: string): string {
  return marked.parse(text) as string;
}

// ── event detail ──────────────────────────────────────────────────────────────

function EventDetail({ event }: { event: NormalizedEvent }) {
  const [expanded, setExpanded] = useState(false);
  const p = event.payload as Record<string, unknown>;
  const t = event.event_type;

  if (t === "message") {
    const role = p.role as string;
    const content = (p.content as string) || "";
    const isUser = role === "user";
    const isSystem = role === "system";
    const avatarClass = isUser ? "avatar-user" : isSystem ? "avatar-system" : "avatar-assistant";
    const avatarLabel = isUser ? "U" : isSystem ? "S" : "A";
    const bgColor = isUser
      ? "rgba(96,165,250,.07)"
      : isSystem
      ? "rgba(251,191,36,.05)"
      : "rgba(52,211,153,.05)";
    const borderColor = isUser
      ? "rgba(96,165,250,.15)"
      : isSystem
      ? "rgba(251,191,36,.12)"
      : "rgba(52,211,153,.1)";
    const truncated = !expanded && content.length > 400;
    const html = parseMd(truncated ? content.slice(0, 400) + "…" : content);

    return (
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <div className={`avatar ${avatarClass}`}>{avatarLabel}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            background: bgColor,
            border: `1px solid ${borderColor}`,
            borderRadius: "var(--r)",
            padding: "8px 12px",
            transition: `background var(--dur) var(--ease)`,
          }}>
            <div
              className="md-content"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
          {content.length > 400 && (
            <button onClick={() => setExpanded(!expanded)} style={{
              background: "none", border: "none", color: "var(--blue)", fontSize: 11,
              cursor: "pointer", marginTop: 4, padding: 0,
              transition: `opacity var(--dur) var(--ease)`,
            }}>
              {expanded ? "收起 ▲" : "展开全文 ▼"}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (t === "thought") {
    const content = (p.content as string) || "";
    const truncated = !expanded && content.length > 250;
    const preview = truncated ? content.slice(0, 250) + "…" : content;
    return (
      <div style={{
        background: "rgba(196,181,253,.05)",
        border: "1px solid rgba(196,181,253,.12)",
        borderRadius: "var(--r)",
        padding: "8px 12px",
      }}>
        <div style={{ color: "rgba(196,181,253,.45)", fontSize: 10, marginBottom: 4 }}>
          💭 思考 · {p.provider as string}
        </div>
        <div style={{ color: "var(--purple)", fontSize: 12, lineHeight: 1.65, whiteSpace: "pre-wrap", opacity: 0.8 }}>
          {preview}
        </div>
        {content.length > 250 && (
          <button onClick={() => setExpanded(!expanded)} style={{
            background: "none", border: "none", color: "var(--purple)", fontSize: 11,
            cursor: "pointer", marginTop: 4, padding: 0,
          }}>
            {expanded ? "收起 ▲" : "展开 ▼"}
          </button>
        )}
      </div>
    );
  }

  if (t === "model_call") {
    const durMs = p.duration_ms as number | null;
    const cacheHit = (p.cache_read_tokens as number) || 0;
    const ok = p.success as boolean;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ color: "var(--amber)", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600 }}>
          {p.model as string}
        </span>
        <span style={{ color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)" }}>
          ↑{(p.input_tokens as number) || 0} ↓{(p.output_tokens as number) || 0}
          {cacheHit > 0 && <span style={{ color: "var(--teal)" }}> cache:{cacheHit}</span>}
          {durMs != null && ` ${Math.round(durMs)}ms`}
        </span>
        {!ok && <span style={{ color: "var(--red)", fontSize: 11, fontWeight: 600 }}>FAILED</span>}
      </div>
    );
  }

  if (t === "tool_call") {
    const args = p.arguments;
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: "var(--orange)", fontWeight: 700, fontSize: 12, fontFamily: "var(--font-mono)" }}>
            ⚙ {p.tool_name as string}
          </span>
          {args != null && (
            <button onClick={() => setExpanded(!expanded)} style={{
              background: "none", border: "none", color: "var(--text-dim)",
              fontSize: 10, cursor: "pointer", padding: 0,
            }}>
              {expanded ? "▲ 隐藏" : "▼ 参数"}
            </button>
          )}
        </div>
        {expanded && args != null && (
          <pre style={{
            marginTop: 6, padding: "6px 10px",
            background: "rgba(0,0,0,.4)", border: "1px solid var(--border)",
            borderRadius: "var(--r-sm)",
            color: "var(--text-muted)", fontSize: 11, overflow: "auto", maxHeight: 180,
          }}>
            {JSON.stringify(args, null, 2)}
          </pre>
        )}
      </div>
    );
  }

  if (t === "tool_result") {
    const ok = p.success as boolean;
    const durMs = p.duration_ms as number | null;
    const result = typeof p.result === "string" ? p.result : JSON.stringify(p.result);
    const truncated = !expanded && (result?.length ?? 0) > 250;
    const preview = truncated ? result!.slice(0, 250) + "…" : result;
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: ok ? "var(--green)" : "var(--red)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
            {ok ? "✓" : "✗"} {p.tool_name as string}
          </span>
          {durMs != null && <span style={{ color: "var(--text-dim)", fontSize: 11 }}>{Math.round(durMs)}ms</span>}
          {(result?.length ?? 0) > 250 && (
            <button onClick={() => setExpanded(!expanded)} style={{
              background: "none", border: "none", color: "var(--text-dim)",
              fontSize: 10, cursor: "pointer", padding: 0,
            }}>
              {expanded ? "收起" : "展开"}
            </button>
          )}
        </div>
        {result && (
          <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 11, whiteSpace: "pre-wrap", fontFamily: "var(--font-mono)", lineHeight: 1.5 }}>
            {preview}
          </div>
        )}
      </div>
    );
  }

  if (t === "error") {
    return (
      <div style={{ color: "var(--red)", fontSize: 12 }}>
        <span style={{ fontWeight: 700 }}>{p.name as string}: </span>
        {p.message as string}
      </div>
    );
  }

  if (t === "session_started") {
    return <div style={{ color: "var(--green)", fontSize: 12 }}>会话开始</div>;
  }

  return (
    <pre style={{ color: "var(--text-muted)", fontSize: 11, overflow: "auto", maxHeight: 80, margin: 0 }}>
      {JSON.stringify(p, null, 2)}
    </pre>
  );
}

// ── timeline ──────────────────────────────────────────────────────────────────

function Timeline({ events }: { events: NormalizedEvent[] }) {
  const [filter, setFilter] = useState<string>("all");
  const types = Array.from(new Set(events.map((e) => e.event_type)));
  const visible = filter === "all" ? events : events.filter((e) => e.event_type === filter);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: "0.75rem", alignItems: "center" }}>
        {["all", ...types].map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={`tag-btn${filter === t ? " active" : ""}`}
            style={filter !== t && EVENT_COLORS[t]
              ? { color: EVENT_COLORS[t], borderColor: "var(--border)" }
              : undefined
            }
          >
            {t === "all" ? "全部" : t}
          </button>
        ))}
        <span style={{ color: "var(--text-dim)", fontSize: 11, marginLeft: "auto", fontFamily: "var(--font-mono)" }}>
          {visible.length} / {events.length}
        </span>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {visible.map((e) => {
          const color = EVENT_COLORS[e.event_type] ?? "var(--text-dim)";
          const isError = e.event_type === "error";
          return (
            <div
              key={e.event_id}
              style={{
                display: "flex",
                gap: "0.75rem",
                marginBottom: "0.4rem",
                paddingLeft: "0.75rem",
                paddingTop: isError ? 4 : 0,
                paddingBottom: isError ? 4 : 0,
                borderLeft: `2px solid ${color}`,
                borderRadius: isError ? "0 var(--r) var(--r) 0" : 0,
                background: isError ? "rgba(248,113,113,.04)" : "transparent",
                boxShadow: isError ? "inset 0 0 12px rgba(248,113,113,.06)" : "none",
                transition: `background var(--dur) var(--ease)`,
              }}
            >
              <div style={{ color: "var(--text-dim)", fontSize: 10, width: 62, flexShrink: 0, paddingTop: 2, fontFamily: "var(--font-mono)" }}>
                {fmtTime(e.timestamp)}
              </div>
              <div style={{ color, fontSize: 10, width: 88, flexShrink: 0, paddingTop: 2, fontFamily: "var(--font-mono)" }}>
                {e.event_type}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <EventDetail event={e} />
                {e.trace_id && (
                  <div style={{ marginTop: 4, fontSize: 10 }}>
                    <Link href={`/traces/${e.trace_id}`} style={{ color: "var(--blue)", opacity: 0.6, fontFamily: "var(--font-mono)" }}>
                      trace:{e.trace_id.slice(-16)}
                    </Link>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {visible.length === 0 && <p style={{ color: "var(--text-dim)" }}>无匹配事件</p>}
      </div>
    </div>
  );
}

// ── agent badge ───────────────────────────────────────────────────────────────

function AgentBadge({ label }: { label: string }) {
  const color = agentColor(label);
  return (
    <span className="badge" style={{ background: color + "18", color, border: `1px solid ${color}30` }}>
      {label}
    </span>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

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

  useEffect(() => { setAgentFilter("all"); }, [projectId]);

  useEffect(() => {
    if (!router.isReady) return;
    setLoadingSessions(true);
    api.sessions({ project_id: projectId || undefined, limit: 100 })
      .then(setSessions)
      .catch((e) => setErr(String(e)))
      .finally(() => setLoadingSessions(false));
  }, [router.isReady, projectId]);

  useEffect(() => {
    if (!selectedId) return;
    setLoadingEvents(true);
    api.timeline(selectedId)
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

  const agentKeys = Array.from(new Set(sessions.map((s) => s.agent_id ?? s.project_id).filter(Boolean)));
  const visible = agentFilter === "all"
    ? sessions
    : sessions.filter((s) => (s.agent_id ?? s.project_id) === agentFilter);

  const selectedSession = sessions.find((s) => s.id === selectedId);

  return (
    <div style={{ height: "calc(100vh - 3.5rem)", display: "flex", flexDirection: "column" }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>会话时间线</h1>
        {projectId && <AgentBadge label={projectId} />}
        {err && <span style={{ color: "var(--red)", fontSize: 12 }}>{err}</span>}
      </div>

      <div style={{ flex: 1, display: "flex", gap: "1rem", minHeight: 0 }}>
        {/* left: session list */}
        <div style={{
          width: 240, flexShrink: 0, display: "flex", flexDirection: "column",
          borderRight: "1px solid var(--border)", paddingRight: "1rem",
        }}>
          {/* agent filter */}
          {agentKeys.length > 1 && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: "0.75rem" }}>
              {["all", ...agentKeys].map((k) => (
                <button
                  key={k}
                  onClick={() => setAgentFilter(k)}
                  className={`tag-btn${agentFilter === k ? " active" : ""}`}
                  style={agentFilter === k
                    ? { background: agentColor(k) + "22", color: agentColor(k), borderColor: agentColor(k) + "55" }
                    : { color: "var(--text-muted)" }
                  }
                >
                  {k === "all" ? `全部 (${sessions.length})` : k}
                </button>
              ))}
            </div>
          )}

          <div style={{ flex: 1, overflowY: "auto" }}>
            {loadingSessions
              ? [0,1,2,3].map((i) => <SkeletonSessionItem key={i} />)
              : visible.map((s) => {
                  const botKey = s.agent_id ?? s.project_id;
                  const color = agentColor(botKey);
                  const isSelected = selectedId === s.id;
                  return (
                    <div
                      key={s.id}
                      onClick={() => selectSession(s.id)}
                      className={`session-list-item${isSelected ? " selected" : ""}`}
                      style={{ borderLeftColor: isSelected ? "var(--blue)" : color + "66" }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
                        <AgentBadge label={botKey} />
                        {!projectId && s.project_id !== botKey && (
                          <span style={{ color: "var(--text-dim)", fontSize: 10 }}>{s.project_id}</span>
                        )}
                      </div>
                      <div style={{
                        color: isSelected ? "var(--blue)" : "var(--text-muted)",
                        fontSize: 11, fontFamily: "var(--font-mono)",
                      }} title={s.id}>
                        {shortId(s.id)}
                      </div>
                      <div style={{ color: "var(--text-dim)", fontSize: 10, marginTop: 2 }}>
                        {fmtDate(s.started_at)}
                      </div>
                    </div>
                  );
                })
            }
            {!loadingSessions && visible.length === 0 && (
              <p style={{ color: "var(--text-dim)", fontSize: 12 }}>无会话数据</p>
            )}
          </div>
        </div>

        {/* right: timeline */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {selectedSession && (
            <div style={{
              display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
              marginBottom: "0.75rem", paddingBottom: "0.75rem",
              borderBottom: "1px solid var(--border)",
            }}>
              <AgentBadge label={selectedSession.agent_id ?? selectedSession.project_id} />
              <CopyableId id={selectedSession.id} truncate={36} />
              <span style={{ color: "var(--text-dim)", fontSize: 11, marginLeft: "auto" }}>
                {fmtDate(selectedSession.started_at)}
              </span>
            </div>
          )}
          {!selectedId && (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <p style={{ color: "var(--text-dim)" }}>← 选择左侧会话查看时间线</p>
            </div>
          )}
          {loadingEvents && <p style={{ color: "var(--text-dim)" }}>加载中…</p>}
          {!loadingEvents && selectedId && events.length > 0 && <Timeline events={events} />}
          {!loadingEvents && selectedId && events.length === 0 && (
            <p style={{ color: "var(--text-dim)" }}>该会话暂无事件</p>
          )}
        </div>
      </div>
    </div>
  );
}
