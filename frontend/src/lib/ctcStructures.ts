/**
 * CTC Structure Builder API calls.
 */

import { api } from './supabase'

export type StructuralGuidedType = 'percent_of' | 'flat' | 'slab' | 'custom'
export type PresetKey = 'basic' | 'hra' | 'statutory_bonus' | 'special_allowance' |
  'employer_pf' | 'employee_pf' | 'esic' | 'professional_tax' |
  'health_insurance' | 'tds' | 'custom'

export interface GuidedParams {
  // percent_of
  base?: string
  percent?: number
  // flat
  amount?: number
  // slab
  compare_to?: string
  slabs?: { min?: number; max?: number; value: number }[]
}

export interface CTCLineItem {
  id: string
  structure_id: string
  key: string
  label: string
  section: string
  guided_type: StructuralGuidedType | null
  formula: string | null
  guided_params: GuidedParams | null
  display_text: string
  is_subtotal: boolean
  spacer_after: boolean | null
  item_order: number
}

export interface CTCLineItemInput {
  key: string
  label: string
  section: string
  guided_type: StructuralGuidedType | null
  formula: string | null
  guided_params: GuidedParams | null
  display_text: string
  is_subtotal: boolean
  spacer_after: boolean | null
  item_order: number
}

export interface CTCStructure {
  id: string
  tenant_id: string
  location_id: string
  name: string
  version: number
  is_current: boolean
  cloned_from_id: string | null
  created_at: string
  line_items: CTCLineItem[]
}

export interface ComputedLineItem {
  label: string
  section: string
  yearly: number | string
  monthly: number | string
  is_subtotal: boolean
  spacer_after: boolean
}

export async function listCtcStructures(locationId?: string): Promise<CTCStructure[]> {
  const res = await api.get<CTCStructure[]>('/ctc-structures', {
    params: locationId ? { location_id: locationId } : undefined,
  })
  return res.data
}

export async function getCtcStructure(id: string): Promise<CTCStructure> {
  const res = await api.get<CTCStructure>(`/ctc-structures/${id}`)
  return res.data
}

export async function createCtcStructure(
  name: string, locationId: string, lineItems: CTCLineItemInput[]
): Promise<CTCStructure> {
  const res = await api.post<CTCStructure>('/ctc-structures', {
    name, location_id: locationId, line_items: lineItems,
  })
  return res.data
}

export async function updateCtcStructure(
  id: string, name: string, locationId: string, lineItems: CTCLineItemInput[]
): Promise<CTCStructure> {
  const res = await api.put<CTCStructure>(`/ctc-structures/${id}`, {
    name, location_id: locationId, line_items: lineItems,
  })
  return res.data
}

export async function cloneCtcStructure(
  id: string, newName: string, targetLocationId: string
): Promise<CTCStructure> {
  const res = await api.post<CTCStructure>(`/ctc-structures/${id}/clone`, {
    new_name: newName, target_location_id: targetLocationId,
  })
  return res.data
}

export async function evaluateCtcStructure(
  id: string, annualCtc: number, location: string
): Promise<ComputedLineItem[]> {
  const res = await api.post<ComputedLineItem[]>(`/ctc-structures/${id}/evaluate`, {
    annual_ctc: annualCtc, location,
  })
  return res.data
}

// Presets for the guided builder's common component picker — labels shown
// in the UI, mapped to a sensible starting guided_type + default params.
export const GUIDED_PRESETS: { type: PresetKey; label: string; section: string }[] = [
  { type: 'basic', label: 'Basic Salary', section: 'Earnings' },
  { type: 'hra', label: 'House Rental Allowance', section: 'Earnings' },
  { type: 'statutory_bonus', label: 'Statutory Bonus', section: 'Earnings' },
  { type: 'special_allowance', label: 'Special Allowance', section: 'Earnings' },
  { type: 'employer_pf', label: 'Employer PF Contribution', section: 'Earnings' },
  { type: 'employee_pf', label: 'Employee Provident Fund', section: 'Deductions' },
  { type: 'esic', label: 'ESIC', section: 'Deductions' },
  { type: 'professional_tax', label: 'Professional Tax', section: 'Deductions' },
  { type: 'health_insurance', label: 'Health Insurance', section: 'Deductions' },
  { type: 'tds', label: 'Income Tax (TDS)', section: 'Deductions' },
  { type: 'custom', label: 'Custom Component', section: 'Earnings' },
]

export interface Location {
  id: string
  tenant_id: string
  name: string
  location_code: string
  address: string | null
  is_active: boolean
}

export async function listLocations(): Promise<Location[]> {
  const res = await api.get<Location[]>('/admin/locations')
  return res.data
}
