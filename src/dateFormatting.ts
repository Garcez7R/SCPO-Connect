export function formatDateDmy(value: string | null | undefined) {
  if (!value) return 'Não informado'
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value)
  if (!match) return value

  const [, year, month, day] = match
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  if (parsed.getUTCFullYear() !== Number(year) || parsed.getUTCMonth() !== Number(month) - 1 || parsed.getUTCDate() !== Number(day)) {
    return value
  }
  return `${day}-${month}-${year}`
}
