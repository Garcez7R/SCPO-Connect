import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Activity, AlertTriangle, Check, ChevronLeft, Clock3, HeartPulse, LogOut, RefreshCw, ShieldCheck, UsersRound, Wifi, WifiOff } from 'lucide-react'
import { ApiResponseError, readApiResponse, readableApiError } from '../api'
import { readOfflineVault, writeOfflineVault } from '../offline/encryptedVault'
import NursingTriagePanel from '../components/NursingTriagePanel'

type NursingMobileUser = {
  id: string
  name: string
  display_name?: string
  modules: string[]
  permissions: Record<string, string[]>
}

type MobilePatient = {
  reference: string
  name: string
  room: string
  bed: string
}

type VitalsDraft = {
  saturation: string
  pressure: string
  heartRate: string
  respiratoryRate: string
  temperature: string
  glucose: string
}

type RoundPatient = {
  patient_reference: string
  patient_name: string
  room: string
  bed: string
  status: 'pending' | 'checked' | 'exception'
  exception_type: string
  note: string
  elopement_risk: boolean
  checked_by_name: string
  checked_at: string | null
}

type HourlyRound = {
  id: string
  status: 'open' | 'completed'
  started_by_name: string
  started_at: string
  patients: RoundPatient[]
}

type QueuedVital = {
  client_action_id: string
  created_at: string
  expires_at: string
  patient_name: string
  body: {
    patient_reference: string
    values: Record<string, string>
    glucose_unit: 'mg/dL' | 'mmol/L'
    not_applicable: VitalKey[]
    measured_at?: string
    client_action_id: string
  }
  sync_error?: string
}

type QueuedRoundAction = {
  client_action_id: string
  created_at: string
  expires_at: string
  patient_name: string
  round_id: string
  patient_reference: string
  body: {
    status: 'checked' | 'exception'
    exception_type?: string
    note?: string
    occurred_at: string
    client_action_id: string
  }
  sync_error?: string
}

type NursingOfflineData = {
  version: 1
  last_server_contact_at: string
  patients: MobilePatient[]
  round: HourlyRound | null
  pending_vitals: QueuedVital[]
  pending_round_actions: QueuedRoundAction[]
  expired_count: number
}

type Tab = 'vitals' | 'rounds' | 'triage'
type VitalKey = keyof VitalsDraft
const offlineRetentionMs = 24 * 60 * 60 * 1000

const emptyVitals: VitalsDraft = {
  saturation: '',
  pressure: '',
  heartRate: '',
  respiratoryRate: '',
  temperature: '',
  glucose: '',
}

const vitalFields: { key: VitalKey; label: string; unit: string; inputMode: 'decimal' | 'numeric' | 'text'; placeholder?: string }[] = [
  { key: 'saturation', label: 'Saturação', unit: '%', inputMode: 'decimal', placeholder: 'Ex.: 98' },
  { key: 'pressure', label: 'Pressão arterial', unit: 'mmHg', inputMode: 'text', placeholder: 'Ex.: 120/80 ou 12/8' },
  { key: 'heartRate', label: 'Frequência cardíaca', unit: 'bpm', inputMode: 'numeric', placeholder: 'Ex.: 78' },
  { key: 'respiratoryRate', label: 'Frequência respiratória', unit: 'rpm', inputMode: 'numeric', placeholder: 'Ex.: 18' },
  { key: 'temperature', label: 'Temperatura', unit: '°C', inputMode: 'decimal', placeholder: 'Ex.: 36,5' },
  { key: 'glucose', label: 'Glicose', unit: 'mg/dL', inputMode: 'decimal', placeholder: 'Ex.: 95' },
]

const exceptionTypes: Record<string, string> = {
  away: 'Fora do quarto',
  location: 'Em outro local',
  not_found: 'Não localizado',
  other: 'Outra ocorrência',
}

function patientLocation(patient: Pick<MobilePatient, 'room' | 'bed'>) {
  return patient.room && patient.bed ? `Quarto ${patient.room} · Leito ${patient.bed}` : 'Sem quarto/leito'
}

function maskVitalValue(key: VitalKey, value: string) {
  if (key === 'pressure') {
    const [systolic = '', diastolic = ''] = value.split('/')
    const cleanSystolic = systolic.replace(/\D/g, '').slice(0, 4)
    const cleanDiastolic = diastolic.replace(/\D/g, '').slice(0, 4)
    return value.includes('/') ? `${cleanSystolic}/${cleanDiastolic}` : cleanSystolic
  }
  if (key === 'heartRate' || key === 'respiratoryRate') return value.replace(/\D/g, '').slice(0, 4)

  const normalizedValue = value.replace(/[.]/g, ',')
  const [whole = '', ...fractions] = normalizedValue.split(',')
  const maxWholeDigits = key === 'saturation' ? 3 : 6
  const maxFractionDigits = key === 'saturation' ? 2 : 4
  const cleanWhole = whole.replace(/\D/g, '').slice(0, maxWholeDigits)
  if (!normalizedValue.includes(',') || fractions.length === 0) return cleanWhole
  return `${cleanWhole || '0'},${fractions.join('').replace(/\D/g, '').slice(0, maxFractionDigits)}`
}

