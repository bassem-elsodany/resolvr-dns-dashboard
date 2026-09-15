export type NavIconName =
  | "overview"
  | "clients"
  | "logs"
  | "cache"
  | "zones"
  | "allowed"
  | "blocked"
  | "dhcp"
  | "resolver"
  | "apps"
  | "server"
  | "sessions"
  | "connect"

export interface NavItem {
  to: string
  label: string
  icon: NavIconName
}

export interface NavSection {
  label: string | null
  items: NavItem[]
}

// Mirrors the sidebar structure in the approved wireframe
// (https://claude.ai/artifact/KkUP4PePeDz4kVDA7ULDpM). `icon` matches
// a case in components/layout/NavIcon.vue.
export const navSections: NavSection[] = [
  { label: null, items: [{ to: "/", label: "Overview", icon: "overview" }] },
  {
    label: "Monitoring",
    items: [
      { to: "/clients", label: "Clients", icon: "clients" },
      { to: "/logs", label: "Query Logs", icon: "logs" },
      { to: "/cache", label: "Cache", icon: "cache" },
    ],
  },
  {
    label: "DNS Zones",
    items: [
      { to: "/zones", label: "Zones", icon: "zones" },
      { to: "/allowed", label: "Allowed Zones", icon: "allowed" },
      { to: "/blocked", label: "Blocked Zones", icon: "blocked" },
    ],
  },
  { label: "Network", items: [{ to: "/dhcp", label: "DHCP", icon: "dhcp" }] },
  { label: "Tools", items: [{ to: "/resolver", label: "DNS Resolver", icon: "resolver" }] },
  {
    label: "System",
    items: [
      { to: "/apps", label: "Apps", icon: "apps" },
      { to: "/server", label: "Server Info", icon: "server" },
      { to: "/sessions", label: "Sessions", icon: "sessions" },
    ],
  },
]
