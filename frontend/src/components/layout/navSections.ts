export interface NavItem {
  to: string
  label: string
}

export interface NavSection {
  label: string | null
  items: NavItem[]
}

// Mirrors the sidebar structure in the approved wireframe
// (https://claude.ai/artifact/KkUP4PePeDz4kVDA7ULDpM).
export const navSections: NavSection[] = [
  { label: null, items: [{ to: "/", label: "Overview" }] },
  {
    label: "Monitoring",
    items: [
      { to: "/clients", label: "Clients" },
      { to: "/logs", label: "Query Logs" },
      { to: "/cache", label: "Cache" },
    ],
  },
  {
    label: "DNS Zones",
    items: [
      { to: "/zones", label: "Zones" },
      { to: "/allowed", label: "Allowed Zones" },
      { to: "/blocked", label: "Blocked Zones" },
    ],
  },
  { label: "Network", items: [{ to: "/dhcp", label: "DHCP" }] },
  { label: "Tools", items: [{ to: "/resolver", label: "DNS Resolver" }] },
  {
    label: "System",
    items: [
      { to: "/apps", label: "Apps" },
      { to: "/server", label: "Server Info" },
      { to: "/sessions", label: "Sessions" },
    ],
  },
]
