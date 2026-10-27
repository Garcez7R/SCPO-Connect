export type PatientCareTrack = 'clinical' | 'psychiatric' | 'combined' | 'unclassified'

export const patientCareTrackLabels: Record<PatientCareTrack, string> = {
  clinical: 'Cuidado clínico',
  psychiatric: 'Cuidado psiquiátrico',
  combined: 'Cuidado clínico e psiquiátrico',
  unclassified: 'Perfil não classificado',
}

export function patientCareTrackClass(track?: PatientCareTrack | null): string {
  return `care-track-${track ?? 'unclassified'}`
}
