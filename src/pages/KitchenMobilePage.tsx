import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Clock3, LogOut, RefreshCw, Search, UtensilsCrossed, Wifi, WifiOff } from 'lucide-react'
import { readApiResponse } from '../api'

type KitchenPatient = {
  patient_reference: string
  patient_name: string
  room: string
  bed: string
  diet_type: string
  assessment_date: string | null
  allergies_status: 'unknown' | 'none_known' | 'known'
  allergies: string
  restrictions: string
  fasting_at: string | null
  fasting_reason: string
}

type KitchenUser = {
  id: string
  name: string
  display_name: string
  modules: string[]
  permissions: Record<string, string[]>
  is_superuser: boolean
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function formatAssessmentDate(value: string | null) {
  if (!value) return 'Sem avaliação registrada'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
}

export default function KitchenMobilePage({ user, onLogout }: {
  user: KitchenUser
  onLogout: () => void
}) {
  const canAccess = user.is_superuser || ['nutrition', 'management', 'admin', 'oversight'].some((module) =>
    user.modules.includes(module) && (
      user.permissions[module]?.includes('consultar')
      || (module === 'admin' && user.permissions[module]?.includes('administrar'))
    ),
  )
  const [patients, setPatients] = useState<KitchenPatient[]>([])
  const [updatedAt, setUpdatedAt] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [error, setError] = useState('')

  const fetchRoster = useCallback(async () => readApiResponse<{ patients: KitchenPatient[]; updated_at: string }>(
    await fetch('/api/v1/nursing/nutrition/kitchen'),
  ), [])

  useEffect(() => {
    if (!canAccess) return
    let active = true
    void fetchRoster().then((roster) => {
      if (!active) return
      setPatients(roster.patients)
      setUpdatedAt(roster.updated_at)
      setError('')
    }).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar o mapa da cozinha.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [canAccess, fetchRoster])

  const refreshRoster = async () => {
    setRefreshing(true)
    setError('')
    try {
      const roster = await fetchRoster()
      setPatients(roster.patients)
      setUpdatedAt(roster.updated_at)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível atualizar o mapa da cozinha.')
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const visiblePatients = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR')
    if (!normalizedQuery) return patients
    return patients.filter((patient) =>
      `${patient.patient_name} ${patient.room} ${patient.bed} ${patient.diet_type} ${patient.allergies} ${patient.restrictions} ${patient.fasting_reason}`
        .toLocaleLowerCase('pt-BR')
        .includes(normalizedQuery),
    )
  }, [patients, query])

  if (!canAccess) {
    return <main className="kitchen-mobile-shell kitchen-mobile-denied">
      <img src="/scpo-connect-icon.png" alt="" />
      <h1>Acesso não autorizado</h1>
      <p>Seu perfil não tem permissão para consultar o mapa da cozinha. Solicite a liberação ao administrador.</p>
      <a className="button button-secondary" href="/">Abrir sistema completo</a>
    </main>
  }

  return <main className="kitchen-mobile-shell">
    <header className="kitchen-mobile-header">
      <div className="kitchen-mobile-brand">
        <img src="/scpo-connect-icon.png" alt="" />
        <div><p className="eyebrow">SCPO CONNECT</p><h1><UtensilsCrossed size={19} /> Cozinha</h1></div>
      </div>
      <button className="button button-secondary kitchen-mobile-logout" type="button" onClick={onLogout}><LogOut size={16} /><span>Sair</span></button>
    </header>

    <section className="kitchen-mobile-content" aria-labelledby="kitchen-mobile-title">
      <div className="kitchen-mobile-title-row">
        <div><h2 id="kitchen-mobile-title">Refeições dos internados</h2><p>Confira a identificação, a dieta e os alertas antes de montar cada refeição.</p></div>
        <button className="button button-secondary kitchen-mobile-refresh" type="button" onClick={() => void refreshRoster()} disabled={refreshing || !online} aria-label="Atualizar mapa">
          <RefreshCw size={17} className={refreshing ? 'kitchen-mobile-spinning' : undefined} />
          <span>{refreshing ? 'Atualizando' : 'Atualizar'}</span>
        </button>
      </div>

      <div className={`kitchen-mobile-connection ${online ? 'is-online' : 'is-offline'}`} role="status">
        {online ? <Wifi size={16} /> : <WifiOff size={16} />}
        <span>{online ? 'Conectado ao servidor' : 'Sem conexão · reconecte para atualizar'}</span>
        {updatedAt && <time dateTime={updatedAt}>Atualizado {formatTime(updatedAt)}</time>}
      </div>

      {error && <div className="kitchen-mobile-error" role="alert">{error}</div>}

      <label className="kitchen-mobile-search">
        <Search size={18} />
        <span className="sr-only">Buscar paciente, leito, dieta ou restrição</span>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nome, leito ou dieta" />
      </label>

      {loading ? <p className="kitchen-mobile-state" role="status">Carregando mapa…</p>
        : visiblePatients.length ? <>
          <p className="kitchen-mobile-count" role="status">{visiblePatients.length} {visiblePatients.length === 1 ? 'paciente' : 'pacientes'}</p>
          <div className="kitchen-mobile-list">{visiblePatients.map((patient) => <article className="kitchen-mobile-card" key={patient.patient_reference}>
            <header>
              <span className="kitchen-mobile-location">Quarto {patient.room} <b>·</b> Leito {patient.bed}</span>
              <h3>{patient.patient_name}</h3>
            </header>
            <div className="kitchen-mobile-diet"><small>DIETA</small><strong>{patient.diet_type || 'Não informada · confirmar com Nutrição'}</strong></div>
            <div className={`kitchen-mobile-allergy ${patient.allergies_status === 'known' ? 'has-allergy' : patient.allergies_status === 'unknown' ? 'allergy-unknown' : ''}`}>
              {patient.allergies_status === 'known' ? <AlertTriangle size={18} /> : <span className="kitchen-mobile-allergy-mark" aria-hidden="true">!</span>}
              <div><small>ALERGIAS</small><strong>{patient.allergies_status === 'known' ? patient.allergies : patient.allergies_status === 'none_known' ? 'Sem alergia conhecida' : 'Não confirmado'}</strong></div>
            </div>
            {patient.restrictions && <div className="kitchen-mobile-detail"><small>RESTRIÇÕES</small><strong>{patient.restrictions}</strong></div>}
            {patient.fasting_at && <div className="kitchen-mobile-fasting"><Clock3 size={17} /><div><small>JEJUM PROGRAMADO</small><strong>{formatTime(patient.fasting_at)}{patient.fasting_reason ? ` · ${patient.fasting_reason}` : ''}</strong></div></div>}
            <p className="kitchen-mobile-assessment">Dieta atualizada em {formatAssessmentDate(patient.assessment_date)}</p>
          </article>)}</div>
        </> : <p className="kitchen-mobile-state" role="status">{patients.length ? 'Nenhum paciente corresponde à busca.' : 'Nenhum paciente internado disponível.'}</p>}

      <p className="kitchen-mobile-footnote">Consulta online. Confirme a identificação e a prescrição vigente antes de servir. Este mapa não substitui a conferência da equipe.</p>
    </section>
  </main>
}
