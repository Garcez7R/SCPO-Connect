import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { CalendarClock, Clock3 } from 'lucide-react'
import { readApiResponse } from '../api'
import PatientSelect from '../components/PatientSelect'
import ToastMessage from '../components/ToastMessage'

type Patient = { reference: string; name: string; active?: boolean }
type AppointmentType = 'consultation' | 'exam' | 'procedure' | 'return'
type AppointmentStatus = 'scheduled' | 'confirmed' | 'arrived' | 'called' | 'completed' | 'cancelled' | 'no_show'
type Appointment = {
  id: number
  patient_reference: string
  patient_name: string
  appointment_type: AppointmentType
  professional_name: string
  location: string
  purpose: string
  starts_at: string
  ends_at: string
  status: AppointmentStatus
  created_by_name: string
}

const appointmentTypes: Record<AppointmentType, string> = {
  consultation: 'Consulta',
  exam: 'Exame',
  procedure: 'Procedimento',
  return: 'Retorno',
}

const appointmentStatuses: Record<AppointmentStatus, string> = {
  scheduled: 'Agendado',
  confirmed: 'Confirmado',
  arrived: 'Chegou',
  called: 'Chamado',
  completed: 'Concluído',
  cancelled: 'Cancelado',
  no_show: 'Não compareceu',
}

function localDateTimeValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function nextAppointmentSlot() {
  return new Date((Math.floor(Date.now() / 1_800_000) + 1) * 1_800_000)
}

function offsetDateTimeInput(days: number, endOfDay = false) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  if (endOfDay) date.setHours(23, 59, 0, 0)
  return localDateTimeValue(date)
}

const initialFromDate = offsetDateTimeInput(-30)
const initialToDate = offsetDateTimeInput(90, true)

function displayDateTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function ReceptionAppointmentsPage({ patients, canCreate, canUpdate }: {
  patients: Patient[]
  canCreate: boolean
  canUpdate: boolean
}) {
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | AppointmentStatus>('all')
  const [fromDate, setFromDate] = useState(initialFromDate)
  const [toDate, setToDate] = useState(initialToDate)
  const [patientReference, setPatientReference] = useState('')
  const [appointmentType, setAppointmentType] = useState<AppointmentType>('consultation')
  const [professionalName, setProfessionalName] = useState('')
  const [location, setLocation] = useState('')
  const [purpose, setPurpose] = useState('')
  const [startsAt, setStartsAt] = useState(() => localDateTimeValue(nextAppointmentSlot()))
  const [endsAt, setEndsAt] = useState(() => localDateTimeValue(new Date(nextAppointmentSlot().getTime() + 30 * 60_000)))
  const [updatingId, setUpdatingId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function loadAppointments(startDate = fromDate, endDate = toDate) {
    try {
      if (!startDate || !endDate || endDate < startDate) {
        throw new Error('Informe um período válido para consultar a agenda.')
      }
      const params = new URLSearchParams({
        from_at: new Date(startDate).toISOString(),
        to_at: new Date(new Date(endDate).getTime() + 60_000).toISOString(),
      })
      const response = await fetch(`/api/v1/reception/appointments?${params}`)
      const data = await readApiResponse<{ appointments?: Appointment[] }>(response)
      setAppointments(data.appointments ?? [])
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar a agenda.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let current = true
    const params = new URLSearchParams({
      from_at: new Date(initialFromDate).toISOString(),
      to_at: new Date(new Date(initialToDate).getTime() + 60_000).toISOString(),
    })
    void fetch(`/api/v1/reception/appointments?${params}`)
      .then(readApiResponse<{ appointments?: Appointment[] }>)
      .then((data) => {
        if (current) {
          setAppointments(data.appointments ?? [])
          setError('')
        }
      })
      .catch((loadError: unknown) => {
        if (current) setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar a agenda.')
      })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [])

  async function createAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/v1/reception/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_reference: patientReference,
          appointment_type: appointmentType,
          professional_name: professionalName,
          location,
          purpose,
          starts_at: new Date(startsAt).toISOString(),
          ends_at: new Date(endsAt).toISOString(),
        }),
      })
      await readApiResponse<Appointment>(response)
      setNotice('Agendamento registrado. Os conflitos de paciente, profissional e local foram verificados.')
      setFormOpen(false)
      setPurpose('')
      await loadAppointments()
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Não foi possível salvar o agendamento.')
    } finally {
      setSaving(false)
    }
  }

  async function changeStatus(appointment: Appointment, status: AppointmentStatus) {
    setUpdatingId(appointment.id)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`/api/v1/reception/appointments/${appointment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      await readApiResponse<Appointment>(response)
      setNotice(status === 'arrived'
        ? 'Chegada registrada. A senha sequencial da fila comum será exibida no painel de chamadas.'
        : 'Situação do agendamento atualizada.')
      await loadAppointments()
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Não foi possível atualizar a situação.')
    } finally {
      setUpdatingId(null)
    }
  }

  const filteredAppointments = useMemo(() => appointments.filter((appointment) => {
    if (statusFilter !== 'all' && appointment.status !== statusFilter) return false
    const term = search.trim().toLocaleLowerCase('pt-BR')
    return !term || `${appointment.patient_name} ${appointment.professional_name} ${appointment.location} ${appointment.purpose}`.toLocaleLowerCase('pt-BR').includes(term)
  }), [appointments, search, statusFilter])

  const activePatients = patients.filter((patient) => patient.active !== false)

  return <div className="reception-appointments">
    {error && <ToastMessage variant="error">{error}</ToastMessage>}
    {notice && <ToastMessage variant="success">{notice}</ToastMessage>}
    <div className="hygiene-summary" aria-label="Resumo da agenda">
      <article><strong>{appointments.filter((item) => item.status === 'scheduled').length}</strong><span>Agendados</span></article>
      <article><strong>{appointments.filter((item) => item.status === 'confirmed').length}</strong><span>Confirmados</span></article>
      <article><strong>{appointments.filter((item) => item.status === 'arrived').length}</strong><span>Chegaram</span></article>
      <article><strong>{appointments.filter((item) => item.status === 'called').length}</strong><span>Chamados</span></article>
      <article><strong>{appointments.filter((item) => item.status === 'completed').length}</strong><span>Concluídos</span></article>
    </div>

    <div className="reception-appointment-toolbar">
      <label className="field"><span className="field-label">De (data e hora)</span><input type="datetime-local" value={fromDate} max={toDate || undefined} onChange={(event) => setFromDate(event.target.value)} /></label>
      <label className="field"><span className="field-label">Até (data e hora)</span><input type="datetime-local" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate(event.target.value)} /></label>
      <label className="field"><span className="field-label">Buscar na agenda</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Paciente, profissional ou local" /></label>
      <label className="field"><span className="field-label">Situação</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | AppointmentStatus)}><option value="all">Todas</option>{Object.entries(appointmentStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button className="button button-primary" type="button" aria-expanded={formOpen} onClick={() => setFormOpen((open) => !open)} disabled={!canCreate}>{formOpen ? 'Fechar formulário' : 'Novo agendamento'}</button>
      <button className="button button-secondary" type="button" onClick={() => void loadAppointments()} disabled={loading}>Aplicar período</button>
    </div>

    {formOpen && <form className="hygiene-panel" onSubmit={(event) => void createAppointment(event)}>
      <div className="section-heading"><div><p className="eyebrow">RECEPÇÃO · AGENDA</p><h2>Novo agendamento</h2></div><CalendarClock size={22} /></div>
      <div className="field-grid field-grid-two">
        <PatientSelect label="Paciente" patients={activePatients} value={patientReference} onChange={setPatientReference} required />
        <label className="field"><span className="field-label">Tipo</span><select value={appointmentType} onChange={(event) => setAppointmentType(event.target.value as AppointmentType)}>{Object.entries(appointmentTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="field"><span className="field-label">Profissional</span><input required minLength={2} maxLength={120} value={professionalName} onChange={(event) => setProfessionalName(event.target.value)} /></label>
        <label className="field"><span className="field-label">Local / sala</span><input required minLength={2} maxLength={120} value={location} onChange={(event) => setLocation(event.target.value)} /></label>
        <label className="field"><span className="field-label">Início</span><input required type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label>
        <label className="field"><span className="field-label">Término</span><input required type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label>
        <label className="field"><span className="field-label">Finalidade administrativa (opcional)</span><input maxLength={300} value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="Não registre informações clínicas ou sensíveis" /></label>
      </div>
      <button className="button button-primary" type="submit" disabled={saving || !canCreate}>{saving ? 'Salvando…' : 'Salvar agendamento'}</button>
    </form>}

    <section className="hygiene-panel" aria-label="Agendamentos">
      <div className="section-heading"><div><p className="eyebrow">PERÍODO SELECIONADO</p><h2>Compromissos</h2></div><span>{filteredAppointments.length} encontrados</span></div>
      {loading ? <p role="status">Carregando agenda…</p> : !filteredAppointments.length ? <p className="empty-state">Nenhum agendamento corresponde aos filtros.</p> : <div className="reception-appointment-list">
        {filteredAppointments.map((appointment) => {
          const allowedNext: AppointmentStatus[] = appointment.status === 'scheduled'
            ? ['confirmed', 'arrived', 'cancelled', 'no_show']
            : appointment.status === 'confirmed'
              ? ['arrived', 'cancelled', 'no_show']
              : appointment.status === 'arrived' ? ['called', 'completed'] : appointment.status === 'called' ? ['completed'] : []
          return <article className="reception-appointment-card" key={appointment.id}>
            <div className="reception-appointment-date"><CalendarClock size={18} /><strong>{displayDateTime(appointment.starts_at)}</strong><span><Clock3 size={14} /> até {new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' }).format(new Date(appointment.ends_at))}</span></div>
            <div className="reception-appointment-info"><strong>{appointment.patient_name}</strong><span>{appointmentTypes[appointment.appointment_type]} · {appointment.professional_name} · {appointment.location}</span>{appointment.purpose && <small>{appointment.purpose}</small>}</div>
            <div className="reception-appointment-state"><span className={`status-badge status-${appointment.status}`}>{appointmentStatuses[appointment.status]}</span>
              {canUpdate && allowedNext.length > 0 && <label className="field"><span className="field-label">Atualizar situação</span><select aria-label={`Atualizar situação de ${appointment.patient_name}`} value="" disabled={updatingId === appointment.id} onChange={(event) => { const status = event.target.value as AppointmentStatus; if (status) void changeStatus(appointment, status) }}><option value="">Ação…</option>{allowedNext.map((status) => <option key={status} value={status}>{appointmentStatuses[status]}</option>)}</select></label>}
            </div>
          </article>
        })}
      </div>}
    </section>
  </div>
}

export default ReceptionAppointmentsPage
