/**
 * Auth store — the single source of truth for who's logged in.
 *
 * Listens to Supabase auth state changes and loads the corresponding
 * user_profiles record so every component can know:
 *   - user.role: 'super_user' | 'hr'
 *   - user.tenant_id: which company
 *   - user.location_id: which location (null for super_user)
 */

import { create } from 'zustand'
import { supabase, api } from '@/lib/supabase'

export interface UserProfile {
  id: string
  tenant_id: string
  location_id: string | null
  full_name: string
  role: 'super_user' | 'hr'
  is_active: boolean
  email: string
}

interface AuthState {
  user: UserProfile | null
  loading: boolean
  error: string | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  loadProfile: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  error: null,

  signIn: async (email, password) => {
    set({ loading: true, error: null })
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      set({ loading: false, error: error.message })
      return
    }
    // Profile loads via onAuthStateChange listener below
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({ user: null, loading: false, error: null })
  },

  loadProfile: async () => {
    try {
      const res = await api.get<UserProfile>('/me')
      set({ user: res.data, loading: false, error: null })
    } catch {
      set({ user: null, loading: false, error: 'Failed to load profile' })
    }
  },
}))

// Listen to Supabase auth state changes — kicks in on tab reload,
// token refresh, and sign-out, so the store stays in sync automatically.
supabase.auth.onAuthStateChange(async (event, session) => {
  const { loadProfile, signOut } = useAuthStore.getState()
  if (session) {
    await loadProfile()
  } else {
    useAuthStore.setState({ user: null, loading: false })
  }
})
