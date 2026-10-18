import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { readApiResponse, readableApiError } from './api'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Building2,
  CalendarDays,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  ClipboardPlus,
  Clock3,
  Eye,
  EyeOff,
  HeartPulse,
  Home,
  Info,
  LockKeyhole,
  LogOut,
  Menu,
  Moon,
  Package,
  Pencil,
  Printer,
  ShieldCheck,
  Sun,
  Search,
  Stethoscope,
  UsersRound,
  UserRound,
  X,
  Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import PrintSelectionPanel, { type PrintRow } from './components/PrintSelectionPanel'

type ModuleId = 'home' | 'work-orders' | 'patients' | 'patient-history' | 'nursing' | 'nursing-history' | 'pharmacy' | 'xray' | 'social' | 'nutrition' | 'hygiene' | 'reception' | 'therapy' | 'psychology' | 'maintenance' | 'management' | 'admin' | 'about'
type ProfileId = 'patients' | 'nursing' | 'pharmacy' | 'xray' | 'social' | 'nutrition' | 'hygiene' | 'reception' | 'therapy' | 'psychology' | 'maintenance' | 'management'
type EntryState = 'draft' | 'review' | 'saving' | 'saved' | 'error'
type Patient = {
  reference: string; name: string; room: string; bed: string; cpf?: string; sus_card?: string; allergies?: string; allergies_status?: 'unknown' | 'none_known' | 'known'; birth_date?: string | null; sex?: string; phone?: string; email?: string
  address?: string; address_number?: string; address_complement?: string; neighborhood?: string; city?: string; state?: string; postal_code?: string
  responsible_name?: string; responsible_status?: 'unknown' | 'not_applicable' | 'provided'; responsible_relationship?: string; responsible_phone?: string; responsible_address?: string
  responsible_address_number?: string; responsible_address_complement?: string; responsible_neighborhood?: string
  responsible_city?: string; responsible_state?: string; responsible_postal_code?: string; photo_data?: string
  created_at?: string | null; updated_at?: string | null; updated_by?: string; active?: boolean
}
function PatientAllergyAlert({ patient }: { patient?: Pick<Patient, 'allergies' | 'allergies_status'> }) {
  if (!patient) return null
  if (patient.allergies_status === 'known' && patient.allergies) {
    return <div className="clinical-alert" role="alert"><AlertTriangle size={19} /><div><strong>Alerta cadastral · alergia conhecida</strong><span>{patient.allergies}</span></div></div>
  }
  if (patient.allergies_status === 'none_known') {
    return <div className="clinical-alert clinical-alert-clear" role="status"><BadgeCheck size={19} /><div><strong>Sem alergias conhecidas</strong><span>Informação confirmada no cadastro.</span></div></div>
  }
  return <div className="clinical-alert clinical-alert-unknown" role="status"><Info size={19} /><div><strong>Alergias não verificadas</strong><span>Confirme antes de iniciar condutas ou administrar substâncias.</span></div></div>
}
function ReceptionAllergyAlert({ status }: { status?: Patient['allergies_status'] }) {
  if (status === 'known') {
    return <div className="clinical-alert" role="alert"><AlertTriangle size={19} /><div><strong>Alerta de alergia</strong><span>Confirme os detalhes com a equipe clínica antes do atendimento.</span></div></div>
  }
  if (status === 'none_known') {
    return <div className="clinical-alert clinical-alert-clear" role="status"><BadgeCheck size={19} /><div><strong>Sem alergias conhecidas</strong><span>Status confirmado no cadastro.</span></div></div>
  }
  return <div className="clinical-alert clinical-alert-unknown" role="status"><Info size={19} /><div><strong>Alergias não verificadas</strong><span>Encaminhe para confirmação pela equipe clínica.</span></div></div>
}
function patientLocationLabel(patient: Pick<Patient, 'room' | 'bed'>) {
  return patient.room.trim() && patient.bed.trim()
    ? `Quarto ${patient.room} · leito ${patient.bed}`
    : 'Sem quarto/leito atribuído'
}
type VitalRecordData = { id: number; patient_reference: string; actor_name: string; values: Record<string, string>; glucose_unit: string; recorded_at: string }
type PatientObservation = { id: number; attention_level: 'green' | 'yellow' | 'red'; observation: string; treatment_status: 'in_progress' | 'completed' | 'discharged'; actor_name: string; created_at: string }
type WorkOrderStatus = 'open' | 'in_progress' | 'completed' | 'cancelled'
type WorkOrderPriority = 'normal' | 'high' | 'urgent'
type WorkOrder = { id: string; title: string; description: string; service_type: string; department: string; location: string; patient_reference?: string | null; priority: WorkOrderPriority; status: WorkOrderStatus; requester_id: string; requester_name: string; updated_by: string; created_at: string; updated_at: string }
type MedicationDispensation = { id: string; patient_reference: string; item_id: number; medication_name: string; quantity: string; unit: string; instructions: string; prescription_reference: string; prescriber_name: string; allergy_reviewed: boolean; status: 'dispensed' | 'cancelled'; actor_name: string; created_at: string }
type MedicationAdministration = { id: number; dispensation_id: string; patient_reference: string; medication_name: string; dose: string; unit: string; status: 'administered' | 'refused' | 'held'; reason: string; actor_name: string; administered_at: string }
type PatientFlowEvent = { id: number; patient_reference: string; event_type: 'transfer' | 'discharge'; previous_room: string; previous_bed: string; next_room: string; next_bed: string; reason: string; summary: string; actor_name: string; occurred_at: string }
type ClinicalRisk = { id: number | string; patient_reference: string; patient_name: string; room: string; bed: string; risk_type: 'allergy' | 'contraindication'; description: string; severity: 'unspecified' | 'low' | 'moderate' | 'high'; status: 'active' | 'resolved'; reason: string; actor_name: string; created_at: string; resolved_at?: string | null; resolved_by?: string; resolution_reason?: string }
type EmergencyArrivalStatus = 'waiting' | 'in_service' | 'completed' | 'cancelled' | 'admitted'
type EmergencyClinicalPriority = 'unassigned' | 'routine' | 'priority' | 'urgent'
type EmergencyArrival = { id: string; patient_reference: string | null; patient_name: string; allergies_status?: Patient['allergies_status']; arrival_mode: 'walk_in' | 'ambulance' | 'other'; reason: string; status: EmergencyArrivalStatus; clinical_priority: EmergencyClinicalPriority; clinical_priority_updated_by: string; clinical_priority_updated_at: string | null; clinical_priority_reason: string; created_by: string; updated_by: string; created_at: string; updated_at: string }
type TherapyActivityStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
type TherapyActivity = { id: string; title: string; activity_type: string; description: string; location: string; starts_at: string; ends_at: string | null; patient_reference: string | null; status: TherapyActivityStatus; activity_report: string; report_updated_by: string | null; report_updated_at: string | null; created_by: string; created_at: string }
type NutritionRecordData = { id: number; patient_reference: string; assessment_date: string; weight_kg: string; height_cm: string; diet_type: string; allergies: string; restrictions: string; appetite: string; hydration: string; notes: string; fasting_at?: string | null; fasting_reason?: string; actor_name: string; created_at: string }
type NutritionPlan = { allergies: string; assessment_date: string | null; diet_type: string; restrictions: string; fasting_at: string | null; fasting_reason: string }

const ReceptionPage = lazy(() => import('./pages/ReceptionPage'))
const PharmacyPage = lazy(() => import('./pages/PharmacyPage'))
const OperationalTaskCenter = lazy(() => import('./components/OperationalTaskCenter'))

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
  { id: 'reception', label: 'Recepção', short: 'Recepção', icon: UsersRound, description: 'Identificação, chegada e direcionamento de pacientes.' },
  { id: 'therapy', label: 'Oficina Terapêutica', short: 'Oficina terapêutica', icon: Activity, description: 'Agenda, participação e acompanhamento das atividades.' },
  { id: 'psychology', label: 'Psicologia / Psiquiatria', short: 'Psicologia', icon: HeartPulse, description: 'Encaminhamentos e acompanhamento da fila de atendimento.' },
  { id: 'hygiene', label: 'Higienização', short: 'Higienização', icon: ShieldCheck, description: 'Pedidos de limpeza por área e acompanhamento da equipe.' },
  { id: 'maintenance', label: 'Manutenção', short: 'Manutenção', icon: Wrench, description: 'Ordens de serviço, prioridades e acompanhamento da execução.' },
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
  bowelTube: '',
  pain: '',
  notes: '',
  oxygenStatus: '',
  oxygenStartedAt: '',
  oxygenEndedAt: '',
  wounds: '',
  dressingType: '',
  examName: '',
  examScheduledAt: '',
  examFollowUp: '',
  examResult: '',
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
  venousCondition: 'Tipo de acesso',
  venousNote: 'Observação do acesso',
  urine: 'Eliminação urinária',
  bowelTube: 'Eliminação intestinal',
  pain: 'Valor informado',
  notes: 'Observações',
  oxygenStatus: 'Uso de oxigênio',
  oxygenStartedAt: 'Oxigênio ligado em',
  oxygenEndedAt: 'Oxigênio desligado em',
  wounds: 'Curativos / lesões',
  dressingType: 'Tipo de cobertura',
  examName: 'Exame',
  examScheduledAt: 'Exame agendado para',
  examFollowUp: 'Acompanhamento do exame',
  examResult: 'Resultado / informação disponível',
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

function AuthenticatedApp({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const [activeModule, setActiveModule] = useState<ModuleId>('home')
  const [menuOpen, setMenuOpen] = useState(false)
  const [historyPatientReference, setHistoryPatientReference] = useState('')
  const [showBetaPopup, setShowBetaPopup] = useState(false)
  const [darkMode, setDarkMode] = useState(() => window.localStorage.getItem('scpo-theme') === 'dark')
  const [fontZoom, setFontZoom] = useState(() => Number(window.localStorage.getItem('scpo-font-zoom') || '1'))
  const logoClickCount = useRef(0)
  const logoClickTimer = useRef<number | undefined>(undefined)
  const closeBetaPopup = useCallback(() => setShowBetaPopup(false), [])

  useEffect(() => () => {
    if (logoClickTimer.current !== undefined) window.clearTimeout(logoClickTimer.current)
  }, [])
  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? 'dark' : 'light'
    window.localStorage.setItem('scpo-theme', darkMode ? 'dark' : 'light')
  }, [darkMode])
  useEffect(() => {
    document.documentElement.style.zoom = String(fontZoom)
    window.localStorage.setItem('scpo-font-zoom', String(fontZoom))
  }, [fontZoom])
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
            <div className="accessibility-controls" aria-label="Acessibilidade e aparência"><button className="icon-button appearance-button" type="button" aria-label={`Aumentar texto (${Math.round(fontZoom * 100)}%)`} title="Aumentar texto" onClick={() => setFontZoom((current) => current >= 1.2 ? 1 : Math.round((current + 0.1) * 10) / 10)}><span>A+</span></button><button className="icon-button appearance-button" type="button" aria-label={darkMode ? 'Ativar tema claro' : 'Ativar tema escuro'} title={darkMode ? 'Ativar tema claro' : 'Ativar tema escuro'} onClick={() => setDarkMode((current) => !current)}>{darkMode ? <Sun size={17} /> : <Moon size={17} />}</button></div>
            <InstallAppButton />
            <button className="button button-secondary logout-button" type="button" onClick={async () => { await fetch('/api/v1/auth/logout', { method: 'POST' }); onLogout() }}><LogOut size={15} /> Sair</button>
          </div>
        </header>

        <div className="page-content">
          {activeModule === 'home' && <Dashboard profile={profile} user={user} onNavigate={navigate} />}
          {activeModule === 'nursing' && <NursingPage profile={profile} user={user} onShowHistory={() => navigate('nursing-history')} />}
          {activeModule === 'nursing-history' && <NursingHistoryPage onBack={() => navigate('nursing')} />}
          {activeModule === 'pharmacy' && <Suspense fallback={<div className="history-empty" role="status">Carregando Farmácia…</div>}><PharmacyPage user={user} /></Suspense>}
          {activeModule === 'work-orders' && <WorkOrdersPage user={user} />}
          {activeModule === 'maintenance' && <MaintenanceQueuePage />}
          {activeModule === 'hygiene' && <HygienePage user={user} />}
          {activeModule === 'psychology' && <PsychologyPage />}
          {activeModule === 'patients' && <PatientRegistryPage onHistory={openPatientHistory} />}
          {activeModule === 'reception' && <Suspense fallback={<div className="history-empty" role="status">Carregando Recepção…</div>}><ReceptionPage user={user} PatientRegistryPage={PatientRegistryPage} /></Suspense>}
          {activeModule === 'patient-history' && <PatientHistoryPage patientReference={historyPatientReference} onBack={() => navigate('patients')} />}
          {activeModule === 'therapy' && <TherapyPage profile={profile} />}
          {activeModule === 'admin' && <AdminPage />}
          {activeModule === 'management' && <ManagementPage onNavigate={navigate} />}
          {activeModule === 'about' && <AboutPage />}
          {activeModule === 'nutrition' && <NutritionPage />}
          {activeModule === 'xray' && <XrayPage user={user} />}
          {activeModule === 'social' && <PatientOperationsPage moduleId="social" user={user} />}
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
  const [passwordVisible, setPasswordVisible] = useState(false)
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
        setPasswordVisible(false)
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
      {stage === 'login' && <><label className="field"><span className="field-label">Usuário</span><input required autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label><label className="field"><span className="field-label">Senha</span><span className="auth-password-control"><input required type={passwordVisible ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /><button className="auth-password-toggle" type="button" aria-label={passwordVisible ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={passwordVisible} onClick={() => setPasswordVisible((visible) => !visible)}>{passwordVisible ? <EyeOff size={19} /> : <Eye size={19} />}</button></span></label><label className="field"><span className="field-label">Código MFA (6 dígitos)</span><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={totpCode} onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, ''))} /></label></>}
      {stage === 'password' && <><p className="auth-help">A senha inicial é temporária. Escolha uma nova senha com pelo menos 12 caracteres.</p><label className="field"><span className="field-label">Nova senha</span><input required minLength={12} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label></>}
      {stage === 'mfa' && <label className="field"><span className="field-label">Código do aplicativo</span><input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={totpCode} onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, ''))} /></label>}
      {message && <div className="form-message form-message-error" role="alert">{message}</div>}
      <button className="button button-primary auth-submit" type="submit" disabled={busy || (stage === 'mfa' && !mfaSecret)}>{busy ? 'Aguarde…' : stage === 'login' ? 'Entrar' : stage === 'bootstrap' ? 'Criar administrador' : stage === 'password' ? 'Salvar nova senha' : 'Ativar MFA'}</button>
    </form>
    <div className="auth-install"><span>Use o SCPO como aplicativo no seu dispositivo.</span><InstallAppButton /></div>
  </section></main>
}