function formatTime(value: string | null) {
  if (!value) return ''
  return new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' }).format(new Date(value))
}

function emptyOfflineData(): NursingOfflineData {
  return {
    version: 1,
    last_server_contact_at: '',
    patients: [],
    round: null,
    pending_vitals: [],
    pending_round_actions: [],
    expired_count: 0,
  }
}

function offlineSnapshotIsFresh(lastContactAt: string) {
  const timestamp = Date.parse(lastContactAt)
  const age = Date.now() - timestamp
  return Number.isFinite(timestamp) && age >= 0 && age <= offlineRetentionMs
}

function isTemporaryConnectionError(error: unknown) {
  return error instanceof TypeError
    || (error instanceof ApiResponseError && error.status >= 500)
    || (error instanceof Error && /HTTP 5\d\d|serviço está indisponível/i.test(error.message))
}

export default function NursingMobilePage({
  user,
  onLogout,
}: {
  user: NursingMobileUser
  onLogout: () => void
}) {
  const [tab, setTab] = useState<Tab>('vitals')
  const [patients, setPatients] = useState<MobilePatient[]>([])
  const [selectedPatient, setSelectedPatient] = useState('')
  const [vitals, setVitals] = useState<VitalsDraft>({ ...emptyVitals })
  const [notApplicable, setNotApplicable] = useState<VitalKey[]>([])
  const [glucoseUnit, setGlucoseUnit] = useState<'mg/dL' | 'mmol/L'>('mg/dL')
  const [round, setRound] = useState<HourlyRound | null>(null)
  const [exceptionPatient, setExceptionPatient] = useState('')
  const [exceptionType, setExceptionType] = useState('away')
  const [exceptionNote, setExceptionNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [dataReady, setDataReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [serverAvailable, setServerAvailable] = useState(false)
  const [offlineData, setOfflineData] = useState<NursingOfflineData>(emptyOfflineData)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saved, setSaved] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [vaultError, setVaultError] = useState('')
  const syncLock = useRef(false)
  const offlineDataRef = useRef(offlineData)

  const hasNursingAccess = user.modules.includes('nursing')
  const canCreateVitals = user.permissions.nursing?.includes('criar') ?? false
  const canUpdateRounds = user.permissions.nursing?.includes('alterar') ?? false
  const canStartRounds = canUpdateRounds
  const vaultId = `nursing:${user.id}`
  const inpatientPatients = useMemo(
    () => patients.filter((patient) => patient.room.trim() && patient.bed.trim()),
    [patients],
  )

  const persistOfflineData = useCallback(async (next: NursingOfflineData) => {
    await writeOfflineVault(vaultId, next)
    offlineDataRef.current = next
    setOfflineData(next)
  }, [vaultId])

  const syncPendingActions = useCallback(async (retryRejected = false) => {
    if (syncLock.current || !navigator.onLine) return
    syncLock.current = true
    setSyncing(true)
    let syncedCount = 0
    let connectionLost = false
    try {
      const session = await readApiResponse<{ user: { id: string } }>(
        await fetch('/api/v1/auth/session'),
      )
      if (session.user.id !== user.id) {
        setError('A fila pertence a outra conta. Entre com a mesma conta da Enfermagem para sincronizar.')
        return
      }

      const current = offlineDataRef.current
      const now = Date.now()
      const activeVitals = current.pending_vitals.filter((action) => Date.parse(action.expires_at) > now)
      const activeRoundActions = current.pending_round_actions.filter((action) => Date.parse(action.expires_at) > now)
      const expired = current.pending_vitals.length + current.pending_round_actions.length
        - activeVitals.length - activeRoundActions.length
      let next: NursingOfflineData = {
        ...current,
        pending_vitals: retryRejected ? activeVitals.map((action) => ({ ...action, sync_error: undefined })) : activeVitals,
        pending_round_actions: retryRejected ? activeRoundActions.map((action) => ({ ...action, sync_error: undefined })) : activeRoundActions,
        expired_count: current.expired_count + expired,
      }
      if (expired || retryRejected) await persistOfflineData(next)

      for (const action of [...next.pending_vitals]) {
        if (action.sync_error && !retryRejected) continue
        try {
          const response = await fetch('/api/v1/nursing/vitals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(action.body),
          })
          await readApiResponse(response)
          next = {
            ...next,
            pending_vitals: next.pending_vitals.filter((item) => item.client_action_id !== action.client_action_id),
          }
          await persistOfflineData(next)
          syncedCount += 1
        } catch (syncError) {
          if (syncError instanceof ApiResponseError && syncError.status === 401) {
            setError('Sua sessão expirou. Reconecte e entre novamente para sincronizar; as pendências continuam cifradas no aparelho.')
            onLogout()
            return
          }
          if (isTemporaryConnectionError(syncError)) {
            setServerAvailable(false)
            setOnline(navigator.onLine)
            connectionLost = true
            break
          }
          const message = readableApiError(syncError)
          next = {
            ...next,
            pending_vitals: next.pending_vitals.map((item) =>
              item.client_action_id === action.client_action_id ? { ...item, sync_error: message } : item,
            ),
          }
          await persistOfflineData(next)
        }
      }

      if (connectionLost) return

      for (const action of [...next.pending_round_actions]) {
        if (action.sync_error && !retryRejected) continue
        try {
          const response = await fetch(
            `/api/v1/nursing/hourly-rounds/${encodeURIComponent(action.round_id)}/patients/${encodeURIComponent(action.patient_reference)}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(action.body),
            },
          )
          const updated = await readApiResponse<HourlyRound>(response)
          next = {
            ...next,
            round: updated,
            pending_round_actions: next.pending_round_actions.filter((item) => item.client_action_id !== action.client_action_id),
          }
          await persistOfflineData(next)
          syncedCount += 1
        } catch (syncError) {
          if (syncError instanceof ApiResponseError && syncError.status === 401) {
            setError('Sua sessão expirou. Reconecte e entre novamente para sincronizar; as pendências continuam cifradas no aparelho.')
            onLogout()
            return
          }
          if (isTemporaryConnectionError(syncError)) {
            setServerAvailable(false)
            setOnline(navigator.onLine)
            connectionLost = true
            break
          }
          const message = readableApiError(syncError)
          next = {
            ...next,
            pending_round_actions: next.pending_round_actions.map((item) =>
              item.client_action_id === action.client_action_id ? { ...item, sync_error: message } : item,
            ),
          }
          await persistOfflineData(next)
        }
      }

      if (connectionLost) return
      setServerAvailable(true)
      if (syncedCount) setNotice(`${syncedCount} registro(s) offline sincronizado(s) e confirmado(s) pelo servidor.`)
    } catch (syncError) {
      if (isTemporaryConnectionError(syncError)) {
        setServerAvailable(false)
      } else {
        setError(`Não foi possível validar a sessão para sincronizar. As pendências permanecem cifradas no aparelho. ${readableApiError(syncError)}`)
      }
    } finally {
      setSyncing(false)
      syncLock.current = false
    }
  }, [onLogout, persistOfflineData, user.id])

  const loadData = useCallback(async () => {
    setLoading(true)
    setDataReady(false)
    setError('')
    try {
      const [patientData, roundData] = await Promise.all([
        fetch('/api/v1/nursing/patients?inpatient=true&sort=location&limit=200').then((response) =>
          readApiResponse<{ patients: MobilePatient[]; total: number }>(response),
        ),
        fetch('/api/v1/nursing/hourly-rounds/current').then((response) =>
          readApiResponse<{ round: HourlyRound | null }>(response),
        ),
      ])
      if (patientData.total > patientData.patients.length) {
        throw new Error('A lista de pacientes excede o limite seguro de cache móvel. Use o módulo completo para consultar todos os pacientes.')
      }
      const cached = await readOfflineVault<NursingOfflineData>(vaultId)
      const previous = cached?.payload ?? emptyOfflineData()
      const next: NursingOfflineData = {
        ...previous,
        last_server_contact_at: new Date().toISOString(),
        patients: patientData.patients,
        round: roundData.round,
      }
      setPatients(next.patients)
      setSelectedPatient((current) =>
        next.patients.some((patient) => patient.reference === current)
          ? current
          : next.patients[0]?.reference ?? '',
      )
      setRound(next.round)
      offlineDataRef.current = next
      setOfflineData(next)
      setDataReady(true)
      setServerAvailable(true)
      setVaultError('')
      try {
        await persistOfflineData(next)
      } catch (cacheError) {
        setVaultError(readableApiError(cacheError))
        setError(`Pacientes carregados do servidor, mas não foi possível salvar o cache cifrado neste aparelho. ${readableApiError(cacheError)}`)
      }
    } catch (loadError) {
      if (loadError instanceof ApiResponseError && loadError.status === 401) {
        setDataReady(false)
        setServerAvailable(false)
        setError('Sua sessão expirou. Entre novamente para continuar; as pendências offline permanecem cifradas no aparelho.')
        onLogout()
        return
      }
      if (loadError instanceof ApiResponseError && loadError.status === 403) {
        setDataReady(false)
        setServerAvailable(false)
        setError('Seu perfil não tem mais permissão para consultar os registros da Enfermagem.')
        return
      }
      if (isTemporaryConnectionError(loadError)) {
        try {
          const cached = await readOfflineVault<NursingOfflineData>(vaultId)
          if (!cached) throw new Error('Ainda não há uma lista de pacientes salva para uso offline.', { cause: loadError })
          const now = Date.now()
          const payload = cached.payload
          const pendingVitals = payload.pending_vitals.filter((action) => Date.parse(action.expires_at) > now)
          const pendingRoundActions = payload.pending_round_actions.filter((action) => Date.parse(action.expires_at) > now)
          const expired = payload.pending_vitals.length + payload.pending_round_actions.length
            - pendingVitals.length - pendingRoundActions.length
          const snapshotFresh = offlineSnapshotIsFresh(payload.last_server_contact_at)
          const next = {
            ...payload,
            patients: snapshotFresh ? payload.patients : [],
            round: snapshotFresh ? payload.round : null,
            pending_vitals: pendingVitals,
            pending_round_actions: pendingRoundActions,
            expired_count: payload.expired_count + expired,
          }
          if (expired || !snapshotFresh) await persistOfflineData(next)
          setPatients(next.patients)
          setSelectedPatient((current) =>
            next.patients.some((patient) => patient.reference === current)
              ? current
              : next.patients[0]?.reference ?? '',
          )
          setRound(next.round)
          offlineDataRef.current = next
          setOfflineData(next)
          setDataReady(snapshotFresh)
          setServerAvailable(false)
          setError('')
          if (!snapshotFresh) {
            setError('A lista de pacientes salva há mais de 24 horas expirou. Reconecte ao servidor para atualizar antes de registrar.')
          }
        } catch (vaultLoadError) {
          setDataReady(false)
          setServerAvailable(false)
          setVaultError(readableApiError(vaultLoadError))
          setError(`Sem conexão com o servidor e sem dados móveis válidos. ${readableApiError(vaultLoadError)}`)
        }
      } else {
        setServerAvailable(false)
        setError(readableApiError(loadError))
      }
    } finally {
      setLoading(false)
    }
  }, [onLogout, persistOfflineData, vaultId])

  useEffect(() => {
    if (!hasNursingAccess) return
    const timer = window.setTimeout(() => void loadData(), 0)
    return () => window.clearTimeout(timer)
  }, [hasNursingAccess, loadData])

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true)
      void loadData()
    }
    const handleOffline = () => {
      setOnline(false)
      setServerAvailable(false)
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [loadData])

  useEffect(() => {
    if (!online || !serverAvailable) return
    const hasPending = offlineData.pending_vitals.some((action) => !action.sync_error)
      || offlineData.pending_round_actions.some((action) => !action.sync_error)
    if (!hasPending) return
    const timer = window.setTimeout(() => void syncPendingActions(), 0)
    return () => window.clearTimeout(timer)
  }, [offlineData.pending_round_actions, offlineData.pending_vitals, online, serverAvailable, syncPendingActions])

  function setVital(key: VitalKey, value: string) {
    setVitals((current) => ({ ...current, [key]: maskVitalValue(key, value) }))
    setNotApplicable((current) => current.filter((field) => field !== key))
    setSaved(false)
    setNotice('')
  }

  function toggleNotApplicable(key: VitalKey) {
    setNotApplicable((current) => current.includes(key) ? current.filter((field) => field !== key) : [...current, key])
    setVitals((current) => ({ ...current, [key]: '' }))
    setSaved(false)
    setNotice('')
  }

  async function queueVitalAction(
    body: QueuedVital['body'],
    patientName: string,
  ) {
    const current = offlineDataRef.current
    if (!dataReady || !offlineSnapshotIsFresh(current.last_server_contact_at)) {
      throw new Error('Os dados do paciente expiraram. Reconecte ao servidor e atualize antes de registrar offline.')
    }
    const createdAt = new Date().toISOString()
    const action: QueuedVital = {
      client_action_id: body.client_action_id,
      created_at: createdAt,
      expires_at: new Date(Date.parse(createdAt) + offlineRetentionMs).toISOString(),
      patient_name: patientName,
      body: { ...body, measured_at: body.measured_at ?? createdAt },
    }
    await persistOfflineData({ ...current, pending_vitals: [...current.pending_vitals, action] })
    setServerAvailable(false)
    setSaved(true)
    setNotice('Coleta cifrada e guardada neste aparelho. Será enviada ao servidor quando a conexão voltar; ainda não consta no histórico clínico.')
    setVitals({ ...emptyVitals })
    setNotApplicable([])
  }

  async function saveVitals(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedPatient) {
      setError('Selecione um paciente antes de salvar a coleta.')
      return
    }
    const values = Object.fromEntries(
      Object.entries(vitals).filter(([, value]) => value.trim()),
    )
    if (!Object.keys(values).length && !notApplicable.length) {
      setError('Preencha ao menos um sinal vital ou marque um campo como não aferido.')
      return
    }
    const clientActionId = crypto.randomUUID()
    const body: QueuedVital['body'] = {
      patient_reference: selectedPatient,
      values,
      glucose_unit: glucoseUnit,
      not_applicable: notApplicable,
      ...(serverAvailable ? {} : { measured_at: new Date().toISOString() }),
      client_action_id: clientActionId,
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (!serverAvailable) {
        await queueVitalAction(body, patients.find((patient) => patient.reference === selectedPatient)?.name ?? 'Paciente')
        return
      }
      let response: Response
      try {
        response = await fetch('/api/v1/nursing/vitals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      } catch (requestError) {
        if (!isTemporaryConnectionError(requestError)) throw requestError
        await queueVitalAction(body, patients.find((patient) => patient.reference === selectedPatient)?.name ?? 'Paciente')
        return
      }
      if (response.status >= 500) {
        setServerAvailable(false)
        await queueVitalAction(body, patients.find((patient) => patient.reference === selectedPatient)?.name ?? 'Paciente')
        return
      }
      await readApiResponse(response)
      setVitals({ ...emptyVitals })
      setNotApplicable([])
      setSaved(true)
      setNotice('Coleta salva no servidor com sua identificação e horário registrados.')
      const current = offlineDataRef.current
      try {
        await persistOfflineData({ ...current, last_server_contact_at: new Date().toISOString() })
      } catch (cacheError) {
        setError(`A coleta foi confirmada pelo servidor, mas o cache cifrado não pôde ser atualizado neste aparelho. ${readableApiError(cacheError)}`)
      }
    } catch (saveError) {
      setError(`A coleta não foi registrada. ${readableApiError(saveError)}`)
    } finally {
      setBusy(false)
    }
  }

  async function startRound() {
    if (!serverAvailable) {
      setError('É necessário conectar ao servidor para iniciar uma nova verificação horária.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await readApiResponse<HourlyRound>(await fetch('/api/v1/nursing/hourly-rounds', { method: 'POST' }))
      setNotice('Verificação horária iniciada no servidor.')
      await loadData()
      setTab('rounds')
    } catch (startError) {
      setError(readableApiError(startError))
      await loadData()
    } finally {
      setBusy(false)
    }
  }

  async function updateRoundPatient(
    patient: RoundPatient,
    result: { status: 'checked' } | { status: 'exception'; exception_type: string; note: string },
  ) {
    if (!round) return
    setBusy(true)
    setError('')
    setNotice('')
    const clientActionId = crypto.randomUUID()
    const occurredAt = new Date().toISOString()
    const body: QueuedRoundAction['body'] = {
      ...result,
      occurred_at: occurredAt,
      client_action_id: clientActionId,
    }
    try {
      const current = offlineDataRef.current
      if (!dataReady || !offlineSnapshotIsFresh(current.last_server_contact_at)) {
        throw new Error('A verificação horária salva há mais de 24 horas expirou. Reconecte para atualizar antes de registrar.')
      }
      if (!serverAvailable) {
        await queueRoundAction(patient, round.id, body)
        return
      }
      let response: Response
      try {
        response = await fetch(
          `/api/v1/nursing/hourly-rounds/${encodeURIComponent(round.id)}/patients/${encodeURIComponent(patient.patient_reference)}`,
          {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
        )
      } catch (requestError) {
        if (!isTemporaryConnectionError(requestError)) throw requestError
        await queueRoundAction(patient, round.id, body)
        return
      }
      if (response.status >= 500) {
        setServerAvailable(false)
        await queueRoundAction(patient, round.id, body)
        return
      }
      const updated = await readApiResponse<HourlyRound>(response)
      setRound(updated)
      setExceptionPatient('')
      setExceptionNote('')
      setNotice(`Verificação de ${patient.patient_name} registrada.`)
      try {
        await persistOfflineData({
          ...offlineDataRef.current,
          round: updated,
          last_server_contact_at: new Date().toISOString(),
        })
      } catch (cacheError) {
        setError(`A verificação foi confirmada pelo servidor, mas o cache cifrado não pôde ser atualizado neste aparelho. ${readableApiError(cacheError)}`)
      }
    } catch (updateError) {
      setError(readableApiError(updateError))
    } finally {
      setBusy(false)
    }
  }

  async function queueRoundAction(
    patient: RoundPatient,
    roundId: string,
    body: QueuedRoundAction['body'],
  ) {
    const current = offlineDataRef.current
    if (!current.round || current.round.id !== roundId || current.round.status !== 'open') {
      throw new Error('A verificação horária não está atualizada. Reconecte ao servidor antes de registrar.')
    }
    const createdAt = new Date().toISOString()
    const action: QueuedRoundAction = {
      client_action_id: body.client_action_id,
      created_at: createdAt,
      expires_at: new Date(Date.parse(createdAt) + offlineRetentionMs).toISOString(),
      patient_name: patient.patient_name,
      round_id: roundId,
      patient_reference: patient.patient_reference,
      body,
    }
    const updatedRound: HourlyRound = {
      ...current.round,
      patients: current.round.patients.map((item) =>
        item.patient_reference === patient.patient_reference
          ? {
            ...item,
            status: body.status,
            exception_type: body.exception_type ?? '',
            note: body.note ?? '',
            checked_by_name: user.display_name || user.name,
            checked_at: body.occurred_at,
          }
          : item,
      ),
    }
    await persistOfflineData({
      ...current,
      round: updatedRound,
      pending_round_actions: [...current.pending_round_actions, action],
    })
    setRound(updatedRound)
    setExceptionPatient('')
    setExceptionNote('')
    setServerAvailable(false)
    setNotice(`Verificação de ${patient.patient_name} guardada cifrada; ainda não foi confirmada pelo servidor.`)
  }

  async function completeRound() {
    if (!round) return
    if (!serverAvailable) {
      setError('É necessário conectar ao servidor para encerrar a verificação horária.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await readApiResponse<HourlyRound>(await fetch(
        `/api/v1/nursing/hourly-rounds/${encodeURIComponent(round.id)}/complete`,
        { method: 'POST' },
      ))
      setNotice('Verificação horária encerrada e registrada no servidor.')
      await loadData()
    } catch (completeError) {
      setError(readableApiError(completeError))
    } finally {
      setBusy(false)
    }
  }

  if (!hasNursingAccess) {
    return <main className="nursing-mobile-page nursing-mobile-denied">
      <img src="/scpo-connect-icon.png" alt="" />
      <h1>Acesso à Enfermagem necessário</h1>
      <p>Esta interface exige uma conta com acesso ao módulo Enfermagem.</p>
      <a className="button button-secondary" href="/">Voltar ao SCPO Connect</a>
      <button className="button button-secondary" type="button" onClick={onLogout}>Sair</button>
    </main>
  }

  const pendingCount = round?.patients.filter((patient) => patient.status === 'pending').length ?? 0
  const pendingTotal = offlineData.pending_vitals.length + offlineData.pending_round_actions.length
  const serverLabel = serverAvailable ? 'Servidor conectado' : online ? 'Servidor indisponível' : 'Sem conexão'
  const queuedRoundAction = (patientReference: string) =>
    offlineData.pending_round_actions.find((action) => action.patient_reference === patientReference)
  const syncedRoundCount = round?.patients.filter((patient) =>
    patient.status !== 'pending' && !queuedRoundAction(patient.patient_reference),
  ).length ?? 0

  return <main className="nursing-mobile-page">
    <header className="nursing-mobile-header">
      <div className="nursing-mobile-brand"><img src="/scpo-connect-icon.png" alt="" /><div><span>SCPO CONNECT</span><strong>Enfermagem</strong></div></div>
      <button className="nursing-mobile-logout" type="button" onClick={() => { void fetch('/api/v1/auth/logout', { method: 'POST' }); onLogout() }} aria-label="Sair"><LogOut size={18} /></button>
    </header>
    <section className="nursing-mobile-identity">
      <div><p className="eyebrow">COLETA ASSISTENCIAL</p><h1>Olá, {(user.display_name || user.name).split(/\s+/)[0]}</h1></div>
      <span className={`nursing-mobile-connection ${serverAvailable ? 'is-online' : 'is-offline'}`}><i />{serverAvailable ? <><Wifi size={14} /> {serverLabel}</> : <><WifiOff size={14} /> {serverLabel}</>}</span>
    </section>
    {!serverAvailable && tab !== 'triage' && <div className="nursing-mobile-connectivity-warning" role="status"><WifiOff size={17} /><span>Sem comunicação com o servidor. Você pode registrar sinais vitais e verificações usando a lista cifrada salva neste aparelho; os registros só entram no histórico após a sincronização confirmada. Triagem exige conexão e não fica salva offline.</span></div>}
    {offlineData.expired_count > 0 && <div className="nursing-mobile-message nursing-mobile-error" role="alert"><AlertTriangle size={17} /><span>{offlineData.expired_count} registro(s) offline expiraram após 24 horas e foram removidos conforme a política de retenção. Confirme e registre novamente conforme o procedimento da equipe.</span></div>}
    {pendingTotal > 0 && <section className="nursing-mobile-pending" aria-label="Registros pendentes de sincronização">
    <div className="nursing-mobile-pending-heading"><strong>{syncing ? 'Sincronizando registros…' : `${pendingTotal} registro(s) pendente(s)`}</strong>{serverAvailable && !syncing && <button className="button button-secondary" type="button" onClick={() => void syncPendingActions(true)}><RefreshCw size={15} /> Sincronizar agora</button>}</div>
      {[...offlineData.pending_vitals.map((action) => ({ id: action.client_action_id, kind: 'Sinais vitais', patient: action.patient_name, createdAt: action.created_at, error: action.sync_error })), ...offlineData.pending_round_actions.map((action) => ({ id: action.client_action_id, kind: 'Verificação horária', patient: action.patient_name, createdAt: action.created_at, error: action.sync_error }))].map((action) => <div className="nursing-mobile-pending-item" key={action.id}><span><strong>{action.kind}</strong> · {action.patient} · {formatTime(action.createdAt)}</span><small>{action.error ? `Conflito: ${action.error}` : 'Aguardando confirmação do servidor'}</small></div>)}
      <p>As pendências ficam cifradas neste aparelho por até 24 horas. Mantenha esta sessão autenticada e conecte-se à rede local para sincronizar.</p>
    </section>}
    {error && <div className="nursing-mobile-message nursing-mobile-error" role="alert"><AlertTriangle size={17} /><span>{error}</span></div>}
    {vaultError && <div className="nursing-mobile-message nursing-mobile-error" role="alert"><AlertTriangle size={17} /><span>{vaultError}</span></div>}
    {notice && <div className="nursing-mobile-message nursing-mobile-success" role="status"><Check size={17} /><span>{notice}</span></div>}

    <nav className="nursing-mobile-tabs" aria-label="Tarefas da Enfermagem">
      <button type="button" aria-pressed={tab === 'vitals'} className={tab === 'vitals' ? 'is-active' : ''} onClick={() => { setTab('vitals'); setError(''); setNotice('') }}><HeartPulse size={18} /> Sinais vitais</button>
      <button type="button" aria-pressed={tab === 'rounds'} className={tab === 'rounds' ? 'is-active' : ''} onClick={() => { setTab('rounds'); setError(''); setNotice('') }}><Clock3 size={18} /> Verificação horária{round && <span className="nursing-mobile-tab-count">{pendingCount}</span>}</button>
      <button type="button" aria-pressed={tab === 'triage'} className={tab === 'triage' ? 'is-active' : ''} onClick={() => { setTab('triage'); setError(''); setNotice('') }}><ShieldCheck size={18} /> Triagem</button>
    </nav>

    {tab === 'triage' && <section className="nursing-mobile-panel">
      <NursingTriagePanel canUpdate={canCreateVitals && serverAvailable && online} isOnline={serverAvailable && online} />
    </section>}

    {tab === 'vitals' && <section className="nursing-mobile-panel">
      <div className="nursing-mobile-section-title"><div><p className="eyebrow">REGISTRO NO SERVIDOR</p><h2><Activity size={19} /> Sinais vitais</h2></div><button className="nursing-mobile-refresh" type="button" onClick={() => void loadData()} disabled={loading || busy} aria-label="Atualizar pacientes"><RefreshCw size={17} /></button></div>
      {loading ? <div className="nursing-mobile-loading" role="status"><span className="spinner" /> Carregando pacientes…</div> : <form onSubmit={(event) => void saveVitals(event)}>
        <label className="field nursing-mobile-patient-field"><span className="field-label">Paciente</span><select required value={selectedPatient} onChange={(event) => { setSelectedPatient(event.target.value); setSaved(false) }}><option value="">Selecione</option>{patients.map((patient) => <option key={patient.reference} value={patient.reference}>{patient.name} · {patientLocation(patient)}</option>)}</select></label>
        {patients.length === 0 && <p className="nursing-mobile-empty"><UsersRound size={18} /> Não há pacientes ativos disponíveis para coleta.</p>}
        <div className="nursing-mobile-vital-list">{vitalFields.map(({ key, label, unit, inputMode, placeholder }) => <div className="nursing-mobile-vital-field" key={key}>
          <label className="field"><span className="field-label">{label} <small>{key === 'glucose' ? glucoseUnit : unit}</small></span><input
            type="text"
            inputMode={inputMode}
            autoComplete="off"
            disabled={!canCreateVitals || notApplicable.includes(key) || !selectedPatient}
            value={vitals[key]}
            onChange={(event) => setVital(key, event.target.value)}
            placeholder={placeholder}
            maxLength={key === 'pressure' ? 9 : 12}
            pattern={key === 'pressure' ? '\\d{1,4}/\\d{1,4}' : key === 'saturation' ? '\\d{1,3}(?:[.,]\\d{1,2})?' : '\\d{1,6}(?:[.,]\\d{1,4})?'}
            title={key === 'pressure' ? 'Informe sistólica/diastólica, por exemplo 120/80.' : undefined}
          /></label>
          <label className="nursing-mobile-not-applicable"><input type="checkbox" checked={notApplicable.includes(key)} disabled={!canCreateVitals || !selectedPatient} onChange={() => toggleNotApplicable(key)} /><span>Não aferido</span></label>
          {key === 'glucose' && <label className="field nursing-mobile-glucose-unit"><span className="field-label">Unidade</span><select value={glucoseUnit} onChange={(event) => setGlucoseUnit(event.target.value as 'mg/dL' | 'mmol/L')}><option>mg/dL</option><option>mmol/L</option></select></label>}
        </div>)}</div>
        {!canCreateVitals && <p className="nursing-mobile-empty"><ShieldCheck size={17} /> Seu perfil pode consultar, mas não registrar sinais vitais.</p>}
        <button className="button button-primary nursing-mobile-submit" type="submit" disabled={busy || syncing || loading || !dataReady || !canCreateVitals || !selectedPatient || saved || (!serverAvailable && !offlineSnapshotIsFresh(offlineData.last_server_contact_at))}>{busy ? serverAvailable ? 'Enviando ao servidor…' : 'Protegendo no aparelho…' : saved ? 'Registro preparado' : serverAvailable ? 'Salvar coleta' : 'Registrar sem conexão'}</button>
        <p className="nursing-mobile-footnote">Com conexão, o horário e a autoria são registrados pelo servidor. Sem conexão, o horário do aparelho é preservado e a autoria será confirmada ao sincronizar.</p>
      </form>}
    </section>}

    {tab === 'rounds' && <section className="nursing-mobile-panel">
      <div className="nursing-mobile-section-title"><div><p className="eyebrow">ACOMPANHAMENTO DE INTERNADOS</p><h2><Clock3 size={19} /> Verificação horária</h2></div><button className="nursing-mobile-refresh" type="button" onClick={() => void loadData()} disabled={loading || busy} aria-label="Atualizar verificação"><RefreshCw size={17} /></button></div>
      <p className="nursing-mobile-footnote">Toque em <strong>Registrar verificação</strong> para enviar imediatamente ao servidor. Sem comunicação, a ação fica cifrada no aparelho e é sincronizada quando o servidor voltar a ficar acessível.</p>
      {loading ? <div className="nursing-mobile-loading" role="status"><span className="spinner" /> Atualizando verificação…</div> : !round ? <div className="nursing-mobile-round-empty"><span className="nursing-mobile-empty-icon"><Clock3 size={21} /></span><strong>Nenhuma verificação em andamento</strong><p>A nova verificação inclui pacientes ativos com quarto e leito.</p><button className="button button-primary nursing-mobile-submit" type="button" onClick={() => void startRound()} disabled={busy || !dataReady || !online || !canStartRounds || !inpatientPatients.length}>{busy ? 'Iniciando…' : 'Iniciar verificação horária'}</button>{!canStartRounds && <small>Seu perfil não pode iniciar uma verificação.</small>}{inpatientPatients.length === 0 && <small>Não há pacientes com quarto e leito cadastrados.</small>}</div> : <div className="nursing-mobile-round">
        <div className="nursing-mobile-round-summary"><span><strong>{syncedRoundCount}</strong> confirmados pelo servidor · <strong>{pendingCount}</strong> ainda não verificados</span><span>Iniciada às {formatTime(round.started_at)} · {round.started_by_name}</span></div>
        <div className="nursing-mobile-round-list">{round.patients.map((patient) => <article className={`nursing-mobile-round-patient nursing-round-${patient.status}`} key={patient.patient_reference}>
          <div className="nursing-mobile-round-patient-heading"><div><strong>{patient.patient_name}</strong><span>{patientLocation(patient)}</span></div>{patient.elopement_risk && <span className="nursing-mobile-risk"><AlertTriangle size={13} /> Risco de evasão</span>}</div>
          {patient.status === 'checked' && <p className="nursing-mobile-round-result"><Check size={15} /> Verificado por {patient.checked_by_name} · {formatTime(patient.checked_at)}</p>}
          {patient.status === 'exception' && <p className="nursing-mobile-round-result nursing-mobile-exception"><AlertTriangle size={15} /> {exceptionTypes[patient.exception_type] ?? 'Ocorrência'}{patient.note ? ` · ${patient.note}` : ''}{patient.checked_by_name ? ` · ${patient.checked_by_name}` : ''}</p>}
          {queuedRoundAction(patient.patient_reference) && <p className="nursing-mobile-round-result nursing-mobile-sync-pending"><RefreshCw size={14} /> {queuedRoundAction(patient.patient_reference)?.sync_error ? `Conflito de sincronização: ${queuedRoundAction(patient.patient_reference)?.sync_error}` : 'Verificação registrada neste aparelho; aguardando servidor.'}</p>}
          {patient.status === 'pending' && canUpdateRounds && dataReady && <div className="nursing-mobile-round-actions">
            {exceptionPatient === patient.patient_reference ? <form onSubmit={(event) => { event.preventDefault(); void updateRoundPatient(patient, { status: 'exception', exception_type: exceptionType, note: exceptionNote }) }}>
              <label className="field"><span className="field-label">Ocorrência</span><select value={exceptionType} onChange={(event) => setExceptionType(event.target.value)}>{Object.entries(exceptionTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="field"><span className="field-label">Descrição breve</span><input required minLength={3} maxLength={500} value={exceptionNote} onChange={(event) => setExceptionNote(event.target.value)} /></label>
              <div><button className="button button-primary" type="submit" disabled={busy}>Registrar ocorrência</button><button className="button button-secondary" type="button" onClick={() => { setExceptionPatient(''); setExceptionNote('') }} disabled={busy}>Cancelar</button></div>
            </form> : <><button className="button button-primary" type="button" onClick={() => void updateRoundPatient(patient, { status: 'checked' })} disabled={busy}><Check size={16} /> {serverAvailable ? 'Registrar verificação' : 'Guardar verificação'}</button><button className="button button-secondary" type="button" onClick={() => { setExceptionPatient(patient.patient_reference); setExceptionType('away'); setExceptionNote('') }} disabled={busy}><AlertTriangle size={16} /> Ocorrência</button></>}
          </div>}
          {patient.status === 'pending' && !canUpdateRounds && <p className="nursing-mobile-empty">Seu perfil não pode registrar verificações.</p>}
        </article>)}</div>
        {pendingCount === 0 && <button className="button button-primary nursing-mobile-submit" type="button" onClick={() => void completeRound()} disabled={busy || syncing || !dataReady || !serverAvailable || offlineData.pending_round_actions.length > 0 || !canUpdateRounds}>{busy ? 'Encerrando…' : 'Encerrar verificação'}</button>}
        <button className="button button-secondary nursing-mobile-submit" type="button" onClick={() => void loadData()} disabled={busy || loading}><RefreshCw size={16} /> Atualizar lista</button>
      </div>}
    </section>}
    <footer className="nursing-mobile-footer"><span><ShieldCheck size={15} /> Dados transmitidos ao servidor autenticado</span><a href="/"><ChevronLeft size={15} /> Sistema completo</a></footer>
  </main>
}
