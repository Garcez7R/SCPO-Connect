import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Brain,
  Building2,
  CalendarDays,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  ClipboardPlus,
  Clock3,
  HeartPulse,
  Home,
  Info,
  LockKeyhole,
  LogOut,
  Menu,
  Package,
  Pencil,
  ShieldCheck,
  Search,
  Stethoscope,
  UsersRound,
  UserRound,
  X,
  Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

type ModuleId = 'home' | 'work-orders' | 'patients' | 'patient-history' | 'nursing' | 'nursing-history' | 'pharmacy' | 'xray' | 'social' | 'nutrition' | 'hygiene' | 'reception' | 'therapy' | 'psychology' | 'maintenance' | 'management' | 'admin' | 'about'
type ProfileId = 'patients' | 'nursing' | 'pharmacy' | 'xray' | 'social' | 'nutrition' | 'hygiene' | 'reception' | 'therapy' | 'psychology' | 'maintenance' | 'management'
type EntryState = 'draft' | 'review' | 'saving' | 'saved' | 'error'
type Patient = {
  reference: string; name: string; room: string; bed: string; cpf?: string; birth_date?: string | null; sex?: string; phone?: string; email?: string
  address?: string; address_number?: string; address_complement?: string; neighborhood?: string; city?: string; state?: string; postal_code?: string
  responsible_name?: string; responsible_relationship?: string; responsible_phone?: string; responsible_address?: string
  responsible_address_number?: string; responsible_address_complement?: string; responsible_neighborhood?: string
  responsible_city?: string; responsible_state?: string; responsible_postal_code?: string; photo_data?: string
  created_at?: string | null; updated_at?: string | null; updated_by?: string
}
type VitalRecordData = { id: number; patient_reference: string; actor_name: string; values: Record<string, string>; glucose_unit: string; recorded_at: string }
type WorkOrderStatus = 'open' | 'in_progress' | 'completed' | 'cancelled'
type WorkOrderPriority = 'normal' | 'high' | 'urgent'
type WorkOrder = { id: string; title: string; description: string; department: string; location: string; priority: WorkOrderPriority; status: WorkOrderStatus; requester_id: string; requester_name: string; updated_by: string; created_at: string; updated_at: string }
type PharmacyItem = { id: number; item_name: string; balance: string; unit: string; lot: string; expiry_date: string; created_at: string }
type TherapyActivityStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
type TherapyActivity = { id: string; title: string; activity_type: string; description: string; location: string; starts_at: string; ends_at: string | null; patient_reference: string | null; status: TherapyActivityStatus; activity_report: string; report_updated_by: string | null; report_updated_at: string | null; created_by: string; created_at: string }
type NutritionRecordData = { id: number; patient_reference: string; assessment_date: string; weight_kg: string; height_cm: string; diet_type: string; allergies: string; restrictions: string; appetite: string; hydration: string; notes: string; actor_name: string; created_at: string }

type Profile = {
  id: ProfileId
  name: string
  role: string
  initials: string
  modules: ModuleId[]
}

type AuthUser = { id: string; username: string; name: string; role: ProfileId; modules: ModuleId[]; permissions: Record<string, string[]>; mfa_enabled: boolean }

const roleLabels: Record<ProfileId, string> = {
  patients: 'Cadastro de pacientes', nursing: 'Enfermagem', pharmacy: 'Farmácia', xray: 'Raio X', social: 'Serviço Social',
  nutrition: 'Nutrição', hygiene: 'Higienização', reception: 'Recepção', therapy: 'Oficina Terapêutica',
  psychology: 'Psicologia / Psiquiatria', maintenance: 'Manutenção',
  management: 'Administrador master',
}

const modules: { id: ModuleId; label: string; short: string; icon: LucideIcon; description: string }[] = [
  { id: 'nursing', label: 'Enfermagem', short: 'Enfermagem', icon: HeartPulse, description: 'Coleta e acompanhamento de sinais vitais.' },
  { id: 'pharmacy', label: 'Farmácia', short: 'Farmácia', icon: Package, description: 'Controle de estoque, lotes e validade.' },
  { id: 'xray', label: 'Raio X', short: 'Raio X', icon: Activity, description: 'Solicitações e acompanhamento de exames.' },
  { id: 'social', label: 'Serviço Social', short: 'Serviço social', icon: UsersRound, description: 'Acompanhamentos e encaminhamentos.' },
  { id: 'nutrition', label: 'Nutrição', short: 'Nutrição', icon: HeartPulse, description: 'Acompanhamento nutricional e necessidades alimentares.' },
  { id: 'hygiene', label: 'Higienização', short: 'Higienização', icon: ShieldCheck, description: 'Rotinas de higienização e liberação de ambientes.' },
  { id: 'reception', label: 'Recepção', short: 'Recepção', icon: UsersRound, description: 'Identificação, chegada e direcionamento de pacientes.' },
  { id: 'therapy', label: 'Oficina Terapêutica', short: 'Oficina terapêutica', icon: Activity, description: 'Agenda, participação e acompanhamento das atividades.' },
  { id: 'psychology', label: 'Psicologia / Psiquiatria', short: 'Psicologia', icon: Brain, description: 'Espaço de trabalho para as equipes de Psicologia e Psiquiatria.' },
  { id: 'maintenance', label: 'Fila de manutenção', short: 'Manutenção', icon: Wrench, description: 'Ordens de serviço, prioridades e acompanhamento da execução.' },
  { id: 'management', label: 'Gestão Hospitalar', short: 'Gestão hospitalar', icon: Building2, description: 'Administração institucional, usuários e configurações.' },
  { id: 'admin', label: 'Administração', short: 'Administração', icon: ShieldCheck, description: 'Usuários, funções e permissões.' },
]

const navigation: { id: ModuleId; label: string; icon: LucideIcon }[] = [
  { id: 'home', label: 'Visão geral', icon: Home },
  { id: 'work-orders', label: 'Abrir ordem de serviço', icon: ClipboardPlus },
  { id: 'patients', label: 'Pacientes', icon: UserRound },
  ...modules.map(({ id, label, icon }) => ({ id, label, icon })),
  { id: 'about', label: 'Sobre e conformidade', icon: Info },
]

const emptyRecord = {
  saturation: '',
  pressure: '',
  heartRate: '',
  respiratoryRate: '',
  glucose: '',
  glucoseUnit: 'mg/dL',
  venousSite: '',
  venousCondition: '',
  venousNote: '',
  urine: '',
  bowel: '',
  pain: '',
  painScale: '',
  notes: '',
}

type RecordFields = typeof emptyRecord

let deferredInstallPrompt: Event | null = null
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  deferredInstallPrompt = event
  window.dispatchEvent(new Event('scpo-install-ready'))
})

const betaConfettiColors = ['#286d86', '#4c9b83', '#e3ad4e', '#d87566', '#8c78bd', '#62a6bd']
const betaConfettiPieces = Array.from({ length: 240 }, (_, index) => ({
  left: `${(index * 41) % 101}%`,
  animationDelay: `${(index % 45) * 0.045}s`,
  animationDuration: `${3.6 + (index % 10) * 0.11}s`,
  backgroundColor: betaConfettiColors[index % betaConfettiColors.length],
  width: `${6 + (index % 4) * 2}px`,
  height: `${10 + (index % 5) * 3}px`,
  borderRadius: index % 3 === 0 ? '50%' : '2px',
}))

const fieldLabels: Record<keyof RecordFields, string> = {
  saturation: 'Saturação',
  pressure: 'Pressão arterial',
  heartRate: 'Frequência cardíaca',
  respiratoryRate: 'Frequência respiratória',
  glucose: 'Glicose',
  glucoseUnit: 'Unidade da glicose',
  venousSite: 'Local do acesso',
  venousCondition: 'Condição informada',
  venousNote: 'Observação do acesso',
  urine: 'Eliminação urinária',
  bowel: 'Eliminação intestinal',
  pain: 'Valor informado',
  painScale: 'Escala utilizada',
  notes: 'Observações',
}

function App() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [bootstrapRequired, setBootstrapRequired] = useState(false)

  useEffect(() => {
    let active = true
    let startupTimer = 0
    const startedAt = performance.now()
    const minimumDuration = 3000
    const finishStartup = () => {
      const remaining = Math.max(0, minimumDuration - (performance.now() - startedAt))
      startupTimer = window.setTimeout(() => {
        if (active) setAuthReady(true)
      }, remaining)
    }

    Promise.all([fetch('/api/v1/auth/session'), fetch('/api/v1/auth/status')]).then(async ([sessionResponse, statusResponse]) => {
      const status = statusResponse.ok ? await statusResponse.json() as { bootstrap_required: boolean } : { bootstrap_required: false }
      const session = sessionResponse.ok ? await sessionResponse.json() as { user: AuthUser } : null
      if (!active) return
      setUser(session?.user ?? null)
      setBootstrapRequired(status.bootstrap_required)
      finishStartup()
    }).catch(() => { if (active) finishStartup() })
    return () => {
      active = false
      window.clearTimeout(startupTimer)
    }
  }, [])

  if (!authReady) return <StartupScreen />
  if (!user) return <AuthFlow bootstrapRequired={bootstrapRequired} onAuthenticated={setUser} />
  return <AuthenticatedApp user={user} onLogout={() => setUser(null)} />
}

function StartupScreen() {
  return <main className="startup-screen" role="status" aria-live="polite" aria-busy="true"><div className="startup-brand"><span className="startup-orbit startup-orbit-one" /><span className="startup-orbit startup-orbit-two" /><span className="startup-mark"><img className="startup-mark-base" src="/scpo-connect-icon.png" alt="" /><img className="startup-mark-fill" src="/scpo-connect-icon.png" alt="" /></span><span className="startup-glow" /></div><strong>SCPO Connect</strong><span>Preparando seu espaço de trabalho</span><div className="startup-progress"><i /></div></main>
}

