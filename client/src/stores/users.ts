import { create } from 'zustand';
import { api } from './api';

interface ManagedUser {
  id: string;
  name: string;
  email: string;
  role: string;
  emailVerified: boolean;
  createdAt: string;
}

interface RoleOption {
  value: string;
  label: string;
}

interface UserManagementState {
  users: ManagedUser[];
  roles: RoleOption[];
  fetchUsers: () => Promise<void>;
  fetchRoles: () => Promise<void>;
  updateRole: (userId: string, role: string) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
}

export const useUserManagementStore = create<UserManagementState>((set, get) => ({
  users: [],
  roles: [],

  fetchUsers: async () => {
    try {
      const res = await api.get('/users/');
      set({ users: res.data.results || res.data.data || res.data });
    } catch (e) { if (import.meta.env.DEV) console.warn("[store]", e); }
  },

  fetchRoles: async () => {
    try { const res = await api.get('/users/roles/'); set({ roles: res.data }); } catch (e) { if (import.meta.env.DEV) console.warn("[store]", e); }
  },
  updateRole: async (userId: string, role: string) => {
    await api.put(`/users/${userId}/role/`, { role });
    await get().fetchUsers();
  },
  deleteUser: async (userId: string) => {
    await api.delete(`/users/${userId}/`);
    // Remove locally immediately so the deleted user can't linger in UI state
    // even if the follow-up refetch fails.
    set((state) => ({ users: state.users.filter((u) => u.id !== userId) }));
    await get().fetchUsers();
  },
}));
