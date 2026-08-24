import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  getPublicFormData,
  submitOfferRequest,
  sendAmVerificationCode,
  resolveClientHr,
  type OfferRequestPayload,
} from '@/lib/publicApi'
import { getErrorMessage } from '@/lib/errors'

type SubmitState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'unrouted'; message: string }
  | { status: 'success'; referenceId: string }
  | { status: 'error'; message: string }

const emptyForm: OfferRequestPayload = {
  account_manager_id: '',
  recruiter_id: '',
  client_name: '',
  full_name: '',
  email: '',
  phone: '',
  designation: '',
  department: '',
  work_location: '',
  proposed_ctc: undefined,
  expected_doj: '',
  pf_type: 'standard',
  verification_code: '',
}

export default function PublicOfferForm() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>()
  const [form, setForm] = useState<OfferRequestPayload>(emptyForm)
  const [submitState, setSubmitState] = useState<SubmitState>({ status: 'idle' })
  const [selectedHrId, setSelectedHrId] = useState('')
  const [resolvedHrName, setResolvedHrName] = useState<string | null>(null)
  const [hasManuallyChangedHr, setHasManuallyChangedHr] = useState(false)

  useEffect(() => {
    if (!tenantSlug || !form.client_name.trim()) {
      setResolvedHrName(null)
      return
    }
    const timeout = setTimeout(async () => {
      try {
        const result = await resolveClientHr(tenantSlug, form.client_name)
        setResolvedHrName(result.hr_name)
        // Only auto-fill the picker if the AM hasn't deliberately chosen
        // someone else already — a real override should stick, not get
        // silently replaced as they keep typing the client name.
        if (result.hr_id && !hasManuallyChangedHr) {
          setSelectedHrId(result.hr_id)
        }
      } catch {
        setResolvedHrName(null)
      }
    }, 500)
    return () => clearTimeout(timeout)
  }, [tenantSlug, form.client_name, hasManuallyChangedHr])

  const [codeSentTo, setCodeSentTo] = useState<string | null>(null)
  const [demoCode, setDemoCode] = useState<string | null>(null)
  const [codeSendError, setCodeSendError] = useState<string | null>(null)
  const [isSendingCode, setIsSendingCode] = useState(false)
  const [showConfirmStep, setShowConfirmStep] = useState(false)
  const [confirmChecked, setConfirmChecked] = useState(false)

  async function handleSendCode() {
    if (!tenantSlug || !form.account_manager_id) return
    setIsSendingCode(true)
    setCodeSendError(null)
    try {
      const result = await sendAmVerificationCode(tenantSlug, form.account_manager_id)
      setCodeSentTo(result.sent_to_email_ending_in)
      if (result.demo_code) {
        setDemoCode(result.demo_code)
        update('verification_code', result.demo_code)
      } else {
        setDemoCode(null)
      }
    } catch (err: any) {
      setCodeSendError(getErrorMessage(err, 'Could not send verification code. Please try again.'))
    } finally {
      setIsSendingCode(false)
    }
  }

  const { data: formData, isLoading, error: loadError } = useQuery({
    queryKey: ['public-form-data', tenantSlug],
    queryFn: () => getPublicFormData(tenantSlug!),
    enabled: !!tenantSlug,
    retry: false,
  })

  function update<K extends keyof OfferRequestPayload>(key: K, value: OfferRequestPayload[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent, hrOverrideId?: string) {
    e.preventDefault()
    if (!tenantSlug) return
    setSubmitState({ status: 'submitting' })

    try {
      const payload = {
        ...form,
        recruiter_id: form.recruiter_id || undefined,
        proposed_ctc: form.proposed_ctc || undefined,
        expected_doj: form.expected_doj || undefined,
      }
      const result = await submitOfferRequest(tenantSlug, payload, hrOverrideId)

      if (result.status === 'unrouted') {
        setSubmitState({ status: 'unrouted', message: result.message })
        // The code just used got consumed by that attempt (even though it
        // didn't create anything) — the retry-with-HR-override below needs
        // a genuinely fresh one, not a reuse of the same spent code.
        update('verification_code', '')
        setCodeSentTo(null)
      } else {
        setSubmitState({ status: 'success', referenceId: result.reference_id ?? '' })
      }
    } catch (err: any) {
      setSubmitState({
        status: 'error',
        message: getErrorMessage(err, 'Something went wrong. Please try again.'),
      })
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-500 text-sm">Loading…</div>
      </div>
    )
  }

  if (loadError || !formData) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
        <div className="text-center">
          <div className="text-3xl mb-3">🔍</div>
          <h1 className="text-white text-lg font-semibold">Portal not found</h1>
          <p className="text-gray-500 text-sm mt-1">
            Check the link you were given, or contact your HR team.
          </p>
        </div>
      </div>
    )
  }

  if (submitState.status === 'success') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <div className="text-4xl mb-4">✅</div>
          <h1 className="text-white text-xl font-semibold">Request Submitted</h1>
          <p className="text-gray-400 text-sm mt-2">
            Your offer request has been submitted. The HR team has been notified.
          </p>
          {submitState.referenceId && (
            <p className="text-gray-600 text-xs mt-4">Reference: {submitState.referenceId}</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 px-4 py-10">
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl
                          bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 mb-3">
            <span className="text-white font-bold text-xl">iB</span>
          </div>
          <h1 className="text-white text-xl font-bold">New Offer Request</h1>
          <p className="text-gray-500 text-sm mt-1">Fill this in to raise a new candidate offer.</p>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); setShowConfirmStep(true) }}
          className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4"
        >
          {submitState.status === 'error' && (
            <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">
              {submitState.message}
            </div>
          )}

          <Field label="Your Name (Account Manager) *">
            <select
              required
              value={form.account_manager_id}
              onChange={(e) => {
                update('account_manager_id', e.target.value)
                update('verification_code', '')
                setCodeSentTo(null)
                setDemoCode(null)
                setCodeSendError(null)
              }}
              className={inputClass}
            >
              <option value="">Select your name…</option>
              {formData.account_managers.map((am) => (
                <option key={am.id} value={am.id}>{am.name}</option>
              ))}
            </select>
          </Field>

          {form.account_manager_id && (
            <Field label="Verify it's you">
              {!codeSentTo ? (
                <button
                  type="button"
                  onClick={handleSendCode}
                  disabled={isSendingCode}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-gray-800
                             hover:bg-gray-700 transition-colors disabled:opacity-50"
                >
                  {isSendingCode ? 'Sending…' : '📧 Send verification code to my email'}
                </button>
              ) : (
                <div>
                  {demoCode ? (
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 mb-2">
                      <p className="text-amber-300 text-xs">
                        ⚠️ Demo mode — email sending isn't fully set up yet, so the code is shown
                        here instead of being emailed. This won't happen once real email is configured.
                      </p>
                      <p className="text-white text-lg font-mono font-bold tracking-widest mt-1">{demoCode}</p>
                    </div>
                  ) : (
                    <p className="text-gray-400 text-xs mb-2">
                      Code sent to your registered email ending in {codeSentTo}.
                    </p>
                  )}
                  <input
                    required
                    value={form.verification_code}
                    onChange={(e) => update('verification_code', e.target.value)}
                    placeholder="Enter the 6-digit code"
                    maxLength={6}
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={handleSendCode}
                    disabled={isSendingCode}
                    className="text-purple-400 hover:text-purple-300 text-xs mt-1"
                  >
                    {isSendingCode ? 'Sending…' : 'Resend code'}
                  </button>
                </div>
              )}
              {codeSendError && <p className="text-red-400 text-xs mt-1">{codeSendError}</p>}
            </Field>
          )}

          <Field label="Recruiter">
            <select
              value={form.recruiter_id}
              onChange={(e) => update('recruiter_id', e.target.value)}
              className={inputClass}
            >
              <option value="">Select recruiter…</option>
              {formData.recruiters.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </Field>

          <Field label="Client Name *">
            <input
              required
              list="known-clients"
              value={form.client_name}
              onChange={(e) => update('client_name', e.target.value)}
              placeholder="e.g. Deloitte USI"
              className={inputClass}
            />
            <datalist id="known-clients">
              {formData.known_clients.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>

          <Field label="Release Offer From *">
            <select
              required
              value={selectedHrId}
              onChange={(e) => {
                setSelectedHrId(e.target.value)
                setHasManuallyChangedHr(true)
              }}
              className={inputClass}
            >
              <option value="">Select HR…</option>
              {formData.hr_users.map((hr) => (
                <option key={hr.id} value={hr.id}>{hr.name}</option>
              ))}
            </select>
            {resolvedHrName && !hasManuallyChangedHr && (
              <p className="text-gray-500 text-xs mt-1">
                Auto-selected based on "{form.client_name}" — change it above if this isn't right.
              </p>
            )}
            {form.client_name.trim() && !resolvedHrName && (
              <p className="text-amber-400 text-xs mt-1">
                "{form.client_name}" isn't in our records yet — please pick the right HR manually.
              </p>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Candidate Name *">
              <input
                required
                value={form.full_name}
                onChange={(e) => update('full_name', e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Email *">
              <input
                required
                type="email"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone">
              <input
                value={form.phone}
                onChange={(e) => update('phone', e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Designation">
              <input
                value={form.designation}
                onChange={(e) => update('designation', e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Department">
              <input
                value={form.department}
                onChange={(e) => update('department', e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Work Location">
              <input
                value={form.work_location}
                onChange={(e) => update('work_location', e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Proposed CTC (annual)">
              <input
                type="number"
                value={form.proposed_ctc ?? ''}
                onChange={(e) => update('proposed_ctc', e.target.value ? Number(e.target.value) : undefined)}
                className={inputClass}
              />
            </Field>
            <Field label="Expected DOJ">
              <input
                type="date"
                value={form.expected_doj}
                onChange={(e) => update('expected_doj', e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>

          <Field label="PF Type">
            <select
              value={form.pf_type}
              onChange={(e) => update('pf_type', e.target.value as 'standard' | 'max' | 'none')}
              className={inputClass}
            >
              <option value="standard">Standard (capped as per statutory limit)</option>
              <option value="max">Max PF (full 12%, no cap)</option>
              <option value="none">No PF</option>
            </select>
          </Field>

          <button
            type="submit"
            disabled={submitState.status === 'submitting'}
            className="w-full py-2.5 rounded-lg font-semibold text-white mt-2
                       bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500
                       hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {submitState.status === 'submitting' ? 'Submitting…' : 'Submit Request'}
          </button>
        </form>

        {submitState.status === 'unrouted' && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-5 mt-4">
            <p className="text-amber-300 text-sm mb-3">{submitState.message}</p>
            <select
              value={selectedHrId}
              onChange={(e) => setSelectedHrId(e.target.value)}
              className={inputClass + ' mb-3'}
            >
              <option value="">Select an HR…</option>
              {formData.hr_users.map((hr) => (
                <option key={hr.id} value={hr.id}>{hr.name}</option>
              ))}
            </select>
            <button
              disabled={!selectedHrId}
              onClick={(e) => handleSubmit(e, selectedHrId)}
              className="w-full py-2.5 rounded-lg font-semibold text-white
                         bg-amber-600 hover:bg-amber-500 transition-colors disabled:opacity-50"
            >
              Submit to Selected HR
            </button>
          </div>
        )}

        {showConfirmStep && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6">
              <h2 className="text-white text-lg font-bold mb-1">Review Before Submitting</h2>
              <p className="text-gray-500 text-sm mb-4">
                Please check every detail carefully — this is what will be used to generate the
                actual offer letter.
              </p>

              <div className="bg-gray-800/60 rounded-lg p-4 space-y-2 mb-5 text-sm">
                <SummaryRow label="Candidate Name" value={form.full_name} />
                <SummaryRow label="Email" value={form.email} />
                <SummaryRow label="Phone" value={form.phone} />
                <SummaryRow label="Client" value={form.client_name} />
                <SummaryRow
                  label="Release Offer From"
                  value={formData.hr_users.find((hr) => hr.id === selectedHrId)?.name}
                />
                <SummaryRow label="Designation" value={form.designation} />
                <SummaryRow label="Department" value={form.department} />
                <SummaryRow label="Work Location" value={form.work_location} />
                <SummaryRow
                  label="Proposed CTC"
                  value={form.proposed_ctc ? `₹${form.proposed_ctc.toLocaleString('en-IN')}` : undefined}
                />
                <SummaryRow label="Expected DOJ" value={form.expected_doj} />
                <SummaryRow
                  label="PF Type"
                  value={{ standard: 'Standard', max: 'Max PF', none: 'No PF' }[form.pf_type]}
                />
              </div>

              <label className="flex items-start gap-2 text-gray-300 text-sm mb-5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmChecked}
                  onChange={(e) => setConfirmChecked(e.target.checked)}
                  className="mt-0.5"
                />
                <span>I confirm every detail above is accurate and complete.</span>
              </label>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowConfirmStep(false)}
                  className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white"
                >
                  Back &amp; Edit
                </button>
                <button
                  type="button"
                  disabled={!confirmChecked || submitState.status === 'submitting'}
                  onClick={async (e) => {
                    await handleSubmit(e, selectedHrId || undefined)
                    setShowConfirmStep(false)
                    setConfirmChecked(false)
                  }}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-white
                             bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500
                             hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {submitState.status === 'submitting' ? 'Submitting…' : 'Submit Request'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div className="flex justify-between gap-4">
      <span className="text-gray-500">{label}</span>
      <span className="text-white text-right">{value}</span>
    </div>
  )
}

const inputClass =
  'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white ' +
  'placeholder-gray-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-gray-300 text-xs font-medium">{label}</label>
      {children}
    </div>
  )
}
