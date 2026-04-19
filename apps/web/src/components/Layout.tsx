import Link from "next/link";
import { useRouter } from "next/router";
import type { ReactNode } from "react";

const NAV: { label: string; href: string }[] = [
  { label: "总览", href: "/" },
  { label: "会话", href: "/sessions" },
  { label: "Token", href: "/tokens" },
  { label: "工具", href: "/tools" },
];

export default function Layout({ children }: { children: ReactNode }) {
  const router = useRouter();

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "monospace", fontSize: 13 }}>
      {/* sidebar */}
      <nav
        style={{
          width: 160,
          background: "#111",
          color: "#ccc",
          padding: "1.5rem 1rem",
          flexShrink: 0,
        }}
      >
        <div style={{ color: "#fff", fontWeight: "bold", marginBottom: "1.5rem", fontSize: 14 }}>
          🔭 Agent Obs
        </div>
        {NAV.map((n) => {
          const active = router.pathname === n.href;
          return (
            <div key={n.href} style={{ marginBottom: "0.5rem" }}>
              <Link
                href={n.href}
                style={{
                  color: active ? "#7dd3fc" : "#aaa",
                  textDecoration: "none",
                  display: "block",
                  padding: "4px 8px",
                  borderRadius: 4,
                  background: active ? "#1e3a5f" : "transparent",
                }}
              >
                {n.label}
              </Link>
            </div>
          );
        })}
      </nav>

      {/* main */}
      <main style={{ flex: 1, padding: "1.5rem 2rem", overflowY: "auto", background: "#0d0d0d", color: "#ddd" }}>
        {children}
      </main>
    </div>
  );
}