const emptyPatientForm = {
  name: '', room: '', bed: '', cpf: '', sus_card: '', allergies: '', allergies_status: 'unknown', birth_date: '', sex: '', phone: '', email: '', address: '', address_number: '', address_complement: '', neighborhood: '', city: '', state: '', postal_code: '',
  responsible_name: '', responsible_status: 'unknown', responsible_relationship: '', responsible_phone: '', responsible_address: '', responsible_address_number: '', responsible_address_complement: '', responsible_neighborhood: '', responsible_city: '', responsible_state: '', responsible_postal_code: '', photo_data: '',
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
  const [viewingPatient, setViewingPatient] = useState<Patient | null>(null)
  const [archivingPatient, setArchivingPatient] = useState<Patient | null>(null)
  const [archiveReason, setArchiveReason] = useState('')
  const [showPatientFollowUp, setShowPatientFollowUp] = useState(false)
  const [patientObservations, setPatientObservations] = useState<PatientObservation[]>([])
  const [attentionLevel, setAttentionLevel] = useState<PatientObservation['attention_level']>('green')
  const [treatmentStatus, setTreatmentStatus] = useState<PatientObservation['treatment_status']>('in_progress')
  const [observationDraft, setObservationDraft] = useState('')
  const [savingObservation, setSavingObservation] = useState(false)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [duplicateCandidates, setDuplicateCandidates] = useState<{ reference: string; name: string; room: string; bed: string; reasons: string }[]>([])
  const [duplicateOverride, setDuplicateOverride] = useState(false)
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

  useEffect(() => {
    let active = true
    const loadPatients = async () => {
      try {
        const response = await fetch('/api/v1/nursing/patients?full_profile=true&include_inactive=true')
        const data = await response.json() as { patients?: Patient[]; detail?: string }
        if (!response.ok) throw new Error(data.detail ?? 'Não foi possível carregar os pacientes.')
        if (active) {
          setPatients(data.patients ?? [])
          setError('')
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar os pacientes.')
      } finally {
        if (active) setLoading(false)
      }
    }

    void loadPatients()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!viewingPatient) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setViewingPatient(null) }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [viewingPatient])

  useEffect(() => {
    if (!viewingPatient) return
    let current = true
    fetch(`/api/v1/nursing/patients/${encodeURIComponent(viewingPatient.reference)}/observations`).then(async (response) => {
      const data = await response.json() as { observations?: PatientObservation[] }
      if (!response.ok) throw new Error('Não foi possível carregar o histórico de acompanhamento.')
      if (current) setPatientObservations(data.observations ?? [])
    }).catch(() => { if (current) setPatientObservations([]) })
    return () => { current = false }
  }, [viewingPatient])

  async function savePatientObservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!viewingPatient) return
    setSavingObservation(true); setError('')
    try {
      const response = await fetch(`/api/v1/nursing/patients/${encodeURIComponent(viewingPatient.reference)}/observations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attention_level: attentionLevel, observation: observationDraft, treatment_status: treatmentStatus }) })
      const data = await response.json() as PatientObservation & { detail?: string }
      if (!response.ok) throw new Error(data.detail ?? 'Não foi possível salvar o acompanhamento.')
      setPatientObservations((current) => [data, ...current]); setObservationDraft('')
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Falha ao salvar acompanhamento.') }
    finally { setSavingObservation(false) }
  }

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
      if (!duplicateOverride) {
        const params = new URLSearchParams({ name: form.name, cpf: form.cpf, sus_card: form.sus_card, exclude_reference: editingReference })
        const checkResponse = await fetch(`/api/v1/nursing/patients/duplicates?${params}`)
        const checkData = await checkResponse.json() as { matches?: typeof duplicateCandidates; detail?: string }
        if (!checkResponse.ok) throw new Error(checkData.detail ?? 'Não foi possível verificar duplicidades.')
        if ((checkData.matches ?? []).length) {
          setDuplicateCandidates(checkData.matches ?? [])
          setError('Encontramos cadastros com dados semelhantes. Confira antes de prosseguir; nomes iguais podem pertencer a pessoas diferentes.')
          return
        }
      }
      const response = await fetch(editingReference ? `/api/v1/nursing/patients/${encodeURIComponent(editingReference)}` : '/api/v1/nursing/patients', {
        method: editingReference ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, birth_date: form.birth_date || null }),
      })
      const data = await response.json() as Patient & { detail?: string }
      if (!response.ok) throw new Error(data.detail ?? 'Não foi possível salvar o cadastro.')
      setPatients((current) => editingReference ? current.map((item) => item.reference === data.reference ? data : item) : [...current, data].sort((a, b) => a.room.localeCompare(b.room, 'pt-BR', { numeric: true }) || a.bed.localeCompare(b.bed, 'pt-BR', { numeric: true })))
      setForm({ ...emptyPatientForm }); setEditingReference(''); setShowForm(false); setCameraOpen(false)
      setDuplicateCandidates([]); setDuplicateOverride(false)
      setNotice(editingReference ? 'Cadastro do paciente atualizado.' : receptionMode ? 'Paciente admitido e cadastro compartilhado com os módulos autorizados.' : 'Paciente cadastrado e disponível nos módulos autorizados.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Falha ao salvar o cadastro.')
    } finally { setSaving(false) }
  }

  function archivePatient(patient: Patient) {
    setArchiveReason('')
    setArchivingPatient(patient)
  }

  async function confirmArchivePatient() {
    if (!archivingPatient || !archiveReason.trim()) return
    try {
      const response = await fetch(`/api/v1/nursing/patients/${encodeURIComponent(archivingPatient.reference)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: archiveReason.trim() }) })
      const data = await response.json() as { detail?: string }
      if (!response.ok) throw new Error(data.detail ?? 'Não foi possível arquivar o cadastro.')
      setPatients((current) => current.filter((item) => item.reference !== archivingPatient.reference))
      setNotice('Cadastro arquivado; os dados e o motivo permanecem registrados na auditoria.')
      setArchivingPatient(null); setArchiveReason('')
    } catch (archiveError) { setError(archiveError instanceof Error ? archiveError.message : 'Falha ao arquivar cadastro.') }
  }

  const queryDigits = query.replace(/\D/g, '')
  const filteredPatients = patients.filter((patient) => `${patient.name} ${patient.room} ${patient.bed} ${patient.responsible_name ?? ''} ${patient.cpf ?? ''} ${patient.sus_card ?? ''}`.toLocaleLowerCase('pt-BR').includes(query.trim().toLocaleLowerCase('pt-BR')) || (queryDigits.length > 0 && `${patient.cpf ?? ''}${patient.sus_card ?? ''}`.includes(queryDigits)))
  const patientPrintRows: PrintRow[] = filteredPatients.map((patient) => ({ id: patient.reference, date: patient.updated_at || patient.created_at || '', title: patient.name, fields: [['Quarto e leito', patient.room && patient.bed ? `${patient.room} · ${patient.bed}` : 'Sem acomodação atribuída'], ['Situação', patient.active === false ? 'Alta / inativo' : 'Ativo'], ['Alergias e alertas', patient.allergies_status === 'known' ? patient.allergies || 'Detalhes não informados' : patient.allergies_status === 'none_known' ? 'Sem alergias conhecidas' : 'Não verificadas'], ['Responsável', patient.responsible_status === 'not_applicable' ? 'Não se aplica' : patient.responsible_name || 'Não informado']] }))
  const patientAddress = (patient: Patient) => [patient.address, patient.address_number, patient.address_complement, patient.neighborhood, patient.city, patient.state, patient.postal_code].filter(Boolean).join(', ')
  const responsibleAddress = (patient: Patient) => [patient.responsible_address, patient.responsible_address_number, patient.responsible_address_complement, patient.responsible_neighborhood, patient.responsible_city, patient.responsible_state, patient.responsible_postal_code].filter(Boolean).join(', ')

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
        <label className="field"><span className="field-label">Cartão Nacional de Saúde (SUS)</span><input inputMode="numeric" autoComplete="off" maxLength={20} value={form.sus_card} onChange={(event) => setForm({ ...form, sus_card: event.target.value.replace(/\D/g, '').slice(0, 20) })} /></label>
        <label className="field"><span className="field-label">Data de nascimento</span><input type="date" value={form.birth_date} onChange={(event) => setForm({ ...form, birth_date: event.target.value })} /></label>
        <label className="field"><span className="field-label">Quarto</span><input required maxLength={20} value={form.room} onChange={(event) => setForm({ ...form, room: event.target.value })} /></label>
        <label className="field"><span className="field-label">Leito</span><input required maxLength={20} value={form.bed} onChange={(event) => setForm({ ...form, bed: event.target.value })} /></label>
        <label className="field"><span className="field-label">Sexo (opcional)</span><select value={form.sex} onChange={(event) => setForm({ ...form, sex: event.target.value })}><option value="">Não informado</option><option value="Feminino">Feminino</option><option value="Masculino">Masculino</option><option value="Outro">Outro</option><option value="Não informado">Prefere não informar</option></select></label>
        <label className="field"><span className="field-label">Telefone do paciente</span><input maxLength={40} autoComplete="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
        <label className="field"><span className="field-label">E-mail do paciente</span><input type="email" maxLength={160} autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
      </div>
      <div className="field-grid field-grid-two allergy-entry"><label className="field"><span className="field-label">Status das alergias</span><select value={form.allergies_status} onChange={(event) => setForm({ ...form, allergies_status: event.target.value as NonNullable<Patient['allergies_status']>, allergies: event.target.value === 'known' ? form.allergies : '' })}><option value="unknown">Não verificado / desconhecido</option><option value="none_known">Sem alergias conhecidas · confirmado</option><option value="known">Alergia conhecida</option></select></label>{form.allergies_status === 'known' && <label className="field"><span className="field-label">Descreva as alergias conhecidas</span><textarea required maxLength={1000} value={form.allergies} onChange={(event) => setForm({ ...form, allergies: event.target.value })} placeholder="Substância/alimento e observações relevantes" /></label>}</div>
      {duplicateCandidates.length > 0 && <div className="duplicate-warning" role="alert"><strong>Confira antes de salvar</strong>{duplicateCandidates.map((candidate) => <span key={candidate.reference}>{candidate.name} · Quarto {candidate.room}, leito {candidate.bed} · Coincidência: {candidate.reasons}</span>)}<button className="button button-secondary" type="button" onClick={() => { setDuplicateOverride(true); setError(''); setDuplicateCandidates([]) }}>Confirmo que é outra pessoa</button></div>}
      <fieldset className="patient-address-group"><legend>Endereço do paciente</legend><AddressFields form={form} patients={patients} prefix="" onChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))} /></fieldset>
      <fieldset className="patient-address-group"><legend>Responsável pela internação</legend><label className="field"><span className="field-label">Situação do responsável</span><select value={form.responsible_status} onChange={(event) => { const status = event.target.value as NonNullable<Patient['responsible_status']>; setForm((current) => status === 'not_applicable' ? { ...current, responsible_status: status, responsible_name: '', responsible_relationship: '', responsible_phone: '', responsible_address: '', responsible_address_number: '', responsible_address_complement: '', responsible_neighborhood: '', responsible_city: '', responsible_state: '', responsible_postal_code: '' } : { ...current, responsible_status: status }) }}><option value="unknown">Não informado</option><option value="not_applicable">Não se aplica</option><option value="provided">Responsável informado</option></select></label>{form.responsible_status !== 'not_applicable' && <><div className="patient-form-actions"><button className="button button-secondary" type="button" onClick={() => setForm((current) => ({ ...current, responsible_status: 'provided', responsible_name: current.name, responsible_relationship: 'Próprio paciente (autorreferência)', responsible_phone: current.phone, responsible_address: current.address, responsible_address_number: current.address_number, responsible_address_complement: current.address_complement, responsible_neighborhood: current.neighborhood, responsible_city: current.city, responsible_state: current.state, responsible_postal_code: current.postal_code }))}>Usar os dados do próprio paciente</button></div><div className="patient-form-grid"><label className="field"><span className="field-label">Nome completo</span><input maxLength={120} value={form.responsible_name} onChange={(event) => setForm({ ...form, responsible_status: 'provided', responsible_name: event.target.value })} /></label><label className="field"><span className="field-label">Vínculo com o paciente</span><input maxLength={60} value={form.responsible_relationship} onChange={(event) => setForm({ ...form, responsible_status: 'provided', responsible_relationship: event.target.value })} placeholder="Ex.: filha, cônjuge" /></label><label className="field"><span className="field-label">Telefone de contato</span><input maxLength={40} autoComplete="tel" value={form.responsible_phone} onChange={(event) => setForm({ ...form, responsible_status: 'provided', responsible_phone: event.target.value })} /></label></div><AddressFields form={form} patients={patients} prefix="responsible_" onChange={(key, value) => setForm((current) => ({ ...current, responsible_status: 'provided', [key]: value }))} /></>}</fieldset>
      <fieldset className="patient-address-group"><legend>Foto do paciente</legend><div className="patient-photo-editor">{form.photo_data ? <img src={form.photo_data} alt="Prévia da foto do paciente" /> : <span className="patient-photo-placeholder"><UserRound size={24} /></span>}<button className="button button-secondary" type="button" onClick={() => { setCameraError(''); setCameraOpen((open) => !open) }}><Camera size={16} /> {cameraOpen ? 'Fechar câmera' : 'Tirar foto'}</button><label className="button button-secondary" htmlFor="patient-photo">Escolher imagem</label><input id="patient-photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => { loadPhoto(event.target.files?.[0]); event.currentTarget.value = '' }} /><button className="button button-secondary" type="button" onClick={() => setForm({ ...form, photo_data: '' })} disabled={!form.photo_data}>Remover foto</button><small>JPEG, PNG ou WebP · até 1 MB. A câmera requer HTTPS e permissão.</small>{cameraOpen && <div className="patient-camera-panel"><video ref={videoRef} autoPlay muted playsInline aria-label="Visualização da câmera para foto do paciente" />{(cameraError || (!navigator.mediaDevices?.getUserMedia ? 'A câmera precisa de HTTPS e de permissão do navegador. Você ainda pode escolher uma imagem do dispositivo.' : '')) && <p className="form-message form-message-error" role="alert">{cameraError || 'A câmera precisa de HTTPS e de permissão do navegador. Você ainda pode escolher uma imagem do dispositivo.'}</p>}<div><button className="button button-primary" type="button" onClick={capturePhoto} disabled={!navigator.mediaDevices?.getUserMedia}><Camera size={16} /> Capturar foto</button><button className="button button-secondary" type="button" onClick={() => setCameraOpen(false)}>Cancelar câmera</button></div></div>}</div></fieldset>
      <div className="patient-form-actions"><button className="button button-secondary" type="button" onClick={() => { setShowForm(false); setEditingReference(''); setForm({ ...emptyPatientForm }); setCameraOpen(false) }} disabled={saving}>Cancelar</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Salvando…' : editingReference ? 'Salvar alterações' : 'Cadastrar paciente'} <ArrowRight size={16} /></button></div>
    </form>}
    <section className="patient-list-panel"><div className="section-heading"><div><p className="eyebrow">REGISTROS COMPARTILHADOS</p><h2>{receptionMode ? 'Pacientes e admissões' : 'Pacientes cadastrados'}</h2></div><span className="module-total">{patients.length}</span></div><label className="field patient-search"><span className="field-label">Buscar paciente, quarto, CPF, Cartão SUS ou responsável</span><span className="search-input-wrap"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome, documento, quarto ou leito" /></span></label>{loading ? <div className="history-empty">Carregando pacientes…</div> : filteredPatients.length ? <div className="patient-registry-list">{filteredPatients.map((patient) => <article className="patient-registry-card" key={patient.reference}><div className="patient-registry-identity">{patient.photo_data ? <img src={patient.photo_data} alt="" /> : <span className="patient-registry-avatar"><UserRound size={19} /></span>}<div><h3>{patient.name}</h3><p>{patient.room && patient.bed ? `Quarto ${patient.room} · Leito ${patient.bed}` : 'Sem acomodação atribuída'}{patient.birth_date ? ` · Nascimento ${new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${patient.birth_date}T00:00:00Z`))}` : ''}</p><small className="patient-card-identifiers">CPF: {patient.cpf || 'Não informado'} · Cartão SUS: {patient.sus_card || 'Não informado'}</small><PatientAllergyAlert patient={patient} />{patient.responsible_status === 'not_applicable' ? <small>Responsável: não se aplica</small> : patient.responsible_name && <small>{patient.responsible_relationship === 'Próprio paciente (autorreferência)' ? 'Autorreferência do paciente' : `Responsável: ${patient.responsible_name}`}{patient.responsible_phone ? ` · ${patient.responsible_phone}` : ''}</small>}{patientAddress(patient) && <small>{patientAddress(patient)}</small>}</div></div><div className="patient-registry-actions"><button className="button button-secondary" type="button" onClick={() => setViewingPatient(patient)}><Eye size={15} /> Ver ficha</button>{onHistory && <button className="button button-secondary" type="button" onClick={() => onHistory(patient.reference)}><ClipboardList size={15} /> Histórico</button>}<button className="button button-secondary" type="button" onClick={() => startEdit(patient)}><Pencil size={15} /> Editar</button><button className="button button-danger" type="button" onClick={() => void archivePatient(patient)}>Arquivar</button></div></article>)}</div> : <div className="history-empty"><UsersRound size={20} /><span>{query ? 'Nenhum cadastro corresponde à pesquisa.' : 'Nenhum paciente cadastrado.'}</span></div>}</section>
    {viewingPatient && <div className="patient-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setViewingPatient(null) }}><section className="patient-detail-modal" role="dialog" aria-modal="true" aria-labelledby="patient-detail-title"><div className="patient-detail-header"><div className="patient-detail-identity">{viewingPatient.photo_data ? <img src={viewingPatient.photo_data} alt={`Foto de ${viewingPatient.name}`} /> : <span className="patient-registry-avatar"><UserRound size={22} /></span>}<div><p className="eyebrow">FICHA DO PACIENTE</p><h2 id="patient-detail-title">{viewingPatient.name}</h2><p>Quarto {viewingPatient.room} · Leito {viewingPatient.bed} · {viewingPatient.active === false ? 'Cadastro inativo' : 'Internado'}</p></div></div><button className="button button-secondary" type="button" onClick={() => setViewingPatient(null)}>Fechar</button></div><div className="patient-detail-sections"><section><h3>Identificação e contato</h3><div className="patient-detail-grid"><span><small>CPF</small><strong>{viewingPatient.cpf || 'Não informado'}</strong></span><span><small>Cartão Nacional de Saúde (SUS)</small><strong>{viewingPatient.sus_card || 'Não informado'}</strong></span><span><small>Nascimento</small><strong>{viewingPatient.birth_date ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${viewingPatient.birth_date}T00:00:00Z`)) : 'Não informado'}</strong></span><span><small>Sexo</small><strong>{viewingPatient.sex || 'Não informado'}</strong></span><span><small>Telefone</small><strong>{viewingPatient.phone || 'Não informado'}</strong></span><span><small>E-mail</small><strong>{viewingPatient.email || 'Não informado'}</strong></span></div></section><section><h3>Endereço do paciente</h3><p>{patientAddress(viewingPatient) || 'Não informado'}</p></section><section><h3>Responsável pela internação</h3><div className="patient-detail-grid"><span><small>Nome</small><strong>{viewingPatient.responsible_name || 'Não informado'}</strong></span><span><small>Vínculo</small><strong>{viewingPatient.responsible_relationship || 'Não informado'}</strong></span><span><small>Telefone</small><strong>{viewingPatient.responsible_phone || 'Não informado'}</strong></span><span><small>Endereço</small><strong>{responsibleAddress(viewingPatient) || 'Não informado'}</strong></span></div></section><section className={viewingPatient.allergies ? 'patient-detail-alert' : ''}><h3>Alergias e alertas</h3><p>{viewingPatient.allergies || 'Nenhum alerta cadastrado'}</p></section><section><h3>Registro cadastral</h3><div className="patient-detail-grid"><span><small>Cadastrado em</small><strong>{viewingPatient.created_at ? dateTime(viewingPatient.created_at) : 'Não informado'}</strong></span><span><small>Última atualização</small><strong>{viewingPatient.updated_at ? dateTime(viewingPatient.updated_at) : 'Não informado'}</strong></span><span><small>Atualizado por</small><strong>{viewingPatient.updated_by || 'Não informado'}</strong></span></div></section></div><div className="patient-detail-actions"><button className="button button-secondary" type="button" onClick={() => { startEdit(viewingPatient); setViewingPatient(null) }}><Pencil size={15} /> Editar cadastro</button>{onHistory && <button className="button button-primary" type="button" onClick={() => { onHistory(viewingPatient.reference); setViewingPatient(null) }}><ClipboardList size={15} /> Histórico assistencial</button>}</div></section></div>}
    <PrintSelectionPanel title="Relação de pacientes" rows={patientPrintRows} />
    {viewingPatient && <div className="patient-detail-toolbar"><button className="button button-secondary" type="button" onClick={() => setShowPatientFollowUp(true)}><ClipboardList size={15} /> Histórico</button><button className="button button-primary" type="button" onClick={() => { document.body.classList.add('print-patient-detail'); window.addEventListener('afterprint', () => document.body.classList.remove('print-patient-detail'), { once: true }); window.print() }}><Printer size={16} /> Imprimir ficha</button></div>}
    {archivingPatient && <div className="patient-modal-backdrop" role="presentation"><section className="patient-archive-dialog" role="dialog" aria-modal="true" aria-labelledby="patient-archive-title"><h2 id="patient-archive-title">Arquivar cadastro de paciente</h2><p><strong>{archivingPatient.name}</strong> deixará de aparecer nos cadastros ativos. Os dados assistenciais serão preservados, e a exclusão lógica, o motivo e o responsável ficarão registrados na auditoria.</p><label className="field"><span className="field-label">Motivo do arquivamento</span><textarea required minLength={5} maxLength={500} value={archiveReason} onChange={(event) => setArchiveReason(event.target.value)} /></label><div className="patient-detail-actions"><button className="button button-secondary" type="button" onClick={() => setArchivingPatient(null)}>Cancelar</button><button className="button button-danger" type="button" onClick={() => void confirmArchivePatient()} disabled={archiveReason.trim().length < 5}>Arquivar paciente</button></div></section></div>}
    {viewingPatient && showPatientFollowUp && <div className="patient-modal-backdrop" role="presentation"><section className="patient-follow-up-dialog" role="dialog" aria-modal="true" aria-labelledby="patient-follow-up-title"><div className="patient-detail-header"><div><p className="eyebrow">HISTÓRICO DO PACIENTE</p><h2 id="patient-follow-up-title">{viewingPatient.name}</h2><p>Quarto {viewingPatient.room} · Leito {viewingPatient.bed} · {viewingPatient.active === false ? 'Alta registrada' : 'Internado'}</p></div><button className="button button-secondary" type="button" onClick={() => setShowPatientFollowUp(false)}>Fechar</button></div><form className="patient-observation-form" onSubmit={(event) => void savePatientObservation(event)}><div className="field-grid field-grid-two"><label className="field"><span className="field-label">Nível de acompanhamento</span><select value={attentionLevel} onChange={(event) => setAttentionLevel(event.target.value as PatientObservation['attention_level'])}><option value="green">Verde · rotina habitual</option><option value="yellow">Amarelo · atenção ampliada</option><option value="red">Vermelho · plano de abordagem prioritário</option></select></label><label className="field"><span className="field-label">Situação do tratamento</span><select value={treatmentStatus} onChange={(event) => setTreatmentStatus(event.target.value as PatientObservation['treatment_status'])}><option value="in_progress">Em andamento</option><option value="completed">Concluído</option><option value="discharged">Alta</option></select></label></div><label className="field"><span className="field-label">Observação objetiva</span><textarea required minLength={5} maxLength={2000} value={observationDraft} onChange={(event) => setObservationDraft(event.target.value)} placeholder="Registre fatos observáveis, cuidados realizados, resposta ao tratamento e orientações de continuidade." /></label><button className="button button-primary" type="submit" disabled={savingObservation || observationDraft.trim().length < 5}>{savingObservation ? 'Salvando…' : 'Registrar no histórico'}</button></form><div className="patient-observation-list">{patientObservations.map((item) => <article className={`patient-observation-card attention-${item.attention_level}`} key={item.id}><div><strong>{item.attention_level === 'green' ? 'Verde · rotina habitual' : item.attention_level === 'yellow' ? 'Amarelo · atenção ampliada' : 'Vermelho · plano prioritário'}</strong><span>{item.treatment_status === 'in_progress' ? 'Tratamento em andamento' : item.treatment_status === 'completed' ? 'Tratamento concluído' : 'Alta registrada'}</span></div><p>{item.observation}</p><small>{item.actor_name} · {dateTime(item.created_at)}</small></article>)}{!patientObservations.length && <div className="history-empty">Nenhuma anotação de acompanhamento registrada.</div>}</div></section></div>}
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
    Promise.all([fetch(`/api/v1/nursing/patients/${encodeURIComponent(patientReference)}`), fetch(`/api/v1/nursing/patients/${encodeURIComponent(patientReference)}/history?limit=${pageSize}&offset=${offset}`)]).then(async ([patientResponse, historyResponse]) => {
      const patientData = await patientResponse.json() as Patient & { detail?: string }
      const historyData = await historyResponse.json() as { records?: VitalRecordData[]; total?: number; detail?: string }
      if (!patientResponse.ok) throw new Error(patientData.detail ?? 'Não foi possível carregar o cadastro.')
      if (!historyResponse.ok) throw new Error(historyData.detail ?? 'Não foi possível carregar o histórico.')
      return { patientData, historyData }
    }).then(({ patientData, historyData }) => { if (current) { setPatients([patientData]); setRecords(historyData.records ?? []); setTotal(historyData.total ?? 0); setError('') } }).catch((loadError) => { if (current) setError(loadError instanceof Error ? loadError.message : 'Falha ao consultar o histórico.') }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [patientReference, offset])
  return <section className="patient-history-page page-enter"><div className="page-title-row"><div><p className="eyebrow">PRONTUÁRIO · ACESSO AUTORIZADO</p><h1>Histórico do paciente</h1><p className="welcome-copy">Registros de sinais vitais associados ao cadastro central.</p></div><button className="button button-secondary" type="button" onClick={onBack}><ArrowLeft size={16} /> Voltar aos pacientes</button></div>{patient && <section className="patient-history-summary">{patient.photo_data ? <img src={patient.photo_data} alt="" /> : <span className="patient-registry-avatar"><UserRound size={22} /></span>}<div><h2>{patient.name}</h2><p>{patientLocationLabel(patient)}{patient.birth_date ? ` · ${new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${patient.birth_date}T00:00:00Z`))}` : ''}{patient.active === false ? ' · Alta registrada' : ''}</p>{patient.responsible_status === 'not_applicable' ? <small>Responsável pela internação: não se aplica</small> : patient.responsible_name && <small>Responsável pela internação: {patient.responsible_name} · {patient.responsible_phone || 'Contato não informado'}</small>}</div><span className="module-total">{total} {total === 1 ? 'registro' : 'registros'}</span></section>}{error && <div className="form-message form-message-error" role="alert">{error}</div>}{loading ? <div className="history-empty">Carregando histórico…</div> : <><VitalHistory records={records} patients={patients} patientReference={patientReference} metric={metric} onMetric={setMetric} /><VitalExtraDetails records={records} patientReference={patientReference} /></>}{!loading && total > pageSize && <nav className="history-pagination" aria-label="Paginação do histórico do paciente"><span>Exibindo {offset + 1}–{Math.min(offset + records.length, total)} de {total}</span><div><button className="button button-secondary" type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}><ArrowLeft size={15} /> Anterior</button><button className="button button-secondary" type="button" disabled={offset + pageSize >= total} onClick={() => setOffset(offset + pageSize)}>Mais antigas <ArrowRight size={15} /></button></div></nav>}</section>
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
  const [activityFilter, setActivityFilter] = useState<'all' | TherapyActivityStatus>('all')
  const [activityQuery, setActivityQuery] = useState('')
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
  const visibleActivities = activities.filter((activity) => {
    const patient = patients.find((item) => item.reference === activity.patient_reference)
    const status = reportStatuses[activity.id] ?? activity.status
    return (activityFilter === 'all' || status === activityFilter)
      && `${activity.title} ${activity.location} ${activity.activity_type} ${patient?.name ?? ''}`.toLocaleLowerCase('pt-BR').includes(activityQuery.trim().toLocaleLowerCase('pt-BR'))
  })
  const therapyPrintRows: PrintRow[] = activities.map((activity) => {
    const patient = patients.find((item) => item.reference === activity.patient_reference)
    return { id: activity.id, date: activity.starts_at, title: activity.title, fields: [['Modalidade', activity.activity_type], ['Status', therapyActivityStatusLabels[reportStatuses[activity.id] ?? activity.status]], ['Horário', dateTime(activity.starts_at)], ['Local', activity.location], ['Paciente', patient ? `${patient.name} · ${patientLocationLabel(patient)}` : 'Grupo'], ['Objetivo', activity.description], ['Relatório', reportDrafts[activity.id] ?? activity.activity_report], ['Responsável pelo relatório', activity.report_updated_by || '']] }
  })

  return <section className="therapy-page page-enter"><PrintSelectionPanel title={`Relatório de atividades · ${monthLabel}`} rows={therapyPrintRows} />
    <div className="page-title-row"><div><p className="eyebrow">MÓDULO · OFICINA TERAPÊUTICA</p><h1>Atividades e calendário</h1><p className="welcome-copy">Organize oficinas, grupos e atendimentos com os pacientes autorizados.</p></div>{profile.modules.includes('therapy') && <button className="button button-primary" type="button" onClick={() => { setShowForm((value) => !value); setNotice(''); setError('') }}><CalendarDays size={16} /> {showForm ? 'Fechar agenda' : 'Agendar atividade'}</button>}</div>
    {notice && <div className="form-message form-message-success" role="status">{notice}</div>}{error && <div className="form-message form-message-error" role="alert">{error}</div>}
    {showForm && <form className="therapy-form" onSubmit={(event) => void submit(event)}><div className="section-heading"><div><p className="eyebrow">NOVA ATIVIDADE</p><h2>Dados da oficina</h2></div></div><div className="field-grid field-grid-two"><label className="field"><span className="field-label">Nome da atividade</span><input required minLength={3} maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Ex.: oficina de pintura" /></label><label className="field"><span className="field-label">Modalidade</span><select required value={form.activity_type} onChange={(event) => setForm({ ...form, activity_type: event.target.value })}><option value="">Selecione</option><option value="grupo">Grupo terapêutico</option><option value="arte">Arte e expressão</option><option value="música">Música</option><option value="movimento">Movimento corporal</option><option value="ocupacional">Atividade ocupacional</option><option value="recreação">Recreação</option><option value="outro">Outra</option></select></label><label className="field"><span className="field-label">Início</span><input required type="datetime-local" value={form.starts_at} onChange={(event) => setForm({ ...form, starts_at: event.target.value })} /></label><label className="field"><span className="field-label">Término (opcional)</span><input type="datetime-local" min={form.starts_at || undefined} value={form.ends_at} onChange={(event) => setForm({ ...form, ends_at: event.target.value })} /></label><label className="field"><span className="field-label">Local</span><input required minLength={2} maxLength={120} value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Sala ou espaço" /></label><label className="field"><span className="field-label">Paciente (opcional)</span><select value={form.patient_reference} onChange={(event) => setForm({ ...form, patient_reference: event.target.value })}><option value="">Atividade em grupo / sem vínculo individual</option>{patients.map((patient) => <option key={patient.reference} value={patient.reference}>{patient.name} · {patient.room && patient.bed ? `Qto ${patient.room} · Leito ${patient.bed}` : 'sem acomodação'}</option>)}</select></label></div><PatientAllergyAlert patient={patients.find((patient) => patient.reference === form.patient_reference)} /><label className="field"><span className="field-label">Objetivo ou observações</span><textarea maxLength={1000} rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label><div className="patient-form-actions"><button className="button button-secondary" type="button" onClick={() => setShowForm(false)} disabled={saving}>Cancelar</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar atividade'} <ArrowRight size={16} /></button></div></form>}
    <div className="therapy-layout"><section className="therapy-calendar-panel"><div className="therapy-calendar-heading"><button className="icon-button" type="button" aria-label="Mês anterior" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={19} /></button><h2>{monthLabel}</h2><button className="icon-button" type="button" aria-label="Próximo mês" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={19} /></button></div><div className="therapy-calendar-grid therapy-calendar-weekdays">{['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((day) => <span key={day}>{day}</span>)}</div><div className="therapy-calendar-grid">{calendarCells.map((cell, index) => cell ? <article className={`therapy-calendar-day ${cell.birthdays.length ? 'has-birthday' : ''} ${cell.activities.length ? 'has-activity' : ''}`} key={cell.dateKey}><strong>{cell.day}</strong>{cell.birthdays.slice(0, 2).map((patient) => <span className="therapy-calendar-tag birthday-tag" key={patient.reference} title={`Aniversário: ${patient.name}`}>🎂 {patient.name.split(' ')[0]}</span>)}{cell.activities.slice(0, 2).map((activity) => <span className="therapy-calendar-tag activity-tag" key={activity.id} title={activity.title}>• {activity.title}</span>)}{cell.birthdays.length + cell.activities.length > 4 && <small>+{cell.birthdays.length + cell.activities.length - 4}</small>}</article> : <span className="therapy-calendar-day therapy-calendar-empty" key={`empty-${index}`} />)}</div><div className="therapy-calendar-legend"><span><i className="legend-birthday" /> Aniversários</span><span><i className="legend-activity" /> Atividades</span></div></section>
      <aside className="therapy-birthday-panel"><div className="section-heading"><div><p className="eyebrow">DATAS ESPECIAIS</p><h2>Aniversários</h2></div><span className="module-total">{birthdaysThisMonth.length}</span></div>{birthdaysThisMonth.length ? <div className="therapy-birthday-list">{birthdaysThisMonth.map((patient) => <article key={patient.reference}><span className="birthday-date">{new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: '2-digit', month: 'short' }).format(new Date(`${month.getFullYear()}-${patient.birth_date!.slice(5)}T00:00:00Z`))}</span><div><strong>{patient.name}</strong><small>{patientLocationLabel(patient)}</small></div></article>)}</div> : <div className="history-empty">Nenhum aniversário cadastrado neste mês.</div>}<p className="field-hint">As datas são calculadas a partir do cadastro de pacientes autorizado para este perfil.</p></aside></div>
    <section className="therapy-activity-list"><div className="section-heading"><div><p className="eyebrow">PROGRAMAÇÃO</p><h2>Atividades de {monthLabel}</h2></div><span className="module-total">{visibleActivities.length} / {activities.length}</span></div><div className="psychology-filter-row"><label className="field"><span className="field-label">Buscar por atividade, local ou paciente</span><input value={activityQuery} onChange={(event) => setActivityQuery(event.target.value)} placeholder="Nome, local ou paciente" /></label><label className="field"><span className="field-label">Situação</span><select value={activityFilter} onChange={(event) => setActivityFilter(event.target.value as typeof activityFilter)}><option value="all">Todas</option>{Object.entries(therapyActivityStatusLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select></label></div>{loading ? <div className="history-empty">Carregando agenda…</div> : visibleActivities.length ? <div className="therapy-activity-grid">{visibleActivities.map((activity) => { const patient = patients.find((item) => item.reference === activity.patient_reference); return <article key={activity.id} className="therapy-activity-card"><span className="therapy-activity-date"><strong>{new Intl.DateTimeFormat('pt-BR', { day: '2-digit' }).format(new Date(activity.starts_at))}</strong><small>{new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(new Date(activity.starts_at))}</small></span><div><span className="eyebrow">{activity.activity_type} · {new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(activity.starts_at))} · {therapyActivityStatusLabels[reportStatuses[activity.id] ?? activity.status]}</span><h3>{activity.title}</h3><p>{activity.location}{patient ? ` · ${patient.name}` : ' · Grupo'}</p>{patient && <PatientAllergyAlert patient={patient} />}{activity.description && <small>{activity.description}</small>}</div></article> })}</div> : <div className="history-empty">{activities.length ? 'Nenhuma atividade corresponde aos filtros selecionados.' : 'Nenhuma atividade agendada para este mês.'}</div>}</section>
    <section className="therapy-report-panel"><div className="section-heading"><div><p className="eyebrow">ACOMPANHAMENTO</p><h2>Relatório de atividades · {monthLabel}</h2><p className="welcome-copy">{profile.modules.includes('therapy') ? 'Registre os resultados realizados e apresente o relatório à Gestão Hospitalar.' : 'Consulte os resultados registrados pela Oficina Terapêutica e imprima o relatório mensal.'}</p></div><button className="button button-secondary therapy-report-print-button" type="button" onClick={printActivityReport} disabled={!activities.length}><ClipboardList size={16} /> Imprimir relatório</button></div>{loading ? <div className="history-empty">Carregando relatórios…</div> : visibleActivities.length ? <div className="therapy-report-list">{visibleActivities.map((activity) => { const patient = patients.find((item) => item.reference === activity.patient_reference); const reportStatus = reportStatuses[activity.id] ?? activity.status; return <article className="therapy-report-card" key={`report-${activity.id}`}><div className="therapy-report-heading"><div><p className="eyebrow">{dateTime(activity.starts_at)} · {activity.activity_type}</p><h3>{activity.title}</h3><p>{activity.location}{patient ? ` · ${patient.name}${patient.room && patient.bed ? ` · Quarto ${patient.room}, leito ${patient.bed}` : ''}` : ' · Grupo'}</p>{patient && <PatientAllergyAlert patient={patient} />}</div><span className={`therapy-report-status therapy-report-status-${reportStatus}`}>{therapyActivityStatusLabels[reportStatus]}</span></div>{profile.modules.includes('therapy') ? <><label className="field"><span className="field-label">Relato da atividade</span><textarea rows={4} maxLength={4000} value={reportDrafts[activity.id] ?? ''} onChange={(event) => setReportDrafts((items) => ({ ...items, [activity.id]: event.target.value }))} placeholder="Descreva a participação, os resultados observados e os encaminhamentos necessários." /></label><div className="therapy-report-actions"><label className="field"><span className="field-label">Situação</span><select value={reportStatus} onChange={(event) => setReportStatuses((items) => ({ ...items, [activity.id]: event.target.value as TherapyActivityStatus }))}><option value="scheduled">Agendada</option><option value="in_progress">Em andamento</option><option value="completed">Realizada</option><option value="cancelled">Cancelada</option></select></label><button className="button button-primary" type="button" onClick={() => void saveActivityReport(activity)} disabled={savingReportId === activity.id}>{savingReportId === activity.id ? 'Salvando…' : 'Salvar relatório'}</button></div></> : <p className="therapy-report-content">{activity.activity_report || 'Relatório ainda não registrado.'}</p>}{activity.report_updated_by && <small className="therapy-report-author">Última atualização por {activity.report_updated_by}{activity.report_updated_at ? ` · ${dateTime(activity.report_updated_at)}` : ''}</small>}</article> })}</div> : <div className="history-empty">{activities.length ? 'Nenhuma atividade corresponde aos filtros selecionados.' : 'Agende uma atividade para iniciar o relatório do mês.'}</div>}</section>
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
  const [patients, setPatients] = useState<Patient[]>([])
  const [serviceTab, setServiceTab] = useState<'maintenance' | 'hygiene'>('maintenance')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [form, setForm] = useState({ title: '', category: '', description: '', department: '', customDepartment: '', unit: '', location: '', assetCode: '', patientReference: '', priority: 'normal' as WorkOrderPriority })
  const canLookupPatients = user.modules.some((module) =>
    ['patients', 'nursing', 'reception', 'therapy', 'nutrition', 'social', 'xray', 'maintenance', 'psychology', 'management'].includes(module)
      && user.permissions[module]?.includes('consultar'),
  )

  async function loadOrders() {
    try {
      const response = await fetch('/api/v1/maintenance/orders')
      const data = await readApiResponse<{ orders?: WorkOrder[] }>(response)
      setOrders(data.orders ?? [])
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar as solicitações.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    const loadOrdersForUser = async () => {
      try {
        const response = await fetch('/api/v1/maintenance/orders')
        const data = await readApiResponse<{ orders?: WorkOrder[] }>(response)
        if (active) {
          setOrders(data.orders ?? [])
          setError('')
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar as solicitações.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadOrdersForUser()
    return () => { active = false }
  }, [user.id])
  useEffect(() => {
    if (!canLookupPatients) return
    let active = true
    const loadPatients = async () => {
      try {
        const response = await fetch('/api/v1/nursing/patients')
        const data = await readApiResponse<{ patients?: Patient[] }>(response)
        if (active) setPatients(data.patients ?? [])
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar pacientes.')
      }
    }
    void loadPatients()
    return () => { active = false }
  }, [canLookupPatients, user.id])
  const orderPrintRows: PrintRow[] = orders.map((order) => ({ id: order.id, date: order.created_at, title: order.title, fields: [['Status', workOrderStatuses[order.status]], ['Prioridade', workOrderPriorities[order.priority]], ['Tipo', order.service_type], ['Setor', order.department], ['Local', order.location], ['Solicitante', order.requester_name], ['Descrição', order.description]] }))

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
          description: form.description.trim(),
          service_type: form.category,
          department: (form.department === 'Outro' ? form.customDepartment : form.department).trim(),
          location: [form.unit && `Unidade: ${form.unit}`, form.location && `Local: ${form.location.trim()}`, form.assetCode && `Patrimônio: ${form.assetCode.trim()}`].filter(Boolean).join(' · '),
          patient_reference: form.patientReference || null,
          priority: form.priority,
        }),
      })
      const data = await readApiResponse<WorkOrder>(response)
      setOrders((current) => [data, ...current])
      setForm({ title: '', category: '', description: '', department: '', customDepartment: '', unit: '', location: '', assetCode: '', patientReference: '', priority: 'normal' })
      setReviewing(false)
      setNotice('Ordem de serviço aberta. A equipe de manutenção poderá acompanhar a solicitação.')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Falha ao abrir a ordem de serviço.')
    } finally {
      setSaving(false)
    }
  }

  return <section className="work-orders-page page-enter">
    <div className="page-title-row"><div><p className="eyebrow">SERVIÇOS INTERNOS</p><h1>Ordens de serviço</h1><p className="welcome-copy">Escolha o serviço para encaminhar o pedido à equipe responsável.</p></div><span className="module-icon module-icon-maintenance"><ClipboardPlus size={23} /></span></div>
    <div className="service-tabs" role="tablist" aria-label="Tipo de ordem de serviço">
      <button className={`psychology-tab ${serviceTab === 'maintenance' ? 'is-active' : ''}`} type="button" role="tab" aria-selected={serviceTab === 'maintenance'} onClick={() => { setServiceTab('maintenance'); setError(''); setNotice('') }}><Wrench size={16} /> Manutenção</button>
      <button className={`psychology-tab ${serviceTab === 'hygiene' ? 'is-active' : ''}`} type="button" role="tab" aria-selected={serviceTab === 'hygiene'} onClick={() => { setServiceTab('hygiene'); setError(''); setNotice('') }}><ShieldCheck size={16} /> Higienização</button>
    </div>
    {serviceTab === 'maintenance' ? <>
    <form className="work-order-form" onSubmit={(event) => void submit(event)}>
      <div className="section-heading"><div><p className="eyebrow">NOVA SOLICITAÇÃO</p><h2>{reviewing ? 'Revise antes de enviar' : 'Descreva o que precisa'}</h2><p className="welcome-copy">{reviewing ? 'Confira os dados do chamado e confirme a abertura.' : 'Informe o tipo de serviço, o local e o que precisa ser feito.'}</p></div></div>
      {!reviewing ? <>
        <div className="field-grid field-grid-two">
          <label className="field"><span className="field-label">Tipo de serviço</span><select required value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option value="">Selecione uma categoria</option><option>Elétrica</option><option>Hidráulica</option><option>Climatização</option><option>Equipamento</option><option>Estrutura e mobiliário</option><option>Rede e telefonia</option><option>Outro serviço</option></select></label>
          <label className="field"><span className="field-label">Assunto</span><input required minLength={5} maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Ex.: torneira com vazamento" /></label>
          <label className="field"><span className="field-label">Setor solicitante</span><select required value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value, customDepartment: '' })}><option value="">Selecione seu setor</option><option>Enfermagem</option><option>Farmácia</option><option>Raio X</option><option>Serviço Social</option><option>Nutrição</option><option>Higienização</option><option>Psicologia / Psiquiatria</option><option>Recepção</option><option>Administração</option><option>Outro</option></select></label>
          {form.department === 'Outro' && <label className="field"><span className="field-label">Informe o setor</span><input required minLength={2} maxLength={100} value={form.customDepartment} onChange={(event) => setForm({ ...form, customDepartment: event.target.value })} /></label>}
          <label className="field"><span className="field-label">Unidade</span><select value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })}><option value="">Selecione a unidade</option><option>Hospital</option><option>Pronto atendimento</option><option>Área externa</option><option>Outro</option></select></label>
          <label className="field"><span className="field-label">Quarto, sala ou local</span><input maxLength={120} value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Ex.: quarto 3, sala de espera" /></label>
          {canLookupPatients && <label className="field"><span className="field-label">Paciente relacionado (opcional)</span><select value={form.patientReference} onChange={(event) => setForm({ ...form, patientReference: event.target.value })}><option value="">Sem vínculo com paciente</option>{patients.map((patient) => <option key={patient.reference} value={patient.reference}>{patient.name} · {patientLocationLabel(patient)}</option>)}</select></label>}
          <label className="field"><span className="field-label">Número do patrimônio (opcional)</span><input maxLength={60} value={form.assetCode} onChange={(event) => setForm({ ...form, assetCode: event.target.value })} placeholder="Etiqueta do equipamento" /></label>
          <label className="field"><span className="field-label">Prioridade</span><select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as WorkOrderPriority })}><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option></select><span className="field-hint">Use urgente quando houver impacto imediato no funcionamento ou na segurança.</span></label>
        </div>
        <label className="field"><span className="field-label">Descrição do serviço</span><textarea required minLength={5} maxLength={1450} rows={5} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Descreva o problema observado, quando começou e o resultado esperado." /><span className="field-hint">{form.description.length}/1.450 caracteres</span></label>
        <p className="work-order-privacy">Não inclua nome, diagnóstico ou outros dados de pacientes na descrição da ordem.</p>
      </> : <div className="work-order-review"><div><small>Categoria</small><strong>{form.category}</strong></div><div><small>Assunto</small><strong>{form.title}</strong></div><div><small>Setor solicitante</small><strong>{form.department === 'Outro' ? form.customDepartment : form.department}</strong></div><div><small>Localização</small><strong>{[form.unit && `Unidade: ${form.unit}`, form.location && `Local: ${form.location}`, form.assetCode && `Patrimônio: ${form.assetCode}`].filter(Boolean).join(' · ') || 'Não informado'}</strong></div>{form.patientReference && <div><small>Paciente</small><strong>{patients.find((patient) => patient.reference === form.patientReference)?.name ?? 'Paciente selecionado'}</strong></div>}<div><small>Prioridade</small><strong>{workOrderPriorities[form.priority]}</strong></div><div className="work-order-review-description"><small>Descrição</small><p>{form.description}</p></div></div>}
      {notice && <div className="form-message form-message-success" role="status">{notice}</div>}
      {error && <div className="form-message form-message-error" role="alert">{error}</div>}
      <div className="work-order-form-actions">{reviewing && <button className="button button-secondary" type="button" onClick={() => setReviewing(false)} disabled={saving}><ArrowLeft size={16} /> Editar solicitação</button>}<button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Enviando…' : reviewing ? 'Confirmar abertura' : 'Revisar solicitação'} {reviewing ? <BadgeCheck size={16} /> : <ArrowRight size={16} />}</button></div>
    </form>
    <section className="work-order-list-panel"><div className="section-heading"><div><p className="eyebrow">ACOMPANHAMENTO</p><h2>Minhas solicitações</h2></div><button className="button button-secondary" type="button" onClick={() => void loadOrders()} disabled={loading}>{loading ? 'Atualizando…' : 'Atualizar'}</button></div>
      {loading ? <div className="history-empty">Carregando solicitações…</div> : orders.length ? <div className="work-order-list">{orders.map((order) => <WorkOrderCard key={order.id} order={order} />)}</div> : <div className="history-empty"><ClipboardList size={20} /><span>Você ainda não abriu ordens de serviço.</span></div>}
    </section>
    <PrintSelectionPanel title="Minhas ordens de serviço" rows={orderPrintRows} />
    </> : <HygieneRequestForm />}
  </section>
}

type HygieneStatus = 'open' | 'in_progress' | 'completed' | 'cancelled'
type HygienePriority = 'normal' | 'high' | 'urgent'
type HygieneRequestType = 'routine' | 'spot' | 'after_procedure' | 'restock' | 'other'
type HygieneArea = 'room' | 'bathroom' | 'shared' | 'clinical' | 'circulation' | 'other'
type HygieneRequest = {
  id: string
  request_type: HygieneRequestType
  custom_type: string | null
  unit: string
  area: HygieneArea
  location: string
  description: string
  priority: HygienePriority
  status: HygieneStatus
  assignee: string
  requester_name: string
  updated_by: string
  created_at: string
  updated_at: string
}

const hygieneRequestTypes: Record<HygieneRequestType, string> = {
  routine: 'Higienização programada',
  spot: 'Limpeza pontual',
  after_procedure: 'Limpeza após procedimento',
  restock: 'Reposição de material',
  other: 'Outra solicitação',
}

const hygieneAreas: Record<HygieneArea, string> = {
  room: 'Quarto / leito',
  bathroom: 'Banheiro',
  shared: 'Área comum',
  clinical: 'Consultório / sala',
  circulation: 'Área de circulação',
  other: 'Outro local',
}

const hygieneStatuses: Record<HygieneStatus, string> = {
  open: 'Aguardando atendimento',
  in_progress: 'Em andamento',
  completed: 'Concluída',
  cancelled: 'Cancelada',
}

function HygieneRequestForm() {
  const [form, setForm] = useState({
    request_type: 'routine' as HygieneRequestType,
    custom_type: '',
    unit: '',
    area: '' as HygieneArea | '',
    location: '',
    description: '',
    priority: 'normal' as HygienePriority,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/v1/hygiene/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, custom_type: form.custom_type.trim() || null }),
      })
      await readApiResponse<HygieneRequest>(response)
      setForm({ request_type: 'routine', custom_type: '', unit: '', area: '', location: '', description: '', priority: 'normal' })
      setNotice('Solicitação enviada à equipe de Higienização.')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Falha ao registrar a solicitação.')
    } finally {
      setSaving(false)
    }
  }

  return <section className="hygiene-page page-enter">
    <div className="page-title-row"><div><p className="eyebrow">ORDEM DE SERVIÇO · HIGIENIZAÇÃO</p><h1>Solicitar higienização</h1><p className="welcome-copy">Informe o serviço e o local para direcionar o pedido à equipe.</p></div><span className="module-icon module-icon-hygiene"><ShieldCheck size={23} /></span></div>
    {error && <div className="form-message form-message-error" role="alert">{error}</div>}
    {notice && <div className="form-message form-message-success" role="status">{notice}</div>}
    <form className="hygiene-panel" onSubmit={(event) => void submit(event)}>
      <div className="field-grid field-grid-two">
        <label className="field"><span className="field-label">Tipo de solicitação</span><select required value={form.request_type} onChange={(event) => setForm({ ...form, request_type: event.target.value as HygieneRequestType, custom_type: '' })}>{Object.entries(hygieneRequestTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="field"><span className="field-label">Unidade</span><select required value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })}><option value="">Selecione</option><option>Hospital</option><option>Pronto atendimento</option><option>Área externa</option><option>Outra unidade</option></select></label>
        <label className="field"><span className="field-label">Área</span><select required value={form.area} onChange={(event) => setForm({ ...form, area: event.target.value as HygieneArea })}><option value="">Selecione</option>{Object.entries(hygieneAreas).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="field"><span className="field-label">Quarto, sala ou referência do local</span><input required minLength={2} maxLength={120} value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Ex.: quarto 3, sala de espera" /></label>
        <label className="field"><span className="field-label">Prioridade</span><select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as HygienePriority })}><option value="normal">Rotina</option><option value="high">Prioritária</option><option value="urgent">Urgente</option></select><span className="field-hint">Use urgente conforme os critérios e canais definidos pela instituição.</span></label>
        {form.request_type === 'other' && <label className="field"><span className="field-label">Tipo de solicitação</span><input required minLength={3} maxLength={80} value={form.custom_type} onChange={(event) => setForm({ ...form, custom_type: event.target.value })} placeholder="Descreva o serviço necessário" /></label>}
        <label className="field hygiene-field-wide"><span className="field-label">{form.request_type === 'restock' ? 'Material e quantidade' : 'Detalhes operacionais (opcional)'}</span><textarea maxLength={1000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder={form.request_type === 'restock' ? 'Informe o material e a quantidade necessária' : 'Descreva o serviço e condições relevantes do local'} /></label>
      </div>
      <p className="work-order-privacy">Não inclua nomes, diagnósticos ou outros dados de pacientes na descrição.</p>
      <button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Enviando…' : 'Enviar solicitação'} <ArrowRight size={16} /></button>
    </form>
  </section>
}

function HygienePage({ user }: { user: AuthUser }) {
  const [requests, setRequests] = useState<HygieneRequest[]>([])
  const [drafts, setDrafts] = useState<Record<string, { status: HygieneStatus; assignee: string }>>({})
  const [filter, setFilter] = useState<'active' | 'all' | HygieneStatus>('active')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function loadRequests() {
    try {
      const response = await fetch('/api/v1/hygiene/requests')
      const data = await readApiResponse<{ requests?: HygieneRequest[] }>(response)
      setRequests(data.requests ?? [])
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar as solicitações de higienização.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    const loadRequestsForUser = async () => {
      try {
        const response = await fetch('/api/v1/hygiene/requests')
        const data = await readApiResponse<{ requests?: HygieneRequest[] }>(response)
        if (active) {
          setRequests(data.requests ?? [])
          setError('')
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar as solicitações de higienização.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadRequestsForUser()
    return () => { active = false }
  }, [user.id])

  const visibleRequests = requests.filter((request) => {
    const matchesStatus = filter === 'all' || (filter === 'active'
      ? request.status === 'open' || request.status === 'in_progress'
      : request.status === filter)
    const searchable = `${request.unit} ${request.location} ${request.description} ${request.custom_type ?? ''} ${request.requester_name} ${request.assignee} ${hygieneAreas[request.area]} ${hygieneRequestTypes[request.request_type]}`.toLocaleLowerCase('pt-BR')
    return matchesStatus && searchable.includes(query.trim().toLocaleLowerCase('pt-BR'))
  })
  const activeCount = requests.filter((request) => request.status === 'open' || request.status === 'in_progress').length

  async function saveRequest(request: HygieneRequest) {
    const draft = drafts[request.id] ?? { status: request.status, assignee: request.assignee }
    setUpdating(request.id)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`/api/v1/hygiene/requests/${request.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: draft.status, assignee: draft.assignee }),
      })
      const data = await readApiResponse<HygieneRequest>(response)
      setRequests((current) => current.map((item) => item.id === data.id ? data : item))
      setDrafts((current) => { const next = { ...current }; delete next[request.id]; return next })
      setNotice('Solicitação atualizada.')
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Falha ao atualizar a solicitação.')
    } finally {
      setUpdating('')
    }
  }

  return <section className="hygiene-page page-enter">
    <div className="page-title-row"><div><p className="eyebrow">EQUIPE · HIGIENIZAÇÃO</p><h1>Higienização</h1><p className="welcome-copy">Receba, priorize, atribua e acompanhe as solicitações da equipe.</p></div><span className="module-icon module-icon-hygiene"><ShieldCheck size={23} /></span></div>
    <div className="hygiene-summary" aria-label="Resumo da fila"><article><strong>{activeCount}</strong><span>Solicitações ativas</span></article><article><strong>{requests.filter((request) => request.status === 'open').length}</strong><span>Aguardando atendimento</span></article><article><strong>{requests.filter((request) => request.status === 'in_progress').length}</strong><span>Em andamento</span></article></div>
    {error && <div className="form-message form-message-error" role="alert">{error}</div>}
    {notice && <div className="form-message form-message-success" role="status">{notice}</div>}
    <section className="hygiene-panel">
      <div className="section-heading"><div><p className="eyebrow">PAINEL DA EQUIPE</p><h2>Fila de solicitações</h2></div><button className="button button-secondary" type="button" onClick={() => void loadRequests()} disabled={loading}>{loading ? 'Atualizando…' : 'Atualizar fila'}</button></div>
      <div className="hygiene-filters"><label className="field"><span className="field-label">Situação</span><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="active">Ativas</option><option value="all">Todas</option>{Object.entries(hygieneStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field"><span className="field-label">Buscar por local ou serviço</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Unidade, local, tipo ou responsável" /></label></div>
      {loading ? <div className="history-empty">Carregando fila…</div> : visibleRequests.length ? <div className="hygiene-request-list">{visibleRequests.map((request) => {
        const draft = drafts[request.id] ?? { status: request.status, assignee: request.assignee }
        return <article className="hygiene-request-card" key={request.id}>
          <div className="hygiene-request-heading"><div><span className={`work-order-priority priority-${request.priority}`}>{workOrderPriorities[request.priority]}</span><h3>{request.request_type === 'other' ? request.custom_type : hygieneRequestTypes[request.request_type]}</h3><p>{request.unit} · {hygieneAreas[request.area]} · {request.location}</p></div><span className={`work-order-status status-${request.status}`}>{hygieneStatuses[request.status]}</span></div>
          {request.description && <p className="hygiene-request-description">{request.description}</p>}
          <div className="hygiene-request-meta"><span>Solicitado por <strong>{request.requester_name}</strong></span><time>{dateTime(request.created_at)}</time></div>
          <div className="hygiene-request-controls"><label className="field"><span className="field-label">Responsável</span><input maxLength={120} value={draft.assignee} onChange={(event) => setDrafts((current) => ({ ...current, [request.id]: { ...draft, assignee: event.target.value } }))} placeholder="Atribuir membro da equipe" /></label><label className="field"><span className="field-label">Situação</span><select value={draft.status} onChange={(event) => setDrafts((current) => ({ ...current, [request.id]: { ...draft, status: event.target.value as HygieneStatus } }))}><option value="open">Aguardando atendimento</option><option value="in_progress">Em andamento</option><option value="completed">Concluída</option><option value="cancelled">Cancelada</option></select></label><button className="button button-secondary" type="button" onClick={() => void saveRequest(request)} disabled={updating === request.id || (draft.status === request.status && draft.assignee === request.assignee)}>{updating === request.id ? 'Salvando…' : 'Salvar atualização'}</button></div>
          <small className="hygiene-updated">Última atualização por {request.updated_by} · {dateTime(request.updated_at)}</small>
        </article>
      })}</div> : <div className="history-empty">Nenhuma solicitação corresponde a este filtro.</div>}
    </section>
  </section>
}

function MaintenanceQueuePage() {
  const [orders, setOrders] = useState<WorkOrder[]>([])
  const [filters, setFilters] = useState({ from_date: '', to_date: '', service_type: '', department: '', status: '', priority: '', q: '' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [changes, setChanges] = useState<Record<string, { status: WorkOrderStatus; note: string }>>({})

  async function loadQueue(nextFilters = filters) {
    try {
      const params = new URLSearchParams(Object.entries(nextFilters).filter(([, value]) => value))
      const response = await fetch(`/api/v1/maintenance/queue${params.size ? `?${params}` : ''}`)
      const data = await readApiResponse<{ orders?: WorkOrder[] }>(response)
      setOrders(data.orders ?? [])
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar a fila.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    const loadFilteredQueue = async () => {
      try {
        const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value))
        const response = await fetch(`/api/v1/maintenance/queue${params.size ? `?${params}` : ''}`)
        const data = await readApiResponse<{ orders?: WorkOrder[] }>(response)
        if (active) {
          setOrders(data.orders ?? [])
          setError('')
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar a fila.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadFilteredQueue()
    return () => { active = false }
  }, [filters])

  function printResults() {
    document.body.classList.add('print-maintenance-queue')
    window.print()
    window.setTimeout(() => document.body.classList.remove('print-maintenance-queue'), 500)
  }

  const maintenancePrintRows: PrintRow[] = orders.map((order) => ({ id: order.id, date: order.created_at, title: order.title, fields: [['Status', workOrderStatuses[order.status]], ['Prioridade', workOrderPriorities[order.priority]], ['Tipo', order.service_type], ['Setor solicitante', order.department], ['Local', order.location], ['Solicitante', order.requester_name], ['Descrição', order.description]] }))
  const statusSummary = orders.reduce<Record<string, number>>((summary, order) => ({ ...summary, [order.status]: (summary[order.status] ?? 0) + 1 }), {})

  async function saveStatus(order: WorkOrder) {
    const change = changes[order.id] ?? { status: order.status, note: '' }
    setError('')
    setNotice('')
    try {
      const response = await fetch(`/api/v1/maintenance/orders/${order.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: change.status, note: change.note }),
      })
      const data = await readApiResponse<WorkOrder>(response)
      setOrders((current) => current.map((item) => item.id === data.id ? data : item))
      setChanges((current) => { const next = { ...current }; delete next[order.id]; return next })
      setNotice(`Ordem atualizada para “${workOrderStatuses[data.status]}”.`)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Falha ao atualizar a ordem.')
    }
  }

  return <section className="work-orders-page page-enter maintenance-queue-page">
    <div className="page-title-row"><div><p className="eyebrow">EQUIPE · MANUTENÇÃO</p><h1>Manutenção</h1><p className="welcome-copy">Consulte solicitações de todos os setores e atualize o andamento dos serviços.</p></div><span className="module-icon module-icon-maintenance"><Wrench size={23} /></span></div>
    {notice && <div className="form-message form-message-success" role="status">{notice}</div>}{error && <div className="form-message form-message-error" role="alert">{error}</div>}
    <section className="work-order-list-panel"><div className="section-heading"><div><p className="eyebrow">PAINEL OPERACIONAL</p><h2>Solicitações recebidas <span className="module-total">{orders.length}</span></h2></div><div className="maintenance-actions"><button className="button button-secondary" type="button" onClick={printResults} disabled={loading || !orders.length}><Printer size={16} /> Imprimir lista</button><button className="button button-secondary" type="button" onClick={() => void loadQueue()} disabled={loading}>{loading ? 'Atualizando…' : 'Atualizar fila'}</button></div></div>
      <form className="maintenance-filters" onSubmit={(event) => { event.preventDefault(); void loadQueue(filters) }}><label className="field"><span className="field-label">De</span><input type="date" value={filters.from_date} onChange={(event) => setFilters({ ...filters, from_date: event.target.value })} /></label><label className="field"><span className="field-label">Até</span><input type="date" value={filters.to_date} onChange={(event) => setFilters({ ...filters, to_date: event.target.value })} /></label><label className="field"><span className="field-label">Tipo de serviço</span><select value={filters.service_type} onChange={(event) => setFilters({ ...filters, service_type: event.target.value })}><option value="">Todos</option>{['Elétrica', 'Hidráulica', 'Climatização', 'Higienização', 'Equipamento', 'Estrutura e mobiliário', 'Rede e telefonia', 'Outro serviço'].map((type) => <option key={type}>{type}</option>)}</select></label><label className="field"><span className="field-label">Setor solicitante</span><input value={filters.department} onChange={(event) => setFilters({ ...filters, department: event.target.value })} placeholder="Todos os setores" /></label><label className="field"><span className="field-label">Status</span><select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">Todos</option>{Object.entries(workOrderStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field"><span className="field-label">Prioridade</span><select value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value })}><option value="">Todas</option>{Object.entries(workOrderPriorities).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field maintenance-query"><span className="field-label">Busca</span><input value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="Assunto, local ou solicitante" /></label><div className="maintenance-filter-actions"><button className="button button-primary" type="submit" disabled={loading}><Search size={16} /> Filtrar</button><button className="button button-secondary" type="button" onClick={() => { const empty = { from_date: '', to_date: '', service_type: '', department: '', status: '', priority: '', q: '' }; setFilters(empty); void loadQueue(empty) }}>Limpar</button></div></form>
      <div className="maintenance-report-summary" aria-label="Resumo dos resultados"><strong>{orders.length} ordens</strong>{Object.entries(workOrderStatuses).map(([status, label]) => <span key={status}>{label}: <b>{statusSummary[status] ?? 0}</b></span>)}</div>
      {loading ? <div className="history-empty">Carregando fila…</div> : orders.length ? <div className="work-order-list">{orders.map((order) => <WorkOrderCard key={order.id} order={order} editable onStatusChange={(status) => setChanges((current) => ({ ...current, [order.id]: { ...(current[order.id] ?? { status: order.status, note: '' }), status } }))} status={changes[order.id]?.status ?? order.status} note={changes[order.id]?.note ?? ''} onNoteChange={(note) => setChanges((current) => ({ ...current, [order.id]: { ...(current[order.id] ?? { status: order.status }), note } }))} onSave={() => void saveStatus(order)} saving={false} />)}</div> : <div className="history-empty"><CheckCircle2 size={20} /><span>Nenhuma ordem de serviço corresponde aos filtros.</span></div>}
    </section>
    <PrintSelectionPanel title="Relatório de Manutenção" rows={maintenancePrintRows} />
  </section>
}

function WorkOrderCard({ order, editable = false, status, note, onStatusChange, onNoteChange, onSave, saving = false }: { order: WorkOrder; editable?: boolean; status?: WorkOrderStatus; note?: string; onStatusChange?: (status: WorkOrderStatus) => void; onNoteChange?: (note: string) => void; onSave?: () => void; saving?: boolean }) {
  function printOrder() {
    const cards = [...document.querySelectorAll('.work-order-card')]
    const target = cards.find((card) => card.querySelector(`[data-print-order="${order.id}"]`))
    cards.forEach((card) => card.classList.toggle('print-away', card !== target))
    document.body.classList.add('print-maintenance-order')
    window.print()
    window.setTimeout(() => { document.body.classList.remove('print-maintenance-order'); cards.forEach((card) => card.classList.remove('print-away')) }, 500)
  }
  return <article className="work-order-card" data-order-id={order.id}><div className="work-order-card-heading"><div><span className={`work-order-priority priority-${order.priority}`}>{workOrderPriorities[order.priority]}</span><h3>{order.title}</h3></div><span className={`work-order-status status-${order.status}`}>{workOrderStatuses[order.status]}</span></div>
    <div className="work-order-meta"><span><strong>Tipo de serviço</strong>{order.service_type || 'Outro serviço'}</span><span><strong>Setor</strong>{order.department}</span>{order.location && <span><strong>Local</strong>{order.location}</span>}<span><strong>Solicitante</strong>{order.requester_name}</span><span><strong>Aberta em</strong>{dateTime(order.created_at)}</span><span><strong>Atualizada por</strong>{order.updated_by} · {dateTime(order.updated_at)}</span></div><p className="work-order-description">{order.description}</p>
    <div className="work-order-print-action"><button data-print-order={order.id} className="button button-secondary" type="button" onClick={printOrder}><Printer size={15} /> Imprimir OS</button></div>
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

function Dashboard({ profile, user, onNavigate }: { profile: Profile; user: AuthUser; onNavigate: (id: ModuleId) => void }) {
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

      <Suspense fallback={<div className="history-empty" role="status">Carregando suas pendências…</div>}>
        <OperationalTaskCenter user={user} onNavigate={onNavigate} />
      </Suspense>

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
  const [installed, setInstalled] = useState(() => window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
  useEffect(() => {
    const promptReady = () => setInstallPrompt(deferredInstallPrompt)
    const installedListener = () => { setInstalled(true); setInstallPrompt(null) }
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
  const invalidDateRange = Boolean(fromDate && toDate && fromDate > toDate)

  useEffect(() => {
    let current = true
    fetch('/api/v1/nursing/patients?include_inactive=true').then(async (response) => {
      if (!response.ok) throw new Error('Não foi possível carregar os pacientes.')
      return await response.json() as { patients: Patient[] }
    }).then((data) => { if (current) setPatients(data.patients) }).catch((loadError) => {
      if (current) setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar os pacientes.')
    }).finally(() => { if (current) setLoadingPatients(false) })
    return () => { current = false }
  }, [])

  useEffect(() => {
    if (invalidDateRange) return
    const controller = new AbortController()
    let active = true
    const loadRecords = async () => {
      const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) })
      if (fromDate) params.set('from_date', fromDate)
      if (toDate) params.set('to_date', toDate)
      if (room) params.set('room', room)
      if (bed) params.set('bed', bed)
      if (patientReference) params.set('patient_reference', patientReference)
      if (active) setLoadingRecords(true)
      try {
        const response = await fetch(`/api/v1/nursing/vitals?${params.toString()}`, { signal: controller.signal })
        const data = await response.json() as { records?: VitalRecordData[]; total?: number; detail?: string }
        if (!response.ok) throw new Error(data.detail ?? 'Não foi possível carregar as coletas.')
        if (!active) return
        setRecords(data.records ?? [])
        setTotal(data.total ?? 0)
        setError('')
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === 'AbortError') return
        if (!active) return
        setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar as coletas.')
        setRecords([])
        setTotal(0)
      } finally {
        if (active && !controller.signal.aborted) setLoadingRecords(false)
      }
    }

    void loadRecords()
    return () => {
      active = false
      controller.abort()
    }
  }, [fromDate, toDate, room, bed, patientReference, offset, invalidDateRange])

  const visiblePatients = patients.filter((patient) => (!room || patient.room === room) && (!bed || patient.bed === bed))
  const roomOptions = [...new Set(patients.map((patient) => patient.room))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))
  const bedOptions = [...new Set(patients.filter((patient) => !room || patient.room === room).map((patient) => patient.bed))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))
  const pageNumber = Math.floor(offset / pageSize) + 1
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const vitalPrintRows: PrintRow[] = records.map((record) => {
    const patient = patients.find((item) => item.reference === record.patient_reference)
    return { id: String(record.id), date: record.recorded_at, title: patient ? `${patient.name} · Quarto ${patient.room}, leito ${patient.bed}` : 'Paciente', fields: [...Object.entries(record.values).map(([key, value]) => [fieldLabels[key as keyof RecordFields] ?? (key === 'painScale' ? 'Escala utilizada' : key === 'bowel' ? 'Eliminação intestinal (registro anterior)' : key), value] as [string, string]), ['Unidade de glicose', record.glucose_unit], ['Profissional', record.actor_name]] }
  })

  function clearFilters() {
    setFromDate(''); setToDate(''); setRoom(''); setBed(''); setPatientReference(''); setOffset(0)
  }

  async function voidRecord(recordId: number) {
    const reason = window.prompt('Motivo para arquivar esta coleta incorreta (ela será preservada na auditoria):')
    if (!reason?.trim()) return
    const response = await fetch(`/api/v1/nursing/vitals/${recordId}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: reason.trim() }) })
    const data = await response.json() as { detail?: string }
    if (!response.ok) { setError(data.detail ?? 'Não foi possível arquivar a coleta.'); return }
    setRecords((current) => current.filter((record) => record.id !== recordId))
    setTotal((current) => Math.max(0, current - 1))
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
        <label className="field history-filter-patient"><span className="field-label">Paciente</span><select value={patientReference} onChange={(event) => { setPatientReference(event.target.value); setOffset(0) }} disabled={loadingPatients}><option value="">Todos os pacientes</option>{visiblePatients.map((patient) => <option key={patient.reference} value={patient.reference}>{patient.name} · Qto {patient.room} · Leito {patient.bed}{patient.active === false ? ' · Alta' : ''}</option>)}</select></label>
      </div>
      <button className="button button-secondary history-clear-button" type="button" onClick={clearFilters}>Limpar filtros</button>
    </section>
    <PrintSelectionPanel title="Coletas de sinais vitais" rows={vitalPrintRows} />
    {invalidDateRange && <div className="form-message form-message-error" role="alert">A data inicial deve ser anterior ou igual à data final.</div>}
    {error && <div className="form-message form-message-error" role="alert">{error}</div>}
    {invalidDateRange ? null : loadingRecords ? <div className="history-empty">Carregando coletas…</div> : <><VitalHistory records={records} patients={patients} patientReference={patientReference} metric={metric} onMetric={setMetric} onVoid={(id) => void voidRecord(id)} /><VitalExtraDetails records={records} patientReference={patientReference} /></>}
    {!loadingRecords && total > pageSize && <nav className="history-pagination" aria-label="Paginação das coletas"><span>Exibindo {offset + 1}–{Math.min(offset + records.length, total)} de {total}</span><div><button className="button button-secondary" type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}><ArrowLeft size={15} /> Anterior</button><span>Página {pageNumber} de {pageCount}</span><button className="button button-secondary" type="button" disabled={offset + pageSize >= total} onClick={() => setOffset(offset + pageSize)}>Próxima <ArrowRight size={15} /></button></div></nav>}
  </section>
}

function NursingPage({ profile, user, onShowHistory }: { profile: Profile; user: AuthUser; onShowHistory: () => void }) {
  const [record, setRecord] = useState<RecordFields>({ ...emptyRecord })
  const [notApplicable, setNotApplicable] = useState<string[]>([])
  const [entryState, setEntryState] = useState<EntryState>('draft')
  const [message, setMessage] = useState('')
  const [savedAt, setSavedAt] = useState('')
  const [patients, setPatients] = useState<Patient[]>([])
  const [patientRef, setPatientRef] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [medicationError, setMedicationError] = useState('')
  const [medicationLoading, setMedicationLoading] = useState(true)
  const [showPatientForm, setShowPatientForm] = useState(false)
  const [newPatient, setNewPatient] = useState({ name: '', room: '', bed: '' })
  const [nutritionPlan, setNutritionPlan] = useState<NutritionPlan | null>(null)
  const [dispensations, setDispensations] = useState<MedicationDispensation[]>([])
  const [administrations, setAdministrations] = useState<MedicationAdministration[]>([])
  const [medicationStatus, setMedicationStatus] = useState<MedicationAdministration['status']>('administered')
  const [medicationReason, setMedicationReason] = useState('')
  const [selectedDispensation, setSelectedDispensation] = useState('')
  const [medicationSaving, setMedicationSaving] = useState(false)

  useEffect(() => {
    let current = true
    fetch('/api/v1/nursing/patients').then(readApiResponse<{ patients?: Patient[] }>).then((patientData) => {
      if (!current) return
      const patientRows = patientData.patients ?? []
      setPatients(patientRows)
      setHistoryError('')
      setPatientRef((selected) => patientRows.some((item) => item.reference === selected) ? selected : patientRows[0]?.reference ?? '')
    }).catch((loadError) => { if (current) setHistoryError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar os pacientes. Reinicie os serviços e confirme que as migrações foram aplicadas.') })
    return () => { current = false }
  }, [profile.id])

  useEffect(() => {
    let current = true
    Promise.all([
      fetch('/api/v1/pharmacy/dispensations?status=dispensed'),
      fetch('/api/v1/nursing/medication-administrations'),
    ]).then(async ([dispenseResponse, administrationResponse]) => {
      const [dispenseData, administrationData] = await Promise.all([
        readApiResponse<{ dispensations?: MedicationDispensation[] }>(dispenseResponse),
        readApiResponse<{ administrations?: MedicationAdministration[] }>(administrationResponse),
      ])
      if (!current) return
      setDispensations(dispenseData.dispensations ?? [])
      setAdministrations(administrationData.administrations ?? [])
      setMedicationError('')
      setMedicationLoading(false)
    }).catch((loadError) => {
      if (!current) return
      setMedicationError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar dispensações e administrações.')
      setMedicationLoading(false)
    })
    return () => { current = false }
  }, [profile.id])

  useEffect(() => {
    if (!patientRef) return
    let current = true
    fetch(`/api/v1/nursing/patients/${encodeURIComponent(patientRef)}/nutrition-plan`).then(async (response) => {
      const data = await response.json() as NutritionPlan
      if (!response.ok) throw new Error('Falha ao carregar o plano alimentar')
      if (current) setNutritionPlan(data)
    }).catch(() => { if (current) setNutritionPlan(null) })
    return () => { current = false }
  }, [patientRef])

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

  async function saveMedicationAdministration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedDispensation || !patientRef) return
    setMedicationSaving(true); setMessage('')
    try {
      const response = await fetch('/api/v1/nursing/medication-administrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dispensation_id: selectedDispensation,
          patient_reference: patientRef,
          status: medicationStatus,
          reason: medicationReason.trim(),
        }),
      })
      const record = await readApiResponse<MedicationAdministration>(response)
      setAdministrations((current) => [record, ...current])
      setSelectedDispensation('')
      setMedicationReason('')
      setMedicationStatus('administered')
      setMessage('Registro de administração atualizado.')
    } catch (saveError) {
      setMessage(saveError instanceof Error ? saveError.message : 'Não foi possível registrar a administração.')
    } finally { setMedicationSaving(false) }
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
      <div className="patient-strip"><span className="patient-avatar"><Stethoscope size={19} /></span><label className="patient-copy"><span>Paciente</span><select value={patientRef} onChange={(event) => { setPatientRef(event.target.value); setNutritionPlan(null) }}>{patients.map((patient) => <option key={patient.reference} value={patient.reference}>{patient.name} · {patientLocationLabel(patient)}</option>)}</select></label><button className="button button-secondary" type="button" onClick={() => setShowPatientForm((visible) => !visible)}>Cadastrar paciente</button><div className="patient-meta"><span>Registrado por</span><strong>{profile.name}</strong></div></div>
      <PatientAllergyAlert patient={patients.find((patient) => patient.reference === patientRef)} />
      <section className="nursing-medication-panel">
        <div className="section-heading"><div><p className="eyebrow">FARMÁCIA → ENFERMAGEM</p><h2>Dispensações deste paciente</h2><p className="welcome-copy">A Farmácia registra lote, prescrição e baixa de estoque; a Enfermagem registra administração, recusa ou suspensão.</p></div></div>
        {medicationError && <div className="form-message form-message-error" role="alert">{medicationError}</div>}
        {medicationLoading ? <p className="history-empty">Carregando dispensações…</p> : medicationError ? null : dispensations.filter((item) => item.patient_reference === patientRef && !administrations.some((record) => record.dispensation_id === item.id)).length > 0 ? <form className="field-grid field-grid-two" onSubmit={(event) => void saveMedicationAdministration(event)}>
          <label className="field"><span className="field-label">Dispensação pendente</span><select required value={selectedDispensation} onChange={(event) => setSelectedDispensation(event.target.value)}><option value="">Selecione</option>{dispensations.filter((item) => item.patient_reference === patientRef && !administrations.some((record) => record.dispensation_id === item.id)).map((item) => <option key={item.id} value={item.id}>{item.medication_name} · {item.quantity} {item.unit} · {dateTime(item.created_at)}</option>)}</select></label>
          <label className="field"><span className="field-label">Resultado</span><select value={medicationStatus} onChange={(event) => setMedicationStatus(event.target.value as MedicationAdministration['status'])}><option value="administered">Administrado</option><option value="refused">Recusado pelo paciente</option><option value="held">Suspenso / não administrado</option></select></label>
          {medicationStatus !== 'administered' && <label className="field"><span className="field-label">Motivo</span><input required minLength={3} maxLength={500} value={medicationReason} onChange={(event) => setMedicationReason(event.target.value)} /></label>}
          <button className="button button-primary" type="submit" disabled={medicationSaving || !selectedDispensation}>{medicationSaving ? 'Salvando…' : 'Registrar ação de Enfermagem'}</button>
        </form> : <p className="history-empty">Não há dispensações pendentes para o paciente selecionado.</p>}
        {!!administrations.filter((record) => record.patient_reference === patientRef).length && <div className="nursing-medication-history">{administrations.filter((record) => record.patient_reference === patientRef).map((record) => <article key={record.id}><strong>{record.medication_name} · {record.dose} {record.unit}</strong><span>{record.status === 'administered' ? 'Administrado' : record.status === 'refused' ? 'Recusado' : 'Suspenso'} · {record.actor_name} · {dateTime(record.administered_at)}</span>{record.reason && <small>{record.reason}</small>}</article>)}</div>}
        <p className="work-order-privacy">Confirme paciente, alergias, prescrição, dose e momento correto segundo o protocolo institucional. Este registro não é prescrição nem orientação clínica automatizada.</p>
      </section>
      {nutritionPlan && (nutritionPlan.assessment_date || nutritionPlan.fasting_at) && <div className="care-plan-strip"><strong>Plano alimentar compartilhado</strong>{nutritionPlan.assessment_date && <span>Avaliação de {new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${nutritionPlan.assessment_date}T00:00:00Z`))} · {nutritionPlan.diet_type || 'Tipo de dieta não informado'}{nutritionPlan.restrictions ? ` · Restrições: ${nutritionPlan.restrictions}` : ''}</span>}{nutritionPlan.fasting_at && <span className="fasting-alert">Jejum programado: {dateTime(nutritionPlan.fasting_at)}{nutritionPlan.fasting_reason ? ` · ${nutritionPlan.fasting_reason}` : ''}</span>}</div>}
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
            <div className="field-grid field-grid-two glucose-entry-grid">
              <ValueField label="Valor" unit={record.glucoseUnit} value={record.glucose} disabled={notApplicable.includes('glucose')} onChange={(value) => updateField('glucose', value)} onNA={() => toggleNotApplicable('glucose')} isNA={notApplicable.includes('glucose')} inputMode="decimal" />
              <label className="field glucose-unit-field"><span className="field-label">Unidade</span><select value={record.glucoseUnit} onChange={(event) => updateField('glucoseUnit', event.target.value)} disabled={notApplicable.includes('glucose')}><option>mg/dL</option><option>mmol/L</option></select></label>
            </div>
          </FormSection>

          <FormSection number="03" title="Acesso venoso" detail="Informe o tipo de acesso e, se necessário, o local e uma observação.">
            <div className="field-grid field-grid-three">
              <TextField label="Local" value={record.venousSite} onChange={(value) => updateField('venousSite', value)} placeholder="Não informado" />
              <label className="field"><span className="field-label">Tipo de acesso</span><select value={record.venousCondition} onChange={(event) => updateField('venousCondition', event.target.value)}><option value="">Selecione</option><option value="venoso periférico">Venoso periférico</option><option value="jugular">Jugular</option><option value="central">Central</option></select></label>
              <TextField label="Observação" value={record.venousNote} onChange={(value) => updateField('venousNote', value)} placeholder="Opcional" />
            </div>
          </FormSection>

          <FormSection number="04" title="Eliminações" detail="Informe a presença de eliminação urinária e o uso de sonda intestinal.">
            <div className="field-grid field-grid-two">
              <label className="field"><span className="field-label">Eliminação urinária</span><select value={record.urine} onChange={(event) => updateField('urine', event.target.value)}><option value="">Selecione</option><option value="Sim">Sim</option><option value="Não">Não</option></select></label>
              <label className="field"><span className="field-label">Eliminação intestinal</span><select value={record.bowelTube} onChange={(event) => updateField('bowelTube', event.target.value)}><option value="">Selecione</option><option value="Sim">Sim</option><option value="Não">Não</option></select></label>
            </div>
          </FormSection>

          <FormSection number="05" title="Dor / algia" detail="Informe o valor observado, quando aplicável.">
            <div className="field-grid field-grid-one">
              <TextField label="Valor informado" value={record.pain} onChange={(value) => updateField('pain', value)} placeholder="Não preenchido" inputMode="decimal" />
            </div>
          </FormSection>

          <FormSection number="06" title="Observações" detail="Até 1.000 caracteres.">
            <label className="field"><span className="field-label">Texto livre</span><textarea value={record.notes} onChange={(event) => updateField('notes', event.target.value)} maxLength={1000} rows={3} placeholder="Observações complementares" /><span className="field-hint">{record.notes.length}/1.000 caracteres</span></label>
          </FormSection>

          <FormSection number="07" title="Tratamentos e acompanhamentos" detail="Registre os dados observados e horários conforme a rotina assistencial local.">
            <div className="field-grid field-grid-three">
              <label className="field"><span className="field-label">Uso de oxigênio</span><select value={record.oxygenStatus} onChange={(event) => updateField('oxygenStatus', event.target.value)}><option value="">Não informado</option><option value="em uso">Em uso</option><option value="suspenso">Suspenso</option><option value="não utiliza">Não utiliza</option></select></label>
              <label className="field"><span className="field-label">Oxigênio ligado em</span><input type="datetime-local" value={record.oxygenStartedAt} onChange={(event) => updateField('oxygenStartedAt', event.target.value)} /></label>
              <label className="field"><span className="field-label">Oxigênio desligado em</span><input type="datetime-local" value={record.oxygenEndedAt} onChange={(event) => updateField('oxygenEndedAt', event.target.value)} /></label>
            </div>
            <div className="field-grid field-grid-two"><label className="field"><span className="field-label">Curativos e lesões</span><textarea maxLength={1000} value={record.wounds} onChange={(event) => updateField('wounds', event.target.value)} placeholder="Local e descrição observada" /></label><label className="field"><span className="field-label">Tipo de cobertura</span><textarea maxLength={500} value={record.dressingType} onChange={(event) => updateField('dressingType', event.target.value)} placeholder="Cobertura registrada" /></label></div>
            <div className="field-grid field-grid-two"><label className="field"><span className="field-label">Exame</span><input maxLength={500} value={record.examName} onChange={(event) => updateField('examName', event.target.value)} placeholder="Nome do exame" /></label><label className="field"><span className="field-label">Agendamento</span><input type="datetime-local" value={record.examScheduledAt} onChange={(event) => updateField('examScheduledAt', event.target.value)} /></label></div>
            <div className="field-grid field-grid-two"><label className="field"><span className="field-label">Acompanhamento</span><textarea maxLength={1000} value={record.examFollowUp} onChange={(event) => updateField('examFollowUp', event.target.value)} placeholder="Etapa/status informado" /></label><label className="field"><span className="field-label">Resultado / informação disponível</span><textarea maxLength={2000} value={record.examResult} onChange={(event) => updateField('examResult', event.target.value)} placeholder="Resultado recebido ou observação" /></label></div>
          </FormSection>

          {message && <div className={`form-message ${entryState === 'error' ? 'form-message-error' : ''}`} role="status">{message}</div>}
          <div className="form-actions"><span className="draft-hint"><Pencil size={14} /> Rascunho temporário nesta sessão</span><button className="button button-primary" type="submit">Revisar coleta <ArrowRight size={17} /></button></div>
        </form>
      )}

      <div className="clinical-note"><ShieldCheck size={17} /><span>Os gráficos apresentam os valores registrados, sem interpretação clínica automática.</span></div>
      <ClinicalQueuePanel canUpdate={user.permissions.nursing?.includes('alterar') ?? false} />
      <PatientFlowRiskPanel
        patients={patients}
        canUpdate={user.permissions.nursing?.includes('alterar') ?? false}
        onPatientUpdated={(updated) => setPatients((current) => current.map((patient) => patient.reference === updated.reference ? updated : patient))}
      />
    </section>
  )
}

function ClinicalQueuePanel({ canUpdate }: { canUpdate: boolean }) {
  const [arrivals, setArrivals] = useState<EmergencyArrival[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [priority, setPriority] = useState<EmergencyClinicalPriority>('priority')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/v1/reception/arrivals?limit=100')
      const data = await readApiResponse<{ arrivals?: EmergencyArrival[] }>(response)
      const openArrivals = (data.arrivals ?? []).filter((arrival) => arrival.status === 'waiting' || arrival.status === 'in_service')
      setArrivals(openArrivals)
      if (!openArrivals.some((arrival) => arrival.id === selectedId)) setSelectedId(openArrivals[0]?.id ?? '')
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar a fila clínica.')
    }
  }, [selectedId])

  useEffect(() => {
    let active = true
    const loadArrivals = async () => {
      try {
        const response = await fetch('/api/v1/reception/arrivals?limit=100')
        const data = await readApiResponse<{ arrivals?: EmergencyArrival[] }>(response)
        const openArrivals = (data.arrivals ?? []).filter((arrival) => arrival.status === 'waiting' || arrival.status === 'in_service')
        if (!active) return
        setArrivals(openArrivals)
        if (!openArrivals.some((arrival) => arrival.id === selectedId)) setSelectedId(openArrivals[0]?.id ?? '')
        setError('')
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar a fila clínica.')
      }
    }
    void loadArrivals()
    return () => { active = false }
  }, [selectedId])
  const selectedArrival = arrivals.find((arrival) => arrival.id === selectedId)

  async function savePriority(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedArrival) return
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch(`/api/v1/reception/arrivals/${encodeURIComponent(selectedArrival.id)}/clinical-priority`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clinical_priority: priority, reason }),
      })
      const updated = await readApiResponse<EmergencyArrival>(response)
      setArrivals((current) => current.map((arrival) => arrival.id === updated.id ? updated : arrival))
      setReason('')
      setNotice('Prioridade clínica registrada com identificação do profissional e justificativa.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível atualizar a prioridade clínica.')
    } finally { setBusy(false) }
  }

  const priorityLabels: Record<EmergencyClinicalPriority, string> = {
    unassigned: 'Não classificada',
    routine: 'Rotina',
    priority: 'Prioridade',
    urgent: 'Urgente',
  }
  return <section className="patient-list-panel clinical-queue-panel">
    <div className="section-heading"><div><p className="eyebrow">FILA ASSISTENCIAL · CLASSIFICAÇÃO CLÍNICA</p><h2>Prioridade de atendimento</h2><p className="welcome-copy">A classificação é feita e justificada pela equipe clínica; o sistema não atribui risco automaticamente.</p></div><button className="button button-secondary" type="button" onClick={() => void refresh()}>Atualizar fila</button></div>
    {error && <div className="form-message form-message-error" role="alert">{error}</div>}
    {notice && <div className="form-message form-message-success" role="status">{notice}</div>}
    {arrivals.length === 0 ? <div className="history-empty">Nenhuma chegada aguardando atendimento ou em atendimento.</div> : <>
      <div className="collection-list">{arrivals.map((arrival) => <article className="collection-row" key={arrival.id}>
        <div className="collection-row-heading"><strong>{arrival.patient_name}</strong><span className={`work-order-status status-${arrival.clinical_priority}`}>{priorityLabels[arrival.clinical_priority]}</span></div>
        <p>{arrival.reason}</p><ReceptionAllergyAlert status={arrival.allergies_status} />
        <small>{arrival.status === 'waiting' ? 'Aguardando' : 'Em atendimento'} · Chegada {dateTime(arrival.created_at)}{arrival.clinical_priority_updated_by ? ` · Classificada por ${arrival.clinical_priority_updated_by}` : ''}</small>
      </article>)}</div>
      {canUpdate && <form className="account-create-panel" onSubmit={(event) => void savePriority(event)}>
        <div className="field-grid field-grid-three">
          <label className="field"><span className="field-label">Chegada</span><select value={selectedId} onChange={(event) => { setSelectedId(event.target.value); const arrival = arrivals.find((item) => item.id === event.target.value); setPriority(arrival?.clinical_priority ?? 'priority') }}>{arrivals.map((arrival) => <option key={arrival.id} value={arrival.id}>{arrival.patient_name} · {dateTime(arrival.created_at)}</option>)}</select></label>
          <label className="field"><span className="field-label">Classificação clínica</span><select value={priority} onChange={(event) => setPriority(event.target.value as EmergencyClinicalPriority)}><option value="unassigned">Não classificada</option><option value="routine">Rotina</option><option value="priority">Prioridade</option><option value="urgent">Urgente</option></select></label>
          <label className="field"><span className="field-label">Justificativa clínica</span><input required minLength={3} maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        </div>
        <button className="button button-primary" type="submit" disabled={!selectedArrival || busy}>{busy ? 'Salvando…' : 'Registrar classificação'}</button>
      </form>}
    </>}
  </section>
}

function PatientFlowRiskPanel({ patients, canUpdate, onPatientUpdated }: { patients: Patient[]; canUpdate: boolean; onPatientUpdated: (patient: Patient) => void }) {
  const [selectedReference, setSelectedReference] = useState('')
  const [flowType, setFlowType] = useState<'transfer' | 'discharge'>('transfer')
  const [destination, setDestination] = useState({ room: '', bed: '' })
  const [reason, setReason] = useState('')
  const [summary, setSummary] = useState('')
  const [riskDescription, setRiskDescription] = useState('')
  const [riskReason, setRiskReason] = useState('')
  const [riskSeverity, setRiskSeverity] = useState<ClinicalRisk['severity']>('unspecified')
  const [risks, setRisks] = useState<ClinicalRisk[]>([])
  const [flowEvents, setFlowEvents] = useState<PatientFlowEvent[]>([])
  const [allergyEvents, setAllergyEvents] = useState<{ id: number; previous_status: string; previous_details: string; new_status: string; new_details: string; reason: string; actor_name: string; recorded_at: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const activePatients = patients.filter((patient) => patient.active !== false)
  const patient = activePatients.find((item) => item.reference === selectedReference) ?? activePatients[0]

  const patientReferenceForFlow = patient?.reference
  async function loadPatientFlow(reference = patientReferenceForFlow) {
    if (!reference) return
    try {
      const [flowResponse, allergyResponse, riskResponse] = await Promise.all([
        fetch(`/api/v1/nursing/patients/flow-events?patient_reference=${encodeURIComponent(reference)}&limit=20`),
        fetch(`/api/v1/nursing/patients/${encodeURIComponent(reference)}/allergy-history`),
        fetch('/api/v1/nursing/clinical-risks'),
      ])
      const [flowData, allergyData, riskData] = await Promise.all([
        readApiResponse<{ events?: PatientFlowEvent[] }>(flowResponse),
        readApiResponse<{ events?: typeof allergyEvents }>(allergyResponse),
        readApiResponse<{ risks?: ClinicalRisk[] }>(riskResponse),
      ])
      setFlowEvents(flowData.events ?? [])
      setAllergyEvents(allergyData.events ?? [])
      setRisks((riskData.risks ?? []).filter((risk) => risk.risk_type === 'contraindication' && risk.patient_reference === reference))
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar o fluxo e o histórico de riscos.')
    }
  }

  useEffect(() => {
    if (!patientReferenceForFlow) return
    let active = true
    const loadFlow = async () => {
      try {
        const [flowResponse, allergyResponse, riskResponse] = await Promise.all([
          fetch(`/api/v1/nursing/patients/flow-events?patient_reference=${encodeURIComponent(patientReferenceForFlow)}&limit=20`),
          fetch(`/api/v1/nursing/patients/${encodeURIComponent(patientReferenceForFlow)}/allergy-history`),
          fetch('/api/v1/nursing/clinical-risks'),
        ])
        const [flowData, allergyData, riskData] = await Promise.all([
          readApiResponse<{ events?: PatientFlowEvent[] }>(flowResponse),
          readApiResponse<{ events?: typeof allergyEvents }>(allergyResponse),
          readApiResponse<{ risks?: ClinicalRisk[] }>(riskResponse),
        ])
        if (!active) return
        setFlowEvents(flowData.events ?? [])
        setAllergyEvents(allergyData.events ?? [])
        setRisks((riskData.risks ?? []).filter((risk) => risk.risk_type === 'contraindication' && risk.patient_reference === patientReferenceForFlow))
        setError('')
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar o fluxo e o histórico de riscos.')
      }
    }
    void loadFlow()
    return () => { active = false }
  }, [patientReferenceForFlow])

  async function savePatientFlow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!patient) return
    setBusy(true); setError(''); setNotice('')
    try {
      const isTransfer = flowType === 'transfer'
      const response = await fetch(`/api/v1/nursing/patients/${encodeURIComponent(patient.reference)}/${flowType}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isTransfer ? { ...destination, reason } : { reason, summary }),
      })
      const data = await readApiResponse<{ patient: Patient; event: PatientFlowEvent }>(response)
      onPatientUpdated(data.patient)
      setFlowEvents((current) => [data.event, ...current])
      setDestination({ room: '', bed: '' }); setReason(''); setSummary('')
      setNotice(isTransfer ? 'Transferência registrada e leito de destino validado.' : 'Alta registrada; o leito foi liberado e o histórico mantido.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível registrar o fluxo do paciente.')
    } finally { setBusy(false) }
  }

  async function createRisk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!patient) return
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch(`/api/v1/nursing/patients/${encodeURIComponent(patient.reference)}/clinical-risks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: riskDescription, severity: riskSeverity, reason: riskReason }),
      })
      await readApiResponse<ClinicalRisk>(response)
      setRiskDescription(''); setRiskReason(''); setRiskSeverity('unspecified')
      setNotice('Contraindicação registrada com autoria e justificativa.')
      await loadPatientFlow()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível registrar a contraindicação.')
    } finally { setBusy(false) }
  }

  async function resolveRisk(riskId: number | string) {
    if (typeof riskId !== 'number') return
    const resolutionReason = window.prompt('Informe o motivo clínico para resolver esta contraindicação:')
    if (!resolutionReason?.trim()) return
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch(`/api/v1/nursing/clinical-risks/${riskId}/resolve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: resolutionReason }),
      })
      await readApiResponse<ClinicalRisk>(response)
      setNotice('Contraindicação resolvida e ação registrada no histórico.')
      await loadPatientFlow()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível resolver a contraindicação.')
    } finally { setBusy(false) }
  }

  return <section className="patient-list-panel patient-flow-risk-panel">
    <div className="section-heading"><div><p className="eyebrow">GESTÃO DE LEITOS · SEGURANÇA CLÍNICA</p><h2>Fluxo do paciente e central de riscos</h2><p className="welcome-copy">Altas, transferências, alergias e contraindicações são registradas com autoria e histórico.</p></div><span className="module-icon"><ShieldCheck size={20} /></span></div>
    {error && <div className="form-message form-message-error" role="alert">{error}</div>}
    {notice && <div className="form-message form-message-success" role="status">{notice}</div>}
    {activePatients.length === 0 ? <div className="history-empty">Não há pacientes ativos para transferência, alta ou avaliação de riscos.</div> : <>
      <label className="field"><span className="field-label">Paciente internado</span><select value={patient?.reference ?? ''} onChange={(event) => setSelectedReference(event.target.value)}>{activePatients.map((item) => <option key={item.reference} value={item.reference}>{item.name} · {patientLocationLabel(item)}</option>)}</select></label>
      {patient && <PatientAllergyAlert patient={patient} />}
      <div className="psychology-tabs" role="tablist" aria-label="Ações de fluxo do paciente">
        <button className={`psychology-tab ${flowType === 'transfer' ? 'is-active' : ''}`} type="button" role="tab" aria-selected={flowType === 'transfer'} onClick={() => setFlowType('transfer')}>Transferência</button>
        <button className={`psychology-tab ${flowType === 'discharge' ? 'is-active' : ''}`} type="button" role="tab" aria-selected={flowType === 'discharge'} onClick={() => setFlowType('discharge')}>Alta</button>
      </div>
      {canUpdate && <form className="account-create-panel" onSubmit={(event) => void savePatientFlow(event)}>
        {flowType === 'transfer' ? <div className="field-grid field-grid-three">
          <label className="field"><span className="field-label">Novo quarto</span><input required maxLength={20} value={destination.room} onChange={(event) => setDestination((current) => ({ ...current, room: event.target.value }))} /></label>
          <label className="field"><span className="field-label">Novo leito</span><input required maxLength={20} value={destination.bed} onChange={(event) => setDestination((current) => ({ ...current, bed: event.target.value }))} /></label>
          <label className="field"><span className="field-label">Motivo da transferência</span><input required minLength={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        </div> : <>
          <label className="field"><span className="field-label">Motivo da alta</span><input required minLength={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          <label className="field"><span className="field-label">Resumo / orientações de continuidade (opcional)</span><textarea maxLength={2000} value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
          <p className="work-order-privacy">Este registro não substitui sumário clínico, prescrição de alta nem orientações assinadas conforme protocolo institucional.</p>
        </>}
        <button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Registrando…' : flowType === 'transfer' ? 'Registrar transferência' : 'Registrar alta e liberar leito'}</button>
      </form>}
      <section className="patient-list-panel"><div className="section-heading"><div><p className="eyebrow">ALERGIAS E CONTRAINDICAÇÕES</p><h3>Riscos ativos e auditoria</h3></div><span className="module-total">{risks.length + (patient?.allergies_status !== 'none_known' ? 1 : 0)} alertas</span></div>
        {risks.map((risk) => <article className="collection-row" key={risk.id}><div className="collection-row-heading"><strong>Contraindicação · {risk.severity === 'unspecified' ? 'gravidade não especificada' : risk.severity}</strong><span>{risk.description}</span></div><small>Registrada por {risk.actor_name} · {dateTime(risk.created_at)} · Motivo: {risk.reason}</small>{canUpdate && <button className="button button-secondary" type="button" disabled={busy} onClick={() => void resolveRisk(risk.id)}>Registrar resolução</button>}</article>)}
        {patient?.allergies_status === 'known' && <article className="clinical-alert" role="alert"><AlertTriangle size={19} /><div><strong>Alergia conhecida</strong><span>{patient.allergies}</span></div></article>}
        {canUpdate && <form className="account-create-panel" onSubmit={(event) => void createRisk(event)}><div className="field-grid field-grid-three"><label className="field"><span className="field-label">Nova contraindicação</span><input required minLength={3} maxLength={1000} value={riskDescription} onChange={(event) => setRiskDescription(event.target.value)} placeholder="Substância, procedimento ou risco identificado" /></label><label className="field"><span className="field-label">Gravidade registrada</span><select value={riskSeverity} onChange={(event) => setRiskSeverity(event.target.value as ClinicalRisk['severity'])}><option value="unspecified">Não especificada</option><option value="low">Baixa</option><option value="moderate">Moderada</option><option value="high">Alta</option></select></label><label className="field"><span className="field-label">Justificativa / fonte</span><input required minLength={3} maxLength={300} value={riskReason} onChange={(event) => setRiskReason(event.target.value)} /></label></div><button className="button button-primary" type="submit" disabled={busy}>Registrar contraindicação</button></form>}
        {allergyEvents.length > 0 && <details className="patient-risk-audit"><summary>Histórico de alterações de alergia ({allergyEvents.length})</summary><div className="collection-list">{allergyEvents.map((event) => <article className="collection-row" key={event.id}><div className="collection-row-heading"><strong>{event.previous_status} → {event.new_status}</strong><time>{dateTime(event.recorded_at)}</time></div><p>{event.previous_details || 'Sem detalhe anterior'} → {event.new_details || 'Sem detalhe registrado'}</p><small>{event.actor_name} · {event.reason}</small></article>)}</div></details>}
      </section>
      {flowEvents.length > 0 && <section className="patient-list-panel"><div className="section-heading"><div><p className="eyebrow">MOVIMENTAÇÃO ASSISTENCIAL</p><h3>Histórico de transferências e altas</h3></div><span className="module-total">{flowEvents.length} eventos</span></div><div className="collection-list">{flowEvents.map((event) => <article className="collection-row" key={event.id}><div className="collection-row-heading"><strong>{event.event_type === 'transfer' ? `Transferência · Qto ${event.previous_room}, leito ${event.previous_bed} → Qto ${event.next_room}, leito ${event.next_bed}` : `Alta · Qto ${event.previous_room}, leito ${event.previous_bed}`}</strong><time>{dateTime(event.occurred_at)}</time></div><p>{event.reason}</p>{event.summary && <p>{event.summary}</p>}<small>Registrado por {event.actor_name}</small></article>)}</div></section>}
    </>}
  </section>
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

function VitalHistory({ records, patients, patientReference, metric, onMetric, onVoid }: { records: VitalRecordData[]; patients: Patient[]; patientReference?: string; metric: string; onMetric: (value: string) => void; onVoid?: (id: number) => void }) {
  const config = vitalMetrics.find((item) => item.key === metric) ?? vitalMetrics[0]
  const chartRecords = patientReference ? records.filter((record) => record.patient_reference === patientReference) : []
  const points = chartRecords.slice().reverse().flatMap((record, index) => {
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
  return <section className="vital-history"><div className="history-heading"><div><p className="eyebrow">CONSULTA DE REGISTROS</p><h2>Histórico de sinais vitais</h2><p className="welcome-copy">Confira os valores registrados, horário e profissional responsável.</p></div><label className="history-metric"><span className="field-label">Indicador</span><select value={metric} onChange={(event) => onMetric(event.target.value)}>{vitalMetrics.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label></div>{!patientReference ? <div className="history-empty"><Activity size={20} /><span>Selecione um paciente para visualizar a evolução no gráfico.</span></div> : points.length ? <><div className="history-chart"><svg viewBox="0 0 100 100" role="img" aria-label={`Gráfico de ${config.label}`} preserveAspectRatio="none"><line x1="5" y1="90" x2="95" y2="90" className="chart-axis" />{points.length > 1 && <polyline points={line} className="chart-line" />}{coordinates.map((point) => <circle key={`${point.label}-${point.index}`} cx={point.x} cy={point.y} r="2.1" className="chart-point"><title>{point.label}: {point.value} {config.unit}</title></circle>)}</svg></div><div className="history-values">{coordinates.slice(-5).reverse().map((point) => <span key={`${point.label}-${point.index}`}><strong>{point.value} {config.unit}</strong><small>{point.label}</small></span>)}</div></> : <div className="history-empty"><Activity size={20} /><span>Não há valores deste indicador no período consultado.</span></div>}{records.length > 0 && <div className="collection-list"><h3>Coletas recentes</h3>{records.map((record) => { const patient = patients.find((item) => item.reference === record.patient_reference); return <article className="collection-row" key={record.id}><div className="collection-row-heading"><strong>{patient?.name ?? 'Paciente'} · Qto {patient?.room ?? '—'} · Leito {patient?.bed ?? '—'}</strong><time>{dateTime(record.recorded_at)}</time></div><div className="collection-values">{[['Saturação', record.values.saturation && `${record.values.saturation}%`], ['Pressão', record.values.pressure], ['FC', record.values.heartRate && `${record.values.heartRate} bpm`], ['FR', record.values.respiratoryRate && `${record.values.respiratoryRate} rpm`], ['Glicose', record.values.glucose && `${record.values.glucose} ${record.glucose_unit}`], ['Dor', record.values.pain], ['Oxigênio', record.values.oxygenStatus], ['Lesões', record.values.wounds], ['Exame', record.values.examName]].filter(([, value]) => value).map(([label, value]) => <span key={label}><small>{label}</small><strong>{value}</strong></span>)}</div><small className="collection-actor">Registrado por {record.actor_name}</small>{onVoid && <button className="button button-danger" type="button" onClick={() => onVoid(record.id)}>Arquivar registro incorreto</button>}</article> })}</div>}</section>
}

function VitalExtraDetails({ records, patientReference }: { records: VitalRecordData[]; patientReference: string }) {
  const labels: [keyof RecordFields, string][] = [['venousCondition', 'Tipo de acesso'], ['urine', 'Eliminação urinária'], ['bowelTube', 'Eliminação intestinal']]
  const rows = records.filter((record) => !patientReference || record.patient_reference === patientReference).map((record) => {
    const fields = labels.filter(([key]) => record.values[key]).map(([key, label]) => [label, record.values[key]] as [string, string])
    if (record.values.bowel) fields.push(['Eliminação intestinal (registro anterior)', record.values.bowel])
    return { record, fields }
  }).filter((item) => item.fields.length)
  if (!rows.length) return null
  return <section className="vital-extra-details"><div className="section-heading"><div><p className="eyebrow">ACESSOS E ELIMINAÇÕES</p><h2>Registros relacionados</h2></div></div><div className="vital-extra-list">{rows.map(({ record, fields }) => <article className="vital-extra-card" key={record.id}><div><strong>{record.actor_name}</strong><time>{dateTime(record.recorded_at)}</time></div><div className="collection-values">{fields.map(([label, value]) => <span key={label}><small>{label}</small><strong>{value}</strong></span>)}</div></article>)}</div></section>
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

  useEffect(() => {
    let active = true
    const loadInitialUsers = async () => {
      try {
        const response = await fetch('/api/v1/access/users')
        if (!response.ok) throw new Error('Não foi possível carregar usuários.')
        const data = await response.json() as { users: Account[] }
        if (active) {
          setUsers(data.users)
          setStatus('ready')
        }
      } catch {
        if (active) setStatus('unavailable')
      }
    }
    void loadInitialUsers()
    return () => { active = false }
  }, [])

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
    <section className="permission-map"><div className="panel-heading"><div><p className="eyebrow">CONTROLE DE ACESSO</p><h2>Acesso individual por módulo</h2></div><LockKeyhole size={18} /></div><div className="permission-legend"><span><strong>Consultar</strong> abrir registros autorizados</span><span><strong>Criar</strong> adicionar registros no módulo</span><span><strong>Alterar</strong> modificar registros autorizados</span><span><strong>Excluir</strong> arquivar registros clínicos com justificativa</span><span><strong>Administrar</strong> usuários e permissões</span></div></section>
  </section>
}

function AccountRow({ user, onUpdate, onReset }: { user: Account; onUpdate: (user: Account, body: Record<string, unknown>, success: string) => Promise<void>; onReset: (user: Account) => Promise<void> }) {
  const [editModules, setEditModules] = useState(user.modules.filter((module) => module !== 'admin'))
  const [editPermissions, setEditPermissions] = useState(user.permissions)
  const [expanded, setExpanded] = useState(false)
  return <article className="account-row"><div className="account-row-main"><div className="user-name"><span className="avatar avatar-small">{user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span><strong>{user.name}<small>{user.username}{user.must_change_password ? ' · troca de senha pendente' : ''}{!user.mfa_enabled ? ' · MFA pendente' : ''}</small></strong></div><div className="user-modules">{user.modules.map((module) => <span key={module}>{moduleLabels[module] ?? module}</span>)}</div><span className={`account-state ${user.active ? 'account-active' : 'account-disabled'}`}><span className="status-dot" />{user.active ? 'Ativa' : 'Inativa'}</span><button className="user-action" type="button" onClick={() => void onUpdate(user, { active: !user.active }, `Conta ${user.active ? 'desativada' : 'ativada'}.`)}>{user.active ? 'Desativar' : 'Ativar'}</button><button className="user-action" type="button" onClick={() => void onReset(user)}>Redefinir senha/MFA</button><button className="user-action" type="button" onClick={() => { setEditModules(user.modules.filter((module) => module !== 'admin')); setEditPermissions(user.permissions); setExpanded((value) => !value) }}>{expanded ? 'Fechar acessos' : 'Editar acessos'}</button></div>{expanded && <div className="account-access-editor"><p className="field-label">Módulos permitidos</p><div className="module-permission-grid">{accessModules.map(([module, label]) => <label className="checkbox-label" key={module}><input type="checkbox" checked={editModules.includes(module)} onChange={() => setEditModules((current) => current.includes(module) ? current.filter((item) => item !== module) : [...current, module])} /><span>{label}</span></label>)}</div><fieldset className="module-permission-fieldset"><legend>Permitir arquivamento de registros clínicos</legend>{(['patients', 'nursing', 'nutrition', 'reception'] as const).map((module) => <label className="checkbox-label" key={module}><input type="checkbox" disabled={!editModules.includes(module)} checked={Boolean(editPermissions[module]?.includes('excluir'))} onChange={() => setEditPermissions((current) => ({ ...current, [module]: current[module]?.includes('excluir') ? current[module].filter((permission) => permission !== 'excluir') : [...(current[module] ?? ['consultar', 'criar', 'alterar']), 'excluir'] }))} /><span>{moduleLabels[module]}</span></label>)}</fieldset><button className="button button-secondary" type="button" disabled={!editModules.length} onClick={() => void onUpdate(user, { modules: editModules, permissions: Object.fromEntries(editModules.map((module) => [module, editPermissions[module] ?? ['consultar', 'criar', 'alterar']])) }, 'Acessos atualizados e registrados na auditoria.')}>Salvar acessos</button></div>}</article>
}

function NutritionPage() {
  const [patients, setPatients] = useState<Patient[]>([])
  const [records, setRecords] = useState<NutritionRecordData[]>([])
  const [recordsTotal, setRecordsTotal] = useState(0)
  const [recordsOffset, setRecordsOffset] = useState(0)
  const [selectedPatient, setSelectedPatient] = useState('')
  const [selectedPatientRecord, setSelectedPatientRecord] = useState<NutritionRecordData | null>(null)
  const [recordPatientFilter, setRecordPatientFilter] = useState('')
  const [patientQuery, setPatientQuery] = useState('')
  const [recordQuery, setRecordQuery] = useState('')
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [form, setForm] = useState({ assessment_date: new Date().toLocaleDateString('en-CA'), weight_kg: '', height_cm: '', diet_type: '', allergies: '', allergies_status: 'unknown' as NonNullable<Patient['allergies_status']>, restrictions: '', appetite: '', hydration: '', notes: '', fasting_at: '', fasting_reason: '' })
  const loadRecords = useCallback(async (patientReference = recordPatientFilter, query = recordQuery, offset = 0) => {
    setRecordsLoading(true)
    try {
      const params = new URLSearchParams({ limit: '25', offset: String(offset) })
      if (patientReference) params.set('patient_reference', patientReference)
      if (query.trim()) params.set('q', query.trim())
      const response = await fetch(`/api/v1/nursing/nutrition?${params}`)
      const data = await readApiResponse<{ records?: NutritionRecordData[]; total?: number }>(response)
      setRecords(data.records ?? [])
      setRecordsTotal(data.total ?? 0)
      setRecordsOffset(offset)
      setError('')
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar os registros.') }
    finally { setRecordsLoading(false) }
  }, [recordPatientFilter, recordQuery])
  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/v1/nursing/patients')
        const data = await readApiResponse<{ patients?: Patient[] }>(response)
        setPatients(data.patients ?? [])
      } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar pacientes.') }
      await loadRecords()
    })()
  }, [loadRecords])
  useEffect(() => {
    if (!selectedPatient) return
    let current = true
    fetch(`/api/v1/nursing/nutrition?patient_reference=${encodeURIComponent(selectedPatient)}&limit=1`)
      .then((response) => readApiResponse<{ records?: NutritionRecordData[] }>(response))
      .then((data) => { if (current) setSelectedPatientRecord(data.records?.[0] ?? null) })
      .catch((loadError) => { if (current) setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar a última avaliação.') })
    return () => { current = false }
  }, [selectedPatient])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedPatient) { setError('Selecione um paciente.'); return }
    setBusy(true); setError(''); setMessage('')
    try {
      const response = await fetch('/api/v1/nursing/nutrition', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, fasting_at: form.fasting_at ? new Date(form.fasting_at).toISOString() : null, patient_reference: selectedPatient }) })
      const savedRecord = await readApiResponse<NutritionRecordData>(response)
      setSelectedPatientRecord(savedRecord)
      setPatients((current) => current.map((patient) => patient.reference === selectedPatient ? { ...patient, allergies: form.allergies, allergies_status: form.allergies_status } : patient))
      setForm({ ...form, weight_kg: '', height_cm: '', diet_type: '', restrictions: '', appetite: '', hydration: '', notes: '', fasting_at: '', fasting_reason: '' })
      setMessage('Avaliação nutricional registrada.')
      await loadRecords(recordPatientFilter, recordQuery, 0)
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Falha ao salvar a avaliação.') }
    finally { setBusy(false) }
  }
  const filtered = patients.filter((patient) => `${patient.name} ${patient.room} ${patient.bed}`.toLocaleLowerCase('pt-BR').includes(patientQuery.trim().toLocaleLowerCase('pt-BR')))
  const patientName = (reference: string) => { const patient = patients.find((item) => item.reference === reference); return patient ? `${patient.name} · Quarto ${patient.room}, leito ${patient.bed}` : 'Paciente' }
  const nutritionPrintRows: PrintRow[] = records.map((record) => ({ id: String(record.id), date: record.assessment_date, title: patientName(record.patient_reference), fields: [['Peso', record.weight_kg ? `${record.weight_kg} kg` : ''], ['Altura', record.height_cm ? `${record.height_cm} cm` : ''], ['Dieta', record.diet_type], ['Alergias', record.allergies], ['Restrições', record.restrictions], ['Jejum', record.fasting_at ? `${dateTime(record.fasting_at)} · ${record.fasting_reason || ''}` : ''], ['Aceitação', record.appetite], ['Hidratação', record.hydration], ['Observações', record.notes], ['Profissional', record.actor_name]] }))
  return <section className="nutrition-page page-enter">
    <div className="page-title-row"><div><p className="eyebrow">MÓDULO · NUTRIÇÃO</p><h1>Acompanhamento nutricional</h1><p className="welcome-copy">Registre avaliação, dieta prescrita, alergias, restrições e aceitação alimentar.</p></div><span className="module-icon module-icon-nutrition"><HeartPulse size={24} /></span></div>
    {message && <div className="form-message form-message-success" role="status">{message}</div>}{error && <div className="form-message form-message-error" role="alert">{error}</div>}
    <PrintSelectionPanel title="Avaliações nutricionais" rows={nutritionPrintRows} />
    <form className="nutrition-form" onSubmit={(event) => void submit(event)}>
      <div className="section-heading"><div><p className="eyebrow">NOVA AVALIAÇÃO</p><h2>Dados nutricionais</h2></div></div>
      <label className="field"><span className="field-label">Localizar paciente por nome, quarto ou leito</span><span className="search-input-wrap"><Search size={17} /><input type="search" value={patientQuery} onChange={(event) => { setPatientQuery(event.target.value); setSelectedPatient(''); setSelectedPatientRecord(null) }} placeholder="Digite para pesquisar" /></span></label>
      <label className="field nutrition-patient-select"><span className="field-label">Paciente</span><select required value={selectedPatient} onChange={(event) => { const reference = event.target.value; const patient = patients.find((item) => item.reference === reference); setSelectedPatient(reference); setSelectedPatientRecord(null); setForm((current) => ({ ...current, allergies: patient?.allergies ?? '', allergies_status: patient?.allergies_status ?? 'unknown' })) }}><option value="">Selecione o paciente</option>{filtered.map((patient) => <option key={patient.reference} value={patient.reference}>{patient.name} · {patient.room && patient.bed ? `Quarto ${patient.room}, leito ${patient.bed}` : 'sem acomodação'}</option>)}</select></label>
      <PatientAllergyAlert patient={patients.find((patient) => patient.reference === selectedPatient)} />
      {selectedPatientRecord && <div className="nutrition-context-card"><strong>Última avaliação deste paciente</strong><span>{new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${selectedPatientRecord.assessment_date}T00:00:00Z`))} · {selectedPatientRecord.diet_type || 'Dieta não informada'}</span>{selectedPatientRecord.fasting_at && new Date(selectedPatientRecord.fasting_at) >= new Date() && <span className="fasting-alert">Jejum programado: {dateTime(selectedPatientRecord.fasting_at)} · {selectedPatientRecord.fasting_reason || 'sem observação'}</span>}</div>}
      <div className="field-grid field-grid-three"><label className="field"><span className="field-label">Data da avaliação</span><input type="date" required value={form.assessment_date} onChange={(event) => setForm({ ...form, assessment_date: event.target.value })} /></label><label className="field"><span className="field-label">Peso</span><span className="input-with-unit"><input inputMode="decimal" value={form.weight_kg} onChange={(event) => setForm({ ...form, weight_kg: event.target.value })} placeholder="Ex.: 68,5" /><span className="unit-label">kg</span></span></label><label className="field"><span className="field-label">Altura</span><span className="input-with-unit"><input inputMode="decimal" value={form.height_cm} onChange={(event) => setForm({ ...form, height_cm: event.target.value })} placeholder="Ex.: 172" /><span className="unit-label">cm</span></span></label></div>
      <div className="field-grid field-grid-three"><label className="field"><span className="field-label">Tipo de dieta</span><select value={form.diet_type} onChange={(event) => setForm({ ...form, diet_type: event.target.value })}><option value="">Selecione</option><option>Geral</option><option>Branda</option><option>Pastosa</option><option>Líquida</option><option>Enteral</option><option>Jejum</option><option>Outra</option></select></label><label className="field"><span className="field-label">Aceitação alimentar</span><select value={form.appetite} onChange={(event) => setForm({ ...form, appetite: event.target.value })}><option value="">Selecione</option><option value="normal">Normal</option><option value="reduced">Reduzida</option><option value="poor">Baixa</option><option value="increased">Aumentada</option></select></label><label className="field"><span className="field-label">Hidratação</span><select value={form.hydration} onChange={(event) => setForm({ ...form, hydration: event.target.value })}><option value="">Selecione</option><option value="adequate">Adequada</option><option value="low">Baixa</option><option value="assisted">Necessita auxílio</option></select></label></div>
      <div className="field-grid field-grid-two"><label className="field"><span className="field-label">Status das alergias do paciente</span><select value={form.allergies_status} onChange={(event) => setForm({ ...form, allergies_status: event.target.value as NonNullable<Patient['allergies_status']>, allergies: event.target.value === 'known' ? form.allergies : '' })}><option value="unknown">Não verificado / desconhecido</option><option value="none_known">Sem alergias conhecidas · confirmado</option><option value="known">Alergia conhecida</option></select></label>{form.allergies_status === 'known' && <label className="field"><span className="field-label">Alergias conhecidas (inclusive alimentares)</span><textarea required maxLength={500} value={form.allergies} onChange={(event) => setForm({ ...form, allergies: event.target.value })} placeholder="Descreva substâncias/alimentos e reações conhecidas" /></label>}<label className="field"><span className="field-label">Restrições alimentares</span><textarea maxLength={500} value={form.restrictions} onChange={(event) => setForm({ ...form, restrictions: event.target.value })} placeholder="Restrições e orientações dietéticas" /></label></div>
      <div className="fasting-plan-panel"><div><strong>Jejum programado</strong><small>Este registro será compartilhado com a enfermagem.</small></div><div className="field-grid field-grid-two"><label className="field"><span className="field-label">Data e horário</span><input type="datetime-local" value={form.fasting_at} onChange={(event) => setForm({ ...form, fasting_at: event.target.value })} /></label><label className="field"><span className="field-label">Motivo / observação</span><input maxLength={500} value={form.fasting_reason} onChange={(event) => setForm({ ...form, fasting_reason: event.target.value })} placeholder="Informação da equipe responsável" /></label></div></div>
      <label className="field"><span className="field-label">Evolução e observações</span><textarea maxLength={3000} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Registro da avaliação e conduta nutricional" /></label>
      <div className="patient-form-actions"><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Registrar avaliação'} <ArrowRight size={16} /></button></div>
    </form>
    <section className="patient-list-panel nutrition-history-panel">
      <div className="section-heading"><div><p className="eyebrow">HISTÓRICO CLÍNICO</p><h2>Avaliações nutricionais <span className="module-total">{recordsTotal}</span></h2><p className="welcome-copy">Busca e paginação aplicadas no servidor; a impressão acompanha a página exibida.</p></div><button className="button button-secondary" type="button" onClick={() => void loadRecords(recordPatientFilter, recordQuery, recordsOffset)} disabled={recordsLoading}>{recordsLoading ? 'Atualizando…' : 'Atualizar histórico'}</button></div>
      <form className="nutrition-history-filters" onSubmit={(event) => { event.preventDefault(); void loadRecords(recordPatientFilter, recordQuery, 0) }}>
        <label className="field"><span className="field-label">Filtrar por paciente</span><select value={recordPatientFilter} onChange={(event) => setRecordPatientFilter(event.target.value)}><option value="">Todos os pacientes</option>{patients.map((patient) => <option key={patient.reference} value={patient.reference}>{patient.name} · {patientLocationLabel(patient)}</option>)}</select></label>
        <label className="field"><span className="field-label">Buscar paciente, dieta, alergias ou orientação</span><span className="search-input-wrap"><Search size={17} /><input type="search" value={recordQuery} onChange={(event) => setRecordQuery(event.target.value)} placeholder="Digite para pesquisar" /></span></label>
        <button className="button button-primary" type="submit" disabled={recordsLoading}><Search size={15} /> Pesquisar</button>
        <button className="button button-secondary" type="button" disabled={recordsLoading || (!recordPatientFilter && !recordQuery)} onClick={() => { setRecordPatientFilter(''); setRecordQuery(''); void loadRecords('', '', 0) }}>Limpar filtros</button>
      </form>
      {recordsLoading ? <div className="history-empty">Carregando histórico…</div> : records.length ? <>
        <div className="nutrition-record-list">{records.map((record) => <article className="nutrition-record-card" key={record.id}><div><h3>{patientName(record.patient_reference)}</h3><p>{new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${record.assessment_date}T00:00:00Z`))} · {record.diet_type || 'Dieta não informada'}</p>{record.weight_kg && <small>Peso: {record.weight_kg} kg</small>}{record.allergies && <small>Alergias: {record.allergies}</small>}{record.restrictions && <small>Restrições: {record.restrictions}</small>}{record.fasting_at && <small className="fasting-alert">Jejum programado: {dateTime(record.fasting_at)} · {record.fasting_reason || 'sem observação'}</small>}{record.notes && <small>{record.notes}</small>}</div><div className="nutrition-record-actions"><span className="nutrition-author">{record.actor_name}</span><button className="button button-danger" type="button" onClick={async () => { const reason = window.prompt('Motivo para corrigir/remover esta avaliação (o registro será preservado na auditoria):'); if (!reason?.trim()) return; try { const response = await fetch(`/api/v1/nursing/nutrition/${record.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: reason.trim() }) }); await readApiResponse(response); await loadRecords(recordPatientFilter, recordQuery, recordsOffset) } catch (archiveError) { setError(archiveError instanceof Error ? archiveError.message : 'Não foi possível arquivar a avaliação.') } }}>Arquivar</button></div></article>)}</div>
        <div className="pharmacy-ledger-pagination"><span>{recordsOffset + 1}–{Math.min(recordsOffset + records.length, recordsTotal)} de {recordsTotal}</span><div><button className="button button-secondary" type="button" disabled={recordsLoading || recordsOffset === 0} onClick={() => void loadRecords(recordPatientFilter, recordQuery, Math.max(0, recordsOffset - 25))}>Anterior</button><button className="button button-secondary" type="button" disabled={recordsLoading || recordsOffset + records.length >= recordsTotal} onClick={() => void loadRecords(recordPatientFilter, recordQuery, recordsOffset + 25)}>Próxima</button></div></div>
      </> : <div className="history-empty">Nenhuma avaliação corresponde aos filtros atuais.</div>}
    </section>
  </section>
}

type XrayStatus = 'requested' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
type XrayRequest = { id: number; patient_reference: string; exam_label: string; status: XrayStatus; result: string; result_recorded_by: string; result_recorded_at: string | null; created_at: string }

const xrayStatuses: Record<XrayStatus, string> = {
  requested: 'Solicitado',
  scheduled: 'Agendado',
  in_progress: 'Em execução',
  completed: 'Concluído',
  cancelled: 'Cancelado',
}

function XrayPage({ user }: { user: AuthUser }) {
  const [patients, setPatients] = useState<Patient[]>([])
  const [requests, setRequests] = useState<XrayRequest[]>([])
  const [patientSearch, setPatientSearch] = useState('')
  const [patientReference, setPatientReference] = useState('')
  const [examLabel, setExamLabel] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'active' | 'all' | XrayStatus>('active')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [updating, setUpdating] = useState<number | null>(null)
  const [resultDrafts, setResultDrafts] = useState<Record<number, string>>({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const canUpdate = user.permissions.xray?.includes('alterar') ?? false

  async function loadData() {
    setLoading(true)
    try {
      const [patientResponse, requestResponse] = await Promise.all([
        fetch('/api/v1/nursing/patients'),
        fetch('/api/v1/xray/requests'),
      ])
      const [patientData, requestData] = await Promise.all([
        readApiResponse<{ patients?: Patient[] }>(patientResponse),
        readApiResponse<{ requests?: XrayRequest[] }>(requestResponse),
      ])
      setPatients(patientData.patients ?? [])
      setRequests(requestData.requests ?? [])
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar os dados de Raio X.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    const loadXrayData = async () => {
      setLoading(true)
      try {
        const [patientResponse, requestResponse] = await Promise.all([
          fetch('/api/v1/nursing/patients'),
          fetch('/api/v1/xray/requests'),
        ])
        const [patientData, requestData] = await Promise.all([
          readApiResponse<{ patients?: Patient[] }>(patientResponse),
          readApiResponse<{ requests?: XrayRequest[] }>(requestResponse),
        ])
        if (!active) return
        setPatients(patientData.patients ?? [])
        setRequests(requestData.requests ?? [])
        setError('')
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar os dados de Raio X.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadXrayData()
    return () => { active = false }
  }, [user.id])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/v1/xray/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_reference: patientReference, exam_label: examLabel.trim() }),
      })
      const data = await readApiResponse<XrayRequest>(response)
      setRequests((current) => [data, ...current])
      setPatientReference('')
      setPatientSearch('')
      setExamLabel('')
      setNotice('Exame incluído na fila de Raio X.')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Falha ao solicitar o exame.')
    } finally {
      setSaving(false)
    }
  }

  async function updateStatus(request: XrayRequest, status: XrayStatus) {
    setUpdating(request.id)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`/api/v1/xray/requests/${request.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const updated = await readApiResponse<XrayRequest>(response)
      setRequests((current) => current.map((item) => item.id === updated.id ? updated : item))
      setNotice(`Exame atualizado: ${xrayStatuses[updated.status]}.`)
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Falha ao atualizar o exame.')
    } finally {
      setUpdating(null)
    }
  }

  async function saveResult(request: XrayRequest) {
    const result = (resultDrafts[request.id] ?? '').trim()
    if (result.length < 3) return
    setUpdating(request.id); setError(''); setNotice('')
    try {
      const response = await fetch(`/api/v1/xray/requests/${request.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result }),
      })
      const updated = await readApiResponse<XrayRequest>(response)
      setRequests((current) => current.map((item) => item.id === updated.id ? updated : item))
      setResultDrafts((current) => { const next = { ...current }; delete next[request.id]; return next })
      setNotice('Resultado registrado na solicitação do exame.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível registrar o resultado.')
    } finally { setUpdating(null) }
  }

  const activeCount = requests.filter((request) => request.status === 'requested' || request.status === 'scheduled' || request.status === 'in_progress').length
  const filteredPatients = patients.filter((patient) => `${patient.name} ${patient.room} ${patient.bed}`.toLocaleLowerCase('pt-BR').includes(patientSearch.trim().toLocaleLowerCase('pt-BR')))
  const visibleRequests = requests.filter((request) => {
    const matchesStatus = filter === 'all' || (filter === 'active'
      ? request.status === 'requested' || request.status === 'scheduled' || request.status === 'in_progress'
      : request.status === filter)
    const patient = patients.find((item) => item.reference === request.patient_reference)
    const searchable = `${patient?.name ?? ''} ${patient?.room ?? ''} ${patient?.bed ?? ''} ${request.exam_label}`.toLocaleLowerCase('pt-BR')
    return matchesStatus && searchable.includes(query.trim().toLocaleLowerCase('pt-BR'))
  })
  const patientName = (reference: string) => {
    const patient = patients.find((item) => item.reference === reference)
    return patient ? `${patient.name} · ${patientLocationLabel(patient)}` : 'Paciente não localizado'
  }

  return <section className="xray-page page-enter">
    <div className="page-title-row"><div><p className="eyebrow">ROTINA OPERACIONAL · RAIO X</p><h1>Fila de exames</h1><p className="welcome-copy">Registre solicitações e acompanhe cada exame até sua conclusão.</p></div><span className="module-icon module-icon-xray"><Activity size={23} /></span></div>
    <div className="hygiene-summary" aria-label="Resumo da fila de Raio X"><article><strong>{requests.length}</strong><span>Total de solicitações</span></article><article><strong>{activeCount}</strong><span>Exames ativos</span></article><article><strong>{requests.filter((request) => request.status === 'in_progress').length}</strong><span>Em execução</span></article></div>
    {error && <div className="form-message form-message-error" role="alert">{error}</div>}
    {notice && <div className="form-message form-message-success" role="status">{notice}</div>}
    <form className="hygiene-panel" onSubmit={(event) => void submit(event)}>
      <div className="section-heading"><div><p className="eyebrow">NOVO EXAME</p><h2>Adicionar à fila</h2></div></div>
      <div className="field-grid field-grid-two">
        <label className="field"><span className="field-label">Buscar paciente por nome, quarto ou leito</span><input type="search" value={patientSearch} onChange={(event) => { setPatientSearch(event.target.value); setPatientReference('') }} placeholder="Digite para filtrar pacientes" /></label>
        <label className="field"><span className="field-label">Paciente</span><select required value={patientReference} onChange={(event) => { setPatientReference(event.target.value); const selected = patients.find((patient) => patient.reference === event.target.value); if (selected) setPatientSearch(`${selected.name} · ${patientLocationLabel(selected)}`) }}><option value="">Selecione um paciente</option>{filteredPatients.map((patient) => <option key={patient.reference} value={patient.reference}>{patient.name} · {patientLocationLabel(patient)}</option>)}</select></label>
        <label className="field xray-field-wide"><span className="field-label">Exame solicitado</span><input required minLength={2} maxLength={80} value={examLabel} onChange={(event) => setExamLabel(event.target.value)} placeholder="Ex.: radiografia de tórax" /></label>
      </div>
      <PatientAllergyAlert patient={patients.find((patient) => patient.reference === patientReference)} />
      <p className="work-order-privacy">Registre somente o nome do exame neste campo. Não inclua diagnóstico ou dados clínicos adicionais.</p>
      <button className="button button-primary" type="submit" disabled={saving || !patients.length}>{saving ? 'Registrando…' : 'Solicitar exame'} <ArrowRight size={16} /></button>
    </form>
    <section className="patient-list-panel xray-queue-panel">
      <div className="section-heading"><div><p className="eyebrow">PAINEL OPERACIONAL</p><h2>Solicitações <span className="module-total">{visibleRequests.length}</span></h2></div><button className="button button-secondary" type="button" onClick={() => void loadData()} disabled={loading}>{loading ? 'Atualizando…' : 'Atualizar fila'}</button></div>
      <div className="service-tabs" role="tablist" aria-label="Filtrar exames por situação">
        {([
          ['active', 'Ativos'],
          ['all', 'Todos'],
          ...Object.entries(xrayStatuses),
        ] as [typeof filter, string][]).map(([value, label]) => <button className={`psychology-tab ${filter === value ? 'is-active' : ''}`} type="button" role="tab" aria-selected={filter === value} key={value} onClick={() => setFilter(value)}>{label}{value === 'active' && <span>{activeCount}</span>}</button>)}
      </div>
      <label className="field xray-search"><span className="field-label">Buscar por paciente, quarto, leito ou exame</span><span className="search-input-wrap"><Search size={17} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Digite para localizar um exame" /></span></label>
      {loading ? <div className="history-empty">Carregando fila de exames…</div> : visibleRequests.length ? <div className="xray-request-list">{visibleRequests.map((request) => <article className="xray-request-card" key={request.id}>
        <div className="xray-request-main"><div><h3>{patientName(request.patient_reference)}</h3><p>{request.exam_label}</p><time>{dateTime(request.created_at)}</time></div><span className={`work-order-status status-${request.status === 'requested' ? 'open' : request.status === 'scheduled' ? 'in_progress' : request.status === 'in_progress' ? 'in_progress' : request.status === 'completed' ? 'completed' : 'cancelled'}`}>{xrayStatuses[request.status]}</span></div>
        {request.result && <div className="xray-result"><strong>Resultado registrado</strong><p>{request.result}</p><small>{request.result_recorded_by}{request.result_recorded_at ? ` · ${dateTime(request.result_recorded_at)}` : ''}</small></div>}
        {canUpdate && <form className="xray-result-form" onSubmit={(event) => { event.preventDefault(); void saveResult(request) }}><label className="field"><span className="field-label">{request.result ? 'Atualizar resultado' : 'Resultado do exame'}</span><textarea required minLength={3} maxLength={4000} rows={3} value={resultDrafts[request.id] ?? ''} onChange={(event) => setResultDrafts((current) => ({ ...current, [request.id]: event.target.value }))} placeholder="Registre o laudo/resultado conforme fluxo institucional" /></label><button className="button button-secondary" type="submit" disabled={updating === request.id || (resultDrafts[request.id] ?? '').trim().length < 3}>{updating === request.id ? 'Salvando…' : request.result ? 'Atualizar resultado' : 'Salvar resultado'}</button></form>}
        {canUpdate && <label className="field xray-status-control"><span className="field-label">Atualizar situação</span><select value={request.status} disabled={updating === request.id || request.status === 'completed' || request.status === 'cancelled'} onChange={(event) => void updateStatus(request, event.target.value as XrayStatus)}><option value="requested">Solicitado</option><option value="scheduled">Agendado</option><option value="in_progress">Em execução</option><option value="completed">Concluído</option><option value="cancelled">Cancelado</option></select></label>}
      </article>)}</div> : <div className="history-empty"><Activity size={20} /><span>{requests.length ? 'Nenhum exame corresponde a este filtro.' : 'Nenhuma solicitação de exame foi registrada.'}</span></div>}
    </section>
  </section>
}

type PatientOperationModule = 'xray' | 'social'
type PatientOperation = { id: number; patient_reference: string; exam_label?: string; referral_type?: string; status: string; created_at: string }

const socialReferralStatuses: Record<string, string> = {
  open: 'Aberto',
  scheduled: 'Agendado',
  in_progress: 'Em acompanhamento',
  completed: 'Concluído',
  cancelled: 'Cancelado',
}

function PatientOperationsPage({ moduleId, user }: { moduleId: PatientOperationModule; user?: AuthUser }) {
  const isXray = moduleId === 'xray'
  const endpoint = isXray ? '/api/v1/xray/requests' : '/api/v1/social/referrals'
  const [patients, setPatients] = useState<Patient[]>([])
  const [items, setItems] = useState<PatientOperation[]>([])
  const [patientReference, setPatientReference] = useState('')
  const [description, setDescription] = useState('')
  const [socialQuery, setSocialQuery] = useState('')
  const [socialStatus, setSocialStatus] = useState<'all' | keyof typeof socialReferralStatuses>('all')
  const [updatingId, setUpdatingId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let current = true
    Promise.all([fetch('/api/v1/nursing/patients'), fetch(endpoint)]).then(async ([patientResponse, itemResponse]) => {
      const patientData = await patientResponse.json() as { patients?: Patient[]; detail?: string }
      const itemData = await itemResponse.json() as { requests?: PatientOperation[]; referrals?: PatientOperation[]; detail?: string }
      if (!patientResponse.ok) throw new Error(patientData.detail ?? 'Não foi possível carregar o cadastro de pacientes.')
      if (!itemResponse.ok) throw new Error(itemData.detail ?? 'Não foi possível carregar os registros.')
      return { patients: patientData.patients ?? [], items: isXray ? itemData.requests ?? [] : itemData.referrals ?? [] }
    }).then((data) => { if (current) { setPatients(data.patients); setItems(data.items); setError('') } })
      .catch((loadError) => { if (current) setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar os dados.') })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [endpoint, isXray])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('')
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ patient_reference: patientReference, ...(isXray ? { exam_label: description.trim() } : { referral_type: description.trim() }) }) })
      const data = await response.json() as PatientOperation & { detail?: string }
      if (!response.ok) throw new Error(data.detail ?? 'Não foi possível registrar.')
      setItems((current) => [data, ...current]); setDescription(''); setPatientReference(''); setNotice(isXray ? 'Solicitação de exame registrada.' : 'Encaminhamento registrado.')
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : 'Falha ao registrar.') }
    finally { setSaving(false) }
  }
  async function updateSocialReferral(item: PatientOperation, status: keyof typeof socialReferralStatuses) {
    setUpdatingId(item.id); setError(''); setNotice('')
    try {
      const response = await fetch(`/api/v1/social/referrals/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
      const data = await readApiResponse<PatientOperation>(response)
      setItems((current) => current.map((entry) => entry.id === data.id ? data : entry))
      setNotice('Situação do encaminhamento atualizada.')
    } catch (updateError) { setError(updateError instanceof Error ? updateError.message : 'Falha ao atualizar o encaminhamento.') }
    finally { setUpdatingId(null) }
  }
  const patientName = (reference: string) => { const patient = patients.find((item) => item.reference === reference); return patient ? `${patient.name} · ${patient.room && patient.bed ? `Quarto ${patient.room}, leito ${patient.bed}` : 'sem acomodação'}` : 'Paciente não localizado' }
  const visibleItems = isXray ? items : items.filter((item) => (socialStatus === 'all' || item.status === socialStatus) && `${patientName(item.patient_reference)} ${item.referral_type}`.toLocaleLowerCase('pt-BR').includes(socialQuery.trim().toLocaleLowerCase('pt-BR')))
  const canUpdateSocial = user?.permissions.social?.includes('alterar') ?? false
  return <section className="module-page page-enter"><div className="page-title-row"><div><p className="eyebrow">MÓDULO · {isXray ? 'RAIO X' : 'SERVIÇO SOCIAL'}</p><h1>{isXray ? 'Solicitações de exame' : 'Encaminhamentos sociais'}</h1><p className="welcome-copy">Registros vinculados ao cadastro compartilhado de pacientes.</p></div><span className={`module-icon module-icon-${moduleId}`}>{isXray ? <Activity size={23} /> : <UsersRound size={23} />}</span></div>
    {error && <div className="form-message form-message-error" role="alert">{error}</div>}{notice && <div className="form-message form-message-success" role="status">{notice}</div>}
    <form className="work-order-form" onSubmit={(event) => void submit(event)}><div className="section-heading"><div><p className="eyebrow">NOVO REGISTRO</p><h2>{isXray ? 'Solicitar exame' : 'Registrar encaminhamento'}</h2></div></div><div className="field-grid field-grid-two"><label className="field"><span className="field-label">Paciente · quarto · leito</span><select required value={patientReference} onChange={(event) => setPatientReference(event.target.value)}><option value="">Selecione um paciente</option>{patients.map((patient) => <option key={patient.reference} value={patient.reference}>{patient.name} · {patient.room && patient.bed ? `Qto ${patient.room} · Leito ${patient.bed}` : 'sem acomodação'}</option>)}</select></label><label className="field"><span className="field-label">{isXray ? 'Exame solicitado' : 'Tipo de encaminhamento'}</span><input required minLength={2} maxLength={80} value={description} onChange={(event) => setDescription(event.target.value)} placeholder={isXray ? 'Ex.: radiografia de tórax' : 'Ex.: acompanhamento familiar'} /></label></div>{isXray && <PatientAllergyAlert patient={patients.find((patient) => patient.reference === patientReference)} />}<button className="button button-primary" type="submit" disabled={saving || !patients.length}>{saving ? 'Salvando…' : 'Registrar'}</button></form>
    <section className="patient-list-panel"><div className="section-heading"><div><p className="eyebrow">{isXray ? 'HISTÓRICO' : 'ACOMPANHAMENTO'}</p><h2>{isXray ? 'Solicitações recentes' : 'Encaminhamentos sociais'}</h2></div><span className="module-total">{isXray ? items.length : visibleItems.length}</span></div>{!isXray && <div className="psychology-filter-row"><label className="field"><span className="field-label">Buscar paciente ou encaminhamento</span><input value={socialQuery} onChange={(event) => setSocialQuery(event.target.value)} placeholder="Nome ou tipo de acompanhamento" /></label><label className="field"><span className="field-label">Situação</span><select value={socialStatus} onChange={(event) => setSocialStatus(event.target.value as typeof socialStatus)}><option value="all">Todas</option>{Object.entries(socialReferralStatuses).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select></label></div>}{loading ? <div className="history-empty">Carregando registros…</div> : visibleItems.length ? <div className="work-order-list">{visibleItems.map((item) => <article className="work-order-card" key={item.id}><div><h3>{patientName(item.patient_reference)}</h3><p>{isXray ? item.exam_label : item.referral_type}</p></div>{!isXray && canUpdateSocial ? <label className="field xray-status-control"><span className="field-label">Situação</span><select value={item.status} disabled={updatingId === item.id || item.status === 'completed' || item.status === 'cancelled'} onChange={(event) => void updateSocialReferral(item, event.target.value as keyof typeof socialReferralStatuses)}>{Object.entries(socialReferralStatuses).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select></label> : <span>{isXray ? (item.status === 'open' ? 'Aberto' : item.status) : socialReferralStatuses[item.status] ?? item.status}</span>}<time>{dateTime(item.created_at)}</time></article>)}</div> : <div className="history-empty">{items.length ? 'Nenhum encaminhamento corresponde aos filtros.' : 'Nenhum registro encontrado.'}</div>}</section>
  </section>
}

type PsychologyTab = 'triage' | 'encounters'
type PsychologyReferral = { id: number; patient_reference: string; referral_type: string; status: string; priority: 'routine' | 'priority'; created_at: string }
type PsychologyEncounter = { id: number; patient_reference: string; encounter_type: 'intake' | 'follow_up' | 'psychiatry'; objective: string; evolution: string; plan: string; actor_name: string; created_at: string }

const psychologyStatuses: Record<string, string> = {
  open: 'Aguardando triagem',
  scheduled: 'Agendado',
  in_progress: 'Em atendimento',
  completed: 'Concluído',
  cancelled: 'Cancelado',
}

const psychologyEncounterTypes: Record<PsychologyEncounter['encounter_type'], string> = {
  intake: 'Acolhimento inicial',
  follow_up: 'Acompanhamento',
  psychiatry: 'Atendimento psiquiátrico',
}

function PsychologyPage() {
  const [tab, setTab] = useState<PsychologyTab>('triage')
  const [patients, setPatients] = useState<Patient[]>([])
  const [referrals, setReferrals] = useState<PsychologyReferral[]>([])
  const [encounters, setEncounters] = useState<PsychologyEncounter[]>([])
  const [encountersPatient, setEncountersPatient] = useState('')
  const [triagePatientQuery, setTriagePatientQuery] = useState('')
  const [recordPatientQuery, setRecordPatientQuery] = useState('')
  const [triageFilter, setTriageFilter] = useState('')
  const [triagePatient, setTriagePatient] = useState('')
  const [triageType, setTriageType] = useState('Acolhimento')
  const [customTriageType, setCustomTriageType] = useState('')
  const [triagePriority, setTriagePriority] = useState<'routine' | 'priority'>('routine')
  const [recordPatient, setRecordPatient] = useState('')
  const [recordType, setRecordType] = useState<PsychologyEncounter['encounter_type']>('intake')
  const [objective, setObjective] = useState('')
  const [evolution, setEvolution] = useState('')
  const [plan, setPlan] = useState('')
  const [loading, setLoading] = useState(true)
  const [encounterLoadError, setEncounterLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [updatingReferral, setUpdatingReferral] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let current = true
    Promise.all([fetch('/api/v1/nursing/patients'), fetch('/api/v1/psychology/referrals')])
      .then(async ([patientResponse, referralResponse]) => {
        const patientData = await patientResponse.json() as { patients?: Patient[]; detail?: unknown }
        const referralData = await referralResponse.json() as { referrals?: PsychologyReferral[]; detail?: unknown }
        if (!patientResponse.ok) throw new Error(readableApiError(patientData.detail))
        if (!referralResponse.ok) throw new Error(readableApiError(referralData.detail))
        return { patients: patientData.patients ?? [], referrals: referralData.referrals ?? [] }
      })
      .then((data) => {
        if (current) {
          setPatients(data.patients)
          setReferrals(data.referrals)
          setError('')
        }
      })
      .catch((loadError) => {
        if (current) setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar a fila de atendimento.')
      })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [])

  useEffect(() => {
    if (tab !== 'encounters' || !recordPatient) return
    let current = true
    fetch(`/api/v1/psychology/encounters?patient_reference=${encodeURIComponent(recordPatient)}`)
      .then(async (response) => {
        const data = await response.json() as { encounters?: PsychologyEncounter[]; detail?: unknown }
        if (!response.ok) throw new Error(readableApiError(data.detail))
        return data.encounters ?? []
      })
      .then((records) => {
        if (current) {
          setEncounters(records)
          setEncountersPatient(recordPatient)
          setEncounterLoadError('')
        }
      })
      .catch((loadError) => {
        if (current) {
          setEncounterLoadError(loadError instanceof Error ? loadError.message : 'Falha ao carregar o histórico clínico.')
          setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar o histórico clínico.')
        }
      })
    return () => { current = false }
  }, [recordPatient, tab])
  const encountersLoading = Boolean(recordPatient && encountersPatient !== recordPatient && !encounterLoadError)

  const patientName = (reference: string) => {
    const patient = patients.find((patient) => patient.reference === reference)
    return patient ? `${patient.name} · ${patient.room && patient.bed ? `Quarto ${patient.room}, leito ${patient.bed}` : 'sem acomodação'}` : 'Paciente não localizado'
  }
  const filterPatients = (query: string) => patients.filter((patient) =>
    `${patient.name} ${patient.room} ${patient.bed}`.toLocaleLowerCase('pt-BR')
      .includes(query.trim().toLocaleLowerCase('pt-BR')),
  )
  const filteredTriagePatients = filterPatients(triagePatientQuery)
  const filteredRecordPatients = filterPatients(recordPatientQuery)
  const visibleReferrals = referrals.filter((referral) => {
    const patient = patientName(referral.patient_reference)
    const matchesSearch = `${patient} ${referral.referral_type}`.toLocaleLowerCase('pt-BR')
      .includes(triageFilter.trim().toLocaleLowerCase('pt-BR'))
    return matchesSearch
  })

  async function createReferral(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    const referralType = triageType === 'Outro' ? customTriageType.trim() : triageType
    try {
      const response = await fetch('/api/v1/psychology/referrals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_reference: triagePatient, referral_type: referralType, priority: triagePriority }),
      })
      const data = await response.json() as PsychologyReferral & { detail?: unknown }
      if (!response.ok) throw new Error(readableApiError(data.detail))
      setReferrals((current) => [data, ...current])
      setTriagePatient('')
      setTriageType('Acolhimento')
      setCustomTriageType('')
      setTriagePriority('routine')
      setNotice('Encaminhamento incluído na fila.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Falha ao registrar o encaminhamento.')
    } finally {
      setSaving(false)
    }
  }

  async function updateReferral(referralId: number, changes: { status?: string; priority?: string }) {
    setUpdatingReferral(referralId)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`/api/v1/psychology/referrals/${referralId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      })
      const data = await response.json() as PsychologyReferral & { detail?: unknown }
      if (!response.ok) throw new Error(readableApiError(data.detail))
      setReferrals((current) => current.map((referral) => referral.id === referralId ? data : referral))
      setNotice('Fila atualizada.')
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Falha ao atualizar o encaminhamento.')
    } finally {
      setUpdatingReferral(null)
    }
  }

  async function createEncounter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/v1/psychology/encounters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_reference: recordPatient,
          encounter_type: recordType,
          objective: objective.trim(),
          evolution: evolution.trim(),
          plan: plan.trim(),
        }),
      })
      const data = await response.json() as PsychologyEncounter & { detail?: unknown }
      if (!response.ok) throw new Error(readableApiError(data.detail))
      setEncounters((current) => [data, ...current])
      setObjective('')
      setEvolution('')
      setPlan('')
      setNotice('Registro clínico salvo com autoria e data/hora.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Falha ao salvar o registro clínico.')
    } finally {
      setSaving(false)
    }
  }

  return <section className="psychology-page page-enter">
    <div className="page-title-row">
      <div><p className="eyebrow">MÓDULO · PSICOLOGIA / PSIQUIATRIA</p><h1>Acompanhamento psicológico e psiquiátrico</h1><p className="welcome-copy">Organize encaminhamentos, atendimentos e registros clínicos em um único fluxo.</p></div>
      <span className="module-icon module-icon-psychology"><HeartPulse size={23} /></span>
    </div>
    <div className="psychology-privacy" role="note"><LockKeyhole size={18} /><span>Informações clínicas confidenciais: acesso restrito a contas autorizadas neste módulo. Registre apenas dados necessários ao atendimento.</span></div>
    {error && <div className="form-message form-message-error" role="alert">{error}</div>}
    {notice && <div className="form-message form-message-success" role="status">{notice}</div>}
    <div className="psychology-tabs" aria-label="Áreas do módulo de Psicologia e Psiquiatria">
      <button type="button" aria-pressed={tab === 'triage'} className={tab === 'triage' ? 'psychology-tab is-active' : 'psychology-tab'} onClick={() => setTab('triage')}>Fila e triagem <span>{referrals.filter((item) => !['completed', 'cancelled'].includes(item.status)).length}</span></button>
      <button type="button" aria-pressed={tab === 'encounters'} className={tab === 'encounters' ? 'psychology-tab is-active' : 'psychology-tab'} onClick={() => { setEncountersPatient(''); setEncounterLoadError(''); setTab('encounters') }}>Atendimentos e registros</button>
    </div>
    {tab === 'triage' && <>
      <form className="psychology-panel" onSubmit={(event) => void createReferral(event)}>
        <div className="section-heading"><div><p className="eyebrow">ENTRADA NA FILA</p><h2>Novo encaminhamento</h2></div></div>
        <div className="field-grid field-grid-two">
          <label className="field"><span className="field-label">Localizar paciente</span><span className="search-input-wrap"><Search size={17} /><input value={triagePatientQuery} onChange={(event) => setTriagePatientQuery(event.target.value)} placeholder="Nome, quarto ou leito" /></span></label>
          <label className="field"><span className="field-label">Paciente</span><select required value={triagePatient} onChange={(event) => { setTriagePatient(event.target.value); setTriagePatientQuery('') }}><option value="">Selecione o paciente</option>{filteredTriagePatients.map((patient) => <option key={patient.reference} value={patient.reference}>{patient.name} · {patient.room && patient.bed ? `Qto ${patient.room} · Leito ${patient.bed}` : 'sem acomodação'}</option>)}</select></label>
          <PatientAllergyAlert patient={patients.find((patient) => patient.reference === triagePatient)} />
          <label className="field"><span className="field-label">Tipo de atendimento</span><select value={triageType} onChange={(event) => setTriageType(event.target.value)}><option>Acolhimento</option><option>Avaliação psicológica</option><option>Acompanhamento</option><option>Avaliação psiquiátrica</option><option>Outro</option></select></label>
          {triageType === 'Outro' && <label className="field"><span className="field-label">Descreva o tipo</span><input required minLength={2} maxLength={80} value={customTriageType} onChange={(event) => setCustomTriageType(event.target.value)} /></label>}
          <label className="field"><span className="field-label">Prioridade</span><select value={triagePriority} onChange={(event) => setTriagePriority(event.target.value as 'routine' | 'priority')}><option value="routine">Rotina</option><option value="priority">Prioritária · conforme protocolo institucional</option></select></label>
        </div>
        <p className="psychology-help">Use a prioridade institucionalmente definida. Não inclua relato clínico ou detalhes sensíveis no encaminhamento.</p>
        <button className="button button-primary" type="submit" disabled={saving || !patients.length}>{saving ? 'Registrando…' : 'Adicionar à fila'} <ArrowRight size={16} /></button>
      </form>
      <section className="psychology-panel">
        <div className="section-heading"><div><p className="eyebrow">ACOMPANHAMENTO</p><h2>Fila de atendimento</h2></div><span className="module-total">{referrals.length}</span></div>
        <div className="psychology-filter-row">
          <label className="field"><span className="field-label">Buscar encaminhamento</span><input value={triageFilter} onChange={(event) => setTriageFilter(event.target.value)} placeholder="Paciente ou tipo de atendimento" /></label>
          <p className="psychology-help">Atualize a situação conforme o fluxo da equipe.</p>
        </div>
        {loading ? <div className="history-empty">Carregando fila…</div> : visibleReferrals.length ? <div className="psychology-referral-list">{visibleReferrals.map((referral) => <article className="psychology-referral-card" key={referral.id}>
          <div className="psychology-referral-main"><div><h3>{patientName(referral.patient_reference)}</h3><p>{referral.referral_type}</p><small>{dateTime(referral.created_at)}</small></div><span className={`psychology-priority ${referral.priority === 'priority' ? 'is-priority' : ''}`}>{referral.priority === 'priority' ? 'Prioritária' : 'Rotina'}</span></div>
          <div className="psychology-referral-actions"><label className="field"><span className="field-label">Situação</span><select aria-label={`Situação do encaminhamento de ${patientName(referral.patient_reference)}`} disabled={updatingReferral === referral.id} value={referral.status} onChange={(event) => void updateReferral(referral.id, { status: event.target.value })}>{Object.entries(psychologyStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field"><span className="field-label">Prioridade</span><select aria-label={`Prioridade do encaminhamento de ${patientName(referral.patient_reference)}`} disabled={updatingReferral === referral.id} value={referral.priority} onChange={(event) => void updateReferral(referral.id, { priority: event.target.value })}><option value="routine">Rotina</option><option value="priority">Prioritária</option></select></label></div>
        </article>)}</div> : <div className="history-empty">{referrals.length ? 'Nenhum encaminhamento corresponde à busca.' : 'A fila está vazia. Registre um encaminhamento para iniciar o acompanhamento.'}</div>}
      </section>
    </>}
    {tab === 'encounters' && <>
      <form className="psychology-panel" onSubmit={(event) => void createEncounter(event)}>
        <div className="section-heading"><div><p className="eyebrow">PRONTUÁRIO RESTRITO</p><h2>Novo registro de atendimento</h2></div></div>
        <div className="field-grid field-grid-two">
          <label className="field"><span className="field-label">Localizar paciente</span><span className="search-input-wrap"><Search size={17} /><input value={recordPatientQuery} onChange={(event) => setRecordPatientQuery(event.target.value)} placeholder="Nome, quarto ou leito" /></span></label>
          <label className="field"><span className="field-label">Paciente</span><select required value={recordPatient} onChange={(event) => { setRecordPatient(event.target.value); setRecordPatientQuery(''); setEncountersPatient(''); setEncounterLoadError(''); setEncounters([]) }}><option value="">Selecione o paciente</option>{filteredRecordPatients.map((patient) => <option key={patient.reference} value={patient.reference}>{patient.name} · {patient.room && patient.bed ? `Qto ${patient.room} · Leito ${patient.bed}` : 'sem acomodação'}</option>)}</select></label>
          <PatientAllergyAlert patient={patients.find((patient) => patient.reference === recordPatient)} />
          <label className="field"><span className="field-label">Tipo de registro</span><select value={recordType} onChange={(event) => setRecordType(event.target.value as PsychologyEncounter['encounter_type'])}>{Object.entries(psychologyEncounterTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field psychology-field-wide"><span className="field-label">Objetivo do atendimento</span><textarea required minLength={3} maxLength={500} value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="Finalidade do encontro, em termos objetivos" /></label>
          <label className="field psychology-field-wide"><span className="field-label">Evolução</span><textarea required minLength={3} maxLength={4000} value={evolution} onChange={(event) => setEvolution(event.target.value)} placeholder="Registre a evolução profissional pertinente ao atendimento" /></label>
          <label className="field psychology-field-wide"><span className="field-label">Plano e encaminhamentos</span><textarea maxLength={4000} value={plan} onChange={(event) => setPlan(event.target.value)} placeholder="Próximos passos e encaminhamentos acordados" /></label>
        </div>
        <p className="psychology-help">Autoria e horário são registrados automaticamente. Os registros são preservados no histórico; correções devem ser feitas como novo adendo, conforme protocolo da instituição.</p>
        <button className="button button-primary" type="submit" disabled={saving || !recordPatient}>{saving ? 'Salvando…' : 'Salvar registro clínico'} <CheckCircle2 size={16} /></button>
      </form>
      <section className="psychology-panel">
        <div className="section-heading"><div><p className="eyebrow">HISTÓRICO INDIVIDUAL</p><h2>Registros de atendimento</h2></div><span className="module-total">{encounters.length}</span></div>
        {!recordPatient ? <div className="history-empty">Selecione um paciente acima para consultar apenas o histórico individual autorizado.</div> : encounterLoadError ? <div className="form-message form-message-error" role="alert">{encounterLoadError}</div> : encountersLoading ? <div className="history-empty">Carregando histórico confidencial…</div> : encounters.length ? <div className="psychology-encounter-list">{encounters.map((encounter) => <article className="psychology-encounter-card" key={encounter.id}>
          <div className="psychology-encounter-heading"><div><h3>{psychologyEncounterTypes[encounter.encounter_type]}</h3><p>{patientName(encounter.patient_reference)}</p></div><div><time>{dateTime(encounter.created_at)}</time><small>{encounter.actor_name}</small></div></div>
          <div className="psychology-encounter-field"><strong>Objetivo</strong><p>{encounter.objective}</p></div>
          <div className="psychology-encounter-field"><strong>Evolução</strong><p>{encounter.evolution}</p></div>
          {encounter.plan && <div className="psychology-encounter-field"><strong>Plano e encaminhamentos</strong><p>{encounter.plan}</p></div>}
        </article>)}</div> : <div className="history-empty">Nenhum registro clínico para este paciente.</div>}
      </section>
    </>}
  </section>
}

type AuditEvent = { id: number; actor_name: string; actor_role: string; action: string; module: string; target_id: string; happened_at: string }
function ExecutiveDashboard() {
  type Summary = {
    active_patients: number
    occupied_beds: number
    patients_without_allergy_confirmation: number
    patients_with_known_allergies: number
    active_contraindications: number
    open_emergency_arrivals: number
    emergency_arrivals_today: number
    vital_records_today: number
    patient_transfers_today: number
    patient_discharges_today: number
    updated_at: string
  }
  type StockAlert = { item_id: number; item_name: string; balance: string; unit: string; suggested_replenishment: string; expiry_date: string; days_to_expiry: number; alert_types: string[] }
  const [summary, setSummary] = useState<Summary | null>(null)
  const [stockAlerts, setStockAlerts] = useState<StockAlert[]>([])
  const [stockAvailable, setStockAvailable] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const refresh = useCallback(async () => {
    const [summaryResult, stockResult] = await Promise.allSettled([
      fetch('/api/v1/nursing/management/dashboard').then(readApiResponse<Summary>),
      fetch('/api/v1/pharmacy/stock-alerts').then(readApiResponse<{ alerts?: StockAlert[] }>),
    ])
    const currentErrors: string[] = []
    if (summaryResult.status === 'fulfilled') setSummary(summaryResult.value)
    else currentErrors.push(summaryResult.reason instanceof Error ? summaryResult.reason.message : 'Indicadores assistenciais indisponíveis.')
    if (stockResult.status === 'fulfilled') {
      setStockAlerts(stockResult.value.alerts ?? [])
      setStockAvailable(true)
    } else {
      setStockAvailable(false)
      currentErrors.push(stockResult.reason instanceof Error ? stockResult.reason.message : 'Alertas de estoque indisponíveis.')
    }
    setErrors(currentErrors)
    setLoading(false)
  }, [])

  useEffect(() => {
    let active = true
    const loadDashboard = async () => {
      const [summaryResult, stockResult] = await Promise.allSettled([
        fetch('/api/v1/nursing/management/dashboard').then(readApiResponse<Summary>),
        fetch('/api/v1/pharmacy/stock-alerts').then(readApiResponse<{ alerts?: StockAlert[] }>),
      ])
      if (!active) return
      const currentErrors: string[] = []
      if (summaryResult.status === 'fulfilled') setSummary(summaryResult.value)
      else currentErrors.push(summaryResult.reason instanceof Error ? summaryResult.reason.message : 'Indicadores assistenciais indisponíveis.')
      if (stockResult.status === 'fulfilled') {
        setStockAlerts(stockResult.value.alerts ?? [])
        setStockAvailable(true)
      } else {
        setStockAvailable(false)
        currentErrors.push(stockResult.reason instanceof Error ? stockResult.reason.message : 'Alertas de estoque indisponíveis.')
      }
      setErrors(currentErrors)
      setLoading(false)
    }
    void loadDashboard()
    return () => { active = false }
  }, [])
  const criticalStock = stockAlerts.filter((alert) => alert.alert_types.includes('critical_stock') || alert.alert_types.includes('below_minimum')).length
  const expiredStock = stockAlerts.filter((alert) => alert.alert_types.includes('expired')).length
  const expiringStock = stockAlerts.filter((alert) => alert.alert_types.includes('expiring')).length
  return <section className="executive-dashboard patient-list-panel">
    <div className="section-heading"><div><p className="eyebrow">OPERAÇÃO HOSPITALAR</p><h2>Indicadores executivos</h2><p className="welcome-copy">Resumo agregado de ocupação, produção assistencial, riscos e estoque crítico.</p></div><button className="button button-secondary" type="button" onClick={() => { setLoading(true); void refresh() }}>Atualizar</button></div>
    {errors.map((message) => <div className="form-message form-message-error" role="alert" key={message}>{message}</div>)}
    {loading && !summary ? <div className="history-empty">Carregando indicadores…</div> : <>
      <div className="hygiene-summary executive-kpis">
        <article><strong>{summary?.occupied_beds ?? '—'}</strong><span>Leitos ocupados</span></article>
        <article><strong>{summary?.active_patients ?? '—'}</strong><span>Pacientes ativos</span></article>
        <article><strong>{summary?.open_emergency_arrivals ?? '—'}</strong><span>Chegadas em atendimento</span></article>
        <article><strong>{summary?.emergency_arrivals_today ?? '—'}</strong><span>Chegadas hoje</span></article>
        <article><strong>{summary?.vital_records_today ?? '—'}</strong><span>Coletas de enfermagem hoje</span></article>
        <article><strong>{stockAvailable ? criticalStock : '—'}</strong><span>Itens abaixo do mínimo</span></article>
      </div>
      <div className="executive-risk-strip" role="status"><AlertTriangle size={18} /><span><strong>Alertas assistenciais:</strong> {summary?.patients_with_known_allergies ?? '—'} paciente(s) com alergia conhecida, {summary?.patients_without_allergy_confirmation ?? '—'} sem confirmação e {summary?.active_contraindications ?? '—'} contraindicação(ões) ativa(s).</span></div>
      <div className="executive-summary-grid">
        <article><strong>Fluxo de leitos hoje</strong><span>{summary?.patient_transfers_today ?? '—'} transferências · {summary?.patient_discharges_today ?? '—'} altas</span></article>
        <article><strong>Validade de estoque</strong><span>{stockAvailable ? `${expiredStock} lote(s) vencido(s) · ${expiringStock} vencendo em até 30 dias` : 'Indicador indisponível'}</span></article>
      </div>
      {stockAlerts.length > 0 && <section className="executive-stock-alerts"><div className="section-heading"><div><p className="eyebrow">LOGÍSTICA · AÇÃO NECESSÁRIA</p><h3>Estoque crítico e validade</h3></div><span className="module-total">{stockAlerts.length} alertas</span></div><div className="collection-list">{stockAlerts.slice(0, 8).map((alert) => <article className="collection-row" key={alert.item_id}><div className="collection-row-heading"><strong>{alert.item_name}</strong><span>{alert.balance} {alert.unit} disponíveis</span></div><small>{alert.alert_types.includes('expired') ? 'Lote vencido' : alert.alert_types.includes('expiring') ? `Vencimento em ${Math.max(0, alert.days_to_expiry)} dias` : 'Abaixo do mínimo'} · Reposição sugerida: {alert.suggested_replenishment} {alert.unit} · Validade {alert.expiry_date}</small></article>)}</div></section>}
      {summary?.updated_at && <p className="field-hint">Atualizado em {dateTime(summary.updated_at)}. Ocupação exibida como contagem de leitos atribuídos; percentual depende do cadastro da capacidade física do hospital.</p>}
    </>}
  </section>
}

function ManagementPage({ onNavigate }: { onNavigate: (id: ModuleId) => void }) {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [error, setError] = useState('')
  useEffect(() => { fetch('/api/v1/audit/events').then(async (response) => { const data = await response.json() as { events?: AuditEvent[]; detail?: string }; if (!response.ok) throw new Error(data.detail ?? 'Não foi possível consultar a auditoria.'); setEvents(data.events ?? []) }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar a auditoria.')) }, [])
  return <section className="admin-page page-enter"><div className="page-title-row"><div><p className="eyebrow">GESTÃO INSTITUCIONAL</p><h1>Gestão Hospitalar</h1><p className="welcome-copy">Indicadores operacionais, contas, permissões e auditoria administrativa.</p></div><button className="button button-primary" type="button" onClick={() => onNavigate('admin')}><ShieldCheck size={16} /> Usuários e permissões</button></div><ExecutiveDashboard /><BackupExportPanel /><section className="patient-list-panel"><div className="section-heading"><div><p className="eyebrow">RASTREABILIDADE</p><h2>Eventos recentes</h2><p className="welcome-copy">Ações administrativas registradas pelo sistema.</p></div><span className="module-total">{events.length}</span></div>{error ? <div className="form-message form-message-error" role="alert">{error}</div> : events.length ? <div className="collection-list">{events.map((event) => <article className="collection-row" key={event.id}><div className="collection-row-heading"><strong>{event.actor_name} · {event.actor_role}</strong><time>{dateTime(event.happened_at)}</time></div><div className="collection-values"><span><small>Ação</small><strong>{event.action}</strong></span><span><small>Módulo</small><strong>{event.module}</strong></span><span><small>Registro</small><strong>{event.target_id}</strong></span></div></article>)}</div> : <div className="history-empty">Nenhum evento registrado.</div>}</section></section>
}

function BackupExportPanel() {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  async function exportBackup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('')
    try {
      const response = await fetch('/api/v1/backup/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
      if (!response.ok) { const data = await response.json() as { detail?: string }; throw new Error(data.detail ?? 'Não foi possível gerar o backup.') }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a'); link.href = url; link.download = `scpo-connect-${new Date().toISOString().replace(/[:.]/g, '-')}.rgs`; link.click(); URL.revokeObjectURL(url)
      setMessage('Backup .rgs cifrado gerado e baixado. Guarde a senha em local seguro; ela não pode ser recuperada pelo sistema.')
    } catch (exportError) { setError(exportError instanceof Error ? exportError.message : 'Falha ao gerar backup.') }
    finally { setBusy(false) }
  }
  return <section className="patient-list-panel backup-panel"><div className="section-heading"><div><p className="eyebrow">PROTEÇÃO DE DADOS</p><h2>Backup do sistema</h2><p className="welcome-copy">Exporta os sete bancos em um arquivo .rgs protegido por senha.</p></div><span className="module-icon"><ShieldCheck size={20} /></span></div><form className="backup-export-form" onSubmit={(event) => void exportBackup(event)}><label className="field"><span className="field-label">Senha de criptografia</span><input required minLength={12} maxLength={128} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Use uma senha exclusiva com 12 ou mais caracteres" /><span className="field-hint">A senha não é enviada para auditoria nem armazenada. Sem ela, o arquivo não pode ser aberto.</span></label><button className="button button-primary" type="submit" disabled={busy || password.length < 12}>{busy ? 'Preparando bancos…' : 'Gerar backup .rgs'}</button></form>{message && <div className="form-message form-message-success" role="status">{message}</div>}{error && <div className="form-message form-message-error" role="alert">{error}</div>}<p className="field-hint">A restauração deve ocorrer em bancos isolados; a opção de importação ficará disponível quando o destino isolado estiver configurado.</p></section>
}

export default App
