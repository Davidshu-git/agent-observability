import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { api } from "@/lib/api";
import type { NormalizedEvent } from "@/types/events";

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

function fmtTime(s: string) {
  return new Date(s).toLocaleTimeString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" });
}

function PayloadView({ event }: { event: NormalizedEvent }) {
  const p = event.payload as Record<string, unknown>;
  const t = event.event_type;

  if (t === "message") {
    return (
      <div>
        <span style={{ color: "#7dd3fc", fontSize: 11, marginRight: 8 }}>[{p.role as string}]</span>
        <span style={{ color: "#ddd", whiteSpace: "pre-wrap" }}>{p.content as string}</span>
      </div>
    );
  }
  if (t === "thought") {
    return (
      <div>
        <div style={{ color: "#a78bfa", fontSize: 10, marginBottom: 3 }}>
          think / {p.kind as string}
        </div>
        <div style={{ color: "#c4b5fd", whiteSpace: "pre-wrap", maxHeight: 180, overflow: "auto" }}>
          {p.content as string}
        </div>
      </div>
    );
  }
  if (t === "model_call") {
    const cacheHit = p.cache_read_tokens as number;
    const durMs = p.duration_ms as number | null;
    return (
      <div style={{ fontSize: 12 }}>
        <span style={{ color: "#fbbf24", fontWeight: "bold" }}>{p.model as string}</span>
        <span style={{ color: "#666", marginLeft: 10 }}>
          {`in:${p.input_tokens as number} out:${p.output_tokens as number}`}
          {cacheHit > 0 ? ` cache:${cacheHit}` : ""}
          {durMs != null ? ` ${Math.round(durMs)}ms` : ""}
        </span>
        {event.run_id && (
          <span style={{ color: "#444", marginLeft: 10, fontSize: 10 }}>run:{event.run_id}</span>
        )}
      </div>
    );
  }
  if (t === "tool_call") {
    return (
      <div style={{ fontSize: 12 }}>
        <span style={{ color: "#fb923c", fontWeight: "bold" }}>→ {p.tool_name as string}</span>
        {p.arguments != null && (
          <pre style={{ color: "#888", margin: "4px 0 0", fontSize: 10, overflow: "auto", maxHeight: 100 }}>
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
          <span style={{ color: "#555", marginLeft: 6 }}>{Math.round(durMs)}ms</span>
        )}
        {p.result != null && (
          <div style={{ color: "#9ca3af", marginTop: 3, fontSize: 11, whiteSpace: "pre-wrap", maxHeight: 100, overflow: "auto" }}>
            {typeof p.result === "string" ? p.result : JSON.stringify(p.result)}
          </div>
        )}
      </div>
    );
  }
  return (
    <pre style={{ color: "#777", fontSize: 10, margin: 0, overflow: "auto", maxHeight: 80 }}>
      {JSON.stringify(p, null, 2)}
    </pre>
  );
}

export default function TraceDetailPage() {
  const router = useRouter();
  const traceId = router.query.trace_id as string;
  const [events, setEvents] = useState<NormalizedEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!traceId) return;
    setLoading(true);
    api.trace(traceId)
      .then((r) => setEvents(r.events))
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [traceId]);

  const sessionId = events[0]?.session_id;

  return (
    <div>
      <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "1rem" }}>
        <h2 style={{ margin: 0, color: "#fff", fontSize: 16 }}>Trace 详情</h2>
        <span style={{ color: "#555", fontSize: 12, fontFamily: "monospace" }}>{traceId}</span>
        {sessionId && (
          <Link
            href={`/sessions?session_id=${sessionId}&project_id=mhxy`}
            style={{ color: "#7dd3fc", fontSize: 12 }}
          >
            ← 返回会话
          </Link>
        )}
      </div>

      {err && <p style={{ color: "#f87171" }}>{err}</p>}
      {loading && <p style={{ color: "#555" }}>加载中…</p>}

      {/* Summary bar */}
      {events.length > 0 && (
        <div style={{ display: "flex", gap: "1.5rem", marginBottom: "1.25rem", fontSize: 12, color: "#888" }}>
          <span>{events.length} 条事件</span>
          {(() => {
            const mc = events.filter((e) => e.event_type === "model_call");
            const tc = events.filter((e) => e.event_type === "tool_call");
            const inTok = mc.reduce((s, e) => s + ((e.payload as Record<string,unknown>).input_tokens as number || 0), 0);
            const outTok = mc.reduce((s, e) => s + ((e.payload as Record<string,unknown>).output_tokens as number || 0), 0);
            return (
              <>
                <span>模型调用 {mc.length} 次</span>
                <span>工具调用 {tc.length} 次</span>
                <span style={{ color: "#fbbf24" }}>in:{inTok} out:{outTok} tokens</span>
              </>
            );
          })()}
        </div>
      )}

      {/* Event list */}
      <div style={{ borderLeft: "2px solid #222", paddingLeft: "1rem" }}>
        {events.map((e, i) => (
          <div
            key={e.event_id}
            style={{
              display: "flex",
              gap: "0.75rem",
              marginBottom: "0.6rem",
              position: "relative",
            }}
          >
            {/* dot */}
            <div
              style={{
                position: "absolute",
                left: "-1.25rem",
                top: 4,
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: EVENT_COLORS[e.event_type] ?? "#555",
              }}
            />
            <div style={{ color: "#555", fontSize: 10, width: 56, flexShrink: 0, paddingTop: 2 }}>
              {fmtTime(e.timestamp)}
            </div>
            <div style={{ color: EVENT_COLORS[e.event_type] ?? "#aaa", fontSize: 10, width: 80, flexShrink: 0, paddingTop: 2 }}>
              {e.event_type}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <PayloadView event={e} />
            </div>
          </div>
        ))}
      </div>

      {!loading && events.length === 0 && !err && (
        <p style={{ color: "#555" }}>Trace 暂无事件</p>
      )}
    </div>
  );
}
