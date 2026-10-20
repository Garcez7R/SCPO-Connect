import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { readApiResponse, readableApiError } from './api'
import AllergyFields from './components/AllergyFields'
import {
  formatCpf,
  formatDecimalInput,
  formatHeightCentimeters,
  formatPhone,
  formatPostalCode,
  toHeightCentimeters,
} from './inputFormatting'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Building2,
  CalendarDays,
  Camera,
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
import PrintSelectionPanel from './components/PrintSelectionPanel'
import { printRows, type PrintRow } from './printReport'
import VitalTrendsDashboard from './components/VitalTrendsDashboard'
import { squareImageFile, squareVideoFrame } from './patientPhoto'

type ModuleId = 'home' | 'work-orders' | 'patients' | 'patient-history' | 'nursing' | 'nursing-history' | 'pharmacy' | 'xray' | 'social' | 'nutrition' | 'hygiene' | 'reception' | 'therapy' | 'psychology' | 'maintenance' | 'management' | 'admin' | 'system-admin' | 'about'
type ProfileId = 'patients' | 'nursing' | 'pharmacy' | 'xray' | 'social' | 'nutrition' | 'hygiene' | 'reception' | 'therapy' | 'psychology' | 'maintenance' | 'management'
type EntryState = 'draft' | 'review' | 'saving' | 'saved' | 'error'
type Patient = {
  reference: string; name: string; room: string; bed: string; cpf?: string; sus_card?: string; same_number?: string; mother_name?: string; health_plan?: string; allergies?: string; allergies_status?: 'unknown' | 'none_known' | 'known'; birth_date?: string | null; sex?: string; phone?: string; email?: string
  treatment_track?: 'clinical' | 'psychiatric' | 'combined' | 'unclassified'
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
function treatmentTrackLabel(track: Patient['treatment_track']) {
  if (track === 'clinical') return 'Tratamento clínico'
  if (track === 'psychiatric') return 'Tratamento psiquiátrico'
  if (track === 'combined') return 'Cuidado clínico e psiquiátrico'
  return 'Perfil de cuidado não classificado'
}
function dateTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}
function getGreeting() {
  const hour = Number(new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(new Date()))
  return hour >= 5 && hour < 12 ? 'Bom dia' : hour >= 12 && hour < 18 ? 'Boa tarde' : 'Boa noite'
}
type VitalRecordData = { id: number; patient_reference: string; actor_name: string; values: Record<string, string>; glucose_unit: string; measured_at: string; recorded_at: string }
type PatientObservation = { id: number; attention_level: 'green' | 'yellow' | 'red'; observation: string; treatment_status: 'in_progress' | 'completed' | 'discharged'; actor_name: string; created_at: string }
type MedicationDispensation = { id: string; patient_reference: string; item_id: number; medication_name: string; quantity: string; unit: string; instructions: string; prescription_reference: string; prescriber_name: string; allergy_reviewed: boolean; status: 'dispensed' | 'cancelled'; actor_name: string; created_at: string }
type MedicationAdministration = { id: number; dispensation_id: string; patient_reference: string; medication_name: string; dose: string; unit: string; status: 'administered' | 'refused' | 'held'; reason: string; actor_name: string; administered_at: string }
function remainingDispensedQuantity(dispensation: MedicationDispensation, administrations: MedicationAdministration[]) {
  const dispensed = Number(dispensation.quantity.replace(',', '.'))
  const administered = administrations
    .filter((record) => record.dispensation_id === dispensation.id && record.status === 'administered')
    .reduce((total, record) => total + Number(record.dose.replace(',', '.')), 0)
  const remaining = dispensed - administered
  return Number.isFinite(remaining) && remaining > 0.000001 ? remaining : 0
}
type PatientFlowEvent = { id: number; patient_reference: string; event_type: 'admission' | 'transfer' | 'discharge'; previous_room: string; previous_bed: string; next_room: string; next_bed: string; reason: string; summary: string; actor_name: string; occurred_at: string }
type HospitalBed = { id: string; unit_id: string; unit_name: string; room: string; label: string; status: 'available' | 'cleaning' | 'maintenance' | 'blocked'; isolation_capable: boolean; notes: string; active: boolean; occupied: boolean; patient_reference: string | null }
type ClinicalRisk = { id: number | string; patient_reference: string; patient_name: string; room: string; bed: string; risk_type: 'allergy' | 'contraindication'; description: string; severity: 'unspecified' | 'low' | 'moderate' | 'high'; status: 'active' | 'resolved'; reason: string; actor_name: string; created_at: string; resolved_at?: string | null; resolved_by?: string; resolution_reason?: string }
type EmergencyArrivalStatus = 'waiting' | 'called' | 'in_service' | 'completed' | 'cancelled' | 'admitted'
type EmergencyClinicalPriority = 'unassigned' | 'routine' | 'priority' | 'urgent'
type EmergencyArrival = { id: string; patient_reference: string | null; patient_name: string; allergies_status?: Patient['allergies_status']; allergy_report_status?: 'not_asked' | 'reported' | 'denied'; reported_allergies?: string; arrival_mode: 'walk_in' | 'ambulance' | 'other'; reason: string; status: EmergencyArrivalStatus; clinical_priority: EmergencyClinicalPriority; clinical_priority_updated_by: string; clinical_priority_updated_at: string | null; clinical_priority_reason: string; created_by: string; updated_by: string; created_at: string; updated_at: string }
type TherapyActivityStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
type TherapyActivity = { id: string; title: string; activity_type: string; description: string; location: string; starts_at: string; ends_at: string | null; patient_reference: string | null; status: TherapyActivityStatus; activity_report: string; report_updated_by: string | null; report_updated_at: string | null; created_by: string; created_at: string }
type NutritionRecordData = { id: number; patient_reference: string; assessment_date: string; weight_kg: string; height_cm: string; diet_type: string; allergies: string; restrictions: string; appetite: string; hydration: string; notes: string; fasting_at?: string | null; fasting_reason?: string; actor_name: string; created_at: string }
type NutritionPlan = { allergies: string; assessment_date: string | null; diet_type: string; restrictions: string; fasting_at: string | null; fasting_reason: string }

const ReceptionPage = lazy(() => import('./pages/ReceptionPage'))
const PharmacyPage = lazy(() => import('./pages/PharmacyPage'))
const XrayModulePage = lazy(() => import('./pages/XrayPage'))
const PatientOperationsPage = lazy(() =>
  import('./pages/PatientOperationsPages').then((module) => ({
    default: module.PatientOperationsPage,
  })),
)
const PsychologyPage = lazy(() =>
  import('./pages/PatientOperationsPages').then((module) => ({
    default: module.PsychologyPage,
  })),
)
const WorkOrdersPage = lazy(() => import('./pages/OperationsPage').then((module) => ({ default: module.WorkOrdersPage })))
const MaintenanceQueuePage = lazy(() => import('./pages/OperationsPage').then((module) => ({ default: module.MaintenanceQueuePage })))
const HygienePage = lazy(() => import('./pages/OperationsPage').then((module) => ({ default: module.HygienePage })))
const AdministrativeRoadmapPanel = lazy(() => import('./pages/ManagementOperationsPage').then((module) => ({ default: module.AdministrativeRoadmapPanel })))
const OperationalTaskCenter = lazy(() => import('./components/OperationalTaskCenter'))

type Profile = {
  id: ProfileId
  name: string
  role: string
  initials: string
  modules: ModuleId[]
}

type AuthUser = { id: string; username: string; name: string; role: ProfileId; modules: ModuleId[]; permissions: Record<string, string[]>; mfa_enabled: boolean; is_superuser: boolean }

const roleLabels: Record<ProfileId, string> = {
  patients: 'Cadastro de pacientes', nursing: 'Enfermagem', pharmacy: 'Farmácia', xray: 'Raio X', social: 'Serviço Social',
  nutrition: 'Nutrição', hygiene: 'Higienização', reception: 'Recepção', therapy: 'Oficina Terapêutica',
  psychology: 'Psicologia / Psiquiatria', maintenance: 'Manutenção',
  management: 'Gestão Hospitalar',
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
  { id: 'management', label: 'Gestão Hospitalar', short: 'Gestão hospitalar', icon: Building2, description: 'Indicadores operacionais agregados e acompanhamento da instituição.' },
  { id: 'admin', label: 'Administração', short: 'Administração', icon: ShieldCheck, description: 'Usuários, funções e permissões.' },
]

const navigation: { id: ModuleId; label: string; icon: LucideIcon }[] = [
  { id: 'home', label: 'Visão geral', icon: Home },
  { id: 'work-orders', label: 'Abrir ordem de serviço', icon: ClipboardPlus },
  { id: 'patients', label: 'Pacientes', icon: UserRound },
  ...modules.map(({ id, label, icon }) => ({ id, label, icon })),
  { id: 'system-admin', label: 'Administração do Sistema', icon: ShieldCheck },
  { id: 'about', label: 'Sobre e conformidade', icon: Info },
]

