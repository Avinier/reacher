"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Archive, Bot, Home, ListChecks, MessageSquareText, Settings, ShieldCheck, Target, type LucideIcon } from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Operate",
    items: [
      { href: "/", label: "Command", icon: Home },
      { href: "/runs", label: "Runs", icon: Activity }
    ]
  },
  {
    label: "Data",
    items: [
      { href: "/lists", label: "Lists", icon: ListChecks },
      { href: "/targets", label: "Targets", icon: Target },
      { href: "/drafts", label: "Drafts", icon: MessageSquareText }
    ]
  },
  {
    label: "Channels",
    items: [
      { href: "/outreach", label: "Outreach", icon: Bot },
      { href: "/contexts", label: "Contexts", icon: ShieldCheck }
    ]
  },
  {
    label: "System",
    items: [
      { href: "/exports", label: "Exports", icon: Archive },
      { href: "/settings", label: "Settings", icon: Settings }
    ]
  }
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="sidebar-nav" aria-label="Main navigation">
      {navGroups.map((group) => (
        <div className="nav-group" key={group.label}>
          <p className="nav-label">{group.label}</p>
          {group.items.map((item) => {
            const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link className={isActive ? "nav-item active" : "nav-item"} key={item.href} href={item.href}>
                <item.icon size={17} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
