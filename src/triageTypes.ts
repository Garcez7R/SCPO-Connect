export type NursingTriageRecord = {
  id: number
  allergies_status: 'unknown' | 'none_known' | 'known'
  allergies: string
  conditions_treatments: string
  vital_values: Record<string, string>
  glucose_unit: 'mg/dL' | 'mmol/L'
  measured_at: string | null
  registered_by: string
  registered_at: string
}

export type TriageArrival = {
  arrival_id: string
  patient_reference: string | null
  patient_name: string
  arrival_mode: 'walk_in' | 'ambulance' | 'other'
  reason: string
  status: 'waiting' | 'called' | 'in_service'
  queue_type: 'common' | 'priority'
  created_at: string
  allergy_report_status: 'not_asked' | 'reported' | 'denied'
  reported_allergies: string
  patient_allergies_status?: 'unknown' | 'none_known' | 'known'
  patient_allergies?: string
  triage: NursingTriageRecord | null
}
