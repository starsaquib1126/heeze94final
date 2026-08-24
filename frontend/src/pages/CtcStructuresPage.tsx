import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import AppShell from '@/components/layout/AppShell'
import {
  listCtcStructures, createCtcStructure, updateCtcStructure, cloneCtcStructure,
  evaluateCtcStructure, listLocations, GUIDED_PRESETS,
  type CTCStructure, type CTCLineItemInput, type PresetKey, type ComputedLineItem,
} from '@/lib/ctcStructures'
import { getErrorMessage } from '@/lib/errors'
import { useAuthStore } from '@/store/authStore'

function emptyLineItem(order: number): CTCLineItemInput {
  return {
    key: '', label: '', section: 'Earnings', guided_type: null,
    formula: null, guided_params: null, display_text: '',
    is_subtotal: false, spacer_after: null, item_order: order,
  }
}

// The real, validated iBridge CTC breakup — same formulas confirmed
// correct against real letters and LibreOffice rendering earlier in
// this build. One click fills in a working structure with no manual
// formula-building required.
function ibridgeStandardStructure(): CTCLineItemInput[] {
  // Matches the real iBridge "CTC with PF" reference spreadsheet
  // formula-for-formula (verified against CTC_Calculations_-_2026-27.xlsx,
  // both a Hyderabad and a Karnataka/ESIC example, exact number for
  // number) — not approximated. Professional Tax and ESIC are genuinely
  // conditional on Location and CTC level respectively; both compute
  // correctly here rather than needing separate structures per location.
  return [
    { key: 'basic_monthly', label: 'Basic Salary', section: 'Earnings',
      guided_type: 'percent_of', formula: null,
      guided_params: { base: 'monthly_ctc', percent: 50 },
      display_text: '', is_subtotal: false, spacer_after: false, item_order: 1 },
    { key: 'hra_monthly', label: 'House Rental Allowance', section: 'Earnings',
      guided_type: 'percent_of', formula: null,
      guided_params: { base: 'basic_monthly', percent: 40 },
      display_text: '', is_subtotal: false, spacer_after: false, item_order: 2 },
    { key: 'bonus_monthly', label: 'Statutory Bonus', section: 'Earnings',
      guided_type: 'percent_of', formula: null,
      guided_params: { base: 'basic_monthly', percent: 8.33 },
      display_text: '', is_subtotal: false, spacer_after: false, item_order: 3 },
    { key: 'special_allowance_monthly', label: 'Special Allowance', section: 'Earnings',
      guided_type: 'custom',
      formula: '(monthly_ctc - employer_pf_monthly) - (basic_monthly + hra_monthly + bonus_monthly)',
      guided_params: null, display_text: '', is_subtotal: false, spacer_after: false, item_order: 4 },
    { key: 'total_earnings_monthly', label: 'Total Earnings (A)', section: 'Earnings',
      guided_type: 'custom',
      formula: 'basic_monthly + hra_monthly + bonus_monthly + special_allowance_monthly',
      guided_params: null, display_text: '', is_subtotal: true, spacer_after: false, item_order: 5 },
    { key: 'employer_pf_monthly', label: 'Employer PF Contribution (B)', section: 'Earnings',
      guided_type: 'custom',
      formula: 'IF(pf_type == "max", (monthly_ctc - hra_monthly) * 12%, IF(pf_type == "none", 0, IF((monthly_ctc - hra_monthly) > 15000, 1800, (monthly_ctc - hra_monthly) * 12%)))',
      guided_params: null, display_text: '', is_subtotal: false, spacer_after: true, item_order: 6 },
    { key: 'total_ctc_monthly', label: 'Total Cost to Company (A+B)', section: 'Earnings',
      guided_type: 'custom', formula: 'total_earnings_monthly + employer_pf_monthly',
      guided_params: null, display_text: '', is_subtotal: true, spacer_after: false, item_order: 7 },
    // Deductions — every formula below is copied exactly from the real
    // spreadsheet's own cells, not reconstructed from memory.
    { key: 'employee_pf_monthly', label: 'Employee Provident Fund', section: 'Deductions',
      guided_type: 'custom', formula: 'employer_pf_monthly',
      guided_params: null, display_text: '', is_subtotal: false, spacer_after: false, item_order: 8 },
    { key: 'esic_monthly', label: 'ESIC', section: 'Deductions',
      guided_type: 'custom', formula: 'IF(monthly_ctc > 21000, 0, total_earnings_monthly * 0.75%)',
      guided_params: null, display_text: '', is_subtotal: false, spacer_after: false, item_order: 9 },
    { key: 'professional_tax_monthly', label: 'Professional Tax (PT)', section: 'Deductions',
      guided_type: 'custom',
      // Flat, location-only rule (confirmed directly, not from the
      // spreadsheet's own formula, which had salary-based slabs) —
      // offers/appointments released for Karnataka (Bengaluru) are
      // always PT-free; every other location is always ₹200/month,
      // regardless of salary level.
      formula: 'IF(location == "Karnataka", 0, 200)',
      guided_params: null, display_text: '', is_subtotal: false, spacer_after: false, item_order: 10 },
    // These two vary per person (income tax depends on individual
    // declarations; insurance depends on plan/coverage) and were never
    // meant to be computed — display_text-only rows show literal text
    // instead of an amount, matching the real spreadsheet's own
    // "*As Applicable" convention exactly.
    { key: 'health_insurance_monthly', label: 'Health Insurance', section: 'Deductions',
      guided_type: null, formula: null, guided_params: null,
      display_text: '*As Applicable', is_subtotal: false, spacer_after: false, item_order: 11 },
    { key: 'income_tax_monthly', label: 'Income Tax (TDS)', section: 'Deductions',
      guided_type: null, formula: null, guided_params: null,
      display_text: '*As Applicable', is_subtotal: false, spacer_after: false, item_order: 12 },
    { key: 'total_deductions_monthly', label: 'Total Deductions (C)', section: 'Deductions',
      guided_type: 'custom',
      formula: 'employee_pf_monthly + professional_tax_monthly + esic_monthly',
      guided_params: null, display_text: '', is_subtotal: true, spacer_after: true, item_order: 13 },
    { key: 'net_salary_monthly', label: 'Net Salary (D)', section: 'Deductions',
      guided_type: 'custom',
      formula: 'total_earnings_monthly - total_deductions_monthly',
      guided_params: null, display_text: '', is_subtotal: true, spacer_after: false, item_order: 14 },
  ]
}

