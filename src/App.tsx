import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Brain,
  Building2,
  CheckCircle2,
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
  Stethoscope,
  UsersRound,
  UserRound,
  X,
  Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

type ModuleId = 'home' | 'work-orders' | 'patients' | 'nursing' | 'pharmacy' | 'xray' | 'social' | 'nutrition' | 'hygiene' | 'reception' | 'therapy' | 'psychology' | 'maintenance' | 'management' | 'admin' | 'about'
type ProfileId = 'patients' | 'nursing' | 'pharmacy' | 'xray' | 'social' | 'nutrition' | 'hygiene' | 'reception' | 'therapy' | 'psychology' | 'maintenance' | 'management'
type EntryState = 'draft' | 'review' | 'saving' | 'saved' | 'error'
type Patient = { reference: string; name: string; room: string; bed: string }
type VitalRecordData = { id: number; patient_reference: string; actor_name: string; values: Record<string, string>; glucose_unit: string; recorded_at: string }
type WorkOrderStatus = 'open' | 'in_progress' | 'completed' | 'cancelled'
type WorkOrderPriority = 'normal' | 'high' | 'urgent'
type WorkOrder = { id: string; title: string; description: string; department: string; location: string; priority: WorkOrderPriority; status: WorkOrderStatus; requester_id: string; requester_name: string; updated_by: string; created_at: string; updated_at: string }

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
  const visibleNavigation = navigation.filter((item) => item.id === 'about' || item.id === 'work-orders' || profile.modules.includes(item.id))

  function navigate(id: ModuleId) {
    if (id !== 'about' && id !== 'work-orders' && !profile.modules.includes(id)) return
    setActiveModule(id)
    setMenuOpen(false)
  }

  const activeLabel = activeModule === 'home'
    ? 'Visão geral'
    : navigation.find((item) => item.id === activeModule)?.label ?? 'SCPO Connect'

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`} aria-label="Navegação principal">
        <div className="brand-lockup">
          <img className="brand-image" src="/scpo-connect-icon.png" alt="" />
          <div className="brand-name">SCPO <strong>Connect</strong><small>Santa Casa de Pedro Osório</small></div>
          <button className="icon-button sidebar-close" type="button" aria-label="Fechar menu" onClick={() => setMenuOpen(false)}><X size={19} /></button>
        </div>


        <p className="nav-caption">ESPAÇO DE TRABALHO</p>
        <nav className="primary-nav">
          {visibleNavigation.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className={`nav-link ${activeModule === id ? 'nav-link-active' : ''}`} onClick={() => navigate(id)} aria-current={activeModule === id ? 'page' : undefined}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
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
            <span className="session-role">{profile.role}</span>
            <InstallAppButton />
            <button className="button button-secondary logout-button" type="button" onClick={async () => { await fetch('/api/v1/auth/logout', { method: 'POST' }); onLogout() }}><LogOut size={15} /> Sair</button>
          </div>
        </header>

        <div className="page-content">
          {activeModule === 'home' && <Dashboard profile={profile} onNavigate={navigate} />}
          {activeModule === 'nursing' && <NursingPage profile={profile} />}
          {activeModule === 'work-orders' && <WorkOrdersPage user={user} />}
          {activeModule === 'maintenance' && <MaintenanceQueuePage />}
          {activeModule === 'patients' && <PatientRegistryPage />}
          {activeModule === 'admin' && <AdminPage />}
          {activeModule === 'management' && <ModulePlaceholder moduleId="management" onNavigate={navigate} />}
          {activeModule === 'about' && <AboutPage />}
          {(['pharmacy', 'xray', 'social', 'nutrition', 'hygiene', 'reception', 'therapy', 'psychology'] as ModuleId[]).includes(activeModule) && <ModulePlaceholder moduleId={activeModule} onNavigate={navigate} />}
        </div>
        <footer className="app-footer"><span>SCPO Connect <span className="footer-version">· {user.username}</span></span><span>Acesso seguro por perfil</span></footer>
      </main>
    </div>
  )
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

function PatientRegistryPage() {
  return <section className="placeholder-page page-enter"><div className="page-title-row"><div><p className="eyebrow">CADASTRO COMPARTILHADO</p><h1>Pacientes</h1><p className="welcome-copy">Consulte identificação e localização do paciente conforme as permissões do seu perfil.</p></div><span className="module-icon module-icon-nursing"><UserRound size={23} /></span></div><section className="notice-band"><div className="notice-icon"><LockKeyhole size={20} /></div><div><strong>Acesso conforme função e necessidade</strong><p>As informações do paciente são disponibilizadas de acordo com o módulo autorizado e o perfil de acesso.</p></div></section><section className="placeholder-state"><span className="placeholder-state-icon"><UsersRound size={20} /></span><div><strong>Cadastro de pacientes</strong><p>Para cadastrar ou localizar pacientes por quarto e leito e consultar as coletas, acesse Enfermagem. Os registros ficam vinculados ao paciente selecionado.</p></div></section></section>
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

function WorkOrdersPage({ user }: { user: AuthUser }) {
  const [orders, setOrders] = useState<WorkOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [form, setForm] = useState({ title: '', description: '', department: '', location: '', priority: 'normal' as WorkOrderPriority })

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
    setSaving(true)
    setNotice('')
    setError('')
    try {
      const response = await fetch('/api/v1/maintenance/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, title: form.title.trim(), description: form.description.trim(), department: form.department.trim(), location: form.location.trim() }),
      })
      const data = await response.json() as WorkOrder & { detail?: string }
      if (!response.ok) throw new Error(data.detail ?? 'Não foi possível abrir a ordem de serviço.')
      setOrders((current) => [data, ...current])
      setForm({ title: '', description: '', department: '', location: '', priority: 'normal' })
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
      <div className="section-heading"><div><p className="eyebrow">NOVA SOLICITAÇÃO</p><h2>Descreva o que precisa</h2></div></div>
      <div className="field-grid field-grid-two">
        <label className="field"><span className="field-label">Assunto</span><input required minLength={5} maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Ex.: torneira com vazamento" /></label>
        <label className="field"><span className="field-label">Setor solicitante</span><input required minLength={2} maxLength={100} value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} placeholder="Ex.: Enfermagem" /></label>
        <label className="field"><span className="field-label">Local / patrimônio</span><input maxLength={120} value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Ex.: quarto 3, leito B" /></label>
        <label className="field"><span className="field-label">Prioridade</span><select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as WorkOrderPriority })}><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option></select></label>
      </div>
      <label className="field"><span className="field-label">Descrição do serviço</span><textarea required minLength={5} maxLength={1500} rows={4} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Informe o problema observado e o serviço solicitado." /></label>
      <p className="work-order-privacy">Não inclua nome, diagnóstico ou outros dados de pacientes na descrição da ordem.</p>
      {notice && <div className="form-message form-message-success" role="status">{notice}</div>}
      {error && <div className="form-message form-message-error" role="alert">{error}</div>}
      <button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Enviando…' : 'Abrir ordem de serviço'} <ArrowRight size={16} /></button>
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
        <div><p className="eyebrow">{new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()).toUpperCase()}</p><h1>Bom dia, {firstName}.</h1><p className="welcome-copy">Acesse os espaços de trabalho disponíveis para o seu perfil.</p></div>
        <div className="date-chip"><Clock3 size={16} /><span>{allowedModules.length} módulos disponíveis</span></div>
      </div>

      <div className="section-heading"><div><p className="eyebrow">ACESSO POR PERFIL</p><h2>Seus espaços de trabalho</h2></div><span className="module-total">{allowedModules.length} disponível{allowedModules.length === 1 ? '' : 'is'}</span></div>
      <div className="module-grid">
        {modules.map(({ id, label, icon: Icon, description }) => {
          const available = profile.modules.includes(id)
          return (
            <button key={id} type="button" className={`module-card ${available ? 'module-card-available' : 'module-card-locked'}`} onClick={() => available && onNavigate(id)} disabled={!available}>
              <span className={`module-icon module-icon-${id}`}><Icon size={21} strokeWidth={1.8} /></span>
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

function NursingPage({ profile }: { profile: Profile }) {
  const [record, setRecord] = useState<RecordFields>({ ...emptyRecord })
  const [notApplicable, setNotApplicable] = useState<string[]>([])
  const [entryState, setEntryState] = useState<EntryState>('draft')
  const [message, setMessage] = useState('')
  const [savedAt, setSavedAt] = useState('')
  const [patients, setPatients] = useState<Patient[]>([])
  const [patientRef, setPatientRef] = useState('')
  const [records, setRecords] = useState<VitalRecordData[]>([])
  const [historyError, setHistoryError] = useState('')
  const [showPatientForm, setShowPatientForm] = useState(false)
  const [newPatient, setNewPatient] = useState({ name: '', room: '', bed: '' })
  const [historyMetric, setHistoryMetric] = useState('saturation')

  useEffect(() => {
    let current = true
    Promise.all([
      fetch('/api/v1/nursing/patients'),
      fetch(`/api/v1/nursing/vitals?limit=100&patient_reference=${encodeURIComponent(patientRef)}`),
    ]).then(async ([patientResponse, recordResponse]) => {
      if (!patientResponse.ok || !recordResponse.ok) throw new Error('load-failed')
      return Promise.all([patientResponse.json(), recordResponse.json()]) as Promise<[{ patients: Patient[] }, { records: VitalRecordData[] }]>
    }).then(([patientData, recordData]) => {
      if (!current) return
      setPatients(patientData.patients)
      setRecords(recordData.records)
      setHistoryError('')
      if (!patientData.patients.some((item) => item.reference === patientRef) && patientData.patients[0]) setPatientRef(patientData.patients[0].reference)
    }).catch(() => { if (current) setHistoryError('Não foi possível carregar os dados. Reinicie os serviços e confirme que as migrações foram aplicadas.') })
    return () => { current = false }
  }, [profile.id, patientRef])

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
      const saved = await response.json() as VitalRecordData
      setRecords((items) => [saved, ...items])
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
      <div className="page-title-row"><div><p className="eyebrow">MÓDULO · ENFERMAGEM</p><h1>Sinais vitais</h1><p className="welcome-copy">Registre sinais vitais e consulte as coletas anteriores por paciente.</p></div><span className={`entry-status entry-status-${entryState}`}>{statusIcon}{stateLabels[entryState]}</span></div>
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

      <VitalHistory records={records.filter((item) => item.patient_reference === patientRef)} patients={patients} metric={historyMetric} onMetric={setHistoryMetric} />
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
