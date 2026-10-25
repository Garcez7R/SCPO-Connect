import { useState } from 'react'
import { Search } from 'lucide-react'

type PatientOption = {
  reference: string
  name: string
  room?: string
  bed?: string
  cpf?: string
  sus_card?: string
  same_number?: string
  phone?: string
  active?: boolean
}

function normalizeSearch(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR')
}

export default function PatientSelect<TPatient extends PatientOption>({
  patients,
  value,
  onChange,
  label,
  emptyLabel = 'Selecione um paciente',
  placeholder = 'Digite para localizar pelo nome, quarto, leito ou cadastro',
  required = false,
  disabled = false,
  className,
  optionLabel,
}: {
  patients: readonly TPatient[]
  value: string
  onChange: (reference: string) => void
  label: string
  emptyLabel?: string
  placeholder?: string
  required?: boolean
  disabled?: boolean
  className?: string
  optionLabel?: (patient: TPatient) => string
}) {
  const [search, setSearch] = useState('')
  const normalizedSearch = normalizeSearch(search.trim())
  const filteredPatients = patients.filter((patient) => {
    const optionText = optionLabel?.(patient) ?? patient.name
    const searchable = [
      patient.name,
      patient.reference,
      patient.room,
      patient.bed,
      patient.cpf,
      patient.sus_card,
      patient.same_number,
      patient.phone,
      optionText,
    ].filter(Boolean).join(' ')
    const normalizedText = normalizeSearch(searchable)
    return normalizedText.includes(normalizedSearch)
  })

  return <div className={`field patient-select-field${className ? ` ${className}` : ''}`}>
    <label>
      <span className="field-label">{label}</span>
      <span className="search-input-wrap">
        <Search size={17} aria-hidden="true" />
        <input
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            if (value) onChange('')
          }}
          placeholder={placeholder}
          aria-label={`${label}: buscar paciente`}
          autoComplete="off"
          disabled={disabled}
        />
      </span>
    </label>
    <select
      required={required}
      value={value}
      onChange={(event) => {
        onChange(event.target.value)
        setSearch('')
      }}
      disabled={disabled}
      aria-label={`${label}: selecionar paciente`}
    >
      <option value="">{emptyLabel}</option>
      {filteredPatients.map((patient) => <option key={patient.reference} value={patient.reference}>
        {optionLabel?.(patient) ?? patient.name}
      </option>)}
      {filteredPatients.length === 0 && <option value="" disabled>Nenhum paciente encontrado</option>}
    </select>
    <span className="field-hint">Digite para filtrar a lista ou abra a lista para selecionar.</span>
  </div>
}
