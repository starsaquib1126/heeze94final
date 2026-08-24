import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import AppShell from '@/components/layout/AppShell'
import StageBadge from '@/components/ui/StageBadge'
import { listCandidates } from '@/lib/candidates'

type ViewFilter = 'active' | 'exited' | 'all'

const FILTERS: { key: ViewFilter; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'exited', label: 'Exited' },
  { key: 'all', label: 'All (Active + Exited)' },
]

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function EmployeesPage() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<ViewFilter>('active')
  const [search, setSearch] = useState('')

  // Employees are candidates who made it to 'active' (or later, 'exited') —
  // reusing the same tracker data rather than a separate table, since a
  // converted employee's full history (offer, appointment, hikes) already
  // lives on their candidate record.
  const { data: activeData, isLoading: loadingActive } = useQuery({
    queryKey: ['candidates', 'active', search],
    queryFn: () => listCandidates({ stage: 'active', search: search.trim() || undefined }),
    enabled: filter === 'active' || filter === 'all',
  })
  const { data: exitedData, isLoading: loadingExited } = useQuery({
    queryKey: ['candidates', 'exited', search],
    queryFn: () => listCandidates({ stage: 'exited', search: search.trim() || undefined }),
    enabled: filter === 'exited' || filter === 'all',
  })

  const employees = [
    ...(filter === 'active' || filter === 'all' ? activeData ?? [] : []),
    ...(filter === 'exited' || filter === 'all' ? exitedData ?? [] : []),
  ]
  const isLoading = loadingActive || loadingExited

  return (
    <AppShell>
      <div className="p-8 max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">Employees</h1>
          <p className="text-gray-500 text-sm mt-1">Everyone who's made it through the pipeline.</p>
        </div>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, or client..."
          className="w-full bg-gray-900 border border-gray-800 rounded-lg px-4 py-2.5 mb-4
                     text-white placeholder-gray-500 focus:outline-none focus:border-purple-500
                     focus:ring-1 focus:ring-purple-500"
        />

        <div className="flex flex-wrap gap-2 mb-6">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filter === f.key
                  ? 'bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 text-white'
                  : 'bg-gray-900 text-gray-400 hover:text-white border border-gray-800'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          {isLoading && <div className="text-gray-500 text-sm py-10 text-center">Loading…</div>}

          {!isLoading && !employees.length && (
            <div className="py-16 text-center">
              <div className="text-3xl mb-2">🧑‍💼</div>
              <div className="text-white font-medium">No employees found</div>
              <div className="text-gray-500 text-sm mt-1">
                Employees appear here once a candidate's Appointment Letter is released.
              </div>
            </div>
          )}

          {!!employees.length && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-500 text-xs uppercase tracking-wide">
                  <th className="text-left font-medium px-5 py-3">Employee</th>
                  <th className="text-left font-medium px-5 py-3">Employee ID</th>
                  <th className="text-left font-medium px-5 py-3">Client</th>
                  <th className="text-left font-medium px-5 py-3">Designation</th>
                  <th className="text-left font-medium px-5 py-3">DOJ</th>
                  <th className="text-left font-medium px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {employees.map((e) => (
                  <tr
                    key={e.id}
                    onClick={() => navigate(`/recruitment/${e.id}`)}
                    className="cursor-pointer hover:bg-gray-800/50 transition-colors"
                  >
                    <td className="px-5 py-3">
                      <div className="text-white font-medium">{e.full_name}</div>
                      <div className="text-gray-500 text-xs">{e.email}</div>
                    </td>
                    <td className="px-5 py-3 text-gray-300 font-mono">{e.employee_id ?? '—'}</td>
                    <td className="px-5 py-3 text-gray-300">{e.client_name}</td>
                    <td className="px-5 py-3 text-gray-300">{e.designation ?? '—'}</td>
                    <td className="px-5 py-3 text-gray-300">{formatDate(e.confirmed_doj)}</td>
                    <td className="px-5 py-3">
                      <StageBadge stage={e.stage} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {!!employees.length && (
          <div className="text-gray-600 text-xs mt-3">
            {employees.length} employee{employees.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </AppShell>
  )
}
