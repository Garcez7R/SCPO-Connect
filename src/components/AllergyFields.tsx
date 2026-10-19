import type { ChangeEvent } from 'react'

type AllergyStatus = 'unknown' | 'none_known' | 'known'

const allergyOptions = [
  'Ácido acetilsalicílico (AAS)',
  'Amoxicilina',
  'Cefalexina',
  'Dipirona',
  'Ibuprofeno',
  'Látex',
  'Paracetamol',
  'Penicilina',
  'Sulfonamidas',
  'Contraste iodado',
]

function parseAllergies(value: string) {
  const entries = value.split(';').map((item) => item.trim()).filter(Boolean)
  const selected = entries.filter((item) => allergyOptions.includes(item))
  const freeText = entries.filter((item) => !allergyOptions.includes(item) && item !== 'Outros').join('; ')
  return { selected, freeText, otherSelected: Boolean(freeText) || entries.includes('Outros') }
}

function serializeAllergies(selected: string[], freeText: string, otherSelected: boolean) {
  const entries = [...selected]
  if (freeText.trim()) entries.push(freeText.trim())
  else if (otherSelected) entries.push('Outros')
  return entries.join('; ')
}

export default function AllergyFields({
  status,
  allergies,
  onChange,
  title = 'Status das alergias',
  includeFoodHint = false,
  maxLength = 1000,
}: {
  status: AllergyStatus
  allergies: string
  onChange: (status: AllergyStatus, allergies: string) => void
  title?: string
  includeFoodHint?: boolean
  maxLength?: number
}) {
  const parsed = parseAllergies(allergies)
  const freeTextMaxLength = Math.max(0, maxLength - parsed.selected.join('; ').length - (parsed.selected.length ? 2 : 0))
  const changeStatus = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextStatus = event.target.value as AllergyStatus
    onChange(nextStatus, nextStatus === 'known' ? allergies : '')
  }

  return <fieldset className="patient-address-group allergy-fields">
    <legend>{title}</legend>
    <label className="field"><span className="field-label">Situação</span><select value={status} onChange={changeStatus}><option value="unknown">Não verificado / desconhecido</option><option value="none_known">Sem alergias conhecidas · confirmado</option><option value="known">Alergia conhecida</option></select></label>
    {status === 'known' && <div className="allergy-fields-content">
      <p className="field-hint">Selecione as substâncias conhecidas. A lista é apenas um auxílio de registro, não é completa nem substitui a avaliação clínica.{includeFoodHint ? ' Informe também alergias alimentares em “Outros”.' : ''}</p>
      <div className="allergy-options">{allergyOptions.map((option) => <label key={option}><input type="checkbox" checked={parsed.selected.includes(option)} onChange={(event) => {
        const selected = event.target.checked
          ? [...parsed.selected, option]
          : parsed.selected.filter((item) => item !== option)
        onChange('known', serializeAllergies(selected, parsed.freeText, parsed.otherSelected))
      }} /><span>{option}</span></label>)}</div>
      <label className="allergy-other-toggle"><input type="checkbox" checked={parsed.otherSelected} onChange={(event) => onChange('known', serializeAllergies(parsed.selected, event.target.checked ? parsed.freeText : '', event.target.checked))} /><span>Outros / não listado</span></label>
      {parsed.otherSelected && <label className="field"><span className="field-label">Descreva outros agentes e reações conhecidas</span><textarea required maxLength={freeTextMaxLength} value={parsed.freeText} onChange={(event) => onChange('known', serializeAllergies(parsed.selected, event.target.value, true))} placeholder="Informe medicamento, alimento ou substância e reação conhecida" /></label>}
    </div>}
  </fieldset>
}