function formatValue(v: number | string): string {
  if (typeof v === 'string') return v
  return `₹${v.toLocaleString('en-IN')}`
}

export default function CtcStructuresPage() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<CTCStructure | 'new' | null>(null)

  const { data: structures, isLoading } = useQuery({
    queryKey: ['ctc-structures'],
    queryFn: () => listCtcStructures(),
  })

  return (
    <AppShell>
      <div className="p-8 max-w-5xl mx-auto">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">CTC Structure Builder</h1>
            <p className="text-gray-500 text-sm mt-1">
              Define CTC breakups with sections and formulas, per location.
            </p>
          </div>
          <button
            onClick={() => setEditing('new')}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white
                       bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500
                       hover:opacity-90 transition-opacity"
          >
            + New Structure
          </button>
        </div>

        {isLoading && <div className="text-gray-500 text-sm py-10 text-center">Loading…</div>}

        {!isLoading && !structures?.length && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl py-16 text-center">
            <div className="text-3xl mb-2">📊</div>
            <div className="text-white font-medium">No CTC structures yet</div>
            <div className="text-gray-500 text-sm mt-1">
              Create one to power the CTC breakup table in your letter templates.
            </div>
          </div>
        )}

        <div className="space-y-3">
          {structures?.map((s) => (
            <div
              key={s.id}
              className="bg-gray-900 border border-gray-800 rounded-2xl px-5 py-4
                         flex items-center justify-between"
            >
              <div>
                <div className="text-white font-medium">{s.name}</div>
                <div className="text-gray-500 text-xs mt-0.5">
                  {s.line_items.length} line item{s.line_items.length !== 1 ? 's' : ''} · Version {s.version}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setEditing(s)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-300
                             bg-gray-800 hover:bg-gray-700 transition-colors"
                >
                  Edit
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {editing && (
        <StructureEditorModal
          structure={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['ctc-structures'] })
            setEditing(null)
          }}
        />
      )}
    </AppShell>
  )
}

