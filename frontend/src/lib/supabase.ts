/**
 * Supabase client and API helper.
 *
 * VITE_ prefix means these are safe to expose in the browser bundle —
 * they're the anon key (not service key). Row Level Security enforces
 * all data access rules server-side regardless of what the browser sends.
 */

import { createClient } from '@supabase/supabase-js'
import axios from 'axios'

// ------------------------------------------------------------------ //
// Supabase client (auth + realtime notifications)
// ------------------------------------------------------------------ //
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

// ------------------------------------------------------------------ //
// Axios API client (backend FastAPI calls)
// ------------------------------------------------------------------ //
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

// Inject the Supabase JWT into every backend request automatically
api.interceptors.request.use(async (config) => {
  const { data } = await supabase.auth.getSession()
  if (data.session?.access_token) {
    config.headers.Authorization = `Bearer ${data.session.access_token}`
  }
  return config
})

// Redirect to login on 401
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      await supabase.auth.signOut()
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)
