<script setup lang="ts">
import { ref, onMounted } from "vue"
import { useAuthStore } from "../../stores/auth"
import { listUsers, createUser, deleteUser, changeUserPassword, AppApiError, type AppUser, type UserRole } from "../../api/app"

const auth = useAuthStore()
const users = ref<AppUser[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)

const newUsername = ref("")
const newPassword = ref("")
const newRole = ref<UserRole>("viewer")
const addError = ref<string | null>(null)
const adding = ref(false)

const confirmingDeleteId = ref<number | null>(null)
const deleteError = ref<string | null>(null)

const changingPasswordId = ref<number | null>(null)
const passwordInput = ref("")
const passwordError = ref<string | null>(null)

async function load(): Promise<void> {
  loading.value = true
  loadError.value = null
  try {
    const res = await listUsers()
    users.value = res.users
  } catch (err) {
    loadError.value = err instanceof AppApiError ? err.message : "Could not load users."
  } finally {
    loading.value = false
  }
}

async function onAddUser(): Promise<void> {
  addError.value = null
  if (!newUsername.value.trim() || newPassword.value.length < 8) {
    addError.value = "Username is required and password must be at least 8 characters."
    return
  }
  adding.value = true
  try {
    await createUser(newUsername.value.trim(), newPassword.value, newRole.value)
    newUsername.value = ""
    newPassword.value = ""
    newRole.value = "viewer"
    await load()
  } catch (err) {
    addError.value = err instanceof AppApiError ? err.message : "Could not create user."
  } finally {
    adding.value = false
  }
}

function startDelete(id: number): void {
  confirmingDeleteId.value = id
  deleteError.value = null
}

function cancelDelete(): void {
  confirmingDeleteId.value = null
}

async function confirmDelete(id: number): Promise<void> {
  deleteError.value = null
  try {
    await deleteUser(id)
    confirmingDeleteId.value = null
    await load()
  } catch (err) {
    deleteError.value = err instanceof AppApiError ? err.message : "Could not delete user."
  }
}

function startPasswordChange(id: number): void {
  changingPasswordId.value = id
  passwordInput.value = ""
  passwordError.value = null
}

function cancelPasswordChange(): void {
  changingPasswordId.value = null
}

async function savePasswordChange(id: number): Promise<void> {
  passwordError.value = null
  if (passwordInput.value.length < 8) {
    passwordError.value = "Password must be at least 8 characters."
    return
  }
  try {
    await changeUserPassword(id, passwordInput.value)
    changingPasswordId.value = null
  } catch (err) {
    passwordError.value = err instanceof AppApiError ? err.message : "Could not change password."
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="mb-5">
      <h1 class="text-lg font-semibold tracking-tight text-fg">Users</h1>
      <p class="mt-1 text-sm text-gray-500">
        Who can sign into this dashboard &mdash; Admins can manage users and the Technitium connection,
        Viewers can only see the monitoring pages.
      </p>
    </div>

    <div class="mb-5 rounded-lg border border-border bg-background-card p-3.5">
      <div class="mb-2 text-[12.5px] font-semibold">Add a user</div>
      <form class="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto_auto]" @submit.prevent="onAddUser">
        <input
          id="new-username"
          v-model="newUsername"
          type="text"
          placeholder="Username"
          autocomplete="off"
          class="rounded-md border border-border bg-background-card px-2.5 py-1.5 text-xs"
        />
        <input
          id="new-password"
          v-model="newPassword"
          type="password"
          placeholder="Password (min. 8 characters)"
          autocomplete="new-password"
          class="rounded-md border border-border bg-background-card px-2.5 py-1.5 text-xs"
        />
        <select id="new-role" v-model="newRole" class="rounded-md border border-border bg-background-card px-2.5 py-1.5 text-xs">
          <option value="viewer">Viewer</option>
          <option value="admin">Admin</option>
        </select>
        <button
          id="add-user"
          type="submit"
          :disabled="adding"
          class="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {{ adding ? "Adding…" : "Add user" }}
        </button>
      </form>
      <p v-if="addError" id="add-user-error" class="mt-2 text-xs text-crit">{{ addError }}</p>
    </div>

    <p v-if="loadError" id="users-error" class="mb-3 text-sm text-crit">{{ loadError }}</p>
    <p v-else-if="loading && users.length === 0" class="text-sm text-gray-500">Loading…</p>

    <div v-else class="overflow-x-auto rounded-lg border border-border">
      <table class="w-full text-left text-[12.5px]">
        <thead>
          <tr class="border-b border-border bg-background-elevated text-[10.5px] uppercase text-gray-500">
            <th class="px-3 py-2 font-bold">Username</th>
            <th class="px-3 py-2 font-bold">Role</th>
            <th class="px-3 py-2 font-bold">Created</th>
            <th class="px-3 py-2 font-bold">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in users" :key="row.id" class="border-b border-border last:border-b-0">
            <td class="px-3 py-2 font-mono">
              {{ row.username }}
              <span v-if="row.username === auth.user?.username" class="ml-1.5 text-[10.5px] text-gray-500">(you)</span>
            </td>
            <td class="px-3 py-2">
              <span
                class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10.5px] font-semibold"
                :class="row.role === 'admin' ? 'bg-info/12 text-info' : 'bg-background-hover text-gray-500'"
                >{{ row.role === "admin" ? "Admin" : "Viewer" }}</span
              >
            </td>
            <td class="px-3 py-2 text-gray-500">{{ new Date(row.createdAt).toLocaleDateString() }}</td>
            <td class="px-3 py-2">
              <div v-if="changingPasswordId === row.id" class="flex flex-wrap items-center gap-1.5">
                <input
                  v-model="passwordInput"
                  type="password"
                  placeholder="New password"
                  class="w-36 rounded-md border border-border bg-background-card px-2 py-1 text-xs"
                />
                <button type="button" class="text-xs font-semibold text-accent" @click="savePasswordChange(row.id)">Save</button>
                <button type="button" class="text-xs text-gray-500" @click="cancelPasswordChange">Cancel</button>
                <p v-if="passwordError" class="w-full text-[11px] text-crit">{{ passwordError }}</p>
              </div>
              <div v-else-if="confirmingDeleteId === row.id" class="flex items-center gap-1.5">
                <span class="text-xs text-crit">Delete this user?</span>
                <button type="button" class="text-xs font-semibold text-crit" @click="confirmDelete(row.id)">Confirm</button>
                <button type="button" class="text-xs text-gray-500" @click="cancelDelete">Cancel</button>
              </div>
              <div v-else class="flex items-center gap-3">
                <button type="button" class="text-xs font-medium text-accent" @click="startPasswordChange(row.id)">
                  Change password
                </button>
                <button type="button" class="text-xs font-medium text-crit" @click="startDelete(row.id)">Delete</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="deleteError" class="mt-2 text-sm text-crit">{{ deleteError }}</p>
  </div>
</template>