const emptyRecord = {
  saturation: '',
  pressure: '',
  heartRate: '',
  respiratoryRate: '',
  temperature: '',
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
  temperature: 'Temperatura',
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
  const [activeModule, setActiveModule] = useState<ModuleId>(() => {
    try {
      const saved = navigation.find((item) => item.id === window.sessionStorage.getItem(`scpo-active-module:${user.id}`))
      if (!saved) return 'home'
      const id = saved.id
      return id === 'home' || id === 'about' || id === 'work-orders'
        || (id === 'system-admin' && user.is_superuser)
        || (id === 'therapy' && user.modules.includes('management'))
        || user.modules.includes(id)
        ? id
        : 'home'
    } catch {
      return 'home'
    }
  })
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
    role: user.is_superuser ? 'Superadministrador do Sistema' : roleLabels[role],
    initials: user.name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join(''),
    modules: ['home', ...user.modules, 'about'],
  }
  const canReviewTherapyReports = profile.modules.includes('management')
  const visibleNavigation = navigation.filter((item) => item.id === 'about' || item.id === 'work-orders' || (item.id === 'system-admin' && user.is_superuser) || profile.modules.includes(item.id) || (item.id === 'therapy' && canReviewTherapyReports))

  function navigate(id: ModuleId) {
    if (id === 'nursing-history' && !profile.modules.includes('nursing')) return
    if (id === 'patient-history' && !profile.modules.includes('patients')) return
    if (id === 'system-admin' && !user.is_superuser) return
    if (id !== 'about' && id !== 'work-orders' && id !== 'system-admin' && id !== 'nursing-history' && id !== 'patient-history' && !(id === 'therapy' && canReviewTherapyReports) && !profile.modules.includes(id)) return
    setActiveModule(id)
    if (navigation.some((item) => item.id === id)) window.sessionStorage.setItem(`scpo-active-module:${user.id}`, id)
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
          {activeModule === 'home' && <Dashboard profile={profile} onNavigate={navigate} />}
          {activeModule === 'nursing' && <NursingPage profile={profile} user={user} onShowHistory={() => navigate('nursing-history')} />}
          {activeModule === 'nursing-history' && <NursingHistoryPage onBack={() => navigate('nursing')} />}
          {activeModule === 'pharmacy' && <Suspense fallback={<div className="history-empty" role="status">Carregando Farmácia…</div>}><PharmacyPage user={user} /></Suspense>}
          {activeModule === 'work-orders' && <Suspense fallback={<div className="history-empty" role="status">Carregando ordens de serviço…</div>}><WorkOrdersPage user={user} /></Suspense>}
          {activeModule === 'maintenance' && <Suspense fallback={<div className="history-empty" role="status">Carregando Manutenção…</div>}><MaintenanceQueuePage /></Suspense>}
          {activeModule === 'hygiene' && <Suspense fallback={<div className="history-empty" role="status">Carregando Higienização…</div>}><HygienePage user={user} /></Suspense>}
          {activeModule === 'psychology' && <Suspense fallback={<div className="history-empty" role="status">Carregando Psicologia…</div>}><PsychologyPage /></Suspense>}
          {activeModule === 'patients' && <PatientRegistryPage onHistory={openPatientHistory} />}
          {activeModule === 'reception' && <Suspense fallback={<div className="history-empty" role="status">Carregando Recepção…</div>}><ReceptionPage user={user} PatientRegistryPage={PatientRegistryPage} /></Suspense>}
          {activeModule === 'patient-history' && <PatientHistoryPage patientReference={historyPatientReference} onBack={() => navigate('patients')} />}
          {activeModule === 'therapy' && <TherapyPage profile={profile} />}
          {activeModule === 'admin' && <AdminPage />}
          {activeModule === 'management' && <ManagementPage user={user} onNavigate={navigate} allowedModules={profile.modules} />}
          {activeModule === 'system-admin' && user.is_superuser && <SystemAdminPage />}
          {activeModule === 'about' && <AboutPage />}
          {activeModule === 'nutrition' && <NutritionPage />}
          {activeModule === 'xray' && <Suspense fallback={<div className="history-empty" role="status">Carregando Raio X…</div>}><XrayModulePage user={user} /></Suspense>}
          {activeModule === 'social' && <Suspense fallback={<div className="history-empty" role="status">Carregando Serviço Social…</div>}><PatientOperationsPage moduleId="social" user={user} /></Suspense>}
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
  name: '', mother_name: '', health_plan: '', same_number: '', room: '', bed: '', cpf: '', sus_card: '', allergies: '', allergies_status: 'unknown', birth_date: '', sex: '', phone: '', email: '', address: '', address_number: '', address_complement: '', neighborhood: '', city: '', state: '', postal_code: '',
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
    <label className="field"><span className="field-label">CEP</span><input inputMode="numeric" maxLength={9} autoComplete="postal-code" value={formatPostalCode(value('postal_code'))} onChange={(event) => onChange(key('postal_code'), formatPostalCode(event.target.value))} onBlur={() => { if (value('postal_code').replace(/\D/g, '').length === 8) void lookupCep() }} /></label>
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
    try {
      setForm((current) => ({ ...current, photo_data: squareVideoFrame(video) }))
      setCameraOpen(false)
      setCameraError('')
    } catch (error) {
      setCameraError(error instanceof Error ? error.message : 'Não foi possível processar a imagem.')
    }
  }

  function loadPhoto(file?: File) {
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('Selecione uma imagem JPEG, PNG ou WebP.'); return }
    if (file.size > 1_000_000) { setError('A foto deve ter até 1 MB.'); return }
    setError('')
    setCameraOpen(false)
    void squareImageFile(file)
      .then((photoData) => setForm((current) => ({ ...current, photo_data: photoData })))
      .catch((error) => setError(error instanceof Error ? error.message : 'Não foi possível ler a imagem selecionada.'))
  }

  return <section className="patient-registry-page page-enter">
    {receptionMode ? <div className="section-heading reception-admission-heading"><div><p className="eyebrow">INTERNAÇÕES</p><h2>Admissões e internações</h2><p className="welcome-copy">Confirme a identificação do paciente e registre sua acomodação hospitalar.</p></div><button className="button button-primary" type="button" onClick={() => { if (showForm) { setShowForm(false); setEditingReference(''); setForm({ ...emptyPatientForm }); setCameraOpen(false) } else { setShowForm(true); setNotice(''); setError('') } }}><UserRound size={16} /> {showForm ? 'Fechar cadastro' : 'Nova admissão'}</button></div> : <div className="page-title-row"><div><p className="eyebrow">CADASTRO COMPARTILHADO</p><h1>Pacientes</h1><p className="welcome-copy">Cadastros centralizados, exibidos nos módulos autorizados para cada profissional.</p></div><button className="button button-primary" type="button" onClick={() => { if (showForm) { setShowForm(false); setEditingReference(''); setForm({ ...emptyPatientForm }); setCameraOpen(false) } else { setShowForm(true); setNotice(''); setError('') } }}><UserRound size={16} /> {showForm ? 'Fechar cadastro' : 'Cadastrar paciente'}</button></div>}
    {notice && <div className="form-message form-message-success" role="status">{notice}</div>}{error && <div className="form-message form-message-error" role="alert">{error}</div>}
    {receptionMode && <div className="hygiene-summary reception-admission-summary" aria-label="Resumo de internações"><article><strong>{patients.filter((patient) => patient.active !== false && Boolean(patient.room && patient.bed)).length}</strong><span>Pacientes acomodados</span></article><article><strong>{patients.filter((patient) => patient.active !== false && !(patient.room && patient.bed)).length}</strong><span>Sem acomodação</span></article><article><strong>{patients.filter((patient) => patient.active === false).length}</strong><span>Cadastros inativos</span></article></div>}
    {showForm && <form className={`patient-registry-form${receptionMode ? ' hygiene-panel' : ''}`} onSubmit={(event) => void submit(event)}>
      <div className="section-heading"><div><p className="eyebrow">{editingReference ? 'ATUALIZAÇÃO CADASTRAL' : receptionMode ? 'ADMISSÃO' : 'NOVO CADASTRO'}</p><h2>{editingReference ? 'Dados do paciente' : receptionMode ? 'Identificação e internação' : 'Identificação e internação'}</h2><p className="welcome-copy">Os campos são compartilhados com os módulos conforme as permissões configuradas.</p></div></div>
      <div className="patient-form-grid">
        <label className="field"><span className="field-label">Nome completo</span><input required minLength={2} maxLength={120} autoComplete="name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label className="field"><span className="field-label">Nome da mãe</span><input maxLength={120} autoComplete="off" value={form.mother_name} onChange={(event) => setForm({ ...form, mother_name: event.target.value })} /></label>
        <label className="field"><span className="field-label">Convênio</span><input maxLength={120} value={form.health_plan} onChange={(event) => setForm({ ...form, health_plan: event.target.value })} placeholder="SUS ou convênio cadastrado" /></label>
        <label className="field"><span className="field-label">Nº SAME / prontuário</span><input maxLength={40} value={form.same_number} onChange={(event) => setForm({ ...form, same_number: event.target.value })} /></label>
        <label className="field"><span className="field-label">CPF</span><input inputMode="numeric" autoComplete="off" maxLength={14} value={formatCpf(form.cpf)} onChange={(event) => setForm({ ...form, cpf: formatCpf(event.target.value) })} placeholder="000.000.000-00" /></label>
        <label className="field"><span className="field-label">Cartão Nacional de Saúde (SUS)</span><input inputMode="numeric" autoComplete="off" maxLength={20} value={form.sus_card} onChange={(event) => setForm({ ...form, sus_card: event.target.value.replace(/\D/g, '').slice(0, 20) })} /></label>
        <label className="field"><span className="field-label">Data de nascimento</span><input type="date" value={form.birth_date} onChange={(event) => setForm({ ...form, birth_date: event.target.value })} /></label>
        <label className="field"><span className="field-label">Quarto</span><input required maxLength={20} value={form.room} onChange={(event) => setForm({ ...form, room: event.target.value })} /></label>
        <label className="field"><span className="field-label">Leito</span><input required maxLength={20} value={form.bed} onChange={(event) => setForm({ ...form, bed: event.target.value })} /></label>
        <label className="field"><span className="field-label">Sexo (opcional)</span><select value={form.sex} onChange={(event) => setForm({ ...form, sex: event.target.value })}><option value="">Não informado</option><option value="Feminino">Feminino</option><option value="Masculino">Masculino</option><option value="Outro">Outro</option><option value="Não informado">Prefere não informar</option></select></label>
        <label className="field"><span className="field-label">Telefone do paciente</span><input inputMode="tel" maxLength={20} autoComplete="tel" value={formatPhone(form.phone)} onChange={(event) => setForm({ ...form, phone: formatPhone(event.target.value) })} /></label>
        <label className="field"><span className="field-label">E-mail do paciente</span><input type="email" maxLength={160} autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
      </div>
      <AllergyFields status={form.allergies_status as NonNullable<Patient['allergies_status']>} allergies={form.allergies} onChange={(allergies_status, allergies) => setForm((current) => ({ ...current, allergies_status, allergies }))} />
      {duplicateCandidates.length > 0 && <div className="duplicate-warning" role="alert"><strong>Confira antes de salvar</strong>{duplicateCandidates.map((candidate) => <span key={candidate.reference}>{candidate.name} · Quarto {candidate.room}, leito {candidate.bed} · Coincidência: {candidate.reasons}</span>)}<button className="button button-secondary" type="button" onClick={() => { setDuplicateOverride(true); setError(''); setDuplicateCandidates([]) }}>Confirmo que é outra pessoa</button></div>}
      <fieldset className="patient-address-group"><legend>Endereço do paciente</legend><AddressFields form={form} patients={patients} prefix="" onChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))} /></fieldset>
      <fieldset className="patient-address-group"><legend>Responsável pela internação</legend><label className="field"><span className="field-label">Situação do responsável</span><select value={form.responsible_status} onChange={(event) => { const status = event.target.value as NonNullable<Patient['responsible_status']>; setForm((current) => status === 'not_applicable' ? { ...current, responsible_status: status, responsible_name: '', responsible_relationship: '', responsible_phone: '', responsible_address: '', responsible_address_number: '', responsible_address_complement: '', responsible_neighborhood: '', responsible_city: '', responsible_state: '', responsible_postal_code: '' } : { ...current, responsible_status: status }) }}><option value="unknown">Não informado</option><option value="not_applicable">Não se aplica</option><option value="provided">Responsável informado</option></select></label>{form.responsible_status !== 'not_applicable' && <><div className="patient-form-actions"><button className="button button-secondary" type="button" onClick={() => setForm((current) => ({ ...current, responsible_status: 'provided', responsible_name: current.name, responsible_relationship: 'Próprio paciente (autorreferência)', responsible_phone: current.phone, responsible_address: current.address, responsible_address_number: current.address_number, responsible_address_complement: current.address_complement, responsible_neighborhood: current.neighborhood, responsible_city: current.city, responsible_state: current.state, responsible_postal_code: current.postal_code }))}>Usar os dados do próprio paciente</button></div><div className="patient-form-grid"><label className="field"><span className="field-label">Nome completo</span><input maxLength={120} value={form.responsible_name} onChange={(event) => setForm({ ...form, responsible_status: 'provided', responsible_name: event.target.value })} /></label><label className="field"><span className="field-label">Vínculo com o paciente</span><input maxLength={60} value={form.responsible_relationship} onChange={(event) => setForm({ ...form, responsible_status: 'provided', responsible_relationship: event.target.value })} placeholder="Ex.: filha, cônjuge" /></label><label className="field"><span className="field-label">Telefone de contato</span><input inputMode="tel" maxLength={20} autoComplete="tel" value={formatPhone(form.responsible_phone)} onChange={(event) => setForm({ ...form, responsible_status: 'provided', responsible_phone: formatPhone(event.target.value) })} /></label></div><AddressFields form={form} patients={patients} prefix="responsible_" onChange={(key, value) => setForm((current) => ({ ...current, responsible_status: 'provided', [key]: value }))} /></>}</fieldset>
      <fieldset className="patient-address-group"><legend>Foto do paciente</legend><div className="patient-photo-editor">{form.photo_data ? <img src={form.photo_data} alt="Prévia da foto do paciente" /> : <span className="patient-photo-placeholder"><UserRound size={24} /></span>}<button className="button button-secondary" type="button" onClick={() => { setCameraError(''); setCameraOpen((open) => !open) }}><Camera size={16} /> {cameraOpen ? 'Fechar câmera' : 'Tirar foto'}</button><label className="button button-secondary" htmlFor="patient-photo">Escolher imagem</label><input id="patient-photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => { loadPhoto(event.target.files?.[0]); event.currentTarget.value = '' }} /><button className="button button-secondary" type="button" onClick={() => setForm({ ...form, photo_data: '' })} disabled={!form.photo_data}>Remover foto</button><small>JPEG, PNG ou WebP · até 1 MB. A câmera requer HTTPS e permissão.</small>{cameraOpen && <div className="patient-camera-panel"><video ref={videoRef} autoPlay muted playsInline aria-label="Visualização da câmera para foto do paciente" />{(cameraError || (!navigator.mediaDevices?.getUserMedia ? 'A câmera precisa de HTTPS e de permissão do navegador. Você ainda pode escolher uma imagem do dispositivo.' : '')) && <p className="form-message form-message-error" role="alert">{cameraError || 'A câmera precisa de HTTPS e de permissão do navegador. Você ainda pode escolher uma imagem do dispositivo.'}</p>}<div><button className="button button-primary" type="button" onClick={capturePhoto} disabled={!navigator.mediaDevices?.getUserMedia}><Camera size={16} /> Capturar foto</button><button className="button button-secondary" type="button" onClick={() => setCameraOpen(false)}>Cancelar câmera</button></div></div>}</div></fieldset>
      <div className="patient-form-actions"><button className="button button-secondary" type="button" onClick={() => { setShowForm(false); setEditingReference(''); setForm({ ...emptyPatientForm }); setCameraOpen(false) }} disabled={saving}>Cancelar</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Salvando…' : editingReference ? 'Salvar alterações' : 'Cadastrar paciente'} <ArrowRight size={16} /></button></div>
    </form>}
    <section className="patient-list-panel"><div className="section-heading"><div><p className="eyebrow">REGISTROS COMPARTILHADOS</p><h2>{receptionMode ? 'Pacientes e admissões' : 'Pacientes cadastrados'}</h2></div><span className="module-total">{patients.length}</span></div><label className="field patient-search"><span className="field-label">Buscar paciente, quarto, CPF, Cartão SUS ou responsável</span><span className="search-input-wrap"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome, documento, quarto ou leito" /></span></label>{loading ? <div className="history-empty">Carregando pacientes…</div> : filteredPatients.length ? <div className="patient-registry-list">{filteredPatients.map((patient) => <article className="patient-registry-card" key={patient.reference}><div className="patient-registry-identity">{patient.photo_data ? <img src={patient.photo_data} alt="" /> : <span className="patient-registry-avatar"><UserRound size={19} /></span>}<div><h3>{patient.name}</h3><p>{patient.room && patient.bed ? `Quarto ${patient.room} · Leito ${patient.bed}` : 'Sem acomodação atribuída'}{patient.birth_date ? ` · Nascimento ${new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${patient.birth_date}T00:00:00Z`))}` : ''}</p><small className="patient-card-identifiers">CPF: {patient.cpf || 'Não informado'} · Cartão SUS: {patient.sus_card || 'Não informado'}</small>{patient.treatment_track && patient.treatment_track !== 'unclassified' && <small>{treatmentTrackLabel(patient.treatment_track)}</small>}<PatientAllergyAlert patient={patient} />{patient.responsible_status === 'not_applicable' ? <small>Responsável: não se aplica</small> : patient.responsible_name && <small>{patient.responsible_relationship === 'Próprio paciente (autorreferência)' ? 'Autorreferência do paciente' : `Responsável: ${patient.responsible_name}`}{patient.responsible_phone ? ` · ${patient.responsible_phone}` : ''}</small>}{patientAddress(patient) && <small>{patientAddress(patient)}</small>}</div></div><div className="patient-registry-actions"><button className="button button-secondary" type="button" onClick={() => setViewingPatient(patient)}><Eye size={15} /> Ver ficha</button>{onHistory && <button className="button button-secondary" type="button" onClick={() => onHistory(patient.reference)}><ClipboardList size={15} /> Histórico</button>}<button className="button button-secondary" type="button" onClick={() => startEdit(patient)}><Pencil size={15} /> Editar</button><button className="button button-danger" type="button" onClick={() => void archivePatient(patient)}>Arquivar</button></div></article>)}</div> : <div className="history-empty"><UsersRound size={20} /><span>{query ? 'Nenhum cadastro corresponde à pesquisa.' : 'Nenhum paciente cadastrado.'}</span></div>}</section>
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
    if (!printRows(`Relatório de atividades · ${monthLabel}`, therapyPrintRows.filter((row) => visibleActivities.some((activity) => activity.id === row.id)))) {
      setError('Permita a janela de impressão para este site e tente novamente.')
      return
    }
    setError('')
    setNotice('Relatório aberto para impressão.')
  }

  const monthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(month)
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const firstWeekday = new Date(month.getFullYear(), month.getMonth(), 1).getDay()
  const activityDateKey = (value: string) => { const date = new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
  const todayKey = activityDateKey(new Date().toISOString())
  const todayActivityCount = activities.filter((activity) => activityDateKey(activity.starts_at) === todayKey).length
  const inProgressCount = activities.filter((activity) => (reportStatuses[activity.id] ?? activity.status) === 'in_progress').length
  const completedCount = activities.filter((activity) => (reportStatuses[activity.id] ?? activity.status) === 'completed').length
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
    <div className="hygiene-summary therapy-summary" aria-label="Resumo da Oficina Terapêutica"><article><strong>{activities.length}</strong><span>Atividades no mês</span></article><article><strong>{todayActivityCount}</strong><span>Agendadas para hoje</span></article><article><strong>{inProgressCount}</strong><span>Em andamento</span></article><article><strong>{completedCount}</strong><span>Realizadas</span></article></div>
    {showForm && <form className="therapy-form" onSubmit={(event) => void submit(event)}><div className="section-heading"><div><p className="eyebrow">NOVA ATIVIDADE</p><h2>Dados da oficina</h2></div></div><div className="field-grid field-grid-two"><label className="field"><span className="field-label">Nome da atividade</span><input required minLength={3} maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Ex.: oficina de pintura" /></label><label className="field"><span className="field-label">Modalidade</span><select required value={form.activity_type} onChange={(event) => setForm({ ...form, activity_type: event.target.value })}><option value="">Selecione</option><option value="grupo">Grupo terapêutico</option><option value="arte">Arte e expressão</option><option value="música">Música</option><option value="movimento">Movimento corporal</option><option value="ocupacional">Atividade ocupacional</option><option value="recreação">Recreação</option><option value="outro">Outra</option></select></label><label className="field"><span className="field-label">Início</span><input required type="datetime-local" value={form.starts_at} onChange={(event) => setForm({ ...form, starts_at: event.target.value })} /></label><label className="field"><span className="field-label">Término (opcional)</span><input type="datetime-local" min={form.starts_at || undefined} value={form.ends_at} onChange={(event) => setForm({ ...form, ends_at: event.target.value })} /></label><label className="field"><span className="field-label">Local</span><input required minLength={2} maxLength={120} value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Sala ou espaço" /></label><label className="field"><span className="field-label">Paciente (opcional)</span><select value={form.patient_reference} onChange={(event) => setForm({ ...form, patient_reference: event.target.value })}><option value="">Atividade em grupo / sem vínculo individual</option>{patients.map((patient) => <option key={patient.reference} value={patient.reference}>{patient.name} · {patient.room && patient.bed ? `Qto ${patient.room} · Leito ${patient.bed}` : 'sem acomodação'}</option>)}</select></label></div><PatientAllergyAlert patient={patients.find((patient) => patient.reference === form.patient_reference)} /><label className="field"><span className="field-label">Objetivo ou observações</span><textarea maxLength={1000} rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label><div className="patient-form-actions"><button className="button button-secondary" type="button" onClick={() => setShowForm(false)} disabled={saving}>Cancelar</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar atividade'} <ArrowRight size={16} /></button></div></form>}
    <div className="therapy-layout"><section className="therapy-calendar-panel"><div className="therapy-calendar-heading"><button className="icon-button" type="button" aria-label="Mês anterior" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={19} /></button><h2>{monthLabel}</h2><button className="icon-button" type="button" aria-label="Próximo mês" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={19} /></button></div><div className="therapy-calendar-grid therapy-calendar-weekdays">{['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((day) => <span key={day}>{day}</span>)}</div><div className="therapy-calendar-grid">{calendarCells.map((cell, index) => cell ? <article className={`therapy-calendar-day ${cell.birthdays.length ? 'has-birthday' : ''} ${cell.activities.length ? 'has-activity' : ''}`} key={cell.dateKey}><strong>{cell.day}</strong>{cell.birthdays.slice(0, 2).map((patient) => <span className="therapy-calendar-tag birthday-tag" key={patient.reference} title={`Aniversário: ${patient.name}`}>🎂 {patient.name.split(' ')[0]}</span>)}{cell.activities.slice(0, 2).map((activity) => <span className="therapy-calendar-tag activity-tag" key={activity.id} title={activity.title}>• {activity.title}</span>)}{cell.birthdays.length + cell.activities.length > 4 && <small>+{cell.birthdays.length + cell.activities.length - 4}</small>}</article> : <span className="therapy-calendar-day therapy-calendar-empty" key={`empty-${index}`} />)}</div><div className="therapy-calendar-legend"><span><i className="legend-birthday" /> Aniversários</span><span><i className="legend-activity" /> Atividades</span></div></section>
      <aside className="therapy-birthday-panel"><div className="section-heading"><div><p className="eyebrow">DATAS ESPECIAIS</p><h2>Aniversários</h2></div><span className="module-total">{birthdaysThisMonth.length}</span></div>{birthdaysThisMonth.length ? <div className="therapy-birthday-list">{birthdaysThisMonth.map((patient) => <article key={patient.reference}><span className="birthday-date">{new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: '2-digit', month: 'short' }).format(new Date(`${month.getFullYear()}-${patient.birth_date!.slice(5)}T00:00:00Z`))}</span><div><strong>{patient.name}</strong><small>{patientLocationLabel(patient)}</small></div></article>)}</div> : <div className="history-empty">Nenhum aniversário cadastrado neste mês.</div>}<p className="field-hint">As datas são calculadas a partir do cadastro de pacientes autorizado para este perfil.</p></aside></div>
    <section className="therapy-activity-list"><div className="section-heading"><div><p className="eyebrow">PROGRAMAÇÃO</p><h2>Atividades de {monthLabel}</h2></div><span className="module-total">{visibleActivities.length} / {activities.length}</span></div><div className="psychology-filter-row"><label className="field"><span className="field-label">Buscar por atividade, local ou paciente</span><input value={activityQuery} onChange={(event) => setActivityQuery(event.target.value)} placeholder="Nome, local ou paciente" /></label><label className="field"><span className="field-label">Situação</span><select value={activityFilter} onChange={(event) => setActivityFilter(event.target.value as typeof activityFilter)}><option value="all">Todas</option>{Object.entries(therapyActivityStatusLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select></label></div>{loading ? <div className="history-empty">Carregando agenda…</div> : visibleActivities.length ? <div className="therapy-activity-grid">{visibleActivities.map((activity) => { const patient = patients.find((item) => item.reference === activity.patient_reference); return <article key={activity.id} className="therapy-activity-card"><span className="therapy-activity-date"><strong>{new Intl.DateTimeFormat('pt-BR', { day: '2-digit' }).format(new Date(activity.starts_at))}</strong><small>{new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(new Date(activity.starts_at))}</small></span><div><span className="eyebrow">{activity.activity_type} · {new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(activity.starts_at))} · {therapyActivityStatusLabels[reportStatuses[activity.id] ?? activity.status]}</span><h3>{activity.title}</h3><p>{activity.location}{patient ? ` · ${patient.name}` : ' · Grupo'}</p>{patient && <PatientAllergyAlert patient={patient} />}{activity.description && <small>{activity.description}</small>}</div></article> })}</div> : <div className="history-empty">{activities.length ? 'Nenhuma atividade corresponde aos filtros selecionados.' : 'Nenhuma atividade agendada para este mês.'}</div>}</section>
    <section className="therapy-report-panel"><div className="section-heading"><div><p className="eyebrow">ACOMPANHAMENTO</p><h2>Relatório de atividades · {monthLabel}</h2><p className="welcome-copy">{profile.modules.includes('therapy') ? 'Registre os resultados realizados e apresente o relatório à Gestão Hospitalar.' : 'Consulte os resultados registrados pela Oficina Terapêutica e imprima o relatório mensal.'}</p></div><button className="button button-secondary therapy-report-print-button" type="button" onClick={printActivityReport} disabled={!visibleActivities.length}><ClipboardList size={16} /> Gerar relatório</button></div>{loading ? <div className="history-empty">Carregando relatórios…</div> : visibleActivities.length ? <div className="therapy-report-list">{visibleActivities.map((activity) => { const patient = patients.find((item) => item.reference === activity.patient_reference); const reportStatus = reportStatuses[activity.id] ?? activity.status; return <article className="therapy-report-card" key={`report-${activity.id}`}><div className="therapy-report-heading"><div><p className="eyebrow">{dateTime(activity.starts_at)} · {activity.activity_type}</p><h3>{activity.title}</h3><p>{activity.location}{patient ? ` · ${patient.name}${patient.room && patient.bed ? ` · Quarto ${patient.room}, leito ${patient.bed}` : ''}` : ' · Grupo'}</p>{patient && <PatientAllergyAlert patient={patient} />}</div><span className={`therapy-report-status therapy-report-status-${reportStatus}`}>{therapyActivityStatusLabels[reportStatus]}</span></div>{profile.modules.includes('therapy') ? <><label className="field"><span className="field-label">Relato da atividade</span><textarea rows={4} maxLength={4000} value={reportDrafts[activity.id] ?? ''} onChange={(event) => setReportDrafts((items) => ({ ...items, [activity.id]: event.target.value }))} placeholder="Descreva a participação, os resultados observados e os encaminhamentos necessários." /></label><div className="therapy-report-actions"><label className="field"><span className="field-label">Situação</span><select value={reportStatus} onChange={(event) => setReportStatuses((items) => ({ ...items, [activity.id]: event.target.value as TherapyActivityStatus }))}><option value="scheduled">Agendada</option><option value="in_progress">Em andamento</option><option value="completed">Realizada</option><option value="cancelled">Cancelada</option></select></label><button className="button button-primary" type="button" onClick={() => void saveActivityReport(activity)} disabled={savingReportId === activity.id}>{savingReportId === activity.id ? 'Salvando…' : 'Salvar relatório'}</button></div></> : <p className="therapy-report-content">{activity.activity_report || 'Relatório ainda não registrado.'}</p>}{activity.report_updated_by && <small className="therapy-report-author">Última atualização por {activity.report_updated_by}{activity.report_updated_at ? ` · ${dateTime(activity.report_updated_at)}` : ''}</small>}</article> })}</div> : <div className="history-empty">{activities.length ? 'Nenhuma atividade corresponde aos filtros selecionados.' : 'Agende uma atividade para iniciar o relatório do mês.'}</div>}</section>
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
          const available = profile.modules.includes(id) || (id === 'therapy' && profile.modules.includes('management'))
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
    {helpOpen && <div className="install-dialog-backdrop" role="presentation" onClick={() => setHelpOpen(false)}><section className="install-dialog" role="dialog" aria-modal="true" aria-labelledby="install-dialog-title" onClick={(event) => event.stopPropagation()}><button className="install-dialog-close" type="button" aria-label="Fechar" onClick={() => setHelpOpen(false)}>×</button><h2 id="install-dialog-title">Instalar SCPO Connect</h2>{!window.isSecureContext ? <p>A instalação exige uma conexão segura. Abra o endereço HTTPS do SCPO e confirme que o navegador não exibe um aviso de certificado.</p> : /iPhone|iPad|iPod/i.test(navigator.userAgent) ? <p>No iPhone ou iPad, toque em <strong>Compartilhar</strong> e depois em <strong>Adicionar à Tela de Início</strong>. O iOS exige essa confirmação do sistema.</p> : /Android/i.test(navigator.userAgent) && /Chrome/i.test(navigator.userAgent) ? <p>No Chrome para Android, abra o menu <strong>⋮</strong> e escolha <strong>Instalar app</strong> ou <strong>Adicionar à tela inicial</strong>. Essa opção pode aparecer mesmo quando o botão de instalação direta não é liberado. Se não aparecer, confirme que o endereço HTTPS abre sem aviso de certificado, atualize a página e tente novamente.</p> : <p>Este navegador não liberou a instalação direta. Verifique se está usando um navegador compatível e se o endereço HTTPS abre sem aviso de certificado; também é possível procurar <strong>Instalar app</strong> ou <strong>Adicionar à tela inicial</strong> no menu do navegador.</p>}<button className="button button-primary" type="button" onClick={() => setHelpOpen(false)}>Entendi</button></section></div>}
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
  const [medicationDose, setMedicationDose] = useState('')
  const [selectedDispensation, setSelectedDispensation] = useState('')
  const [medicationSaving, setMedicationSaving] = useState(false)
  const [nursingTab, setNursingTab] = useState<'overview' | 'vitals' | 'medications' | 'safety'>('overview')

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
          dose: medicationDose,
          status: medicationStatus,
          reason: medicationReason.trim(),
        }),
      })
      const record = await readApiResponse<MedicationAdministration>(response)
      setAdministrations((current) => [record, ...current])
      setSelectedDispensation('')
      setMedicationDose('')
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
  const activePatientCount = patients.filter((patient) => patient.active !== false).length
  const allergyReviewCount = patients.filter((patient) => patient.active !== false && (!patient.allergies_status || patient.allergies_status === 'unknown')).length
  const pendingMedicationCount = dispensations.filter((dispensation) => dispensation.status === 'dispensed' && remainingDispensedQuantity(dispensation, administrations) > 0).length

  return (
    <section className="nursing-page page-enter">
      <div className="page-title-row"><div><p className="eyebrow">MÓDULO · ENFERMAGEM</p><h1>Enfermagem</h1><p className="welcome-copy">Visão do paciente, coleta integrada de sinais vitais e acompanhamento das filas de cuidado.</p></div><div className="nursing-title-actions"><button className="button button-primary" type="button" onClick={() => setNursingTab('vitals')}><Activity size={16} /> Sinais vitais</button><button className="button button-secondary" type="button" onClick={onShowHistory}><ClipboardList size={16} /> Coletas registradas</button><span className={`entry-status entry-status-${entryState}`}>{statusIcon}{stateLabels[entryState]}</span></div></div>
      <div className="patient-strip"><span className="patient-avatar"><Stethoscope size={19} /></span><label className="patient-copy"><span>Paciente</span><select value={patientRef} onChange={(event) => { setPatientRef(event.target.value); setNutritionPlan(null) }}>{patients.map((patient) => <option key={patient.reference} value={patient.reference}>{patient.name} · {patientLocationLabel(patient)}</option>)}</select></label><span className="entry-status">{treatmentTrackLabel(patients.find((patient) => patient.reference === patientRef)?.treatment_track)}</span><button className="button button-secondary" type="button" onClick={() => setShowPatientForm((visible) => !visible)}>Cadastrar paciente</button><div className="patient-meta"><span>Registrado por</span><strong>{profile.name}</strong></div></div>
      <PatientAllergyAlert patient={patients.find((patient) => patient.reference === patientRef)} />
      <div className="admin-tabs module-tabs nursing-tabs" role="tablist" aria-label="Seções de Enfermagem">
        <button className={`button ${nursingTab === 'overview' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={nursingTab === 'overview'} onClick={() => setNursingTab('overview')}>Visão geral</button>
        <button className={`button ${nursingTab === 'medications' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={nursingTab === 'medications'} onClick={() => setNursingTab('medications')}>Medicações</button>
        <button className={`button ${nursingTab === 'safety' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={nursingTab === 'safety'} onClick={() => setNursingTab('safety')}>Fila e segurança</button>
      </div>
      {nursingTab === 'medications' && <>
      <section className="nursing-medication-panel">
        <div className="section-heading"><div><p className="eyebrow">FARMÁCIA → ENFERMAGEM</p><h2>Dispensações deste paciente</h2><p className="welcome-copy">A Farmácia registra lote, prescrição e baixa de estoque; a Enfermagem registra administração, recusa ou suspensão.</p></div></div>
        {medicationError && <div className="form-message form-message-error" role="alert">{medicationError}</div>}
        {medicationLoading ? <p className="history-empty">Carregando dispensações…</p> : medicationError ? null : dispensations.filter((item) => item.patient_reference === patientRef && remainingDispensedQuantity(item, administrations) > 0).length > 0 ? <form className="field-grid field-grid-two" onSubmit={(event) => void saveMedicationAdministration(event)}>
          <label className="field"><span className="field-label">Dispensação pendente</span><select required value={selectedDispensation} onChange={(event) => { setSelectedDispensation(event.target.value); setMedicationDose('') }}><option value="">Selecione</option>{dispensations.filter((item) => item.patient_reference === patientRef && remainingDispensedQuantity(item, administrations) > 0).map((item) => <option key={item.id} value={item.id}>{item.medication_name} · saldo {remainingDispensedQuantity(item, administrations)} de {item.quantity} {item.unit} · {dateTime(item.created_at)}</option>)}</select></label>
          {selectedDispensation && (() => {
            const item = dispensations.find((dispensation) => dispensation.id === selectedDispensation)
            if (!item) return null
            return <label className="field"><span className="field-label">Quantidade desta administração ({item.unit})</span><input required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,3})?" maxLength={32} value={medicationDose} onChange={(event) => setMedicationDose(formatDecimalInput(event.target.value))} /><span className="field-hint">Ainda disponível nesta dispensação: {remainingDispensedQuantity(item, administrations)} {item.unit}. Informe somente a dose desta ação, não todo o saldo.</span></label>
          })()}
          <label className="field"><span className="field-label">Resultado</span><select value={medicationStatus} onChange={(event) => setMedicationStatus(event.target.value as MedicationAdministration['status'])}><option value="administered">Administrado</option><option value="refused">Recusado pelo paciente</option><option value="held">Suspenso / não administrado</option></select></label>
          {medicationStatus !== 'administered' && <label className="field"><span className="field-label">Motivo</span><input required minLength={3} maxLength={500} value={medicationReason} onChange={(event) => setMedicationReason(event.target.value)} /></label>}
          <button className="button button-primary" type="submit" disabled={medicationSaving || !selectedDispensation || !medicationDose}>{medicationSaving ? 'Salvando…' : 'Registrar ação de Enfermagem'}</button>
        </form> : <p className="history-empty">Não há dispensações pendentes para o paciente selecionado.</p>}
        {!!administrations.filter((record) => record.patient_reference === patientRef).length && <div className="nursing-medication-history">{administrations.filter((record) => record.patient_reference === patientRef).map((record) => <article key={record.id}><strong>{record.medication_name} · {record.dose} {record.unit}</strong><span>{record.status === 'administered' ? 'Administrado' : record.status === 'refused' ? 'Recusado' : 'Suspenso'} · {record.actor_name} · {dateTime(record.administered_at)}</span>{record.reason && <small>{record.reason}</small>}</article>)}</div>}
        <p className="work-order-privacy">Confirme paciente, alergias, prescrição, dose e momento correto segundo o protocolo institucional. Este registro não é prescrição nem orientação clínica automatizada.</p>
      </section>
      {nutritionPlan && (nutritionPlan.assessment_date || nutritionPlan.fasting_at) && <div className="care-plan-strip"><strong>Plano alimentar compartilhado</strong>{nutritionPlan.assessment_date && <span>Avaliação de {new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${nutritionPlan.assessment_date}T00:00:00Z`))} · {nutritionPlan.diet_type || 'Tipo de dieta não informado'}{nutritionPlan.restrictions ? ` · Restrições: ${nutritionPlan.restrictions}` : ''}</span>}{nutritionPlan.fasting_at && <span className="fasting-alert">Jejum programado: {dateTime(nutritionPlan.fasting_at)}{nutritionPlan.fasting_reason ? ` · ${nutritionPlan.fasting_reason}` : ''}</span>}</div>}
      </>}
      {showPatientForm && <form className="patient-create-form" onSubmit={addPatient}><label className="field"><span className="field-label">Nome do paciente</span><input required value={newPatient.name} onChange={(event) => setNewPatient({ ...newPatient, name: event.target.value })} /></label><label className="field"><span className="field-label">Quarto</span><input required value={newPatient.room} onChange={(event) => setNewPatient({ ...newPatient, room: event.target.value })} /></label><label className="field"><span className="field-label">Leito</span><input required value={newPatient.bed} onChange={(event) => setNewPatient({ ...newPatient, bed: event.target.value })} /></label><button className="button button-primary" type="submit">Salvar paciente</button></form>}
      {historyError && <div className="form-message form-message-error" role="alert">{historyError}</div>}

      {nursingTab === 'overview' && patients.length > 0 ? (
        <section className="patient-list-panel nursing-overview">
          <div className="section-heading"><div><p className="eyebrow">ACOMPANHAMENTO DO TURNO</p><h2>Resumo de Enfermagem</h2><p className="welcome-copy">Indicadores cadastrais e pendências de registro para orientar a navegação; não representam avaliação clínica.</p></div></div>
          <div className="nursing-overview-summary">
            <article><strong>{activePatientCount}</strong><span>Pacientes ativos no cadastro</span></article>
            <article className={allergyReviewCount ? 'nursing-overview-warning' : ''}><strong>{allergyReviewCount}</strong><span>Cadastros com alergias ainda não revisadas</span></article>
            <article><strong>{pendingMedicationCount}</strong><span>Dispensações sem registro de ação da Enfermagem</span></article>
          </div>
          <div className="nursing-overview-patient"><div><p className="eyebrow">PACIENTE SELECIONADO</p><strong>{patients.find((patient) => patient.reference === patientRef)?.name ?? 'Selecione um paciente'}</strong><span>{patients.find((patient) => patient.reference === patientRef) ? patientLocationLabel(patients.find((patient) => patient.reference === patientRef)!) : 'Cadastro necessário para iniciar registros.'}</span></div><button className="button button-primary" type="button" onClick={() => setNursingTab('vitals')} disabled={!patientRef}><Activity size={16} /> Iniciar coleta de sinais vitais</button></div>
          {patientRef ? <VitalTrendsDashboard patientReference={patientRef} /> : <div className="placeholder-state patient-empty-state"><span className="placeholder-state-icon"><UsersRound size={20} /></span><div><strong>Selecione um paciente</strong><p>Os gráficos de evolução ficam disponíveis depois que um paciente é escolhido para a consulta.</p></div></div>}
          <div className="nursing-overview-actions">
            <button className="button button-secondary" type="button" onClick={() => setNursingTab('medications')}>Conferir medicações <ArrowRight size={15} /></button>
            <button className="button button-secondary" type="button" onClick={() => setNursingTab('safety')}>Abrir fila e segurança <ArrowRight size={15} /></button>
            <button className="button button-secondary" type="button" onClick={onShowHistory}>Consultar coletas registradas <ArrowRight size={15} /></button>
          </div>
        </section>
      ) : nursingTab !== 'safety' && nursingTab !== 'medications' && patients.length === 0 ? (
        <section className="placeholder-state patient-empty-state"><span className="placeholder-state-icon"><UsersRound size={20} /></span><div><strong>Cadastre o primeiro paciente</strong><p>Informe nome, quarto e leito para iniciar a coleta e manter o histórico vinculado ao paciente.</p></div><button className="button button-primary" type="button" onClick={() => setShowPatientForm(true)}>Cadastrar paciente</button></section>
      ) : nursingTab === 'vitals' && (entryState === 'review' || entryState === 'saving') ? (
        <ReviewPanel record={record} notApplicable={notApplicable} patient={patients.find((item) => item.reference === patientRef)} onBack={() => setEntryState('draft')} onConfirm={saveRecord} isSaving={entryState === 'saving'} />
      ) : nursingTab === 'vitals' && entryState === 'saved' ? (
        <SavedConfirmation savedAt={savedAt} actorName={profile.name} patient={patients.find((item) => item.reference === patientRef)} onReset={resetRecord} />
      ) : nursingTab === 'vitals' ? (
        <form className="nursing-form" onSubmit={(event) => { event.preventDefault(); setNursingTab('vitals'); setEntryState('review'); setMessage('') }}>
          {nursingTab === 'vitals' && <>
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
          </>}

          {nursingTab === 'vitals' && <>
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
          </>}

          {nursingTab === 'vitals' && <>
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
          </>}

          {message && <div className={`form-message ${entryState === 'error' ? 'form-message-error' : ''}`} role="status">{message}</div>}
          <div className="form-actions"><span className="draft-hint"><Pencil size={14} /> Rascunho temporário nesta sessão</span><button className="button button-primary" type="submit">Revisar {nursingTab === 'vitals' ? 'coleta' : 'registro'} <ArrowRight size={17} /></button></div>
        </form>) : null}

      {nursingTab === 'vitals' && <div className="clinical-note"><ShieldCheck size={17} /><span>Os gráficos apresentam os valores registrados, sem interpretação clínica automática.</span></div>}
      {nursingTab === 'safety' && <ClinicalQueuePanel canUpdate={user.permissions.nursing?.includes('alterar') ?? false} />}
      {nursingTab === 'safety' && <PatientFlowRiskPanel
        patients={patients}
        canUpdate={user.permissions.nursing?.includes('alterar') ?? false}
        onPatientUpdated={(updated) => setPatients((current) => current.map((patient) => patient.reference === updated.reference ? updated : patient))}
      />}
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
      const openArrivals = (data.arrivals ?? []).filter((arrival) => arrival.status === 'waiting' || arrival.status === 'called' || arrival.status === 'in_service')
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
        const openArrivals = (data.arrivals ?? []).filter((arrival) => arrival.status === 'waiting' || arrival.status === 'called' || arrival.status === 'in_service')
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
        {arrival.allergy_report_status === 'reported' && <div className="clinical-alert" role="alert"><AlertTriangle size={19} /><div><strong>Alergia relatada · aguarda confirmação clínica</strong><span>{arrival.reported_allergies || 'Detalhes não disponíveis nesta fila.'}</span></div></div>}
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
  const [destinationBedId, setDestinationBedId] = useState('')
  const [beds, setBeds] = useState<HospitalBed[]>([])
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
      const [flowResponse, allergyResponse, riskResponse, bedResponse] = await Promise.all([
        fetch(`/api/v1/nursing/patients/flow-events?patient_reference=${encodeURIComponent(reference)}&limit=20`),
        fetch(`/api/v1/nursing/patients/${encodeURIComponent(reference)}/allergy-history`),
        fetch('/api/v1/nursing/clinical-risks'),
        fetch('/api/v1/nursing/beds'),
      ])
      const [flowData, allergyData, riskData, bedData] = await Promise.all([
        readApiResponse<{ events?: PatientFlowEvent[] }>(flowResponse),
        readApiResponse<{ events?: typeof allergyEvents }>(allergyResponse),
        readApiResponse<{ risks?: ClinicalRisk[] }>(riskResponse),
        readApiResponse<{ beds?: HospitalBed[] }>(bedResponse),
      ])
      setFlowEvents(flowData.events ?? [])
      setAllergyEvents(allergyData.events ?? [])
      setRisks((riskData.risks ?? []).filter((risk) => risk.risk_type === 'contraindication' && risk.patient_reference === reference))
      setBeds(bedData.beds ?? [])
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
        const [flowResponse, allergyResponse, riskResponse, bedResponse] = await Promise.all([
          fetch(`/api/v1/nursing/patients/flow-events?patient_reference=${encodeURIComponent(patientReferenceForFlow)}&limit=20`),
          fetch(`/api/v1/nursing/patients/${encodeURIComponent(patientReferenceForFlow)}/allergy-history`),
          fetch('/api/v1/nursing/clinical-risks'),
          fetch('/api/v1/nursing/beds'),
        ])
        const [flowData, allergyData, riskData, bedData] = await Promise.all([
          readApiResponse<{ events?: PatientFlowEvent[] }>(flowResponse),
          readApiResponse<{ events?: typeof allergyEvents }>(allergyResponse),
          readApiResponse<{ risks?: ClinicalRisk[] }>(riskResponse),
          readApiResponse<{ beds?: HospitalBed[] }>(bedResponse),
        ])
        if (!active) return
        setFlowEvents(flowData.events ?? [])
        setAllergyEvents(allergyData.events ?? [])
        setRisks((riskData.risks ?? []).filter((risk) => risk.risk_type === 'contraindication' && risk.patient_reference === patientReferenceForFlow))
        setBeds(bedData.beds ?? [])
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
        body: JSON.stringify(isTransfer ? { bed_id: destinationBedId, reason } : { reason, summary }),
      })
      const data = await readApiResponse<{ patient: Patient; event: PatientFlowEvent }>(response)
      onPatientUpdated(data.patient)
      setFlowEvents((current) => [data.event, ...current])
      setDestinationBedId(''); setReason(''); setSummary('')
      setNotice(isTransfer ? 'Transferência registrada e leito de destino validado.' : 'Alta registrada; o leito foi liberado e o histórico mantido.')
      await loadPatientFlow(patient.reference)
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
      <div className="admin-tabs module-tabs" role="tablist" aria-label="Ações de fluxo do paciente">
        <button className={`button ${flowType === 'transfer' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={flowType === 'transfer'} onClick={() => setFlowType('transfer')}>Transferência</button>
        <button className={`button ${flowType === 'discharge' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={flowType === 'discharge'} onClick={() => setFlowType('discharge')}>Alta</button>
      </div>
      {canUpdate && <form className="account-create-panel" onSubmit={(event) => void savePatientFlow(event)}>
        {flowType === 'transfer' ? <div className="field-grid field-grid-two">
          <label className="field"><span className="field-label">Leito físico de destino</span><select required value={destinationBedId} onChange={(event) => setDestinationBedId(event.target.value)}><option value="">Selecione unidade, quarto e leito disponível</option>{beds.filter((bed) => bed.status === 'available' && !bed.occupied).map((bed) => <option key={bed.id} value={bed.id}>{bed.unit_name} · Quarto {bed.room} · Leito {bed.label}</option>)}</select>{!beds.some((bed) => bed.status === 'available' && !bed.occupied) && <span className="field-hint">Não há leitos físicos liberados. Solicite cadastro ou liberação em Gestão Hospitalar.</span>}</label>
          <label className="field"><span className="field-label">Motivo da transferência</span><input required minLength={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        </div> : <>
          <label className="field"><span className="field-label">Motivo da alta</span><input required minLength={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          <label className="field"><span className="field-label">Resumo / orientações de continuidade (opcional)</span><textarea maxLength={2000} value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
          <p className="work-order-privacy">Este registro não substitui sumário clínico, prescrição de alta nem orientações assinadas conforme protocolo institucional.</p>
        </>}
        <button className="button button-primary" type="submit" disabled={busy || (flowType === 'transfer' && !destinationBedId)}>{busy ? 'Registrando…' : flowType === 'transfer' ? 'Registrar transferência' : 'Registrar alta e liberar leito'}</button>
      </form>}
      <section className="patient-list-panel"><div className="section-heading"><div><p className="eyebrow">ALERGIAS E CONTRAINDICAÇÕES</p><h3>Riscos ativos e auditoria</h3></div><span className="module-total">{risks.length + (patient?.allergies_status !== 'none_known' ? 1 : 0)} alertas</span></div>
        {risks.map((risk) => <article className="collection-row" key={risk.id}><div className="collection-row-heading"><strong>Contraindicação · {risk.severity === 'unspecified' ? 'gravidade não especificada' : risk.severity}</strong><span>{risk.description}</span></div><small>Registrada por {risk.actor_name} · {dateTime(risk.created_at)} · Motivo: {risk.reason}</small>{canUpdate && <button className="button button-secondary" type="button" disabled={busy} onClick={() => void resolveRisk(risk.id)}>Registrar resolução</button>}</article>)}
        {patient?.allergies_status === 'known' && <article className="clinical-alert" role="alert"><AlertTriangle size={19} /><div><strong>Alergia conhecida</strong><span>{patient.allergies}</span></div></article>}
        {canUpdate && <form className="account-create-panel" onSubmit={(event) => void createRisk(event)}><div className="field-grid field-grid-three"><label className="field"><span className="field-label">Nova contraindicação</span><input required minLength={3} maxLength={1000} value={riskDescription} onChange={(event) => setRiskDescription(event.target.value)} placeholder="Substância, procedimento ou risco identificado" /></label><label className="field"><span className="field-label">Gravidade registrada</span><select value={riskSeverity} onChange={(event) => setRiskSeverity(event.target.value as ClinicalRisk['severity'])}><option value="unspecified">Não especificada</option><option value="low">Baixa</option><option value="moderate">Moderada</option><option value="high">Alta</option></select></label><label className="field"><span className="field-label">Justificativa / fonte</span><input required minLength={3} maxLength={300} value={riskReason} onChange={(event) => setRiskReason(event.target.value)} /></label></div><button className="button button-primary" type="submit" disabled={busy}>Registrar contraindicação</button></form>}
        {allergyEvents.length > 0 && <details className="patient-risk-audit"><summary>Histórico de alterações de alergia ({allergyEvents.length})</summary><div className="collection-list">{allergyEvents.map((event) => <article className="collection-row" key={event.id}><div className="collection-row-heading"><strong>{event.previous_status} → {event.new_status}</strong><time>{dateTime(event.recorded_at)}</time></div><p>{event.previous_details || 'Sem detalhe anterior'} → {event.new_details || 'Sem detalhe registrado'}</p><small>{event.actor_name} · {event.reason}</small></article>)}</div></details>}
      </section>
      {flowEvents.length > 0 && <section className="patient-list-panel"><div className="section-heading"><div><p className="eyebrow">MOVIMENTAÇÃO ASSISTENCIAL</p><h3>Histórico de admissões, transferências e altas</h3></div><span className="module-total">{flowEvents.length} eventos</span></div><div className="collection-list">{flowEvents.map((event) => <article className="collection-row" key={event.id}><div className="collection-row-heading"><strong>{event.event_type === 'admission' ? `Internação · Qto ${event.next_room}, leito ${event.next_bed}` : event.event_type === 'transfer' ? `Transferência · Qto ${event.previous_room}, leito ${event.previous_bed} → Qto ${event.next_room}, leito ${event.next_bed}` : `Alta · Qto ${event.previous_room}, leito ${event.previous_bed}`}</strong><time>{dateTime(event.occurred_at)}</time></div><p>{event.reason}</p>{event.summary && <p>{event.summary}</p>}<small>Registrado por {event.actor_name}</small></article>)}</div></section>}
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
    <div className="field value-field"><label className="field-label" htmlFor={id}>{label}</label><div className={`input-with-unit ${isNA ? 'input-na' : ''}`}><input id={id} type="text" inputMode={inputMode} value={value} onChange={(event) => onChange(inputMode === 'decimal' ? formatDecimalInput(event.target.value) : event.target.value)} placeholder={isNA ? 'Não se aplica' : placeholder ?? 'Não preenchido'} disabled={disabled} /><span className="unit-label">{unit}</span></div><label className="checkbox-label"><input type="checkbox" checked={isNA} onChange={onNA} /><span>Não se aplica</span></label></div>
  )
}

function TextField({ label, value, onChange, placeholder, inputMode }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; inputMode?: 'numeric' | 'decimal' }) {
  const id = `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return <label className="field" htmlFor={id}><span className="field-label">{label}</span><input id={id} type="text" inputMode={inputMode} value={value} onChange={(event) => onChange(inputMode === 'decimal' ? formatDecimalInput(event.target.value) : event.target.value)} placeholder={placeholder} /></label>
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

type Account = { id: string; username: string; name: string; modules: string[]; permissions: Record<string, string[]>; active: boolean; must_change_password: boolean; mfa_enabled: boolean; is_superuser: boolean }

const moduleLabels: Record<string, string> = {
  patients: 'Pacientes', nursing: 'Enfermagem', pharmacy: 'Farmácia', xray: 'Raio X', social: 'Serviço Social',
  nutrition: 'Nutrição', hygiene: 'Higienização', reception: 'Recepção', therapy: 'Oficina Terapêutica',
  psychology: 'Psicologia / Psiquiatria', maintenance: 'Manutenção',
  management: 'Gestão Hospitalar', admin: 'Administração',
}
const accessModules = Object.entries(moduleLabels).filter(([module]) => module !== 'admin')

function AdminPage() {
  const [tab, setTab] = useState<'users' | 'audit'>('users')
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
      setNotice(`Conta ${data.username} criada. Senha temporária de uso único: ${data.initial_password}. Entregue-a diretamente ao usuário; a troca e a ativação do MFA serão obrigatórias no primeiro acesso.`)
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

  return <section className="admin-page page-enter">
    <div className="page-title-row"><div><p className="eyebrow">ADMINISTRAÇÃO</p><h1>{tab === 'users' ? 'Usuários e permissões' : 'Logs de auditoria'}</h1><p className="welcome-copy">{tab === 'users' ? 'Crie contas individuais e conceda acesso aos módulos.' : 'Consulte os eventos administrativos registrados pelo sistema.'}</p></div><span className={`entry-status ${status === 'ready' ? 'entry-status-saved' : 'entry-status-draft'}`}>{status === 'loading' ? <span className="spinner" /> : status === 'ready' ? <BadgeCheck size={15} /> : <LockKeyhole size={15} />}{status === 'loading' ? 'Carregando' : status === 'ready' ? 'Serviço conectado' : 'Serviço indisponível'}</span></div>
    <div className="admin-tabs module-tabs" role="tablist" aria-label="Seções de Administração"><button className={`button ${tab === 'users' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={tab === 'users'} onClick={() => setTab('users')}>Usuários e permissões</button><button className={`button ${tab === 'audit' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={tab === 'audit'} onClick={() => setTab('audit')}>Logs de auditoria</button></div>
    {tab === 'users' && <>
    <div className="admin-warning"><ShieldCheck size={19} /><div><strong>Senha temporária exclusiva, troca obrigatória e MFA.</strong><span>Uma senha aleatória de uso único é gerada para cada conta. Entregue-a ao titular por um canal seguro.</span></div></div>
    {status === 'unavailable' && <div className="form-message form-message-error" role="alert">Não foi possível carregar usuários. Confirme se as APIs e o banco estão ativos.</div>}
    {notice && <div className="form-message" role="status">{notice}</div>}
    <form className="account-create-panel" onSubmit={createAccount}><div className="users-heading"><div><p className="eyebrow">NOVA CONTA</p><h2>Cadastrar usuário</h2></div></div><div className="field-grid field-grid-two"><label className="field"><span className="field-label">Nome completo</span><input required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label><label className="field"><span className="field-label">Usuário de acesso</span><input required minLength={3} maxLength={80} pattern="[A-Za-z0-9._@-]+" value={username} onChange={(event) => setUsername(event.target.value)} /></label></div><fieldset className="module-permission-fieldset"><legend>Módulos permitidos</legend><div className="module-permission-grid">{accessModules.map(([module, label]) => <label className="checkbox-label" key={module}><input type="checkbox" checked={selectedModules.includes(module)} onChange={() => toggleModule(module)} /><span>{label}</span></label>)}</div></fieldset><div className="form-actions"><span className="draft-hint">Selecione um ou mais módulos. Permissões serão registradas na auditoria.</span><button className="button button-primary" type="submit" disabled={saving || selectedModules.length === 0}>{saving ? 'Criando…' : 'Criar usuário'}</button></div></form>
    <section className="users-panel"><div className="users-heading"><div><p className="eyebrow">CONTAS LOCAIS</p><h2>Usuários cadastrados</h2></div><span className="module-total">{users.length} contas</span></div><div className="account-list">{users.map((user) => <AccountRow key={user.id} user={user} onUpdate={updateAccount} />)}{status === 'ready' && users.length === 0 && <p className="account-empty">Nenhuma conta cadastrada.</p>}</div></section>
    <section className="permission-map"><div className="panel-heading"><div><p className="eyebrow">CONTROLE DE ACESSO</p><h2>Acesso individual por módulo</h2></div><LockKeyhole size={18} /></div><div className="permission-legend"><span><strong>Consultar</strong> abrir registros autorizados</span><span><strong>Criar</strong> adicionar registros no módulo</span><span><strong>Alterar</strong> modificar registros autorizados</span><span><strong>Excluir</strong> arquivar registros clínicos com justificativa</span><span><strong>Administrar</strong> usuários e permissões</span></div></section>
    </>}
    {tab === 'audit' && <AuditLogPanel />}
  </section>
}

function AccountRow({ user, onUpdate }: { user: Account; onUpdate: (user: Account, body: Record<string, unknown>, success: string) => Promise<void> }) {
  const [editModules, setEditModules] = useState(user.modules.filter((module) => module !== 'admin'))
  const [editPermissions, setEditPermissions] = useState(user.permissions)
  const [expanded, setExpanded] = useState(false)
  return <article className="account-row"><div className="account-row-main"><div className="user-name"><span className="avatar avatar-small">{user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span><strong>{user.name}<small>{user.username}{user.must_change_password ? ' · troca de senha pendente' : ''}{!user.mfa_enabled ? ' · MFA pendente' : ''}</small></strong></div><div className="user-modules">{user.modules.map((module) => <span key={module}>{moduleLabels[module] ?? module}</span>)}</div><span className={`account-state ${user.active ? 'account-active' : 'account-disabled'}`}><span className="status-dot" />{user.active ? 'Ativa' : 'Inativa'}</span><button className="user-action" type="button" onClick={() => void onUpdate(user, { active: !user.active }, `Conta ${user.active ? 'desativada' : 'ativada'}.`)}>{user.active ? 'Desativar' : 'Ativar'}</button><button className="user-action" type="button" onClick={() => { setEditModules(user.modules.filter((module) => module !== 'admin')); setEditPermissions(user.permissions); setExpanded((value) => !value) }}>{expanded ? 'Fechar acessos' : 'Editar acessos'}</button></div>{expanded && <div className="account-access-editor"><p className="field-label">Módulos permitidos</p><div className="module-permission-grid">{accessModules.map(([module, label]) => <label className="checkbox-label" key={module}><input type="checkbox" checked={editModules.includes(module)} onChange={() => setEditModules((current) => current.includes(module) ? current.filter((item) => item !== module) : [...current, module])} /><span>{label}</span></label>)}</div><fieldset className="module-permission-fieldset"><legend>Permitir arquivamento de registros clínicos</legend>{(['patients', 'nursing', 'nutrition', 'reception'] as const).map((module) => <label className="checkbox-label" key={module}><input type="checkbox" disabled={!editModules.includes(module)} checked={Boolean(editPermissions[module]?.includes('excluir'))} onChange={() => setEditPermissions((current) => ({ ...current, [module]: current[module]?.includes('excluir') ? current[module].filter((permission) => permission !== 'excluir') : [...(current[module] ?? ['consultar', 'criar', 'alterar']), 'excluir'] }))} /><span>{moduleLabels[module]}</span></label>)}</fieldset><button className="button button-secondary" type="button" disabled={!editModules.length} onClick={() => void onUpdate(user, { modules: editModules, permissions: Object.fromEntries(editModules.map((module) => [module, editPermissions[module] ?? ['consultar', 'criar', 'alterar']])) }, 'Acessos atualizados e registrados na auditoria.')}>Salvar acessos</button></div>}</article>
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
  const [heightDigits, setHeightDigits] = useState('')
  const [heightFocused, setHeightFocused] = useState(false)
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
      const response = await fetch('/api/v1/nursing/nutrition', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, weight_kg: formatDecimalInput(form.weight_kg), height_cm: toHeightCentimeters(heightDigits), fasting_at: form.fasting_at ? new Date(form.fasting_at).toISOString() : null, patient_reference: selectedPatient }) })
      const savedRecord = await readApiResponse<NutritionRecordData>(response)
      setSelectedPatientRecord(savedRecord)
      setPatients((current) => current.map((patient) => patient.reference === selectedPatient ? { ...patient, allergies: form.allergies, allergies_status: form.allergies_status } : patient))
      setForm({ ...form, weight_kg: '', height_cm: '', diet_type: '', restrictions: '', appetite: '', hydration: '', notes: '', fasting_at: '', fasting_reason: '' })
      setHeightDigits('')
      setHeightFocused(false)
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
      <div className="field-grid field-grid-three"><label className="field"><span className="field-label">Data da avaliação</span><input type="date" required value={form.assessment_date} onChange={(event) => setForm({ ...form, assessment_date: event.target.value })} /></label><label className="field"><span className="field-label">Peso</span><span className="input-with-unit"><input inputMode="decimal" value={form.weight_kg} onChange={(event) => setForm({ ...form, weight_kg: formatDecimalInput(event.target.value) })} placeholder="Ex.: 68,5" /><span className="unit-label">kg</span></span></label><label className="field"><span className="field-label">Altura</span><span className="input-with-unit"><input inputMode="numeric" maxLength={3} value={heightFocused ? heightDigits : formatHeightCentimeters(heightDigits)} onFocus={() => setHeightFocused(true)} onChange={(event) => setHeightDigits(event.target.value.replace(/\D/g, '').slice(0, 3))} onBlur={() => setHeightFocused(false)} placeholder="Ex.: 187" /><span className="unit-label">{heightFocused ? 'cm' : 'm'}</span></span><span className="field-hint">Digite em centímetros; ao sair do campo, 187 será exibido como 1,87 m.</span></label></div>
      <div className="field-grid field-grid-three"><label className="field"><span className="field-label">Tipo de dieta</span><select value={form.diet_type} onChange={(event) => setForm({ ...form, diet_type: event.target.value })}><option value="">Selecione</option><option>Geral</option><option>Branda</option><option>Pastosa</option><option>Líquida</option><option>Enteral</option><option>Jejum</option><option>Outra</option></select></label><label className="field"><span className="field-label">Aceitação alimentar</span><select value={form.appetite} onChange={(event) => setForm({ ...form, appetite: event.target.value })}><option value="">Selecione</option><option value="normal">Normal</option><option value="reduced">Reduzida</option><option value="poor">Baixa</option><option value="increased">Aumentada</option></select></label><label className="field"><span className="field-label">Hidratação</span><select value={form.hydration} onChange={(event) => setForm({ ...form, hydration: event.target.value })}><option value="">Selecione</option><option value="adequate">Adequada</option><option value="low">Baixa</option><option value="assisted">Necessita auxílio</option></select></label></div>
      <div className="field-grid field-grid-two"><AllergyFields status={form.allergies_status} allergies={form.allergies} onChange={(allergies_status, allergies) => setForm((current) => ({ ...current, allergies_status, allergies }))} title="Alergias do paciente" includeFoodHint maxLength={500} /><label className="field"><span className="field-label">Restrições alimentares</span><textarea maxLength={500} value={form.restrictions} onChange={(event) => setForm({ ...form, restrictions: event.target.value })} placeholder="Restrições e orientações dietéticas" /></label></div>
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
    patient_admissions_today: number
    patient_discharges_today: number
    appointments_today: number
    appointments_pending_today: number
    appointments_no_show_today: number
    beds_in_cleaning: number
    beds_in_maintenance: number
    open_safety_incidents: number
    serious_open_safety_incidents: number
    documents_pending_review: number
    approved_documents_expired: number
    approved_documents_expiring_soon: number
    physical_beds: number
    mapped_occupied_beds: number
    operational_beds: number
    available_beds: number
    unreconciled_legacy_patients: number
    occupancy_percent: number | null
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
        <article><strong>{summary?.occupied_beds ?? '—'}</strong><span>Pacientes com localização registrada</span></article>
        <article><strong>{summary?.physical_beds ?? '—'}</strong><span>Leitos físicos cadastrados</span></article>
        <article><strong>{summary?.occupancy_percent === null || summary?.occupancy_percent === undefined ? '—' : `${summary.occupancy_percent}%`}</strong><span>Ocupação física validada</span></article>
        <article><strong>{summary?.active_patients ?? '—'}</strong><span>Pacientes ativos</span></article>
        <article><strong>{summary?.open_emergency_arrivals ?? '—'}</strong><span>Chegadas em atendimento</span></article>
        <article><strong>{summary?.emergency_arrivals_today ?? '—'}</strong><span>Chegadas hoje</span></article>
        <article><strong>{summary?.vital_records_today ?? '—'}</strong><span>Coletas de enfermagem hoje</span></article>
        <article><strong>{summary?.appointments_today ?? '—'}</strong><span>Agendamentos hoje</span></article>
        <article><strong>{summary ? summary.beds_in_cleaning + summary.beds_in_maintenance : '—'}</strong><span>Leitos em higienização/manutenção</span></article>
        <article><strong>{summary?.open_safety_incidents ?? '—'}</strong><span>Incidentes de segurança abertos</span></article>
        <article><strong>{summary?.documents_pending_review ?? '—'}</strong><span>Documentos aguardando revisão</span></article>
        <article><strong>{stockAvailable ? criticalStock : '—'}</strong><span>Itens abaixo do mínimo</span></article>
      </div>
      <div className="executive-risk-strip" role="status"><AlertTriangle size={18} /><span><strong>Alertas assistenciais:</strong> {summary?.patients_with_known_allergies ?? '—'} paciente(s) com alergia conhecida, {summary?.patients_without_allergy_confirmation ?? '—'} sem confirmação e {summary?.active_contraindications ?? '—'} contraindicação(ões) ativa(s).</span></div>
      <div className="executive-summary-grid">
        <article><strong>Fluxo de leitos hoje</strong><span>{summary?.patient_admissions_today ?? '—'} admissões · {summary?.patient_transfers_today ?? '—'} transferências · {summary?.patient_discharges_today ?? '—'} altas</span></article>
        <article><strong>Agenda de hoje</strong><span>{summary?.appointments_pending_today ?? '—'} pendentes · {summary?.appointments_no_show_today ?? '—'} não compareceram</span></article>
        <article><strong>Segurança do paciente</strong><span>{summary?.open_safety_incidents ?? '—'} incidentes abertos · {summary?.serious_open_safety_incidents ?? '—'} graves/críticos</span></article>
        <article><strong>Documentos institucionais</strong><span>{summary?.documents_pending_review ?? '—'} aguardando revisão · {summary?.approved_documents_expired ?? '—'} vencidos · {summary?.approved_documents_expiring_soon ?? '—'} vencem em até 30 dias</span></article>
        <article><strong>Validade de estoque</strong><span>{stockAvailable ? `${expiredStock} lote(s) vencido(s) · ${expiringStock} vencendo em até 30 dias` : 'Indicador indisponível'}</span></article>
      </div>
      {stockAlerts.length > 0 && <section className="executive-stock-alerts"><div className="section-heading"><div><p className="eyebrow">LOGÍSTICA · AÇÃO NECESSÁRIA</p><h3>Estoque crítico e validade</h3></div><span className="module-total">{stockAlerts.length} alertas</span></div><div className="collection-list">{stockAlerts.slice(0, 8).map((alert) => <article className="collection-row" key={alert.item_id}><div className="collection-row-heading"><strong>{alert.item_name}</strong><span>{alert.balance} {alert.unit} disponíveis</span></div><small>{alert.alert_types.includes('expired') ? 'Lote vencido' : alert.alert_types.includes('expiring') ? `Vencimento em ${Math.max(0, alert.days_to_expiry)} dias` : 'Abaixo do mínimo'} · Reposição sugerida: {alert.suggested_replenishment} {alert.unit} · Validade {alert.expiry_date}</small></article>)}</div></section>}
      {summary?.updated_at && <p className="field-hint">Atualizado em {dateTime(summary.updated_at)}. {summary.unreconciled_legacy_patients > 0 ? `${summary.unreconciled_legacy_patients} localização(ões) legada(s) aguardam reconciliação; o percentual não é calculado.` : summary.occupancy_percent === null ? 'Percentual indisponível até haver leitos físicos operacionais cadastrados.' : `Ocupação calculada sobre ${summary.operational_beds} leito(s) operacional(is), com ${summary.available_beds} disponível(is).`} Agenda considera o dia local de São Paulo; incidentes são os não encerrados e a validade documental considera documentos aprovados.</p>}
    </>}
  </section>
}

function HospitalBedManagement() {
  type Unit = { id: string; name: string }
  type Capacity = { total_beds: number; operational_beds: number; occupied_beds: number; available_beds: number; unreconciled_legacy_patients: number; occupancy_percent: number | null }
  const [units, setUnits] = useState<Unit[]>([])
  const [beds, setBeds] = useState<HospitalBed[]>([])
  const [patients, setPatients] = useState<Patient[]>([])
  const [capacity, setCapacity] = useState<Capacity | null>(null)
  const [unitName, setUnitName] = useState('')
  const [unitId, setUnitId] = useState('')
  const [room, setRoom] = useState('')
  const [label, setLabel] = useState('')
  const [isolationCapable, setIsolationCapable] = useState(false)
  const [patientReference, setPatientReference] = useState('')
  const [reconciliationBedId, setReconciliationBedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async (preferredUnitId = '') => {
    try {
      const [bedData, patientData] = await Promise.all([
        fetch('/api/v1/nursing/beds').then(readApiResponse<{ units?: Unit[]; beds?: HospitalBed[]; capacity?: Capacity }>),
        fetch('/api/v1/nursing/patients').then(readApiResponse<{ patients?: Patient[] }>),
      ])
      setUnits(bedData.units ?? [])
      setBeds(bedData.beds ?? [])
      setCapacity(bedData.capacity ?? null)
      setPatients(patientData.patients ?? [])
      setUnitId((current) => {
        if (bedData.units?.some((unit) => unit.id === current)) return current
        if (preferredUnitId && bedData.units?.some((unit) => unit.id === preferredUnitId)) return preferredUnitId
        return bedData.units?.[0]?.id ?? ''
      })
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar o mapa de leitos.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const assignedPatients = new Set(beds.flatMap((bed) => bed.patient_reference ? [bed.patient_reference] : []))
  const unreconciledPatients = patients.filter((patient) => patient.active !== false && patient.room && patient.bed && !assignedPatients.has(patient.reference))
  const reconcileCandidates = beds.filter((bed) => bed.status === 'available' && !bed.occupied && bed.room === (unreconciledPatients.find((patient) => patient.reference === patientReference)?.room ?? '') && bed.label === (unreconciledPatients.find((patient) => patient.reference === patientReference)?.bed ?? ''))

  async function submitMutation(path: string, body: object, success: string) {
    setSaving(true); setError(''); setNotice('')
    try {
      const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      await readApiResponse(response)
      setNotice(success)
      await load()
      return true
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar a configuração dos leitos.')
      return false
    } finally { setSaving(false) }
  }

  async function createUnit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true); setError(''); setNotice('')
    try {
      const unit = await readApiResponse<Unit>(await fetch('/api/v1/management/units', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: unitName.trim() }),
      }))
      setUnits((current) => [...current.filter((item) => item.id !== unit.id), unit].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')))
      setUnitId(unit.id)
      setUnitName('')
      setNotice('Unidade cadastrada e selecionada para criação de leitos.')
      await load(unit.id)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível cadastrar a unidade.')
    } finally {
      setSaving(false)
    }
  }

  async function updateStatus(bed: HospitalBed, status: HospitalBed['status']) {
    setSaving(true); setError(''); setNotice('')
    try {
      const response = await fetch(`/api/v1/management/beds/${encodeURIComponent(bed.id)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      await readApiResponse(response)
      setNotice(`Situação atualizada: ${bed.unit_name}, quarto ${bed.room}, leito ${bed.label}.`)
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível atualizar a situação do leito.')
    } finally { setSaving(false) }
  }

  return <section className="patient-list-panel">
    <div className="section-heading"><div><p className="eyebrow">CAPACIDADE FÍSICA</p><h2>Unidades e mapa de leitos</h2><p className="welcome-copy">Cadastre a capacidade física e reconcilie manualmente os cadastros legados antes de usar percentuais de ocupação.</p></div><button className="button button-secondary" type="button" onClick={() => void load()} disabled={loading}>Atualizar</button></div>
    {error && <div className="form-message form-message-error" role="alert">{error}</div>}
    {notice && <div className="form-message form-message-success" role="status">{notice}</div>}
    {capacity && <div className="hygiene-summary executive-kpis"><article><strong>{capacity.total_beds}</strong><span>Leitos cadastrados</span></article><article><strong>{capacity.occupied_beds}</strong><span>Ocupados no mapa físico</span></article><article><strong>{capacity.available_beds}</strong><span>Liberados</span></article><article><strong>{capacity.occupancy_percent === null ? '—' : `${capacity.occupancy_percent}%`}</strong><span>Ocupação física</span></article></div>}
    {capacity && capacity.unreconciled_legacy_patients > 0 && <div className="notice-band" role="status"><Info size={18} /><span>{capacity.unreconciled_legacy_patients} paciente(s) com quarto/leito legado aguardam reconciliação manual. O percentual de ocupação permanece indisponível.</span></div>}
    <form className="account-create-panel" onSubmit={(event) => void createUnit(event)}>
      <div className="section-heading"><div><p className="eyebrow">NOVA UNIDADE</p><h3>Cadastrar setor ou unidade</h3></div></div>
      <label className="field"><span className="field-label">Nome da unidade</span><input required minLength={2} maxLength={100} value={unitName} onChange={(event) => setUnitName(event.target.value)} placeholder="Ex.: Clínica médica" /></label>
      <button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Cadastrar unidade'}</button>
    </form>
    <form className="account-create-panel" onSubmit={(event) => { event.preventDefault(); void submitMutation('/api/v1/management/beds', { unit_id: unitId, room, label, isolation_capable: isolationCapable }, 'Leito cadastrado como disponível.').then((saved) => { if (saved) { setLabel(''); setIsolationCapable(false) } }) }}>
      <div className="section-heading"><div><p className="eyebrow">CAPACIDADE</p><h3>Cadastrar leito físico</h3></div></div>
      <p className="field-hint">Cadastre um leito por vez. Para o mesmo quarto, mantenha o número e informe A, B, C… na identificação de cada leito.</p>
      <div className="field-grid field-grid-three"><label className="field"><span className="field-label">Unidade</span><select required value={unitId} onChange={(event) => setUnitId(event.target.value)}><option value="">Selecione</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label><label className="field"><span className="field-label">Quarto</span><input required maxLength={20} value={room} onChange={(event) => setRoom(event.target.value)} placeholder="Ex.: 1" /></label><label className="field"><span className="field-label">Identificação do leito</span><input required maxLength={20} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Ex.: A" /></label></div>
      <label className="field emergency-patient-toggle"><span className="field-label">Característica</span><span><input type="checkbox" checked={isolationCapable} onChange={(event) => setIsolationCapable(event.target.checked)} /> Leito preparado para isolamento (cadastro estrutural; não substitui indicação clínica)</span></label>
      <button className="button button-primary" type="submit" disabled={saving || !units.length}>{saving ? 'Salvando…' : 'Cadastrar leito'}</button>
    </form>
    {unreconciledPatients.length > 0 && <form className="account-create-panel" onSubmit={(event) => { event.preventDefault(); void submitMutation(`/api/v1/management/patients/${encodeURIComponent(patientReference)}/bed-reconciliation`, { bed_id: reconciliationBedId }, 'Paciente reconciliado com o mapa físico.').then((saved) => { if (saved) { setPatientReference(''); setReconciliationBedId('') } }) }}>
      <div className="section-heading"><div><p className="eyebrow">RECONCILIAÇÃO MANUAL</p><h3>Vincular cadastro legado ao leito físico</h3></div></div>
      <p className="field-hint">A reconciliação só é permitida quando unidade/quarto/leito físico coincidem com o texto já registrado. Divergências devem ser revisadas antes de confirmar.</p>
      <div className="field-grid field-grid-two"><label className="field"><span className="field-label">Paciente com localização pendente</span><select required value={patientReference} onChange={(event) => { setPatientReference(event.target.value); setReconciliationBedId('') }}><option value="">Selecione</option>{unreconciledPatients.map((patient) => <option key={patient.reference} value={patient.reference}>{patient.name} · Quarto {patient.room} · Leito {patient.bed}</option>)}</select></label><label className="field"><span className="field-label">Correspondência física exata</span><select required value={reconciliationBedId} onChange={(event) => setReconciliationBedId(event.target.value)} disabled={!patientReference}><option value="">Selecione</option>{reconcileCandidates.map((bed) => <option key={bed.id} value={bed.id}>{bed.unit_name} · Quarto {bed.room} · Leito {bed.label}</option>)}</select></label></div>
      <button className="button button-primary" type="submit" disabled={saving || !patientReference || !reconciliationBedId}>{saving ? 'Vinculando…' : 'Confirmar reconciliação'}</button>
    </form>}
    <section><div className="section-heading"><div><p className="eyebrow">MAPA ATUAL</p><h3>Leitos cadastrados</h3></div><span className="module-total">{beds.length}</span></div>
      {loading ? <div className="history-empty">Carregando capacidade física…</div> : beds.length ? <div className="collection-list">{beds.map((bed) => <article className="collection-row" key={bed.id}><div className="collection-row-heading"><strong>{bed.unit_name} · Quarto {bed.room} · Leito {bed.label}</strong><span className={`work-order-status status-${bed.status === 'available' ? 'open' : bed.status === 'cleaning' ? 'in_progress' : 'cancelled'}`}>{bed.occupied ? 'Ocupado' : bed.status === 'available' ? 'Disponível' : bed.status === 'cleaning' ? 'Em higienização' : bed.status === 'maintenance' ? 'Manutenção' : 'Bloqueado'}</span></div><small>{bed.isolation_capable ? 'Preparado para isolamento' : 'Sem característica de isolamento'}{bed.patient_reference ? ` · Paciente vinculado: ${bed.patient_reference}` : ''}</small><label className="field"><span className="field-label">Situação operacional</span><select value={bed.occupied ? 'available' : bed.status} disabled={saving || bed.occupied} onChange={(event) => void updateStatus(bed, event.target.value as HospitalBed['status'])}><option value="available">Disponível</option><option value="cleaning">Em higienização</option><option value="maintenance">Manutenção</option><option value="blocked">Bloqueado</option></select></label></article>)}</div> : <div className="history-empty">Nenhum leito foi cadastrado.</div>}
    </section>
  </section>
}

function ManagementPage({ user, onNavigate, allowedModules }: { user: AuthUser; onNavigate: (id: ModuleId) => void; allowedModules: ModuleId[] }) {
  const [tab, setTab] = useState<'overview' | 'tasks' | 'beds' | 'governance' | 'shortcuts'>('overview')
  const shortcuts: { id: ModuleId; label: string }[] = [
    { id: 'patients', label: 'Cadastro de pacientes' },
    { id: 'reception', label: 'Recepção e chegadas' },
    { id: 'nursing', label: 'Enfermagem' },
    { id: 'pharmacy', label: 'Farmácia e estoque' },
    { id: 'maintenance', label: 'Manutenção' },
    { id: 'admin', label: 'Administração e auditoria' },
  ]
  const visibleShortcuts = shortcuts.filter(({ id }) => allowedModules.includes(id))
  return <section className="management-page page-enter">
    <div className="page-title-row"><div><p className="eyebrow">GESTÃO INSTITUCIONAL</p><h1>Painel de Gestão Hospitalar</h1><p className="welcome-copy">Visão consolidada dos indicadores operacionais existentes; não substitui relatórios contábeis, faturamento ou sistemas regulatórios.</p></div><span className="module-icon"><Building2 size={20} /></span></div>
    <div className="admin-tabs module-tabs" role="tablist" aria-label="Áreas da Gestão Hospitalar">
      <button className={`button ${tab === 'overview' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={tab === 'overview'} onClick={() => setTab('overview')}><Activity size={16} /> Visão geral</button>
      <button className={`button ${tab === 'tasks' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={tab === 'tasks'} onClick={() => setTab('tasks')}><ClipboardList size={16} /> Pendências</button>
      <button className={`button ${tab === 'beds' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={tab === 'beds'} onClick={() => setTab('beds')}><Building2 size={16} /> Unidades e leitos</button>
      <button className={`button ${tab === 'governance' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={tab === 'governance'} onClick={() => setTab('governance')}><ShieldCheck size={16} /> Governança</button>
      <button className={`button ${tab === 'shortcuts' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={tab === 'shortcuts'} onClick={() => setTab('shortcuts')}><ArrowRight size={16} /> Acesso rápido</button>
    </div>
    {tab === 'overview' && <ExecutiveDashboard />}
    {tab === 'tasks' && <Suspense fallback={<div className="history-empty" role="status">Carregando pendências operacionais…</div>}><OperationalTaskCenter user={user} onNavigate={onNavigate} /></Suspense>}
    {tab === 'beds' && <HospitalBedManagement />}
    {tab === 'governance' && <Suspense fallback={<div className="history-empty" role="status">Carregando operações administrativas…</div>}><AdministrativeRoadmapPanel /></Suspense>}
    {tab === 'shortcuts' && <section className="patient-list-panel management-shortcuts"><div className="section-heading"><div><p className="eyebrow">ACOMPANHAMENTO OPERACIONAL</p><h2>Acesso rápido às áreas</h2></div></div><div>{visibleShortcuts.map(({ id, label }) => <button className="button button-secondary" type="button" key={id} onClick={() => onNavigate(id)}>{label}<ArrowRight size={15} /></button>)}</div></section>}
  </section>
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

function AuditLogPanel() {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const loadEvents = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/v1/audit/events')
      const data = await readApiResponse<{ events?: AuditEvent[] }>(response)
      setEvents(data.events ?? [])
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar a auditoria.')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    const timer = window.setTimeout(() => void loadEvents(), 0)
    return () => window.clearTimeout(timer)
  }, [loadEvents])
  return <section className="patient-list-panel"><div className="section-heading"><div><p className="eyebrow">RASTREABILIDADE</p><h2>Logs de auditoria</h2><p className="welcome-copy">Eventos administrativos recentes, sem conteúdo clínico detalhado.</p></div><button className="button button-secondary" type="button" onClick={() => void loadEvents()} disabled={loading}>{loading ? 'Atualizando…' : 'Atualizar logs'}</button></div>{error ? <div className="form-message form-message-error" role="alert">{error}</div> : loading && !events.length ? <div className="history-empty">Carregando registros…</div> : events.length ? <div className="collection-list">{events.map((event) => <article className="collection-row" key={event.id}><div className="collection-row-heading"><strong>{event.actor_name} · {event.actor_role}</strong><time>{dateTime(event.happened_at)}</time></div><div className="collection-values"><span><small>Ação</small><strong>{event.action}</strong></span><span><small>Módulo</small><strong>{event.module}</strong></span><span><small>Registro</small><strong>{event.target_id}</strong></span></div></article>)}</div> : <div className="history-empty">Nenhum evento registrado.</div>}</section>
}

function SystemAdminPage() {
  const [tab, setTab] = useState<'backup' | 'recovery'>('backup')
  const [users, setUsers] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [resetAccounts, setResetAccounts] = useState<{ username: string; temporary_password: string }[]>([])
  const loadUsers = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/v1/system-admin/users')
      const data = await readApiResponse<{ users?: Account[] }>(response)
      setUsers(data.users ?? [])
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar as contas.')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    const timer = window.setTimeout(() => void loadUsers(), 0)
    return () => window.clearTimeout(timer)
  }, [loadUsers])
  async function resetAllCredentials() {
    if (!window.confirm(`Isto redefinirá senha e MFA de ${users.length} conta(s), encerrará as sessões e exigirá novo cadastro de senha e MFA. Continuar?`)) return
    setBusy(true)
    setError('')
    setResetAccounts([])
    try {
      const response = await fetch('/api/v1/system-admin/reset-credentials', { method: 'POST' })
      const data = await readApiResponse<{ accounts?: { username: string; temporary_password: string }[] }>(response)
      setResetAccounts(data.accounts ?? [])
      await loadUsers()
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Não foi possível redefinir as credenciais.')
    } finally {
      setBusy(false)
    }
  }
  async function resetOneCredentials(user: Account) {
    if (!window.confirm(`Redefinir senha, MFA e sessões de ${user.name}?`)) return
    setBusy(true)
    setError('')
    setResetAccounts([])
    try {
      const response = await fetch(`/api/v1/system-admin/users/${user.id}/reset-credentials`, { method: 'POST' })
      const data = await readApiResponse<{ initial_password: string }>(response)
      setResetAccounts([{ username: user.username, temporary_password: data.initial_password }])
      await loadUsers()
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Não foi possível redefinir as credenciais.')
    } finally {
      setBusy(false)
    }
  }
  return <section className="system-admin-page page-enter">
    <div className="page-title-row"><div><p className="eyebrow">ACESSO RESTRITO · MANTENEDOR</p><h1>Administração do Sistema</h1><p className="welcome-copy">Operações de manutenção disponíveis exclusivamente à conta superadministradora.</p></div><span className="module-icon"><ShieldCheck size={20} /></span></div>
    <div className="admin-tabs module-tabs" role="tablist" aria-label="Seções da Administração do Sistema"><button className={`button ${tab === 'backup' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={tab === 'backup'} onClick={() => setTab('backup')}>Backup</button><button className={`button ${tab === 'recovery' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={tab === 'recovery'} onClick={() => setTab('recovery')}>Recuperação de acesso</button></div>
    {tab === 'backup' && <BackupExportPanel />}
    {tab === 'recovery' && <section className="patient-list-panel system-recovery-panel"><div className="section-heading"><div><p className="eyebrow">AÇÃO DE EMERGÊNCIA</p><h2>Redefinir credenciais de usuários</h2><p className="welcome-copy">A senha e o MFA atuais serão revogados. Cada usuário receberá uma senha temporária aleatória, de uso único, e deverá configurar novos fatores de autenticação.</p></div></div><div className="system-recovery-summary"><strong>{loading ? '…' : users.length}</strong><span>contas comuns elegíveis · a conta superadministradora é sempre excluída</span><button className="button button-danger" type="button" onClick={() => void resetAllCredentials()} disabled={busy || loading || users.length === 0}>{busy ? 'Redefinindo…' : 'Redefinir credenciais de todas as contas'}</button><button className="button button-secondary" type="button" onClick={() => void loadUsers()} disabled={loading}>Atualizar lista</button></div>{error && <div className="form-message form-message-error" role="alert">{error}</div>}{resetAccounts.length > 0 && <div className="temporary-credentials" role="status"><div><strong>{resetAccounts.length > 1 ? 'Senhas temporárias geradas' : 'Senha temporária gerada'}</strong><span>Mostradas somente nesta sessão. Copie e entregue cada senha ao titular por canal seguro; não feche nem atualize a página antes de registrá-las.</span></div><div className="temporary-credential-list">{resetAccounts.map((account) => <p key={account.username}><strong>{account.username}</strong><code>{account.temporary_password}</code></p>)}</div><button className="button button-secondary" type="button" onClick={() => setResetAccounts([])}>Ocultar senhas</button></div>}{!loading && users.length > 0 && <details className="system-account-list"><summary>Contas abrangidas ({users.length})</summary><div>{users.map((user) => <article key={user.id}><span>{user.name} · {user.username}{user.active ? '' : ' · inativa'}</span><button className="button button-secondary" type="button" onClick={() => void resetOneCredentials(user)} disabled={busy}>Redefinir senha e MFA</button></article>)}</div></details>}</section>}
  </section>
}

export default App
