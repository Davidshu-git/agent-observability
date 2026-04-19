import Link from "next/link";
import { useRouter } from "next/router";
import type { ReactNode } from "react";

const NAV = [
  { label: "总览",    href: "/",        icon: "◈" },
  { label: "会话",    href: "/sessions", icon: "◉" },
  { label: "Token",  href: "/tokens",   icon: "◎" },
  { label: "工具",   href: "/tools",    icon: "◆" },
];

export default function Layout({ children }: { children: ReactNode }) {
  const router = useRouter();

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* sidebar */}
      <nav style={{
        width: 180,
        flexShrink: 0,
        background: "var(--surface)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        padding: "0",
      }}>
        {/* logo area */}
        <div style={{
          padding: "1.25rem 1.25rem 1rem",
          borderBottom: "1px solid var(--border)",
        }}>
          <div style={{
            color: "var(--blue)",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.02em",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}>
            <span style={{
              background: "linear-gradient(135deg, #60a5fa22, #c4b5fd22)",
              border: "1px solid #60a5fa33",
              borderRadius: 6,
              width: 24,
              height: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
            }}>◈</span>
            AgentObs
          </div>
        </div>

        {/* nav items */}
        <div style={{ flex: 1, padding: "0.75rem 0.75rem" }}>
          {NAV.map((n) => {
            const active = router.pathname === n.href;
            return (
              <Link
                key={n.href}
                href={n.href}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "7px 10px",
                  borderRadius: "var(--r)",
                  marginBottom: 2,
                  color: active ? "var(--blue)" : "var(--text-muted)",
                  background: active ? "var(--blue-dim)" : "transparent",
                  fontWeight: active ? 600 : 400,
                  fontSize: 13,
                  transition: "background 0.1s, color 0.1s",
                  textDecoration: "none",
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    (e.currentTarget as HTMLElement).style.background = "var(--border)";
                    (e.currentTarget as HTMLElement).style.color = "var(--text)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    (e.currentTarget as HTMLElement).style.background = "transparent";
                    (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
                  }
                }}
              >
                <span style={{ fontSize: 11, opacity: 0.7, fontFamily: "var(--font-mono)" }}>
                  {n.icon}
                </span>
                {n.label}
              </Link>
            );
          })}
        </div>

        {/* footer */}
        <div style={{
          padding: "0.75rem 1.25rem",
          borderTop: "1px solid var(--border)",
          color: "var(--text-dim)",
          fontSize: 10,
        }}>
          Agent Observability
        </div>
      </nav>

      {/* main */}
      <main style={{
        flex: 1,
        padding: "1.75rem 2rem",
        overflowY: "auto",
        background: "var(--bg)",
        minWidth: 0,
      }}>
        {children}
      </main>
    </div>
  );
}
