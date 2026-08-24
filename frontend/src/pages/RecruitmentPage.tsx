import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import AppShell from '@/components/layout/AppShell'
import StageBadge from '@/components/ui/StageBadge'
import { listCandidates, exportCandidates, createCandidateDirect, STAGE_LABELS,
  type CandidateStage, type HRCandidateCreateInput } from '@/lib/candidates'
import { listAccountManagers, listRecruiters, listLocations } from '@/lib/admin'
import { getErrorMessage } from '@/lib/errors'
import { useAuthStore } from '@/store/authStore'

const TABS: { label: string; stage: CandidateStage | 'all' }[] = [
  { label: 'All', stage: 'all' },
  { label: 'Requested', stage: 'requested' },
  { label: 'Offered', stage: 'offered' },
  { label: 'Joined', stage: 'joined' },
  { label: 'ID Assigned', stage: 'id_assigned' },
  { label: 'Active', stage: 'active' },
  { label: 'Rejected', stage: 'rejected' },
  { label: 'Exited', stage: 'exited' },
]

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function RecruitmentPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const [searchParams] = useSearchParams()
  const initialStage = (() => {
    const fromUrl = searchParams.get('stage')
    return TABS.some((t) => t.stage === fromUrl) ? (fromUrl as CandidateStage | 'all') : 'all'
  })()
  const [activeTab, setActiveTab] = useState<CandidateStage | 'all'>(initialStage)
  const [search, setSearch] = useState('')
  const [showExportPanel, setShowExportPanel] = useState(false)
  const [exportDateFrom, setExportDateFrom] = useState('')
  const [exportDateTo, setExportDateTo] = useState('')

  const [showNewCandidateForm, setShowNewCandidateForm] = useState(false)
  const [newCandidate, setNewCandidate] = useState<HRCandidateCreateInput>({ client_name: '', full_name: '', email: '' })
  const [newCandidateLocationId, setNewCandidateLocationId] = useState('')
  const [newCandidateError, setNewCandidateError] = useState<string | null>(null)

  const needsLocationPicker = user?.role === 'super_user'
  const { data: locations } = useQuery({
    queryKey: ['locations'], queryFn: listLocations, enabled: needsLocationPicker && showNewCandidateForm,
  })
  const { data: accountManagers } = useQuery({
    queryKey: ['account-managers'], queryFn: listAccountManagers, enabled: showNewCandidateForm,
  })
  const { data: recruiters } = useQuery({
    queryKey: ['recruiters'], queryFn: listRecruiters, enabled: showNewCandidateForm,
  })

  const createCandidateMutation = useMutation({
    mutationFn: () => createCandidateDirect(
      newCandidate, needsLocationPicker ? newCandidateLocationId : undefined
    ),
    onSuccess: (candidate) => {
      queryClient.invalidateQueries({ queryKey: ['candidates'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] })
      navigate(`/recruitment/${candidate.id}`)
    },
    onError: (err: any) => setNewCandidateError(getErrorMessage(err, 'Could not create this request.')),
  })

  const { data, isLoading, error } = useQuery({
    queryKey: ['candidates', activeTab, search],
    queryFn: () =>
      listCandidates({
        stage: activeTab === 'all' ? undefined : activeTab,
        search: search.trim() || undefined,
      }),
  })

  const exportMutation = useMutation({
    mutationFn: () =>
      exportCandidates({
        stage: activeTab === 'all' ? undefined : activeTab,
        date_from: exportDateFrom || undefined,
        date_to: exportDateTo || undefined,
      }),
    onSuccess: () => setShowExportPanel(false),
  })

  return (
    <AppShell>
      <div className="p-8 max-w-6xl mx-auto">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Recruitment Tracker</h1>
            <p className="text-gray-500 text-sm mt-1">Every candidate, from request through exit.</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setShowNewCandidateForm((v) => !v)}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white
                         bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500
                         hover:opacity-90 transition-opacity"
            >
              + New Candidate
            </button>
            <button
              onClick={() => setShowExportPanel((v) => !v)}
              className="px-4 py-2 rounded-lg text-sm font-medium text-gray-300 bg-gray-800
                         hover:bg-gray-700 transition-colors"
            >
              📊 Export to Excel
            </button>
          </div>
        </div>

        {showNewCandidateForm && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-4">
            <h2 className="text-white font-semibold text-sm mb-1">New Candidate Request</h2>
            <p className="text-gray-500 text-xs mb-4">
              For internal hires, walk-ins, or anything with no external Account Manager involved —
              this skips the public offer-request link entirely.
            </p>
            {newCandidateError && (
              <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-2 text-red-300 text-xs mb-3">
                {newCandidateError}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 mb-4">
              {needsLocationPicker && (
                <div>
                  <label className="text-gray-500 text-xs block mb-1">Location</label>
                  <select
                    value={newCandidateLocationId}
                    onChange={(e) => setNewCandidateLocationId(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                  >
                    <option value="">Select…</option>
                    {locations?.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="text-gray-500 text-xs block mb-1">Candidate Name *</label>
                <input
                  value={newCandidate.full_name}
                  onChange={(e) => setNewCandidate((f) => ({ ...f, full_name: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">Email *</label>
                <input
                  type="email"
                  value={newCandidate.email}
                  onChange={(e) => setNewCandidate((f) => ({ ...f, email: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">Phone</label>
                <input
                  value={newCandidate.phone ?? ''}
                  onChange={(e) => setNewCandidate((f) => ({ ...f, phone: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">Client *</label>
                <input
                  value={newCandidate.client_name}
                  onChange={(e) => setNewCandidate((f) => ({ ...f, client_name: e.target.value }))}
                  placeholder="e.g. iBridge Techsoft (internal hire)"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">Designation</label>
                <input
                  value={newCandidate.designation ?? ''}
                  onChange={(e) => setNewCandidate((f) => ({ ...f, designation: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">Department</label>
                <input
                  value={newCandidate.department ?? ''}
                  onChange={(e) => setNewCandidate((f) => ({ ...f, department: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">Work Location</label>
                <input
                  value={newCandidate.work_location ?? ''}
                  onChange={(e) => setNewCandidate((f) => ({ ...f, work_location: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">Proposed CTC</label>
                <input
                  type="number"
                  value={newCandidate.proposed_ctc ?? ''}
                  onChange={(e) => setNewCandidate((f) => ({ ...f, proposed_ctc: e.target.value ? Number(e.target.value) : undefined }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">Expected DOJ</label>
                <input
                  type="date"
                  value={newCandidate.expected_doj ?? ''}
                  onChange={(e) => setNewCandidate((f) => ({ ...f, expected_doj: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">Account Manager (optional)</label>
                <select
                  value={newCandidate.account_manager_id ?? ''}
                  onChange={(e) => setNewCandidate((f) => ({ ...f, account_manager_id: e.target.value || undefined }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                >
                  <option value="">None — internal hire</option>
                  {accountManagers?.map((am) => <option key={am.id} value={am.id}>{am.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">Recruiter (optional)</label>
                <select
                  value={newCandidate.recruiter_id ?? ''}
                  onChange={(e) => setNewCandidate((f) => ({ ...f, recruiter_id: e.target.value || undefined }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                >
                  <option value="">None</option>
                  {recruiters?.map((r) => <option key={r.id} value={r.id}>{r.full_name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowNewCandidateForm(false)}
                className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={() => createCandidateMutation.mutate()}
                disabled={
                  !newCandidate.full_name || !newCandidate.email || !newCandidate.client_name ||
                  (needsLocationPicker && !newCandidateLocationId) || createCandidateMutation.isPending
                }
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white
                           bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500
                           hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {createCandidateMutation.isPending ? 'Creating…' : 'Create Request'}
              </button>
            </div>
          </div>
        )}

        {showExportPanel && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 mb-4">
            <div className="flex items-end gap-3">
              <div>
                <label className="text-gray-500 text-xs block mb-1">From</label>
                <input
                  type="date"
                  value={exportDateFrom}
                  onChange={(e) => setExportDateFrom(e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white"
                />
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">To</label>
                <input
                  type="date"
                  value={exportDateTo}
                  onChange={(e) => setExportDateTo(e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white"
                />
              </div>
              <div className="text-gray-500 text-xs pb-2">
                Stage filter: {activeTab === 'all' ? 'All stages' : STAGE_LABELS[activeTab]}
                <span className="text-gray-600"> (matches the tab selected below)</span>
              </div>
              <button
                onClick={() => exportMutation.mutate()}
                disabled={exportMutation.isPending}
                className="ml-auto px-4 py-2 rounded-lg text-sm font-semibold text-white
                           bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500
                           hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {exportMutation.isPending ? 'Exporting…' : 'Download'}
              </button>
            </div>
            {exportMutation.isError && (
              <div className="text-red-400 text-xs mt-2">Could not export. Please try again.</div>
            )}
          </div>
        )}

        {/* Search */}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, or client..."
          className="w-full bg-gray-900 border border-gray-800 rounded-lg px-4 py-2.5 mb-4
                     text-white placeholder-gray-500 focus:outline-none focus:border-purple-500
                     focus:ring-1 focus:ring-purple-500"
        />

        {/* Stage tabs */}
        <div className="flex flex-wrap gap-2 mb-6">
          {TABS.map((tab) => (
            <button
              key={tab.stage}
              onClick={() => setActiveTab(tab.stage)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.stage
                  ? 'bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 text-white'
                  : 'bg-gray-900 text-gray-400 hover:text-white border border-gray-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-800 rounded-xl px-5 py-4 text-red-300 text-sm mb-6">
            Couldn't load candidates. Try refreshing.
          </div>
        )}

        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          {isLoading && <div className="text-gray-500 text-sm py-10 text-center">Loading…</div>}

          {!isLoading && !data?.length && (
            <div className="py-16 text-center">
              <div className="text-3xl mb-2">📋</div>
              <div className="text-white font-medium">No candidates found</div>
              <div className="text-gray-500 text-sm mt-1">
                {search ? 'Try a different search.' : 'New requests will show up here.'}
              </div>
            </div>
          )}

          {!!data?.length && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-500 text-xs uppercase tracking-wide">
                  <th className="text-left font-medium px-5 py-3">Candidate</th>
                  <th className="text-left font-medium px-5 py-3">Client</th>
                  <th className="text-left font-medium px-5 py-3">Designation</th>
                  <th className="text-left font-medium px-5 py-3">Expected DOJ</th>
                  <th className="text-left font-medium px-5 py-3">Stage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {data.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => navigate(`/recruitment/${c.id}`)}
                    className="cursor-pointer hover:bg-gray-800/50 transition-colors"
                  >
                    <td className="px-5 py-3">
                      <div className="text-white font-medium">{c.full_name}</div>
                      <div className="text-gray-500 text-xs">{c.email}</div>
                    </td>
                    <td className="px-5 py-3 text-gray-300">{c.client_name}</td>
                    <td className="px-5 py-3 text-gray-300">{c.designation ?? '—'}</td>
                    <td className="px-5 py-3 text-gray-300">{formatDate(c.expected_doj)}</td>
                    <td className="px-5 py-3">
                      <StageBadge stage={c.stage} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {!!data?.length && (
          <div className="text-gray-600 text-xs mt-3">
            {data.length} candidate{data.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </AppShell>
  )
}