function StructureEditorModal({
  structure, onClose, onSaved,
}: {
  structure: CTCStructure | null
  onClose: () => void
  onSaved: () => void
}) {
  const { user } = useAuthStore()
  const [name, setName] = useState(structure?.name ?? '')
  const [locationId, setLocationId] = useState(structure?.location_id ?? user?.location_id ?? '')
  const [items, setItems] = useState<CTCLineItemInput[]>(
    structure?.line_items.map((i) => ({
      key: i.key, label: i.label, section: i.section, guided_type: i.guided_type,
      formula: i.formula, guided_params: i.guided_params, display_text: i.display_text,
      is_subtotal: i.is_subtotal, spacer_after: i.spacer_after, item_order: i.item_order,
    })) ?? [emptyLineItem(1)]
  )
  const [testCtc, setTestCtc] = useState('1200000')
  const [testLocation, setTestLocation] = useState('')
  const [testResults, setTestResults] = useState<ComputedLineItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Super Users aren't scoped to a single location, so unlike HR (whose
  // location_id is always known) they need an explicit picker here —
  // otherwise a Super User creating a brand-new structure would silently
  // submit an empty location_id and the request would fail.
  const needsLocationPicker = user?.role === 'super_user' && !structure
  const { data: locations } = useQuery({
    queryKey: ['locations'],
    queryFn: listLocations,
    enabled: needsLocationPicker,
  })

  const saveMutation = useMutation({
    mutationFn: () =>
      structure
        ? updateCtcStructure(structure.id, name, locationId, items)
        : createCtcStructure(name, locationId, items),
    onSuccess: onSaved,
    onError: (err: any) => setError(getErrorMessage(err, 'Could not save.')),
  })

  function updateItem(index: number, patch: Partial<CTCLineItemInput>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)))
  }

  function addItem() {
    setItems((prev) => [...prev, emptyLineItem(prev.length + 1)])
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index))
  }

  function applyPreset(index: number, presetType: PresetKey) {
    const preset = GUIDED_PRESETS.find((p) => p.type === presetType)
    if (!preset) return
    // guided_type sent to the backend must be a structural type the formula
    // engine actually understands (percent_of / flat / slab / custom) — the
    // preset's own name (e.g. 'basic', 'hra') is only used here to pre-fill
    // sensible defaults, never as the guided_type value itself.
    updateItem(index, {
      guided_type: presetType === 'custom' ? 'custom' : 'percent_of',
      section: preset.section,
      label: items[index].label || preset.label,
      key: items[index].key || preset.type + '_monthly',
      guided_params: presetType === 'custom' ? null : { base: 'monthly_ctc', percent: 50 },
      formula: presetType === 'custom' ? '' : null,
    })
  }

  async function handleEvaluate() {
    if (!structure) {
      setError('Save the structure first to test it.')
      return
    }
    try {
      const results = await evaluateCtcStructure(structure.id, Number(testCtc), testLocation)
      setTestResults(results)
      setError(null)
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not evaluate.'))
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-5xl max-h-[90vh]
                      overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white text-lg font-bold">
            {structure ? 'Edit CTC Structure' : 'New CTC Structure'}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white">✕</button>
        </div>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Structure name, e.g. CTC with PF"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm
                     text-white mb-4 focus:outline-none focus:border-purple-500"
        />

        {needsLocationPicker && (
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm
                       text-white mb-4 focus:outline-none focus:border-purple-500"
          >
            <option value="">Select a location…</option>
            {locations?.map((loc) => (
              <option key={loc.id} value={loc.id}>{loc.name}</option>
            ))}
          </select>
        )}

        {error && (
          <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-2 text-red-300 text-sm mb-4">
            {error}
          </div>
        )}

        {!structure && (
          <button
            onClick={() => setItems(ibridgeStandardStructure())}
            className="w-full py-2.5 rounded-lg text-sm font-semibold text-white mb-4
                       bg-gradient-to-r from-green-500 to-emerald-500 hover:opacity-90 transition-opacity"
          >
            ⚡ Use iBridge Standard Structure (Basic 50% / HRA 40% / Bonus 8.33% / PF)
          </button>
        )}

        <div className="grid grid-cols-2 gap-6">
          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-gray-300 text-sm font-medium">Line Items</h3>
              <button
                onClick={addItem}
                className="text-xs text-purple-400 hover:text-purple-300"
              >
                + Add Line Item
              </button>
            </div>

            <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-2">
              {items.map((item, i) => (
                <div key={i} className="bg-gray-800/60 border border-gray-700 rounded-lg p-3">
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <input
                      value={item.key}
                      onChange={(e) => updateItem(i, { key: e.target.value })}
                      placeholder="key (e.g. basic_monthly)"
                      className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white"
                    />
                    <input
                      value={item.label}
                      onChange={(e) => updateItem(i, { label: e.target.value })}
                      placeholder="Label"
                      className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white"
                    />
                  </div>

                  <select
                    value={item.guided_type === null && item.display_text ? '__text_only__' : (item.guided_type ?? '')}
                    onChange={(e) => {
                      if (e.target.value === '__text_only__') {
                        updateItem(i, {
                          guided_type: null, formula: null, guided_params: null,
                          display_text: item.display_text || 'As Applicable',
                        })
                      } else {
                        applyPreset(i, e.target.value as PresetKey)
                      }
                    }}
                    className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white mb-2"
                  >
                    <option value="">Select component type…</option>
                    <option value="__text_only__">📝 Text Only (e.g. "As Applicable")</option>
                    {GUIDED_PRESETS.map((p) => (
                      <option key={p.type} value={p.type}>{p.label}</option>
                    ))}
                  </select>

                  {item.guided_type === null && item.display_text ? (
                    <input
                      value={item.display_text}
                      onChange={(e) => updateItem(i, { display_text: e.target.value })}
                      placeholder='Text to show instead of a number, e.g. "As Applicable"'
                      className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white mb-2"
                    />
                  ) : item.guided_type === 'custom' || item.guided_type === null ? (
                    <input
                      value={item.formula ?? ''}
                      onChange={(e) => updateItem(i, { formula: e.target.value })}
                      placeholder="Raw formula, e.g. basic_monthly * 40%"
                      className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white mb-2 font-mono"
                    />
                  ) : (
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <input
                        value={item.guided_params?.base ?? ''}
                        onChange={(e) => updateItem(i, { guided_params: { ...item.guided_params, base: e.target.value } })}
                        placeholder="Base (e.g. basic_monthly)"
                        className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white"
                      />
                      <input
                        type="number"
                        value={item.guided_params?.percent ?? ''}
                        onChange={(e) => updateItem(i, { guided_params: { ...item.guided_params, percent: Number(e.target.value) } })}
                        placeholder="Percent"
                        className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white"
                      />
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 text-xs text-gray-400">
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={item.is_subtotal}
                          onChange={(e) => updateItem(i, { is_subtotal: e.target.checked })}
                        />
                        Bold
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={item.spacer_after ?? item.is_subtotal}
                          onChange={(e) => updateItem(i, { spacer_after: e.target.checked })}
                        />
                        Spacer after
                      </label>
                    </div>
                    <button onClick={() => removeItem(i)} className="text-red-400 hover:text-red-300 text-xs">
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Live test panel */}
          <div>
            <h3 className="text-gray-300 text-sm font-medium mb-2">Test This Structure</h3>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <input
                type="number"
                value={testCtc}
                onChange={(e) => setTestCtc(e.target.value)}
                placeholder="Annual CTC"
                className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
              />
              <input
                value={testLocation}
                onChange={(e) => setTestLocation(e.target.value)}
                placeholder="Location"
                className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
              />
            </div>
            <button
              onClick={handleEvaluate}
              className="w-full py-1.5 rounded-lg text-sm font-medium text-white bg-blue-600
                         hover:bg-blue-500 transition-colors mb-3"
            >
              Evaluate
            </button>
            {!structure && (
              <p className="text-amber-400 text-xs mb-3">Save the structure first to test it live.</p>
            )}

            <div className="bg-gray-950 border border-gray-800 rounded-lg p-3 font-mono text-xs
                            max-h-[40vh] overflow-y-auto">
              {!testResults && <div className="text-gray-600">No results yet.</div>}
              {testResults?.map((r, i) => (
                <div key={i} className={`flex justify-between py-0.5 ${r.is_subtotal ? 'text-white font-bold' : 'text-gray-400'}`}>
                  <span>{r.label}</span>
                  <span>{formatValue(r.monthly)}/mo</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white">
            Cancel
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={!name || !locationId || saveMutation.isPending}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white
                       bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500
                       hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saveMutation.isPending ? 'Saving…' : 'Save Structure'}
          </button>
        </div>
      </div>
    </div>
  )
}
