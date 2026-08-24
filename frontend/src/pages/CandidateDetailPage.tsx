import { useParams, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import AppShell from '@/components/layout/AppShell'
import StageBadge from '@/components/ui/StageBadge'
import { getCandidate, getCandidateEvents, releaseOffer, getLetterDownloadUrl, getCandidateNotifications,
  confirmJoining, suggestEmployeeId, assignEmployeeId, releaseAppointment,
  logResignation, markClearanceReceived, releaseRelieving,
  reviseOffer, getHikeHistory, releaseHike,
  listCandidateDocuments, getDocumentDownloadUrl, resendDocumentLink,
  updateCandidate, deleteCandidateRequest, rejectOffer,
  type CandidateUpdateInput } from '@/lib/candidates'
import { listCtcStructures } from '@/lib/ctcStructures'
import { getErrorMessage } from '@/lib/errors'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function formatCurrency(amount: number | null): string {
  if (amount === null) return '—'
  return `₹${amount.toLocaleString('en-IN')}`
}

const EVENT_LABELS: Record<string, string> = {
  request_raised: 'Request Raised',
  offer_released: 'Offer Letter Released',
  offer_revised: 'Offer Letter Revised',
  joining_confirmed: 'Joining Confirmed',
  employee_id_assigned: 'Employee ID Assigned',
  appointment_released: 'Appointment Letter Released',
  documents_link_sent: 'Document Request Link Sent',
  documents_submitted: 'Documents Submitted',
  hike_released: 'Hike Letter Released',
  resignation_logged: 'Resignation Logged',
  lwd_set: 'Last Working Day Set',
  clearance_received: 'Clearance Received',
  relieving_released: 'Relieving Letter Released',
  rejected: 'Rejected',
  note_added: 'Note Added',
}

export default function CandidateDetailPage() {
  const { candidateId } = useParams<{ candidateId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [releaseError, setReleaseError] = useState<string | null>(null)
  const [selectedCtcStructureId, setSelectedCtcStructureId] = useState('')
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const { data: candidate, isLoading, error } = useQuery({
    queryKey: ['candidate', candidateId],
    queryFn: () => getCandidate(candidateId!),
    enabled: !!candidateId,
  })

  const { data: events } = useQuery({
    queryKey: ['candidate-events', candidateId],
    queryFn: () => getCandidateEvents(candidateId!),
    enabled: !!candidateId,
  })

  const { data: notifications } = useQuery({
    queryKey: ['candidate-notifications', candidateId],
    queryFn: () => getCandidateNotifications(candidateId!),
    enabled: !!candidateId,
  })

  const { data: documents } = useQuery({
    queryKey: ['candidate-documents', candidateId],
    queryFn: () => listCandidateDocuments(candidateId!),
    enabled: !!candidateId,
  })

  const resendLinkMutation = useMutation({
    mutationFn: () => resendDocumentLink(candidateId!),
  })

  const [documentDownloadError, setDocumentDownloadError] = useState<string | null>(null)

  async function handleDocumentDownload(documentId: string) {
    if (!candidateId) return
    try {
      setDocumentDownloadError(null)
      const url = await getDocumentDownloadUrl(candidateId, documentId)
      window.open(url, '_blank')
    } catch (err: any) {
      setDocumentDownloadError(getErrorMessage(err, 'Could not get the download link.'))
    }
  }

  // Offer letters commonly include a CTC breakup table — if the tenant's
  // active Offer Letter template needs one, HR picks which structure to
  // use right before releasing (structures are per-location, so a Super
  // User might have several to choose from; HR typically sees just their
  // own location's).
  const { data: ctcStructures } = useQuery({
    queryKey: ['ctc-structures', candidate?.location_id],
    queryFn: () => listCtcStructures(candidate?.location_id),
    enabled: candidate?.stage === 'requested' || candidate?.stage === 'id_assigned'
      || candidate?.stage === 'offered' || candidate?.stage === 'revised',
  })

  const releaseMutation = useMutation({
    mutationFn: () => releaseOffer(candidateId!, selectedCtcStructureId || undefined),
    onSuccess: () => {
      setReleaseError(null)
      queryClient.invalidateQueries({ queryKey: ['candidate', candidateId] })
      queryClient.invalidateQueries({ queryKey: ['candidate-events', candidateId] })
      queryClient.invalidateQueries({ queryKey: ['candidates'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] })
    },
    onError: (err: any) => {
      setReleaseError(getErrorMessage(err, 'Could not release the offer. Please try again.'))
    },
  })

  const [confirmedDoj, setConfirmedDoj] = useState('')
  const [employeeIdInput, setEmployeeIdInput] = useState('')
  const [nextActionError, setNextActionError] = useState<string | null>(null)

  function invalidateAfterAction() {
    setNextActionError(null)
    queryClient.invalidateQueries({ queryKey: ['candidate', candidateId] })
    queryClient.invalidateQueries({ queryKey: ['candidate-events', candidateId] })
    queryClient.invalidateQueries({ queryKey: ['candidate-notifications', candidateId] })
    queryClient.invalidateQueries({ queryKey: ['candidates'] })
    queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] })
  }

  const [showEditForm, setShowEditForm] = useState(false)
  const [editForm, setEditForm] = useState<CandidateUpdateInput>({})

  const updateMutation = useMutation({
    mutationFn: () => updateCandidate(candidateId!, editForm),
    onSuccess: () => {
      invalidateAfterAction()
      setShowEditForm(false)
      setEditForm({})
    },
    onError: (err: any) => setNextActionError(getErrorMessage(err, 'Could not save changes.')),
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteCandidateRequest(candidateId!),
    onSuccess: () => navigate('/recruitment'),
    onError: (err: any) => setNextActionError(getErrorMessage(err, 'Could not delete this request.')),
  })

  const rejectMutation = useMutation({
    mutationFn: () => rejectOffer(candidateId!, rejectReason || undefined, rejectNotifyCandidate),
    onSuccess: () => {
      invalidateAfterAction()
      setShowRejectModal(false)
      setRejectReason('')
      setRejectNotifyCandidate(false)
    },
    onError: (err: any) => setNextActionError(getErrorMessage(err, 'Could not reject this offer.')),
  })

  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [rejectNotifyCandidate, setRejectNotifyCandidate] = useState(false)

  function startEditing() {
    if (!candidate) return
    setEditForm({
      full_name: candidate.full_name, email: candidate.email, phone: candidate.phone ?? '',
      client_name: candidate.client_name, designation: candidate.designation ?? '',
      department: candidate.department ?? '', work_location: candidate.work_location ?? '',
      proposed_ctc: candidate.proposed_ctc ?? undefined,
      expected_doj: candidate.expected_doj ?? '',
    })
    setShowEditForm(true)
  }

  const confirmJoiningMutation = useMutation({
    mutationFn: () => confirmJoining(candidateId!, confirmedDoj),
    onSuccess: invalidateAfterAction,
    onError: (err: any) => setNextActionError(getErrorMessage(err, 'Could not confirm joining.')),
  })

  // Fetch a suggested Employee ID as soon as the candidate reaches 'joined'
  // stage, matching the desktop app's "editable suggestion, never forced"
  // pattern — the field is always overridable before the admin confirms.
  useQuery({
    queryKey: ['suggested-employee-id', candidateId],
    queryFn: async () => {
      const suggestion = await suggestEmployeeId(candidateId!)
      setEmployeeIdInput(suggestion)
      return suggestion
    },
    enabled: candidate?.stage === 'joined' && !employeeIdInput,
  })

  const assignIdMutation = useMutation({
    mutationFn: () => assignEmployeeId(candidateId!, employeeIdInput),
    onSuccess: invalidateAfterAction,
    onError: (err: any) => setNextActionError(getErrorMessage(err, 'Could not assign Employee ID.')),
  })

  const releaseAppointmentMutation = useMutation({
    mutationFn: () => releaseAppointment(candidateId!, selectedCtcStructureId || undefined),
    onSuccess: invalidateAfterAction,
    onError: (err: any) => setNextActionError(getErrorMessage(err, 'Could not release the appointment letter.')),
  })

  const [resignationDate, setResignationDate] = useState('')
  const [lastWorkingDay, setLastWorkingDay] = useState('')
  const [clearanceDate, setClearanceDate] = useState('')

  const logResignationMutation = useMutation({
    mutationFn: () => logResignation(candidateId!, resignationDate, lastWorkingDay),
    onSuccess: invalidateAfterAction,
    onError: (err: any) => setNextActionError(getErrorMessage(err, 'Could not log the resignation.')),
  })

  const markClearanceMutation = useMutation({
    mutationFn: () => markClearanceReceived(candidateId!, clearanceDate),
    onSuccess: invalidateAfterAction,
    onError: (err: any) => setNextActionError(getErrorMessage(err, 'Could not mark clearance received.')),
  })

  const releaseRelievingMutation = useMutation({
    mutationFn: () => releaseRelieving(candidateId!),
    onSuccess: invalidateAfterAction,
    onError: (err: any) => setNextActionError(getErrorMessage(err, 'Could not release the relieving letter.')),
  })

  const [showReviseForm, setShowReviseForm] = useState(false)
  const [revisedCtcInput, setRevisedCtcInput] = useState('')
  const [revisedDojInput, setRevisedDojInput] = useState('')

  const reviseOfferMutation = useMutation({
    mutationFn: () =>
      reviseOffer(
        candidateId!,
        {
          proposed_ctc: revisedCtcInput ? Number(revisedCtcInput) : undefined,
          expected_doj: revisedDojInput || undefined,
        },
        selectedCtcStructureId || undefined
      ),
    onSuccess: () => {
      invalidateAfterAction()
      setShowReviseForm(false)
    },
    onError: (err: any) => setNextActionError(getErrorMessage(err, 'Could not revise the offer.')),
  })

  const [showHikeForm, setShowHikeForm] = useState(false)
  const [hikeCtcInput, setHikeCtcInput] = useState('')
  const [hikeEffectiveDate, setHikeEffectiveDate] = useState('')

  const { data: hikeHistory } = useQuery({
    queryKey: ['hike-history', candidateId],
    queryFn: () => getHikeHistory(candidateId!),
    enabled: candidate?.stage === 'active',
  })

  const releaseHikeMutation = useMutation({
    mutationFn: () => releaseHike(candidateId!, Number(hikeCtcInput), hikeEffectiveDate),
    onSuccess: () => {
      invalidateAfterAction()
      queryClient.invalidateQueries({ queryKey: ['hike-history', candidateId] })
      setShowHikeForm(false)
      setHikeCtcInput('')
      setHikeEffectiveDate('')
    },
    onError: (err: any) => setNextActionError(getErrorMessage(err, 'Could not release the hike letter.')),
  })

  async function handleDownload(field: 'offer_letter_path' | 'appointment_letter_path' | 'relieving_letter_path') {
    if (!candidateId) return
    try {
      setDownloadError(null)
      const url = await getLetterDownloadUrl(candidateId, field)
      window.open(url, '_blank')
    } catch (err: any) {
      setDownloadError(getErrorMessage(err, 'Could not get the download link. Please try again.'))
    }
  }

  if (isLoading) {
    return (
      <AppShell>
        <div className="p-8 text-center text-gray-500">Loading…</div>
      </AppShell>
    )
  }

  if (error || !candidate) {
    return (
      <AppShell>
        <div className="p-8 max-w-3xl mx-auto text-center py-16">
          <div className="text-3xl mb-2">🔍</div>
          <div className="text-white font-medium">Candidate not found</div>
          <button
            onClick={() => navigate('/recruitment')}
            className="mt-4 text-purple-400 text-sm hover:text-purple-300"
          >
            ← Back to Tracker
          </button>
        </div>
      </AppShell>
    )
  }

  const fields: { label: string; value: string }[] = [
    { label: 'Email', value: candidate.email },
    { label: 'Phone', value: candidate.phone ?? '—' },
    { label: 'Department', value: candidate.department ?? '—' },
    { label: 'Work Location', value: candidate.work_location ?? '—' },
    { label: 'Proposed CTC', value: formatCurrency(candidate.proposed_ctc) },
    { label: 'Expected DOJ', value: formatDate(candidate.expected_doj) },
    { label: 'Confirmed DOJ', value: formatDate(candidate.confirmed_doj) },
    { label: 'Employee ID', value: candidate.employee_id ?? '—' },
  ]

  return (
    <AppShell>
      <div className="p-8 max-w-4xl mx-auto">
        <button
          onClick={() => navigate('/recruitment')}
          className="text-gray-500 text-sm hover:text-white mb-4 transition-colors"
        >
          ← Back to Tracker
        </button>

        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">{candidate.full_name}</h1>
            <p className="text-gray-500 text-sm mt-1">
              {candidate.designation ?? 'No designation'} · {candidate.client_name}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <StageBadge stage={candidate.stage} />
            {candidate.stage === 'requested' && (
              <>
                <button
                  onClick={startEditing}
                  className="px-3 py-2 rounded-lg text-xs font-medium text-gray-300 bg-gray-800
                             hover:bg-gray-700 transition-colors"
                >
                  ✏️ Edit
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Permanently delete this request for ${candidate.full_name}? This cannot be undone.`)) {
                      deleteMutation.mutate()
                    }
                  }}
                  disabled={deleteMutation.isPending}
                  className="px-3 py-2 rounded-lg text-xs font-medium text-red-400 bg-gray-800
                             hover:bg-red-900/40 transition-colors disabled:opacity-50"
                >
                  🗑 Delete
                </button>
                {!!ctcStructures?.length && (
                  <select
                    value={selectedCtcStructureId}
                    onChange={(e) => setSelectedCtcStructureId(e.target.value)}
                    className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-xs text-white"
                  >
                    <option value="">No CTC table</option>
                    {ctcStructures.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                )}
                <button
                  onClick={() => releaseMutation.mutate()}
                  disabled={releaseMutation.isPending}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-white
                             bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500
                             hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {releaseMutation.isPending ? 'Releasing…' : 'Release Offer'}
                </button>
              </>
            )}
            {(candidate.stage === 'offered' || candidate.stage === 'revised') && (
              <>
                <button
                  onClick={() => setShowReviseForm((v) => !v)}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-gray-300 bg-gray-800
                             hover:bg-gray-700 transition-colors"
                >
                  ✏️ Revise Offer
                </button>
                <button
                  onClick={() => setShowRejectModal(true)}
                  disabled={rejectMutation.isPending}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-red-400 bg-gray-800
                             hover:bg-red-900/40 transition-colors disabled:opacity-50"
                >
                  ✕ Reject Offer
                </button>
              </>
            )}
            {candidate.offer_letter_path && (
              <button
                onClick={() => handleDownload('offer_letter_path')}
                className="px-3 py-2 rounded-lg text-xs font-medium text-gray-300 bg-gray-800
                           hover:bg-gray-700 transition-colors"
              >
                📄 Offer Letter
              </button>
            )}
            {candidate.appointment_letter_path && (
              <button
                onClick={() => handleDownload('appointment_letter_path')}
                className="px-3 py-2 rounded-lg text-xs font-medium text-gray-300 bg-gray-800
                           hover:bg-gray-700 transition-colors"
              >
                📄 Appointment Letter
              </button>
            )}
            {candidate.relieving_letter_path && (
              <button
                onClick={() => handleDownload('relieving_letter_path')}
                className="px-3 py-2 rounded-lg text-xs font-medium text-gray-300 bg-gray-800
                           hover:bg-gray-700 transition-colors"
              >
                📄 Relieving Letter
              </button>
            )}
          </div>
        </div>

        {downloadError && (
          <div className="bg-red-900/30 border border-red-800 rounded-xl px-5 py-4 text-red-300 text-sm mb-6">
            {downloadError}
          </div>
        )}

        {releaseError && (
          <div className="bg-red-900/30 border border-red-800 rounded-xl px-5 py-4 text-red-300 text-sm mb-6">
            {releaseError}
          </div>
        )}

        {releaseMutation.isSuccess && (
          <div className="bg-green-900/30 border border-green-800 rounded-xl px-5 py-4 text-green-300 text-sm mb-6">
            Offer released — the Account Manager, HR, and Leadership have been notified.
          </div>
        )}

        {nextActionError && (
          <div className="bg-red-900/30 border border-red-800 rounded-xl px-5 py-4 text-red-300 text-sm mb-6">
            {nextActionError}
          </div>
        )}

        {(candidate.stage === 'offered' || candidate.stage === 'revised') && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-6">
            <h2 className="text-white font-semibold text-sm mb-3">Confirm Joining</h2>
            <div className="flex items-end gap-3">
              <div>
                <label className="text-gray-500 text-xs block mb-1">Confirmed Date of Joining</label>
                <input
                  type="date"
                  value={confirmedDoj}
                  onChange={(e) => setConfirmedDoj(e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>
              <button
                onClick={() => confirmJoiningMutation.mutate()}
                disabled={!confirmedDoj || confirmJoiningMutation.isPending}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white
                           bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500
                           hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {confirmJoiningMutation.isPending ? 'Confirming…' : 'Confirm Joining'}
              </button>
            </div>
          </div>
        )}

        {candidate.stage === 'joined' && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-6">
            <h2 className="text-white font-semibold text-sm mb-3">Assign Employee ID</h2>
            <p className="text-gray-500 text-xs mb-3">
              Suggested from the shared ID series — edit if this location uses a different one.
            </p>
            <div className="flex items-end gap-3">
              <input
                value={employeeIdInput}
                onChange={(e) => setEmployeeIdInput(e.target.value)}
                placeholder="e.g. IB-NOI-1042"
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white
                           font-mono w-56"
              />
              <button
                onClick={() => assignIdMutation.mutate()}
                disabled={!employeeIdInput || assignIdMutation.isPending}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white
                           bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500
                           hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {assignIdMutation.isPending ? 'Assigning…' : 'Assign ID'}
              </button>
            </div>
          </div>
        )}

        {candidate.stage === 'id_assigned' && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-6">
            <h2 className="text-white font-semibold text-sm mb-3">Release Appointment Letter</h2>
            <p className="text-gray-500 text-xs mb-3">
              Employee ID: <span className="font-mono text-white">{candidate.employee_id}</span>
            </p>
            <div className="flex items-end gap-3">
              {!!ctcStructures?.length && (
                <select
                  value={selectedCtcStructureId}
                  onChange={(e) => setSelectedCtcStructureId(e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white"
                >
                  <option value="">No CTC table</option>
                  {ctcStructures.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              )}
              <button
                onClick={() => releaseAppointmentMutation.mutate()}
                disabled={releaseAppointmentMutation.isPending}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white
                           bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500
                           hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {releaseAppointmentMutation.isPending ? 'Releasing…' : 'Release Appointment Letter'}
              </button>
            </div>
          </div>
        )}

        {releaseAppointmentMutation.isSuccess && (
          <div className="bg-green-900/30 border border-green-800 rounded-xl px-5 py-4 text-green-300 text-sm mb-6">
            Appointment letter released — the candidate is now active, and a document submission
            link has been sent to them.
          </div>
        )}

        {candidate.stage === 'active' && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-6">
            <h2 className="text-white font-semibold text-sm mb-3">Log Resignation / Layoff</h2>
            <div className="flex items-end gap-3 flex-wrap">
              <div>
                <label className="text-gray-500 text-xs block mb-1">Resignation Date</label>
                <input
                  type="date" value={resignationDate}
                  onChange={(e) => setResignationDate(e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">Last Working Day</label>
                <input
                  type="date" value={lastWorkingDay}
                  onChange={(e) => setLastWorkingDay(e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>
              <button
                onClick={() => logResignationMutation.mutate()}
                disabled={!resignationDate || !lastWorkingDay || logResignationMutation.isPending}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white
                           bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500
                           hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {logResignationMutation.isPending ? 'Logging…' : 'Log Resignation'}
              </button>
            </div>
            <p className="text-gray-600 text-xs mt-2">
              The employee will be emailed a confirmation of their Last Working Day.
            </p>
          </div>
        )}

        {candidate.stage === 'resigned' && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-6 space-y-4">
            <div>
              <h2 className="text-white font-semibold text-sm mb-1">Exit Processing</h2>
              <p className="text-gray-500 text-xs">
                Last Working Day: <span className="text-white">{formatDate(candidate.last_working_day)}</span>
              </p>
            </div>

            {!candidate.clearance_received ? (
              <div className="flex items-end gap-3">
                <div>
                  <label className="text-gray-500 text-xs block mb-1">Clearance Received Date</label>
                  <input
                    type="date" value={clearanceDate}
                    onChange={(e) => setClearanceDate(e.target.value)}
                    className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
                <button
                  onClick={() => markClearanceMutation.mutate()}
                  disabled={!clearanceDate || markClearanceMutation.isPending}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-white
                             bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500
                             hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {markClearanceMutation.isPending ? 'Saving…' : 'Mark Clearance Received'}
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-green-400 text-sm">
                  ✓ Clearance received on {formatDate(candidate.clearance_date)}
                </span>
                <button
                  onClick={() => releaseRelievingMutation.mutate()}
                  disabled={releaseRelievingMutation.isPending}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-white
                             bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500
                             hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {releaseRelievingMutation.isPending ? 'Releasing…' : 'Release Relieving Letter'}
                </button>
              </div>
            )}
          </div>
        )}

        {releaseRelievingMutation.isSuccess && (
          <div className="bg-green-900/30 border border-green-800 rounded-xl px-5 py-4 text-green-300 text-sm mb-6">
            Relieving letter released — the candidate's record is now closed out.
          </div>
        )}

        {showReviseForm && (candidate.stage === 'offered' || candidate.stage === 'revised') && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-6">
            <h2 className="text-white font-semibold text-sm mb-3">Revise Offer</h2>
            <p className="text-gray-500 text-xs mb-3">
              Leave a field blank to keep its current value. This overwrites the current offer
              and tags the record "Revised".
            </p>
            <div className="flex items-end gap-3 flex-wrap">
              <div>
                <label className="text-gray-500 text-xs block mb-1">New CTC (optional)</label>
                <input
                  type="number" value={revisedCtcInput}
                  onChange={(e) => setRevisedCtcInput(e.target.value)}
                  placeholder={String(candidate.proposed_ctc ?? '')}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white w-40"
                />
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">New Expected DOJ (optional)</label>
                <input
                  type="date" value={revisedDojInput}
                  onChange={(e) => setRevisedDojInput(e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>
              <button
                onClick={() => reviseOfferMutation.mutate()}
                disabled={reviseOfferMutation.isPending}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white
                           bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500
                           hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {reviseOfferMutation.isPending ? 'Revising…' : 'Submit Revision'}
              </button>
            </div>
          </div>
        )}

        {candidate.stage === 'active' && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-white font-semibold text-sm">Hike Letters</h2>
              <button
                onClick={() => setShowHikeForm((v) => !v)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-white
                           bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500
                           hover:opacity-90 transition-opacity"
              >
                + New Hike
              </button>
            </div>

            {showHikeForm && (
              <div className="flex items-end gap-3 flex-wrap mb-4 bg-gray-800/40 rounded-lg p-3">
                <div>
                  <label className="text-gray-500 text-xs block mb-1">Revised CTC</label>
                  <input
                    type="number" value={hikeCtcInput}
                    onChange={(e) => setHikeCtcInput(e.target.value)}
                    className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white w-40"
                  />
                </div>
                <div>
                  <label className="text-gray-500 text-xs block mb-1">Effective Date</label>
                  <input
                    type="date" value={hikeEffectiveDate}
                    onChange={(e) => setHikeEffectiveDate(e.target.value)}
                    className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
                <button
                  onClick={() => releaseHikeMutation.mutate()}
                  disabled={!hikeCtcInput || !hikeEffectiveDate || releaseHikeMutation.isPending}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-white
                             bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500
                             hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {releaseHikeMutation.isPending ? 'Releasing…' : 'Release Hike Letter'}
                </button>
              </div>
            )}

            {!hikeHistory?.length && (
              <div className="text-gray-600 text-sm py-2">No hikes recorded yet.</div>
            )}
            {!!hikeHistory?.length && (
              <div className="space-y-2">
                {hikeHistory.map((h) => (
                  <div key={h.id} className="flex items-center justify-between bg-gray-800/40 rounded-lg px-4 py-2 text-sm">
                    <span className="text-white">
                      ₹{h.previous_ctc.toLocaleString('en-IN')} → ₹{h.revised_ctc.toLocaleString('en-IN')}
                    </span>
                    <span className="text-gray-500 text-xs">Effective {formatDate(h.effective_date)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {showEditForm && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-6">
            <h2 className="text-white font-semibold text-sm mb-3">Edit Request</h2>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-gray-500 text-xs block mb-1">Candidate Name</label>
                <input
                  value={editForm.full_name ?? ''}
                  onChange={(e) => setEditForm((f) => ({ ...f, full_name: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">Email</label>
                <input
                  value={editForm.email ?? ''}
                  onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">Phone</label>
                <input
                  value={editForm.phone ?? ''}
                  onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">Client</label>
                <input
                  value={editForm.client_name ?? ''}
                  onChange={(e) => setEditForm((f) => ({ ...f, client_name: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">Designation</label>
                <input
                  value={editForm.designation ?? ''}
                  onChange={(e) => setEditForm((f) => ({ ...f, designation: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">Department</label>
                <input
                  value={editForm.department ?? ''}
                  onChange={(e) => setEditForm((f) => ({ ...f, department: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">Work Location</label>
                <input
                  value={editForm.work_location ?? ''}
                  onChange={(e) => setEditForm((f) => ({ ...f, work_location: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">Proposed CTC</label>
                <input
                  type="number"
                  value={editForm.proposed_ctc ?? ''}
                  onChange={(e) => setEditForm((f) => ({ ...f, proposed_ctc: e.target.value ? Number(e.target.value) : undefined }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">Expected DOJ</label>
                <input
                  type="date"
                  value={editForm.expected_doj ?? ''}
                  onChange={(e) => setEditForm((f) => ({ ...f, expected_doj: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setShowEditForm(false); setEditForm({}) }}
                className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={() => updateMutation.mutate()}
                disabled={updateMutation.isPending}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white
                           bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500
                           hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        )}

        {showRejectModal && candidate && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6">
              <h2 className="text-white text-lg font-bold mb-1">Reject Offer</h2>
              <p className="text-gray-500 text-sm mb-4">
                This moves {candidate.full_name} to a final "Rejected" status. The Account Manager,
                HR, and Leadership are always notified.
              </p>
              <label className="text-gray-500 text-xs block mb-1">Reason (optional)</label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={2}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white mb-3"
              />
              <label className="flex items-center gap-2 text-gray-300 text-sm mb-5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rejectNotifyCandidate}
                  onChange={(e) => setRejectNotifyCandidate(e.target.checked)}
                />
                Also email the candidate directly
              </label>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => { setShowRejectModal(false); setRejectReason(''); setRejectNotifyCandidate(false) }}
                  className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={() => rejectMutation.mutate()}
                  disabled={rejectMutation.isPending}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-red-600
                             hover:bg-red-500 transition-colors disabled:opacity-50"
                >
                  {rejectMutation.isPending ? 'Rejecting…' : 'Confirm Reject'}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-x-8 gap-y-4 bg-gray-900 border border-gray-800
                        rounded-2xl p-6 mb-6">
          {fields.map((f) => (
            <div key={f.label}>
              <div className="text-gray-500 text-xs uppercase tracking-wide mb-1">{f.label}</div>
              <div className="text-white text-sm">{f.value}</div>
            </div>
          ))}
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <h2 className="text-white font-semibold text-sm mb-4">History</h2>

          {!events?.length && (
            <div className="text-gray-600 text-sm py-4 text-center">No events recorded yet.</div>
          )}

          {!!events?.length && (
            <div className="space-y-4">
              {events.map((event, i) => (
                <div key={event.id} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className="w-2 h-2 rounded-full bg-purple-500 mt-1.5" />
                    {i < events.length - 1 && <div className="w-px flex-1 bg-gray-800 mt-1" />}
                  </div>
                  <div className="pb-4">
                    <div className="text-white text-sm font-medium">
                      {EVENT_LABELS[event.event_type] ?? event.event_type}
                    </div>
                    <div className="text-gray-500 text-xs mt-0.5">{formatDateTime(event.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mt-6">
          <h2 className="text-white font-semibold text-sm mb-4">Notifications Sent</h2>

          {!notifications?.length && (
            <div className="text-gray-600 text-sm py-4 text-center">No notifications sent yet.</div>
          )}

          {!!notifications?.length && (
            <div className="space-y-3">
              {notifications.map((n) => (
                <div key={n.id} className="flex items-start justify-between bg-gray-800/40 rounded-lg px-4 py-3">
                  <div>
                    <div className="text-white text-sm">{n.subject}</div>
                    <div className="text-gray-500 text-xs mt-1">
                      To: {n.recipients.map((r) => r.name || r.email).join(', ')}
                    </div>
                    <div className="text-gray-600 text-xs mt-0.5">{formatDateTime(n.sent_at)}</div>
                  </div>
                  <span
                    className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ml-3 ${
                      n.status === 'sent'
                        ? 'bg-green-500/20 text-green-300'
                        : 'bg-red-500/20 text-red-300'
                    }`}
                  >
                    {n.status === 'sent' ? '✓ Sent' : '✕ Failed'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mt-6">
          <div className="flex items-start justify-between mb-1">
            <h2 className="text-white font-semibold text-sm">Documents</h2>
            <button
              onClick={() => resendLinkMutation.mutate()}
              disabled={resendLinkMutation.isPending}
              className="text-purple-400 hover:text-purple-300 text-xs disabled:opacity-50"
            >
              {resendLinkMutation.isPending ? 'Sending…' : '↻ Resend Document Link'}
            </button>
          </div>
          {resendLinkMutation.isSuccess && (
            <p className="text-green-400 text-xs mb-2">Link resent to the candidate's email.</p>
          )}
          {resendLinkMutation.isError && (
            <p className="text-red-400 text-xs mb-2">
              {getErrorMessage(resendLinkMutation.error, 'Could not resend the link.')}
            </p>
          )}
          <p className="text-gray-500 text-xs mb-4">
            Submitted by the candidate through their document link. Originals stay available
            here permanently, even after being included in a yearly backup.
          </p>

          {documentDownloadError && (
            <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-2 text-red-300 text-xs mb-3">
              {documentDownloadError}
            </div>
          )}

          {!documents?.length && (
            <div className="text-gray-600 text-sm py-4 text-center">No documents submitted yet.</div>
          )}

          {!!documents?.length && (
            <div className="space-y-2">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between bg-gray-800/40 rounded-lg px-4 py-3"
                >
                  <div>
                    <div className="text-white text-sm">{doc.original_name}</div>
                    <div className="text-gray-500 text-xs mt-0.5">
                      {doc.document_type} · Uploaded {formatDateTime(doc.uploaded_at)}
                      {doc.financial_year && ` · FY ${doc.financial_year}`}
                      {doc.is_archived && ' · ✓ Backed up'}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDocumentDownload(doc.id)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-300 bg-gray-700
                               hover:bg-gray-600 transition-colors"
                  >
                    Download
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
