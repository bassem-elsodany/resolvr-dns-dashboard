import { createRouter, createWebHistory } from "vue-router"
import OverviewView from "../views/OverviewView.vue"
import ClientsView from "../views/ClientsView.vue"
import QueryLogsView from "../views/QueryLogsView.vue"
import CacheView from "../views/CacheView.vue"
import ZonesView from "../views/ZonesView.vue"
import AllowedZonesView from "../views/AllowedZonesView.vue"
import BlockedZonesView from "../views/BlockedZonesView.vue"
import DhcpView from "../views/DhcpView.vue"
import ResolverView from "../views/ResolverView.vue"
import AppsView from "../views/AppsView.vue"
import ServerInfoView from "../views/ServerInfoView.vue"
import SessionsView from "../views/SessionsView.vue"
import ConnectView from "../views/ConnectView.vue"

// One route per sidebar item in the approved wireframe
// (https://claude.ai/artifact/KkUP4PePeDz4kVDA7ULDpM). All render inside
// AppShell's <router-view>, so the sidebar/topbar chrome never remounts
// between pages.
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
    { path: "/connect", name: "connect", component: ConnectView },
  ],
})
