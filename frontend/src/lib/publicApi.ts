/**
 * Public (no-auth) API calls — used only by the Account Manager's
 * offer-request form. Deliberately kept separate from `candidates.ts`
 * (which assumes an authenticated session) since these hit a completely
 * different trust boundary: no JWT, tenant resolved from a URL slug.
 */

import axios from 'axios'

const publicApi = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

export interface FormDataOption {
  id: string
  name: string
}

export interface PublicFormData {
  account_managers: FormDataOption[]
  recruiters: FormDataOption[]
  known_clients: string[]
  hr_users: FormDataOption[]
}

export interface OfferRequestPayload {
  account_manager_id: string
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
  pf_type: 'standard' | 'max' | 'none'
  verification_code: string
}

export interface OfferRequestResponse {
  status: 'submitted' | 'unrouted'
  message: string
  reference_id?: string
}

export interface SendCodeResponse {
  status: string
  sent_to_email_ending_in: string
  demo_code?: string
}

export async function getPublicFormData(tenantSlug: string): Promise<PublicFormData> {
  const res = await publicApi.get<PublicFormData>(`/public/${tenantSlug}/form-data`)
  return res.data
}

export interface ResolveClientHrResponse {
  hr_id: string | null
  hr_name: string | null
}

export async function resolveClientHr(tenantSlug: string, clientName: string): Promise<ResolveClientHrResponse> {
  const res = await publicApi.get<ResolveClientHrResponse>(`/public/${tenantSlug}/resolve-client-hr`, {
    params: { client_name: clientName },
  })
  return res.data
}

export async function sendAmVerificationCode(tenantSlug: string, accountManagerId: string): Promise<SendCodeResponse> {
  const res = await publicApi.post<SendCodeResponse>(
    `/public/${tenantSlug}/account-managers/${accountManagerId}/send-code`
  )
  return res.data
}

export async function submitOfferRequest(
  tenantSlug: string,
  payload: OfferRequestPayload,
  hrOverrideId?: string
): Promise<OfferRequestResponse> {
  const res = await publicApi.post<OfferRequestResponse>(
    `/public/${tenantSlug}/offer-request`,
    payload,
    { params: hrOverrideId ? { hr_override_id: hrOverrideId } : undefined }
  )
  return res.data
}

export interface DocumentRequestInfo {
  candidate_name: string
  client_name: string
  company_name: string
  already_submitted: { document_type: string; original_name: string; uploaded_at: string }[]
}

export async function getDocumentRequestInfo(token: string): Promise<DocumentRequestInfo> {
  const res = await publicApi.get<DocumentRequestInfo>(`/documents/${token}`)
  return res.data
}

export async function uploadCandidateDocument(
  token: string, documentType: string, file: File
): Promise<{ status: string; document_type: string; filename: string }> {
  const formData = new FormData()
  formData.append('document_type', documentType)
  formData.append('file', file)
  const res = await publicApi.post(`/documents/${token}/upload`, formData, {
    headers: { 'Content-Type': undefined },
  })
  return res.data
}

export interface PersonalDetails {
  // Personal
  name_as_per_pan?: string
  contact_number?: string
  emergency_contact_name?: string
  emergency_contact_relation?: string
  emergency_contact_mobile?: string
  date_of_birth?: string
  blood_group?: string
  aadhaar_number?: string
  pan_number?: string
  pf_uan_number?: string
  fathers_name?: string
  mothers_name?: string
  temporary_address?: string
  permanent_address?: string
  // Bank
  bank_account_holder_name?: string
  bank_name?: string
  bank_account_number?: string
  bank_ifsc_code?: string
  bank_branch_name?: string
  // Insurance / dependents
  insurance_option?: 'self' | 'family'
  spouse_name?: string
  spouse_dob?: string
  child_1_name?: string
  child_1_gender?: string
  child_1_dob?: string
  child_2_name?: string
  child_2_gender?: string
  child_2_dob?: string
  // Statutory
  nationality?: string
  qualification?: string
  marital_status?: 'married' | 'unmarried'
  is_international_worker?: boolean
  country_of_origin?: string
  passport_number?: string
  passport_valid_from?: string
  passport_valid_to?: string
  has_physical_handicap?: boolean
  has_locomotive_disability?: boolean
  has_hearing_disability?: boolean
  has_visual_disability?: boolean
  previous_pf_member_id?: string
  submitted_at?: string | null
}

export async function getPersonalDetails(token: string): Promise<PersonalDetails> {
  const res = await publicApi.get<PersonalDetails>(`/documents/${token}/personal-details`)
  return res.data
}

export async function savePersonalDetails(
  token: string, data: PersonalDetails, markSubmitted: boolean
): Promise<{ status: string }> {
  const res = await publicApi.post(
    `/documents/${token}/personal-details`, data, { params: { mark_submitted: markSubmitted } }
  )
  return res.data
}
