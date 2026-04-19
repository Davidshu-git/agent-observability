import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type ProjectOverview } from "@/lib/api";

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtTime(s: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}

const SYNC_FN_MAP: Record<string, () => Promise<{ events_inserted: number }>> = {
  mhxy: api.ingestMhxy,
  "stock-bot": api.ingestStockBot,
  "ehs-bot": api.ingestEhsBot,
};

const PROJECT_ICONS: Record<string, string> = {
  mhxy: "🎮",
  "stock-bot": "📈",
  "ehs-bot": "🛡️",
};

export default function OverviewPage() {
  const [rows, setRows] = useState<ProjectOverview[]>([]);
  const [err, setErr] = useState("");
  const [syncingKey, setSyncingKey] = useState<string | null>(null);
  const [syncMsgs, setSyncMsgs] = useState<Record<string, string>>({});

  function load() {
    api.overview().then(setRows).catch((e) => setErr(String(e)));
  }

  useEffect(() => { load(); }, []);

  async function handleSync(projectId: string) {
    const fn = SYNC_FN_MAP[projectId];
    if (!fn) return;
    setSyncingKey(projectId);
    setSyncMsgs((m) => ({ ...m, [projectId]: "" }));
    try {
      const r = await fn();
      setSyncMsgs((m) => ({ ...m, [projectId]: `+${r.events_inserted}` }));
      load();
    } catch {
      setSyncMsgs((m) => ({ ...m, [projectId]: "失败" }));
    } finally {
      setSyncingKey(null);
    }
  }

  const totalSessions = rows.reduce((s, r) => s + r.total_sessions, 0);
  const totalTokens = rows.reduce((s, r) => s + r.total_input_tokens + r.total_output_tokens, 0);

  return (
    <div>
      {/* page header */}
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>
          全局总览
        </h1>
        <p style={{ color: "var(--text-muted)", fontSize: 12 }}>
          {rows.length} 个项目 · {totalSessions.toLocaleString()} 次会话 · {fmt(totalTokens)} tokens
        </p>
      </div>

      {err && (
        <div style={{
          background: "#1a0a0a", border: "1px solid #3a1a1a", borderRadius: "var(--r)",
          padding: "0.75rem 1rem", color: "var(--red)", fontSize: 12, marginBottom: "1.5rem",
        }}>
          {err}
        </div>
      )}

      {rows.length === 0 && !err && (
        <p style={{ color: "var(--text-dim)" }}>暂无数据，请点击项目卡片内的同步按钮开始接入。</p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
        {rows.map((p) => {
          const icon = PROJECT_ICONS[p.project_id] ?? "◉";
          const canSync = !!SYNC_FN_MAP[p.project_id];
          const syncing = syncingKey === p.project_id;
          const msg = syncMsgs[p.project_id];
          const totalTok = p.total_input_tokens + p.total_output_tokens;

          return (
            <div key={p.project_id} className="card" style={{ cursor: "default" }}>
              {/* card header */}
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1.25rem" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 18 }}>{icon}</span>
                    <span style={{ color: "var(--text)", fontWeight: 700, fontSize: 14 }}>
                      {p.display_name}
                    </span>
                  </div>
                  <div style={{ color: "var(--text-dim)", fontSize: 11, marginTop: 2, fontFamily: "var(--font-mono)" }}>
                    {p.project_id}
                  </div>
                </div>
                {canSync && (
                  <button
                    onClick={() => handleSync(p.project_id)}
                    disabled={syncingKey !== null}
                    style={{
                      padding: "4px 10px",
                      borderRadius: "var(--r-sm)",
                      border: "1px solid var(--border-hi)",
                      background: syncing ? "var(--border)" : "transparent",
                      color: syncing ? "var(--text-dim)" : "var(--blue)",
                      fontSize: 11,
                      fontWeight: 500,
                      transition: "all 0.1s",
                      opacity: syncingKey !== null && !syncing ? 0.5 : 1,
                    }}
                  >
                    {syncing ? "同步中…" : "同步"}
                  </button>
                )}
              </div>

              {/* stats grid */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "1rem" }}>
                <Stat label="总会话" value={String(p.total_sessions)} />
                <Stat label="今日会话" value={String(p.today_sessions)} accent={p.today_sessions > 0} />
                <Stat label="输入 Token" value={fmt(p.total_input_tokens)} />
                <Stat label="输出 Token" value={fmt(p.total_output_tokens)} />
              </div>

              {/* token bar */}
              {totalTok > 0 && (
                <div style={{ marginBottom: "1rem" }}>
                  <div style={{ background: "var(--border)", borderRadius: 3, height: 4, overflow: "hidden", display: "flex" }}>
                    <div style={{
                      width: `${Math.round(p.total_input_tokens / totalTok * 100)}%`,
                      background: "var(--blue)", height: "100%", transition: "width 0.5s",
                    }} />
                    <div style={{
                      flex: 1, background: "var(--green)", height: "100%",
                    }} />
                  </div>
                  <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
                    <span style={{ color: "var(--blue)", fontSize: 10 }}>▪ 输入</span>
                    <span style={{ color: "var(--green)", fontSize: 10 }}>▪ 输出</span>
                  </div>
                </div>
              )}

              {/* footer */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
                <span style={{ color: "var(--text-dim)", fontSize: 11 }}>
                  最近：{fmtTime(p.last_session_at)}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {msg && (
                    <span style={{ color: msg === "失败" ? "var(--red)" : "var(--green)", fontSize: 11, fontFamily: "var(--font-mono)" }}>
                      {msg}
                    </span>
                  )}
                  <Link href={`/sessions?project_id=${p.project_id}`} style={{ color: "var(--blue)", fontSize: 12 }}>
                    会话 →
                  </Link>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div style={{ color: accent ? "var(--amber)" : "var(--text)", fontWeight: 700, fontSize: 16, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
    </div>
  );
}