function readableApiError(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const issues = detail.flatMap((issue) => {
      if (!issue || typeof issue !== 'object') return []
      const item = issue as { loc?: unknown[]; msg?: unknown }
      const field = Array.isArray(item.loc) ? item.loc.filter((part) => part !== 'body').at(-1) : undefined
      const label = field === 'username' ? 'Usuário' : field === 'name' ? 'Nome' : field === 'x_bootstrap_token' ? 'Token' : 'Campo'
      const message = typeof item.msg === 'string' ? item.msg : 'valor inválido'
      return [`${label}: ${message}`]
    })
    if (issues.length) return issues.join(' ')
  }
  if (detail && typeof detail === 'object' && 'message' in detail) {
    const message = (detail as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return 'Não foi possível concluir esta etapa. Confira os campos e tente novamente.'
}

function AuthenticatedApp({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const [activeModule, setActiveModule] = useState<ModuleId>('home')
  const [menuOpen, setMenuOpen] = useState(false)
  const [historyPatientReference, setHistoryPatientReference] = useState('')
  const [showBetaPopup, setShowBetaPopup] = useState(false)
  const logoClickCount = useRef(0)
  const logoClickTimer = useRef<number | undefined>(undefined)
  const closeBetaPopup = useCallback(() => setShowBetaPopup(false), [])

  useEffect(() => () => {
    if (logoClickTimer.current !== undefined) window.clearTimeout(logoClickTimer.current)
  }, [])
  useEffect(() => {
    let timer = 0
    let lastActivity = Date.now()
    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(async () => {
        if (Date.now() - lastActivity < 10 * 60 * 1000) {
          const response = await fetch('/api/v1/auth/refresh', { method: 'POST' })
          if (!response.ok) { onLogout(); return }
          schedule()
        }
      }, 8 * 60 * 1000)
    }
    const recordActivity = () => { lastActivity = Date.now(); schedule() }
    window.addEventListener('pointerdown', recordActivity)
    window.addEventListener('keydown', recordActivity)
    window.addEventListener('touchstart', recordActivity)
    schedule()
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointerdown', recordActivity)
      window.removeEventListener('keydown', recordActivity)
      window.removeEventListener('touchstart', recordActivity)
    }
  }, [onLogout])
  const role = user.role
  const profile: Profile = {
    id: role,
    name: user.name,
    role: roleLabels[role],
    initials: user.name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join(''),
    modules: ['home', ...user.modules, 'about'],
  }
  const canReviewTherapyReports = profile.modules.includes('management')
  const visibleNavigation = navigation.filter((item) => item.id === 'about' || item.id === 'work-orders' || profile.modules.includes(item.id) || (item.id === 'therapy' && canReviewTherapyReports))

  function navigate(id: ModuleId) {
    if (id === 'nursing-history' && !profile.modules.includes('nursing')) return
    if (id === 'patient-history' && !profile.modules.includes('patients')) return
    if (id !== 'about' && id !== 'work-orders' && id !== 'nursing-history' && id !== 'patient-history' && !(id === 'therapy' && canReviewTherapyReports) && !profile.modules.includes(id)) return
    setActiveModule(id)
    setMenuOpen(false)
  }

  function handleBrandClick() {
    logoClickCount.current += 1
    if (logoClickTimer.current !== undefined) window.clearTimeout(logoClickTimer.current)
    if (logoClickCount.current >= 7) {
      logoClickCount.current = 0
      setShowBetaPopup(true)
      return
    }
    logoClickTimer.current = window.setTimeout(() => { logoClickCount.current = 0 }, 2200)
  }

  function openPatientHistory(reference: string) {
    setHistoryPatientReference(reference)
    navigate('patient-history')
  }

  const activeLabel = activeModule === 'home'
    ? 'Visão geral'
    : activeModule === 'nursing-history' ? 'Coletas de sinais vitais'
    : activeModule === 'patient-history' ? 'Histórico do paciente'
    : navigation.find((item) => item.id === activeModule)?.label ?? 'SCPO Connect'

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`} aria-label="Navegação principal">
        <div className="brand-lockup">
          <button className="brand-trigger" type="button" aria-label="Marca SCPO Connect" onClick={handleBrandClick}>
            <img className="brand-image" src="/scpo-connect-icon.png" alt="" />
            <span className="brand-name">SCPO <strong>Connect</strong><small>Santa Casa de Pedro Osório</small></span>
          </button>
          <button className="icon-button sidebar-close" type="button" aria-label="Fechar menu" onClick={() => setMenuOpen(false)}><X size={19} /></button>
        </div>


        <p className="nav-caption">ESPAÇO DE TRABALHO</p>
        <nav className="primary-nav">
          {visibleNavigation.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className={`nav-link ${activeModule === id ? 'nav-link-active' : ''}`} onClick={() => navigate(id)} aria-current={activeModule === id ? 'page' : undefined}>
              <Icon size={22} strokeWidth={1.9} /><span>{label}</span>
              {id === 'nursing' && <span className="nav-count">01</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="privacy-note"><LockKeyhole size={16} /><span>Acesso individual<br />por perfil</span></div>
          <div className="profile-card">
            <div className="avatar">{profile.initials}</div>
            <div className="profile-copy"><strong>{profile.name}</strong><span>{profile.role}</span></div>
            <BadgeCheck className="profile-check" size={16} aria-label="Perfil autenticado" />
          </div>
        </div>
      </aside>

      {menuOpen && <button className="menu-backdrop" type="button" aria-label="Fechar menu" onClick={() => setMenuOpen(false)} />}

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button menu-trigger" type="button" aria-label="Abrir menu" onClick={() => setMenuOpen(true)}><Menu size={21} /></button>
            <div className="breadcrumbs"><span>SCPO Connect</span><span className="crumb-divider">/</span><strong>{activeLabel}</strong></div>
          </div>
          <div className="topbar-right">
            <span className="session-role">{getGreeting()}, {profile.name.split(/\s+/)[0]}</span>
            <InstallAppButton />
            <button className="button button-secondary logout-button" type="button" onClick={async () => { await fetch('/api/v1/auth/logout', { method: 'POST' }); onLogout() }}><LogOut size={15} /> Sair</button>
          </div>
        </header>

        <div className="page-content">
          {activeModule === 'home' && <Dashboard profile={profile} onNavigate={navigate} />}
          {activeModule === 'nursing' && <NursingPage profile={profile} onShowHistory={() => navigate('nursing-history')} />}
          {activeModule === 'nursing-history' && <NursingHistoryPage onBack={() => navigate('nursing')} />}
          {activeModule === 'pharmacy' && <PharmacyPage />}
          {activeModule === 'work-orders' && <WorkOrdersPage user={user} />}
          {activeModule === 'maintenance' && <MaintenanceQueuePage />}
          {activeModule === 'patients' && <PatientRegistryPage onHistory={openPatientHistory} />}
          {activeModule === 'reception' && <PatientRegistryPage receptionMode />}
          {activeModule === 'patient-history' && <PatientHistoryPage patientReference={historyPatientReference} onBack={() => navigate('patients')} />}
          {activeModule === 'therapy' && <TherapyPage profile={profile} />}
          {activeModule === 'admin' && <AdminPage />}
          {activeModule === 'management' && <ModulePlaceholder moduleId="management" onNavigate={navigate} />}
          {activeModule === 'about' && <AboutPage />}
          {activeModule === 'nutrition' && <NutritionPage />}
          {(['xray', 'social', 'hygiene', 'psychology'] as ModuleId[]).includes(activeModule) && <ModulePlaceholder moduleId={activeModule} onNavigate={navigate} />}
        </div>
        <footer className="app-footer"><span>SCPO Connect <span className="footer-version">· {user.username}</span></span><span>Acesso seguro por perfil</span></footer>
      </main>
      {showBetaPopup && <BetaCelebration onClose={closeBetaPopup} />}
    </div>
  )
}

function BetaCelebration({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const closeTimer = window.setTimeout(onClose, 7000)
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => { window.clearTimeout(closeTimer); window.removeEventListener('keydown', closeOnEscape) }
  }, [onClose])

  return <div className="beta-celebration" role="dialog" aria-modal="true" aria-labelledby="beta-title" onClick={onClose}>
    <div className="beta-celebration-backdrop" />
    <div className="beta-confetti-layer" aria-hidden="true">{betaConfettiPieces.map((style, index) => <span className="beta-confetti-piece" key={index} style={style} />)}</div>
    <section className="beta-dialog" onClick={(event) => event.stopPropagation()}>
      <button className="icon-button beta-dialog-close" type="button" aria-label="Fechar" onClick={onClose}><X size={18} /></button>
      <span className="beta-dialog-icon"><img src="/scpo-connect-install-192.png" alt="Ícone do SCPO Connect" /></span>
      <p className="eyebrow">SCPO CONNECT</p>
      <h2 id="beta-title">Versão em desenvolvimento</h2>
      <p>Fase beta</p>
      <small>Por Rafael Garcez</small>
      <button className="button button-primary" type="button" onClick={onClose}>Continuar</button>
    </section>
  </div>
}

function AuthFlow({ bootstrapRequired, onAuthenticated }: { bootstrapRequired: boolean; onAuthenticated: (user: AuthUser) => void }) {
  const [stage, setStage] = useState<'bootstrap' | 'login' | 'password' | 'mfa'>(bootstrapRequired ? 'bootstrap' : 'login')
  const [username, setUsername] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [bootstrapToken, setBootstrapToken] = useState('')
  const [mfaSecret, setMfaSecret] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (stage !== 'mfa') return
    fetch('/api/v1/auth/mfa/setup').then(async (response) => {
      if (!response.ok) throw new Error('Não foi possível iniciar a configuração do MFA.')
      const data = await response.json() as { secret: string }
      setMfaSecret(data.secret)
    }).catch((error: Error) => setMessage(error.message))
  }, [stage])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      let response: Response
      if (stage === 'bootstrap') {
        response = await fetch('/api/v1/auth/bootstrap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Bootstrap-Token': bootstrapToken.trim() },
          body: JSON.stringify({ username: username.trim(), name: name.trim() }),
        })
      } else if (stage === 'login') {
        response = await fetch('/api/v1/auth/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, totp_code: totpCode || undefined }),
        })
      } else if (stage === 'password') {
        response = await fetch('/api/v1/auth/password', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ new_password: newPassword }),
        })
      } else {
        response = await fetch('/api/v1/auth/mfa/confirm', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: totpCode }),
        })
      }
      const data = await response.json().catch(() => ({})) as { detail?: unknown; user?: AuthUser; must_change_password?: boolean; mfa_setup_required?: boolean }
      if (!response.ok) throw new Error(readableApiError(data.detail))
      if (stage === 'bootstrap') {
        setPassword('0000')
        setStage('password')
      } else if (stage === 'login') {
        setPassword('')
        if (data.must_change_password) setStage('password')
        else if (data.mfa_setup_required) setStage('mfa')
        else if (data.user) onAuthenticated(data.user)
      } else if (stage === 'password') {
        setNewPassword('')
        setStage('mfa')
      } else if (data.user) {
        onAuthenticated(data.user)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao conectar ao serviço de identidade.')
    } finally {
      setBusy(false)
    }
  }

  const title = stage === 'bootstrap' ? 'Configurar administrador master' : stage === 'login' ? 'Entrar no SCPO Connect' : stage === 'password' ? 'Troque sua senha inicial' : 'Ative a autenticação em duas etapas'
  return <main className="auth-page"><section className="auth-card"><div className="auth-brand"><img src="/scpo-connect-icon.png" alt="" /><div><strong>SCPO Connect</strong><span>Santa Casa de Pedro Osório</span></div></div><p className="eyebrow">ACESSO SEGURO</p><h1>{title}</h1>
    {stage === 'mfa' && <div className="auth-mfa-instructions"><strong>Aplicativo autenticador</strong><p>Cadastre esta chave em um aplicativo autenticador e informe o código de seis dígitos para confirmar:</p><code>{mfaSecret || 'Carregando chave segura…'}</code></div>}
    <form className="auth-form" onSubmit={submit}>
      {stage === 'bootstrap' && <><label className="field"><span className="field-label">Nome do administrador</span><input required minLength={2} maxLength={120} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></label><label className="field"><span className="field-label">Usuário</span><input required minLength={3} maxLength={80} pattern="[A-Za-z0-9._@-]+" title="Use pelo menos 3 caracteres: letras sem acento, números, ponto, hífen, sublinhado ou @." autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label><label className="field"><span className="field-label">Token de bootstrap</span><input required type="password" autoComplete="off" value={bootstrapToken} onChange={(event) => setBootstrapToken(event.target.value)} /></label><p className="auth-help">O usuário deve ter ao menos 3 caracteres e usar letras sem acento, números, ponto, hífen, sublinhado ou @.</p><p className="auth-help">O token fica no servidor em <code>data/local/bootstrap-admin.token</code>. Guarde-o como segredo.</p></>}
      {stage === 'login' && <><label className="field"><span className="field-label">Usuário</span><input required autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label><label className="field"><span className="field-label">Senha</span><input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><label className="field"><span className="field-label">Código MFA (6 dígitos)</span><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={totpCode} onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, ''))} /></label></>}
      {stage === 'password' && <><p className="auth-help">A senha inicial é temporária. Escolha uma nova senha com pelo menos 12 caracteres.</p><label className="field"><span className="field-label">Nova senha</span><input required minLength={12} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label></>}
      {stage === 'mfa' && <label className="field"><span className="field-label">Código do aplicativo</span><input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={totpCode} onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, ''))} /></label>}
      {message && <div className="form-message form-message-error" role="alert">{message}</div>}
      <button className="button button-primary auth-submit" type="submit" disabled={busy || (stage === 'mfa' && !mfaSecret)}>{busy ? 'Aguarde…' : stage === 'login' ? 'Entrar' : stage === 'bootstrap' ? 'Criar administrador' : stage === 'password' ? 'Salvar nova senha' : 'Ativar MFA'}</button>
    </form>
    <div className="auth-install"><span>Use o SCPO como aplicativo no seu dispositivo.</span><InstallAppButton /></div>
  </section></main>
}

const emptyPatientForm = {
  name: '', room: '', bed: '', cpf: '', birth_date: '', sex: '', phone: '', email: '', address: '', address_number: '', address_complement: '', neighborhood: '', city: '', state: '', postal_code: '',
  responsible_name: '', responsible_relationship: '', responsible_phone: '', responsible_address: '', responsible_address_number: '', responsible_address_complement: '', responsible_neighborhood: '', responsible_city: '', responsible_state: '', responsible_postal_code: '', photo_data: '',
}

type PatientFormData = typeof emptyPatientForm
function AddressFields({ form, patients, prefix, onChange }: { form: PatientFormData; patients: Patient[]; prefix: '' | 'responsible_'; onChange: (key: keyof PatientFormData, value: string) => void }) {
  const [lookupMessage, setLookupMessage] = useState('')
  const key = (name: string) => `${prefix}${name}` as keyof PatientFormData
  const value = (name: string) => form[key(name)]
  async function lookupCep() {
    const cep = value('postal_code').replace(/\D/g, '')
    if (cep.length !== 8) { setLookupMessage('Informe um CEP com 8 dígitos para pesquisar.'); return }
    const localMatches = patients.filter((patient) => (prefix ? patient.responsible_postal_code : patient.postal_code)?.replace(/\D/g, '') === cep).length
    try {
      const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`)
      if (!response.ok) throw new Error('Consulta indisponível')
      const address = await response.json() as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string }
      if (address.erro) throw new Error('CEP não encontrado')
      onChange(key('address'), address.logradouro ?? '')
      onChange(key('neighborhood'), address.bairro ?? '')
      onChange(key('city'), address.localidade ?? '')
      onChange(key('state'), address.uf ?? '')
      setLookupMessage(`Endereço localizado${localMatches ? ` · também consta em ${localMatches} cadastro(s) existente(s)` : ''}. Revise e complete o número.`)
    } catch {
      setLookupMessage(`${localMatches ? `CEP não localizado online; consta em ${localMatches} cadastro(s) existente(s). ` : 'CEP não localizado online. '}Preencha o endereço manualmente.`)
    }
  }
  return <><div className="patient-form-grid">
    <label className="field"><span className="field-label">Logradouro</span><input maxLength={180} autoComplete="street-address" value={value('address')} onChange={(event) => onChange(key('address'), event.target.value)} /></label>
    <label className="field"><span className="field-label">Número</span><input maxLength={24} value={value('address_number')} onChange={(event) => onChange(key('address_number'), event.target.value)} /></label>
    <label className="field"><span className="field-label">Complemento</span><input maxLength={100} value={value('address_complement')} onChange={(event) => onChange(key('address_complement'), event.target.value)} /></label>
    <label className="field"><span className="field-label">Bairro</span><input maxLength={100} value={value('neighborhood')} onChange={(event) => onChange(key('neighborhood'), event.target.value)} /></label>
    <label className="field"><span className="field-label">Cidade</span><input maxLength={100} value={value('city')} onChange={(event) => onChange(key('city'), event.target.value)} /></label>
    <label className="field"><span className="field-label">UF</span><input maxLength={2} value={value('state')} onChange={(event) => onChange(key('state'), event.target.value.toUpperCase())} /></label>
    <label className="field"><span className="field-label">CEP</span><input inputMode="numeric" maxLength={9} autoComplete="postal-code" value={value('postal_code')} onChange={(event) => onChange(key('postal_code'), event.target.value)} onBlur={() => { if (value('postal_code').replace(/\D/g, '').length === 8) void lookupCep() }} /></label>
    <button className="button button-secondary cep-search-button" type="button" onClick={() => void lookupCep()}><Search size={15} /> Pesquisar CEP</button>
  </div>{lookupMessage && <p className="cep-lookup-message" role="status">{lookupMessage}</p>}</>
}

