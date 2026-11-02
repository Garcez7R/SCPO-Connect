export function glucoseInMgDl(value: string | undefined, unit: string | undefined): string {
  if (!value || unit !== 'mmol/L') return value ?? ''
  const parsed = Number.parseFloat(value.replace(',', '.'))
  if (!Number.isFinite(parsed)) return value
  return String(Math.round(parsed * 18.0182))
}
