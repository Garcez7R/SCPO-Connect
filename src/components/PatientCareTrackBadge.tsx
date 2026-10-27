import { patientCareTrackClass, patientCareTrackLabels } from '../patientCareTrack'
import type { PatientCareTrack } from '../patientCareTrack'

export function PatientCareTrackBadge({ track }: { track?: PatientCareTrack | null }) {
  return <span className={`care-track-badge ${patientCareTrackClass(track)}`}>
    {patientCareTrackLabels[track ?? 'unclassified']}
  </span>
}
