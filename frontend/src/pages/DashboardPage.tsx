import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import AppShell from '@/components/layout/AppShell'
import StageBadge from '@/components/ui/StageBadge'
import { getDashboardSummary, getAnalytics, type CandidateStage } from '@/lib/candidates'
import { useAuthStore } from '@/store/authStore'

const STAT_CARDS: { stage: CandidateStage; label: string; color: string; hex: string }[] = [
  { stage: 'requested', label: 'New Requests', color: 'from-blue-500 to-blue-600', hex: '#3b82f6' },
  { stage: 'offered', label: 'Offered', color: 'from-purple-500 to-purple-600', hex: '#a855f7' },
  { stage: 'joined', label: 'Joined', color: 'from-teal-500 to-teal-600', hex: '#14b8a6' },
  { stage: 'active', label: 'Active Employees', color: 'from-green-500 to-green-600', hex: '#22c55e' },
]

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function DashboardPage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()

  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: getDashboardSummary,
  })

  const { data: analytics } = useQuery({
    queryKey: ['analytics'],
    queryFn: () => getAnalytics(),
  })

  return (
    <AppShell>
      <div className="p-8 max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">
            {user?.role === 'super_user' ? 'All Locations' : 'Dashboard'}
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            {user?.role === 'super_user'
              ? 'Overview across every location in your company.'
              : 'Overview for your location.'}
          </p>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-800 rounded-xl px-5 py-4 text-red-300 text-sm mb-6">
            Couldn't load the dashboard. Try refreshing.
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {STAT_CARDS.map((card) => (
            <button
              key={card.stage}
              onClick={() => navigate(`/recruitment?stage=${card.stage}`)}
              className="bg-gray-900 border border-gray-800 rounded-2xl p-5 text-left
                         hover:border-purple-500/50 hover:bg-gray-800/70 transition-colors cursor-pointer"
            >
              <div
                className={`w-9 h-9 rounded-lg bg-gradient-to-br ${card.color}
                            flex items-center justify-center text-white text-sm font-bold mb-3`}
              >
                {(data?.stage_counts[card.stage] ?? 0).toString().slice(0, 3)}
              </div>
              <div className="text-2xl font-bold text-white">
                {isLoading ? '—' : data?.stage_counts[card.stage] ?? 0}
              </div>
              <div className="text-gray-500 text-sm mt-0.5">{card.label}</div>
            </button>
          ))}
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-8">
          <h2 className="text-white font-semibold text-sm mb-4">Pipeline</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={STAT_CARDS.map((c) => ({ label: c.label, count: data?.stage_counts[c.stage] ?? 0, stage: c.stage, hex: c.hex }))}
              margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: '#71717a', fontSize: 12 }} axisLine={{ stroke: '#3f3f46' }} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fill: '#71717a', fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip
                cursor={{ fill: '#27272a' }}
                contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, color: '#fff' }}
              />
              <Bar
                dataKey="count"
                radius={[6, 6, 0, 0]}
                cursor="pointer"
                onClick={(entry: any) => navigate(`/recruitment?stage=${entry.stage}`)}
              >
                {STAT_CARDS.map((c) => <Cell key={c.stage} fill={c.hex} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-8">
          <h2 className="text-white font-semibold text-sm mb-4">Analytics — All Time</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div>
              <div className="text-2xl font-bold text-white">{analytics?.requests_raised ?? '—'}</div>
              <div className="text-gray-500 text-xs mt-0.5">Requests Raised</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-white">{analytics?.offers_released ?? '—'}</div>
              <div className="text-gray-500 text-xs mt-0.5">Offers Released</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-white">{analytics?.joined ?? '—'}</div>
              <div className="text-gray-500 text-xs mt-0.5">Joined</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-white">{analytics?.rejected ?? '—'}</div>
              <div className="text-gray-500 text-xs mt-0.5">Rejected</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-white">
                {analytics?.offer_to_joining_rate != null ? `${analytics.offer_to_joining_rate}%` : '—'}
              </div>
              <div className="text-gray-500 text-xs mt-0.5">Offer → Joining Rate</div>
            </div>
          </div>
        </div>

        {!!data?.joining_today.length && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-5 mb-6">
            <h2 className="text-amber-300 font-semibold text-sm mb-3">
              ⏰ Joining Today ({data.joining_today.length})
            </h2>
            <div className="space-y-2">
              {data.joining_today.map((c) => (
                <button
                  key={c.id}
                  onClick={() => navigate(`/recruitment/${c.id}`)}
                  className="w-full flex items-center justify-between bg-gray-900/60 hover:bg-gray-900
                             rounded-lg px-4 py-3 text-left transition-colors"
                >
                  <div>
                    <div className="text-white text-sm font-medium">{c.full_name}</div>
                    <div className="text-gray-500 text-xs">{c.client_name}</div>
                  </div>
                  <StageBadge stage={c.stage} />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h2 className="text-white font-semibold text-sm mb-4">Upcoming Joinings (next 7 days)</h2>

          {isLoading && <div className="text-gray-500 text-sm py-6 text-center">Loading…</div>}

          {!isLoading && !data?.upcoming_joinings.length && (
            <div className="text-gray-600 text-sm py-6 text-center">No joinings expected this week.</div>
          )}

          {!!data?.upcoming_joinings.length && (
            <div className="divide-y divide-gray-800">
              {data.upcoming_joinings.map((c) => (
                <button
                  key={c.id}
                  onClick={() => navigate(`/recruitment/${c.id}`)}
                  className="w-full flex items-center justify-between py-3 text-left
                             hover:bg-gray-800/50 -mx-2 px-2 rounded-lg transition-colors"
                >
                  <div>
                    <div className="text-white text-sm font-medium">{c.full_name}</div>
                    <div className="text-gray-500 text-xs">
                      {c.client_name} · {c.designation ?? 'No designation'}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-gray-400 text-sm">{formatDate(c.expected_doj)}</span>
                    <StageBadge stage={c.stage} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
