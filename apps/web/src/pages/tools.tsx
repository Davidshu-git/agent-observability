import { useEffect, useState } from "react";
import { api, type ToolStat } from "@/lib/api";
import type { Project } from "@/types/events";

export default function ToolsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [tools, setTools] = useState<ToolStat[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.projects().then((ps) => {
      setProjects(ps);
      if (ps.length > 0) setSelectedProject(ps[0].id);
    }).catch((e) => setErr(String(e)));
  }, []);

  useEffect(() => {
    if (!selectedProject) return;
    api.tools(selectedProject).then(setTools).catch((e) => setErr(String(e)));
  }, [selectedProject]);

  const maxCalls = tools.length > 0 ? tools[0].calls : 1;

  return (
    <div>
      <h2 style={{ margin: "0 0 1.5rem", color: "#fff", fontSize: 16 }}>工具调用分析</h2>
      {err && <p style={{ color: "#f87171" }}>{err}</p>}

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

      {tools.length > 0 ? (
        <div
          style={{
            background: "#1a1a2e",
            border: "1px solid #2a2a4a",
            borderRadius: 8,
            padding: "1.25rem",
            maxWidth: 480,
          }}
        >
          <div style={{ color: "#888", fontSize: 11, marginBottom: "0.75rem" }}>
            工具调用次数排行 （共 {tools.length} 种工具）
          </div>
          {tools.map((t, i) => (
            <div key={t.tool_name} style={{ marginBottom: "0.6rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ color: i < 3 ? "#fb923c" : "#aaa", fontSize: 12 }}>
                  {i + 1}. {t.tool_name}
                </span>
                <span style={{ color: "#fbbf24", fontSize: 12, fontWeight: "bold" }}>
                  {t.calls}
                </span>
              </div>
              <div style={{ background: "#111", borderRadius: 2, height: 6, overflow: "hidden" }}>
                <div
                  style={{
                    width: `${Math.round((t.calls / maxCalls) * 100)}%`,
                    background: i < 3 ? "#fb923c" : "#374151",
                    height: "100%",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        !err && <p style={{ color: "#555" }}>暂无工具调用数据，请先同步日志。</p>
      )}
    </div>
  );
}
