import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import AppShell from '@/components/layout/AppShell'
import {
  listLocations, createLocation,
  listUsers, createHRUser, deactivateUser,
  listDirectoryClients, createDirectoryClient,
  listAccountManagers, createAccountManager, deleteAccountManager,
  listRecruiters, createRecruiter, deleteRecruiter,
  listLeadership, createLeadership,
} from '@/lib/admin'
import { getErrorMessage } from '@/lib/errors'

type Tab = 'locations' | 'hr' | 'clients' | 'am' | 'recruiters' | 'leadership'

const TABS: { key: Tab; label: string }[] = [
  { key: 'locations', label: 'Locations' },
  { key: 'hr', label: 'HR Users' },
  { key: 'clients', label: 'Client Routing' },
  { key: 'am', label: 'Account Managers' },
  { key: 'recruiters', label: 'Recruiters' },
  { key: 'leadership', label: 'Leadership' },
]

const inputClass =
  'bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white ' +
  'placeholder-gray-500 focus:outline-none focus:border-purple-500'

const buttonClass =
  'px-4 py-2 rounded-lg text-sm font-semibold text-white ' +
  'bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 ' +
  'hover:opacity-90 transition-opacity disabled:opacity-50'

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>('locations')

  return (
    <AppShell>
      <div className="p-8 max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">Admin: Directory & Settings</h1>
          <p className="text-gray-500 text-sm mt-1">
            Configure locations, HR access, and the routing directory that powers the public
            offer-request link.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 mb-6">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 text-white'
                  : 'bg-gray-900 text-gray-400 hover:text-white border border-gray-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'locations' && <LocationsTab />}
        {activeTab === 'hr' && <HRUsersTab />}
        {activeTab === 'clients' && <ClientsTab />}
        {activeTab === 'am' && <AccountManagersTab />}
        {activeTab === 'recruiters' && <RecruitersTab />}
        {activeTab === 'leadership' && <LeadershipTab />}
      </div>
    </AppShell>
  )
}

function SectionCard({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <h2 className="text-white font-semibold text-sm mb-1">{title}</h2>
      {hint && <p className="text-gray-500 text-xs mb-4">{hint}</p>}
      {children}
    </div>
  )
}

function EmptyRow({ text }: { text: string }) {
  return <div className="text-gray-600 text-sm py-4 text-center">{text}</div>
}

