import { createRouter, createWebHistory } from "vue-router"

declare module "vue-router" {
  interface RouteMeta {
    public?: boolean
    requiresAdmin?: boolean
  }
}

import OverviewView from "../views/overview/OverviewView.vue"
import ClientsView from "../views/monitoring/ClientsView.vue"
import QueryLogsView from "../views/monitoring/QueryLogsView.vue"
import CacheView from "../views/monitoring/CacheView.vue"
import ZonesView from "../views/zones/ZonesView.vue"
import AllowedZonesView from "../views/zones/AllowedZonesView.vue"
import BlockedZonesView from "../views/zones/BlockedZonesView.vue"
import DhcpView from "../views/network/DhcpView.vue"
import ResolverView from "../views/tools/ResolverView.vue"
import AppsView from "../views/system/AppsView.vue"
import ServerInfoView from "../views/system/ServerInfoView.vue"
import SessionsView from "../views/system/SessionsView.vue"
import UsersView from "../views/system/UsersView.vue"
import ConnectView from "../views/connection/ConnectView.vue"
import LoginView from "../views/auth/LoginView.vue"
import { useAuthStore } from "../stores/auth"

// One route per sidebar item in the approved wireframe
// (https://claude.ai/artifact/KkUP4PePeDz4kVDA7ULDpM). All render inside
// AppShell's <router-view>, so the sidebar/topbar chrome never remounts
// between pages. Views live under src/views/<feature-area>/, mirroring
// the sidebar's nav sections (see components/layout/navSections.ts).
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "overview", component: OverviewView },
    { path: "/clients", name: "clients", component: ClientsView },
    { path: "/logs", name: "logs", component: QueryLogsView },
    { path: "/cache", name: "cache", component: CacheView },
    { path: "/zones", name: "zones", component: ZonesView },
    { path: "/allowed", name: "allowed", component: AllowedZonesView },
    { path: "/blocked", name: "blocked", component: BlockedZonesView },
    { path: "/dhcp", name: "dhcp", component: DhcpView },
    { path: "/resolver", name: "resolver", component: ResolverView },
    { path: "/apps", name: "apps", component: AppsView },
    { path: "/server", name: "server", component: ServerInfoView },
    { path: "/sessions", name: "sessions", component: SessionsView },
    { path: "/users", name: "users", component: UsersView, meta: { requiresAdmin: true } },
    { path: "/connect", name: "connect", component: ConnectView, meta: { requiresAdmin: true } },
    { path: "/login", name: "login", component: LoginView, meta: { public: true } },
  ],
})

// Every route requires a signed-in session except /login. A route
// tagged requiresAdmin (Users, Connection Settings — both able to
// change what every other user sees) additionally requires the admin
// role; a viewer hitting one is sent back to Overview rather than
// shown a 403 page, since it's not something they'd ever click into
// deliberately.
router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (!auth.checked) await auth.checkSession()

  if (!to.meta.public && !auth.isAuthenticated) {
    return { name: "login", query: { redirect: to.fullPath } }
  }
  if (to.name === "login" && auth.isAuthenticated) {
    return { path: "/" }
  }
  if (to.meta.requiresAdmin && !auth.isAdmin) {
    return { path: "/" }
  }
  return true
})
