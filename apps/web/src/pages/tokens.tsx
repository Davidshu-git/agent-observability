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
    <div style={{ background: "var(--border)", borderRadius: 3, height: 6, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, background: color, height: "100%", transition: "width 0.4s" }} />
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
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>Token 统计</h1>
        <p style={{ color: "var(--text-muted)", fontSize: 12 }}>各项目 LLM 调用消耗分析</p>
      </div>

      {err && <p style={{ color: "var(--red)", marginBottom: "1rem" }}>{err}</p>}

      {/* project tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: "1.5rem" }}>
        {projects.map((p) => (
          <button
            key={p.id}
            onClick={() => setSelectedProject(p.id)}
            className={`tag-btn${selectedProject === p.id ? " active" : ""}`}
          >
            {p.display_name}
          </button>
        ))}
      </div>

      {overview && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
          {/* calls card */}
          <div className="card" style={{ minWidth: 200 }}>
            <div className="stat-label">LLM 调用次数</div>
            <div style={{ fontSize: 36, fontWeight: 800, color: "var(--amber)", fontVariantNumeric: "tabular-nums", marginTop: 8 }}>
              {overview.calls.toLocaleString()}
            </div>
            <div style={{ color: "var(--text-dim)", fontSize: 11, marginTop: 4 }}>次 model_call 事件</div>
          </div>

          {/* token breakdown card */}
          <div className="card" style={{ minWidth: 340, flex: 1, maxWidth: 480 }}>
            <div className="stat-label" style={{ marginBottom: "1rem" }}>Token 分布</div>

            <TokenRow label="输入" value={fmt(overview.input_tokens)} raw={overview.input_tokens} max={total} color="var(--blue)" />
            <TokenRow label="输出" value={fmt(overview.output_tokens)} raw={overview.output_tokens} max={total} color="var(--green)" />
            <TokenRow label="缓存命中" value={fmt(overview.cache_read_tokens)} raw={overview.cache_read_tokens} max={total} color="var(--amber)" />

            <div style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "var(--text-muted)", fontSize: 12 }}>合计（输入 + 输出）</span>
              <span style={{ color: "var(--text)", fontWeight: 700, fontSize: 15, fontVariantNumeric: "tabular-nums" }}>
                {fmt(total)}
              </span>
            </div>
          </div>
        </div>
      )}

      {!overview && !err && (
        <p style={{ color: "var(--text-dim)" }}>暂无 Token 数据，请先同步日志。</p>
      )}
    </div>
  );
}

function TokenRow({ label, value, raw, max, color }: {
  label: string; value: string; raw: number; max: number; color: string;
}) {
  return (
    <div style={{ marginBottom: "0.875rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{label}</span>
        <span style={{ color, fontWeight: 700, fontSize: 13, fontFamily: "var(--font-mono)" }}>{value}</span>
      </div>
      <Bar value={raw} max={max} color={color} />
    </div>
  );
}