function PatientRegistryPage({ onHistory, receptionMode = false }: { onHistory?: (reference: string) => void; receptionMode?: boolean }) {
  const [patients, setPatients] = useState<Patient[]>([])
  const [form, setForm] = useState({ ...emptyPatientForm })
  const [editingReference, setEditingReference] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (!cameraOpen) return
    let stream: MediaStream | undefined
    let videoElement: HTMLVideoElement | null = null
    let active = true
    if (!navigator.mediaDevices?.getUserMedia) {
      return () => { active = false }
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false })
      .then((mediaStream) => {
        stream = mediaStream
        if (!active) { mediaStream.getTracks().forEach((track) => track.stop()); return }
        videoElement = videoRef.current
        if (videoElement) {
          videoElement.srcObject = mediaStream
          void videoElement.play().catch(() => setCameraError('Não foi possível iniciar a visualização da câmera.'))
        }
      })
      .catch(() => { if (active) setCameraError('Não foi possível acessar a câmera. Verifique a permissão do navegador ou escolha uma imagem do dispositivo.') })
    return () => {
      active = false
      stream?.getTracks().forEach((track) => track.stop())
      if (videoElement) videoElement.srcObject = null
    }
  }, [cameraOpen])

  async function loadPatients() {
    setLoading(true)
    try {
      const response = await fetch('/api/v1/nursing/patients?full_profile=true')
      const data = await response.json() as { patients?: Patient[]; detail?: string }
      if (!response.ok) throw new Error(data.detail ?? 'Não foi possível carregar os pacientes.')
      setPatients(data.patients ?? [])
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar os pacientes.')
    } finally { setLoading(false) }
  }

  useEffect(() => { void loadPatients() }, [])

  function startEdit(patient: Patient) {
    const formData = { ...emptyPatientForm }
    for (const key of Object.keys(formData) as (keyof typeof emptyPatientForm)[]) {
      formData[key] = key === 'birth_date' ? patient.birth_date ?? '' : patient[key] ?? ''
    }
    setForm(formData)
    setEditingReference(patient.reference)
    setShowForm(true)
    setCameraOpen(false)
    setNotice('')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true); setError(''); setNotice('')
    try {
      const response = await fetch(editingReference ? `/api/v1/nursing/patients/${encodeURIComponent(editingReference)}` : '/api/v1/nursing/patients', {
        method: editingReference ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, birth_date: form.birth_date || null }),
      })
      const data = await response.json() as Patient & { detail?: string }
      if (!response.ok) throw new Error(data.detail ?? 'Não foi possível salvar o cadastro.')
      setPatients((current) => editingReference ? current.map((item) => item.reference === data.reference ? data : item) : [...current, data].sort((a, b) => a.room.localeCompare(b.room, 'pt-BR', { numeric: true }) || a.bed.localeCompare(b.bed, 'pt-BR', { numeric: true })))
      setForm({ ...emptyPatientForm }); setEditingReference(''); setShowForm(false); setCameraOpen(false)
      setNotice(editingReference ? 'Cadastro do paciente atualizado.' : receptionMode ? 'Paciente admitido e cadastro compartilhado com os módulos autorizados.' : 'Paciente cadastrado e disponível nos módulos autorizados.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Falha ao salvar o cadastro.')
    } finally { setSaving(false) }
  }

  const queryDigits = query.replace(/\D/g, '')
  const filteredPatients = patients.filter((patient) => `${patient.name} ${patient.room} ${patient.bed} ${patient.responsible_name} ${patient.cpf ?? ''}`.toLocaleLowerCase('pt-BR').includes(query.trim().toLocaleLowerCase('pt-BR')) || (queryDigits.length > 0 && (patient.cpf ?? '').includes(queryDigits)))
  const patientAddress = (patient: Patient) => [patient.address, patient.address_number, patient.address_complement, patient.neighborhood, patient.city, patient.state, patient.postal_code].filter(Boolean).join(', ')

  function capturePhoto() {
    const video = videoRef.current
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      setCameraError('Aguarde a câmera iniciar antes de tirar a foto.')
      return
    }
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 900 / Math.max(video.videoWidth, video.videoHeight))
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    const context = canvas.getContext('2d')
    if (!context) { setCameraError('Não foi possível processar a imagem.'); return }
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    setForm((current) => ({ ...current, photo_data: canvas.toDataURL('image/jpeg', 0.82) }))
    setCameraOpen(false)
    setCameraError('')
  }

  function loadPhoto(file?: File) {
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('Selecione uma imagem JPEG, PNG ou WebP.'); return }
    if (file.size > 1_000_000) { setError('A foto deve ter até 1 MB.'); return }
    const reader = new FileReader()
    reader.onload = () => setForm((current) => ({ ...current, photo_data: String(reader.result ?? '') }))
    reader.onerror = () => setError('Não foi possível ler a imagem selecionada.')
    reader.readAsDataURL(file)
    setError('')
    setCameraOpen(false)
  }

  return <section className="patient-registry-page page-enter">
    <div className="page-title-row"><div><p className="eyebrow">{receptionMode ? 'MÓDULO · RECEPÇÃO' : 'CADASTRO COMPARTILHADO'}</p><h1>{receptionMode ? 'Recepção' : 'Pacientes'}</h1><p className="welcome-copy">{receptionMode ? 'Cadastre admissões, confirme quarto e leito e mantenha os dados de identificação atualizados.' : 'Cadastros centralizados, exibidos nos módulos autorizados para cada profissional.'}</p></div><button className="button button-primary" type="button" onClick={() => { if (showForm) { setShowForm(false); setEditingReference(''); setForm({ ...emptyPatientForm }); setCameraOpen(false) } else { setShowForm(true); setNotice(''); setError('') } }}><UserRound size={16} /> {showForm ? 'Fechar cadastro' : receptionMode ? 'Nova admissão' : 'Cadastrar paciente'}</button></div>
    {notice && <div className="form-message form-message-success" role="status">{notice}</div>}{error && <div className="form-message form-message-error" role="alert">{error}</div>}
    {showForm && <form className="patient-registry-form" onSubmit={(event) => void submit(event)}>
      <div className="section-heading"><div><p className="eyebrow">{editingReference ? 'ATUALIZAÇÃO CADASTRAL' : receptionMode ? 'ADMISSÃO' : 'NOVO CADASTRO'}</p><h2>{editingReference ? 'Dados do paciente' : receptionMode ? 'Identificação e internação' : 'Identificação e internação'}</h2><p className="welcome-copy">Os campos são compartilhados com os módulos conforme as permissões configuradas.</p></div></div>
      <div className="patient-form-grid">
        <label className="field"><span className="field-label">Nome completo</span><input required minLength={2} maxLength={120} autoComplete="name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label className="field"><span className="field-label">CPF</span><input inputMode="numeric" autoComplete="off" maxLength={14} value={form.cpf} onChange={(event) => setForm({ ...form, cpf: event.target.value.replace(/[^\d.-]/g, '').slice(0, 14) })} placeholder="000.000.000-00" /></label>
        <label className="field"><span className="field-label">Data de nascimento</span><input type="date" value={form.birth_date} onChange={(event) => setForm({ ...form, birth_date: event.target.value })} /></label>
        <label className="field"><span className="field-label">Quarto</span><input required maxLength={20} value={form.room} onChange={(event) => setForm({ ...form, room: event.target.value })} /></label>
        <label className="field"><span className="field-label">Leito</span><input required maxLength={20} value={form.bed} onChange={(event) => setForm({ ...form, bed: event.target.value })} /></label>
        <label className="field"><span className="field-label">Sexo (opcional)</span><select value={form.sex} onChange={(event) => setForm({ ...form, sex: event.target.value })}><option value="">Não informado</option><option value="Feminino">Feminino</option><option value="Masculino">Masculino</option><option value="Outro">Outro</option><option value="Não informado">Prefere não informar</option></select></label>
        <label className="field"><span className="field-label">Telefone do paciente</span><input maxLength={40} autoComplete="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
        <label className="field"><span className="field-label">E-mail do paciente</span><input type="email" maxLength={160} autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
      </div>
      <fieldset className="patient-address-group"><legend>Endereço do paciente</legend><AddressFields form={form} patients={patients} prefix="" onChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))} /></fieldset>
      <fieldset className="patient-address-group"><legend>Responsável pela internação</legend><div className="patient-form-grid"><label className="field"><span className="field-label">Nome completo</span><input maxLength={120} value={form.responsible_name} onChange={(event) => setForm({ ...form, responsible_name: event.target.value })} /></label><label className="field"><span className="field-label">Vínculo com o paciente</span><input maxLength={60} value={form.responsible_relationship} onChange={(event) => setForm({ ...form, responsible_relationship: event.target.value })} placeholder="Ex.: filha, cônjuge" /></label><label className="field"><span className="field-label">Telefone de contato</span><input maxLength={40} autoComplete="tel" value={form.responsible_phone} onChange={(event) => setForm({ ...form, responsible_phone: event.target.value })} /></label></div><AddressFields form={form} patients={patients} prefix="responsible_" onChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))} /></fieldset>
      <fieldset className="patient-address-group"><legend>Foto do paciente</legend><div className="patient-photo-editor">{form.photo_data ? <img src={form.photo_data} alt="Prévia da foto do paciente" /> : <span className="patient-photo-placeholder"><UserRound size={24} /></span>}<button className="button button-secondary" type="button" onClick={() => { setCameraError(''); setCameraOpen((open) => !open) }}><Camera size={16} /> {cameraOpen ? 'Fechar câmera' : 'Tirar foto'}</button><label className="button button-secondary" htmlFor="patient-photo">Escolher imagem</label><input id="patient-photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => { loadPhoto(event.target.files?.[0]); event.currentTarget.value = '' }} /><button className="button button-secondary" type="button" onClick={() => setForm({ ...form, photo_data: '' })} disabled={!form.photo_data}>Remover foto</button><small>JPEG, PNG ou WebP · até 1 MB. A câmera requer HTTPS e permissão.</small>{cameraOpen && <div className="patient-camera-panel"><video ref={videoRef} autoPlay muted playsInline aria-label="Visualização da câmera para foto do paciente" />{(cameraError || (!navigator.mediaDevices?.getUserMedia ? 'A câmera precisa de HTTPS e de permissão do navegador. Você ainda pode escolher uma imagem do dispositivo.' : '')) && <p className="form-message form-message-error" role="alert">{cameraError || 'A câmera precisa de HTTPS e de permissão do navegador. Você ainda pode escolher uma imagem do dispositivo.'}</p>}<div><button className="button button-primary" type="button" onClick={capturePhoto} disabled={!navigator.mediaDevices?.getUserMedia}><Camera size={16} /> Capturar foto</button><button className="button button-secondary" type="button" onClick={() => setCameraOpen(false)}>Cancelar câmera</button></div></div>}</div></fieldset>
      <div className="patient-form-actions"><button className="button button-secondary" type="button" onClick={() => { setShowForm(false); setEditingReference(''); setForm({ ...emptyPatientForm }); setCameraOpen(false) }} disabled={saving}>Cancelar</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Salvando…' : editingReference ? 'Salvar alterações' : 'Cadastrar paciente'} <ArrowRight size={16} /></button></div>
    </form>}
    <section className="patient-list-panel"><div className="section-heading"><div><p className="eyebrow">REGISTROS COMPARTILHADOS</p><h2>{receptionMode ? 'Pacientes internados' : 'Pacientes cadastrados'}</h2></div><span className="module-total">{patients.length}</span></div><label className="field patient-search"><span className="field-label">Buscar paciente, quarto ou responsável</span><span className="search-input-wrap"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Digite para pesquisar" /></span></label>{loading ? <div className="history-empty">Carregando pacientes…</div> : filteredPatients.length ? <div className="patient-registry-list">{filteredPatients.map((patient) => <article className="patient-registry-card" key={patient.reference}><div className="patient-registry-identity">{patient.photo_data ? <img src={patient.photo_data} alt="" /> : <span className="patient-registry-avatar"><UserRound size={19} /></span>}<div><h3>{patient.name}</h3><p>Quarto {patient.room} · Leito {patient.bed}{patient.birth_date ? ` · Nascimento ${new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${patient.birth_date}T00:00:00Z`))}` : ''}</p>{patient.responsible_name && <small>Responsável: {patient.responsible_name}{patient.responsible_phone ? ` · ${patient.responsible_phone}` : ''}</small>}{patientAddress(patient) && <small>{patientAddress(patient)}</small>}</div></div><div className="patient-registry-actions">{onHistory && <button className="button button-secondary" type="button" onClick={() => onHistory(patient.reference)}><ClipboardList size={15} /> Histórico</button>}<button className="button button-secondary" type="button" onClick={() => startEdit(patient)}><Pencil size={15} /> Editar</button></div></article>)}</div> : <div className="history-empty"><UsersRound size={20} /><span>{query ? 'Nenhum cadastro corresponde à pesquisa.' : 'Nenhum paciente cadastrado.'}</span></div>}</section>
  </section>
}

