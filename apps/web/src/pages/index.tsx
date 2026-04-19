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

export default function OverviewPage() {
  const [rows, setRows] = useState<ProjectOverview[]>([]);
  const [err, setErr] = useState("");
  const [syncingKey, setSyncingKey] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState("");

  function load() {
    api.overview().then(setRows).catch((e) => setErr(String(e)));
  }

  useEffect(() => { load(); }, []);

  async function handleSync(key: string, fn: () => Promise<{ events_inserted: number }>) {
    setSyncingKey(key);
    setSyncMsg("");
    try {
      const r = await fn();
      setSyncMsg(`同步完成：+${r.events_inserted} 条事件`);
      load();
    } catch (e) {
      setSyncMsg(`同步失败: ${e}`);
    } finally {
      setSyncingKey(null);
    }
  }

  const syncButtons = [
    { key: "mhxy", label: "mhxy", fn: api.ingestMhxy },
    { key: "stock-bot", label: "stock-bot", fn: api.ingestStockBot },
    { key: "ehs-bot", label: "ehs-bot", fn: api.ingestEhsBot },
  ];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, color: "#fff" }}>全局总览</h2>
        {syncButtons.map(({ key, label, fn }) => (
          <button
            key={key}
            onClick={() => handleSync(key, fn)}
            disabled={syncingKey !== null}
            style={{
              padding: "4px 12px",
              background: syncingKey === key ? "#333" : "#1a4a7a",
              color: "#7dd3fc",
              border: "1px solid #2a6aaa",
              borderRadius: 4,
              cursor: syncingKey !== null ? "default" : "pointer",
              fontSize: 12,
            }}
          >
            {syncingKey === key ? "同步中…" : `同步 ${label}`}
          </button>
        ))}
        {syncMsg && <span style={{ color: "#86efac", fontSize: 12 }}>{syncMsg}</span>}
      </div>

      {err && <p style={{ color: "#f87171" }}>{err}</p>}

      {rows.length === 0 && !err && (
        <p style={{ color: "#666" }}>暂无数据，请点击同步按钮开始接入。</p>
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

            <div style={{ marginTop: "0.75rem" }}>
              <Link
                href={`/sessions?project_id=${p.project_id}`}
                style={{ color: "#7dd3fc", fontSize: 12 }}
              >
                查看会话 →
              </Link>
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
