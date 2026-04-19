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
      setSyncMsgs((m) => ({ ...m, [projectId]: `+${r.events_inserted} 条` }));
      load();
    } catch (e) {
      setSyncMsgs((m) => ({ ...m, [projectId]: "失败" }));
    } finally {
      setSyncingKey(null);
    }
  }

  return (
    <div>
      <h2 style={{ margin: "0 0 1.5rem", color: "#fff" }}>全局总览</h2>

      {err && <p style={{ color: "#f87171" }}>{err}</p>}

      {rows.length === 0 && !err && (
        <p style={{ color: "#666" }}>暂无数据，请点击项目卡片内的同步按钮开始接入。</p>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
        {rows.map((p) => (
          <div
            key={p.project_id}
            style={{
              background: "#1a1a2e",
              border: "1px solid #2a2a4a",
              borderRadius: 8,
              padding: "1rem 1.5rem",
              minWidth: 260,
            }}
          >
            <div style={{ color: "#fff", fontWeight: "bold", fontSize: 15, marginBottom: "0.75rem" }}>
              {p.display_name}
              <span style={{ color: "#555", fontWeight: "normal", fontSize: 11, marginLeft: 8 }}>
                {p.project_id}
              </span>
            </div>

            <Grid>
              <Stat label="总会话" value={String(p.total_sessions)} />
              <Stat label="今日会话" value={String(p.today_sessions)} />
              <Stat label="输入 Token" value={fmt(p.total_input_tokens)} />
              <Stat label="输出 Token" value={fmt(p.total_output_tokens)} />
            </Grid>

            <div style={{ marginTop: "0.75rem", color: "#666", fontSize: 11 }}>
              最近：{fmtTime(p.last_session_at)}
            </div>

            <div style={{ marginTop: "0.75rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <Link
                href={`/sessions?project_id=${p.project_id}`}
                style={{ color: "#7dd3fc", fontSize: 12 }}
              >
                查看会话 →
              </Link>

              {SYNC_FN_MAP[p.project_id] && (
                <>
                  <button
                    onClick={() => handleSync(p.project_id)}
                    disabled={syncingKey !== null}
                    style={{
                      padding: "2px 10px",
                      background: syncingKey === p.project_id ? "#333" : "transparent",
                      color: syncingKey === p.project_id ? "#666" : "#4a8aaa",
                      border: "1px solid #2a4a5a",
                      borderRadius: 4,
                      cursor: syncingKey !== null ? "default" : "pointer",
                      fontSize: 11,
                    }}
                  >
                    {syncingKey === p.project_id ? "同步中…" : "同步"}
                  </button>
                  {syncMsgs[p.project_id] && (
                    <span style={{ color: "#86efac", fontSize: 11 }}>
                      {syncMsgs[p.project_id]}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: "#555", fontSize: 10, marginBottom: 2 }}>{label}</div>
      <div style={{ color: "#e2e8f0", fontWeight: "bold", fontSize: 14 }}>{value}</div>
    </div>
  );
}
