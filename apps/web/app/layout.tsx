import type { Metadata } from "next";
import Link from "next/link";
import { Activity, Archive, Bot, FileText, Home, ListChecks, MessageSquareText, Send, Settings, ShieldCheck, Target } from "lucide-react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Reacher",
  description: "Local-first browser agent workbench"
};

export const dynamic = "force-dynamic";

const navItems = [
  { href: "/", label: "Command", icon: Home },
  { href: "/runs", label: "Runs", icon: Activity },
  { href: "/lists", label: "Lists", icon: ListChecks },
  { href: "/targets", label: "Targets", icon: Target },
  { href: "/drafts", label: "Drafts", icon: MessageSquareText },
  { href: "/outreach", label: "Outreach", icon: Bot },
  { href: "/reddit", label: "Reddit", icon: Send },
  { href: "/contexts", label: "Contexts", icon: ShieldCheck },
  { href: "/exports", label: "Exports", icon: Archive },
  { href: "/settings", label: "Settings", icon: Settings }
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <aside className="sidebar">
            <Link className="brand" href="/">
              <FileText size={22} />
              <span>Reacher</span>
            </Link>
            <nav>
              {navItems.map((item) => (
                <Link key={item.href} href={item.href}>
                  <item.icon size={17} />
                  <span>{item.label}</span>
                </Link>
              ))}
            </nav>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
