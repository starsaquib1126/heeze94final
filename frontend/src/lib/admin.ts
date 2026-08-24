/**
 * Admin / Directory API — locations, HR users, Account Managers,
 * Recruiters, client routing, and leadership contacts. Every write here
 * is Super-User-only on the backend (confirmed against admin.py's
 * route dependencies), matching this page's own access guard.
 */

import { api } from './supabase'

export interface Location {
  id: string
  tenant_id: string
  name: string
  location_code: string
  address: string | null
  is_active: boolean
  created_at: string
}

export interface HRUser {
  id: string
  tenant_id: string
  location_id: string | null
  full_name: string
  role: 'super_user' | 'hr'
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface DirectoryClient {
  id: string
  tenant_id: string
  client_name: string
  location_id: string
  is_active: boolean
  created_at: string
}

export interface AccountManager {
  id: string
  tenant_id: string
  full_name: string
  email: string
  is_active: boolean
  created_at: string
}

export interface Recruiter {
  id: string
  tenant_id: string
  full_name: string
  is_active: boolean
  created_at: string
}

export interface Leadership {
  id: string
  tenant_id: string
  location_id: string | null
  full_name: string
  email: string
  role_label: string | null
  is_constant: boolean
  is_active: boolean
  created_at: string
}

// ---- Locations ----
export async function listLocations(): Promise<Location[]> {
  const res = await api.get<Location[]>('/admin/locations')
  return res.data
}
export async function createLocation(name: string, locationCode: string, address?: string): Promise<Location> {
  const res = await api.post<Location>('/admin/locations', { name, location_code: locationCode, address })
  return res.data
}

// ---- HR Users ----
export async function listUsers(): Promise<HRUser[]> {
  const res = await api.get<HRUser[]>('/admin/users')
  return res.data
}
export async function createHRUser(fullName: string, email: string, locationId: string): Promise<HRUser> {
  const res = await api.post<HRUser>('/admin/users', {
    full_name: fullName, email, role: 'hr', location_id: locationId,
  })
  return res.data
}
export async function deactivateUser(userId: string): Promise<HRUser> {
  const res = await api.patch<HRUser>(`/admin/users/${userId}/deactivate`)
  return res.data
}

// ---- Directory: Clients ----
export async function listDirectoryClients(): Promise<DirectoryClient[]> {
  const res = await api.get<DirectoryClient[]>('/admin/directory/clients')
  return res.data
}
export async function createDirectoryClient(clientName: string, locationId: string): Promise<DirectoryClient> {
  const res = await api.post<DirectoryClient>('/admin/directory/clients', { client_name: clientName, location_id: locationId })
  return res.data
}

// ---- Directory: Account Managers ----
export async function listAccountManagers(): Promise<AccountManager[]> {
  const res = await api.get<AccountManager[]>('/admin/directory/account-managers')
  return res.data
}
export async function createAccountManager(fullName: string, email: string): Promise<AccountManager> {
  const res = await api.post<AccountManager>('/admin/directory/account-managers', { full_name: fullName, email })
  return res.data
}
export async function deleteAccountManager(id: string): Promise<void> {
  await api.delete(`/admin/directory/account-managers/${id}`)
}

// ---- Directory: Recruiters ----
export async function listRecruiters(): Promise<Recruiter[]> {
  const res = await api.get<Recruiter[]>('/admin/directory/recruiters')
  return res.data
}
export async function createRecruiter(fullName: string): Promise<Recruiter> {
  const res = await api.post<Recruiter>('/admin/directory/recruiters', { full_name: fullName })
  return res.data
}
export async function deleteRecruiter(id: string): Promise<void> {
  await api.delete(`/admin/directory/recruiters/${id}`)
}

// ---- Directory: Leadership ----
export async function listLeadership(): Promise<Leadership[]> {
  const res = await api.get<Leadership[]>('/admin/directory/leadership')
  return res.data
}
export async function createLeadership(
  fullName: string, email: string, roleLabel: string, locationId: string | null, isConstant = false
): Promise<Leadership> {
  const res = await api.post<Leadership>('/admin/directory/leadership', {
    full_name: fullName, email, role_label: roleLabel, location_id: locationId, is_constant: isConstant,
  })
  return res.data
}
