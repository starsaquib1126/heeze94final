import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  getDocumentRequestInfo, uploadCandidateDocument,
  getPersonalDetails, savePersonalDetails, type PersonalDetails,
} from '@/lib/publicApi'
import { getErrorMessage } from '@/lib/errors'

const DOCUMENT_TYPES: { value: string; label: string; templateUrl?: string }[] = [
  { value: 'pan', label: 'PAN Card (Self-Attested)' },
  { value: 'aadhaar', label: 'Aadhaar Card (Self-Attested)' },
  { value: 'photo', label: 'Passport Size Photograph' },
  { value: 'bank_details', label: 'Cancelled Cheque' },
  { value: 'resume', label: 'Resume' },
  { value: 'education_certificate', label: 'Education Certificate' },
  { value: 'previous_experience', label: 'Previous Experience Letter' },
  {
    value: 'form_11', label: 'Form 11 (EPFO Declaration)',
    templateUrl: '/statutory-forms/Form-11-EPFO-Declaration.pdf',
  },
  {
    value: 'form_f_gratuity', label: 'Form F (Gratuity Nomination)',
    templateUrl: '/statutory-forms/Form-F-Gratuity-Nomination.pdf',
  },
  {
    value: 'pf_nomination_form_2', label: 'PF Nomination (Form 2)',
    templateUrl: '/statutory-forms/PF-Nomination-Form-2.pdf',
  },
  { value: 'other', label: 'Other' },
]

const inputClass =
  'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white ' +
  'placeholder-gray-500 focus:outline-none focus:border-purple-500'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-gray-400 text-xs block mb-1">{label}</label>
      {children}
    </div>
  )
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <h2 className="text-white font-semibold text-sm mb-4">{title}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>
    </div>
  )
}

