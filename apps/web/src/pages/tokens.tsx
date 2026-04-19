import { useEffect, useState } from "react";
import { api, type TokenOverview } from "@/lib/api";
import type { Project } from "@/types/events";

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ background: "#1a1a1a", borderRadius: 2, height: 8, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, background: color, height: "100%" }} />
    </div>
  );
}

export default function TokensPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [overview, setOverview] = useState<TokenOverview | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.projects().then((ps) => {
      setProjects(ps);
      if (ps.length > 0 && !selectedProject) setSelectedProject(ps[0].id);
    }).catch((e) => setErr(String(e)));
  }, []);

  useEffect(() => {
    if (!selectedProject) return;
    api.tokensOverview(selectedProject).then(setOverview).catch((e) => setErr(String(e)));
  }, [selectedProject]);

  const total = overview ? overview.input_tokens + overview.output_tokens : 0;

  return (
    <div>
      <h2 style={{ margin: "0 0 1.5rem", color: "#fff", fontSize: 16 }}>Token 统计</h2>
      {err && <p style={{ color: "#f87171" }}>{err}</p>}

      {/* project selector */}
      <div style={{ marginBottom: "1.5rem" }}>
        {projects.map((p) => (
          <button
            key={p.id}
            onClick={() => setSelectedProject(p.id)}
            style={{
              marginRight: 8,
              padding: "4px 12px",
              borderRadius: 4,
              border: "1px solid #333",
              background: selectedProject === p.id ? "#1e3a5f" : "#1a1a1a",
              color: selectedProject === p.id ? "#7dd3fc" : "#aaa",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            {p.display_name}
          </button>
        ))}
      </div>

      {overview && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
          {/* main stats */}
          <div
            style={{
              background: "#1a1a2e",
              border: "1px solid #2a2a4a",
              borderRadius: 8,
              padding: "1.25rem",
              minWidth: 280,
            }}
          >
            <div style={{ color: "#888", fontSize: 11, marginBottom: "1rem" }}>总调用量</div>
            <div style={{ color: "#fbbf24", fontSize: 28, fontWeight: "bold" }}>
              {overview.calls.toLocaleString()}
            </div>
            <div style={{ color: "#555", fontSize: 11, marginTop: 4 }}>次 model_call</div>
          </div>

          <div
            style={{
              background: "#1a1a2e",
              border: "1px solid #2a2a4a",
              borderRadius: 8,
              padding: "1.25rem",
              minWidth: 320,
            }}
          >
            <div style={{ color: "#888", fontSize: 11, marginBottom: "1rem" }}>Token 分布</div>

            <Row label="输入" value={fmt(overview.input_tokens)} raw={overview.input_tokens} max={total} color="#7dd3fc" />
            <Row label="输出" value={fmt(overview.output_tokens)} raw={overview.output_tokens} max={total} color="#86efac" />
            <Row label="缓存命中" value={fmt(overview.cache_read_tokens)} raw={overview.cache_read_tokens} max={total} color="#fbbf24" />

            <div style={{ marginTop: "1rem", borderTop: "1px solid #2a2a3a", paddingTop: "0.75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#666", fontSize: 11 }}>总计 (in+out)</span>
                <span style={{ color: "#e2e8f0", fontWeight: "bold" }}>{fmt(total)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {!overview && !err && <p style={{ color: "#555" }}>暂无 Token 数据，请先同步日志。</p>}
    </div>
  );
}

function Row({
  label, value, raw, max, color,
}: {
  label: string; value: string; raw: number; max: number; color: string;
}) {
  return (
    <div style={{ marginBottom: "0.75rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ color: "#888", fontSize: 11 }}>{label}</span>
        <span style={{ color, fontSize: 12, fontWeight: "bold" }}>{value}</span>
      </div>
      <Bar value={raw} max={max} color={color} />
    </div>
  );
}