function PatientHistoryPage({ patientReference, onBack }: { patientReference: string; onBack: () => void }) {
  const pageSize = 50
  const [patients, setPatients] = useState<Patient[]>([])
  const [records, setRecords] = useState<VitalRecordData[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [metric, setMetric] = useState('saturation')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const patient = patients.find((item) => item.reference === patientReference)
  useEffect(() => {
    let current = true
    Promise.all([fetch('/api/v1/nursing/patients?full_profile=true'), fetch(`/api/v1/nursing/patients/${encodeURIComponent(patientReference)}/history?limit=${pageSize}&offset=${offset}`)]).then(async ([patientResponse, historyResponse]) => {
      const patientData = await patientResponse.json() as { patients?: Patient[]; detail?: string }
      const historyData = await historyResponse.json() as { records?: VitalRecordData[]; total?: number; detail?: string }
      if (!patientResponse.ok) throw new Error(patientData.detail ?? 'Não foi possível carregar o cadastro.')
      if (!historyResponse.ok) throw new Error(historyData.detail ?? 'Não foi possível carregar o histórico.')
      return { patientData, historyData }
    }).then(({ patientData, historyData }) => { if (current) { setPatients(patientData.patients ?? []); setRecords(historyData.records ?? []); setTotal(historyData.total ?? 0); setError('') } }).catch((loadError) => { if (current) setError(loadError instanceof Error ? loadError.message : 'Falha ao consultar o histórico.') }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [patientReference, offset])
  return <section className="patient-history-page page-enter"><div className="page-title-row"><div><p className="eyebrow">PRONTUÁRIO · ACESSO AUTORIZADO</p><h1>Histórico do paciente</h1><p className="welcome-copy">Registros de sinais vitais associados ao cadastro central.</p></div><button className="button button-secondary" type="button" onClick={onBack}><ArrowLeft size={16} /> Voltar aos pacientes</button></div>{patient && <section className="patient-history-summary">{patient.photo_data ? <img src={patient.photo_data} alt="" /> : <span className="patient-registry-avatar"><UserRound size={22} /></span>}<div><h2>{patient.name}</h2><p>Quarto {patient.room} · Leito {patient.bed}{patient.birth_date ? ` · ${new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${patient.birth_date}T00:00:00Z`))}` : ''}</p>{patient.responsible_name && <small>Responsável pela internação: {patient.responsible_name} · {patient.responsible_phone || 'Contato não informado'}</small>}</div><span className="module-total">{total} {total === 1 ? 'registro' : 'registros'}</span></section>}{error && <div className="form-message form-message-error" role="alert">{error}</div>}{loading ? <div className="history-empty">Carregando histórico…</div> : <VitalHistory records={records} patients={patients} metric={metric} onMetric={setMetric} />}{!loading && total > pageSize && <nav className="history-pagination" aria-label="Paginação do histórico do paciente"><span>Exibindo {offset + 1}–{Math.min(offset + records.length, total)} de {total}</span><div><button className="button button-secondary" type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}><ArrowLeft size={15} /> Anterior</button><button className="button button-secondary" type="button" disabled={offset + pageSize >= total} onClick={() => setOffset(offset + pageSize)}>Mais antigas <ArrowRight size={15} /></button></div></nav>}</section>
}

const therapyActivityStatusLabels: Record<TherapyActivityStatus, string> = {
  scheduled: 'Agendada', in_progress: 'Em andamento', completed: 'Realizada', cancelled: 'Cancelada',
}

function TherapyPage({ profile }: { profile: Profile }) {
  const [patients, setPatients] = useState<Patient[]>([])
  const [activities, setActivities] = useState<TherapyActivity[]>([])
  const [reportDrafts, setReportDrafts] = useState<Record<string, string>>({})
  const [reportStatuses, setReportStatuses] = useState<Record<string, TherapyActivityStatus>>({})
  const [savingReportId, setSavingReportId] = useState('')
  const [month, setMonth] = useState(() => { const current = new Date(); return new Date(current.getFullYear(), current.getMonth(), 1) })
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState({ title: '', activity_type: '', description: '', location: '', starts_at: '', ends_at: '', patient_reference: '' })

  useEffect(() => {
    let current = true
    const start = new Date(month.getFullYear(), month.getMonth(), 1).toISOString()
    const end = new Date(month.getFullYear(), month.getMonth() + 1, 1).toISOString()
    Promise.all([
      fetch('/api/v1/nursing/patients'),
      fetch(`/api/v1/therapy/activities?from_date=${encodeURIComponent(start)}&to_date=${encodeURIComponent(end)}&limit=200`),
    ]).then(async ([patientResponse, activityResponse]) => {
      const patientData = await patientResponse.json() as { patients?: Patient[]; detail?: string }
      const activityData = await activityResponse.json() as { activities?: TherapyActivity[]; detail?: string }
      if (!patientResponse.ok) throw new Error(patientData.detail ?? 'Não foi possível carregar os pacientes autorizados.')
      if (!activityResponse.ok) throw new Error(activityData.detail ?? 'Não foi possível carregar a agenda terapêutica.')
      return { patientData, activityData }
    }).then(({ patientData, activityData }) => { if (current) { const loadedActivities = activityData.activities ?? []; setPatients(patientData.patients ?? []); setActivities(loadedActivities); setReportDrafts(Object.fromEntries(loadedActivities.map((activity) => [activity.id, activity.activity_report ?? '']))); setReportStatuses(Object.fromEntries(loadedActivities.map((activity) => [activity.id, activity.status]))); setError('') } }).catch((loadError) => { if (current) setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar a oficina terapêutica.') }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [month])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('')
    try {
      const response = await fetch('/api/v1/therapy/activities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, starts_at: new Date(form.starts_at).toISOString(), ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null, patient_reference: form.patient_reference || null }) })
      const data = await response.json() as TherapyActivity & { detail?: string }
      if (!response.ok) throw new Error(data.detail ?? 'Não foi possível agendar a atividade.')
      if (new Date(data.starts_at).getFullYear() === month.getFullYear() && new Date(data.starts_at).getMonth() === month.getMonth()) { setActivities((items) => [...items, data].sort((a, b) => a.starts_at.localeCompare(b.starts_at))); setReportDrafts((items) => ({ ...items, [data.id]: data.activity_report ?? '' })); setReportStatuses((items) => ({ ...items, [data.id]: data.status })) }
      setForm({ title: '', activity_type: '', description: '', location: '', starts_at: '', ends_at: '', patient_reference: '' }); setShowForm(false); setNotice('Atividade incluída na agenda.')
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : 'Falha ao salvar a atividade.') } finally { setSaving(false) }
  }

  async function saveActivityReport(activity: TherapyActivity) {
    setSavingReportId(activity.id); setError(''); setNotice('')
    try {
      const response = await fetch(`/api/v1/therapy/activities/${encodeURIComponent(activity.id)}/report`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activity_report: reportDrafts[activity.id] ?? '', status: reportStatuses[activity.id] ?? activity.status }) })
      const data = await response.json() as TherapyActivity & { detail?: string }
      if (!response.ok) throw new Error(data.detail ?? 'Não foi possível salvar o relatório da atividade.')
      setActivities((items) => items.map((item) => item.id === activity.id ? data : item))
      setReportDrafts((items) => ({ ...items, [activity.id]: data.activity_report ?? '' }))
      setReportStatuses((items) => ({ ...items, [activity.id]: data.status }))
      setNotice('Relatório da atividade salvo para consulta da Gestão Hospitalar.')
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Falha ao salvar o relatório.') } finally { setSavingReportId('') }
  }

  function printActivityReport() {
    document.body.classList.add('print-therapy-report')
    window.addEventListener('afterprint', () => document.body.classList.remove('print-therapy-report'), { once: true })
    window.print()
  }

  const monthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(month)
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const firstWeekday = new Date(month.getFullYear(), month.getMonth(), 1).getDay()
  const activityDateKey = (value: string) => { const date = new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
  const calendarCells = Array.from({ length: Math.ceil((firstWeekday + daysInMonth) / 7) * 7 }, (_, index) => {
    const day = index - firstWeekday + 1
    if (day < 1 || day > daysInMonth) return null
    const dateKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    return { day, dateKey, birthdays: patients.filter((patient) => patient.birth_date?.slice(5) === dateKey.slice(5)), activities: activities.filter((activity) => activityDateKey(activity.starts_at) === dateKey) }
  })
  const birthdaysThisMonth = patients.filter((patient) => patient.birth_date && Number(patient.birth_date.slice(5, 7)) === month.getMonth() + 1).sort((a, b) => (a.birth_date ?? '').slice(8).localeCompare((b.birth_date ?? '').slice(8), 'pt-BR', { numeric: true }))

  return <section className="therapy-page page-enter">
    <div className="page-title-row"><div><p className="eyebrow">MÓDULO · OFICINA TERAPÊUTICA</p><h1>Atividades e calendário</h1><p className="welcome-copy">Organize oficinas, grupos e atendimentos com os pacientes autorizados.</p></div>{profile.modules.includes('therapy') && <button className="button button-primary" type="button" onClick={() => { setShowForm((value) => !value); setNotice(''); setError('') }}><CalendarDays size={16} /> {showForm ? 'Fechar agenda' : 'Agendar atividade'}</button>}</div>
    {notice && <div className="form-message form-message-success" role="status">{notice}</div>}{error && <div className="form-message form-message-error" role="alert">{error}</div>}
    {showForm && <form className="therapy-form" onSubmit={(event) => void submit(event)}><div className="section-heading"><div><p className="eyebrow">NOVA ATIVIDADE</p><h2>Dados da oficina</h2></div></div><div className="field-grid field-grid-two"><label className="field"><span className="field-label">Nome da atividade</span><input required minLength={3} maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Ex.: oficina de pintura" /></label><label className="field"><span className="field-label">Modalidade</span><select required value={form.activity_type} onChange={(event) => setForm({ ...form, activity_type: event.target.value })}><option value="">Selecione</option><option value="grupo">Grupo terapêutico</option><option value="arte">Arte e expressão</option><option value="música">Música</option><option value="movimento">Movimento corporal</option><option value="ocupacional">Atividade ocupacional</option><option value="recreação">Recreação</option><option value="outro">Outra</option></select></label><label className="field"><span className="field-label">Início</span><input required type="datetime-local" value={form.starts_at} onChange={(event) => setForm({ ...form, starts_at: event.target.value })} /></label><label className="field"><span className="field-label">Término (opcional)</span><input type="datetime-local" min={form.starts_at || undefined} value={form.ends_at} onChange={(event) => setForm({ ...form, ends_at: event.target.value })} /></label><label className="field"><span className="field-label">Local</span><input required minLength={2} maxLength={120} value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Sala ou espaço" /></label><label className="field"><span className="field-label">Paciente (opcional)</span><select value={form.patient_reference} onChange={(event) => setForm({ ...form, patient_reference: event.target.value })}><option value="">Atividade em grupo / sem vínculo individual</option>{patients.map((patient) => <option key={patient.reference} value={patient.reference}>{patient.name} · Qto {patient.room} · Leito {patient.bed}</option>)}</select></label></div><label className="field"><span className="field-label">Objetivo ou observações</span><textarea maxLength={1000} rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label><div className="patient-form-actions"><button className="button button-secondary" type="button" onClick={() => setShowForm(false)} disabled={saving}>Cancelar</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar atividade'} <ArrowRight size={16} /></button></div></form>}
    <div className="therapy-layout"><section className="therapy-calendar-panel"><div className="therapy-calendar-heading"><button className="icon-button" type="button" aria-label="Mês anterior" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={19} /></button><h2>{monthLabel}</h2><button className="icon-button" type="button" aria-label="Próximo mês" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={19} /></button></div><div className="therapy-calendar-grid therapy-calendar-weekdays">{['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((day) => <span key={day}>{day}</span>)}</div><div className="therapy-calendar-grid">{calendarCells.map((cell, index) => cell ? <article className={`therapy-calendar-day ${cell.birthdays.length ? 'has-birthday' : ''} ${cell.activities.length ? 'has-activity' : ''}`} key={cell.dateKey}><strong>{cell.day}</strong>{cell.birthdays.slice(0, 2).map((patient) => <span className="therapy-calendar-tag birthday-tag" key={patient.reference} title={`Aniversário: ${patient.name}`}>🎂 {patient.name.split(' ')[0]}</span>)}{cell.activities.slice(0, 2).map((activity) => <span className="therapy-calendar-tag activity-tag" key={activity.id} title={activity.title}>• {activity.title}</span>)}{cell.birthdays.length + cell.activities.length > 4 && <small>+{cell.birthdays.length + cell.activities.length - 4}</small>}</article> : <span className="therapy-calendar-day therapy-calendar-empty" key={`empty-${index}`} />)}</div><div className="therapy-calendar-legend"><span><i className="legend-birthday" /> Aniversários</span><span><i className="legend-activity" /> Atividades</span></div></section>
      <aside className="therapy-birthday-panel"><div className="section-heading"><div><p className="eyebrow">DATAS ESPECIAIS</p><h2>Aniversários</h2></div><span className="module-total">{birthdaysThisMonth.length}</span></div>{birthdaysThisMonth.length ? <div className="therapy-birthday-list">{birthdaysThisMonth.map((patient) => <article key={patient.reference}><span className="birthday-date">{new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: '2-digit', month: 'short' }).format(new Date(`${month.getFullYear()}-${patient.birth_date!.slice(5)}T00:00:00Z`))}</span><div><strong>{patient.name}</strong><small>Quarto {patient.room} · Leito {patient.bed}</small></div></article>)}</div> : <div className="history-empty">Nenhum aniversário cadastrado neste mês.</div>}<p className="field-hint">As datas são calculadas a partir do cadastro de pacientes autorizado para este perfil.</p></aside></div>
    <section className="therapy-activity-list"><div className="section-heading"><div><p className="eyebrow">PROGRAMAÇÃO</p><h2>Atividades de {monthLabel}</h2></div><span className="module-total">{activities.length}</span></div>{loading ? <div className="history-empty">Carregando agenda…</div> : activities.length ? <div className="therapy-activity-grid">{activities.map((activity) => { const patient = patients.find((item) => item.reference === activity.patient_reference); return <article key={activity.id} className="therapy-activity-card"><span className="therapy-activity-date"><strong>{new Intl.DateTimeFormat('pt-BR', { day: '2-digit' }).format(new Date(activity.starts_at))}</strong><small>{new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(new Date(activity.starts_at))}</small></span><div><span className="eyebrow">{activity.activity_type} · {new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(activity.starts_at))}</span><h3>{activity.title}</h3><p>{activity.location}{patient ? ` · ${patient.name}` : ' · Grupo'}</p>{activity.description && <small>{activity.description}</small>}</div></article> })}</div> : <div className="history-empty">Nenhuma atividade agendada para este mês.</div>}</section>
    <section className="therapy-report-panel"><div className="section-heading"><div><p className="eyebrow">ACOMPANHAMENTO</p><h2>Relatório de atividades · {monthLabel}</h2><p className="welcome-copy">{profile.modules.includes('therapy') ? 'Registre os resultados realizados e apresente o relatório à Gestão Hospitalar.' : 'Consulte os resultados registrados pela Oficina Terapêutica e imprima o relatório mensal.'}</p></div><button className="button button-secondary therapy-report-print-button" type="button" onClick={printActivityReport} disabled={!activities.length}><ClipboardList size={16} /> Imprimir relatório</button></div>{loading ? <div className="history-empty">Carregando relatórios…</div> : activities.length ? <div className="therapy-report-list">{activities.map((activity) => { const patient = patients.find((item) => item.reference === activity.patient_reference); const reportStatus = reportStatuses[activity.id] ?? activity.status; return <article className="therapy-report-card" key={`report-${activity.id}`}><div className="therapy-report-heading"><div><p className="eyebrow">{dateTime(activity.starts_at)} · {activity.activity_type}</p><h3>{activity.title}</h3><p>{activity.location}{patient ? ` · ${patient.name} · Quarto ${patient.room}, leito ${patient.bed}` : ' · Grupo'}</p></div><span className={`therapy-report-status therapy-report-status-${reportStatus}`}>{therapyActivityStatusLabels[reportStatus]}</span></div>{profile.modules.includes('therapy') ? <><label className="field"><span className="field-label">Relato da atividade</span><textarea rows={4} maxLength={4000} value={reportDrafts[activity.id] ?? ''} onChange={(event) => setReportDrafts((items) => ({ ...items, [activity.id]: event.target.value }))} placeholder="Descreva a participação, os resultados observados e os encaminhamentos necessários." /></label><div className="therapy-report-actions"><label className="field"><span className="field-label">Situação</span><select value={reportStatus} onChange={(event) => setReportStatuses((items) => ({ ...items, [activity.id]: event.target.value as TherapyActivityStatus }))}><option value="scheduled">Agendada</option><option value="in_progress">Em andamento</option><option value="completed">Realizada</option><option value="cancelled">Cancelada</option></select></label><button className="button button-primary" type="button" onClick={() => void saveActivityReport(activity)} disabled={savingReportId === activity.id}>{savingReportId === activity.id ? 'Salvando…' : 'Salvar relatório'}</button></div></> : <p className="therapy-report-content">{activity.activity_report || 'Relatório ainda não registrado.'}</p>}{activity.report_updated_by && <small className="therapy-report-author">Última atualização por {activity.report_updated_by}{activity.report_updated_at ? ` · ${dateTime(activity.report_updated_at)}` : ''}</small>}</article> })}</div> : <div className="history-empty">Agende uma atividade para iniciar o relatório do mês.</div>}</section>
  </section>
}

const workOrderStatuses: Record<WorkOrderStatus, string> = {
  open: 'Aberta', in_progress: 'Em curso', completed: 'Finalizada', cancelled: 'Cancelada',
}

const workOrderPriorities: Record<WorkOrderPriority, string> = {
  normal: 'Normal', high: 'Alta', urgent: 'Urgente',
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function getGreeting() {
  const hour = Number(new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(new Date()))
  return hour >= 5 && hour < 12 ? 'Bom dia' : hour >= 12 && hour < 18 ? 'Boa tarde' : 'Boa noite'
}

function WorkOrdersPage({ user }: { user: AuthUser }) {
  const [orders, setOrders] = useState<WorkOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [form, setForm] = useState({ title: '', category: '', description: '', department: '', customDepartment: '', unit: '', location: '', assetCode: '', priority: 'normal' as WorkOrderPriority })

  async function loadOrders() {
    setLoading(true)
    try {
      const response = await fetch('/api/v1/maintenance/orders')
      const data = await response.json() as { orders?: WorkOrder[]; detail?: string }
      if (!response.ok) throw new Error(data.detail ?? 'Não foi possível carregar suas solicitações.')
      setOrders(data.orders ?? [])
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar as solicitações.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadOrders() }, [user.id])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!reviewing) { setReviewing(true); return }
    setSaving(true)
    setNotice('')
    setError('')
    try {
      const response = await fetch('/api/v1/maintenance/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title.trim(),
          description: `Categoria: ${form.category}\n\n${form.description.trim()}`,
          department: (form.department === 'Outro' ? form.customDepartment : form.department).trim(),
          location: [form.unit && `Unidade: ${form.unit}`, form.location && `Local: ${form.location.trim()}`, form.assetCode && `Patrimônio: ${form.assetCode.trim()}`].filter(Boolean).join(' · '),
          priority: form.priority,
        }),
      })
      const data = await response.json() as WorkOrder & { detail?: string }
      if (!response.ok) throw new Error(data.detail ?? 'Não foi possível abrir a ordem de serviço.')
      setOrders((current) => [data, ...current])
      setForm({ title: '', category: '', description: '', department: '', customDepartment: '', unit: '', location: '', assetCode: '', priority: 'normal' })
      setReviewing(false)
      setNotice('Ordem de serviço aberta. A equipe de manutenção poderá acompanhar a solicitação.')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Falha ao abrir a ordem de serviço.')
    } finally {
      setSaving(false)
    }
  }

  return <section className="work-orders-page page-enter">
    <div className="page-title-row"><div><p className="eyebrow">SERVIÇOS INTERNOS</p><h1>Abrir ordem de serviço</h1><p className="welcome-copy">Solicite reparos, instalações e apoio de manutenção. A solicitação fica vinculada à sua conta.</p></div><span className="module-icon module-icon-maintenance"><ClipboardPlus size={23} /></span></div>
    <form className="work-order-form" onSubmit={(event) => void submit(event)}>
      <div className="section-heading"><div><p className="eyebrow">NOVA SOLICITAÇÃO</p><h2>{reviewing ? 'Revise antes de enviar' : 'Descreva o que precisa'}</h2><p className="welcome-copy">{reviewing ? 'Confira os dados do chamado e confirme a abertura.' : 'Informe o tipo de serviço, o local e o que precisa ser feito.'}</p></div></div>
      {!reviewing ? <>
        <div className="field-grid field-grid-two">
          <label className="field"><span className="field-label">Tipo de serviço</span><select required value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option value="">Selecione uma categoria</option><option>Elétrica</option><option>Hidráulica</option><option>Climatização</option><option>Equipamento</option><option>Estrutura e mobiliário</option><option>Rede e telefonia</option><option>Outro serviço</option></select></label>
          <label className="field"><span className="field-label">Assunto</span><input required minLength={5} maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Ex.: torneira com vazamento" /></label>
          <label className="field"><span className="field-label">Setor solicitante</span><select required value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value, customDepartment: '' })}><option value="">Selecione seu setor</option><option>Enfermagem</option><option>Farmácia</option><option>Raio X</option><option>Serviço Social</option><option>Nutrição</option><option>Higienização</option><option>Recepção</option><option>Administração</option><option>Outro</option></select></label>
          {form.department === 'Outro' && <label className="field"><span className="field-label">Informe o setor</span><input required minLength={2} maxLength={100} value={form.customDepartment} onChange={(event) => setForm({ ...form, customDepartment: event.target.value })} /></label>}
          <label className="field"><span className="field-label">Unidade</span><select value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })}><option value="">Selecione a unidade</option><option>Hospital</option><option>Pronto atendimento</option><option>Área externa</option><option>Outro</option></select></label>
          <label className="field"><span className="field-label">Quarto, sala ou local</span><input maxLength={120} value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Ex.: quarto 3, sala de espera" /></label>
          <label className="field"><span className="field-label">Número do patrimônio (opcional)</span><input maxLength={60} value={form.assetCode} onChange={(event) => setForm({ ...form, assetCode: event.target.value })} placeholder="Etiqueta do equipamento" /></label>
          <label className="field"><span className="field-label">Prioridade</span><select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as WorkOrderPriority })}><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option></select><span className="field-hint">Use urgente quando houver impacto imediato no funcionamento ou na segurança.</span></label>
        </div>
        <label className="field"><span className="field-label">Descrição do serviço</span><textarea required minLength={5} maxLength={1450} rows={5} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Descreva o problema observado, quando começou e o resultado esperado." /><span className="field-hint">{form.description.length}/1.450 caracteres</span></label>
        <p className="work-order-privacy">Não inclua nome, diagnóstico ou outros dados de pacientes na descrição da ordem.</p>
      </> : <div className="work-order-review"><div><small>Categoria</small><strong>{form.category}</strong></div><div><small>Assunto</small><strong>{form.title}</strong></div><div><small>Setor solicitante</small><strong>{form.department === 'Outro' ? form.customDepartment : form.department}</strong></div><div><small>Localização</small><strong>{[form.unit && `Unidade: ${form.unit}`, form.location && `Local: ${form.location}`, form.assetCode && `Patrimônio: ${form.assetCode}`].filter(Boolean).join(' · ') || 'Não informado'}</strong></div><div><small>Prioridade</small><strong>{workOrderPriorities[form.priority]}</strong></div><div className="work-order-review-description"><small>Descrição</small><p>{form.description}</p></div></div>}
      {notice && <div className="form-message form-message-success" role="status">{notice}</div>}
      {error && <div className="form-message form-message-error" role="alert">{error}</div>}
      <div className="work-order-form-actions">{reviewing && <button className="button button-secondary" type="button" onClick={() => setReviewing(false)} disabled={saving}><ArrowLeft size={16} /> Editar solicitação</button>}<button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Enviando…' : reviewing ? 'Confirmar abertura' : 'Revisar solicitação'} {reviewing ? <BadgeCheck size={16} /> : <ArrowRight size={16} />}</button></div>
    </form>
    <section className="work-order-list-panel"><div className="section-heading"><div><p className="eyebrow">ACOMPANHAMENTO</p><h2>Minhas solicitações</h2></div><button className="button button-secondary" type="button" onClick={() => void loadOrders()} disabled={loading}>{loading ? 'Atualizando…' : 'Atualizar'}</button></div>
      {loading ? <div className="history-empty">Carregando solicitações…</div> : orders.length ? <div className="work-order-list">{orders.map((order) => <WorkOrderCard key={order.id} order={order} />)}</div> : <div className="history-empty"><ClipboardList size={20} /><span>Você ainda não abriu ordens de serviço.</span></div>}
    </section>
  </section>
}

function MaintenanceQueuePage() {
  const [orders, setOrders] = useState<WorkOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [changes, setChanges] = useState<Record<string, { status: WorkOrderStatus; note: string }>>({})

  async function loadQueue() {
    setLoading(true)
    try {
      const response = await fetch('/api/v1/maintenance/queue')
      const data = await response.json() as { orders?: WorkOrder[]; detail?: string }
      if (!response.ok) throw new Error(data.detail ?? 'Não foi possível carregar a fila de manutenção.')
      setOrders(data.orders ?? [])
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar a fila.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadQueue() }, [])

  async function saveStatus(order: WorkOrder) {
    const change = changes[order.id] ?? { status: order.status, note: '' }
    setError('')
    setNotice('')
    try {
      const response = await fetch(`/api/v1/maintenance/orders/${order.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: change.status, note: change.note }),
      })
      const data = await response.json() as WorkOrder & { detail?: string }
      if (!response.ok) throw new Error(data.detail ?? 'Não foi possível atualizar a ordem.')
      setOrders((current) => current.map((item) => item.id === data.id ? data : item))
      setChanges((current) => { const next = { ...current }; delete next[order.id]; return next })
      setNotice(`Ordem atualizada para “${workOrderStatuses[data.status]}”.`)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Falha ao atualizar a ordem.')
    }
  }

  return <section className="work-orders-page page-enter">
    <div className="page-title-row"><div><p className="eyebrow">EQUIPE DE MANUTENÇÃO</p><h1>Fila de ordens de serviço</h1><p className="welcome-copy">Consulte solicitações de todos os setores e atualize o andamento do serviço.</p></div><span className="module-icon module-icon-maintenance"><Wrench size={23} /></span></div>
    {notice && <div className="form-message form-message-success" role="status">{notice}</div>}{error && <div className="form-message form-message-error" role="alert">{error}</div>}
    <section className="work-order-list-panel"><div className="section-heading"><div><p className="eyebrow">PAINEL OPERACIONAL</p><h2>Solicitações recebidas <span className="module-total">{orders.length}</span></h2></div><button className="button button-secondary" type="button" onClick={() => void loadQueue()} disabled={loading}>{loading ? 'Atualizando…' : 'Atualizar fila'}</button></div>
      {loading ? <div className="history-empty">Carregando fila…</div> : orders.length ? <div className="work-order-list">{orders.map((order) => <WorkOrderCard key={order.id} order={order} editable onStatusChange={(status) => setChanges((current) => ({ ...current, [order.id]: { ...(current[order.id] ?? { status: order.status, note: '' }), status } }))} status={changes[order.id]?.status ?? order.status} note={changes[order.id]?.note ?? ''} onNoteChange={(note) => setChanges((current) => ({ ...current, [order.id]: { ...(current[order.id] ?? { status: order.status }), note } }))} onSave={() => void saveStatus(order)} saving={false} />)}</div> : <div className="history-empty"><CheckCircle2 size={20} /><span>Nenhuma ordem de serviço na fila.</span></div>}
    </section>
  </section>
}

