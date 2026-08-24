/**
 * Candidate & Dashboard API calls.
 *
 * Thin typed wrappers around the shared `api` axios instance (which
 * already injects the Supabase JWT and handles 401 redirects — see
 * lib/supabase.ts). Components should never call `api.get(...)` directly
 * for these resources; they should call these functions, so the shape
 * of a "Candidate" is defined in exactly one place.
 */

import { api } from './supabase'

export type CandidateStage =
  | 'requested'
  | 'offered'
  | 'revised'
  | 'joined'
  | 'id_assigned'
  | 'active'
  | 'rejected'
  | 'resigned'
  | 'exited'

export interface Candidate {
  id: string
  tenant_id: string
  location_id: string
  request_date: string
  account_manager_id: string | null
  recruiter_id: string | null
  client_name: string
  full_name: string
  email: string
  phone: string | null
  designation: string | null
  department: string | null
  work_location: string | null
  proposed_ctc: number | null
  expected_doj: string | null
  stage: CandidateStage
  offer_released_at: string | null
  offer_letter_path: string | null
  is_revised: boolean
  confirmed_doj: string | null
  employee_id: string | null
  employee_id_auto: boolean | null
  appointment_released_at: string | null
  appointment_letter_path: string | null
  documents_submitted_at: string | null
  resignation_date: string | null
  last_working_day: string | null
  clearance_received: boolean
  clearance_date: string | null
  relieving_released_at: string | null
  relieving_letter_path: string | null
  hr_owner_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface CandidateEvent {
  id: string
  candidate_id: string
  tenant_id: string
  event_type: string
  performed_by: string | null
  details: Record<string, unknown>
  created_at: string
}

export interface DashboardSummary {
  stage_counts: Record<string, number>
  active_total: number
  upcoming_joinings: Candidate[]
  joining_today: Candidate[]
}

export async function listCandidates(params?: {
  stage?: string
  search?: string
}): Promise<Candidate[]> {
  const res = await api.get<Candidate[]>('/candidates', { params })
  return res.data
}

export async function getCandidate(id: string): Promise<Candidate> {
  const res = await api.get<Candidate>(`/candidates/${id}`)
  return res.data
}

export async function getCandidateEvents(id: string): Promise<CandidateEvent[]> {
  const res = await api.get<CandidateEvent[]>(`/candidates/${id}/events`)
  return res.data
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const res = await api.get<DashboardSummary>('/dashboard/summary')
  return res.data
}

export interface Analytics {
  requests_raised: number
  offers_released: number
  joined: number
  rejected: number
  offer_to_joining_rate: number | null
}

export async function getAnalytics(dateFrom?: string, dateTo?: string): Promise<Analytics> {
  const res = await api.get<Analytics>('/dashboard/analytics', {
    params: { date_from: dateFrom, date_to: dateTo },
  })
  return res.data
}

export async function releaseOffer(candidateId: string, ctcStructureId?: string): Promise<Candidate> {
  const res = await api.post<Candidate>(
    `/candidates/${candidateId}/release-offer`,
    {},
    { params: ctcStructureId ? { ctc_structure_id: ctcStructureId } : undefined }
  )
  return res.data
}

export async function getLetterDownloadUrl(candidateId: string, field: string): Promise<string> {
  const res = await api.get<{ url: string }>(`/candidates/${candidateId}/letter-url`, {
    params: { field },
  })
  return res.data.url
}

// Human-readable labels and colors for each pipeline stage — kept here,
// next to the type definition, so every component renders stages
// consistently instead of each page inventing its own labels/colors.
export const STAGE_LABELS: Record<CandidateStage, string> = {
  requested: 'Requested',
  offered: 'Offered',
  revised: 'Revised',
  joined: 'Joined',
  id_assigned: 'ID Assigned',
  active: 'Active',
  rejected: 'Rejected',
  resigned: 'Resigned',
  exited: 'Exited',
}

export const STAGE_COLORS: Record<CandidateStage, string> = {
  requested: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  offered: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  revised: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  joined: 'bg-teal-500/20 text-teal-300 border-teal-500/30',
  id_assigned: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
  active: 'bg-green-500/20 text-green-300 border-green-500/30',
  rejected: 'bg-red-500/20 text-red-300 border-red-500/30',
  resigned: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  exited: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
}

export interface NotificationLogEntry {
  id: string
  tenant_id: string
  candidate_id: string | null
  event_type: string
  recipients: { email: string; name?: string; role?: string }[]
  subject: string
  status: 'sent' | 'failed'
  error_message: string | null
  sent_at: string
}

export async function getCandidateNotifications(id: string): Promise<NotificationLogEntry[]> {
  const res = await api.get<NotificationLogEntry[]>(`/candidates/${id}/notifications`)
  return res.data
}

export interface ExportFilters {
  stage?: string
  date_from?: string
  date_to?: string
  recruiter_id?: string
  account_manager_id?: string
}

export async function exportCandidates(filters: ExportFilters): Promise<void> {
  const res = await api.get('/candidates/export', {
    params: filters,
    responseType: 'blob',
  })
  const url = window.URL.createObjectURL(new Blob([res.data]))
  const link = document.createElement('a')
  link.href = url
  const disposition = res.headers['content-disposition'] as string | undefined
  const filenameMatch = disposition?.match(/filename="(.+)"/)
  link.download = filenameMatch?.[1] ?? 'candidates_export.xlsx'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}

export async function confirmJoining(candidateId: string, confirmedDoj: string): Promise<Candidate> {
  const res = await api.post<Candidate>(`/candidates/${candidateId}/confirm-joining`, {
    confirmed_doj: confirmedDoj,
  })
  return res.data
}

export async function suggestEmployeeId(candidateId: string): Promise<string> {
  const res = await api.post<{ suggested_employee_id: string }>(`/candidates/${candidateId}/suggest-employee-id`)
  return res.data.suggested_employee_id
}

export async function resendDocumentLink(candidateId: string): Promise<{ status: string }> {
  const res = await api.post<{ status: string }>(`/candidates/${candidateId}/resend-document-link`)
  return res.data
}

export async function assignEmployeeId(candidateId: string, manualCode?: string): Promise<Candidate> {
  const res = await api.post<Candidate>(`/candidates/${candidateId}/assign-employee-id`, {
    manual_code: manualCode || null,
  })
  return res.data
}

export async function releaseAppointment(candidateId: string, ctcStructureId?: string): Promise<Candidate> {
  const res = await api.post<Candidate>(
    `/candidates/${candidateId}/release-appointment`,
    {},
    { params: ctcStructureId ? { ctc_structure_id: ctcStructureId } : undefined }
  )
  return res.data
}

export async function logResignation(
  candidateId: string, resignationDate: string, lastWorkingDay: string
): Promise<Candidate> {
  const res = await api.post<Candidate>(`/candidates/${candidateId}/log-resignation`, {
    resignation_date: resignationDate, last_working_day: lastWorkingDay,
  })
  return res.data
}

export async function markClearanceReceived(candidateId: string, clearanceDate: string): Promise<Candidate> {
  const res = await api.post<Candidate>(`/candidates/${candidateId}/mark-clearance`, {
    clearance_date: clearanceDate,
  })
  return res.data
}

export async function releaseRelieving(candidateId: string): Promise<Candidate> {
  const res = await api.post<Candidate>(`/candidates/${candidateId}/release-relieving`, {})
  return res.data
}

export interface ReviseOfferInput {
  proposed_ctc?: number
  expected_doj?: string
  designation?: string
  department?: string
  work_location?: string
}

export async function reviseOffer(
  candidateId: string, data: ReviseOfferInput, ctcStructureId?: string
): Promise<Candidate> {
  const res = await api.post<Candidate>(`/candidates/${candidateId}/revise-offer`, data, {
    params: ctcStructureId ? { ctc_structure_id: ctcStructureId } : undefined,
  })
  return res.data
}

export interface HikeLetter {
  id: string
  tenant_id: string
  candidate_id: string
  previous_ctc: number
  revised_ctc: number
  effective_date: string
  letter_path: string | null
  released_by: string | null
  released_at: string
}

export async function getHikeHistory(candidateId: string): Promise<HikeLetter[]> {
  const res = await api.get<HikeLetter[]>(`/candidates/${candidateId}/hikes`)
  return res.data
}

export async function releaseHike(
  candidateId: string, revisedCtc: number, effectiveDate: string
): Promise<HikeLetter> {
  const res = await api.post<HikeLetter>(`/candidates/${candidateId}/release-hike`, {
    revised_ctc: revisedCtc, effective_date: effectiveDate,
  })
  return res.data
}

export interface CandidateDocument {
  id: string
  tenant_id: string
  candidate_id: string
  document_type: string
  original_name: string
  storage_path: string
  financial_year: string | null
  is_archived: boolean
  archived_zip_path: string | null
  uploaded_at: string
}

export async function listCandidateDocuments(candidateId: string): Promise<CandidateDocument[]> {
  const res = await api.get<CandidateDocument[]>(`/candidates/${candidateId}/documents`)
  return res.data
}

export async function getDocumentDownloadUrl(candidateId: string, documentId: string): Promise<string> {
  const res = await api.get<{ url: string }>(`/candidates/${candidateId}/documents/${documentId}/url`)
  return res.data.url
}

export interface CandidateUpdateInput {
  full_name?: string
  email?: string
  phone?: string
  client_name?: string
  designation?: string
  department?: string
  work_location?: string
  proposed_ctc?: number
  expected_doj?: string
}

export async function updateCandidate(candidateId: string, updates: CandidateUpdateInput): Promise<Candidate> {
  const res = await api.patch<Candidate>(`/candidates/${candidateId}`, updates)
  return res.data
}

export async function deleteCandidateRequest(candidateId: string): Promise<void> {
  await api.delete(`/candidates/${candidateId}`)
}

export async function rejectOffer(candidateId: string, reason?: string, notifyCandidate?: boolean): Promise<Candidate> {
  const res = await api.post<Candidate>(`/candidates/${candidateId}/reject-offer`, {
    reason, notify_candidate: notifyCandidate ?? false,
  })
  return res.data
}

export interface HRCandidateCreateInput {
  account_manager_id?: string
  recruiter_id?: string
  client_name: string
  full_name: string
  email: string
  phone?: string
  designation?: string
  department?: string
  work_location?: string
  proposed_ctc?: number
  expected_doj?: string
}

export async function createCandidateDirect(
  data: HRCandidateCreateInput, locationId?: string
): Promise<Candidate> {
  const res = await api.post<Candidate>('/candidates', data, {
    params: locationId ? { location_id: locationId } : undefined,
  })
  return res.data
}
