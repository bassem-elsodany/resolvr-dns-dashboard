import { createRouter, createWebHistory } from "vue-router"
import ConnectView from "../views/ConnectView.vue"

// Single route for now — Task 4 builds the full sidebar-driven shell and
// the rest of the pages from tasks/plan.md.
export const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: "/", name: "connect", component: ConnectView }],
})