function WorkOrderCard({ order, editable = false, status, note, onStatusChange, onNoteChange, onSave, saving = false }: { order: WorkOrder; editable?: boolean; status?: WorkOrderStatus; note?: string; onStatusChange?: (status: WorkOrderStatus) => void; onNoteChange?: (note: string) => void; onSave?: () => void; saving?: boolean }) {
  return <article className="work-order-card"><div className="work-order-card-heading"><div><span className={`work-order-priority priority-${order.priority}`}>{workOrderPriorities[order.priority]}</span><h3>{order.title}</h3></div><span className={`work-order-status status-${order.status}`}>{workOrderStatuses[order.status]}</span></div>
    <p className="work-order-description">{order.description}</p><div className="work-order-meta"><span><strong>Setor</strong>{order.department}</span>{order.location && <span><strong>Local</strong>{order.location}</span>}<span><strong>Solicitante</strong>{order.requester_name}</span><span><strong>Aberta em</strong>{dateTime(order.created_at)}</span><span><strong>Atualizada por</strong>{order.updated_by} · {dateTime(order.updated_at)}</span></div>
    {editable && <div className="work-order-actions"><label className="field"><span className="field-label">Status</span><select value={status ?? order.status} onChange={(event) => onStatusChange?.(event.target.value as WorkOrderStatus)}><option value="open">Aberta</option><option value="in_progress">Em curso</option><option value="completed">Finalizada</option><option value="cancelled">Cancelada</option></select></label><label className="field"><span className="field-label">Nota da atualização (opcional)</span><input maxLength={500} value={note ?? ''} onChange={(event) => onNoteChange?.(event.target.value)} placeholder="Ex.: peça solicitada" /></label><button className="button button-primary" type="button" disabled={saving} onClick={onSave}>{saving ? 'Salvando…' : 'Salvar andamento'}</button></div>}
  </article>
}

