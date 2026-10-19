export function formatCpf(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
}

export function formatPostalCode(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8)
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits
}

export function formatPhone(value: string): string {
  let digits = value.replace(/\D/g, '')
  const hasBrazilCountryCode = digits.length > 11 && digits.startsWith('55')
  if (hasBrazilCountryCode) digits = digits.slice(2, 13)
  else digits = digits.slice(0, 11)
  if (!digits) return ''
  const countryPrefix = hasBrazilCountryCode ? '+55 ' : ''
  if (digits.length <= 2) return `${countryPrefix}(${digits}`
  const areaCode = digits.slice(0, 2)
  const localNumber = digits.slice(2)
  const firstPartLength = digits.length > 10 ? 5 : 4
  const firstPart = localNumber.slice(0, firstPartLength)
  const secondPart = localNumber.slice(firstPartLength)
  return `${countryPrefix}(${areaCode}) ${firstPart}${secondPart ? `-${secondPart}` : ''}`
}

export function formatDecimalInput(value: string): string {
  const sign = value.startsWith('-') ? '-' : ''
  const normalized = value.replace(/[^\d.,]/g, '').replace('.', ',')
  const separatorIndex = normalized.indexOf(',')
  if (separatorIndex === -1) return `${sign}${normalized}`
  const whole = normalized.slice(0, separatorIndex)
  const fraction = normalized.slice(separatorIndex + 1).replace(/[.,]/g, '')
  return `${sign}${whole || '0'},${fraction}`
}

export function formatHeightCentimeters(value: string): string {
  const digits = value.replace(/\D/g, '').slice(-3)
  if (!digits) return ''
  const centimeters = Number(digits)
  return `${Math.floor(centimeters / 100)},${String(centimeters % 100).padStart(2, '0')}`
}

export function toHeightCentimeters(value: string): string {
  const digits = value.replace(/\D/g, '').slice(-3)
  return digits ? String(Number(digits)) : ''
}