// ---------------------------------------------------------------------- //
function LocationsTab() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [address, setAddress] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: locations } = useQuery({ queryKey: ['locations'], queryFn: listLocations })

  const createMutation = useMutation({
    mutationFn: () => createLocation(name, code.toUpperCase(), address || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locations'] })
      setName(''); setCode(''); setAddress(''); setError(null)
    },
    onError: (err: any) => setError(getErrorMessage(err, 'Could not create location.')),
  })

  return (
    <SectionCard title="Locations" hint="Every other section depends on at least one location existing.">
      {error && <div className="text-red-400 text-xs mb-3">{error}</div>}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="text-gray-500 text-xs block mb-1">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Noida" className={inputClass} />
        </div>
        <div>
          <label className="text-gray-500 text-xs block mb-1">Location Code</label>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="NOI" className={`${inputClass} w-24 font-mono`} />
        </div>
        <div>
          <label className="text-gray-500 text-xs block mb-1">Address (optional)</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} />
        </div>
        <button onClick={() => createMutation.mutate()} disabled={!name || !code || createMutation.isPending} className={buttonClass}>
          {createMutation.isPending ? 'Adding…' : '+ Add Location'}
        </button>
      </div>

      {!locations?.length && <EmptyRow text="No locations yet — add your first one above." />}
      {!!locations?.length && (
        <div className="space-y-2">
          {locations.map((loc) => (
            <div key={loc.id} className="flex items-center justify-between bg-gray-800/40 rounded-lg px-4 py-2.5">
              <div>
                <span className="text-white text-sm">{loc.name}</span>
                <span className="text-gray-500 text-xs ml-2 font-mono">{loc.location_code}</span>
              </div>
              {loc.address && <span className="text-gray-500 text-xs">{loc.address}</span>}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}

// ---------------------------------------------------------------------- //
function HRUsersTab() {
  const queryClient = useQueryClient()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [locationId, setLocationId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: users } = useQuery({ queryKey: ['admin-users'], queryFn: listUsers })
  const { data: locations } = useQuery({ queryKey: ['locations'], queryFn: listLocations })

  const createMutation = useMutation({
    mutationFn: () => createHRUser(fullName, email, locationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setFullName(''); setEmail(''); setLocationId(''); setError(null)
    },
    onError: (err: any) => setError(getErrorMessage(err, 'Could not create HR user.')),
  })

  const deactivateMutation = useMutation({
    mutationFn: (userId: string) => deactivateUser(userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  })

  return (
    <SectionCard title="HR Users" hint="Each HR account is scoped to one location and can only see that location's data.">
      {error && <div className="text-red-400 text-xs mb-3">{error}</div>}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="text-gray-500 text-xs block mb-1">Full Name</label>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="text-gray-500 text-xs block mb-1">Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className={inputClass} />
        </div>
        <div>
          <label className="text-gray-500 text-xs block mb-1">Location</label>
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={inputClass}>
            <option value="">Select…</option>
            {locations?.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
          </select>
        </div>
        <button onClick={() => createMutation.mutate()} disabled={!fullName || !email || !locationId || createMutation.isPending} className={buttonClass}>
          {createMutation.isPending ? 'Adding…' : '+ Add HR User'}
        </button>
      </div>
      <p className="text-amber-400 text-xs mb-4">
        ⚠️ Same as your own account: this creates the login record, but the new HR user won't
        have a password yet — you'll need to set one for them via Supabase (Authentication → Users)
        the same way we did for your account, until a real invite-email flow exists.
      </p>

      {!users?.filter(u => u.role === 'hr').length && <EmptyRow text="No HR users yet." />}
      {!!users?.length && (
        <div className="space-y-2">
          {users.filter(u => u.role === 'hr').map((u) => (
            <div key={u.id} className="flex items-center justify-between bg-gray-800/40 rounded-lg px-4 py-2.5">
              <div>
                <span className="text-white text-sm">{u.full_name}</span>
                <span className={`text-xs ml-2 ${u.is_active ? 'text-green-400' : 'text-gray-600'}`}>
                  {u.is_active ? '● Active' : '○ Deactivated'}
                </span>
              </div>
              {u.is_active && (
                <button onClick={() => deactivateMutation.mutate(u.id)} className="text-red-400 hover:text-red-300 text-xs">
                  Deactivate
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}

// ---------------------------------------------------------------------- //
function ClientsTab() {
  const queryClient = useQueryClient()
  const [clientName, setClientName] = useState('')
  const [locationId, setLocationId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: clients } = useQuery({ queryKey: ['directory-clients'], queryFn: listDirectoryClients })
  const { data: locations } = useQuery({ queryKey: ['locations'], queryFn: listLocations })

  const createMutation = useMutation({
    mutationFn: () => createDirectoryClient(clientName, locationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['directory-clients'] })
      setClientName(''); setLocationId(''); setError(null)
    },
    onError: (err: any) => setError(getErrorMessage(err, 'Could not add client mapping.')),
  })

  const locationName = (id: string) => locations?.find((l) => l.id === id)?.name ?? id

  return (
    <SectionCard title="Client Routing" hint="Maps a client name (typed by an Account Manager) to the location that should handle it.">
      {error && <div className="text-red-400 text-xs mb-3">{error}</div>}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="text-gray-500 text-xs block mb-1">Client Name</label>
          <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Deloitte USI" className={inputClass} />
        </div>
        <div>
          <label className="text-gray-500 text-xs block mb-1">Routes to Location</label>
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={inputClass}>
            <option value="">Select…</option>
            {locations?.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
          </select>
        </div>
        <button onClick={() => createMutation.mutate()} disabled={!clientName || !locationId || createMutation.isPending} className={buttonClass}>
          {createMutation.isPending ? 'Adding…' : '+ Add Mapping'}
        </button>
      </div>

      {!clients?.length && <EmptyRow text="No client routing configured yet — Account Managers will need to pick an HR manually until then." />}
      {!!clients?.length && (
        <div className="space-y-2">
          {clients.map((c) => (
            <div key={c.id} className="flex items-center justify-between bg-gray-800/40 rounded-lg px-4 py-2.5">
              <span className="text-white text-sm">{c.client_name}</span>
              <span className="text-gray-500 text-xs">→ {locationName(c.location_id)}</span>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}

// ---------------------------------------------------------------------- //
function AccountManagersTab() {
  const queryClient = useQueryClient()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: ams } = useQuery({ queryKey: ['account-managers'], queryFn: listAccountManagers })

  const createMutation = useMutation({
    mutationFn: () => createAccountManager(fullName, email),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['account-managers'] })
      setFullName(''); setEmail(''); setError(null)
    },
    onError: (err: any) => setError(getErrorMessage(err, 'Could not add Account Manager.')),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAccountManager(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['account-managers'] }),
  })

  return (
    <SectionCard title="Account Managers" hint="Appears in the dropdown on the public offer-request link — no login of their own.">
      {error && <div className="text-red-400 text-xs mb-3">{error}</div>}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="text-gray-500 text-xs block mb-1">Full Name</label>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="text-gray-500 text-xs block mb-1">Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className={inputClass} />
        </div>
        <button onClick={() => createMutation.mutate()} disabled={!fullName || !email || createMutation.isPending} className={buttonClass}>
          {createMutation.isPending ? 'Adding…' : '+ Add'}
        </button>
      </div>

      {!ams?.length && <EmptyRow text="No Account Managers yet." />}
      {!!ams?.length && (
        <div className="space-y-2">
          {ams.map((am) => (
            <div key={am.id} className="flex items-center justify-between bg-gray-800/40 rounded-lg px-4 py-2.5">
              <div>
                <span className="text-white text-sm">{am.full_name}</span>
                <span className="text-gray-500 text-xs ml-2">{am.email}</span>
              </div>
              <button onClick={() => deleteMutation.mutate(am.id)} className="text-red-400 hover:text-red-300 text-xs">Remove</button>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}

// ---------------------------------------------------------------------- //
function RecruitersTab() {
  const queryClient = useQueryClient()
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: recruiters } = useQuery({ queryKey: ['recruiters'], queryFn: listRecruiters })

  const createMutation = useMutation({
    mutationFn: () => createRecruiter(fullName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recruiters'] })
      setFullName(''); setError(null)
    },
    onError: (err: any) => setError(getErrorMessage(err, 'Could not add recruiter.')),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteRecruiter(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recruiters'] }),
  })

  return (
    <SectionCard title="Recruiters" hint="Captured on each request for incentive/reporting only — no login, no action authority.">
      {error && <div className="text-red-400 text-xs mb-3">{error}</div>}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="text-gray-500 text-xs block mb-1">Full Name</label>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} />
        </div>
        <button onClick={() => createMutation.mutate()} disabled={!fullName || createMutation.isPending} className={buttonClass}>
          {createMutation.isPending ? 'Adding…' : '+ Add'}
        </button>
      </div>

      {!recruiters?.length && <EmptyRow text="No recruiters yet." />}
      {!!recruiters?.length && (
        <div className="space-y-2">
          {recruiters.map((r) => (
            <div key={r.id} className="flex items-center justify-between bg-gray-800/40 rounded-lg px-4 py-2.5">
              <span className="text-white text-sm">{r.full_name}</span>
              <button onClick={() => deleteMutation.mutate(r.id)} className="text-red-400 hover:text-red-300 text-xs">Remove</button>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}

// ---------------------------------------------------------------------- //
function LeadershipTab() {
  const queryClient = useQueryClient()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [roleLabel, setRoleLabel] = useState('')
  const [locationId, setLocationId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: leadership } = useQuery({ queryKey: ['leadership'], queryFn: listLeadership })
  const { data: locations } = useQuery({ queryKey: ['locations'], queryFn: listLocations })

  const createMutation = useMutation({
    mutationFn: () => createLeadership(fullName, email, roleLabel, locationId || null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leadership'] })
      setFullName(''); setEmail(''); setRoleLabel(''); setLocationId(''); setError(null)
    },
    onError: (err: any) => setError(getErrorMessage(err, 'Could not add leadership contact.')),
  })

  const locationName = (id: string | null) => id ? (locations?.find((l) => l.id === id)?.name ?? id) : 'Company-wide (Core Director)'

  return (
    <SectionCard title="Leadership" hint="Copied on every notification. Leave Location blank for a company-wide Core Director; set it for a location-specific Director.">
      {error && <div className="text-red-400 text-xs mb-3">{error}</div>}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="text-gray-500 text-xs block mb-1">Full Name</label>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="text-gray-500 text-xs block mb-1">Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className={inputClass} />
        </div>
        <div>
          <label className="text-gray-500 text-xs block mb-1">Title</label>
          <input value={roleLabel} onChange={(e) => setRoleLabel(e.target.value)} placeholder="Core Director" className={inputClass} />
        </div>
        <div>
          <label className="text-gray-500 text-xs block mb-1">Location (optional)</label>
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={inputClass}>
            <option value="">Company-wide</option>
            {locations?.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
          </select>
        </div>
        <button onClick={() => createMutation.mutate()} disabled={!fullName || !email || createMutation.isPending} className={buttonClass}>
          {createMutation.isPending ? 'Adding…' : '+ Add'}
        </button>
      </div>

      {!leadership?.length && <EmptyRow text="No leadership contacts yet." />}
      {!!leadership?.length && (
        <div className="space-y-2">
          {leadership.map((l) => (
            <div key={l.id} className="flex items-center justify-between bg-gray-800/40 rounded-lg px-4 py-2.5">
              <div>
                <span className="text-white text-sm">{l.full_name}</span>
                <span className="text-gray-500 text-xs ml-2">{l.role_label}</span>
              </div>
              <span className="text-gray-500 text-xs">{locationName(l.location_id)}</span>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}