function PharmacyPage() {
  const [items, setItems] = useState<PharmacyItem[]>([])
  const [form, setForm] = useState({ item_name: '', balance: '', unit: '', lot: '', expiry_date: '' })
  const [query, setQuery] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function loadItems() {
    setLoading(true)
    try {
      const response = await fetch('/api/v1/pharmacy/items')
      const data = await response.json() as { items?: PharmacyItem[]; detail?: string }
      if (!response.ok) throw new Error(data.detail ?? 'Não foi possível carregar o estoque.')
      setItems(data.items ?? [])
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar o estoque.')
    } finally { setLoading(false) }
  }

  useEffect(() => { void loadItems() }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true); setError(''); setNotice('')
    try {
      const response = await fetch('/api/v1/pharmacy/items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, item_name: form.item_name.trim(), balance: form.balance.replace(',', '.'), unit: form.unit.trim(), lot: form.lot.trim() }) })
      const data = await response.json() as PharmacyItem & { detail?: string }
      if (!response.ok) throw new Error(data.detail ?? 'Não foi possível cadastrar o lote.')
      setItems((current) => [...current, data].sort((a, b) => a.item_name.localeCompare(b.item_name, 'pt-BR')))
      setForm({ item_name: '', balance: '', unit: '', lot: '', expiry_date: '' })
      setShowForm(false)
      setNotice('Lote cadastrado no estoque.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Falha ao cadastrar o lote.')
    } finally { setSaving(false) }
  }

  const today = new Date().toISOString().slice(0, 10)
  const soon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const expiredCount = items.filter((item) => item.expiry_date < today).length
  const expiringCount = items.filter((item) => item.expiry_date >= today && item.expiry_date <= soon).length
  const filteredItems = items.filter((item) => `${item.item_name} ${item.lot}`.toLocaleLowerCase('pt-BR').includes(query.trim().toLocaleLowerCase('pt-BR')))

  return <section className="pharmacy-page page-enter">
    <div className="page-title-row"><div><p className="eyebrow">MÓDULO · FARMÁCIA</p><h1>Estoque e validade</h1><p className="welcome-copy">Cadastre itens por lote e acompanhe saldo e prazo de validade.</p></div><button className="button button-primary" type="button" onClick={() => { setShowForm((current) => !current); setNotice(''); setError('') }}><Package size={16} /> {showForm ? 'Fechar cadastro' : 'Cadastrar lote'}</button></div>
    <div className="pharmacy-summary"><article><span>Itens e lotes</span><strong>{items.length}</strong><small>Registros cadastrados</small></article><article className={expiringCount ? 'pharmacy-summary-warning' : ''}><span>Vencem em até 30 dias</span><strong>{expiringCount}</strong><small>Acompanhe as datas</small></article><article className={expiredCount ? 'pharmacy-summary-danger' : ''}><span>Vencidos</span><strong>{expiredCount}</strong><small>Verifique o lote</small></article></div>
    {notice && <div className="form-message form-message-success" role="status">{notice}</div>}{error && <div className="form-message form-message-error" role="alert">{error}</div>}
    {showForm && <form className="pharmacy-form" onSubmit={(event) => void submit(event)}><div className="section-heading"><div><p className="eyebrow">ENTRADA DE ESTOQUE</p><h2>Dados do item e do lote</h2></div></div><div className="field-grid field-grid-two"><label className="field"><span className="field-label">Item</span><input required minLength={1} maxLength={120} value={form.item_name} onChange={(event) => setForm({ ...form, item_name: event.target.value })} placeholder="Nome do item" /></label><label className="field"><span className="field-label">Quantidade</span><input required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,3})?" maxLength={32} value={form.balance} onChange={(event) => setForm({ ...form, balance: event.target.value })} placeholder="Ex.: 24" /></label><label className="field"><span className="field-label">Unidade de medida</span><input required maxLength={24} list="pharmacy-units" value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} placeholder="Ex.: caixa, frasco, unidade" /><datalist id="pharmacy-units"><option value="unidade" /><option value="caixa" /><option value="frasco" /><option value="ampola" /><option value="pacote" /><option value="mL" /><option value="mg" /></datalist></label><label className="field"><span className="field-label">Lote</span><input required maxLength={80} value={form.lot} onChange={(event) => setForm({ ...form, lot: event.target.value })} /></label><label className="field"><span className="field-label">Validade</span><input required type="date" value={form.expiry_date} onChange={(event) => setForm({ ...form, expiry_date: event.target.value })} /></label></div><div className="pharmacy-form-actions"><button className="button button-secondary" type="button" onClick={() => setShowForm(false)} disabled={saving}>Cancelar</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Cadastrar lote'} <ArrowRight size={16} /></button></div></form>}
    <section className="pharmacy-inventory"><div className="section-heading"><div><p className="eyebrow">INVENTÁRIO</p><h2>Itens cadastrados</h2></div><button className="button button-secondary" type="button" onClick={() => void loadItems()} disabled={loading}>{loading ? 'Atualizando…' : 'Atualizar'}</button></div><label className="field pharmacy-search"><span className="field-label">Buscar por item ou lote</span><span className="search-input-wrap"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Digite o nome do item ou lote" /></span></label>
      {loading ? <div className="history-empty">Carregando estoque…</div> : filteredItems.length ? <div className="pharmacy-item-grid">{filteredItems.map((item) => { const expired = item.expiry_date < today; const expiring = !expired && item.expiry_date <= soon; return <article className="pharmacy-item-card" key={item.id}><div className="pharmacy-item-heading"><span className="pharmacy-item-icon"><Package size={18} /></span><span className={`pharmacy-expiry ${expired ? 'pharmacy-expired' : expiring ? 'pharmacy-expiring' : ''}`}>{expired ? <AlertTriangle size={14} /> : <CalendarDays size={14} />}{expired ? 'Vencido' : expiring ? 'Vence em breve' : 'Dentro da validade'}</span></div><h3>{item.item_name}</h3><div className="pharmacy-stock"><strong>{item.balance}</strong><span>{item.unit}</span></div><div className="pharmacy-item-meta"><span><small>Lote</small><strong>{item.lot}</strong></span><span><small>Validade</small><strong>{new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${item.expiry_date}T00:00:00Z`))}</strong></span></div></article> })}</div> : <div className="history-empty"><Package size={20} /><span>{query ? 'Nenhum item corresponde à busca.' : 'Nenhum lote cadastrado.'}</span></div>}
    </section>
  </section>
}

function AboutPage() {
  const legalReferences = [
    { title: 'LGPD · Lei nº 13.709/2018', articles: 'Arts. 5º, II (dado pessoal sensível, incluindo saúde); 6º, VII e VIII (segurança e prevenção); 11 (tratamento de dados sensíveis); 46 a 49 (segurança, sigilo e incidentes); 50 (boas práticas e governança).', href: 'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm', source: 'Presidência da República · texto compilado' },
    { title: 'Lei nº 13.787/2018 · digitalização e guarda de prontuários', articles: 'Dispõe sobre digitalização, uso de sistemas informatizados e guarda de prontuários de pacientes. A aplicação ao fluxo e aos prazos deve ser validada pela instituição.', href: 'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13787.htm', source: 'Presidência da República' },
    { title: 'ANPD · Guia de Segurança da Informação', articles: 'Orientações de medidas técnicas e administrativas para proteção de dados pessoais, com referência aos arts. 46 a 49 da LGPD.', href: 'https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_seguranca_da_informacao_para_atpps___defeso_eleitoral.pdf', source: 'Autoridade Nacional de Proteção de Dados' },
    { title: 'ANPD · Comunicação de incidentes', articles: 'Regulamento de Comunicação de Incidente de Segurança, Resolução CD/ANPD nº 15/2024. O controlador deve avaliar os critérios e prazos aplicáveis ao caso concreto.', href: 'https://www.in.gov.br/en/web/dou/-/resolucao-cd/anpd-n-15-de-24-de-abril-de-2024-556243024', source: 'Diário Oficial da União · ato normativo' },
  ]

  return <section className="about-page page-enter">
    <div className="page-title-row"><div><p className="eyebrow">SCPO CONNECT</p><h1>Sobre e conformidade</h1><p className="welcome-copy">Referências legais e princípios considerados no desenvolvimento do sistema.</p></div><span className="module-icon module-icon-admin"><ShieldCheck size={23} /></span></div>
    <section className="notice-band about-notice"><div className="notice-icon"><LockKeyhole size={20} /></div><div><strong>Privacidade e segurança desde a concepção</strong><p>Dados de saúde são dados pessoais sensíveis. O uso institucional depende de controles de acesso, governança, retenção e resposta a incidentes definidos pela Santa Casa.</p></div></section>
    <div className="about-legal-grid">{legalReferences.map((item) => <article className="about-legal-card" key={item.title}><p className="eyebrow">REFERÊNCIA OFICIAL</p><h2>{item.title}</h2><p>{item.articles}</p><a href={item.href} target="_blank" rel="noreferrer">Consultar fonte oficial <ArrowRight size={15} /></a><small>{item.source}</small></article>)}</div>
    <section className="activity-panel about-scope"><div className="panel-heading"><div><p className="eyebrow">ESCOPO</p><h2>O que esta página representa</h2></div><Info size={18} /></div><p>Estas referências orientam a análise do projeto e não constituem declaração de conformidade, parecer jurídico ou substituição das políticas da instituição. A Santa Casa deve definir controlador e operador, encarregado, finalidade e base legal, perfis de acesso, retenção, atendimento aos titulares, gestão de incidentes e validação clínica antes de tratar dados reais.</p></section>
  </section>
}

function Dashboard({ profile, onNavigate }: { profile: Profile; onNavigate: (id: ModuleId) => void }) {
  const allowedModules = modules.filter((item) => profile.modules.includes(item.id))
  const firstName = profile.name.split(' ')[0]

  return (
    <section className="dashboard-page page-enter">
      <div className="welcome-row">
        <div><p className="eyebrow">{new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()).toUpperCase()}</p><h1>{getGreeting()}, {firstName}.</h1><p className="welcome-copy">Acesse os espaços de trabalho disponíveis para o seu perfil.</p></div>
        <div className="date-chip"><Clock3 size={16} /><span>{allowedModules.length} módulos disponíveis</span></div>
      </div>

      <div className="section-heading"><div><p className="eyebrow">ACESSO POR PERFIL</p><h2>Seus espaços de trabalho</h2></div><span className="module-total">{allowedModules.length} disponível{allowedModules.length === 1 ? '' : 'is'}</span></div>
      <div className="module-grid">
        {modules.map(({ id, label, icon: Icon, description }) => {
          const available = profile.modules.includes(id)
          return (
            <button key={id} type="button" className={`module-card ${available ? 'module-card-available' : 'module-card-locked'}`} onClick={() => available && onNavigate(id)} disabled={!available}>
              <span className={`module-icon module-icon-${id}`}><Icon size={29} strokeWidth={1.8} /></span>
              <span className="module-card-title">{label}</span>
              <span className="module-card-description">{description}</span>
              <span className={`module-card-status ${available ? 'status-ready' : 'status-later'}`}>{available ? <><span className="status-dot" /> Disponível no perfil</> : <><LockKeyhole size={13} /> Acesso não concedido</>}</span>
              {available && <ArrowRight className="module-arrow" size={17} aria-hidden="true" />}
            </button>
          )
        })}
      </div>

      <div className="dashboard-lower">
        <section className="activity-panel">
          <div className="panel-heading"><div><p className="eyebrow">SESSÃO ATUAL</p><h2>Visão do ambiente</h2></div><span className="live-indicator"><span className="status-dot" /> Ativo</span></div>
          <div className="session-row"><span className="session-icon"><UserRound size={18} /></span><div><span>Perfil em uso</span><strong>{profile.name} · {profile.role}</strong></div></div>
          <div className="session-row"><span className="session-icon"><LockKeyhole size={18} /></span><div><span>Permissões</span><strong>Acesso limitado aos módulos autorizados</strong></div><ShieldCheck className="session-verified" size={18} /></div>
        </section>
        <aside className="next-step-panel"><span className="next-step-icon"><ClipboardList size={19} /></span><p className="eyebrow">ROTINAS ORGANIZADAS</p><h3>Informação clara para o trabalho em equipe.</h3><p>Acesse os módulos disponíveis para consultar e registrar informações do ambiente.</p></aside>
      </div>
    </section>
  )
}

function InstallAppButton() {
  const [installPrompt, setInstallPrompt] = useState<Event | null>(deferredInstallPrompt)
  const [helpOpen, setHelpOpen] = useState(false)
  const [installed, setInstalled] = useState(false)
  useEffect(() => {
    const promptReady = () => setInstallPrompt(deferredInstallPrompt)
    const installedListener = () => { setInstalled(true); setInstallPrompt(null) }
    setInstalled(window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
    window.addEventListener('scpo-install-ready', promptReady)
    window.addEventListener('appinstalled', installedListener)
    return () => { window.removeEventListener('scpo-install-ready', promptReady); window.removeEventListener('appinstalled', installedListener) }
  }, [])
  if (installed) return <span className="install-installed">Aplicativo instalado</span>
  return <>
    <button className="button button-secondary install-button" type="button" onClick={async () => {
      if (!installPrompt) { setHelpOpen(true); return }
      const prompt = installPrompt as Event & { prompt: () => Promise<void>; userChoice?: Promise<{ outcome: string }> }
      await prompt.prompt()
      const choice = await prompt.userChoice
      if (choice?.outcome === 'accepted') setInstalled(true)
      deferredInstallPrompt = null
      setInstallPrompt(null)
    }}>Instalar app</button>
    {helpOpen && <div className="install-dialog-backdrop" role="presentation" onClick={() => setHelpOpen(false)}><section className="install-dialog" role="dialog" aria-modal="true" aria-labelledby="install-dialog-title" onClick={(event) => event.stopPropagation()}><button className="install-dialog-close" type="button" aria-label="Fechar" onClick={() => setHelpOpen(false)}>×</button><h2 id="install-dialog-title">Instalar SCPO Connect</h2>{!window.isSecureContext ? <p>A instalação direta exige uma conexão segura (HTTPS). Abra o endereço HTTPS do SCPO neste dispositivo e toque novamente em “Instalar app”.</p> : /iPhone|iPad|iPod/i.test(navigator.userAgent) ? <p>No iPhone ou iPad, toque em <strong>Compartilhar</strong> e depois em <strong>Adicionar à Tela de Início</strong>. O iOS exige essa confirmação do sistema.</p> : <p>Este navegador ainda não liberou a instalação direta. Atualize a página e tente novamente. Em alguns dispositivos, a instalação depende de HTTPS e do suporte do navegador.</p>}<button className="button button-primary" type="button" onClick={() => setHelpOpen(false)}>Entendi</button></section></div>}
  </>
}

function NursingHistoryPage({ onBack }: { onBack: () => void }) {
  const pageSize = 50
  const [patients, setPatients] = useState<Patient[]>([])
  const [records, setRecords] = useState<VitalRecordData[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [room, setRoom] = useState('')
  const [bed, setBed] = useState('')
  const [patientReference, setPatientReference] = useState('')
  const [metric, setMetric] = useState('saturation')
  const [loadingPatients, setLoadingPatients] = useState(true)
  const [loadingRecords, setLoadingRecords] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let current = true
    fetch('/api/v1/nursing/patients').then(async (response) => {
      if (!response.ok) throw new Error('Não foi possível carregar os pacientes.')
      return await response.json() as { patients: Patient[] }
    }).then((data) => { if (current) setPatients(data.patients) }).catch((loadError) => {
      if (current) setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar os pacientes.')
    }).finally(() => { if (current) setLoadingPatients(false) })
    return () => { current = false }
  }, [])

  useEffect(() => {
    if (fromDate && toDate && fromDate > toDate) {
      setError('A data inicial deve ser anterior ou igual à data final.')
      setRecords([])
      setTotal(0)
      setLoadingRecords(false)
      return
    }
    const controller = new AbortController()
    const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) })
    if (fromDate) params.set('from_date', fromDate)
    if (toDate) params.set('to_date', toDate)
    if (room) params.set('room', room)
    if (bed) params.set('bed', bed)
    if (patientReference) params.set('patient_reference', patientReference)
    setLoadingRecords(true)
    fetch(`/api/v1/nursing/vitals?${params.toString()}`, { signal: controller.signal }).then(async (response) => {
      const data = await response.json() as { records?: VitalRecordData[]; total?: number; detail?: string }
      if (!response.ok) throw new Error(data.detail ?? 'Não foi possível carregar as coletas.')
      return data
    }).then((data) => {
      setRecords(data.records ?? [])
      setTotal(data.total ?? 0)
      setError('')
    }).catch((loadError) => {
      if (loadError instanceof DOMException && loadError.name === 'AbortError') return
      setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar as coletas.')
      setRecords([])
      setTotal(0)
    }).finally(() => { if (!controller.signal.aborted) setLoadingRecords(false) })
    return () => controller.abort()
  }, [fromDate, toDate, room, bed, patientReference, offset])

  const visiblePatients = patients.filter((patient) => (!room || patient.room === room) && (!bed || patient.bed === bed))
  const roomOptions = [...new Set(patients.map((patient) => patient.room))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))
  const bedOptions = [...new Set(patients.filter((patient) => !room || patient.room === room).map((patient) => patient.bed))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))
  const pageNumber = Math.floor(offset / pageSize) + 1
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  function clearFilters() {
    setFromDate(''); setToDate(''); setRoom(''); setBed(''); setPatientReference(''); setOffset(0)
  }

  return <section className="nursing-history-page page-enter">
    <div className="page-title-row"><div><p className="eyebrow">MÓDULO · ENFERMAGEM</p><h1>Coletas registradas</h1><p className="welcome-copy">Consulte valores e evolução por paciente, quarto, leito e período.</p></div><button className="button button-secondary" type="button" onClick={onBack}><ArrowLeft size={16} /> Voltar à coleta</button></div>
    <section className="history-filter-panel" aria-label="Filtros das coletas">
      <div className="section-heading"><div><p className="eyebrow">CONSULTA</p><h2>Filtrar registros</h2></div><span className="module-total">{total} {total === 1 ? 'coleta' : 'coletas'}</span></div>
      <div className="history-filter-grid">
        <label className="field"><span className="field-label">Data inicial</span><input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => { setFromDate(event.target.value); setOffset(0) }} /></label>
        <label className="field"><span className="field-label">Data final</span><input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => { setToDate(event.target.value); setOffset(0) }} /></label>
        <label className="field"><span className="field-label">Quarto</span><select value={room} onChange={(event) => { setRoom(event.target.value); setBed(''); setPatientReference(''); setOffset(0) }}><option value="">Todos os quartos</option>{roomOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label className="field"><span className="field-label">Leito</span><select value={bed} onChange={(event) => { setBed(event.target.value); setPatientReference(''); setOffset(0) }}><option value="">Todos os leitos</option>{bedOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label className="field history-filter-patient"><span className="field-label">Paciente</span><select value={patientReference} onChange={(event) => { setPatientReference(event.target.value); setOffset(0) }} disabled={loadingPatients}><option value="">Todos os pacientes</option>{visiblePatients.map((patient) => <option key={patient.reference} value={patient.reference}>{patient.name} · Qto {patient.room} · Leito {patient.bed}</option>)}</select></label>
      </div>
      <button className="button button-secondary history-clear-button" type="button" onClick={clearFilters}>Limpar filtros</button>
    </section>
    {error && <div className="form-message form-message-error" role="alert">{error}</div>}
    {loadingRecords ? <div className="history-empty">Carregando coletas…</div> : <VitalHistory records={records} patients={patients} metric={metric} onMetric={setMetric} />}
    {!loadingRecords && total > pageSize && <nav className="history-pagination" aria-label="Paginação das coletas"><span>Exibindo {offset + 1}–{Math.min(offset + records.length, total)} de {total}</span><div><button className="button button-secondary" type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}><ArrowLeft size={15} /> Anterior</button><span>Página {pageNumber} de {pageCount}</span><button className="button button-secondary" type="button" disabled={offset + pageSize >= total} onClick={() => setOffset(offset + pageSize)}>Próxima <ArrowRight size={15} /></button></div></nav>}
  </section>
}

function NursingPage({ profile, onShowHistory }: { profile: Profile; onShowHistory: () => void }) {
  const [record, setRecord] = useState<RecordFields>({ ...emptyRecord })
  const [notApplicable, setNotApplicable] = useState<string[]>([])
  const [entryState, setEntryState] = useState<EntryState>('draft')
  const [message, setMessage] = useState('')
  const [savedAt, setSavedAt] = useState('')
  const [patients, setPatients] = useState<Patient[]>([])
  const [patientRef, setPatientRef] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [showPatientForm, setShowPatientForm] = useState(false)
  const [newPatient, setNewPatient] = useState({ name: '', room: '', bed: '' })

  useEffect(() => {
    let current = true
    fetch('/api/v1/nursing/patients').then(async (patientResponse) => {
      if (!patientResponse.ok) throw new Error('load-failed')
      return await patientResponse.json() as { patients: Patient[] }
    }).then((patientData) => {
      if (!current) return
      setPatients(patientData.patients)
      setHistoryError('')
      if (!patientData.patients.some((item) => item.reference === patientRef) && patientData.patients[0]) setPatientRef(patientData.patients[0].reference)
    }).catch(() => { if (current) setHistoryError('Não foi possível carregar os dados. Reinicie os serviços e confirme que as migrações foram aplicadas.') })
    return () => { current = false }
  }, [profile.id])

  async function addPatient(event: FormEvent) {
    event.preventDefault()
    const response = await fetch('/api/v1/nursing/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newPatient) })
    if (!response.ok) return
    const patient = await response.json() as Patient
    setPatients((items) => [...items, patient])
    setPatientRef(patient.reference)
    setShowPatientForm(false)
    setNewPatient({ name: '', room: '', bed: '' })
  }

  function updateField(field: keyof RecordFields, value: string) {
    setRecord((current) => ({ ...current, [field]: value }))
    setEntryState('draft')
    setMessage('')
  }

  function toggleNotApplicable(field: keyof RecordFields) {
    setNotApplicable((current) => current.includes(field) ? current.filter((item) => item !== field) : [...current, field])
    updateField(field, '')
  }

  async function saveRecord() {
    setEntryState('saving')
    setMessage('')
    try {
      const response = await fetch('/api/v1/nursing/vitals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_reference: patientRef,
          values: Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'glucoseUnit')),
          glucose_unit: record.glucoseUnit,
          not_applicable: notApplicable,
        }),
      })
      if (!response.ok) throw new Error('save-failed')
      await response.json()
      setEntryState('saved')
      setSavedAt(new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date()))
      setMessage('Coleta salva com sucesso.')
    } catch {
      setEntryState('error')
      setMessage('Não foi possível salvar. Verifique se a API de enfermagem está disponível e tente novamente; seu rascunho continua nesta sessão.')
    }
  }

  function resetRecord() {
    setRecord({ ...emptyRecord })
    setNotApplicable([])
    setEntryState('draft')
    setMessage('')
    setSavedAt('')
  }

  const stateLabels: Record<EntryState, string> = { draft: 'Rascunho', review: 'Revisão antes de salvar', saving: 'Salvando', saved: 'Salvo', error: 'Erro ao salvar' }
  const statusIcon = entryState === 'saved' ? <BadgeCheck size={15} /> : entryState === 'error' ? <X size={15} /> : entryState === 'saving' ? <span className="spinner" /> : <Pencil size={14} />

  return (
    <section className="nursing-page page-enter">
      <div className="page-title-row"><div><p className="eyebrow">MÓDULO · ENFERMAGEM</p><h1>Sinais vitais</h1><p className="welcome-copy">Registre uma nova coleta ou abra o histórico para consultar registros por período e localização.</p></div><div className="nursing-title-actions"><button className="button button-secondary" type="button" onClick={onShowHistory}><ClipboardList size={16} /> Coletas registradas</button><span className={`entry-status entry-status-${entryState}`}>{statusIcon}{stateLabels[entryState]}</span></div></div>
      <div className="patient-strip"><span className="patient-avatar"><Stethoscope size={19} /></span><label className="patient-copy"><span>Paciente · quarto · leito</span><select value={patientRef} onChange={(event) => setPatientRef(event.target.value)}>{patients.map((patient) => <option key={patient.reference} value={patient.reference}>{patient.name} · Qto {patient.room} · Leito {patient.bed}</option>)}</select></label><button className="button button-secondary" type="button" onClick={() => setShowPatientForm((visible) => !visible)}>Cadastrar paciente</button><div className="patient-meta"><span>Registrado por</span><strong>{profile.name}</strong></div></div>
      {showPatientForm && <form className="patient-create-form" onSubmit={addPatient}><label className="field"><span className="field-label">Nome do paciente</span><input required value={newPatient.name} onChange={(event) => setNewPatient({ ...newPatient, name: event.target.value })} /></label><label className="field"><span className="field-label">Quarto</span><input required value={newPatient.room} onChange={(event) => setNewPatient({ ...newPatient, room: event.target.value })} /></label><label className="field"><span className="field-label">Leito</span><input required value={newPatient.bed} onChange={(event) => setNewPatient({ ...newPatient, bed: event.target.value })} /></label><button className="button button-primary" type="submit">Salvar paciente</button></form>}
      {historyError && <div className="form-message form-message-error" role="alert">{historyError}</div>}

      {patients.length === 0 ? (
        <section className="placeholder-state patient-empty-state"><span className="placeholder-state-icon"><UsersRound size={20} /></span><div><strong>Cadastre o primeiro paciente</strong><p>Informe nome, quarto e leito para iniciar a coleta e manter o histórico vinculado ao paciente.</p></div><button className="button button-primary" type="button" onClick={() => setShowPatientForm(true)}>Cadastrar paciente</button></section>
      ) : entryState === 'review' || entryState === 'saving' ? (
        <ReviewPanel record={record} notApplicable={notApplicable} patient={patients.find((item) => item.reference === patientRef)} onBack={() => setEntryState('draft')} onConfirm={saveRecord} isSaving={entryState === 'saving'} />
      ) : entryState === 'saved' ? (
        <SavedConfirmation savedAt={savedAt} actorName={profile.name} patient={patients.find((item) => item.reference === patientRef)} onReset={resetRecord} />
      ) : (
        <form className="nursing-form" onSubmit={(event) => { event.preventDefault(); setEntryState('review'); setMessage('') }}>
          <FormSection number="01" title="Sinais vitais" detail="Unidades indicadas em cada campo. Campos sem preenchimento permanecem em branco.">
            <div className="field-grid field-grid-four">
              <ValueField label="Saturação" unit="%" value={record.saturation} disabled={notApplicable.includes('saturation')} onChange={(value) => updateField('saturation', value)} onNA={() => toggleNotApplicable('saturation')} isNA={notApplicable.includes('saturation')} inputMode="decimal" />
              <ValueField label="Pressão arterial" unit="mmHg" value={record.pressure} disabled={notApplicable.includes('pressure')} onChange={(value) => updateField('pressure', value)} onNA={() => toggleNotApplicable('pressure')} isNA={notApplicable.includes('pressure')} placeholder="Ex.: 120/80" />
              <ValueField label="Frequência cardíaca" unit="bpm" value={record.heartRate} disabled={notApplicable.includes('heartRate')} onChange={(value) => updateField('heartRate', value)} onNA={() => toggleNotApplicable('heartRate')} isNA={notApplicable.includes('heartRate')} inputMode="numeric" />
              <ValueField label="Frequência respiratória" unit="rpm" value={record.respiratoryRate} disabled={notApplicable.includes('respiratoryRate')} onChange={(value) => updateField('respiratoryRate', value)} onNA={() => toggleNotApplicable('respiratoryRate')} isNA={notApplicable.includes('respiratoryRate')} inputMode="numeric" />
            </div>
          </FormSection>

          <FormSection number="02" title="Glicose" detail="A unidade é exibida e pode ser alterada para esta coleta.">
            <div className="field-grid field-grid-two">
              <ValueField label="Valor" unit={record.glucoseUnit} value={record.glucose} disabled={notApplicable.includes('glucose')} onChange={(value) => updateField('glucose', value)} onNA={() => toggleNotApplicable('glucose')} isNA={notApplicable.includes('glucose')} inputMode="decimal" />
              <label className="field"><span className="field-label">Unidade</span><select value={record.glucoseUnit} onChange={(event) => updateField('glucoseUnit', event.target.value)} disabled={notApplicable.includes('glucose')}><option>mg/dL</option><option>mmol/L</option></select></label>
            </div>
          </FormSection>

          <FormSection number="03" title="Acesso venoso" detail="Campos livres de acordo com a configuração institucional. Não representam protocolo.">
            <div className="field-grid field-grid-three">
              <TextField label="Local" value={record.venousSite} onChange={(value) => updateField('venousSite', value)} placeholder="Não informado" />
              <label className="field"><span className="field-label">Condição informada</span><select value={record.venousCondition} onChange={(event) => updateField('venousCondition', event.target.value)}><option value="">Selecionar ou deixar em branco</option><option value="não se aplica">Não se aplica</option><option value="não informado">Não informado</option><option value="registrada">Registrada</option></select></label>
              <TextField label="Observação" value={record.venousNote} onChange={(value) => updateField('venousNote', value)} placeholder="Opcional" />
            </div>
          </FormSection>

          <FormSection number="04" title="Eliminações" detail="Registre separadamente ou selecione “Não se aplica”.">
            <div className="field-grid field-grid-two">
              <label className="field"><span className="field-label">Urinária</span><select value={record.urine} onChange={(event) => updateField('urine', event.target.value)}><option value="">Não preenchida</option><option value="não se aplica">Não se aplica</option><option value="registrada">Registrada</option></select></label>
              <label className="field"><span className="field-label">Intestinal</span><select value={record.bowel} onChange={(event) => updateField('bowel', event.target.value)}><option value="">Não preenchida</option><option value="não se aplica">Não se aplica</option><option value="registrada">Registrada</option></select></label>
            </div>
          </FormSection>

          <FormSection number="05" title="Dor / algia" detail="Informe o valor e a escala utilizada, quando aplicável.">
            <div className="field-grid field-grid-two">
              <TextField label="Valor informado" value={record.pain} onChange={(value) => updateField('pain', value)} placeholder="Não preenchido" inputMode="decimal" />
              <TextField label="Escala utilizada" value={record.painScale} onChange={(value) => updateField('painScale', value)} placeholder="Definição institucional" />
            </div>
          </FormSection>

          <FormSection number="06" title="Observações" detail="Até 1.000 caracteres.">
            <label className="field"><span className="field-label">Texto livre</span><textarea value={record.notes} onChange={(event) => updateField('notes', event.target.value)} maxLength={1000} rows={3} placeholder="Observações complementares" /><span className="field-hint">{record.notes.length}/1.000 caracteres</span></label>
          </FormSection>

          {message && <div className={`form-message ${entryState === 'error' ? 'form-message-error' : ''}`} role="status">{message}</div>}
          <div className="form-actions"><span className="draft-hint"><Pencil size={14} /> Rascunho temporário nesta sessão</span><button className="button button-primary" type="submit">Revisar coleta <ArrowRight size={17} /></button></div>
        </form>
      )}

      <div className="clinical-note"><ShieldCheck size={17} /><span>Os gráficos apresentam os valores registrados, sem interpretação clínica automática.</span></div>
    </section>
  )
}

const vitalMetrics: { key: string; label: string; unit: string; field: string; part?: number; glucoseUnit?: string }[] = [
  { key: 'saturation', label: 'Saturação', unit: '%', field: 'saturation' },
  { key: 'pressure_systolic', label: 'Pressão sistólica', unit: 'mmHg', field: 'pressure', part: 0 },
  { key: 'pressure_diastolic', label: 'Pressão diastólica', unit: 'mmHg', field: 'pressure', part: 1 },
  { key: 'heartRate', label: 'Frequência cardíaca', unit: 'bpm', field: 'heartRate' },
  { key: 'respiratoryRate', label: 'Frequência respiratória', unit: 'rpm', field: 'respiratoryRate' },
  { key: 'glucose_mgdl', label: 'Glicose · mg/dL', unit: 'mg/dL', field: 'glucose', glucoseUnit: 'mg/dL' },
  { key: 'glucose_mmoll', label: 'Glicose · mmol/L', unit: 'mmol/L', field: 'glucose', glucoseUnit: 'mmol/L' },
]

function VitalHistory({ records, patients, metric, onMetric }: { records: VitalRecordData[]; patients: Patient[]; metric: string; onMetric: (value: string) => void }) {
  const config = vitalMetrics.find((item) => item.key === metric) ?? vitalMetrics[0]
  const points = records.slice().reverse().flatMap((record, index) => {
    if ('glucoseUnit' in config && config.glucoseUnit && record.glucose_unit !== config.glucoseUnit) return []
    const raw = record.values[config.field]
    const value = raw ? Number.parseFloat(raw.replace(',', '.').split('/')[config.part ?? 0]) : NaN
    return Number.isFinite(value) ? [{ value, label: new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(record.recorded_at)), index }] : []
  })
  const min = Math.min(...points.map((point) => point.value))
  const max = Math.max(...points.map((point) => point.value))
  const span = max - min || 1
  const coordinates = points.map((point, index) => ({ ...point, x: points.length < 2 ? 50 : 8 + index * 84 / (points.length - 1), y: 90 - ((point.value - min) / span) * 72 }))
  const line = coordinates.map((point) => `${point.x},${point.y}`).join(' ')
  return <section className="vital-history"><div className="history-heading"><div><p className="eyebrow">CONSULTA DE REGISTROS</p><h2>Histórico de sinais vitais</h2><p className="welcome-copy">Confira os valores registrados, horário e profissional responsável.</p></div><label className="history-metric"><span className="field-label">Indicador</span><select value={metric} onChange={(event) => onMetric(event.target.value)}>{vitalMetrics.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label></div>{points.length ? <><div className="history-chart"><svg viewBox="0 0 100 100" role="img" aria-label={`Gráfico de ${config.label}`} preserveAspectRatio="none"><line x1="5" y1="90" x2="95" y2="90" className="chart-axis" />{points.length > 1 && <polyline points={line} className="chart-line" />}{coordinates.map((point) => <circle key={`${point.label}-${point.index}`} cx={point.x} cy={point.y} r="2.1" className="chart-point"><title>{point.label}: {point.value} {config.unit}</title></circle>)}</svg></div><div className="history-values">{coordinates.slice(-5).reverse().map((point) => <span key={`${point.label}-${point.index}`}><strong>{point.value} {config.unit}</strong><small>{point.label}</small></span>)}</div></> : <div className="history-empty"><Activity size={20} /><span>As coletas deste paciente aparecerão aqui.</span></div>}{records.length > 0 && <div className="collection-list"><h3>Coletas recentes</h3>{records.map((record) => { const patient = patients.find((item) => item.reference === record.patient_reference); return <article className="collection-row" key={record.id}><div className="collection-row-heading"><strong>{patient?.name ?? 'Paciente'} · Qto {patient?.room ?? '—'} · Leito {patient?.bed ?? '—'}</strong><time>{dateTime(record.recorded_at)}</time></div><div className="collection-values">{[['Saturação', record.values.saturation && `${record.values.saturation}%`], ['Pressão', record.values.pressure], ['FC', record.values.heartRate && `${record.values.heartRate} bpm`], ['FR', record.values.respiratoryRate && `${record.values.respiratoryRate} rpm`], ['Glicose', record.values.glucose && `${record.values.glucose} ${record.glucose_unit}`], ['Dor', record.values.pain]].filter(([, value]) => value).map(([label, value]) => <span key={label}><small>{label}</small><strong>{value}</strong></span>)}</div><small className="collection-actor">Registrado por {record.actor_name}</small></article> })}</div>}</section>
}

function FormSection({ number, title, detail, children }: { number: string; title: string; detail: string; children: React.ReactNode }) {
  return <section className="form-section"><div className="form-section-heading"><span className="section-number">{number}</span><div><h2>{title}</h2><p>{detail}</p></div></div>{children}</section>
}

function ValueField({ label, unit, value, disabled, onChange, onNA, isNA, placeholder, inputMode }: { label: string; unit: string; value: string; disabled: boolean; onChange: (value: string) => void; onNA: () => void; isNA: boolean; placeholder?: string; inputMode?: 'numeric' | 'decimal' }) {
  const id = `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return (
    <div className="field value-field"><label className="field-label" htmlFor={id}>{label}</label><div className={`input-with-unit ${isNA ? 'input-na' : ''}`}><input id={id} type="text" inputMode={inputMode} value={value} onChange={(event) => onChange(event.target.value)} placeholder={isNA ? 'Não se aplica' : placeholder ?? 'Não preenchido'} disabled={disabled} /><span className="unit-label">{unit}</span></div><label className="checkbox-label"><input type="checkbox" checked={isNA} onChange={onNA} /><span>Não se aplica</span></label></div>
  )
}

function TextField({ label, value, onChange, placeholder, inputMode }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; inputMode?: 'numeric' | 'decimal' }) {
  const id = `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return <label className="field" htmlFor={id}><span className="field-label">{label}</span><input id={id} type="text" inputMode={inputMode} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>
}

function ReviewPanel({ record, notApplicable, patient, onBack, onConfirm, isSaving }: { record: RecordFields; notApplicable: string[]; patient?: Patient; onBack: () => void; onConfirm: () => void; isSaving: boolean }) {
  const items = (Object.keys(record) as (keyof RecordFields)[]).filter((key) => key !== 'glucoseUnit').map((key) => {
    const rawValue = notApplicable.includes(key) ? 'Não se aplica' : record[key] || 'Não preenchido'
    const value = key === 'glucose' && record[key] ? `${record[key]} ${record.glucoseUnit}` : rawValue
    return { label: fieldLabels[key], value }
  })

  return (
    <section className="review-panel">
      <div className="review-heading"><span className="review-icon"><ClipboardList size={20} /></span><div><p className="eyebrow">CONFIRMAÇÃO</p><h2>Revise antes de salvar</h2><p>Confira os campos. Os itens não preenchidos estão identificados.</p></div></div>
      <div className="review-grid">{items.map(({ label, value }) => <div className="review-item" key={label}><span>{label}</span><strong className={value === 'Não preenchido' ? 'review-empty' : ''}>{value}</strong></div>)}</div>
      <div className="review-patient"><UserRound size={17} /><span>{patient?.reference}</span><span>{patient?.name} · Quarto {patient?.room} · Leito {patient?.bed}</span></div>
      <div className="form-actions review-actions"><button className="button button-secondary" type="button" onClick={onBack} disabled={isSaving}><ArrowLeft size={17} /> Voltar ao formulário</button><button className="button button-primary" type="button" onClick={onConfirm} disabled={isSaving}>{isSaving ? 'Salvando…' : 'Confirmar e salvar'}{isSaving ? <span className="spinner" /> : <BadgeCheck size={17} />}</button></div>
    </section>
  )
}

function SavedConfirmation({ savedAt, actorName, patient, onReset }: { savedAt: string; actorName: string; patient?: Patient; onReset: () => void }) {
  return (
    <section className="saved-confirmation" role="status">
      <span className="saved-confirmation-icon"><BadgeCheck size={23} /></span>
      <p className="eyebrow">ENFERMAGEM</p>
      <h2>Registro salvo</h2>
      <p>A coleta foi registrada e está disponível no histórico deste paciente.</p>
      <div className="saved-confirmation-meta"><span><strong>Paciente</strong>{patient?.name} · Qto {patient?.room} · Leito {patient?.bed}</span><span><strong>Registrado por</strong>{actorName}</span><span><strong>Data e hora</strong>{savedAt}</span></div>
      <button className="button button-primary" type="button" onClick={onReset}><Pencil size={16} /> Nova coleta</button>
    </section>
  )
}

type Account = { id: string; username: string; name: string; modules: string[]; permissions: Record<string, string[]>; active: boolean; must_change_password: boolean; mfa_enabled: boolean }

const moduleLabels: Record<string, string> = {
  patients: 'Pacientes', nursing: 'Enfermagem', pharmacy: 'Farmácia', xray: 'Raio X', social: 'Serviço Social',
  nutrition: 'Nutrição', hygiene: 'Higienização', reception: 'Recepção', therapy: 'Oficina Terapêutica',
  psychology: 'Psicologia / Psiquiatria', maintenance: 'Manutenção',
  management: 'Gestão Hospitalar', admin: 'Administração',
}
const accessModules = Object.entries(moduleLabels).filter(([module]) => module !== 'admin')

function AdminPage() {
  const [users, setUsers] = useState<Account[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [notice, setNotice] = useState('')
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [selectedModules, setSelectedModules] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  async function loadUsers() {
    setStatus('loading')
    try {
      const response = await fetch('/api/v1/access/users')
      if (!response.ok) throw new Error('Não foi possível carregar usuários.')
      const data = await response.json() as { users: Account[] }
      setUsers(data.users)
      setStatus('ready')
    } catch {
      setStatus('unavailable')
    }
  }
  useEffect(() => { void loadUsers() }, [])

  function toggleModule(module: string) {
    setSelectedModules((current) => current.includes(module) ? current.filter((item) => item !== module) : [...current, module])
  }

  async function createAccount(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setNotice('')
    const permissions = Object.fromEntries(selectedModules.map((module) => [module, module === 'management' ? ['consultar', 'criar', 'alterar', 'administrar'] : ['consultar', 'criar', 'alterar']]))
    try {
      const response = await fetch('/api/v1/access/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, username, modules: selectedModules, permissions }),
      })
      const data = await response.json() as Account & { detail?: string; initial_password?: string }
      if (!response.ok) throw new Error(data.detail ?? 'Não foi possível criar a conta.')
      setName('')
      setUsername('')
      setSelectedModules([])
      setNotice(`Conta ${data.username} criada. Senha inicial: ${data.initial_password}. No primeiro acesso, será obrigatória a troca de senha e a ativação do MFA.`)
      await loadUsers()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Falha ao criar a conta.')
    } finally {
      setSaving(false)
    }
  }

  async function updateAccount(user: Account, body: Record<string, unknown>, success: string) {
    setNotice('')
    try {
      const response = await fetch(`/api/v1/access/users/${user.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await response.json() as Account & { detail?: string }
      if (!response.ok) throw new Error(data.detail ?? 'Não foi possível atualizar a conta.')
      setUsers((current) => current.map((item) => item.id === user.id ? data : item))
      setNotice(success)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Falha ao atualizar a conta.')
    }
  }

  async function resetCredentials(user: Account) {
    if (!window.confirm(`Redefinir senha e MFA de ${user.name}? A senha temporária será 0000.`)) return
    try {
      const response = await fetch(`/api/v1/access/users/${user.id}/reset-credentials`, { method: 'POST' })
      const data = await response.json() as { initial_password?: string; detail?: string }
      if (!response.ok) throw new Error(data.detail ?? 'Não foi possível redefinir as credenciais.')
      setNotice(`Credenciais de ${user.username} redefinidas. Senha inicial: ${data.initial_password}; a troca e o MFA serão obrigatórios no próximo acesso.`)
      await loadUsers()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Falha ao redefinir credenciais.')
    }
  }

  return <section className="admin-page page-enter">
    <div className="page-title-row"><div><p className="eyebrow">GESTÃO HOSPITALAR · ADMINISTRADOR MASTER</p><h1>Usuários e permissões</h1><p className="welcome-copy">Crie contas individuais e conceda acesso a um ou mais módulos.</p></div><span className={`entry-status ${status === 'ready' ? 'entry-status-saved' : 'entry-status-draft'}`}>{status === 'loading' ? <span className="spinner" /> : status === 'ready' ? <BadgeCheck size={15} /> : <LockKeyhole size={15} />}{status === 'loading' ? 'Carregando' : status === 'ready' ? 'Serviço conectado' : 'Serviço indisponível'}</span></div>
    <div className="admin-warning"><ShieldCheck size={19} /><div><strong>Senha inicial com troca obrigatória e MFA.</strong><span>Novas contas começam com 0000. No primeiro acesso, o usuário define uma senha pessoal e configura um aplicativo autenticador.</span></div></div>
    {status === 'unavailable' && <div className="form-message form-message-error" role="alert">Não foi possível carregar usuários. Confirme se as APIs e o banco estão ativos.</div>}
    {notice && <div className="form-message" role="status">{notice}</div>}
    <form className="account-create-panel" onSubmit={createAccount}><div className="users-heading"><div><p className="eyebrow">NOVA CONTA</p><h2>Cadastrar usuário</h2></div></div><div className="field-grid field-grid-two"><label className="field"><span className="field-label">Nome completo</span><input required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label><label className="field"><span className="field-label">Usuário de acesso</span><input required minLength={3} maxLength={80} pattern="[A-Za-z0-9._@-]+" value={username} onChange={(event) => setUsername(event.target.value)} /></label></div><fieldset className="module-permission-fieldset"><legend>Módulos permitidos</legend><div className="module-permission-grid">{accessModules.map(([module, label]) => <label className="checkbox-label" key={module}><input type="checkbox" checked={selectedModules.includes(module)} onChange={() => toggleModule(module)} /><span>{label}</span></label>)}</div></fieldset><div className="form-actions"><span className="draft-hint">Selecione um ou mais módulos. Permissões serão registradas na auditoria.</span><button className="button button-primary" type="submit" disabled={saving || selectedModules.length === 0}>{saving ? 'Criando…' : 'Criar usuário'}</button></div></form>
    <section className="users-panel"><div className="users-heading"><div><p className="eyebrow">CONTAS LOCAIS</p><h2>Usuários cadastrados</h2></div><span className="module-total">{users.length} contas</span></div><div className="account-list">{users.map((user) => <AccountRow key={user.id} user={user} onUpdate={updateAccount} onReset={resetCredentials} />)}{status === 'ready' && users.length === 0 && <p className="account-empty">Nenhuma conta cadastrada.</p>}</div></section>
    <section className="permission-map"><div className="panel-heading"><div><p className="eyebrow">CONTROLE DE ACESSO</p><h2>Acesso individual por módulo</h2></div><LockKeyhole size={18} /></div><div className="permission-legend"><span><strong>Consultar</strong> abrir registros autorizados</span><span><strong>Criar</strong> adicionar registros no módulo</span><span><strong>Alterar</strong> modificar registros autorizados</span><span><strong>Administrar</strong> usuários e permissões</span></div></section>
  </section>
}

function AccountRow({ user, onUpdate, onReset }: { user: Account; onUpdate: (user: Account, body: Record<string, unknown>, success: string) => Promise<void>; onReset: (user: Account) => Promise<void> }) {
  const [editModules, setEditModules] = useState(user.modules.filter((module) => module !== 'admin'))
  const [expanded, setExpanded] = useState(false)
  return <article className="account-row"><div className="account-row-main"><div className="user-name"><span className="avatar avatar-small">{user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span><strong>{user.name}<small>{user.username}{user.must_change_password ? ' · troca de senha pendente' : ''}{!user.mfa_enabled ? ' · MFA pendente' : ''}</small></strong></div><div className="user-modules">{user.modules.map((module) => <span key={module}>{moduleLabels[module] ?? module}</span>)}</div><span className={`account-state ${user.active ? 'account-active' : 'account-disabled'}`}><span className="status-dot" />{user.active ? 'Ativa' : 'Inativa'}</span><button className="user-action" type="button" onClick={() => void onUpdate(user, { active: !user.active }, `Conta ${user.active ? 'desativada' : 'ativada'}.`)}>{user.active ? 'Desativar' : 'Ativar'}</button><button className="user-action" type="button" onClick={() => void onReset(user)}>Redefinir senha/MFA</button><button className="user-action" type="button" onClick={() => { setEditModules(user.modules.filter((module) => module !== 'admin')); setExpanded((value) => !value) }}>{expanded ? 'Fechar acessos' : 'Editar acessos'}</button></div>{expanded && <div className="account-access-editor"><p className="field-label">Módulos permitidos</p><div className="module-permission-grid">{accessModules.map(([module, label]) => <label className="checkbox-label" key={module}><input type="checkbox" checked={editModules.includes(module)} onChange={() => setEditModules((current) => current.includes(module) ? current.filter((item) => item !== module) : [...current, module])} /><span>{label}</span></label>)}</div><button className="button button-secondary" type="button" disabled={!editModules.length} onClick={() => void onUpdate(user, { modules: editModules }, 'Acessos atualizados e registrados na auditoria.')}>Salvar acessos</button></div>}</article>
}

function NutritionPage() {
  const [patients, setPatients] = useState<Patient[]>([])
  const [records, setRecords] = useState<NutritionRecordData[]>([])
  const [selectedPatient, setSelectedPatient] = useState('')
  const [patientQuery, setPatientQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [form, setForm] = useState({ assessment_date: new Date().toLocaleDateString('en-CA'), weight_kg: '', height_cm: '', diet_type: '', allergies: '', restrictions: '', appetite: '', hydration: '', notes: '' })
  async function loadRecords() {
    try {
      const response = await fetch('/api/v1/nursing/nutrition')
      const data = await response.json() as { records?: NutritionRecordData[]; detail?: string }
      if (!response.ok) throw new Error(data.detail ?? 'Não foi possível carregar os registros nutricionais.')
      setRecords(data.records ?? [])
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar os registros.') }
  }
  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/v1/nursing/patients')
        const data = await response.json() as { patients?: Patient[]; detail?: string }
        if (!response.ok) throw new Error(data.detail ?? 'Não foi possível carregar os pacientes.')
        setPatients(data.patients ?? [])
      } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar pacientes.') }
      await loadRecords()
    })()
  }, [])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedPatient) { setError('Selecione um paciente.'); return }
    setBusy(true); setError(''); setMessage('')
    try {
      const response = await fetch('/api/v1/nursing/nutrition', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, patient_reference: selectedPatient }) })
      const data = await response.json() as NutritionRecordData & { detail?: string }
      if (!response.ok) throw new Error(data.detail ?? 'Não foi possível salvar a avaliação.')
      setForm({ ...form, weight_kg: '', height_cm: '', diet_type: '', allergies: '', restrictions: '', appetite: '', hydration: '', notes: '' })
      setMessage('Avaliação nutricional registrada.')
      await loadRecords()
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Falha ao salvar a avaliação.') }
    finally { setBusy(false) }
  }
  const filtered = patients.filter((patient) => `${patient.name} ${patient.room} ${patient.bed}`.toLocaleLowerCase('pt-BR').includes(patientQuery.trim().toLocaleLowerCase('pt-BR')))
  const patientName = (reference: string) => { const patient = patients.find((item) => item.reference === reference); return patient ? `${patient.name} · Quarto ${patient.room}, leito ${patient.bed}` : 'Paciente' }
  return <section className="nutrition-page page-enter">
    <div className="page-title-row"><div><p className="eyebrow">MÓDULO · NUTRIÇÃO</p><h1>Acompanhamento nutricional</h1><p className="welcome-copy">Registre avaliação, dieta prescrita, alergias, restrições e aceitação alimentar.</p></div><span className="module-icon module-icon-nutrition"><HeartPulse size={24} /></span></div>
    {message && <div className="form-message form-message-success" role="status">{message}</div>}{error && <div className="form-message form-message-error" role="alert">{error}</div>}
    <form className="nutrition-form" onSubmit={(event) => void submit(event)}>
      <div className="section-heading"><div><p className="eyebrow">NOVA AVALIAÇÃO</p><h2>Dados nutricionais</h2></div></div>
      <label className="field"><span className="field-label">Localizar paciente por nome, quarto ou leito</span><span className="search-input-wrap"><Search size={17} /><input value={patientQuery} onChange={(event) => setPatientQuery(event.target.value)} placeholder="Digite para pesquisar" /></span></label>
      <label className="field nutrition-patient-select"><span className="field-label">Paciente</span><select required value={selectedPatient} onChange={(event) => setSelectedPatient(event.target.value)}><option value="">Selecione o paciente</option>{filtered.map((patient) => <option key={patient.reference} value={patient.reference}>{patient.name} · Quarto {patient.room}, leito {patient.bed}</option>)}</select></label>
      <div className="field-grid field-grid-three"><label className="field"><span className="field-label">Data da avaliação</span><input type="date" required value={form.assessment_date} onChange={(event) => setForm({ ...form, assessment_date: event.target.value })} /></label><label className="field"><span className="field-label">Peso</span><span className="input-with-unit"><input inputMode="decimal" value={form.weight_kg} onChange={(event) => setForm({ ...form, weight_kg: event.target.value })} placeholder="Ex.: 68,5" /><span className="unit-label">kg</span></span></label><label className="field"><span className="field-label">Altura</span><span className="input-with-unit"><input inputMode="decimal" value={form.height_cm} onChange={(event) => setForm({ ...form, height_cm: event.target.value })} placeholder="Ex.: 172" /><span className="unit-label">cm</span></span></label></div>
      <div className="field-grid field-grid-three"><label className="field"><span className="field-label">Tipo de dieta</span><select value={form.diet_type} onChange={(event) => setForm({ ...form, diet_type: event.target.value })}><option value="">Selecione</option><option>Geral</option><option>Branda</option><option>Pastosa</option><option>Líquida</option><option>Enteral</option><option>Jejum</option><option>Outra</option></select></label><label className="field"><span className="field-label">Aceitação alimentar</span><select value={form.appetite} onChange={(event) => setForm({ ...form, appetite: event.target.value })}><option value="">Selecione</option><option value="normal">Normal</option><option value="reduced">Reduzida</option><option value="poor">Baixa</option><option value="increased">Aumentada</option></select></label><label className="field"><span className="field-label">Hidratação</span><select value={form.hydration} onChange={(event) => setForm({ ...form, hydration: event.target.value })}><option value="">Selecione</option><option value="adequate">Adequada</option><option value="low">Baixa</option><option value="assisted">Necessita auxílio</option></select></label></div>
      <div className="field-grid field-grid-two"><label className="field"><span className="field-label">Alergias alimentares</span><textarea maxLength={500} value={form.allergies} onChange={(event) => setForm({ ...form, allergies: event.target.value })} placeholder="Descreva ou informe que não há alergias conhecidas" /></label><label className="field"><span className="field-label">Restrições alimentares</span><textarea maxLength={500} value={form.restrictions} onChange={(event) => setForm({ ...form, restrictions: event.target.value })} placeholder="Restrições e orientações dietéticas" /></label></div>
      <label className="field"><span className="field-label">Evolução e observações</span><textarea maxLength={3000} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Registro da avaliação e conduta nutricional" /></label>
      <div className="patient-form-actions"><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Registrar avaliação'} <ArrowRight size={16} /></button></div>
    </form>
    <section className="patient-list-panel"><div className="section-heading"><div><p className="eyebrow">HISTÓRICO RECENTE</p><h2>Avaliações nutricionais</h2></div><span className="module-total">{records.length}</span></div>{records.length ? <div className="nutrition-record-list">{records.map((record) => <article className="nutrition-record-card" key={record.id}><div><h3>{patientName(record.patient_reference)}</h3><p>{new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${record.assessment_date}T00:00:00Z`))} · {record.diet_type || 'Dieta não informada'}</p>{record.weight_kg && <small>Peso: {record.weight_kg} kg</small>}{record.allergies && <small>Alergias: {record.allergies}</small>}{record.restrictions && <small>Restrições: {record.restrictions}</small>}{record.notes && <small>{record.notes}</small>}</div><span className="nutrition-author">{record.actor_name}</span></article>)}</div> : <div className="history-empty">Nenhuma avaliação nutricional registrada.</div>}</section>
  </section>
}

function ModulePlaceholder({ moduleId, onNavigate }: { moduleId: ModuleId; onNavigate: (id: ModuleId) => void }) {
  const module = modules.find((item) => item.id === moduleId)!
  const Icon = module.icon
  const moduleCards: Record<string, string[]> = {
    pharmacy: ['Itens e estoque', 'Lotes e validade', 'Movimentações'],
    xray: ['Solicitações', 'Fila de atendimento', 'Exames concluídos'],
    social: ['Acompanhamentos', 'Encaminhamentos', 'Atendimentos'],
    nutrition: ['Avaliações nutricionais', 'Dietas e restrições', 'Acompanhamentos'],
    hygiene: ['Rotinas por ambiente', 'Solicitações de limpeza', 'Liberação de leitos'],
    reception: ['Admissões', 'Localização de pacientes', 'Movimentações'],
    therapy: ['Agenda de atividades', 'Participantes', 'Evoluções'],
    psychology: ['Atendimentos', 'Acompanhamentos', 'Encaminhamentos'],
    management: ['Equipe e acessos', 'Indicadores institucionais', 'Configurações'],
    admin: ['Usuários', 'Permissões', 'Auditoria'],
  }
  const cards = moduleCards[moduleId] ?? ['Registros', 'Atendimentos', 'Acompanhamentos']
  return <section className="placeholder-page page-enter"><div className="page-title-row"><div><p className="eyebrow">MÓDULO · {module.label.toUpperCase()}</p><h1>{module.label}</h1><p className="welcome-copy">{module.description}</p></div><span className={`module-icon module-icon-${moduleId}`}><Icon size={23} /></span></div><div className="module-overview-grid">{cards.map((label) => <article className="overview-stat" key={label}><span>{label}</span><strong>—</strong><small>Visão do módulo</small></article>)}</div><section className="placeholder-state"><span className="placeholder-state-icon"><Icon size={20} /></span><div><strong>Espaço de trabalho · {module.label}</strong><p>Consulte os indicadores e registros disponíveis para este módulo. O acesso e as ações seguem as permissões atribuídas ao seu usuário.</p></div></section><button className="button button-secondary" type="button" onClick={() => onNavigate('home')}><ArrowLeft size={16} /> Voltar à visão geral</button></section>
}

export default App