export default function DocumentUploadPage() {
  const { token } = useParams<{ token: string }>()
  const [activeTab, setActiveTab] = useState<'documents' | 'personal'>('documents')

  const [uploadedTypes, setUploadedTypes] = useState<Set<string>>(new Set())
  const [uploadingType, setUploadingType] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: info, isLoading, error: loadError } = useQuery({
    queryKey: ['document-request-info', token],
    queryFn: () => getDocumentRequestInfo(token!),
    enabled: !!token,
    retry: false,
  })

  const { data: existingDetails } = useQuery({
    queryKey: ['personal-details', token],
    queryFn: () => getPersonalDetails(token!),
    enabled: !!token,
    retry: false,
  })

  const [details, setDetails] = useState<PersonalDetails>({})
  const [detailsSaveState, setDetailsSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const [alreadySubmittedDetails, setAlreadySubmittedDetails] = useState(false)

  useEffect(() => {
    if (existingDetails) {
      setDetails(existingDetails)
      setAlreadySubmittedDetails(!!existingDetails.submitted_at)
    }
  }, [existingDetails])

  function updateDetails<K extends keyof PersonalDetails>(key: K, value: PersonalDetails[K]) {
    setDetails((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSaveProgress() {
    if (!token) return
    setDetailsSaveState('saving')
    setDetailsError(null)
    try {
      await savePersonalDetails(token, details, false)
      setDetailsSaveState('saved')
    } catch (err: any) {
      setDetailsSaveState('error')
      setDetailsError(getErrorMessage(err, 'Could not save. Please try again.'))
    }
  }

  async function handleFinalSubmit() {
    if (!token) return
    setDetailsSaveState('saving')
    setDetailsError(null)
    try {
      await savePersonalDetails(token, details, true)
      setDetailsSaveState('saved')
      setAlreadySubmittedDetails(true)
    } catch (err: any) {
      setDetailsSaveState('error')
      setDetailsError(getErrorMessage(err, 'Could not submit. Please try again.'))
    }
  }

  async function handleUpload(documentType: string, file: File) {
    if (!token) return
    setUploadingType(documentType)
    setError(null)
    try {
      await uploadCandidateDocument(token, documentType, file)
      setUploadedTypes((prev) => new Set(prev).add(documentType))
    } catch (err: any) {
      setError(getErrorMessage(err, 'Upload failed. Please try again.'))
    } finally {
      setUploadingType(null)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-500 text-sm">Loading…</div>
      </div>
    )
  }

  if (loadError || !info) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
        <div className="text-center">
          <div className="text-3xl mb-3">🔍</div>
          <h1 className="text-white text-lg font-semibold">Link not found or expired</h1>
          <p className="text-gray-500 text-sm mt-1">
            Please contact your HR team for a new link.
          </p>
        </div>
      </div>
    )
  }

  const alreadySubmittedTypes = new Set(info.already_submitted.map((d) => d.document_type))

  return (
    <div className="min-h-screen bg-gray-950 px-4 py-10">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl
                          bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 mb-3">
            <span className="text-white font-bold text-xl">iB</span>
          </div>
          <h1 className="text-white text-xl font-bold">Welcome, {info.candidate_name}</h1>
          <p className="text-gray-500 text-sm mt-1">
            Please complete the steps below for {info.client_name} at {info.company_name}.
          </p>
        </div>

        <div className="flex gap-2 mb-6 justify-center">
          <button
            onClick={() => setActiveTab('documents')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'documents'
                ? 'bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 text-white'
                : 'bg-gray-900 text-gray-400 hover:text-white border border-gray-800'
            }`}
          >
            📄 Documents
          </button>
          <button
            onClick={() => setActiveTab('personal')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'personal'
                ? 'bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 text-white'
                : 'bg-gray-900 text-gray-400 hover:text-white border border-gray-800'
            }`}
          >
            📝 Personal & Bank Details
          </button>
        </div>

        {activeTab === 'documents' && (
          <>
            {error && (
              <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm mb-4">
                {error}
              </div>
            )}

            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-3">
              {DOCUMENT_TYPES.map((docType) => {
                const submitted = uploadedTypes.has(docType.value) || alreadySubmittedTypes.has(docType.value)
                const uploading = uploadingType === docType.value

                return (
                  <div
                    key={docType.value}
                    className="flex items-center justify-between bg-gray-800/50 rounded-lg px-4 py-3"
                  >
                    <div>
                      <span className="text-white text-sm">{docType.label}</span>
                      {docType.templateUrl && !submitted && (
                        <div>
                          <a
                            href={docType.templateUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-purple-400 hover:text-purple-300 text-xs"
                          >
                            ⬇ Download blank form, fill & sign, then upload here
                          </a>
                        </div>
                      )}
                    </div>
                    {submitted ? (
                      <span className="text-green-400 text-xs font-medium">✓ Submitted</span>
                    ) : (
                      <label className="cursor-pointer">
                        <span className="text-xs px-3 py-1.5 rounded-lg font-medium text-white
                                         bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500
                                         hover:opacity-90 transition-opacity">
                          {uploading ? 'Uploading…' : 'Choose File'}
                        </span>
                        <input
                          type="file"
                          className="hidden"
                          disabled={uploading}
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) handleUpload(docType.value, file)
                          }}
                        />
                      </label>
                    )}
                  </div>
                )
              })}
            </div>

            <p className="text-gray-600 text-xs text-center mt-4">
              You can return to this link anytime to submit additional documents.
            </p>
          </>
        )}

        {activeTab === 'personal' && (
          <div className="space-y-5">
            {alreadySubmittedDetails && (
              <div className="bg-green-900/30 border border-green-800 rounded-lg px-4 py-3 text-green-300 text-sm">
                ✓ Submitted. You can still update anything below — changes are saved automatically when you click Save or Submit again.
              </div>
            )}
            {detailsError && (
              <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">
                {detailsError}
              </div>
            )}

            <SectionCard title="Personal Details">
              <Field label="Name (as per PAN)">
                <input value={details.name_as_per_pan ?? ''} onChange={(e) => updateDetails('name_as_per_pan', e.target.value)} className={inputClass} />
              </Field>
              <Field label="Contact Number">
                <input value={details.contact_number ?? ''} onChange={(e) => updateDetails('contact_number', e.target.value)} className={inputClass} />
              </Field>
              <Field label="Date of Birth">
                <input type="date" value={details.date_of_birth ?? ''} onChange={(e) => updateDetails('date_of_birth', e.target.value)} className={inputClass} />
              </Field>
              <Field label="Blood Group">
                <input value={details.blood_group ?? ''} onChange={(e) => updateDetails('blood_group', e.target.value)} placeholder="e.g. O+" className={inputClass} />
              </Field>
              <Field label="Father's Name">
                <input value={details.fathers_name ?? ''} onChange={(e) => updateDetails('fathers_name', e.target.value)} className={inputClass} />
              </Field>
              <Field label="Mother's Name">
                <input value={details.mothers_name ?? ''} onChange={(e) => updateDetails('mothers_name', e.target.value)} className={inputClass} />
              </Field>
              <Field label="Emergency Contact Name">
                <input value={details.emergency_contact_name ?? ''} onChange={(e) => updateDetails('emergency_contact_name', e.target.value)} className={inputClass} />
              </Field>
              <Field label="Emergency Contact Relation">
                <input value={details.emergency_contact_relation ?? ''} onChange={(e) => updateDetails('emergency_contact_relation', e.target.value)} className={inputClass} />
              </Field>
              <Field label="Emergency Contact Mobile">
                <input value={details.emergency_contact_mobile ?? ''} onChange={(e) => updateDetails('emergency_contact_mobile', e.target.value)} className={inputClass} />
              </Field>
              <Field label="Aadhaar Number">
                <input value={details.aadhaar_number ?? ''} onChange={(e) => updateDetails('aadhaar_number', e.target.value)} className={inputClass} />
              </Field>
              <Field label="PAN Number">
                <input value={details.pan_number ?? ''} onChange={(e) => updateDetails('pan_number', e.target.value)} className={inputClass} />
              </Field>
              <Field label="PF UAN Number (if any)">
                <input value={details.pf_uan_number ?? ''} onChange={(e) => updateDetails('pf_uan_number', e.target.value)} className={inputClass} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Temporary Address">
                  <textarea value={details.temporary_address ?? ''} onChange={(e) => updateDetails('temporary_address', e.target.value)} rows={2} className={inputClass} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Permanent Address">
                  <textarea value={details.permanent_address ?? ''} onChange={(e) => updateDetails('permanent_address', e.target.value)} rows={2} className={inputClass} />
                </Field>
              </div>
            </SectionCard>

            <SectionCard title="Bank Details">
              <Field label="Full Name (as per Bank)">
                <input value={details.bank_account_holder_name ?? ''} onChange={(e) => updateDetails('bank_account_holder_name', e.target.value)} className={inputClass} />
              </Field>
              <Field label="Bank Name">
                <input value={details.bank_name ?? ''} onChange={(e) => updateDetails('bank_name', e.target.value)} className={inputClass} />
              </Field>
              <Field label="Account Number">
                <input value={details.bank_account_number ?? ''} onChange={(e) => updateDetails('bank_account_number', e.target.value)} className={inputClass} />
              </Field>
              <Field label="IFSC Code">
                <input value={details.bank_ifsc_code ?? ''} onChange={(e) => updateDetails('bank_ifsc_code', e.target.value)} className={inputClass} />
              </Field>
              <Field label="Branch Name">
                <input value={details.bank_branch_name ?? ''} onChange={(e) => updateDetails('bank_branch_name', e.target.value)} className={inputClass} />
              </Field>
            </SectionCard>

            <SectionCard title="Insurance & Dependents">
              <Field label="Insurance Option">
                <select value={details.insurance_option ?? ''} onChange={(e) => updateDetails('insurance_option', e.target.value as 'self' | 'family')} className={inputClass}>
                  <option value="">Select…</option>
                  <option value="self">Self Only</option>
                  <option value="family">Self + Family</option>
                </select>
              </Field>
              <Field label="Marital Status">
                <select value={details.marital_status ?? ''} onChange={(e) => updateDetails('marital_status', e.target.value as 'married' | 'unmarried')} className={inputClass}>
                  <option value="">Select…</option>
                  <option value="married">Married</option>
                  <option value="unmarried">Unmarried</option>
                </select>
              </Field>
              {details.insurance_option === 'family' && (
                <>
                  <Field label="Spouse's Name">
                    <input value={details.spouse_name ?? ''} onChange={(e) => updateDetails('spouse_name', e.target.value)} className={inputClass} />
                  </Field>
                  <Field label="Spouse's DOB">
                    <input type="date" value={details.spouse_dob ?? ''} onChange={(e) => updateDetails('spouse_dob', e.target.value)} className={inputClass} />
                  </Field>
                  <Field label="First Child's Name">
                    <input value={details.child_1_name ?? ''} onChange={(e) => updateDetails('child_1_name', e.target.value)} className={inputClass} />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Gender">
                      <input value={details.child_1_gender ?? ''} onChange={(e) => updateDetails('child_1_gender', e.target.value)} className={inputClass} />
                    </Field>
                    <Field label="DOB">
                      <input type="date" value={details.child_1_dob ?? ''} onChange={(e) => updateDetails('child_1_dob', e.target.value)} className={inputClass} />
                    </Field>
                  </div>
                  <Field label="Second Child's Name">
                    <input value={details.child_2_name ?? ''} onChange={(e) => updateDetails('child_2_name', e.target.value)} className={inputClass} />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Gender">
                      <input value={details.child_2_gender ?? ''} onChange={(e) => updateDetails('child_2_gender', e.target.value)} className={inputClass} />
                    </Field>
                    <Field label="DOB">
                      <input type="date" value={details.child_2_dob ?? ''} onChange={(e) => updateDetails('child_2_dob', e.target.value)} className={inputClass} />
                    </Field>
                  </div>
                </>
              )}
            </SectionCard>

            <SectionCard title="Statutory Details">
              <Field label="Nationality">
                <input value={details.nationality ?? ''} onChange={(e) => updateDetails('nationality', e.target.value)} className={inputClass} />
              </Field>
              <Field label="Qualification">
                <input value={details.qualification ?? ''} onChange={(e) => updateDetails('qualification', e.target.value)} className={inputClass} />
              </Field>
              <Field label="Previous PF Member ID (if any)">
                <input value={details.previous_pf_member_id ?? ''} onChange={(e) => updateDetails('previous_pf_member_id', e.target.value)} className={inputClass} />
              </Field>
              <label className="flex items-center gap-2 text-gray-300 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={details.is_international_worker ?? false}
                  onChange={(e) => updateDetails('is_international_worker', e.target.checked)}
                />
                I am an International Worker
              </label>
              {details.is_international_worker && (
                <>
                  <Field label="Country of Origin">
                    <input value={details.country_of_origin ?? ''} onChange={(e) => updateDetails('country_of_origin', e.target.value)} className={inputClass} />
                  </Field>
                  <Field label="Passport Number">
                    <input value={details.passport_number ?? ''} onChange={(e) => updateDetails('passport_number', e.target.value)} className={inputClass} />
                  </Field>
                  <Field label="Passport Valid From">
                    <input type="date" value={details.passport_valid_from ?? ''} onChange={(e) => updateDetails('passport_valid_from', e.target.value)} className={inputClass} />
                  </Field>
                  <Field label="Passport Valid To">
                    <input type="date" value={details.passport_valid_to ?? ''} onChange={(e) => updateDetails('passport_valid_to', e.target.value)} className={inputClass} />
                  </Field>
                </>
              )}
              <div className="sm:col-span-2 space-y-2">
                <p className="text-gray-400 text-xs">Disability status (for statutory records only)</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ['has_physical_handicap', 'Physical Handicap'],
                    ['has_locomotive_disability', 'Locomotive'],
                    ['has_hearing_disability', 'Hearing'],
                    ['has_visual_disability', 'Visual'],
                  ].map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 text-gray-300 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={(details as any)[key] ?? false}
                        onChange={(e) => updateDetails(key as keyof PersonalDetails, e.target.checked as any)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            </SectionCard>

            <div className="flex items-center justify-between gap-3 pb-6">
              <div className="text-xs">
                {detailsSaveState === 'saving' && <span className="text-gray-400">Saving…</span>}
                {detailsSaveState === 'saved' && <span className="text-green-400">✓ Saved</span>}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleSaveProgress}
                  disabled={detailsSaveState === 'saving'}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-gray-300 bg-gray-800
                             hover:bg-gray-700 transition-colors disabled:opacity-50"
                >
                  Save Progress
                </button>
                <button
                  onClick={handleFinalSubmit}
                  disabled={detailsSaveState === 'saving'}
                  className="px-5 py-2 rounded-lg text-sm font-semibold text-white
                             bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500
                             hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {alreadySubmittedDetails ? 'Update & Submit' : 'Submit'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
