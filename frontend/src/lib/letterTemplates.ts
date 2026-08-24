/**
 * Letter Template & Branding API calls.
 */

import { api } from './supabase'

export interface Run {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
}

export type Block =
  | { type: 'heading'; runs: Run[] }
  | { type: 'paragraph'; runs: Run[]; align?: 'left' | 'right' | 'center' | 'justify' }
  | { type: 'bulletList'; items: { runs: Run[] }[] }
  | { type: 'numberedList'; items: { runs: Run[] }[] }
  | { type: 'ctcTable' }
  | { type: 'signature' }
  | { type: 'spacer' }

export const LETTER_TYPES = [
  'offer', 'appointment', 'hike', 'relieving',
  'experience', 'confirmation', 'warning', 'appreciation', 'promotion',
] as const
export type LetterType = typeof LETTER_TYPES[number]

export const LETTER_TYPE_LABELS: Record<LetterType, string> = {
  offer: 'Offer Letter',
  appointment: 'Appointment Letter',
  hike: 'Hike Letter',
  relieving: 'Relieving Letter',
  experience: 'Experience Letter',
  confirmation: 'Confirmation Letter',
  warning: 'Warning Letter',
  appreciation: 'Appreciation Letter',
  promotion: 'Promotion Letter',
}

export interface LetterTemplate {
  id: string
  tenant_id: string
  letter_type: LetterType
  name: string
  blocks: Block[]
  docx_storage_path: string | null
  mandatory_placeholders: string[]
  custom_placeholder_defaults: Record<string, string>
  is_active: boolean
  version: number
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface PlaceholderScanResult {
  recognized: string[]
  custom: string[]
}

export async function listLetterTemplates(): Promise<LetterTemplate[]> {
  const res = await api.get<LetterTemplate[]>('/letter-templates')
  return res.data
}

export async function getLetterTemplate(id: string): Promise<LetterTemplate> {
  const res = await api.get<LetterTemplate>(`/letter-templates/${id}`)
  return res.data
}

export async function scanPlaceholders(blocks: Block[]): Promise<PlaceholderScanResult> {
  const res = await api.post<PlaceholderScanResult>('/letter-templates/scan-placeholders', { blocks })
  return res.data
}

export async function createLetterTemplate(
  letterType: LetterType, name: string, blocks: Block[],
  mandatoryPlaceholders: string[], customDefaults: Record<string, string>
): Promise<LetterTemplate> {
  const res = await api.post<LetterTemplate>('/letter-templates', {
    letter_type: letterType, name, blocks,
    mandatory_placeholders: mandatoryPlaceholders,
    custom_placeholder_defaults: customDefaults,
  })
  return res.data
}

export async function activateLetterTemplate(id: string): Promise<LetterTemplate> {
  const res = await api.patch<LetterTemplate>(`/letter-templates/${id}/activate`)
  return res.data
}

export async function deleteLetterTemplate(id: string): Promise<void> {
  await api.delete(`/letter-templates/${id}`)
}

export interface Branding {
  tenant_id: string
  logo_storage_path: string | null
  signature_storage_path: string | null
}

export async function getBranding(): Promise<Branding> {
  const res = await api.get<Branding>('/branding')
  return res.data
}

export async function uploadLogo(file: File): Promise<{ logo_storage_path: string }> {
  const formData = new FormData()
  formData.append('file', file)
  // Deliberately NOT setting Content-Type here — the api client's default
  // is 'application/json', but a multipart upload needs a boundary
  // parameter that only axios/the browser can generate correctly.
  // Explicitly clearing it lets that auto-detection happen; hardcoding
  // 'multipart/form-data' without a boundary would make the request
  // unparseable on the server side.
  const res = await api.post('/branding/logo', formData, {
    headers: { 'Content-Type': undefined },
  })
  return res.data
}

export async function uploadSignature(file: File): Promise<{ signature_storage_path: string }> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await api.post('/branding/signature', formData, {
    headers: { 'Content-Type': undefined },
  })
  return res.data
}

// Same recognized-placeholder list as the backend's KNOWN_PLACEHOLDERS,
// used to populate the "Insert Placeholder" dropdown in the editor.
export const RECOGNIZED_PLACEHOLDERS = [
  'employee_name', 'employee_code', 'email', 'phone', 'department', 'designation',
  'client', 'manager', 'recruiter', 'doj', 'status', 'company_name', 'today_date',
  'current_ctc', 'current_ctc_in_words', 'revised_ctc', 'revised_ctc_in_words',
  'effective_date', 'new_designation', 'last_working_day', 'confirmation_date', 'reason',
  'location', 'ref_no', 'offer_ref_date', 'period_from', 'period_to',
]
