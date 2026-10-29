import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ErrorInfo, FormEvent, ReactNode } from 'react'
import { readApiResponse, readableApiError } from './api'
import AllergyFields from './components/AllergyFields'
import { PatientCareTrackBadge } from './components/PatientCareTrackBadge'
import { patientCareTrackClass } from './patientCareTrack'
import PatientSelect from './components/PatientSelect'
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
  Brain,
  Building2,
  CalendarDays,
  Camera,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  ClipboardPlus,
  Clock3,
  ContactRound,
  Eye,
  EyeOff,
  Handshake,
  HeartPulse,
  Home,
  Info,
  LockKeyhole,
  LogOut,
  Menu,
  Microscope,
  Moon,
  Package,
  Pill,
  Pencil,
  Printer,
  SprayCan,
  ShieldCheck,
  Sun,
  Search,
  Stethoscope,
  UtensilsCrossed,
  Vibrate,
  UsersRound,
  UserRound,
  X,
  Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import PrintSelectionPanel from './components/PrintSelectionPanel'
import ToastMessage from './components/ToastMessage'
import { PageNavigationContext, useBreadcrumb, usePersistentTab } from './components/PageNavigationContext'
import ModuleTabNavigation from './components/ModuleTabNavigation'
import { printRows, type PrintRow } from './printReport'
import { APP_VERSION } from './appVersion'
import { MOBILE_FEEDBACK_STORAGE_KEY, triggerMobileFeedback } from './mobileFeedback'
import VitalTrendsDashboard from './components/VitalTrendsDashboard'
import { squareImageFile, squareVideoFrame } from './patientPhoto'
import { BehavioralStatusBadge, type BehavioralStatus } from './components/BehavioralStatusBadge'
import TherapyMaterialsPanel from './components/TherapyMaterialsPanel'
import NursingMobilePage from './pages/NursingMobilePage'
import OperationsMobilePage from './pages/OperationsMobilePage'
import HelpGuide from './components/HelpGuide'
import QRCode from 'qrcode'
import { AppDialogProvider } from './components/AppDialogs'
import { useAppDialogs } from './components/appDialogContext'

type ModuleId = 'home' | 'work-orders' | 'patients' | 'patient-history' | 'nursing' | 'nursing-history' | 'pharmacy' | 'xray' | 'physician' | 'social' | 'nutrition' | 'hygiene' | 'reception' | 'therapy' | 'psychology' | 'maintenance' | 'management' | 'admin' | 'oversight' | 'system-admin' | 'about'
type ProfileId = 'patients' | 'nursing' | 'pharmacy' | 'xray' | 'physician' | 'social' | 'nutrition' | 'hygiene' | 'reception' | 'therapy' | 'psychology' | 'maintenance' | 'management' | 'admin' | 'oversight'
type EntryState = 'draft' | 'review' | 'saving' | 'saved' | 'error'
const sessionDurationMs = 12 * 60 * 60 * 1000
const nursingTabValues = ['overview', 'vitals', 'medications', 'safety', 'rounds', 'triage'] as const
const nursingTabLabels: Record<typeof nursingTabValues[number], string> = { overview: 'Visão geral', vitals: 'Sinais vitais', medications: 'Medicações', safety: 'Fila e segurança', rounds: 'Verificação horária', triage: 'Triagem' }
const adminTabValues = ['users', 'reports', 'audit'] as const
const adminTabLabels: Record<typeof adminTabValues[number], string> = { users: 'Usuários e permissões', reports: 'Relatórios', audit: 'Auditoria de ações' }
const managementTabValues = ['overview', 'tasks', 'beds', 'reports', 'behavior', 'governance', 'shortcuts'] as const
const managementTabLabels: Record<typeof managementTabValues[number], string> = { overview: 'Visão geral', tasks: 'Pendências', beds: 'Unidades e leitos', reports: 'Relatórios', behavior: 'Semáforo comportamental', governance: 'Governança', shortcuts: 'Acesso rápido' }
const therapyTabValues = ['calendar', 'attendance', 'reports', 'materials'] as const
const therapyTabLabels: Record<typeof therapyTabValues[number], string> = { calendar: 'Atividades e calendário', attendance: 'Lista de presença', reports: 'Relatórios', materials: 'Materiais e imagens' }
const systemAdminTabValues = ['accounts', 'backup', 'recovery'] as const
const systemAdminTabLabels: Record<typeof systemAdminTabValues[number], string> = { accounts: 'Usuários e permissões', backup: 'Cópias de segurança', recovery: 'Recuperação de acesso' }
const resetAllConfirmationText = 'REDEFINIR CREDENCIAIS DE TODOS OS USUÁRIOS'
const patientRegistryTabLabels = { registry: 'Novo cadastro', list: 'Lista de pacientes', reports: 'Relatórios' } as const
type Patient = {
  reference: string; name: string; room: string; bed: string; cpf?: string; sus_card?: string; same_number?: string; mother_name?: string; health_plan?: string; allergies?: string; allergies_status?: 'unknown' | 'none_known' | 'known'; birth_date?: string | null; sex?: string; phone?: string; email?: string
  treatment_track?: 'clinical' | 'psychiatric' | 'combined' | 'unclassified'
  address?: string; address_number?: string; address_complement?: string; neighborhood?: string; city?: string; state?: string; postal_code?: string
  responsible_name?: string; responsible_status?: 'unknown' | 'not_applicable' | 'provided'; responsible_relationship?: string; responsible_phone?: string; responsible_address?: string
  responsible_address_number?: string; responsible_address_complement?: string; responsible_neighborhood?: string
  responsible_city?: string; responsible_state?: string; responsible_postal_code?: string; photo_data?: string
  created_at?: string | null; updated_at?: string | null; updated_by?: string; active?: boolean
}
type NursingHourlyRoundPatient = {
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
type NursingHourlyRound = {
  id: string
  status: 'open' | 'completed'
  started_by_name: string
  started_at: string
  completed_by_name: string
  completed_at: string | null
  patients: NursingHourlyRoundPatient[]
}
const hourlyRoundStatusLabels: Record<NursingHourlyRoundPatient['status'], string> = {
  pending: 'Pendente',
  checked: 'Conferido',
  exception: 'Ocorrência',
}
const hourlyRoundExceptionLabels: Record<string, string> = {
  away: 'Ausente ou em atendimento externo',
  location: 'Em outro local da instituição',
  not_found: 'Não localizado',
  other: 'Outro',
}
function PatientAllergyAlert({ patient }: { patient?: { allergies?: string; allergies_status?: Patient['allergies_status']; suppressClinicalData?: boolean } }) {
  if (!patient) return null
  if (patient.suppressClinicalData) return null
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
function patientLocationLabel(patient: Pick<Patient, 'room' | 'bed'> | TherapyPatient) {
  if (!('room' in patient) || !('bed' in patient)) return 'Acomodação não exibida'
  return patient.room?.trim() && patient.bed?.trim()
    ? `Quarto ${patient.room} · leito ${patient.bed}`
    : 'Acomodação não exibida'
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
type PhysicianPrescription = { id: string; patient_reference: string; medication_name: string; active_ingredient: string; presentation: string; dose: string; route: string; frequency: string; administration_times: string[]; duration: string; quantity: string; unit: string; instructions: string; is_controlled: boolean; prescriber_name: string; crm: string; crm_state: string; status: 'pending' | 'fulfilled' | 'cancelled'; created_at: string }
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
function hospitalBedTone(bed: Pick<HospitalBed, 'status' | 'occupied'>) {
  if (bed.occupied) return 'neutral'
  if (bed.status === 'available') return 'success'
  if (bed.status === 'cleaning') return 'progress'
  if (bed.status === 'maintenance') return 'warning'
  return 'critical'
}
type ClinicalRisk = { id: number | string; patient_reference: string; patient_name: string; room: string; bed: string; risk_type: 'allergy' | 'contraindication'; description: string; severity: 'unspecified' | 'low' | 'moderate' | 'high'; status: 'active' | 'resolved'; reason: string; actor_name: string; created_at: string; resolved_at?: string | null; resolved_by?: string; resolution_reason?: string }
type EmergencyArrivalStatus = 'waiting' | 'called' | 'in_service' | 'completed' | 'cancelled' | 'admitted'
type EmergencyClinicalPriority = 'unassigned' | 'routine' | 'priority' | 'urgent'
type EmergencyArrival = { id: string; patient_reference: string | null; patient_name: string; allergies_status?: Patient['allergies_status']; allergy_report_status?: 'not_asked' | 'reported' | 'denied'; reported_allergies?: string; arrival_mode: 'walk_in' | 'ambulance' | 'other'; reason: string; status: EmergencyArrivalStatus; clinical_priority: EmergencyClinicalPriority; queue_type?: 'common' | 'priority'; clinical_priority_updated_by: string; clinical_priority_updated_at: string | null; clinical_priority_reason: string; created_by: string; updated_by: string; created_at: string; updated_at: string }
type TherapyActivityStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
type TherapyParticipant = { patient_reference: string; attendance: 'pending' | 'attended' | 'absent' }
type TherapyPatient = { reference: string; name: string; birth_date: string | null; room?: string; bed?: string; suppressClinicalData: true }
type TherapyActivity = { id: string; title: string; activity_type: string; description: string; location: string; starts_at: string; ends_at: string | null; patient_reference: string | null; participants: TherapyParticipant[]; status: TherapyActivityStatus; activity_report: string; report_updated_by: string | null; report_updated_at: string | null; created_by: string; created_at: string }
type TherapyActivityPayload = Pick<TherapyActivity, 'title' | 'activity_type' | 'description' | 'location' | 'starts_at' | 'ends_at' | 'patient_reference'> & { participant_references: string[] }
type NutritionRecordData = { id: number; patient_reference: string; assessment_date: string; weight_kg: string; height_cm: string; diet_type: string; allergies: string; restrictions: string; appetite: string; hydration: string; notes: string; fasting_at?: string | null; fasting_reason?: string; actor_name: string; created_at: string }
type NutritionPlan = { allergies: string; assessment_date: string | null; diet_type: string; restrictions: string; fasting_at: string | null; fasting_reason: string }

const ReceptionPage = lazy(() => import('./pages/ReceptionPage'))
const NursingTriagePanel = lazy(() => import('./components/NursingTriagePanel'))
const WaitingRoomKioskPage = lazy(() =>
  import('./pages/ReceptionPage').then((module) => ({
    default: module.WaitingRoomKioskPage,
  })),
)
const PharmacyPage = lazy(() => import('./pages/PharmacyPage'))
const XrayModulePage = lazy(() => import('./pages/XrayPage'))
const PhysicianPage = lazy(() => import('./pages/PhysicianPage'))
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

type AuthUser = { id: string; username: string; name: string; display_name: string; role: ProfileId; modules: ModuleId[]; permissions: Record<string, string[]>; mfa_enabled: boolean; is_superuser: boolean }

const roleLabels: Record<ProfileId, string> = {
  patients: 'Cadastro de pacientes', nursing: 'Enfermagem', pharmacy: 'Farmácia', xray: 'Central de Exames', physician: 'Médico', social: 'Serviço Social',
  nutrition: 'Nutrição', hygiene: 'Higienização', reception: 'Recepção', therapy: 'Oficina Terapêutica',
  psychology: 'Psicologia / Psiquiatria', maintenance: 'Manutenção',
  management: 'Gestão Hospitalar',
  admin: 'Administração do aplicativo',
  oversight: 'Relatórios e auditoria',
}

const modules: { id: ModuleId; label: string; short: string; icon: LucideIcon; description: string }[] = [
  { id: 'nursing', label: 'Enfermagem', short: 'Enfermagem', icon: HeartPulse, description: 'Coleta e acompanhamento de sinais vitais.' },
  { id: 'pharmacy', label: 'Farmácia', short: 'Farmácia', icon: Pill, description: 'Controle de estoque, lotes e validade.' },
  { id: 'xray', label: 'Central de Exames', short: 'Exames', icon: Microscope, description: 'Solicitações e acompanhamento de exames de imagem e laboratoriais.' },
  { id: 'physician', label: 'Médico', short: 'Médico', icon: Stethoscope, description: 'Consulta clínica, sinais vitais e prescrições integradas.' },
  { id: 'social', label: 'Serviço Social', short: 'Serviço social', icon: Handshake, description: 'Acompanhamentos e encaminhamentos.' },
  { id: 'nutrition', label: 'Nutrição', short: 'Nutrição', icon: UtensilsCrossed, description: 'Acompanhamento nutricional e necessidades alimentares.' },
  { id: 'reception', label: 'Recepção', short: 'Recepção', icon: ContactRound, description: 'Identificação, chegada e direcionamento de pacientes.' },
  { id: 'therapy', label: 'Oficina Terapêutica', short: 'Oficina terapêutica', icon: CalendarDays, description: 'Agenda, participação e acompanhamento das atividades.' },
  { id: 'psychology', label: 'Psicologia / Psiquiatria', short: 'Psicologia', icon: Brain, description: 'Encaminhamentos e acompanhamento da fila de atendimento.' },
  { id: 'hygiene', label: 'Higienização', short: 'Higienização', icon: SprayCan, description: 'Pedidos de limpeza por área e acompanhamento da equipe.' },
  { id: 'maintenance', label: 'Manutenção', short: 'Manutenção', icon: Wrench, description: 'Ordens de serviço, prioridades e acompanhamento da execução.' },
  { id: 'management', label: 'Gestão Hospitalar', short: 'Gestão hospitalar', icon: Building2, description: 'Indicadores operacionais agregados e acompanhamento da instituição.' },
  { id: 'admin', label: 'Administração', short: 'Administração', icon: ShieldCheck, description: 'Administração do aplicativo, relatórios e auditoria.' },
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

class ModuleErrorBoundary extends Component<
  { moduleLabel: string; onReturnHome: () => void; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Falha ao abrir ${this.props.moduleLabel}.`, error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="page-error-boundary" role="alert">
          <AlertTriangle size={24} />
          <h2>Não foi possível abrir {this.props.moduleLabel}</h2>
          <p>A aba encontrou um erro inesperado. Volte à visão geral e tente novamente.</p>
          <button className="button button-primary" type="button" onClick={this.props.onReturnHome}>Voltar à visão geral</button>
        </section>
      )
    }
    return this.props.children
  }
}

function App() {
  return <AppDialogProvider>
    {window.location.pathname === '/painel-sala-espera' || window.location.pathname === '/painel'
      ? <Suspense fallback={<StartupScreen />}><WaitingRoomKioskPage /></Suspense>
      : <AuthenticatedAppEntry />}
  </AppDialogProvider>
}

function AuthenticatedAppEntry() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(null)
  const [sessionExpired, setSessionExpired] = useState(false)
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
      const session = sessionResponse.ok ? await sessionResponse.json() as { user: AuthUser; session_expires_at?: number } : null
      if (!active) return
      setUser(session?.user ?? null)
      if (session?.session_expires_at) {
        const expiresAt = session.session_expires_at * 1000
        setSessionExpiresAt(expiresAt)
        window.localStorage.setItem('scpo-auth-session-expires-at', String(expiresAt))
        setSessionExpired(expiresAt <= Date.now())
      } else {
        setSessionExpiresAt(null)
        const savedExpiry = Number(window.localStorage.getItem('scpo-auth-session-expires-at'))
        setSessionExpired(Boolean(savedExpiry && savedExpiry <= Date.now()))
      }
      setBootstrapRequired(status.bootstrap_required)
      finishStartup()
    }).catch(() => { if (active) finishStartup() })
    return () => {
      active = false
      window.clearTimeout(startupTimer)
    }
  }, [])

  if (!authReady) return <StartupScreen />
  if (!user) return <AuthFlow bootstrapRequired={bootstrapRequired} sessionExpired={sessionExpired} onAuthenticated={(authenticatedUser, sessionExpiration) => {
    const expiresAt = sessionExpiration ? sessionExpiration * 1000 : Date.now() + sessionDurationMs
    window.localStorage.setItem('scpo-auth-session-expires-at', String(expiresAt))
    setSessionExpiresAt(expiresAt)
    setSessionExpired(false)
    setUser(authenticatedUser)
  }} />
  return <AuthenticatedApp user={user} sessionExpiresAt={sessionExpiresAt} onUserUpdated={(updatedUser, sessionExpiration) => {
    setUser(updatedUser)
    if (sessionExpiration) {
      const expiresAt = sessionExpiration * 1000
      window.localStorage.setItem('scpo-auth-session-expires-at', String(expiresAt))
      setSessionExpiresAt(expiresAt)
    }
  }} onSessionExpired={() => {
    setUser(null)
    setSessionExpired(true)
  }} onLogout={() => {
    window.localStorage.removeItem('scpo-auth-session-expires-at')
    setSessionExpiresAt(null)
    setSessionExpired(false)
    setUser(null)
  }} />
}

function StartupScreen() {
  return <main className="startup-screen" role="status" aria-live="polite" aria-busy="true"><div className="startup-brand"><span className="startup-orbit startup-orbit-one" /><span className="startup-orbit startup-orbit-two" /><span className="startup-mark"><img className="startup-mark-base" src="/scpo-connect-icon.png" alt="" /><img className="startup-mark-fill" src="/scpo-connect-icon.png" alt="" /></span><span className="startup-glow" /></div><strong>SCPO Connect</strong><span>Preparando seu espaço de trabalho</span><div className="startup-progress"><i /></div></main>
}

function AuthenticatedApp({ user, sessionExpiresAt, onUserUpdated, onSessionExpired, onLogout }: { user: AuthUser; sessionExpiresAt: number | null; onUserUpdated: (user: AuthUser, sessionExpiresAt?: number) => void; onSessionExpired: () => void; onLogout: () => void }) {
  const [activeModule, setActiveModule] = useState<ModuleId>(() => {
    try {
      const saved = navigation.find((item) => item.id === window.sessionStorage.getItem(`scpo-active-module:${user.id}`))
      if (!saved) return 'home'
      const id = saved.id
      return id === 'home' || id === 'about' || id === 'work-orders'
        || (id === 'system-admin' && user.is_superuser)
        || (id === 'admin' && (
          (user.modules.includes('admin') && Boolean(user.permissions.admin?.includes('administrar')))
          || (user.modules.includes('oversight') && Boolean(user.permissions.oversight?.includes('consultar')))
        ))
        || (id === 'therapy' && user.modules.includes('management'))
        || user.modules.includes(id)
        ? id
        : 'home'
    } catch {
      return 'home'
    }
  })
  const [tabBreadcrumbs, setTabBreadcrumbs] = useState<{ id: string; label: string; depth: number }[]>([])
  const setBreadcrumb = useCallback((id: string, label: string | null, depth = 1) => {
    setTabBreadcrumbs((current) => {
      const withoutCurrent = current.filter((entry) => entry.id !== id)
      if (!label) return withoutCurrent
      return [...withoutCurrent, { id, label, depth }]
    })
  }, [])
  const [menuOpen, setMenuOpen] = useState(false)
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem('scpo-sidebar-collapsed') === '1'
    } catch {
      return false
    }
  })
  const [historyPatientReference, setHistoryPatientReference] = useState('')
  const [historyReturnModule, setHistoryReturnModule] = useState<ModuleId>('patients')
  const [showBetaPopup, setShowBetaPopup] = useState(false)
  const [betaIconError, setBetaIconError] = useState(false)
  const [darkMode, setDarkMode] = useState(() => window.localStorage.getItem('scpo-theme') === 'dark')
  const [fontZoom, setFontZoom] = useState(() => Number(window.localStorage.getItem('scpo-font-zoom') || '1'))
  const [mobileFeedback, setMobileFeedback] = useState(() => window.localStorage.getItem(MOBILE_FEEDBACK_STORAGE_KEY) === 'enabled')
  const logoClickCount = useRef(0)
  const logoClickTimer = useRef<number | undefined>(undefined)
  const closeBetaPopup = useCallback(() => setShowBetaPopup(false), [])
  const sidebarStyle = { ['--sidebar-width' as string]: sidebarCollapsed ? '84px' : '246px' } as CSSProperties

  useEffect(() => () => {
    if (logoClickTimer.current !== undefined) window.clearTimeout(logoClickTimer.current)
  }, [])
  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? 'dark' : 'light'
    window.localStorage.setItem('scpo-theme', darkMode ? 'dark' : 'light')
  }, [darkMode])
  useEffect(() => {
    window.localStorage.setItem('scpo-sidebar-collapsed', sidebarCollapsed ? '1' : '0')
  }, [sidebarCollapsed])
  useEffect(() => {
    document.documentElement.style.zoom = String(fontZoom)
    window.localStorage.setItem('scpo-font-zoom', String(fontZoom))
  }, [fontZoom])
  useEffect(() => {
    if (!sessionExpiresAt) return
    const expireSession = () => {
      void fetch('/api/v1/auth/logout', { method: 'POST' }).catch(() => undefined)
      onSessionExpired()
    }
    const timer = window.setTimeout(expireSession, Math.max(0, sessionExpiresAt - Date.now()))
    return () => window.clearTimeout(timer)
  }, [onSessionExpired, sessionExpiresAt])
  const role = user.role
  const profile: Profile = {
    id: role,
    name: user.display_name || user.name,
    role: user.is_superuser ? 'Superadministrador do Sistema' : roleLabels[role],
    initials: (user.display_name || user.name).split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join(''),
    modules: ['home', ...user.modules, 'about'],
  }
  const canReviewTherapyReports = profile.modules.includes('management')
  const hasAppAdmin = user.is_superuser || (
    user.role !== 'management'
    && profile.modules.includes('admin')
    && Boolean(user.permissions.admin?.includes('administrar'))
  )
  const hasOversight = profile.modules.includes('oversight') && Boolean(user.permissions.oversight?.includes('consultar'))
  const visibleNavigation = navigation.filter((item) => item.id === 'about' || item.id === 'work-orders' || (item.id === 'system-admin' && user.is_superuser) || (item.id === 'admin' && (hasAppAdmin || hasOversight)) || profile.modules.includes(item.id) || (item.id === 'therapy' && canReviewTherapyReports))

  function navigate(id: ModuleId) {
    if (id === 'nursing-history' && !profile.modules.includes('nursing')) return
    if (id === 'patient-history' && !user.is_superuser && !['patients', 'nursing', 'physician', 'psychology', 'management', 'admin'].some((module) => profile.modules.includes(module as ModuleId))) return
    if (id === 'system-admin' && !user.is_superuser) return
    if (id !== 'about' && id !== 'work-orders' && id !== 'system-admin' && id !== 'admin' && id !== 'nursing-history' && id !== 'patient-history' && !(id === 'therapy' && canReviewTherapyReports) && !profile.modules.includes(id)) return
    if (id === 'admin' && !hasAppAdmin && !hasOversight) return
    setTabBreadcrumbs([])
    setActiveModule(id)
    window.scrollTo(0, 0)
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

  function openPatientHistory(reference: string, returnTo: ModuleId = 'patients') {
    setHistoryPatientReference(reference)
    setHistoryReturnModule(returnTo)
    navigate('patient-history')
  }

  const activeLabel = activeModule === 'home'
    ? 'Visão geral'
    : activeModule === 'nursing-history' ? 'Enfermagem'
    : activeModule === 'patient-history' ? 'Histórico assistencial'
    : navigation.find((item) => item.id === activeModule)?.label ?? 'SCPO Connect'
  const breadcrumbItems = [...tabBreadcrumbs].sort((left, right) => left.depth - right.depth)

  if (window.location.pathname === '/nursing.html') {
    return <NursingMobilePage user={user} onLogout={onLogout} />
  }
  if (window.location.pathname === '/operations.html') {
    return <OperationsMobilePage user={user} onLogout={onLogout} />
  }

  return (
    <div className="app-shell" style={sidebarStyle}>
      <PageNavigationContext.Provider value={setBreadcrumb}>
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''} ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`} aria-label="Navegação principal">
        <div className="brand-lockup">
          <button className="brand-trigger" type="button" aria-label="Marca SCPO Connect" onClick={handleBrandClick}>
            <img className="brand-image" src="/scpo-connect-icon.png" alt="" />
            <span className="brand-name">SCPO Connect<small>Santa Casa Pedro Osório</small></span>
          </button>
          <button
            className="icon-button sidebar-toggle"
            type="button"
            aria-label={sidebarCollapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'}
            title={sidebarCollapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'}
            onClick={() => setSidebarCollapsed((current) => !current)}
          >
            {sidebarCollapsed ? <ArrowRight size={17} /> : <ArrowLeft size={17} />}
          </button>
          <button className="icon-button sidebar-close" type="button" aria-label="Fechar menu" onClick={() => setMenuOpen(false)}><X size={19} /></button>
        </div>


        <nav className="primary-nav">
          {visibleNavigation.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className={`nav-link ${activeModule === id ? 'nav-link-active' : ''}`} onClick={() => navigate(id)} aria-current={activeModule === id ? 'page' : undefined}>
              <Icon size={22} strokeWidth={1.9} /><span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
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
            <nav className="breadcrumbs" aria-label="Caminho da página"><span>SCPO Connect</span><span className="crumb-divider">/</span><strong>{activeLabel}</strong>{breadcrumbItems.map((item) => <span className="breadcrumb-entry" key={item.id}><span className="crumb-divider">/</span><strong>{item.label}</strong></span>)}</nav>
          </div>
          <div className="topbar-right">
            <span className="session-role">{getGreeting()}, {profile.name.split(/\s+/)[0]}</span>
            <div className="accessibility-controls" aria-label="Acessibilidade e aparência"><button className={`icon-button appearance-button ${mobileFeedback ? 'feedback-enabled' : ''}`} type="button" aria-label={mobileFeedback ? 'Desativar vibração após salvar' : 'Ativar vibração após salvar'} aria-pressed={mobileFeedback} title={mobileFeedback ? 'Desativar vibração após salvar' : 'Ativar vibração após salvar'} onClick={() => { const enabled = !mobileFeedback; setMobileFeedback(enabled); window.localStorage.setItem(MOBILE_FEEDBACK_STORAGE_KEY, enabled ? 'enabled' : 'disabled') }}><Vibrate size={17} /></button><button className="icon-button appearance-button" type="button" aria-label={`Aumentar texto (${Math.round(fontZoom * 100)}%)`} title="Aumentar texto" onClick={() => setFontZoom((current) => current >= 1.2 ? 1 : Math.round((current + 0.1) * 10) / 10)}><span>A+</span></button><button className="icon-button appearance-button" type="button" aria-label={darkMode ? 'Ativar tema claro' : 'Ativar tema escuro'} title={darkMode ? 'Ativar tema claro' : 'Ativar tema escuro'} onClick={() => setDarkMode((current) => !current)}>{darkMode ? <Sun size={17} /> : <Moon size={17} />}</button></div>
            <InstallAppButton />
            <button className="button button-secondary account-settings-button" type="button" aria-label="Abrir minha conta" onClick={() => setAccountSettingsOpen(true)}><UserRound size={15} /><span>Minha conta</span></button>
            <button className="button button-secondary logout-button" type="button" onClick={async () => { await fetch('/api/v1/auth/logout', { method: 'POST' }); onLogout() }}><LogOut size={15} /> Sair</button>
          </div>
        </header>

        <div className="page-content">
          <ModuleErrorBoundary key={activeModule} moduleLabel={activeLabel} onReturnHome={() => navigate('home')}>
          {activeModule === 'home' && <Dashboard profile={profile} onNavigate={navigate} />}
          {activeModule === 'nursing' && <NursingPage profile={profile} user={user} onShowHistory={() => navigate('nursing-history')} onOpenPatientHistory={(reference) => openPatientHistory(reference, 'nursing')} />}
          {activeModule === 'nursing-history' && <NursingHistoryPage onBack={() => navigate('nursing')} />}
          {activeModule === 'pharmacy' && <Suspense fallback={<div className="history-empty" role="status">Carregando Farmácia…</div>}><PharmacyPage user={user} /></Suspense>}
          {activeModule === 'physician' && <Suspense fallback={<div className="history-empty" role="status">Carregando módulo Médico…</div>}><PhysicianPage userId={user.id} onOpenPatientHistory={(reference) => openPatientHistory(reference, 'physician')} /></Suspense>}
          {activeModule === 'work-orders' && <Suspense fallback={<div className="history-empty" role="status">Carregando ordens de serviço…</div>}><WorkOrdersPage user={user} /></Suspense>}
          {activeModule === 'maintenance' && <Suspense fallback={<div className="history-empty" role="status">Carregando Manutenção…</div>}><MaintenanceQueuePage userId={user.id} /></Suspense>}
          {activeModule === 'hygiene' && <Suspense fallback={<div className="history-empty" role="status">Carregando Higienização…</div>}><HygienePage user={user} /></Suspense>}
          {activeModule === 'psychology' && <Suspense fallback={<div className="history-empty" role="status">Carregando Psicologia…</div>}><PsychologyPage userId={user.id} canPrescribe={profile.modules.includes('physician')} onOpenPhysician={() => navigate('physician')} onOpenPatientHistory={(reference) => openPatientHistory(reference, 'psychology')} /></Suspense>}
          {activeModule === 'patients' && <PatientRegistryPage onHistory={openPatientHistory} canDeletePatients={user.is_superuser || (user.modules.includes('admin') && (user.permissions.admin?.includes('excluir') === true || user.permissions.admin?.includes('administrar') === true))} />}
          {activeModule === 'reception' && <Suspense fallback={<div className="history-empty" role="status">Carregando Recepção…</div>}><ReceptionPage user={user} PatientRegistryPage={PatientRegistryPage} /></Suspense>}
          {activeModule === 'patient-history' && <PatientHistoryPage key={historyPatientReference} patientReference={historyPatientReference} user={user} onBack={() => navigate(historyReturnModule)} />}
          {activeModule === 'therapy' && <TherapyPage profile={profile} />}
          {activeModule === 'admin' && <AdminPage user={user} />}
          {activeModule === 'management' && <ManagementPage user={user} onNavigate={navigate} allowedModules={profile.modules} />}
          {activeModule === 'system-admin' && user.is_superuser && <SystemAdminPage user={user} />}
          {activeModule === 'about' && <AboutPage />}
          {activeModule === 'nutrition' && <NutritionPage />}
          {activeModule === 'xray' && <Suspense fallback={<div className="history-empty" role="status">Carregando Central de Exames…</div>}><XrayModulePage user={user} /></Suspense>}
          {activeModule === 'social' && <Suspense fallback={<div className="history-empty" role="status">Carregando Serviço Social…</div>}><PatientOperationsPage moduleId="social" user={user} /></Suspense>}
          </ModuleErrorBoundary>
        </div>
        <footer className="app-footer"><span>SCPO Connect <span className="footer-version">· {user.username}</span></span><span>Acesso seguro por perfil</span></footer>
      </main>
      {showBetaPopup && <BetaCelebration onClose={closeBetaPopup} iconError={betaIconError} onIconError={() => setBetaIconError(true)} />}
      {accountSettingsOpen && <MyAccountDialog user={user} onUpdated={onUserUpdated} onClose={() => setAccountSettingsOpen(false)} />}
      </PageNavigationContext.Provider>
    </div>
  )
}

function MyAccountDialog({ user, onUpdated, onClose }: { user: AuthUser; onUpdated: (user: AuthUser, sessionExpiresAt?: number) => void; onClose: () => void }) {
  const [displayName, setDisplayName] = useState(user.display_name || user.name)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [profileMessage, setProfileMessage] = useState('')
  const [passwordMessage, setPasswordMessage] = useState('')
  const [profileError, setProfileError] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)

  async function saveDisplayName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSavingProfile(true)
    setProfileMessage('')
    setProfileError('')
    try {
      const data = await readApiResponse<{ user: AuthUser }>(await fetch('/api/v1/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: displayName.trim() }),
      }))
      onUpdated(data.user)
      setDisplayName(data.user.display_name)
      setProfileMessage('Nome de exibição atualizado.')
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Não foi possível salvar o nome de exibição.')
    } finally {
      setSavingProfile(false)
    }
  }

  async function changeOwnPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPasswordMessage('')
    setPasswordError('')
    if (newPassword !== confirmPassword) {
      setPasswordError('As novas senhas não coincidem.')
      return
    }
    setSavingPassword(true)
    try {
      const data = await readApiResponse<{ user: AuthUser; session_expires_at: number }>(await fetch('/api/v1/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      }))
      onUpdated(data.user, data.session_expires_at)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordMessage('Senha alterada. Sua sessão atual continua ativa.')
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : 'Não foi possível alterar a senha.')
    } finally {
      setSavingPassword(false)
    }
  }

  return <div className="patient-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingProfile && !savingPassword) onClose() }}>
    <section className="patient-archive-dialog credential-reset-dialog account-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="account-settings-title">
      <div className="credential-reset-heading"><img src="/scpo-connect-icon.png" alt="" /><div><p className="eyebrow">PREFERÊNCIAS DA CONTA</p><h2 id="account-settings-title">Minha conta</h2></div></div>
      <p>Seu usuário de acesso é <strong>{user.username}</strong> e não pode ser alterado aqui. Escolha como seu nome aparece nas telas de trabalho.</p>
      <form className="account-settings-form" onSubmit={(event) => void saveDisplayName(event)}>
        <label className="field"><span className="field-label">Nome de exibição</span><input required minLength={1} maxLength={80} autoComplete="nickname" value={displayName} onChange={(event) => setDisplayName(event.target.value)} /><span className="field-hint">Esse nome aparece no espaço de trabalho e nos registros de autoria.</span></label>
        {profileMessage && <ToastMessage variant="success">{profileMessage}</ToastMessage>}
        {profileError && <ToastMessage variant="error">{profileError}</ToastMessage>}
        <button className="button button-primary" type="submit" disabled={savingProfile || !displayName.trim()}>{savingProfile ? 'Salvando…' : 'Salvar nome'}</button>
      </form>
      <form className="account-settings-form account-settings-password" onSubmit={(event) => void changeOwnPassword(event)}>
        <h3>Alterar minha senha</h3>
        <label className="field"><span className="field-label">Senha atual</span><input required type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
        <label className="field"><span className="field-label">Nova senha</span><input required minLength={12} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /><span className="field-hint">Use pelo menos 12 caracteres.</span></label>
        <label className="field"><span className="field-label">Confirme a nova senha</span><input required minLength={12} type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
        {newPassword && confirmPassword && newPassword !== confirmPassword && <p className="auth-validation-message" role="alert">As novas senhas não coincidem.</p>}
        {passwordMessage && <ToastMessage variant="success">{passwordMessage}</ToastMessage>}
        {passwordError && <ToastMessage variant="error">{passwordError}</ToastMessage>}
        <button className="button button-secondary" type="submit" disabled={savingPassword || !currentPassword || newPassword.length < 12 || newPassword !== confirmPassword}>{savingPassword ? 'Alterando…' : 'Alterar senha'}</button>
      </form>
      <div className="form-actions"><button className="button button-secondary" type="button" onClick={onClose} disabled={savingProfile || savingPassword}>Fechar</button></div>
    </section>
  </div>
}

function BetaCelebration({ onClose, iconError, onIconError }: { onClose: () => void; iconError: boolean; onIconError: () => void }) {
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
      <span className="beta-dialog-icon">{iconError ? <Activity size={30} aria-label="Ícone do SCPO Connect" /> : <img src="/scpo-connect-icon.png" alt="Ícone do SCPO Connect" onError={onIconError} />}</span>
      <p className="eyebrow">SCPO CONNECT</p>
      <h2 id="beta-title">Versão em desenvolvimento</h2>
      <p>Fase beta</p>
      <small>Equipe SCPO Connect</small>
      <button className="button button-primary" type="button" onClick={onClose}>Continuar</button>
    </section>
  </div>
}

function AuthFlow({ bootstrapRequired, sessionExpired, onAuthenticated }: { bootstrapRequired: boolean; sessionExpired: boolean; onAuthenticated: (user: AuthUser, sessionExpiresAt?: number) => void }) {
  const [stage, setStage] = useState<'bootstrap' | 'login' | 'password' | 'mfa'>(bootstrapRequired ? 'bootstrap' : 'login')
  const [username, setUsername] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [bootstrapToken, setBootstrapToken] = useState('')
  const [mfaSecret, setMfaSecret] = useState('')
  const [mfaQrDataUrl, setMfaQrDataUrl] = useState('')
  const [mfaCopyMessage, setMfaCopyMessage] = useState('')
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (stage !== 'mfa') return
    let active = true
    fetch('/api/v1/auth/mfa/setup').then(async (response) => {
      if (!response.ok) throw new Error('Não foi possível iniciar a configuração do MFA.')
      const data = await response.json() as { secret: string; otpauth_uri: string }
      const qrDataUrl = await QRCode.toDataURL(data.otpauth_uri, { errorCorrectionLevel: 'M', margin: 2, width: 220 })
      if (active) {
        setMfaSecret(data.secret)
        setMfaQrDataUrl(qrDataUrl)
      }
    }).catch((error: Error) => { if (active) setMessage(error.message) })
    return () => { active = false }
  }, [stage])

  async function copyMfaSecret() {
    try {
      await navigator.clipboard.writeText(mfaSecret)
      setMfaCopyMessage('Chave copiada.')
    } catch {
      setMfaCopyMessage('Não foi possível copiar automaticamente. Selecione e copie a chave exibida.')
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (stage === 'password' && newPassword !== confirmNewPassword) {
      setMessage('As senhas não coincidem.')
      return
    }
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
      const data = await response.json().catch(() => ({})) as { detail?: unknown; user?: AuthUser; must_change_password?: boolean; mfa_setup_required?: boolean; session_expires_at?: number }
      if (!response.ok) throw new Error(readableApiError(data.detail))
      if (stage === 'bootstrap') {
        setPassword('0000')
        setStage('password')
      } else if (stage === 'login') {
        setPassword('')
        setTotpCode('')
        setPasswordVisible(false)
        if (data.must_change_password) setStage('password')
        else if (data.mfa_setup_required) setStage('mfa')
        else if (data.user) onAuthenticated(data.user, data.session_expires_at)
      } else if (stage === 'password') {
        setNewPassword('')
        setConfirmNewPassword('')
        setStage('mfa')
      } else if (data.user) {
        onAuthenticated(data.user, data.session_expires_at)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao conectar ao serviço de identidade.')
    } finally {
      setBusy(false)
    }
  }

  const title = stage === 'bootstrap' ? 'Configurar administrador master' : stage === 'login' ? 'Entrar no SCPO Connect' : stage === 'password' ? 'Passo 1 de 2: crie sua senha' : 'Passo 2 de 2: ative a confirmação em duas etapas'
  return <main className="auth-page"><section className="auth-card"><div className="auth-brand"><img src="/scpo-connect-icon.png" alt="" /><div><strong>SCPO Connect</strong><span>Santa Casa de Pedro Osório</span></div></div><p className="eyebrow">ACESSO SEGURO</p><h1>{title}</h1>
    {sessionExpired && <div className="admin-warning session-expired-notice" role="status"><Clock3 size={18} /><div><strong>Sessão encerrada</strong><span>O limite de 12 horas foi atingido. Entre novamente para continuar.</span></div></div>}
    {stage === 'mfa' && <div className="auth-mfa-instructions"><strong>Configure um aplicativo autenticador</strong><p>1. Abra um autenticador no celular, como Google Authenticator ou Microsoft Authenticator. 2. Leia este QR code ou copie a chave. 3. Digite abaixo o código de seis dígitos que o aplicativo gerar.</p>{mfaQrDataUrl ? <img className="auth-mfa-qr" src={mfaQrDataUrl} alt="QR code para configurar a autenticação em duas etapas" /> : <span className="auth-mfa-qr-loading">Gerando QR code seguro…</span>}<code>{mfaSecret || 'Carregando chave segura…'}</code><button className="button button-secondary auth-mfa-copy" type="button" onClick={() => void copyMfaSecret()} disabled={!mfaSecret}>Copiar chave</button>{mfaCopyMessage && <span className="auth-mfa-copy-message" role="status">{mfaCopyMessage}</span>}</div>}
    <form className="auth-form" onSubmit={submit}>
      {stage === 'bootstrap' && <><label className="field"><span className="field-label">Nome do administrador</span><input required minLength={2} maxLength={120} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></label><label className="field"><span className="field-label">Usuário</span><input required minLength={3} maxLength={80} pattern="[A-Za-z0-9._@-]+" title="Use pelo menos 3 caracteres: letras sem acento, números, ponto, hífen, sublinhado ou @." autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label><label className="field"><span className="field-label">Token de bootstrap</span><input required type="password" autoComplete="off" value={bootstrapToken} onChange={(event) => setBootstrapToken(event.target.value)} /></label><p className="auth-help">O usuário deve ter ao menos 3 caracteres e usar letras sem acento, números, ponto, hífen, sublinhado ou @.</p><p className="auth-help">O token fica no arquivo <code>bootstrap-admin.token</code> no diretório de dados definido pelo servidor. Guarde-o como segredo.</p></>}
      {stage === 'login' && <><label className="field"><span className="field-label">Usuário</span><input required autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label><label className="field"><span className="field-label">Senha</span><span className="auth-password-control"><input required type={passwordVisible ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /><button className="auth-password-toggle" type="button" aria-label={passwordVisible ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={passwordVisible} onClick={() => setPasswordVisible((visible) => !visible)}>{passwordVisible ? <EyeOff size={19} /> : <Eye size={19} />}</button></span></label><label className="field"><span className="field-label">Código do autenticador (se já configurado)</span><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={totpCode} onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, ''))} /></label><p className="auth-help">Primeiro acesso de uma conta recém-criada? Use seu usuário e a senha temporária recebida e deixe o código vazio. Se sua senha foi redefinida em uma conta já configurada, informe também seu código MFA.</p></>}
      {stage === 'password' && <><p className="auth-help">Use a senha temporária recebida apenas para entrar. Agora escolha uma senha pessoal com pelo menos 12 caracteres e confirme-a abaixo. Depois, configure o aplicativo autenticador seguindo os passos na tela.</p><label className="field"><span className="field-label">Nova senha</span><input required minLength={12} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label><label className="field"><span className="field-label">Confirme a nova senha</span><input required minLength={12} type="password" autoComplete="new-password" value={confirmNewPassword} onChange={(event) => setConfirmNewPassword(event.target.value)} /></label>{confirmNewPassword && newPassword !== confirmNewPassword && <p className="auth-validation-message" role="alert">As senhas não coincidem.</p>}</>}
      {stage === 'mfa' && <label className="field"><span className="field-label">Código do aplicativo</span><input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={totpCode} onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, ''))} /></label>}
      {message && <ToastMessage variant="error">{message}</ToastMessage>}
      <button className="button button-primary auth-submit" type="submit" disabled={busy || (stage === 'mfa' && !mfaSecret) || (stage === 'password' && (!newPassword || newPassword !== confirmNewPassword))}>{busy ? 'Aguarde…' : stage === 'login' ? 'Entrar' : stage === 'bootstrap' ? 'Criar administrador' : stage === 'password' ? 'Salvar nova senha' : 'Ativar MFA'}</button>
    </form>
    <InstallAppButton showDescription />
  </section></main>
}

const emptyPatientForm = {
  name: '', mother_name: '', health_plan: '', same_number: '', room: '', bed: '', cpf: '', sus_card: '', allergies: '', allergies_status: 'unknown', treatment_track: 'unclassified', birth_date: '', sex: '', phone: '', email: '', address: '', address_number: '', address_complement: '', neighborhood: '', city: '', state: '', postal_code: '',
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

function PatientRegistryPage({ onHistory, receptionMode = false, canDeletePatients = false }: { onHistory?: (reference: string) => void; receptionMode?: boolean; canDeletePatients?: boolean }) {
  const patientPageSize = 50
  const [patients, setPatients] = useState<Patient[]>([])
  const [patientTotal, setPatientTotal] = useState(0)
  const [availableHospitalBeds, setAvailableHospitalBeds] = useState<HospitalBed[]>([])
  const [bedOptionsLoading, setBedOptionsLoading] = useState(true)
  const [bedOptionsError, setBedOptionsError] = useState('')
  const [roomOptions, setRoomOptions] = useState<string[]>([])
  const [bedOptions, setBedOptions] = useState<string[]>([])
  const [inactivePatientCount, setInactivePatientCount] = useState(0)
  const [activeAssignedCount, setActiveAssignedCount] = useState(0)
  const [activeUnassignedCount, setActiveUnassignedCount] = useState(0)
  const [reportPatients, setReportPatients] = useState<Patient[]>([])
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState('')
  const [registryTab, setRegistryTab] = useState<'registry' | 'list' | 'reports'>('registry')
  const [patientPage, setPatientPage] = useState(0)
  const [form, setForm] = useState({ ...emptyPatientForm })
  const [newPatientPurpose, setNewPatientPurpose] = useState<'outpatient' | 'inpatient'>(receptionMode ? 'inpatient' : 'outpatient')
  const [selectedAdmissionBed, setSelectedAdmissionBed] = useState('')
  const [editingReference, setEditingReference] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [viewingPatient, setViewingPatient] = useState<Patient | null>(null)
  const [archivingPatient, setArchivingPatient] = useState<Patient | null>(null)
  const [archiveReason, setArchiveReason] = useState('')
  const [showPatientFollowUp, setShowPatientFollowUp] = useState(false)
  const [patientObservations, setPatientObservations] = useState<PatientObservation[]>([])
  const [patientObservationsReference, setPatientObservationsReference] = useState('')
  const [patientObservationsError, setPatientObservationsError] = useState('')
  const [attentionLevel, setAttentionLevel] = useState<PatientObservation['attention_level']>('green')
  const [treatmentStatus, setTreatmentStatus] = useState<PatientObservation['treatment_status']>('in_progress')
  const [observationDraft, setObservationDraft] = useState('')
  const [savingObservation, setSavingObservation] = useState(false)
  useBreadcrumb('patient-registry', receptionMode || showPatientFollowUp ? null : patientRegistryTabLabels[registryTab])
  useBreadcrumb('patient-follow-up', showPatientFollowUp ? 'Acompanhamento' : null, 2)
  useBreadcrumb('patient-follow-up-selected', showPatientFollowUp ? viewingPatient?.name ?? null : null, 3)
  const [query, setQuery] = useState('')
  const [roomFilter, setRoomFilter] = useState('')
  const [bedFilter, setBedFilter] = useState('')
  const [treatmentTrackFilter, setTreatmentTrackFilter] = useState<Patient['treatment_track'] | ''>('')
  const [patientStatusFilter, setPatientStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [patientSort, setPatientSort] = useState<'location' | 'name'>('location')
  const [groupPatientsByRoom, setGroupPatientsByRoom] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [duplicateCandidates, setDuplicateCandidates] = useState<{ reference: string; name: string; room: string; bed: string; reasons: string }[]>([])
  const [duplicateOverride, setDuplicateOverride] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [patientReload, setPatientReload] = useState(0)

  useEffect(() => {
    let active = true
    fetch('/api/v1/nursing/beds')
      .then((response) => readApiResponse<{ beds?: HospitalBed[] }>(response))
      .then((data) => {
        if (active) {
          setAvailableHospitalBeds((data.beds ?? []).filter((bed) => bed.status === 'available' && !bed.occupied))
          setBedOptionsError('')
        }
      })
      .catch((loadError) => {
        if (active) {
          setAvailableHospitalBeds([])
          setBedOptionsError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar os leitos disponíveis.')
        }
      })
      .finally(() => { if (active) setBedOptionsLoading(false) })
    return () => { active = false }
  }, [])

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
    const controller = new AbortController()
    const loadPatients = async () => {
      try {
        setLoading(true)
        const params = new URLSearchParams({
          full_profile: 'true',
          include_inactive: 'true',
          limit: String(patientPageSize),
          offset: String(patientPage * patientPageSize),
          status: patientStatusFilter,
          sort: patientSort,
        })
        if (query.trim()) params.set('search', query.trim())
        if (roomFilter) params.set('room', roomFilter)
        if (bedFilter) params.set('bed', bedFilter)
        if (treatmentTrackFilter) params.set('treatment_track', treatmentTrackFilter)
        const response = await fetch(`/api/v1/nursing/patients?${params.toString()}`, { signal: controller.signal })
        const data = await response.json() as {
          patients?: Patient[]
          total?: number
          rooms?: string[]
          beds?: string[]
          active_count?: number
          inactive_count?: number
          active_assigned_count?: number
          active_unassigned_count?: number
          detail?: string
        }
        if (!response.ok) throw new Error(data.detail ?? 'Não foi possível carregar os pacientes.')
        if (active) {
          const total = data.total ?? 0
          if (patientPage > 0 && patientPage * patientPageSize >= total) {
            setPatientPage(Math.max(0, Math.ceil(total / patientPageSize) - 1))
            return
          }
          setPatients(data.patients ?? [])
          setPatientTotal(total)
          setRoomOptions((data.rooms ?? []).sort((left, right) => left.localeCompare(right, 'pt-BR', { numeric: true })))
          setBedOptions((data.beds ?? []).sort((left, right) => left.localeCompare(right, 'pt-BR', { numeric: true })))
          setInactivePatientCount(data.inactive_count ?? 0)
          setActiveAssignedCount(data.active_assigned_count ?? 0)
          setActiveUnassignedCount(data.active_unassigned_count ?? 0)
          setError('')
        }
      } catch (loadError) {
        if (active && !(loadError instanceof DOMException && loadError.name === 'AbortError')) {
          setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar os pacientes.')
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    const timer = window.setTimeout(() => void loadPatients(), query.trim() ? 250 : 0)
    return () => {
      active = false
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [patientPage, patientPageSize, patientReload, patientSort, patientStatusFilter, query, roomFilter, bedFilter, treatmentTrackFilter])

  useEffect(() => {
    if (registryTab !== 'reports') return
    let active = true
    const controller = new AbortController()
    const loadAllReportPatients = async () => {
      setReportLoading(true)
      setReportError('')
      try {
        const rows: Patient[] = []
        let offset = 0
        let total = 0
        let shouldLoad = true
        while (shouldLoad) {
          const params = new URLSearchParams({
            full_profile: 'true',
            include_inactive: 'true',
            limit: '200',
            offset: String(offset),
            status: patientStatusFilter,
            sort: patientSort,
          })
          if (query.trim()) params.set('search', query.trim())
          if (roomFilter) params.set('room', roomFilter)
          if (bedFilter) params.set('bed', bedFilter)
          if (treatmentTrackFilter) params.set('treatment_track', treatmentTrackFilter)
          const response = await fetch(`/api/v1/nursing/patients?${params.toString()}`, { signal: controller.signal })
          const data = await response.json() as { patients?: Patient[]; total?: number; detail?: string }
          if (!response.ok) throw new Error(data.detail ?? 'Não foi possível carregar os pacientes para o relatório.')
          const page = data.patients ?? []
          if (!page.length && offset < (data.total ?? 0)) throw new Error('A consulta do relatório retornou uma página vazia antes do fim dos registros.')
          rows.push(...page)
          total = data.total ?? rows.length
          offset += page.length
          shouldLoad = active && offset < total && page.length > 0
        }
        if (active) setReportPatients(rows)
      } catch (loadError) {
        if (active && !(loadError instanceof DOMException && loadError.name === 'AbortError')) {
          setReportPatients([])
          setReportError(loadError instanceof Error ? loadError.message : 'Falha ao carregar o relatório de pacientes.')
        }
      } finally {
        if (active) setReportLoading(false)
      }
    }
    void loadAllReportPatients()
    return () => {
      active = false
      controller.abort()
    }
  }, [registryTab, patientReload, patientSort, patientStatusFilter, query, roomFilter, bedFilter, treatmentTrackFilter])

  useEffect(() => {
    if (!viewingPatient) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowPatientFollowUp(false)
        setViewingPatient(null)
      }
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [viewingPatient])

  useEffect(() => {
    if (!viewingPatient || !showPatientFollowUp) return
    let current = true
    fetch(`/api/v1/nursing/patients/${encodeURIComponent(viewingPatient.reference)}/observations`)
      .then((response) => readApiResponse<{ observations?: PatientObservation[] }>(response))
      .then((data) => {
        if (current) {
          const observations = data.observations ?? []
          setPatientObservations(observations)
          setAttentionLevel(observations[0]?.attention_level ?? 'green')
          setTreatmentStatus(observations[0]?.treatment_status ?? 'in_progress')
          setPatientObservationsReference(viewingPatient.reference)
          setPatientObservationsError('')
        }
      })
      .catch((loadError) => {
        if (current) {
          setPatientObservations([])
          setPatientObservationsReference(viewingPatient.reference)
          setPatientObservationsError(readableApiError(loadError))
        }
      })
    return () => { current = false }
  }, [showPatientFollowUp, viewingPatient])

  useEffect(() => {
    if (showPatientFollowUp) window.scrollTo(0, 0)
  }, [showPatientFollowUp])

  function openPatientFollowUp(patient: Patient) {
    setPatientObservations([])
    setPatientObservationsReference('')
    setPatientObservationsError('')
    setObservationDraft('')
    setError('')
    setNotice('')
    setViewingPatient(patient)
    setShowPatientFollowUp(true)
  }

  function closePatientFollowUp() {
    setShowPatientFollowUp(false)
    setViewingPatient(null)
  }

  async function savePatientObservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!viewingPatient) return
    setSavingObservation(true); setError('')
    try {
      const response = await fetch(`/api/v1/nursing/patients/${encodeURIComponent(viewingPatient.reference)}/observations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attention_level: attentionLevel, observation: observationDraft, treatment_status: treatmentStatus }) })
      const data = await response.json() as PatientObservation & { detail?: string }
      if (!response.ok) throw new Error(data.detail ?? 'Não foi possível salvar o acompanhamento.')
      setPatientObservations((current) => [data, ...current]); setPatientObservationsReference(viewingPatient.reference); setObservationDraft('')
      triggerMobileFeedback()
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
    setRegistryTab('registry')
    setShowForm(true)
    setSelectedAdmissionBed('')
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
        body: JSON.stringify({
          ...form,
          room: editingReference ? form.room : '',
          bed: editingReference ? form.bed : '',
          bed_id: !editingReference && newPatientPurpose === 'inpatient' ? selectedAdmissionBed : null,
          birth_date: form.birth_date || null,
        }),
      })
      const data = await response.json() as Patient & { detail?: string }
      if (!response.ok) throw new Error(data.detail ?? 'Não foi possível salvar o cadastro.')
      setPatients((current) => editingReference ? current.map((item) => item.reference === data.reference ? data : item) : [...current, data].sort((a, b) => a.room.localeCompare(b.room, 'pt-BR', { numeric: true }) || a.bed.localeCompare(b.bed, 'pt-BR', { numeric: true })))
      setPatientPage(0)
      setPatientReload((current) => current + 1)
      setForm({ ...emptyPatientForm }); setEditingReference(''); setShowForm(false); setCameraOpen(false); setSelectedAdmissionBed('')
      setDuplicateCandidates([]); setDuplicateOverride(false)
      setRegistryTab('list')
      setNotice(editingReference
        ? 'Cadastro do paciente atualizado.'
        : newPatientPurpose === 'inpatient'
          ? 'Paciente cadastrado e vinculado ao leito selecionado.'
          : 'Paciente cadastrado sem internação, disponível para atendimento ambulatorial.')
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
      setPatientPage(0)
      setPatientReload((current) => current + 1)
      setNotice('Cadastro arquivado; os dados e o motivo permanecem registrados na auditoria.')
      setArchivingPatient(null); setArchiveReason('')
    } catch (archiveError) { setError(archiveError instanceof Error ? archiveError.message : 'Falha ao arquivar cadastro.') }
  }

  const filteredPatients = patients
  const patientPageCount = Math.max(1, Math.ceil(patientTotal / patientPageSize))
  const currentPatientPage = Math.min(patientPage, patientPageCount - 1)
  const visiblePatients = patients
  const patientGroups: [string, Patient[]][] = groupPatientsByRoom
    ? [...new Set(visiblePatients.map((patient) => patient.room.trim() || 'Sem quarto'))]
      .map((room) => [room === 'Sem quarto' ? room : `Quarto ${room}`, visiblePatients.filter((patient) => (patient.room.trim() || 'Sem quarto') === room)])
    : [['Pacientes', visiblePatients]]
  const patientPrintRows: PrintRow[] = reportPatients.map((patient) => ({ id: patient.reference, date: patient.updated_at || patient.created_at || '', title: patient.name, fields: [['Quarto e leito', patient.room && patient.bed ? `${patient.room} · ${patient.bed}` : 'Sem acomodação atribuída'], ['Situação', patient.active === false ? 'Alta / inativo' : 'Ativo'], ['Tratamento', treatmentTrackLabel(patient.treatment_track ?? 'unclassified')], ['Alergias e alertas', patient.allergies_status === 'known' ? patient.allergies || 'Detalhes não informados' : patient.allergies_status === 'none_known' ? 'Sem alergias conhecidas' : 'Não verificadas'], ['Responsável', patient.responsible_status === 'not_applicable' ? 'Não se aplica' : patient.responsible_name || 'Não informado']] }))
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

  return <section className={`patient-registry-page page-enter${showPatientFollowUp ? ' patient-registry-follow-up-open' : ''}`}>
    {showPatientFollowUp && viewingPatient ? <section className="patient-follow-up-page">
      <div className="page-title-row">
        <div><p className="eyebrow">PACIENTES · ACOMPANHAMENTO ASSISTENCIAL</p><h1>{viewingPatient.name}</h1><p className="welcome-copy">Quarto {viewingPatient.room || 'não atribuído'} · Leito {viewingPatient.bed || 'não atribuído'} · {viewingPatient.active === false ? 'Alta registrada' : 'Cadastro ativo'}</p></div>
        <button className="button button-secondary" type="button" onClick={closePatientFollowUp}><ArrowLeft size={16} /> Voltar à lista</button>
      </div>
      {error && <ToastMessage variant="error">{error}</ToastMessage>}
      <section className="patient-follow-up-panel patient-follow-up-entry">
        <div className="section-heading"><div><p className="eyebrow">NOVO REGISTRO</p><h2>Registrar acompanhamento</h2><p className="welcome-copy">Registre observações objetivas e atualize o nível de acompanhamento e a situação do tratamento.</p></div></div>
        <form className="patient-observation-form" onSubmit={(event) => void savePatientObservation(event)}>
          <div className="field-grid field-grid-two">
            <label className="field"><span className="field-label">Nível de acompanhamento</span><select value={attentionLevel} onChange={(event) => setAttentionLevel(event.target.value as PatientObservation['attention_level'])}><option value="green">Verde · rotina habitual</option><option value="yellow">Amarelo · atenção ampliada</option><option value="red">Vermelho · prioridade de acompanhamento</option></select></label>
            <label className="field"><span className="field-label">Situação do tratamento</span><select value={treatmentStatus} onChange={(event) => setTreatmentStatus(event.target.value as PatientObservation['treatment_status'])}><option value="in_progress">Em andamento</option><option value="completed">Concluído</option><option value="discharged">Alta</option></select></label>
          </div>
          <label className="field"><span className="field-label">Observação objetiva</span><textarea required minLength={5} maxLength={2000} value={observationDraft} onChange={(event) => setObservationDraft(event.target.value)} placeholder="Registre fatos observáveis, cuidados realizados, resposta ao tratamento e orientações de continuidade." /></label>
          <button className="button button-primary" type="submit" disabled={savingObservation || observationDraft.trim().length < 5}>{savingObservation ? 'Salvando…' : 'Registrar acompanhamento'}</button>
        </form>
      </section>
      <section className="patient-follow-up-panel">
        <div className="section-heading"><div><p className="eyebrow">HISTÓRICO INDIVIDUAL</p><h2>Registros de acompanhamento</h2></div><span className="module-total">{patientObservations.length}</span></div>
        <div className="patient-observation-list">{patientObservationsReference !== viewingPatient.reference ? <div className="history-empty">Carregando histórico…</div> : patientObservationsError ? <ToastMessage variant="error">{`Não foi possível carregar o histórico de acompanhamento: ${patientObservationsError}`}</ToastMessage> : patientObservations.map((item) => <article className={`patient-observation-card attention-${item.attention_level}`} key={item.id}><div><strong>{item.attention_level === 'green' ? 'Verde · rotina habitual' : item.attention_level === 'yellow' ? 'Amarelo · atenção ampliada' : 'Vermelho · prioridade de acompanhamento'}</strong><span>{item.treatment_status === 'in_progress' ? 'Tratamento em andamento' : item.treatment_status === 'completed' ? 'Tratamento concluído' : 'Alta'}</span></div><p>{item.observation}</p><small>{item.actor_name} · {dateTime(item.created_at)}</small></article>)}{patientObservationsReference === viewingPatient.reference && !patientObservationsError && !patientObservations.length && <div className="history-empty">Nenhuma anotação de acompanhamento registrada.</div>}</div>
      </section>
    </section> : <>
    {receptionMode ? <div className="section-heading reception-admission-heading"><div><p className="eyebrow">INTERNAÇÕES</p><h2>Admissões e internações</h2><p className="welcome-copy">Confirme a identificação do paciente e registre sua acomodação.</p></div><button className="button button-primary" type="button" onClick={() => { if (showForm) { setShowForm(false); setEditingReference(''); setForm({ ...emptyPatientForm }); setCameraOpen(false) } else { setShowForm(true); setNewPatientPurpose('inpatient'); setNotice(''); setError('') } }}><UserRound size={16} /> {showForm ? 'Fechar cadastro' : 'Nova admissão'}</button></div> : <div className="page-title-row"><span className="module-icon module-icon-patients"><UserRound size={23} /></span><div><p className="eyebrow">CADASTRO COMPARTILHADO</p><h1>Pacientes</h1><p className="welcome-copy">Cadastros centralizados, exibidos nos módulos autorizados para cada profissional.</p></div></div>}
    {!receptionMode && <ModuleTabNavigation
      className="patient-registry-tabs"
      ariaLabel="Áreas de pacientes"
      value={registryTab}
      onChange={setRegistryTab}
      options={[
        { value: 'registry', label: patientRegistryTabLabels.registry, content: <><UserRound size={16} /> {patientRegistryTabLabels.registry}</> },
        { value: 'list', label: patientRegistryTabLabels.list, content: <><UsersRound size={16} /> {patientRegistryTabLabels.list}</> },
        { value: 'reports', label: patientRegistryTabLabels.reports, content: <><Printer size={16} /> {patientRegistryTabLabels.reports}</> },
      ]}
    />}
    {notice && <ToastMessage variant="success">{notice}</ToastMessage>}{error && <ToastMessage variant="error">{error}</ToastMessage>}
    {receptionMode && <div className="hygiene-summary reception-admission-summary" aria-label="Resumo de internações"><article><strong>{activeAssignedCount}</strong><span>Pacientes acomodados</span></article><article><strong>{activeUnassignedCount}</strong><span>Sem acomodação</span></article><article><strong>{inactivePatientCount}</strong><span>Cadastros inativos</span></article></div>}
    {(receptionMode ? showForm : registryTab === 'registry') && <form className={`patient-registry-form${receptionMode ? ' hygiene-panel' : ''}`} onSubmit={(event) => void submit(event)}>
      <div className="section-heading"><div><p className="eyebrow">{editingReference ? 'ATUALIZAÇÃO CADASTRAL' : receptionMode ? 'ADMISSÃO' : 'NOVO CADASTRO'}</p><h2>{editingReference ? 'Dados do paciente' : newPatientPurpose === 'inpatient' ? 'Identificação e internação' : 'Identificação para consulta ambulatorial'}</h2><p className="welcome-copy">Os campos são compartilhados com os módulos conforme as permissões configuradas.</p></div></div>
      {!editingReference && <div className="patient-registration-purpose">
        <label className="field"><span className="field-label">Finalidade do cadastro</span><select value={newPatientPurpose} onChange={(event) => { setNewPatientPurpose(event.target.value as 'outpatient' | 'inpatient'); setSelectedAdmissionBed('') }}><option value="outpatient">Consulta / atendimento ambulatorial · sem internação</option><option value="inpatient">Internação · atribuir quarto e leito</option></select></label>
        {newPatientPurpose === 'inpatient' && <label className="field"><span className="field-label">Leito disponível</span><select required value={selectedAdmissionBed} onChange={(event) => setSelectedAdmissionBed(event.target.value)} disabled={bedOptionsLoading || Boolean(bedOptionsError) || availableHospitalBeds.length === 0}><option value="">{bedOptionsLoading ? 'Carregando leitos…' : 'Selecione unidade, quarto e leito'}</option>{availableHospitalBeds.map((bed) => <option key={bed.id} value={bed.id}>{bed.unit_name} · Quarto {bed.room} · Leito {bed.label}</option>)}</select>{bedOptionsError ? <span className="field-hint">Não foi possível carregar leitos disponíveis: {bedOptionsError}</span> : !bedOptionsLoading && availableHospitalBeds.length === 0 ? <span className="field-hint">Nenhum leito disponível. Cadastre ou libere um leito em Gestão Hospitalar.</span> : <span className="field-hint">A seleção é validada novamente ao salvar para evitar dupla ocupação.</span>}</label>}
      </div>}
      <div className="patient-form-grid">
        <label className="field"><span className="field-label">Nome completo</span><input required minLength={2} maxLength={120} autoComplete="name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label className="field"><span className="field-label">Nome da mãe</span><input maxLength={120} autoComplete="off" value={form.mother_name} onChange={(event) => setForm({ ...form, mother_name: event.target.value })} /></label>
        <label className="field"><span className="field-label">Convênio</span><input maxLength={120} value={form.health_plan} onChange={(event) => setForm({ ...form, health_plan: event.target.value })} placeholder="SUS ou convênio cadastrado" /></label>
        <label className="field"><span className="field-label">Perfil de tratamento</span><select value={form.treatment_track} onChange={(event) => setForm({ ...form, treatment_track: event.target.value })}><option value="unclassified">Não classificado</option><option value="clinical">Tratamento clínico</option><option value="psychiatric">Tratamento psiquiátrico</option><option value="combined">Cuidado clínico e psiquiátrico</option></select></label>
        <label className="field"><span className="field-label">Nº SAME / prontuário</span><input maxLength={40} value={form.same_number} onChange={(event) => setForm({ ...form, same_number: event.target.value })} /></label>
        <label className="field"><span className="field-label">CPF</span><input inputMode="numeric" autoComplete="off" maxLength={14} value={formatCpf(form.cpf)} onChange={(event) => setForm({ ...form, cpf: formatCpf(event.target.value) })} placeholder="000.000.000-00" /></label>
        <label className="field"><span className="field-label">Cartão Nacional de Saúde (SUS)</span><input inputMode="numeric" autoComplete="off" maxLength={20} value={form.sus_card} onChange={(event) => setForm({ ...form, sus_card: event.target.value.replace(/\D/g, '').slice(0, 20) })} /></label>
        <label className="field"><span className="field-label">Data de nascimento</span><input type="date" value={form.birth_date} onChange={(event) => setForm({ ...form, birth_date: event.target.value })} /></label>
        {editingReference && <><label className="field"><span className="field-label">Quarto</span><input required maxLength={20} value={form.room} onChange={(event) => setForm({ ...form, room: event.target.value })} /></label><label className="field"><span className="field-label">Leito</span><input required maxLength={20} value={form.bed} onChange={(event) => setForm({ ...form, bed: event.target.value })} /></label></>}
        <label className="field"><span className="field-label">Sexo (opcional)</span><select value={form.sex} onChange={(event) => setForm({ ...form, sex: event.target.value })}><option value="">Não informado</option><option value="Feminino">Feminino</option><option value="Masculino">Masculino</option><option value="Outro">Outro</option><option value="Não informado">Prefere não informar</option></select></label>
        <label className="field"><span className="field-label">Telefone do paciente</span><input inputMode="tel" maxLength={20} autoComplete="tel" value={formatPhone(form.phone)} onChange={(event) => setForm({ ...form, phone: formatPhone(event.target.value) })} /></label>
        <label className="field"><span className="field-label">E-mail do paciente</span><input type="email" maxLength={160} autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
      </div>
      <AllergyFields status={form.allergies_status as NonNullable<Patient['allergies_status']>} allergies={form.allergies} onChange={(allergies_status, allergies) => setForm((current) => ({ ...current, allergies_status, allergies }))} />
      {duplicateCandidates.length > 0 && <div className="duplicate-warning" role="alert"><strong>Confira antes de salvar</strong>{duplicateCandidates.map((candidate) => <span key={candidate.reference}>{candidate.name} · Quarto {candidate.room}, leito {candidate.bed} · Coincidência: {candidate.reasons}</span>)}<button className="button button-secondary" type="button" onClick={() => { setDuplicateOverride(true); setError(''); setDuplicateCandidates([]) }}>Confirmo que é outra pessoa</button></div>}
      <fieldset className="patient-address-group"><legend>Endereço do paciente</legend><AddressFields form={form} patients={patients} prefix="" onChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))} /></fieldset>
      <fieldset className="patient-address-group"><legend>Responsável pela internação</legend><label className="field"><span className="field-label">Situação do responsável</span><select value={form.responsible_status} onChange={(event) => { const status = event.target.value as NonNullable<Patient['responsible_status']>; setForm((current) => status === 'not_applicable' ? { ...current, responsible_status: status, responsible_name: '', responsible_relationship: '', responsible_phone: '', responsible_address: '', responsible_address_number: '', responsible_address_complement: '', responsible_neighborhood: '', responsible_city: '', responsible_state: '', responsible_postal_code: '' } : { ...current, responsible_status: status }) }}><option value="unknown">Não informado</option><option value="not_applicable">Não se aplica</option><option value="provided">Responsável informado</option></select></label>{form.responsible_status !== 'not_applicable' && <><div className="patient-form-actions"><button className="button button-secondary" type="button" onClick={() => setForm((current) => ({ ...current, responsible_status: 'provided', responsible_name: current.name, responsible_relationship: 'Próprio paciente (autorreferência)', responsible_phone: current.phone, responsible_address: current.address, responsible_address_number: current.address_number, responsible_address_complement: current.address_complement, responsible_neighborhood: current.neighborhood, responsible_city: current.city, responsible_state: current.state, responsible_postal_code: current.postal_code }))}>Usar os dados do próprio paciente</button></div><div className="patient-form-grid"><label className="field"><span className="field-label">Nome completo</span><input maxLength={120} value={form.responsible_name} onChange={(event) => setForm({ ...form, responsible_status: 'provided', responsible_name: event.target.value })} /></label><label className="field"><span className="field-label">Vínculo com o paciente</span><input maxLength={60} value={form.responsible_relationship} onChange={(event) => setForm({ ...form, responsible_status: 'provided', responsible_relationship: event.target.value })} placeholder="Ex.: filha, cônjuge" /></label><label className="field"><span className="field-label">Telefone de contato</span><input inputMode="tel" maxLength={20} autoComplete="tel" value={formatPhone(form.responsible_phone)} onChange={(event) => setForm({ ...form, responsible_status: 'provided', responsible_phone: formatPhone(event.target.value) })} /></label></div><AddressFields form={form} patients={patients} prefix="responsible_" onChange={(key, value) => setForm((current) => ({ ...current, responsible_status: 'provided', [key]: value }))} /></>}</fieldset>
      <fieldset className="patient-address-group"><legend>Foto do paciente</legend><div className="patient-photo-editor">{form.photo_data ? <img src={form.photo_data} alt="Prévia da foto do paciente" /> : <span className="patient-photo-placeholder"><UserRound size={24} /></span>}<button className="button button-secondary" type="button" onClick={() => { setCameraError(''); setCameraOpen((open) => !open) }}><Camera size={16} /> {cameraOpen ? 'Fechar câmera' : 'Tirar foto'}</button><label className="button button-secondary" htmlFor="patient-photo">Escolher imagem</label><input id="patient-photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => { loadPhoto(event.target.files?.[0]); event.currentTarget.value = '' }} /><button className="button button-secondary" type="button" onClick={() => setForm({ ...form, photo_data: '' })} disabled={!form.photo_data}>Remover foto</button><small>JPEG, PNG ou WebP · até 1 MB. A câmera requer HTTPS e permissão.</small>{cameraOpen && <div className="patient-camera-panel"><video ref={videoRef} autoPlay muted playsInline aria-label="Visualização da câmera para foto do paciente" />{(cameraError || (!navigator.mediaDevices?.getUserMedia ? 'A câmera precisa de HTTPS e de permissão do navegador. Você ainda pode escolher uma imagem do dispositivo.' : '')) && <ToastMessage variant="error">{cameraError || 'A câmera precisa de HTTPS e de permissão do navegador. Você ainda pode escolher uma imagem do dispositivo.'}</ToastMessage>}<div><button className="button button-primary" type="button" onClick={capturePhoto} disabled={!navigator.mediaDevices?.getUserMedia}><Camera size={16} /> Capturar foto</button><button className="button button-secondary" type="button" onClick={() => setCameraOpen(false)}>Cancelar câmera</button></div></div>}</div></fieldset>
      <div className="patient-form-actions"><button className="button button-secondary" type="button" onClick={() => { setShowForm(false); setEditingReference(''); setForm({ ...emptyPatientForm }); setCameraOpen(false); if (!receptionMode) setRegistryTab('list') }} disabled={saving}>Cancelar</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Salvando…' : editingReference ? 'Salvar alterações' : 'Cadastrar paciente'} <ArrowRight size={16} /></button></div>
    </form>}
    {(receptionMode || registryTab === 'list') && <section className="patient-list-panel">
      <div className="section-heading"><div><p className="eyebrow">REGISTROS COMPARTILHADOS</p><h2>{receptionMode ? 'Pacientes e admissões' : 'Pacientes cadastrados'}</h2></div><span className="module-total">{patientTotal} paciente(s)</span></div>
      <label className="field patient-search"><span className="field-label">Buscar por nome, filiação, CPF, SUS, SAME, contato, responsável ou endereço</span><span className="search-input-wrap"><Search size={17} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPatientPage(0) }} placeholder="Digite um ou mais termos" /></span></label>
      <div className="patient-registry-filters" aria-label="Filtros de pacientes">
        <label className="field"><span className="field-label">Quarto</span><select value={roomFilter} onChange={(event) => { setRoomFilter(event.target.value); setBedFilter(''); setPatientPage(0) }}><option value="">Todos os quartos</option>{roomOptions.map((room) => <option key={room} value={room}>{room}</option>)}</select></label>
        <label className="field"><span className="field-label">Leito</span><select value={bedFilter} onChange={(event) => { setBedFilter(event.target.value); setPatientPage(0) }} disabled={!bedOptions.length}><option value="">Todos os leitos</option>{bedOptions.map((bed) => <option key={bed} value={bed}>{bed}</option>)}</select></label>
        <label className="field"><span className="field-label">Situação</span><select value={patientStatusFilter} onChange={(event) => { setPatientStatusFilter(event.target.value as typeof patientStatusFilter); setPatientPage(0) }}><option value="all">Todos</option><option value="active">Ativos / internados</option><option value="inactive">Alta / inativos</option></select></label>
        <label className="field"><span className="field-label">Perfil de tratamento</span><select value={treatmentTrackFilter} onChange={(event) => { setTreatmentTrackFilter(event.target.value as typeof treatmentTrackFilter); setPatientPage(0) }}><option value="">Todos os perfis</option><option value="clinical">Clínico</option><option value="psychiatric">Psiquiátrico</option><option value="combined">Clínico e psiquiátrico</option><option value="unclassified">Não classificado</option></select></label>
        <label className="field"><span className="field-label">Ordenar por</span><select value={patientSort} onChange={(event) => { setPatientSort(event.target.value as typeof patientSort); setPatientPage(0) }}><option value="location">Quarto e leito</option><option value="name">Nome (A–Z)</option></select></label>
        <label className="patient-group-toggle"><input type="checkbox" checked={groupPatientsByRoom} onChange={(event) => setGroupPatientsByRoom(event.target.checked)} /><span>Agrupar por quarto</span></label>
        <button className="button button-secondary patient-filter-clear" type="button" onClick={() => { setQuery(''); setRoomFilter(''); setBedFilter(''); setTreatmentTrackFilter(''); setPatientStatusFilter('all'); setPatientSort('location'); setGroupPatientsByRoom(false); setPatientPage(0) }}>Limpar filtros</button>
      </div>
      {loading ? <div className="history-empty">Carregando pacientes…</div> : filteredPatients.length ? patientGroups.map(([groupLabel, groupPatients]) => <section className="patient-registry-group" key={groupLabel}>
        {groupPatientsByRoom && <h3>{groupLabel}<span>{groupPatients.length}</span></h3>}
        <div className="patient-registry-list">{groupPatients.map((patient) => <article className={`patient-registry-card ${patientCareTrackClass(patient.treatment_track)}`} key={patient.reference}><div className="patient-registry-identity">{patient.photo_data ? <img src={patient.photo_data} alt="" /> : <span className="patient-registry-avatar"><UserRound size={19} /></span>}<div><h3>{patient.name}</h3><span className={`entry-status ${patient.active === false ? 'entry-status-draft' : 'entry-status-saved'}`}>{patient.active === false ? 'Alta / inativo' : 'Ativo'}</span><PatientCareTrackBadge track={patient.treatment_track} /><p>{patient.room && patient.bed ? `Quarto ${patient.room} · Leito ${patient.bed}` : 'Sem acomodação atribuída'}{patient.birth_date ? ` · Nascimento ${new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${patient.birth_date}T00:00:00Z`))}` : ''}</p><small className="patient-card-identifiers">CPF: {patient.cpf || 'Não informado'} · Cartão SUS: {patient.sus_card || 'Não informado'}</small><PatientAllergyAlert patient={patient} />{patient.responsible_status === 'not_applicable' ? <small>Responsável: não se aplica</small> : patient.responsible_name && <small>{patient.responsible_relationship === 'Próprio paciente (autorreferência)' ? 'Autorreferência do paciente' : `Responsável: ${patient.responsible_name}`}{patient.responsible_phone ? ` · ${patient.responsible_phone}` : ''}</small>}{patientAddress(patient) && <small>{patientAddress(patient)}</small>}</div></div><div className="patient-registry-actions"><button className="button button-secondary" type="button" onClick={() => { setShowPatientFollowUp(false); setViewingPatient(patient) }}><Eye size={15} /> Ver ficha</button><button className="button button-secondary" type="button" onClick={() => openPatientFollowUp(patient)}><ClipboardList size={15} /> Acompanhamento</button>{onHistory && <button className="button button-secondary" type="button" onClick={() => { onHistory(patient.reference); setViewingPatient(null); setShowPatientFollowUp(false) }}>Histórico clínico</button>}<button className="button button-secondary" type="button" onClick={() => startEdit(patient)}><Pencil size={15} /> Editar</button>{canDeletePatients && <button className="button button-danger" type="button" onClick={() => void archivePatient(patient)}>Arquivar</button>}</div></article>)}</div>
      </section>) : <div className="history-empty"><UsersRound size={20} /><span>{query || roomFilter || bedFilter || treatmentTrackFilter || patientStatusFilter !== 'all' ? 'Nenhum paciente corresponde aos filtros selecionados.' : 'Nenhum paciente cadastrado.'}</span></div>}
      {!loading && patientTotal > 0 && <nav className="history-pagination" aria-label="Paginação da lista de pacientes"><span>Exibindo {currentPatientPage * patientPageSize + 1}–{Math.min((currentPatientPage + 1) * patientPageSize, patientTotal)} de {patientTotal}</span><div><button className="button button-secondary" type="button" disabled={currentPatientPage === 0} onClick={() => setPatientPage((page) => Math.max(0, page - 1))}><ArrowLeft size={15} /> Anterior</button><button className="button button-secondary" type="button" disabled={currentPatientPage + 1 >= patientPageCount} onClick={() => setPatientPage((page) => Math.min(patientPageCount - 1, page + 1))}>Próxima <ArrowRight size={15} /></button></div></nav>}
    </section>}
    {viewingPatient && <div className="patient-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setViewingPatient(null) }}>
      <section className="patient-detail-modal" role="dialog" aria-modal="true" aria-labelledby="patient-detail-title">
        <div className="patient-detail-header">
          <div className="patient-detail-identity">
            {viewingPatient.photo_data ? <img src={viewingPatient.photo_data} alt={`Foto de ${viewingPatient.name}`} /> : <span className="patient-registry-avatar"><UserRound size={22} /></span>}
            <div><p className="eyebrow">FICHA DO PACIENTE</p><h2 id="patient-detail-title">{viewingPatient.name}</h2><PatientCareTrackBadge track={viewingPatient.treatment_track} /><p>Quarto {viewingPatient.room || 'não atribuído'} · Leito {viewingPatient.bed || 'não atribuído'} · {viewingPatient.active === false ? 'Cadastro inativo' : 'Cadastro ativo'}</p></div>
          </div>
          <button className="button button-secondary" type="button" onClick={() => setViewingPatient(null)}>Fechar</button>
        </div>
        <div className="patient-detail-sections">
          <section><h3>Identificação e contato</h3><div className="patient-detail-grid">
            <span><small>Nome da mãe</small><strong>{viewingPatient.mother_name || 'Não informado'}</strong></span>
            <span><small>CPF</small><strong>{viewingPatient.cpf || 'Não informado'}</strong></span>
            <span><small>Cartão Nacional de Saúde (SUS)</small><strong>{viewingPatient.sus_card || 'Não informado'}</strong></span>
            <span><small>Nascimento</small><strong>{viewingPatient.birth_date ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${viewingPatient.birth_date}T00:00:00Z`)) : 'Não informado'}</strong></span>
            <span><small>Sexo</small><strong>{viewingPatient.sex || 'Não informado'}</strong></span>
            <span><small>Telefone</small><strong>{viewingPatient.phone || 'Não informado'}</strong></span>
            <span><small>E-mail</small><strong>{viewingPatient.email || 'Não informado'}</strong></span>
          </div></section>
          <section><h3>Endereço do paciente</h3><p>{patientAddress(viewingPatient) || 'Não informado'}</p></section>
          <section><h3>Responsável pela internação</h3><div className="patient-detail-grid">
            <span><small>Nome</small><strong>{viewingPatient.responsible_name || 'Não informado'}</strong></span>
            <span><small>Vínculo</small><strong>{viewingPatient.responsible_relationship || 'Não informado'}</strong></span>
            <span><small>Telefone</small><strong>{viewingPatient.responsible_phone || 'Não informado'}</strong></span>
            <span><small>Endereço</small><strong>{responsibleAddress(viewingPatient) || 'Não informado'}</strong></span>
          </div></section>
          <section className={viewingPatient.allergies ? 'patient-detail-alert' : ''}><h3>Alergias e alertas</h3><p>{viewingPatient.allergies || 'Nenhum alerta cadastrado'}</p></section>
          <section><h3>Registro cadastral</h3><div className="patient-detail-grid">
            <span><small>Cadastrado em</small><strong>{viewingPatient.created_at ? dateTime(viewingPatient.created_at) : 'Não informado'}</strong></span>
            <span><small>Última atualização</small><strong>{viewingPatient.updated_at ? dateTime(viewingPatient.updated_at) : 'Não informado'}</strong></span>
            <span><small>Atualizado por</small><strong>{viewingPatient.updated_by || 'Não informado'}</strong></span>
          </div></section>
        </div>
        <div className="patient-detail-actions">
          <button className="button button-secondary" type="button" onClick={() => { startEdit(viewingPatient); setViewingPatient(null) }}><Pencil size={15} /> Editar cadastro</button>
          <button className="button button-secondary" type="button" onClick={() => openPatientFollowUp(viewingPatient)}><ClipboardList size={15} /> Acompanhamento</button>
          {onHistory && <button className="button button-secondary" type="button" onClick={() => { onHistory(viewingPatient.reference); setViewingPatient(null) }}><ClipboardList size={15} /> Histórico de sinais vitais</button>}
          <button className="button button-primary" type="button" onClick={() => { document.body.classList.add('print-patient-detail'); window.addEventListener('afterprint', () => document.body.classList.remove('print-patient-detail'), { once: true }); window.print() }}><Printer size={16} /> Imprimir ficha</button>
        </div>
      </section>
    </div>}
    {receptionMode ? <PrintSelectionPanel title="Relação de pacientes · página atual" rows={patients.map((patient) => ({ id: patient.reference, date: patient.updated_at || patient.created_at || '', title: patient.name, fields: [['Quarto e leito', patient.room && patient.bed ? `${patient.room} · ${patient.bed}` : 'Sem acomodação atribuída'], ['Situação', patient.active === false ? 'Alta / inativo' : 'Ativo'], ['Tratamento', treatmentTrackLabel(patient.treatment_track ?? 'unclassified')], ['Alergias e alertas', patient.allergies_status === 'known' ? patient.allergies || 'Detalhes não informados' : patient.allergies_status === 'none_known' ? 'Sem alergias conhecidas' : 'Não verificadas'], ['Responsável', patient.responsible_status === 'not_applicable' ? 'Não se aplica' : patient.responsible_name || 'Não informado']] }))} /> : null}
    {registryTab === 'reports' && <>
      {reportError && <ToastMessage variant="error">{reportError}</ToastMessage>}
      {reportLoading ? <div className="history-empty">Carregando todos os pacientes para o relatório…</div> : <PrintSelectionPanel title="Relação de pacientes" rows={patientPrintRows} />}
    </>}
    {archivingPatient && canDeletePatients && <div className="patient-modal-backdrop" role="presentation"><section className="patient-archive-dialog" role="dialog" aria-modal="true" aria-labelledby="patient-archive-title"><h2 id="patient-archive-title">Arquivar cadastro de paciente</h2><p><strong>{archivingPatient.name}</strong> deixará de aparecer nos cadastros ativos. Os dados assistenciais serão preservados, e a exclusão lógica, o motivo e o responsável ficarão registrados na auditoria.</p><label className="field"><span className="field-label">Motivo do arquivamento</span><textarea required minLength={5} maxLength={500} value={archiveReason} onChange={(event) => setArchiveReason(event.target.value)} /></label><div className="patient-detail-actions"><button className="button button-secondary" type="button" onClick={() => setArchivingPatient(null)}>Cancelar</button><button className="button button-danger" type="button" onClick={() => void confirmArchivePatient()} disabled={archiveReason.trim().length < 5}>Arquivar paciente</button></div></section></div>}
    </>}
  </section>
}

type ClinicalHistoryEntry = {
  id: string
  source: string
  category: string
  created_at: string
  actor_name: string
  title: string
  details: string[]
  status?: BehavioralStatus | null
}

type TriageHistoryRecord = {
  id: number
  arrival_reason: string
  allergies_status: string
  allergies: string
  conditions_treatments: string
  vital_values: Record<string, string>
  glucose_unit: string
  actor_name: string
  created_at: string
}

type OutpatientHistoryRecord = {
  id: number
  encounter_type: string
  physician_name: string
  examination: string
  activity_rows: Array<Record<string, string>>
  group_name: string
  programs: string[]
  diagnostic_hypothesis: string
  antibiotic_prescription: string
  referral: string
  created_by: string
  created_at: string
}

type PsychologyHistoryRecord = {
  id: number
  encounter_type: 'intake' | 'follow_up' | 'psychiatry'
  objective: string
  evolution: string
  plan: string
  actor_name: string
  created_at: string
}

type BehavioralHistoryRecord = {
  id: number
  observation: string
  context: string
  response: string
  status: BehavioralStatus | null
  actor_name: string
  created_at: string
}

type PatientBehavioralStatus = {
  patient_reference: string
  status: BehavioralStatus | null
  updated_at: string | null
}

type PatientFlowHistoryRecord = {
  id: number
  event_type: 'admission' | 'transfer' | 'discharge'
  previous_room: string
  previous_bed: string
  next_room: string
  next_bed: string
  reason: string
  summary: string
  actor_name: string
  occurred_at: string
}

async function loadPatientHistoryPages<T>(endpoint: string, collection: string): Promise<T[]> {
  const rows: T[] = []
  const pageSize = 100
  let hasMore = true
  while (hasMore) {
    const url = new URL(endpoint, window.location.origin)
    url.searchParams.set('limit', String(pageSize))
    url.searchParams.set('offset', String(rows.length))
    const page = await readApiResponse<Record<string, unknown>>(await fetch(`${url.pathname}${url.search}`))
    const pageRows = page[collection]
    if (!Array.isArray(pageRows)) throw new Error(`A resposta de ${collection} não contém uma lista válida.`)
    rows.push(...(pageRows as T[]))
    const total = typeof page.total === 'number' ? page.total : null
    hasMore = pageRows.length > 0 && total !== null && rows.length < total
  }
  return rows
}

function PatientHistoryPage({ patientReference, user, onBack }: { patientReference: string; user: AuthUser; onBack: () => void }) {
  useBreadcrumb('patient-history', 'Histórico assistencial')
  const pageSize = 50
  const [patients, setPatients] = useState<Patient[]>([])
  const [records, setRecords] = useState<VitalRecordData[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [metric, setMetric] = useState('saturation')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [timeline, setTimeline] = useState<ClinicalHistoryEntry[]>([])
  const [sourceErrors, setSourceErrors] = useState<Record<string, string>>({})
  const [timelineLoading, setTimelineLoading] = useState(true)
  const [timelineRevision, setTimelineRevision] = useState(0)
  const [behaviorForm, setBehaviorForm] = useState({ observation: '', context: '', response: '', status: '' as '' | BehavioralStatus })
  const [behaviorSaving, setBehaviorSaving] = useState(false)
  const [behaviorError, setBehaviorError] = useState('')
  const [behaviorNotice, setBehaviorNotice] = useState('')
  const patient = patients.find((item) => item.reference === patientReference)
  const hasPermission = (module: string, action: string) => user.is_superuser
    || (user.modules.includes(module as ModuleId) && user.permissions[module]?.includes(action) === true)
    || (module === 'admin' && user.permissions.admin?.includes('administrar') === true)
  const canReadClinical = ['nursing', 'physician', 'psychology', 'admin'].some((module) => hasPermission(module, 'consultar'))
  const canReadOutpatient = ['reception', 'nursing', 'physician', 'psychology', 'admin'].some((module) => hasPermission(module, 'consultar'))
  const canReadFlow = ['patients', 'nursing', 'physician', 'management', 'admin'].some((module) => hasPermission(module, 'consultar'))
  const canWriteBehavior = user.is_superuser
    || ['nursing', 'physician', 'psychology'].some((module) => hasPermission(module, 'consultar') && hasPermission(module, 'criar'))
    || hasPermission('admin', 'administrar')
  const canSetBehaviorStatus = user.is_superuser
    || ['physician', 'psychology'].some((module) => hasPermission(module, 'consultar') && hasPermission(module, 'criar'))
    || hasPermission('admin', 'administrar')

  useEffect(() => {
    let current = true
    Promise.all([
      fetch(`/api/v1/nursing/patients/${encodeURIComponent(patientReference)}`).then(readApiResponse<Patient>),
      fetch(`/api/v1/nursing/patients/${encodeURIComponent(patientReference)}/history?limit=${pageSize}&offset=${offset}`).then(readApiResponse<{ records?: VitalRecordData[]; total?: number }>),
    ]).then(([patientData, historyData]) => {
      return { patientData, historyData }
    }).then(({ patientData, historyData }) => {
      if (current) {
        setPatients([patientData])
        setRecords(historyData.records ?? [])
        setTotal(historyData.total ?? 0)
        setError('')
      }
    }).catch((loadError) => {
      if (current) setError(loadError instanceof Error ? loadError.message : 'Falha ao consultar o histórico.')
    }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [patientReference, offset])

  useEffect(() => {
    let current = true
    const reference = encodeURIComponent(patientReference)
    const sources: Array<{ key: string; label: string; endpoint: string; collection: string }> = []
    if (canReadFlow) sources.push({
      key: 'flow',
      label: 'Movimentações e internações',
      endpoint: `/api/v1/nursing/patients/flow-events?patient_reference=${reference}`,
      collection: 'events',
    })
    if (canReadClinical) {
      sources.push(
        {
          key: 'triage',
          label: 'Triagens de enfermagem',
          endpoint: `/api/v1/nursing/patients/${reference}/triage-history`,
          collection: 'records',
        },
        {
          key: 'psychology',
          label: 'Psicologia e Psiquiatria',
          endpoint: `/api/v1/psychology/encounters?patient_reference=${reference}`,
          collection: 'encounters',
        },
        {
          key: 'behavior',
          label: 'Histórico comportamental',
          endpoint: `/api/v1/nursing/patients/${reference}/behavioral-observations`,
          collection: 'observations',
        },
      )
    }
    if (canReadOutpatient) sources.push({
      key: 'outpatient',
      label: 'Atendimentos ambulatoriais',
      endpoint: `/api/v1/reception/encounters?patient_reference=${reference}`,
      collection: 'encounters',
    })
    void Promise.all(sources.map(async (source) => {
      try {
        const rows = source.key === 'flow'
            ? await loadPatientHistoryPages<PatientFlowHistoryRecord>(source.endpoint, source.collection)
            : source.key === 'triage'
              ? await loadPatientHistoryPages<TriageHistoryRecord>(source.endpoint, source.collection)
              : source.key === 'psychology'
                ? await loadPatientHistoryPages<PsychologyHistoryRecord>(source.endpoint, source.collection)
                : source.key === 'behavior'
                  ? await loadPatientHistoryPages<BehavioralHistoryRecord>(source.endpoint, source.collection)
                : await loadPatientHistoryPages<OutpatientHistoryRecord>(source.endpoint, source.collection)
        const entries: ClinicalHistoryEntry[] = rows.map((row) => {
          if (source.key === 'flow') {
            const event = row as PatientFlowHistoryRecord
            const title = event.event_type === 'admission'
              ? `Internação · quarto ${event.next_room}, leito ${event.next_bed}`
              : event.event_type === 'transfer'
                ? `Transferência · quarto ${event.previous_room}, leito ${event.previous_bed} → quarto ${event.next_room}, leito ${event.next_bed}`
                : `Alta · quarto ${event.previous_room}, leito ${event.previous_bed}`
            return { id: `${source.key}-${event.id}`, source: source.key, category: source.label, created_at: event.occurred_at, actor_name: event.actor_name, title, details: [event.reason, event.summary].filter(Boolean) }
          }
          if (source.key === 'triage') {
            const triage = row as TriageHistoryRecord
            const details = [
              triage.arrival_reason && `Motivo da chegada: ${triage.arrival_reason}`,
              `Alergias: ${triage.allergies_status === 'none_known' ? 'nenhuma conhecida' : triage.allergies_status === 'known' ? triage.allergies || 'relatadas' : 'não verificadas'}`,
              triage.conditions_treatments && `Condições e tratamentos: ${triage.conditions_treatments}`,
              ...Object.entries(triage.vital_values ?? {}).map(([name, value]) => `${name}: ${value}${name === 'glucose' ? ` ${triage.glucose_unit}` : ''}`),
            ].filter((detail): detail is string => Boolean(detail))
            return { id: `${source.key}-${triage.id}`, source: source.key, category: source.label, created_at: triage.created_at, actor_name: triage.actor_name, title: 'Triagem registrada', details }
          }
          if (source.key === 'psychology') {
            const encounter = row as PsychologyHistoryRecord
            const labels: Record<PsychologyHistoryRecord['encounter_type'], string> = { intake: 'Acolhimento inicial', follow_up: 'Acompanhamento', psychiatry: 'Atendimento psiquiátrico' }
            return { id: `${source.key}-${encounter.id}`, source: source.key, category: source.label, created_at: encounter.created_at, actor_name: encounter.actor_name, title: labels[encounter.encounter_type], details: [`Objetivo: ${encounter.objective}`, `Evolução: ${encounter.evolution}`, encounter.plan && `Plano: ${encounter.plan}`].filter(Boolean) }
          }
          if (source.key === 'behavior') {
            const observation = row as BehavioralHistoryRecord
            return { id: `${source.key}-${observation.id}`, source: source.key, category: source.label, created_at: observation.created_at, actor_name: observation.actor_name, title: 'Observação comportamental', details: [observation.observation, observation.context && `Contexto: ${observation.context}`, observation.response && `Resposta/conduta: ${observation.response}`].filter(Boolean), status: observation.status }
          }
          const encounter = row as OutpatientHistoryRecord
          return {
            id: `${source.key}-${encounter.id}`,
            source: source.key,
            category: source.label,
            created_at: encounter.created_at,
            actor_name: encounter.created_by,
            title: `Atendimento ambulatorial · ${encounter.encounter_type}`,
            details: [
              encounter.physician_name && `Profissional: ${encounter.physician_name}`,
              encounter.examination && `Exame clínico: ${encounter.examination}`,
              ...encounter.activity_rows.map((activity) => Object.entries(activity).map(([key, value]) => `${key}: ${value}`).join(' · ')),
              encounter.group_name && `Grupo: ${encounter.group_name}`,
              encounter.programs.length ? `Programas: ${encounter.programs.join(', ')}` : '',
              encounter.diagnostic_hypothesis && `Hipótese diagnóstica: ${encounter.diagnostic_hypothesis}`,
              encounter.antibiotic_prescription && `Prescrição: ${encounter.antibiotic_prescription}`,
              encounter.referral && `Encaminhamento: ${encounter.referral}`,
            ].filter(Boolean),
          }
        })
        return { key: source.key, entries, error: '' }
      } catch (sourceError) {
        return {
          key: source.key,
          entries: [] as ClinicalHistoryEntry[],
          error: sourceError instanceof Error ? sourceError.message : `Não foi possível carregar ${source.label.toLowerCase()}.`,
        }
      }
    })).then((results) => {
      if (!current) return
      setTimeline(results.flatMap((result) => result.entries).sort((left, right) => right.created_at.localeCompare(left.created_at)))
      setSourceErrors(Object.fromEntries(results.filter((result) => result.error).map((result) => [result.key, result.error])))
      setTimelineLoading(false)
    })
    return () => { current = false }
  }, [patientReference, timelineRevision, canReadClinical, canReadFlow, canReadOutpatient])

  const currentBehaviorStatus = timeline.find((entry) => entry.source === 'behavior' && entry.status)?.status ?? null
  const timelineSources = [
    { key: 'flow', label: 'Movimentações e internações', rows: timeline.filter((entry) => entry.source === 'flow') },
    { key: 'triage', label: 'Triagens de enfermagem', rows: timeline.filter((entry) => entry.source === 'triage') },
    { key: 'outpatient', label: 'Atendimentos ambulatoriais', rows: timeline.filter((entry) => entry.source === 'outpatient') },
    { key: 'psychology', label: 'Psicologia e Psiquiatria', rows: timeline.filter((entry) => entry.source === 'psychology') },
    { key: 'behavior', label: 'Histórico comportamental', rows: timeline.filter((entry) => entry.source === 'behavior') },
  ].filter((source) => source.key === 'flow' ? canReadFlow
    : source.key === 'outpatient' ? canReadOutpatient
      : canReadClinical)

  async function saveBehaviorObservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBehaviorSaving(true)
    setBehaviorError('')
    setBehaviorNotice('')
    try {
      await readApiResponse<BehavioralHistoryRecord>(await fetch(
        `/api/v1/nursing/patients/${encodeURIComponent(patientReference)}/behavioral-observations`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            observation: behaviorForm.observation,
            context: behaviorForm.context,
            response: behaviorForm.response,
            status: behaviorForm.status || null,
          }),
        },
      ))
      setBehaviorForm({ observation: '', context: '', response: '', status: '' })
      setBehaviorNotice('Registro comportamental incluído no histórico.')
      setTimelineLoading(true)
      setTimelineRevision((revision) => revision + 1)
    } catch (saveError) {
      setBehaviorError(saveError instanceof Error ? saveError.message : 'Não foi possível registrar a observação.')
    } finally {
      setBehaviorSaving(false)
    }
  }

  return <section className="patient-history-page page-enter">
    <div className="page-title-row"><div><p className="eyebrow">PRONTUÁRIO · ACESSO AUTORIZADO</p><h1>Histórico assistencial</h1><p className="welcome-copy">Linha do tempo de sinais vitais, triagens, atendimentos, movimentações e registros autorizados da equipe.</p></div><button className="button button-secondary" type="button" onClick={onBack}><ArrowLeft size={16} /> Voltar aos pacientes</button></div>
    {patient && <section className="patient-history-summary">
      {patient.photo_data ? <img src={patient.photo_data} alt="" /> : <span className="patient-registry-avatar"><UserRound size={22} /></span>}
      <div><h2>{patient.name}</h2><p>{patientLocationLabel(patient)}{patient.birth_date ? ` · ${new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${patient.birth_date}T00:00:00Z`))}` : ''}{patient.active === false ? ' · Alta registrada' : ''}</p>{patient.responsible_status === 'not_applicable' ? <small>Responsável pela internação: não se aplica</small> : patient.responsible_name && <small>Responsável pela internação: {patient.responsible_name} · {patient.responsible_phone || 'Contato não informado'}</small>}</div>
      <div className="patient-history-summary-status">{canReadClinical && (timelineLoading ? <span className="field-hint">Carregando semáforo…</span> : sourceErrors.behavior ? <span className="behavioral-status-unavailable">Semáforo indisponível</span> : <BehavioralStatusBadge status={currentBehaviorStatus} />)}<span className="module-total">{total} {total === 1 ? 'coleta' : 'coletas'} de sinais vitais</span></div>
    </section>}
    {error && <ToastMessage variant="error">{error}</ToastMessage>}
    {loading ? <div className="history-empty">Carregando cadastro e sinais vitais…</div> : <>
      <VitalTrendsDashboard patientReference={patientReference} patientName={patient?.name} />
      <VitalHistory records={records} patients={patients} patientReference={patientReference} metric={metric} onMetric={setMetric} showChart={false} />
      <VitalExtraDetails records={records} patientReference={patientReference} />
      {!loading && total > pageSize && <nav className="history-pagination" aria-label="Paginação das coletas de sinais vitais"><span>Exibindo {offset + 1}–{Math.min(offset + records.length, total)} de {total}</span><div><button className="button button-secondary" type="button" disabled={loading || offset === 0} onClick={() => { setLoading(true); setOffset(Math.max(0, offset - pageSize)) }}><ArrowLeft size={15} /> Anterior</button><button className="button button-secondary" type="button" disabled={loading || offset + pageSize >= total} onClick={() => { setLoading(true); setOffset(offset + pageSize) }}>Mais antigas <ArrowRight size={15} /></button></div></nav>}
    </>}
    <section className="patient-list-panel clinical-history-panel">
      <div className="section-heading"><div><p className="eyebrow">HISTÓRICO INTEGRADO</p><h2>Demais registros assistenciais</h2><p className="welcome-copy">Registros são exibidos por categoria, em ordem cronológica, conforme o acesso do seu perfil.</p></div></div>
      {timelineLoading && <div className="history-empty" role="status">Carregando demais registros assistenciais…</div>}
      {!timelineLoading && !timeline.length && !Object.keys(sourceErrors).length && <div className="history-empty">Nenhum outro registro foi localizado para este paciente.</div>}
      {timelineSources.map((source) => <section className="clinical-history-source" key={source.key}>
        <div className="section-heading"><h3>{source.label}</h3><span className="module-total">{source.rows.length}</span></div>
        {sourceErrors[source.key] && <ToastMessage variant="error">{`Falha ao carregar ${source.label.toLowerCase()}: ${sourceErrors[source.key]}`}</ToastMessage>}
        {!sourceErrors[source.key] && !timelineLoading && source.rows.length === 0 && <p className="field-hint">Nenhum registro nesta categoria.</p>}
        {source.rows.map((entry) => <article className="clinical-history-entry" key={entry.id}>
          <div><strong>{entry.title}</strong><time>{dateTime(entry.created_at)}</time></div>
          {entry.status !== undefined && <BehavioralStatusBadge status={entry.status} />}
          {entry.details.map((detail, index) => <p key={`${entry.id}-detail-${index}`}>{detail}</p>)}
          <small>Registrado por {entry.actor_name || 'Profissional não informado'}</small>
        </article>)}
      </section>)}
    </section>
    {canWriteBehavior && <section className="patient-list-panel behavioral-observation-form-panel">
      <div className="section-heading"><div><p className="eyebrow">REGISTRO DA EQUIPE ASSISTENCIAL</p><h2>Nova observação comportamental</h2><p className="welcome-copy">Descreva fatos observáveis, o contexto e a resposta da equipe. A classificação é manual e não é inferida pelo sistema.</p></div></div>
      {behaviorError && <ToastMessage variant="error">{behaviorError}</ToastMessage>}
      {behaviorNotice && <ToastMessage variant="success">{behaviorNotice}</ToastMessage>}
      <form className="field-grid field-grid-two" onSubmit={(event) => void saveBehaviorObservation(event)}>
        <label className="field"><span className="field-label">Observação objetiva</span><textarea required minLength={5} maxLength={2000} value={behaviorForm.observation} onChange={(event) => setBehaviorForm((current) => ({ ...current, observation: event.target.value }))} /></label>
        <label className="field"><span className="field-label">Contexto (opcional)</span><textarea maxLength={500} value={behaviorForm.context} onChange={(event) => setBehaviorForm((current) => ({ ...current, context: event.target.value }))} /></label>
        <label className="field"><span className="field-label">Resposta ou conduta adotada (opcional)</span><textarea maxLength={1000} value={behaviorForm.response} onChange={(event) => setBehaviorForm((current) => ({ ...current, response: event.target.value }))} /></label>
        {canSetBehaviorStatus && <label className="field"><span className="field-label">Semáforo comportamental · revisão profissional</span><select value={behaviorForm.status} onChange={(event) => setBehaviorForm((current) => ({ ...current, status: event.target.value as '' | BehavioralStatus }))}><option value="">Não alterar a sinalização atual</option><option value="green">Verde · bom comportamento</option><option value="yellow">Amarelo · requer atenção</option><option value="red">Vermelho · supervisão constante</option></select><span className="field-hint">Use somente conforme avaliação profissional e protocolo institucional; a atualização fica registrada no histórico.</span></label>}
        <button className="button button-primary" type="submit" disabled={behaviorSaving || behaviorForm.observation.trim().length < 5}>{behaviorSaving ? 'Registrando…' : 'Registrar observação'}</button>
      </form>
    </section>}
  </section>
}

const therapyActivityStatusLabels: Record<TherapyActivityStatus, string> = {
  scheduled: 'Agendada', in_progress: 'Em andamento', completed: 'Realizada', cancelled: 'Cancelada',
}

async function loadTherapyActivities(endpoint: string): Promise<TherapyActivity[]> {
  const activities: TherapyActivity[] = []
  let shouldLoad = true
  while (shouldLoad) {
    const url = new URL(endpoint, window.location.origin)
    url.searchParams.set('limit', '200')
    url.searchParams.set('offset', String(activities.length))
    const page = await readApiResponse<{ activities?: TherapyActivity[]; total?: number }>(
      await fetch(`${url.pathname}${url.search}`),
    )
    const rows = page.activities ?? []
    activities.push(...rows)
    const total = typeof page.total === 'number' ? page.total : null
    shouldLoad = total !== null && activities.length < total && rows.length > 0
  }
  return activities
}

function TherapyAttendanceManager({ activities, patients, canEdit, onSaved }: {
  activities: TherapyActivity[]
  patients: TherapyPatient[]
  canEdit: boolean
  onSaved: (activity: TherapyActivity) => void
}) {
  const [activityId, setActivityId] = useState('')
  const activity = activities.find((item) => item.id === activityId) ?? activities[0]

  return <section className="therapy-attendance-panel">
    <div className="section-heading"><div><p className="eyebrow">PARTICIPAÇÃO</p><h2>Lista de participantes e presença</h2></div></div>
    {!activities.length ? <div className="history-empty">Agende uma atividade para registrar participantes e presenças.</div> : <>
      <label className="field"><span className="field-label">Atividade</span><select value={activity?.id ?? ''} onChange={(event) => setActivityId(event.target.value)}>{activities.map((item) => <option key={item.id} value={item.id}>{item.title} · {dateTime(item.starts_at)}</option>)}</select></label>
      {activity && <TherapyAttendanceEditor key={activity.id} activity={activity} patients={patients} canEdit={canEdit} onSaved={onSaved} />}
    </>}
  </section>
}

function TherapyAttendanceEditor({ activity, patients, canEdit, onSaved }: {
  activity: TherapyActivity
  patients: TherapyPatient[]
  canEdit: boolean
  onSaved: (activity: TherapyActivity) => void
}) {
  const [participants, setParticipants] = useState<TherapyParticipant[]>(() => {
    const registered = activity.participants !== undefined
      ? activity.participants
      : activity.patient_reference ? [{ patient_reference: activity.patient_reference, attendance: 'pending' as const }] : []
    return registered.map((participant) => ({ ...participant }))
  })
  const [newParticipant, setNewParticipant] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function saveAttendance() {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`/api/v1/therapy/activities/${encodeURIComponent(activity.id)}/participants`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participants }),
      })
      const data = await readApiResponse<TherapyActivity>(response)
      setParticipants(data.participants ?? [])
      onSaved(data)
      setNotice('Participantes e presenças atualizados.')
      triggerMobileFeedback()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível salvar a presença.')
    } finally {
      setSaving(false)
    }
  }

  function addParticipant() {
    if (!newParticipant || participants.some((item) => item.patient_reference === newParticipant)) return
    setParticipants((current) => [...current, { patient_reference: newParticipant, attendance: 'pending' }])
    setNewParticipant('')
  }

  return <>
    {error && <ToastMessage variant="error">{error}</ToastMessage>}
    {notice && <ToastMessage variant="success">{notice}</ToastMessage>}
    {canEdit && <div className="therapy-attendance-add"><PatientSelect label="Adicionar participante" patients={patients.filter((patient) => !participants.some((item) => item.patient_reference === patient.reference))} value={newParticipant} onChange={setNewParticipant} /><button className="button button-secondary" type="button" onClick={addParticipant} disabled={!newParticipant}>Adicionar</button></div>}
    {participants.length ? <div className="therapy-attendance-list">{participants.map((participant) => {
          const patient = patients.find((item) => item.reference === participant.patient_reference)
          return <div className="therapy-attendance-row" key={participant.patient_reference}><span>{patient?.name ?? 'Paciente não localizado'}</span>{canEdit ? <><button className={`button therapy-attendance-toggle attendance-${participant.attendance}`} type="button" aria-pressed={participant.attendance === 'attended'} onClick={() => setParticipants((current) => current.map((item) => item.patient_reference === participant.patient_reference ? { ...item, attendance: item.attendance === 'attended' ? 'absent' : 'attended' } : item))}>{participant.attendance === 'attended' ? '✓ Presente' : participant.attendance === 'absent' ? 'Ausente' : 'Marcar presença'}</button><button className="button button-secondary" type="button" aria-label={`Remover ${patient?.name ?? 'participante'}`} onClick={() => setParticipants((current) => current.filter((item) => item.patient_reference !== participant.patient_reference))}>Remover</button></> : <strong className={`therapy-attendance-status attendance-${participant.attendance}`}>{participant.attendance === 'attended' ? 'Presente' : participant.attendance === 'absent' ? 'Ausente' : 'A confirmar'}</strong>}</div>
    })}</div> : <div className="history-empty">Nenhum participante foi incluído nesta atividade.</div>}
    {canEdit && <button className="button button-primary" type="button" onClick={() => void saveAttendance()} disabled={saving}>{saving ? 'Salvando…' : 'Salvar presença'}</button>}
  </>
}

function TherapyPage({ profile }: { profile: Profile }) {
  const [tab, setTab] = usePersistentTab(`scpo-tab-therapy-${profile.id}`, 'calendar', therapyTabValues, therapyTabLabels)
  const [patients, setPatients] = useState<TherapyPatient[]>([])
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
  const [form, setForm] = useState({ title: '', activity_type: '', description: '', location: 'Oficina Terapêutica', starts_at: '', ends_at: '', patient_reference: '', participant_references: [] as string[] })
  const [newParticipantReference, setNewParticipantReference] = useState('')

  useEffect(() => {
    let current = true
    const start = new Date(month.getFullYear(), month.getMonth(), 1).toISOString()
    const end = new Date(month.getFullYear(), month.getMonth() + 1, 1).toISOString()
    Promise.all([
      fetch('/api/v1/therapy/participants').then((response) => readApiResponse<{ participants?: TherapyPatient[] }>(response)),
      loadTherapyActivities(`/api/v1/therapy/activities?from_date=${encodeURIComponent(start)}&to_date=${encodeURIComponent(end)}`),
    ]).then(([patientData, loadedActivities]) => {
      if (current) {
        setPatients((patientData.participants ?? []).map((patient) => ({ ...patient, suppressClinicalData: true })))
        setActivities(loadedActivities)
        setReportDrafts(Object.fromEntries(loadedActivities.map((activity) => [activity.id, activity.activity_report ?? ''])))
        setReportStatuses(Object.fromEntries(loadedActivities.map((activity) => [activity.id, activity.status])))
        setError('')
      }
    }).catch((loadError) => {
      if (current) setError(readableApiError(loadError))
    }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [month])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (form.title.trim().length < 3) { setError('Informe um nome de atividade com pelo menos 3 caracteres.'); return }
    if (!form.activity_type) { setError('Selecione a modalidade da atividade.'); return }
    if (form.location.trim().length < 2) { setError('Informe o local da atividade.'); return }
    if (!form.starts_at || !Number.isFinite(new Date(form.starts_at).getTime())) { setError('Informe uma data e hora de início válidas.'); return }
    const payload: TherapyActivityPayload = {
      title: form.title.trim(),
      activity_type: form.activity_type,
      description: form.description.trim(),
      location: form.location.trim(),
      starts_at: new Date(form.starts_at).toISOString(),
      ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
      patient_reference: form.patient_reference || null,
      participant_references: form.participant_references,
    }
    setSaving(true); setError(''); setNotice('')
    try {
      const response = await fetch('/api/v1/therapy/activities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await readApiResponse<TherapyActivity>(response)
      if (new Date(data.starts_at).getFullYear() === month.getFullYear() && new Date(data.starts_at).getMonth() === month.getMonth()) { setActivities((items) => [...items, data].sort((a, b) => a.starts_at.localeCompare(b.starts_at))); setReportDrafts((items) => ({ ...items, [data.id]: data.activity_report ?? '' })); setReportStatuses((items) => ({ ...items, [data.id]: data.status })) }
      setForm({ title: '', activity_type: '', description: '', location: 'Oficina Terapêutica', starts_at: '', ends_at: '', patient_reference: '', participant_references: [] }); setNewParticipantReference(''); setShowForm(false); setNotice('Atividade incluída na agenda.')
    } catch (submitError) {
      const message = readableApiError(submitError)
      setError(message === 'Campo obrigatório: Dados da solicitação.'
        ? 'A API não recebeu o conteúdo da atividade. Atualize a página ou feche e reabra o aplicativo; se o erro persistir, informe o suporte e o horário da tentativa.'
        : message)
    } finally { setSaving(false) }
  }

  function addActivityParticipant() {
    if (!newParticipantReference || form.participant_references.includes(newParticipantReference)) return
    setForm((current) => ({ ...current, participant_references: [...current.participant_references, newParticipantReference] }))
    setNewParticipantReference('')
  }

  function removeActivityParticipant(reference: string) {
    setForm((current) => ({
      ...current,
      patient_reference: current.patient_reference === reference ? '' : current.patient_reference,
      participant_references: current.participant_references.filter((item) => item !== reference),
    }))
  }

  function selectActivityPatient(reference: string) {
    setForm((current) => ({
      ...current,
      patient_reference: reference,
      participant_references: reference && !current.participant_references.includes(reference)
        ? [...current.participant_references, reference]
        : current.participant_references,
    }))
  }

  async function saveActivityReport(activity: TherapyActivity) {
    setSavingReportId(activity.id); setError(''); setNotice('')
    try {
      const response = await fetch(`/api/v1/therapy/activities/${encodeURIComponent(activity.id)}/report`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activity_report: reportDrafts[activity.id] ?? '', status: reportStatuses[activity.id] ?? activity.status }) })
      const data = await readApiResponse<TherapyActivity>(response)
      setActivities((items) => items.map((item) => item.id === activity.id ? data : item))
      setReportDrafts((items) => ({ ...items, [activity.id]: data.activity_report ?? '' }))
      setReportStatuses((items) => ({ ...items, [activity.id]: data.status }))
      setNotice('Relatório da atividade salvo para consulta da Gestão Hospitalar.')
    } catch (saveError) { setError(readableApiError(saveError)) } finally { setSavingReportId('') }
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
    return { id: activity.id, date: activity.starts_at, title: activity.title, fields: [['Modalidade', activity.activity_type], ['Status', therapyActivityStatusLabels[reportStatuses[activity.id] ?? activity.status]], ['Horário', dateTime(activity.starts_at)], ['Local', activity.location], ['Participante', patient?.name ?? (activity.participants?.length ? `${activity.participants.length} participante(s)` : 'Grupo')], ['Objetivo', activity.description], ['Relatório', reportDrafts[activity.id] ?? activity.activity_report], ['Responsável pelo relatório', activity.report_updated_by || '']] }
  })

  return <section className="therapy-page page-enter">
    <div className="page-title-row"><span className="module-icon module-icon-therapy"><CalendarDays size={23} /></span><div><p className="eyebrow">MÓDULO · OFICINA TERAPÊUTICA</p><h1>Oficina Terapêutica</h1><p className="welcome-copy">Organize atividades, presenças e relatórios em áreas próprias.</p></div>{profile.modules.includes('therapy') && tab === 'calendar' && <button className="button button-primary" type="button" onClick={() => { setShowForm((value) => !value); setNotice(''); setError('') }}><CalendarDays size={16} /> {showForm ? 'Fechar agenda' : 'Agendar atividade'}</button>}</div>
    <div className="admin-tabs module-tabs" role="tablist" aria-label="Áreas da Oficina Terapêutica">
      <button className={`button ${tab === 'calendar' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={tab === 'calendar'} onClick={() => setTab('calendar')}><CalendarDays size={16} /> Atividades e calendário</button>
      <button className={`button ${tab === 'attendance' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={tab === 'attendance'} onClick={() => setTab('attendance')}><UsersRound size={16} /> Lista de presença</button>
      <button className={`button ${tab === 'reports' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={tab === 'reports'} onClick={() => setTab('reports')}><ClipboardList size={16} /> Relatórios</button>
      <button className={`button ${tab === 'materials' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={tab === 'materials'} onClick={() => setTab('materials')}><Package size={16} /> Materiais e imagens</button>
    </div>
    {notice && <ToastMessage variant="success">{notice}</ToastMessage>}{error && <ToastMessage variant="error">{error}</ToastMessage>}
    {tab === 'calendar' && <>
    <div className="hygiene-summary therapy-summary" aria-label="Resumo da Oficina Terapêutica"><article className="status-tone-neutral"><strong>{activities.length}</strong><span>Atividades no mês</span></article><article className="status-tone-progress"><strong>{todayActivityCount}</strong><span>Agendadas para hoje</span></article><article className={inProgressCount ? 'status-tone-warning' : 'status-tone-neutral'}><strong>{inProgressCount}</strong><span>Em andamento</span></article><article className="status-tone-success"><strong>{completedCount}</strong><span>Realizadas</span></article><article className="status-tone-progress"><strong>{activities.reduce((sum, activity) => sum + (activity.participants ?? []).filter((participant) => participant.attendance === 'attended').length, 0)}</strong><span>Presenças registradas</span></article></div>
    <div className="therapy-layout"><section className="therapy-calendar-panel"><div className="therapy-calendar-heading"><button className="icon-button" type="button" aria-label="Mês anterior" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={19} /></button><h2>{monthLabel}</h2><button className="icon-button" type="button" aria-label="Próximo mês" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={19} /></button></div><div className="therapy-calendar-grid therapy-calendar-weekdays">{['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((day) => <span key={day}>{day}</span>)}</div><div className="therapy-calendar-grid">{calendarCells.map((cell, index) => cell ? <article className={`therapy-calendar-day ${cell.birthdays.length ? 'has-birthday' : ''} ${cell.activities.length ? 'has-activity' : ''}`} key={cell.dateKey}><strong>{cell.day}</strong>{cell.birthdays.slice(0, 2).map((patient) => <span className="therapy-calendar-tag birthday-tag" key={patient.reference} title={`Aniversário: ${patient.name}`}>🎂 {patient.name.split(' ')[0]}</span>)}{cell.activities.slice(0, 2).map((activity) => <span className="therapy-calendar-tag activity-tag" key={activity.id} title={activity.title}>• {activity.title}</span>)}{cell.birthdays.length + cell.activities.length > 4 && <small>+{cell.birthdays.length + cell.activities.length - 4}</small>}</article> : <span className="therapy-calendar-day therapy-calendar-empty" key={`empty-${index}`} />)}</div><div className="therapy-calendar-legend"><span><i className="legend-birthday" /> Aniversários</span><span><i className="legend-activity" /> Atividades</span></div></section>
      <aside className="therapy-birthday-panel"><div className="section-heading"><div><p className="eyebrow">DATAS ESPECIAIS</p><h2>Aniversários</h2></div><span className="module-total">{birthdaysThisMonth.length}</span></div>{birthdaysThisMonth.length ? <div className="therapy-birthday-list">{birthdaysThisMonth.map((patient) => <article key={patient.reference}><span className="birthday-date">{new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: '2-digit', month: 'short' }).format(new Date(`${month.getFullYear()}-${patient.birth_date!.slice(5)}T00:00:00Z`))}</span><div><strong>{patient.name}</strong></div></article>)}</div> : <div className="history-empty">Nenhum aniversário cadastrado neste mês.</div>}<p className="field-hint">A agenda usa apenas nome e data de nascimento para organizar atividades e aniversários.</p></aside></div>
    {showForm && <form className="therapy-form" onSubmit={(event) => void submit(event)}><div className="section-heading"><div><p className="eyebrow">NOVA ATIVIDADE</p><h2>Dados da oficina</h2><p className="welcome-copy">Cadastre a proposta e os participantes; as presenças podem ser atualizadas depois.</p></div></div><div className="field-grid field-grid-two"><label className="field"><span className="field-label">Nome da atividade</span><input required minLength={3} maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Ex.: oficina de pintura" /></label><label className="field"><span className="field-label">Modalidade</span><select required value={form.activity_type} onChange={(event) => setForm({ ...form, activity_type: event.target.value })}><option value="">Selecione</option><option value="grupo">Grupo terapêutico</option><option value="arte">Arte e expressão</option><option value="música">Música</option><option value="movimento">Movimento corporal</option><option value="ocupacional">Atividade ocupacional</option><option value="recreação">Recreação</option><option value="outro">Outra</option></select></label><label className="field"><span className="field-label">Início</span><input required type="datetime-local" value={form.starts_at} onChange={(event) => setForm({ ...form, starts_at: event.target.value })} /></label><label className="field"><span className="field-label">Término (opcional)</span><input type="datetime-local" min={form.starts_at || undefined} value={form.ends_at} onChange={(event) => setForm({ ...form, ends_at: event.target.value })} /></label>
      <PatientSelect label="Paciente principal (opcional)" patients={patients} value={form.patient_reference} onChange={selectActivityPatient} emptyLabel="Atividade coletiva sem paciente principal" />
      <section className="therapy-participant-picker" aria-label="Participantes da atividade"><div><strong>Participantes</strong><span>Selecione os pacientes que participarão da oficina.</span></div><div className="therapy-participant-add"><PatientSelect label="Adicionar paciente" patients={patients.filter((patient) => !form.participant_references.includes(patient.reference))} value={newParticipantReference} onChange={setNewParticipantReference} /><button className="button button-secondary" type="button" onClick={addActivityParticipant} disabled={!newParticipantReference}>Adicionar</button></div>{form.participant_references.length ? <ul className="therapy-selected-participants">{form.participant_references.map((reference) => { const patient = patients.find((item) => item.reference === reference); return <li key={reference}><span>{patient?.name ?? 'Paciente não localizado'}</span><button className="button button-secondary" type="button" onClick={() => removeActivityParticipant(reference)} aria-label={`Remover ${patient?.name ?? 'paciente'}`}>Remover</button></li> })}</ul> : <p className="history-empty">Nenhum participante selecionado.</p>}</section>
    </div><p className="field-hint">Local padrão registrado: Oficina Terapêutica.</p><label className="field"><span className="field-label">Objetivo operacional (sem narrativa clínica)</span><textarea maxLength={1000} rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label><div className="patient-form-actions"><button className="button button-secondary" type="button" onClick={() => setShowForm(false)} disabled={saving}>Cancelar</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar atividade'} <ArrowRight size={16} /></button></div></form>}
    <section className="therapy-activity-list"><div className="section-heading"><div><p className="eyebrow">PROGRAMAÇÃO</p><h2>Atividades de {monthLabel}</h2></div><span className="module-total">{visibleActivities.length} / {activities.length}</span></div><div className="psychology-filter-row"><label className="field"><span className="field-label">Buscar por atividade, local ou paciente</span><input value={activityQuery} onChange={(event) => setActivityQuery(event.target.value)} placeholder="Nome, local ou paciente" /></label><label className="field"><span className="field-label">Situação</span><select value={activityFilter} onChange={(event) => setActivityFilter(event.target.value as typeof activityFilter)}><option value="all">Todas</option>{Object.entries(therapyActivityStatusLabels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select></label></div>{loading ? <div className="history-empty">Carregando agenda…</div> : visibleActivities.length ? <div className="therapy-activity-grid">{visibleActivities.map((activity) => { const patient = patients.find((item) => item.reference === activity.patient_reference); return <article key={activity.id} className="therapy-activity-card"><span className="therapy-activity-date"><strong>{new Intl.DateTimeFormat('pt-BR', { day: '2-digit' }).format(new Date(activity.starts_at))}</strong><small>{new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(new Date(activity.starts_at))}</small></span><div><span className="eyebrow">{activity.activity_type} · {new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(activity.starts_at))} · {therapyActivityStatusLabels[reportStatuses[activity.id] ?? activity.status]}</span><h3>{activity.title}</h3><p>{activity.location}{patient ? ` · ${patient.name}` : ' · Grupo'}</p>{patient && <PatientAllergyAlert patient={patient} />}{activity.description && <small>{activity.description}</small>}</div></article> })}</div> : <div className="history-empty">{activities.length ? 'Nenhuma atividade corresponde aos filtros selecionados.' : 'Nenhuma atividade agendada para este mês.'}</div>}</section>
    </>}
    {tab === 'reports' && <>
    <section className="therapy-report-panel"><div className="section-heading"><div><p className="eyebrow">ACOMPANHAMENTO</p><h2>Relatório de atividades · {monthLabel}</h2><p className="welcome-copy">{profile.modules.includes('therapy') ? 'Registre os resultados realizados e apresente o relatório à Gestão Hospitalar.' : 'Consulte os resultados registrados pela Oficina Terapêutica e imprima o relatório mensal.'}</p></div><button className="button button-secondary therapy-report-print-button" type="button" onClick={printActivityReport} disabled={!visibleActivities.length}><ClipboardList size={16} /> Imprimir relatório</button></div>{loading ? <div className="history-empty">Carregando relatórios…</div> : visibleActivities.length ? <div className="therapy-report-list">{visibleActivities.map((activity) => { const patient = patients.find((item) => item.reference === activity.patient_reference); const reportStatus = reportStatuses[activity.id] ?? activity.status; return <article className="therapy-report-card" key={`report-${activity.id}`}><div className="therapy-report-heading"><div><p className="eyebrow">{dateTime(activity.starts_at)} · {activity.activity_type}</p><h3>{activity.title}</h3><p>{activity.location}{patient ? ` · ${patient.name}${patient.room && patient.bed ? ` · Quarto ${patient.room}, leito ${patient.bed}` : ''}` : ' · Grupo'}</p>{patient && <PatientAllergyAlert patient={patient} />}</div><span className={`therapy-report-status therapy-report-status-${reportStatus}`}>{therapyActivityStatusLabels[reportStatus]}</span></div>{profile.modules.includes('therapy') ? <><label className="field"><span className="field-label">Relato da atividade</span><textarea rows={4} maxLength={4000} value={reportDrafts[activity.id] ?? ''} onChange={(event) => setReportDrafts((items) => ({ ...items, [activity.id]: event.target.value }))} placeholder="Descreva a participação, os resultados observados e os encaminhamentos necessários." /></label><div className="therapy-report-actions"><label className="field"><span className="field-label">Situação</span><select value={reportStatus} onChange={(event) => setReportStatuses((items) => ({ ...items, [activity.id]: event.target.value as TherapyActivityStatus }))}><option value="scheduled">Agendada</option><option value="in_progress">Em andamento</option><option value="completed">Realizada</option><option value="cancelled">Cancelada</option></select></label><button className="button button-primary" type="button" onClick={() => void saveActivityReport(activity)} disabled={savingReportId === activity.id}>{savingReportId === activity.id ? 'Salvando…' : 'Salvar relatório'}</button></div></> : <p className="therapy-report-content">{activity.activity_report || 'Relatório ainda não registrado.'}</p>}{activity.report_updated_by && <small className="therapy-report-author">Última atualização por {activity.report_updated_by}{activity.report_updated_at ? ` · ${dateTime(activity.report_updated_at)}` : ''}</small>}</article> })}</div> : <div className="history-empty">{activities.length ? 'Nenhuma atividade corresponde aos filtros selecionados.' : 'Agende uma atividade para iniciar o relatório do mês.'}</div>}</section>
    </>}
    {tab === 'attendance' && <TherapyAttendanceManager activities={activities} patients={patients} canEdit={profile.modules.includes('therapy')} onSaved={(updated) => setActivities((current) => current.map((activity) => activity.id === updated.id ? updated : activity))} />}
    {tab === 'materials' && <TherapyMaterialsPanel canEdit={profile.modules.includes('therapy')} />}
  </section>
}

function AboutPage() {
  const [tab, setTab] = useState<'overview' | 'help' | 'compliance'>('overview')
  const systemOverview = [
    { title: '1. Acesso individual', details: 'Cada pessoa utiliza sua própria conta. O acesso exige credenciais individuais e configuração de autenticação adicional; não compartilhe senhas ou códigos.' },
    { title: '2. Espaços de trabalho', details: 'A navegação apresenta os módulos disponíveis para o perfil da pessoa. As permissões definem quais ações podem ser feitas em cada módulo.' },
    { title: '3. Atendimento integrado', details: 'As equipes registram atividades nos fluxos correspondentes, como recepção, cadastro de pacientes, enfermagem, atendimento médico, farmácia e serviços de apoio.' },
    { title: '4. Acompanhamento e rastreabilidade', details: 'Painéis e relatórios apoiam o acompanhamento operacional. Ações administrativas relevantes são registradas para consulta e verificação.' },
    { title: '5. Proteção das informações', details: 'Consulte somente os dados necessários à sua atividade, confirme as informações antes de salvar e siga as políticas institucionais de privacidade e segurança.' },
  ]
  const legalReferences = [
    { title: 'LGPD · Lei nº 13.709/2018', articles: 'Arts. 5º, II (dado pessoal sensível, incluindo saúde); 6º, VII e VIII (segurança e prevenção); 11 (tratamento de dados sensíveis); 46 a 49 (segurança, sigilo e incidentes); 50 (boas práticas e governança).', href: 'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm', source: 'Presidência da República · texto compilado' },
    { title: 'Lei nº 13.787/2018 · digitalização e guarda de prontuários', articles: 'Dispõe sobre digitalização, uso de sistemas informatizados e guarda de prontuários de pacientes. A aplicação ao fluxo e aos prazos deve ser validada pela instituição.', href: 'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13787.htm', source: 'Presidência da República' },
    { title: 'ANPD · Guia de Segurança da Informação', articles: 'Orientações de medidas técnicas e administrativas para proteção de dados pessoais, com referência aos arts. 46 a 49 da LGPD.', href: 'https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_seguranca_da_informacao_para_atpps___defeso_eleitoral.pdf', source: 'Autoridade Nacional de Proteção de Dados' },
    { title: 'ANPD · Comunicação de incidentes', articles: 'Regulamento de Comunicação de Incidente de Segurança, Resolução CD/ANPD nº 15/2024. O controlador deve avaliar os critérios e prazos aplicáveis ao caso concreto.', href: 'https://www.in.gov.br/en/web/dou/-/resolucao-cd/anpd-n-15-de-24-de-abril-de-2024-556243024', source: 'Diário Oficial da União · ato normativo' },
  ]

  return <section className="about-page page-enter">
    <div className="page-title-row"><span className="module-icon module-icon-about"><Info size={23} /></span><div><p className="eyebrow">SCPO CONNECT</p><h1>Sobre e conformidade</h1><p className="welcome-copy">Entenda os fluxos do sistema e consulte referências legais e de privacidade.</p></div></div>
    <div className="admin-tabs module-tabs" role="tablist" aria-label="Seções sobre o SCPO Connect">
      <button id="about-tab-overview" className={`button ${tab === 'overview' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={tab === 'overview'} aria-controls="about-panel-overview" onClick={() => setTab('overview')}>Como o sistema funciona</button>
      <button id="about-tab-help" className={`button ${tab === 'help' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={tab === 'help'} aria-controls="about-panel-help" onClick={() => setTab('help')}>Dúvidas e solução de problemas</button>
      <button id="about-tab-compliance" className={`button ${tab === 'compliance' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={tab === 'compliance'} aria-controls="about-panel-compliance" onClick={() => setTab('compliance')}>Referências e conformidade</button>
    </div>
    {tab === 'overview'
      ? <div id="about-panel-overview" className="about-legal-grid" role="tabpanel" aria-labelledby="about-tab-overview" tabIndex={0}>{systemOverview.map((item) => <article className="about-legal-card" key={item.title}><p className="eyebrow">VISÃO GERAL</p><h2>{item.title}</h2><p>{item.details}</p></article>)}</div>
      : tab === 'help'
        ? <div id="about-panel-help" role="tabpanel" aria-labelledby="about-tab-help" tabIndex={0}><HelpGuide /></div>
        : <div id="about-panel-compliance" className="about-legal-grid" role="tabpanel" aria-labelledby="about-tab-compliance" tabIndex={0}>{legalReferences.map((item) => <article className="about-legal-card" key={item.title}><p className="eyebrow">REFERÊNCIA OFICIAL</p><h2>{item.title}</h2><p>{item.articles}</p><a href={item.href} target="_blank" rel="noreferrer">Consultar fonte oficial <ArrowRight size={15} /></a><small>{item.source}</small></article>)}</div>}
    <section className="patient-list-panel about-version"><span className="about-product-brand startup-brand" aria-hidden="true"><span className="startup-orbit startup-orbit-one" /><span className="startup-orbit startup-orbit-two" /><span className="startup-mark"><img className="startup-mark-base" src="/scpo-connect-icon.png" alt="" /><img className="startup-mark-fill" src="/scpo-connect-icon.png" alt="" /></span><span className="startup-glow" /></span><div><p className="eyebrow">IDENTIFICAÇÃO DO PRODUTO</p><h2>SCPO Connect · v{APP_VERSION}</h2><p className="welcome-copy">Versão inicial de produto em evolução. Desenvolvimento mantido pela equipe do SCPO Connect.</p></div></section>
  </section>
}

function Dashboard({ profile, onNavigate }: { profile: Profile; onNavigate: (id: ModuleId) => void }) {
  const allowedModules = modules.filter((item) => profile.modules.includes(item.id) || (item.id === 'therapy' && profile.modules.includes('management')))
  const firstName = profile.name.split(' ')[0]

  return (
    <section className="dashboard-page page-enter">
      <div className="welcome-row">
        <div><p className="eyebrow">{new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()).toUpperCase()}</p><h1>{getGreeting()}, {firstName}.</h1><p className="welcome-copy">Acesse os espaços de trabalho disponíveis para o seu perfil.</p></div>
        <div className="date-chip"><Clock3 size={16} /><span>{allowedModules.length} módulos disponíveis</span></div>
        <span className="module-icon module-icon-home" aria-hidden="true"><Home size={23} /></span>
      </div>

      <div className="section-heading"><div><p className="eyebrow">ACESSO POR PERFIL</p><h2>Seus espaços de trabalho</h2></div><span className="module-total">{allowedModules.length} espaços disponíveis</span></div>
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

function InstallAppButton({ showDescription = false }: { showDescription?: boolean }) {
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
  if (installed) return null
  return <div className={showDescription ? 'auth-install' : undefined}>
    {showDescription && <span>Use o SCPO como aplicativo no seu dispositivo.</span>}
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
  </div>
}

function NursingHistoryPage({ onBack }: { onBack: () => void }) {
  const { prompt } = useAppDialogs()
  useBreadcrumb('nursing-history', 'Coletas de sinais vitais')
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
      if (fromDate) params.set('from_at', new Date(fromDate).toISOString())
      if (toDate) params.set('to_at', new Date(toDate).toISOString())
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
    const reason = await prompt('Motivo para arquivar esta coleta incorreta (ela será preservada na auditoria):', 'Arquivar coleta', 'Motivo')
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
        <label className="field"><span className="field-label">Data e hora inicial</span><input type="datetime-local" value={fromDate} max={toDate || undefined} onChange={(event) => { setFromDate(event.target.value); setOffset(0) }} /></label>
        <label className="field"><span className="field-label">Data e hora final</span><input type="datetime-local" value={toDate} min={fromDate || undefined} onChange={(event) => { setToDate(event.target.value); setOffset(0) }} /></label>
        <label className="field"><span className="field-label">Quarto</span><select value={room} onChange={(event) => { setRoom(event.target.value); setBed(''); setPatientReference(''); setOffset(0) }}><option value="">Todos os quartos</option>{roomOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label className="field"><span className="field-label">Leito</span><select value={bed} onChange={(event) => { setBed(event.target.value); setPatientReference(''); setOffset(0) }}><option value="">Todos os leitos</option>{bedOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <PatientSelect className="history-filter-patient" label="Paciente" patients={visiblePatients} value={patientReference} onChange={(reference) => { setPatientReference(reference); setOffset(0) }} disabled={loadingPatients} emptyLabel="Todos os pacientes" optionLabel={(patient) => `${patient.name} · Qto ${patient.room} · Leito ${patient.bed}${patient.active === false ? ' · Alta' : ''}`} />
      </div>
      <button className="button button-secondary history-clear-button" type="button" onClick={clearFilters}>Limpar filtros</button>
    </section>
    <PrintSelectionPanel title="Coletas de sinais vitais" rows={vitalPrintRows} />
    {invalidDateRange && <ToastMessage variant="error">A data inicial deve ser anterior ou igual à data final.</ToastMessage>}
    {error && <ToastMessage variant="error">{error}</ToastMessage>}
    {invalidDateRange ? null : loadingRecords ? <div className="history-empty">Carregando coletas…</div> : <><VitalHistory records={records} patients={patients} patientReference={patientReference} metric={metric} onMetric={setMetric} onVoid={(id) => void voidRecord(id)} /><VitalExtraDetails records={records} patientReference={patientReference} /></>}
    {!loadingRecords && total > pageSize && <nav className="history-pagination" aria-label="Paginação das coletas"><span>Exibindo {offset + 1}–{Math.min(offset + records.length, total)} de {total}</span><div><button className="button button-secondary" type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}><ArrowLeft size={15} /> Anterior</button><span>Página {pageNumber} de {pageCount}</span><button className="button button-secondary" type="button" disabled={offset + pageSize >= total} onClick={() => setOffset(offset + pageSize)}>Próxima <ArrowRight size={15} /></button></div></nav>}
  </section>
}

function NursingHourlyRoundsPanel({ canUpdate }: { canUpdate: boolean }) {
  const [currentRound, setCurrentRound] = useState<NursingHourlyRound | null>(null)
  const [roundHistory, setRoundHistory] = useState<NursingHourlyRound[]>([])
  const [roundHistoryTotal, setRoundHistoryTotal] = useState(0)
  const [roundHistoryOffset, setRoundHistoryOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [exceptionPatient, setExceptionPatient] = useState('')
  const [exceptionType, setExceptionType] = useState('away')
  const [exceptionNote, setExceptionNote] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [currentResponse, historyResponse] = await Promise.all([
        fetch('/api/v1/nursing/hourly-rounds/current'),
        fetch(`/api/v1/nursing/hourly-rounds?limit=10&offset=${roundHistoryOffset}`),
      ])
      const [currentData, historyData] = await Promise.all([
        readApiResponse<{ round: NursingHourlyRound | null }>(currentResponse),
        readApiResponse<{ rounds: NursingHourlyRound[]; total?: number }>(historyResponse),
      ])
      setCurrentRound(currentData.round)
      setRoundHistory(historyData.rounds)
      setRoundHistoryTotal(historyData.total ?? historyData.rounds.length)
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar as verificações horárias.')
    } finally {
      setLoading(false)
    }
  }, [roundHistoryOffset])

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  async function startRound() {
    setBusy(true)
    setNotice('')
    try {
      await readApiResponse<NursingHourlyRound>(await fetch('/api/v1/nursing/hourly-rounds', { method: 'POST' }))
      setNotice('Verificação horária iniciada. Confira cada paciente e registre as ocorrências necessárias.')
      await refresh()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Não foi possível iniciar a verificação horária.')
    } finally {
      setBusy(false)
    }
  }

  async function updatePatient(patient: NursingHourlyRoundPatient, result: { status: 'checked' } | { status: 'exception'; exception_type: string; note: string }) {
    if (!currentRound) return
    setBusy(true)
    setNotice('')
    try {
      const updated = await readApiResponse<NursingHourlyRound>(await fetch(
        `/api/v1/nursing/hourly-rounds/${encodeURIComponent(currentRound.id)}/patients/${encodeURIComponent(patient.patient_reference)}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) },
      ))
      setCurrentRound(updated)
      setExceptionPatient('')
      setExceptionNote('')
      setError('')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Não foi possível registrar a conferência.')
    } finally {
      setBusy(false)
    }
  }

  async function updateElopementRisk(patient: NursingHourlyRoundPatient, atRisk: boolean) {
    setBusy(true)
    setNotice('')
    try {
      await readApiResponse(await fetch(
        `/api/v1/nursing/patients/${encodeURIComponent(patient.patient_reference)}/elopement-risk`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ at_risk: atRisk }) },
      ))
      setCurrentRound((round) => round ? {
        ...round,
        patients: round.patients.map((item) => item.patient_reference === patient.patient_reference
          ? { ...item, elopement_risk: atRisk }
          : item),
      } : round)
      setError('')
    } catch (riskError) {
      setError(riskError instanceof Error ? riskError.message : 'Não foi possível atualizar o risco de evasão.')
    } finally {
      setBusy(false)
    }
  }

  async function completeRound() {
    if (!currentRound) return
    setBusy(true)
    setNotice('')
    try {
      await readApiResponse<NursingHourlyRound>(await fetch(
        `/api/v1/nursing/hourly-rounds/${encodeURIComponent(currentRound.id)}/complete`,
        { method: 'POST' },
      ))
      setNotice('Verificação encerrada e registrada no histórico.')
      await refresh()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Não foi possível encerrar a verificação horária.')
    } finally {
      setBusy(false)
    }
  }

  const pendingCount = currentRound?.patients.filter((patient) => patient.status === 'pending').length ?? 0
  const riskGroups = [
    { atRisk: true, label: 'Com risco de evasão', patients: currentRound?.patients.filter((patient) => patient.elopement_risk) ?? [] },
    { atRisk: false, label: 'Sem risco de evasão', patients: currentRound?.patients.filter((patient) => !patient.elopement_risk) ?? [] },
  ]

  return (
    <section className="nursing-medication-panel">
      <div className="section-heading"><div><p className="eyebrow">REGISTRO OPERACIONAL · AUDITÁVEL</p><h2>Verificação horária de pacientes</h2><p className="welcome-copy">Confira os pacientes ativos com quarto e leito. Registre a conferência ou descreva uma ocorrência; a verificação só pode ser encerrada após todos os registros.</p></div><button className="button button-secondary" type="button" onClick={() => void refresh()} disabled={loading || busy}>Atualizar</button></div>
      {error && <ToastMessage variant="error">{error}</ToastMessage>}
      {notice && <ToastMessage variant="success">{notice}</ToastMessage>}
      {loading ? <p className="history-empty">Carregando verificação e histórico…</p> : currentRound ? <>
        <div className="nursing-overview-summary">
          <article><strong>{currentRound.patients.length}</strong><span>Pacientes nesta verificação · iniciada por {currentRound.started_by_name} às {dateTime(currentRound.started_at)}</span></article>
          <article className={pendingCount ? 'nursing-overview-warning' : ''}><strong>{pendingCount}</strong><span>Conferências pendentes</span></article>
          <article><strong>{currentRound.patients.length - pendingCount}</strong><span>Conferidos ou com ocorrência registrada</span></article>
        </div>
        <div className="hourly-round-groups">
          {riskGroups.map(({ atRisk, label, patients: groupPatients }) => <section className={`hourly-round-group ${atRisk ? 'hourly-round-group-risk' : 'hourly-round-group-clear'}`} key={label}>
            <h3>{label} <span>{groupPatients.length}</span></h3>
            <div className="nursing-medication-history">
          {groupPatients.map((patient) => <article className={`hourly-round-patient ${patient.elopement_risk ? 'hourly-round-patient-risk' : 'hourly-round-patient-clear'}`} key={patient.patient_reference}>
            <strong className="hourly-round-patient-heading">{patient.patient_name}<span>Quarto {patient.room} · Leito {patient.bed}</span></strong>
            <div className="hourly-round-records">
              <section className="hourly-round-record hourly-round-record-risk" aria-label="Acompanhamento do risco de evasão">
                <div><span className="field-label">Risco de evasão</span><span className={`hourly-round-risk-tag ${patient.elopement_risk ? 'hourly-round-risk-tag-active' : 'hourly-round-risk-tag-clear'}`}>{patient.elopement_risk ? 'Com risco' : 'Sem risco'}</span></div>
                {canUpdate && <button className="button button-secondary" type="button" disabled={busy} onClick={() => void updateElopementRisk(patient, !patient.elopement_risk)}>{patient.elopement_risk ? 'Alterar para sem risco' : 'Marcar risco de evasão'}</button>}
              </section>
              <section className="hourly-round-record hourly-round-record-check" aria-label="Verificação horária">
                <div><span className="field-label">Verificação desta hora</span><span className={`hourly-round-status hourly-round-status-${patient.status}`}>{hourlyRoundStatusLabels[patient.status]}{patient.status === 'exception' && patient.exception_type ? ` · ${hourlyRoundExceptionLabels[patient.exception_type] ?? patient.exception_type}` : ''}</span></div>
                <span className="hourly-round-record-meta">{patient.checked_by_name || 'Sem responsável registrado'}{patient.checked_at ? ` · ${dateTime(patient.checked_at)}` : ''}</span>
                {patient.note && <small>{patient.note}</small>}
                {canUpdate && <div className="nursing-overview-actions">
                  <button className="button button-primary" type="button" disabled={busy} onClick={() => void updatePatient(patient, { status: 'checked' })}>Registrar conferência</button>
                  <button className="button button-secondary" type="button" disabled={busy} onClick={() => { setExceptionPatient((selected) => selected === patient.patient_reference ? '' : patient.patient_reference); setExceptionNote('') }}>{exceptionPatient === patient.patient_reference ? 'Cancelar ocorrência' : 'Registrar ocorrência'}</button>
                </div>}
                {canUpdate && exceptionPatient === patient.patient_reference && <form className="field-grid field-grid-two" onSubmit={(event) => { event.preventDefault(); void updatePatient(patient, { status: 'exception', exception_type: exceptionType, note: exceptionNote.trim() }) }}>
                  <label className="field"><span className="field-label">Tipo de ocorrência</span><select value={exceptionType} onChange={(event) => setExceptionType(event.target.value)}><option value="away">Ausente / em atendimento externo</option><option value="location">Em outro local da instituição</option><option value="not_found">Não localizado</option><option value="other">Outro</option></select></label>
                  <label className="field"><span className="field-label">Descrição breve</span><input required minLength={3} maxLength={500} value={exceptionNote} onChange={(event) => setExceptionNote(event.target.value)} /></label>
                  <button className="button button-primary" type="submit" disabled={busy || exceptionNote.trim().length < 3}>{busy ? 'Salvando…' : 'Salvar ocorrência'}</button>
                </form>}
              </section>
            </div>
          </article>)}
            </div>
          </section>)}
        </div>
        {canUpdate && <div className="form-actions"><span className="draft-hint">{pendingCount ? `Ainda há ${pendingCount} paciente(s) sem conferência ou ocorrência.` : 'Todos os pacientes têm um registro.'}</span><button className="button button-primary" type="button" disabled={busy || pendingCount > 0} onClick={() => void completeRound()}>{busy ? 'Salvando…' : 'Encerrar verificação'}</button></div>}
        {!canUpdate && <p className="work-order-privacy">Seu perfil pode consultar a verificação, mas não possui permissão para alterar registros.</p>}
      </> : <div className="form-actions"><p className="history-empty">Não há verificação em andamento.</p>{canUpdate && <button className="button button-primary" type="button" disabled={busy} onClick={() => void startRound()}>{busy ? 'Iniciando…' : 'Iniciar verificação horária'}</button>}</div>}
      <div className="section-heading"><div><p className="eyebrow">REGISTROS ANTERIORES</p><h3>Histórico de verificações</h3></div><span className="module-total">{roundHistoryTotal}</span></div>
      {roundHistory.length ? <div className="nursing-medication-history">{roundHistory.map((round) => {
        const exceptions = round.patients.filter((patient) => patient.status === 'exception').length
        return <article key={round.id}><strong><span className={`hourly-round-status hourly-round-status-round-${round.status}`}>{round.status === 'open' ? 'Em andamento' : 'Encerrada'}</span> · {dateTime(round.started_at)}</strong><span>Iniciada por {round.started_by_name} · {round.patients.length} paciente(s) · {exceptions} ocorrência(s){round.completed_by_name ? ` · encerrada por ${round.completed_by_name}` : ''}</span><details className="hourly-round-details"><summary>Ver detalhes por paciente</summary><div>{round.patients.map((patient) => <section key={patient.patient_reference}><strong>{patient.patient_name} · Quarto {patient.room} · Leito {patient.bed}</strong><span className={`hourly-round-status hourly-round-status-${patient.status}`}>{hourlyRoundStatusLabels[patient.status]}{patient.status === 'exception' && patient.exception_type ? ` · ${hourlyRoundExceptionLabels[patient.exception_type] ?? patient.exception_type}` : ''} · {patient.checked_by_name || 'Sem responsável registrado'}{patient.checked_at ? ` · ${dateTime(patient.checked_at)}` : ''}</span>{patient.note && <small>{patient.note}</small>}</section>)}</div></details></article>
      })}</div> : <p className="history-empty">Nenhuma verificação anterior registrada.</p>}
      {roundHistoryTotal > 10 && <nav className="history-pagination" aria-label="Paginação do histórico de verificações"><span>Exibindo {roundHistoryOffset + 1}–{Math.min(roundHistoryOffset + roundHistory.length, roundHistoryTotal)} de {roundHistoryTotal}</span><div><button className="button button-secondary" type="button" disabled={roundHistoryOffset === 0 || loading} onClick={() => setRoundHistoryOffset((offset) => Math.max(0, offset - 10))}><ArrowLeft size={15} /> Anteriores</button><button className="button button-secondary" type="button" disabled={roundHistoryOffset + roundHistory.length >= roundHistoryTotal || loading} onClick={() => setRoundHistoryOffset((offset) => offset + 10)}>Mais antigas <ArrowRight size={15} /></button></div></nav>}
    </section>
  )
}

function NursingPage({ profile, user, onShowHistory, onOpenPatientHistory }: { profile: Profile; user: AuthUser; onShowHistory: () => void; onOpenPatientHistory: (reference: string) => void }) {
  const [record, setRecord] = useState<RecordFields>({ ...emptyRecord })
  const [notApplicable, setNotApplicable] = useState<string[]>([])
  const [entryState, setEntryState] = useState<EntryState>('draft')
  const [message, setMessage] = useState('')
  const [savedAt, setSavedAt] = useState('')
  const [patients, setPatients] = useState<Patient[]>([])
  const [patientRef, setPatientRef] = useState('')
  const [patientBehavioralStatuses, setPatientBehavioralStatuses] = useState<Record<string, PatientBehavioralStatus>>({})
  const [patientBehavioralStatusError, setPatientBehavioralStatusError] = useState('')
  const [patientBehavioralStatusLoading, setPatientBehavioralStatusLoading] = useState(true)
  const [historyError, setHistoryError] = useState('')
  const [medicationError, setMedicationError] = useState('')
  const [medicationLoading, setMedicationLoading] = useState(true)
  const [showPatientForm, setShowPatientForm] = useState(false)
  const [newPatient, setNewPatient] = useState({ name: '', room: '', bed: '' })
  const [nutritionResult, setNutritionResult] = useState<{ patientReference: string; plan: NutritionPlan | null; error: string } | null>(null)
  const [dispensations, setDispensations] = useState<MedicationDispensation[]>([])
  const [physicianPrescriptions, setPhysicianPrescriptions] = useState<PhysicianPrescription[]>([])
  const [administrations, setAdministrations] = useState<MedicationAdministration[]>([])
  const [medicationStatus, setMedicationStatus] = useState<MedicationAdministration['status']>('administered')
  const [medicationReason, setMedicationReason] = useState('')
  const [medicationDose, setMedicationDose] = useState('')
  const [selectedDispensation, setSelectedDispensation] = useState('')
  const [medicationSaving, setMedicationSaving] = useState(false)
  const [nursingTab, setNursingTab] = usePersistentTab(`scpo-tab-nursing-${profile.id}`, 'overview', nursingTabValues, nursingTabLabels)

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
    fetch('/api/v1/nursing/behavioral-status')
      .then(readApiResponse<{ statuses?: PatientBehavioralStatus[] }>)
      .then((result) => {
        if (current) {
          setPatientBehavioralStatuses(Object.fromEntries(
            (result.statuses ?? []).map((status) => [status.patient_reference, status]),
          ))
          setPatientBehavioralStatusError('')
        }
      }).catch((statusError) => {
        if (current) setPatientBehavioralStatusError(statusError instanceof Error ? statusError.message : 'Não foi possível carregar o semáforo comportamental.')
      }).finally(() => {
        if (current) setPatientBehavioralStatusLoading(false)
      })
    return () => { current = false }
  }, [])

  useEffect(() => {
    let current = true
    Promise.allSettled([
      fetch('/api/v1/pharmacy/dispensations?status=dispensed').then((response) => readApiResponse<{ dispensations?: MedicationDispensation[] }>(response)),
      fetch('/api/v1/nursing/medication-administrations').then((response) => readApiResponse<{ administrations?: MedicationAdministration[] }>(response)),
      fetch('/api/v1/physicians/prescriptions').then((response) => readApiResponse<{ prescriptions?: PhysicianPrescription[] }>(response)),
    ]).then(([dispenseResult, administrationResult, prescriptionResult]) => {
      if (!current) return
      setDispensations(dispenseResult.status === 'fulfilled' ? dispenseResult.value.dispensations ?? [] : [])
      setAdministrations(administrationResult.status === 'fulfilled' ? administrationResult.value.administrations ?? [] : [])
      setPhysicianPrescriptions(prescriptionResult.status === 'fulfilled' ? prescriptionResult.value.prescriptions ?? [] : [])
      const errors = [
        dispenseResult.status === 'rejected' ? `Dispensações da Farmácia: ${readableApiError(dispenseResult.reason)}` : '',
        administrationResult.status === 'rejected' ? `Administrações da Enfermagem: ${readableApiError(administrationResult.reason)}` : '',
        prescriptionResult.status === 'rejected' ? `Prescrições médicas: ${readableApiError(prescriptionResult.reason)}` : '',
      ].filter(Boolean)
      setMedicationError(errors.join(' '))
      setMedicationLoading(false)
    })
    return () => { current = false }
  }, [profile.id])

  useEffect(() => {
    if (!patientRef) {
      return
    }
    let current = true
    fetch(`/api/v1/nursing/patients/${encodeURIComponent(patientRef)}/nutrition-plan`)
      .then((response) => readApiResponse<NutritionPlan>(response))
      .then((data) => { if (current) setNutritionResult({ patientReference: patientRef, plan: data, error: '' }) })
      .catch((loadError) => {
        if (current) {
          setNutritionResult({
            patientReference: patientRef,
            plan: null,
            error: readableApiError(loadError),
          })
        }
      })
    return () => { current = false }
  }, [patientRef])
  const nutritionPlan = nutritionResult?.patientReference === patientRef ? nutritionResult.plan : null
  const nutritionError = nutritionResult?.patientReference === patientRef ? nutritionResult.error : ''

  async function addPatient(event: FormEvent) {
    event.preventDefault()
    setHistoryError('')
    try {
      const response = await fetch('/api/v1/nursing/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newPatient) })
      const patient = await readApiResponse<Patient>(response)
      setPatients((items) => [...items, patient])
      setPatientRef(patient.reference)
      setShowPatientForm(false)
      setNewPatient({ name: '', room: '', bed: '' })
    } catch (saveError) {
      setHistoryError(readableApiError(saveError))
    }
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
      triggerMobileFeedback()
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
      <div className="page-title-row"><span className="module-icon module-icon-nursing"><HeartPulse size={23} /></span><div><p className="eyebrow">MÓDULO · ENFERMAGEM</p><h1>Enfermagem</h1><p className="welcome-copy">Visão do paciente, coleta integrada de sinais vitais e acompanhamento das filas de cuidado.</p></div><div className="nursing-title-actions"><div className="nursing-vitals-action"><span className="module-icon"><Activity size={23} /></span><button className="button button-primary" type="button" onClick={() => setNursingTab('vitals')}><Activity size={16} /> Sinais vitais</button></div><button className="button button-secondary" type="button" onClick={onShowHistory}><ClipboardList size={16} /> Coletas registradas</button><a className="button button-secondary" href="/nursing.html"><HeartPulse size={16} /> PWA móvel</a><span className={`entry-status entry-status-${entryState}`}>{statusIcon}{stateLabels[entryState]}</span></div></div>
      {nursingTab !== 'triage' && <>
        <div className="patient-strip"><span className="patient-avatar"><UserRound size={19} /></span><PatientSelect className="patient-copy" label="Paciente" patients={patients} value={patientRef} onChange={setPatientRef} required optionLabel={(patient) => `${patient.name} · ${patientLocationLabel(patient)}`} /><PatientCareTrackBadge track={patients.find((patient) => patient.reference === patientRef)?.treatment_track} />{patientRef && patients.find((patient) => patient.reference === patientRef)?.room && patients.find((patient) => patient.reference === patientRef)?.bed && !patientBehavioralStatusLoading && !patientBehavioralStatusError && <BehavioralStatusBadge status={patientBehavioralStatuses[patientRef]?.status ?? null} />}<button className="button button-secondary" type="button" onClick={() => setShowPatientForm((visible) => !visible)}>Cadastrar paciente</button><div className="patient-meta"><span>Registrado por</span><strong>{profile.name}</strong></div></div>
        {patientBehavioralStatusError && <ToastMessage variant="error">{`Falha ao carregar o semáforo comportamental: ${patientBehavioralStatusError}`}</ToastMessage>}
        <PatientAllergyAlert patient={patients.find((patient) => patient.reference === patientRef)} />
      </>}
      <ModuleTabNavigation
        className="nursing-tabs"
        ariaLabel="Seções de Enfermagem"
        value={nursingTab}
        onChange={setNursingTab}
        options={nursingTabValues.map((value) => ({ value, label: nursingTabLabels[value] }))}
      />
      {nursingTab === 'triage' && <Suspense fallback={<div className="history-empty" role="status">Carregando fila de triagem…</div>}><NursingTriagePanel canUpdate={user.permissions.nursing?.includes('criar') ?? false} /></Suspense>}
      {nursingTab === 'medications' && <>
      {medicationError && <ToastMessage variant="error">{medicationError}</ToastMessage>}
      <section className="nursing-medication-panel">
        <div className="section-heading"><div><p className="eyebrow">PRESCRIÇÃO MÉDICA → FARMÁCIA → ENFERMAGEM</p><h2>Prescrições deste paciente</h2><p className="welcome-copy">A Farmácia confere e registra a dispensação; a Enfermagem registra a administração somente após a dispensação.</p></div></div>
        {medicationLoading ? <p className="history-empty">Carregando prescrições…</p> : physicianPrescriptions.filter((prescription) => prescription.patient_reference === patientRef).length ? <div className="nursing-medication-history">{physicianPrescriptions.filter((prescription) => prescription.patient_reference === patientRef).map((prescription) => <article key={prescription.id}><strong>{prescription.medication_name}{prescription.presentation ? ` · ${prescription.presentation}` : ''}</strong><span>{prescription.dose} · {prescription.route} · {prescription.frequency} · {prescription.duration} · {prescription.quantity} {prescription.unit}</span>{prescription.administration_times.length > 0 && <span>Horários definidos pelo prescritor: {prescription.administration_times.join(' · ')}</span>}<span>{prescription.status === 'pending' ? 'Aguardando Farmácia' : prescription.status === 'fulfilled' ? 'Dispensada · confira o registro abaixo para administrar' : 'Cancelada'} · {prescription.prescriber_name} · CRM {prescription.crm}/{prescription.crm_state}</span>{prescription.instructions && <small>{prescription.instructions}</small>}</article>)}</div> : medicationError.includes('Prescrições médicas:') ? <p className="history-empty">O serviço de prescrições não respondeu. Os demais dados disponíveis continuam visíveis.</p> : <p className="history-empty">Não há prescrições médicas para o paciente selecionado.</p>}
      </section>
      <section className="nursing-medication-panel">
        <div className="section-heading"><div><p className="eyebrow">FARMÁCIA → ENFERMAGEM</p><h2>Dispensações deste paciente</h2><p className="welcome-copy">A Farmácia registra lote, prescrição e baixa de estoque; a Enfermagem registra administração, recusa ou suspensão.</p></div></div>
        {medicationLoading ? <p className="history-empty">Carregando dispensações…</p> : medicationError.includes('Administrações da Enfermagem:') ? <p className="history-empty">Não é seguro calcular o saldo sem carregar as administrações já registradas. Corrija a conexão antes de registrar outra ação.</p> : medicationError.includes('Dispensações da Farmácia:') ? <p className="history-empty">O serviço de dispensações da Farmácia não respondeu; não é possível confirmar os itens disponíveis.</p> : dispensations.filter((item) => item.patient_reference === patientRef && remainingDispensedQuantity(item, administrations) > 0).length > 0 ? <form className="field-grid field-grid-two" onSubmit={(event) => void saveMedicationAdministration(event)}>
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
      {nutritionError && <ToastMessage variant="error">{`Não foi possível consultar o plano alimentar: ${nutritionError}`}</ToastMessage>}
      {nutritionPlan && (nutritionPlan.assessment_date || nutritionPlan.fasting_at) && <div className="care-plan-strip"><strong>Plano alimentar compartilhado</strong>{nutritionPlan.assessment_date && <span>Avaliação de {new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${nutritionPlan.assessment_date}T00:00:00Z`))} · {nutritionPlan.diet_type || 'Tipo de dieta não informado'}{nutritionPlan.restrictions ? ` · Restrições: ${nutritionPlan.restrictions}` : ''}</span>}{nutritionPlan.fasting_at && <span className="fasting-alert">Jejum programado: {dateTime(nutritionPlan.fasting_at)}{nutritionPlan.fasting_reason ? ` · ${nutritionPlan.fasting_reason}` : ''}</span>}</div>}
      </>}
      {showPatientForm && <form className="patient-create-form" onSubmit={addPatient}><label className="field"><span className="field-label">Nome do paciente</span><input required value={newPatient.name} onChange={(event) => setNewPatient({ ...newPatient, name: event.target.value })} /></label><label className="field"><span className="field-label">Quarto</span><input required value={newPatient.room} onChange={(event) => setNewPatient({ ...newPatient, room: event.target.value })} /></label><label className="field"><span className="field-label">Leito</span><input required value={newPatient.bed} onChange={(event) => setNewPatient({ ...newPatient, bed: event.target.value })} /></label><button className="button button-primary" type="submit">Salvar paciente</button></form>}
      {historyError && <ToastMessage variant="error">{historyError}</ToastMessage>}

      {nursingTab === 'overview' && patients.length > 0 ? (
        <section className="patient-list-panel nursing-overview">
          <div className="section-heading"><div><p className="eyebrow">ACOMPANHAMENTO DO TURNO</p><h2>Resumo de Enfermagem</h2><p className="welcome-copy">Indicadores cadastrais e pendências de registro para orientar a navegação; não representam avaliação clínica.</p></div></div>
          <div className="nursing-overview-summary">
            <article><strong>{activePatientCount}</strong><span>Pacientes ativos no cadastro</span></article>
            <article className={allergyReviewCount ? 'nursing-overview-warning' : ''}><strong>{allergyReviewCount}</strong><span>Cadastros com alergias ainda não revisadas</span></article>
            <article><strong>{pendingMedicationCount}</strong><span>Dispensações sem registro de ação da Enfermagem</span></article>
          </div>
          <div className="nursing-overview-patient"><div><p className="eyebrow">PACIENTE SELECIONADO</p><strong>{patients.find((patient) => patient.reference === patientRef)?.name ?? 'Selecione um paciente'}</strong><span>{patients.find((patient) => patient.reference === patientRef) ? patientLocationLabel(patients.find((patient) => patient.reference === patientRef)!) : 'Cadastro necessário para iniciar registros.'}</span></div><div className="patient-row-actions"><button className="button button-primary" type="button" onClick={() => setNursingTab('vitals')} disabled={!patientRef}><Activity size={16} /> Iniciar coleta de sinais vitais</button><button className="button button-secondary" type="button" onClick={() => onOpenPatientHistory(patientRef)} disabled={!patientRef}>Histórico assistencial completo</button></div></div>
          {patientRef ? <VitalTrendsDashboard patientReference={patientRef} patientName={patients.find((patient) => patient.reference === patientRef)?.name} /> : <div className="placeholder-state patient-empty-state"><span className="placeholder-state-icon"><UsersRound size={20} /></span><div><strong>Selecione um paciente</strong><p>Os gráficos e a tabela de evolução ficam disponíveis depois que um paciente é escolhido para a consulta.</p></div></div>}
          <div className="nursing-overview-actions">
            <button className="button button-secondary" type="button" onClick={() => setNursingTab('medications')}>Conferir medicações <ArrowRight size={15} /></button>
            <button className="button button-secondary" type="button" onClick={() => setNursingTab('safety')}>Abrir fila e segurança <ArrowRight size={15} /></button>
            <button className="button button-secondary" type="button" onClick={onShowHistory}>Consultar coletas registradas <ArrowRight size={15} /></button>
          </div>
        </section>
      ) : nursingTab !== 'safety' && nursingTab !== 'medications' && nursingTab !== 'rounds' && patients.length === 0 ? (
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
              <ValueField label="Pressão arterial" unit="mmHg" value={record.pressure} disabled={notApplicable.includes('pressure')} onChange={(value) => updateField('pressure', value)} onNA={() => toggleNotApplicable('pressure')} isNA={notApplicable.includes('pressure')} placeholder="Ex.: 120/80" pattern="\\d{1,4}/\\d{1,4}" hint="Informe sistólica/diastólica; o gráfico separa os dois valores em séries distintas." />
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

          {message && <ToastMessage variant={entryState === 'error' ? 'error' : 'success'}>{message}</ToastMessage>}
          <div className="form-actions"><span className="draft-hint"><Pencil size={14} /> Rascunho temporário nesta sessão</span><button className="button button-primary" type="submit">Revisar {nursingTab === 'vitals' ? 'coleta' : 'registro'} <ArrowRight size={17} /></button></div>
        </form>) : null}

      {nursingTab === 'vitals' && patientRef && <VitalTrendsDashboard patientReference={patientRef} patientName={patients.find((patient) => patient.reference === patientRef)?.name} />}
      {nursingTab === 'vitals' && <div className="clinical-note"><ShieldCheck size={17} /><span>Os gráficos apresentam os valores registrados, sem interpretação clínica automática.</span></div>}
      {nursingTab === 'safety' && <ClinicalQueuePanel canUpdate={user.permissions.nursing?.includes('alterar') ?? false} />}
      {nursingTab === 'safety' && <PatientFlowRiskPanel
        patients={patients}
        canUpdate={user.permissions.nursing?.includes('alterar') ?? false}
        onPatientUpdated={(updated) => setPatients((current) => current.map((patient) => patient.reference === updated.reference ? updated : patient))}
      />}
      {nursingTab === 'rounds' && <NursingHourlyRoundsPanel canUpdate={user.permissions.nursing?.includes('alterar') ?? false} />}
    </section>
  )
}

function isClinicalQueueArrival(arrival: EmergencyArrival) {
  return (arrival.status === 'waiting' || arrival.status === 'called' || arrival.status === 'in_service')
    && arrival.reason !== 'Ficha ambulatorial registrada'
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
      const openArrivals = (data.arrivals ?? []).filter(isClinicalQueueArrival)
      setArrivals(openArrivals)
      setSelectedId((current) => (openArrivals.some((arrival) => arrival.id === current) ? current : openArrivals[0]?.id ?? ''))
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar a fila clínica.')
    }
  }, [])

  useEffect(() => {
    let active = true

    const loadQueue = async () => {
      if (!active) return
      try {
        const response = await fetch('/api/v1/reception/arrivals?limit=100')
        const data = await readApiResponse<{ arrivals?: EmergencyArrival[] }>(response)
        const openArrivals = (data.arrivals ?? []).filter(isClinicalQueueArrival)
        if (!active) return
        setArrivals(openArrivals)
        setSelectedId((current) => (openArrivals.some((arrival) => arrival.id === current) ? current : openArrivals[0]?.id ?? ''))
        setError('')
      } catch (loadError) {
        if (!active) return
        setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar a fila clínica.')
      }
    }

    void loadQueue()
    const timer = window.setInterval(() => {
      void loadQueue()
    }, 15_000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])
  const selectedArrival = arrivals.find((arrival) => arrival.id === selectedId)
  const arrivalOptions = arrivals.map((arrival) => ({
    reference: arrival.id,
    name: arrival.patient_name,
    room: arrival.created_at,
  }))

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
    {error && <ToastMessage variant="error">{error}</ToastMessage>}
    {notice && <ToastMessage variant="success">{notice}</ToastMessage>}
    {arrivals.length === 0 ? <div className="history-empty">Nenhuma chegada aguardando atendimento ou em atendimento.</div> : <>
      <div className="collection-list">{arrivals.map((arrival) => <article className="collection-row" key={arrival.id}>
        <div className="collection-row-heading"><strong>{arrival.patient_name}</strong><span className={`work-order-status status-${arrival.clinical_priority}`}>{priorityLabels[arrival.clinical_priority]}</span></div>
        <p>{arrival.reason}</p><span className={`work-order-status status-${arrival.queue_type === 'priority' ? 'priority' : 'routine'}`}>{arrival.queue_type === 'priority' ? 'Fila prioritária' : 'Fila comum'}</span><ReceptionAllergyAlert status={arrival.allergies_status} />
        {arrival.allergy_report_status === 'reported' && <div className="clinical-alert" role="alert"><AlertTriangle size={19} /><div><strong>Alergia relatada · aguarda confirmação clínica</strong><span>{arrival.reported_allergies || 'Detalhes não disponíveis nesta fila.'}</span></div></div>}
        <small>{arrival.status === 'waiting' ? 'Aguardando' : 'Em atendimento'} · Chegada {dateTime(arrival.created_at)}{arrival.clinical_priority_updated_by ? ` · Classificada por ${arrival.clinical_priority_updated_by}` : ''}</small>
      </article>)}</div>
      {canUpdate && <form className="account-create-panel" onSubmit={(event) => void savePriority(event)}>
        <div className="field-grid field-grid-three">
          <PatientSelect label="Chegada / paciente" patients={arrivalOptions} value={selectedId} onChange={(reference) => { setSelectedId(reference); const arrival = arrivals.find((item) => item.id === reference); setPriority(arrival?.clinical_priority ?? 'priority') }} required optionLabel={(arrival) => `${arrival.name} · ${dateTime(arrival.room)}`} />
          <label className="field"><span className="field-label">Classificação clínica</span><select value={priority} onChange={(event) => setPriority(event.target.value as EmergencyClinicalPriority)}><option value="unassigned">Não classificada</option><option value="routine">Rotina</option><option value="priority">Prioridade</option><option value="urgent">Urgente</option></select></label>
          <label className="field"><span className="field-label">Justificativa clínica</span><input required minLength={3} maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        </div>
        <button className="button button-primary" type="submit" disabled={!selectedArrival || busy}>{busy ? 'Salvando…' : 'Registrar classificação'}</button>
      </form>}
    </>}
  </section>
}

function PatientFlowRiskPanel({ patients, canUpdate, onPatientUpdated }: { patients: Patient[]; canUpdate: boolean; onPatientUpdated: (patient: Patient) => void }) {
  const { prompt } = useAppDialogs()
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
  const activePatients = patients.filter((item) => item.active !== false)
  const selectedPatient = activePatients.find((item) => item.reference === selectedReference) ?? activePatients[0]
  useBreadcrumb('management-patient-flow', flowType === 'transfer' ? 'Transferência' : 'Alta', 2)
  useBreadcrumb('management-patient-flow-patient', selectedPatient?.name ?? null, 3)
  const patient = selectedPatient

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
    const resolutionReason = await prompt('Informe o motivo clínico para resolver esta contraindicação:', 'Resolver contraindicação', 'Motivo clínico')
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
    {error && <ToastMessage variant="error">{error}</ToastMessage>}
    {notice && <ToastMessage variant="success">{notice}</ToastMessage>}
    {activePatients.length === 0 ? <div className="history-empty">Não há pacientes ativos para transferência, alta ou avaliação de riscos.</div> : <>
      <PatientSelect label="Paciente internado" patients={activePatients} value={patient?.reference ?? ''} onChange={setSelectedReference} required optionLabel={patientLocationLabel} />
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
  { key: 'pressure', label: 'Pressão arterial · sistólica e diastólica', unit: 'mmHg', field: 'pressure' },
  { key: 'heartRate', label: 'Frequência cardíaca', unit: 'bpm', field: 'heartRate' },
  { key: 'respiratoryRate', label: 'Frequência respiratória', unit: 'rpm', field: 'respiratoryRate' },
  { key: 'glucose_mgdl', label: 'Glicose · mg/dL', unit: 'mg/dL', field: 'glucose', glucoseUnit: 'mg/dL' },
  { key: 'glucose_mmoll', label: 'Glicose · mmol/L', unit: 'mmol/L', field: 'glucose', glucoseUnit: 'mmol/L' },
]

function VitalHistory({ records, patients, patientReference, metric, onMetric, onVoid, showChart = true }: { records: VitalRecordData[]; patients: Patient[]; patientReference?: string; metric: string; onMetric: (value: string) => void; onVoid?: (id: number) => void; showChart?: boolean }) {
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
  return <section className="vital-history">{showChart ? <><div className="history-heading"><div><p className="eyebrow">CONSULTA DE REGISTROS</p><h2>Histórico de sinais vitais</h2><p className="welcome-copy">Confira os valores registrados, horário e profissional responsável.</p></div><label className="history-metric"><span className="field-label">Indicador</span><select value={metric} onChange={(event) => onMetric(event.target.value)}>{vitalMetrics.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label></div>{!patientReference ? <div className="history-empty"><Activity size={20} /><span>Selecione um paciente para visualizar a evolução no gráfico.</span></div> : points.length ? <><div className="history-chart"><svg viewBox="0 0 100 100" role="img" aria-label={`Gráfico de ${config.label}`} preserveAspectRatio="none"><line x1="5" y1="90" x2="95" y2="90" className="chart-axis" />{points.length > 1 && <polyline points={line} className="chart-line" />}{coordinates.map((point) => <circle key={`${point.label}-${point.index}`} cx={point.x} cy={point.y} r="2.1" className="chart-point"><title>{point.label}: {point.value} {config.unit}</title></circle>)}</svg></div><div className="history-values">{coordinates.slice(-5).reverse().map((point) => <span key={`${point.label}-${point.index}`}><strong>{point.value} {config.unit}</strong><small>{point.label}</small></span>)}</div></> : <div className="history-empty"><Activity size={20} /><span>Não há valores deste indicador no período consultado.</span></div>}</> : <div className="section-heading"><div><p className="eyebrow">REGISTROS DO PRONTUÁRIO</p><h2>Coletas recentes</h2><p className="welcome-copy">Valores registrados, horário e profissional responsável.</p></div></div>}{records.length > 0 && <div className="collection-list"><h3>{showChart ? 'Coletas recentes' : 'Coletas registradas'}</h3>{records.map((record) => { const patient = patients.find((item) => item.reference === record.patient_reference); return <article className="collection-row" key={record.id}><div className="collection-row-heading"><strong>{patient?.name ?? 'Paciente'} · Qto {patient?.room ?? '—'} · Leito {patient?.bed ?? '—'}</strong><time>{dateTime(record.recorded_at)}</time></div><div className="collection-values">{[['Saturação', record.values.saturation && `${record.values.saturation}%`], ['Pressão', record.values.pressure], ['FC', record.values.heartRate && `${record.values.heartRate} bpm`], ['FR', record.values.respiratoryRate && `${record.values.respiratoryRate} rpm`], ['Glicose', record.values.glucose && `${record.values.glucose} ${record.glucose_unit}`], ['Dor', record.values.pain], ['Oxigênio', record.values.oxygenStatus], ['Lesões', record.values.wounds], ['Exame', record.values.examName]].filter(([, value]) => value).map(([label, value]) => <span key={label}><small>{label}</small><strong>{value}</strong></span>)}</div><small className="collection-actor">Registrado por {record.actor_name}</small>{onVoid && <button className="button button-danger" type="button" onClick={() => onVoid(record.id)}>Arquivar registro incorreto</button>}</article> })}</div>}</section>
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

function ValueField({ label, unit, value, disabled, onChange, onNA, isNA, placeholder, inputMode, pattern, hint }: { label: string; unit: string; value: string; disabled: boolean; onChange: (value: string) => void; onNA: () => void; isNA: boolean; placeholder?: string; inputMode?: 'numeric' | 'decimal'; pattern?: string; hint?: string }) {
  const id = `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return (
    <div className="field value-field"><label className="field-label" htmlFor={id}>{label}</label><div className={`input-with-unit ${isNA ? 'input-na' : ''}`}><input id={id} type="text" inputMode={inputMode} pattern={pattern} value={value} onChange={(event) => onChange(inputMode === 'decimal' ? formatDecimalInput(event.target.value) : event.target.value)} placeholder={isNA ? 'Não se aplica' : placeholder ?? 'Não preenchido'} disabled={disabled} /><span className="unit-label">{unit}</span></div>{hint && <span className="field-hint">{hint}</span>}<label className="checkbox-label"><input type="checkbox" checked={isNA} onChange={onNA} /><span>Não se aplica</span></label></div>
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

type Account = { id: string; username: string; name: string; role: string; modules: string[]; permissions: Record<string, string[]>; active: boolean; must_change_password: boolean; mfa_enabled: boolean; is_superuser: boolean }

const moduleLabels: Record<string, string> = {
  patients: 'Pacientes', nursing: 'Enfermagem', pharmacy: 'Farmácia', xray: 'Central de Exames', physician: 'Médico', social: 'Serviço Social',
  nutrition: 'Nutrição', hygiene: 'Higienização', reception: 'Recepção', therapy: 'Oficina Terapêutica',
  psychology: 'Psicologia / Psiquiatria', maintenance: 'Manutenção',
  management: 'Gestão Hospitalar', admin: 'Administração do aplicativo', oversight: 'Relatórios e auditoria',
}
const accessModules = Object.entries(moduleLabels)

function AdminPage({ user, view = 'full' }: { user: AuthUser; view?: 'full' | 'accounts' }) {
  const canManageApp = user.is_superuser || (
    user.role !== 'management'
    && user.modules.includes('admin')
    && Boolean(user.permissions.admin?.includes('administrar'))
  )
  const canCreateAccounts = canManageApp
  const canDeleteAccounts = canCreateAccounts
  const canReviewData = user.modules.includes('admin') || Boolean(user.permissions.oversight?.includes('consultar'))
  const availableTabs = useMemo<readonly (typeof adminTabValues[number])[]>(
    () => view === 'accounts'
      ? (canManageApp ? ['users'] : [])
      : adminTabValues.filter((value) => value === 'users' ? canManageApp : canReviewData),
    [canManageApp, canReviewData, view],
  )
  const assignableModules = accessModules.filter(([module]) => module !== 'management' || canManageApp)
  const [tab, setTab] = usePersistentTab(`scpo-tab-admin-${user.id}`, canManageApp ? 'users' : 'reports', adminTabValues, adminTabLabels)
  const activeTab = availableTabs.includes(tab) ? tab : availableTabs[0] ?? 'reports'
  const [users, setUsers] = useState<Account[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>(canManageApp ? 'loading' : 'ready')
  const [notice, setNotice] = useState('')
  const [mutationError, setMutationError] = useState('')
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [selectedModules, setSelectedModules] = useState<string[]>([])
  const [physicianForm, setPhysicianForm] = useState({ name: '', crm: '', crm_state: '' })
  const [pendingPhysicianProfile, setPendingPhysicianProfile] = useState<{ userId: string; userName: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [resetPasswordTarget, setResetPasswordTarget] = useState<Account | null>(null)
  const [temporaryPassword, setTemporaryPassword] = useState('')
  const [resettingPassword, setResettingPassword] = useState(false)
  const [deleteUserTarget, setDeleteUserTarget] = useState<Account | null>(null)
  const [deletingUser, setDeletingUser] = useState(false)
  const [accountFilter, setAccountFilter] = useState<'all' | 'administrative' | 'operational'>('all')
  const [accountModuleFilter, setAccountModuleFilter] = useState('')
  const [accountStatusFilter, setAccountStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [accountCredentialFilter, setAccountCredentialFilter] = useState<'all' | 'password' | 'mfa'>('all')
  const [accountSearch, setAccountSearch] = useState('')
  const [groupAccountsByArea, setGroupAccountsByArea] = useState(false)

  useEffect(() => {
    if (!availableTabs.includes(tab)) setTab(availableTabs[0] ?? 'reports')
  }, [availableTabs, setTab, tab])

  async function loadUsers() {
    if (!canManageApp) return
    setStatus('loading')
    try {
      const userData = await readApiResponse<{ users: Account[] }>(await fetch('/api/v1/access/users'))
      setUsers(userData.users)
      setStatus('ready')
    } catch {
      setStatus('unavailable')
    }
  }

  useEffect(() => {
    if (!canManageApp) return
    let active = true
    const loadInitialUsers = async () => {
      try {
        const userData = await readApiResponse<{ users: Account[] }>(await fetch('/api/v1/access/users'))
        if (active) {
          setUsers(userData.users)
          setStatus('ready')
        }
      } catch {
        if (active) setStatus('unavailable')
      }
    }
    void loadInitialUsers()
    return () => { active = false }
  }, [canManageApp])

  function toggleModule(module: string) {
    const selected = selectedModules.includes(module)
    setSelectedModules((current) => selected ? current.filter((item) => item !== module) : [...current, module])
    if (module === 'physician' && !selected) {
      setPhysicianForm((current) => ({ ...current, name: current.name || name }))
    }
  }

  async function savePhysicianProfile(userId: string) {
    await readApiResponse(await fetch(`/api/v1/physicians/profiles/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...physicianForm, crm_state: physicianForm.crm_state.toUpperCase() }),
    }))
  }

  async function retryPhysicianProfile() {
    if (!pendingPhysicianProfile) return
    setSaving(true)
    setMutationError('')
    setNotice('')
    try {
      await savePhysicianProfile(pendingPhysicianProfile.userId)
      setNotice(`Perfil médico de ${pendingPhysicianProfile.userName} salvo.`)
      setPendingPhysicianProfile(null)
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Não foi possível salvar o perfil médico.')
    } finally {
      setSaving(false)
    }
  }

  async function createAccount(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setNotice('')
    setMutationError('')
    const permissions = Object.fromEntries(selectedModules.map((module) => [
      module,
      module === 'management' || module === 'admin'
        ? ['consultar', 'criar', 'alterar', 'administrar']
        : module === 'oversight'
          ? ['consultar']
          : ['consultar', 'criar', 'alterar'],
    ]))
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
      let physicianProfileMessage = ''
      if (selectedModules.includes('physician')) {
        try {
          await savePhysicianProfile(data.id)
          setPhysicianForm({ name: '', crm: '', crm_state: '' })
        } catch (error) {
          setPendingPhysicianProfile({ userId: data.id, userName: data.name })
          physicianProfileMessage = ` A conta foi criada, mas o perfil médico não foi salvo: ${error instanceof Error ? error.message : 'serviço indisponível'}. Complete o cadastro abaixo.`
        }
      }
      setNotice(`Conta ${data.username} criada. Senha temporária de uso único: ${data.initial_password}. Entregue-a diretamente ao usuário por canal seguro. No primeiro acesso, ele informa o usuário e essa senha, deixa o campo de código vazio, cria e confirma uma senha pessoal com 12 ou mais caracteres e, por fim, configura o autenticador pelo QR code.${physicianProfileMessage}`)
      await loadUsers()
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Falha ao criar a conta.')
    } finally {
      setSaving(false)
    }
  }

  async function updateAccount(user: Account, body: Record<string, unknown>, success: string) {
    setNotice('')
    setMutationError('')
    try {
      const response = await fetch(`/api/v1/access/users/${user.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await response.json() as Account & { detail?: string }
      if (!response.ok) throw new Error(data.detail ?? 'Não foi possível atualizar a conta.')
      setUsers((current) => current.map((item) => item.id === user.id ? data : item))
      setNotice(success)
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Falha ao atualizar a conta.')
    }
  }

  async function resetUserPassword(account: Account) {
    setNotice('')
    setMutationError('')
    setTemporaryPassword('')
    setResetPasswordTarget(account)
  }

  async function confirmPasswordReset() {
    if (!resetPasswordTarget) return
    setResettingPassword(true)
    try {
      const data = await readApiResponse<{ initial_password: string; user: Account }>(await fetch(`/api/v1/access/users/${encodeURIComponent(resetPasswordTarget.id)}/reset-password`, { method: 'POST' }))
      setUsers((current) => current.map((item) => item.id === data.user.id ? data.user : item))
      setTemporaryPassword(data.initial_password)
      setMutationError('')
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Não foi possível redefinir a senha.')
    } finally {
      setResettingPassword(false)
    }
  }

  async function deleteUser(account: Account) {
    setDeleteUserTarget(account)
    setMutationError('')
  }

  async function confirmUserDelete() {
    if (!deleteUserTarget) return
    setDeletingUser(true)
    setMutationError('')
    try {
      await readApiResponse(await fetch(`/api/v1/access/users/${encodeURIComponent(deleteUserTarget.id)}`, { method: 'DELETE' }))
      setUsers((current) => current.filter((account) => account.id !== deleteUserTarget.id))
      setNotice(`Conta de ${deleteUserTarget.name} excluída.`)
      setDeleteUserTarget(null)
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : 'Não foi possível excluir a conta.')
    } finally {
      setDeletingUser(false)
    }
  }

  const visibleAccounts = users.filter((account) => {
    if (accountFilter === 'administrative' && !['admin', 'management'].includes(account.role)) return false
    if (accountFilter === 'operational' && ['admin', 'management'].includes(account.role)) return false
    if (accountModuleFilter && !account.modules.includes(accountModuleFilter)) return false
    if (accountStatusFilter === 'active' && !account.active) return false
    if (accountStatusFilter === 'inactive' && account.active) return false
    if (accountCredentialFilter === 'password' && !account.must_change_password) return false
    if (accountCredentialFilter === 'mfa' && account.mfa_enabled) return false
    const search = accountSearch.trim().toLocaleLowerCase('pt-BR')
    return !search || `${account.name} ${account.username}`.toLocaleLowerCase('pt-BR').includes(search)
  })
  const accountGroups = groupAccountsByArea
    ? [...new Set(visibleAccounts.map((account) => account.role || ''))]
      .sort((left, right) => (moduleLabels[left] ?? 'Área não definida').localeCompare(moduleLabels[right] ?? 'Área não definida', 'pt-BR'))
      .map((role) => ({
        key: role || 'unassigned',
        label: moduleLabels[role] ?? 'Área não definida',
        accounts: visibleAccounts.filter((account) => account.role === role),
      }))
    : [{ key: 'all', label: '', accounts: visibleAccounts }]

  return <section className="admin-page page-enter">
    <div className="page-title-row"><span className="module-icon module-icon-admin"><ShieldCheck size={23} /></span><div><p className="eyebrow">ADMINISTRAÇÃO</p><h1>{adminTabLabels[activeTab]}</h1><p className="welcome-copy">{activeTab === 'users' ? 'Administre contas, permissões e cadastros profissionais do aplicativo.' : activeTab === 'reports' ? 'Consulte relatórios digitais dos módulos sem concentrá-los na gestão operacional.' : 'Consulte os eventos administrativos registrados pelo sistema.'}</p></div>{canManageApp && <span className={`entry-status ${status === 'ready' ? 'entry-status-saved' : 'entry-status-draft'}`}>{status === 'loading' ? <span className="spinner" /> : status === 'ready' ? <BadgeCheck size={15} /> : <LockKeyhole size={15} />}{status === 'loading' ? 'Carregando' : status === 'ready' ? 'Serviço conectado' : 'Serviço indisponível'}</span>}</div>
    <ModuleTabNavigation
      ariaLabel="Seções de Administração"
      value={activeTab}
      onChange={setTab}
      options={availableTabs.map((value) => ({ value, label: adminTabLabels[value] }))}
    />
    {activeTab === 'users' && canManageApp && <>
    <div className="admin-warning"><ShieldCheck size={19} /><div><strong>Acesso restrito à gestão de contas autorizada.</strong><span>Uma senha aleatória de uso único é gerada para cada conta. Entregue-a ao titular por um canal seguro.</span></div></div>
    {status === 'unavailable' && <ToastMessage variant="error">Não foi possível carregar usuários. Confirme se as APIs e o banco estão ativos.</ToastMessage>}
    {mutationError && <ToastMessage variant="error">{mutationError}</ToastMessage>}
    {notice && <ToastMessage variant="success">{notice}</ToastMessage>}
    {canCreateAccounts && <>
    <form className="account-create-panel" onSubmit={createAccount}>
      <div className="users-heading"><div><p className="eyebrow">NOVA CONTA</p><h2>Cadastrar usuário</h2></div></div>
      <div className="field-grid field-grid-two">
        <label className="field"><span className="field-label">Nome completo</span><input required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="field"><span className="field-label">Usuário de acesso</span><input required minLength={3} maxLength={80} pattern="[A-Za-z0-9._@-]+" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
      </div>
      <fieldset className="module-permission-fieldset">
        <legend>Módulos e escopos permitidos</legend>
        <p className="field-hint">Administração do aplicativo controla contas; Relatórios e auditoria concede somente consulta. São permissões independentes. Psiquiatras que precisam prescrever devem receber também o módulo Médico; a prescrição é feita no fluxo médico compartilhado com Farmácia e Enfermagem.</p>
        <div className="module-permission-grid">{assignableModules.map(([module, label]) => <label className="checkbox-label" key={module}><input type="checkbox" checked={selectedModules.includes(module)} onChange={() => toggleModule(module)} /><span>{label}</span></label>)}</div>
      </fieldset>
      {selectedModules.includes('physician') && <section className="physician-profile-inline">
        <div className="section-heading"><div><p className="eyebrow">PERFIL PROFISSIONAL</p><h3>Dados para prescrições médicas</h3></div><a className="button button-secondary" href="https://portal.cfm.org.br/busca-medicos/" target="_blank" rel="noreferrer">Consultar no portal oficial do CFM</a></div>
        <p className="field-hint">O portal oficial exige consulta interativa. Confira o registro no CFM e preencha os dados abaixo; não usamos fontes de terceiros nem autopreenchimento não oficial.</p>
        <div className="field-grid field-grid-three">
          <label className="field"><span className="field-label">Nome profissional</span><input required minLength={2} maxLength={120} value={physicianForm.name} onChange={(event) => setPhysicianForm((current) => ({ ...current, name: event.target.value }))} /></label>
          <label className="field"><span className="field-label">CRM</span><input required minLength={1} maxLength={24} value={physicianForm.crm} onChange={(event) => setPhysicianForm((current) => ({ ...current, crm: event.target.value.trim() }))} /></label>
          <label className="field"><span className="field-label">UF do CRM</span><input required pattern="[A-Za-z]{2}" maxLength={2} value={physicianForm.crm_state} onChange={(event) => setPhysicianForm((current) => ({ ...current, crm_state: event.target.value.toUpperCase() }))} /></label>
        </div>
      </section>}
      {selectedModules.includes('management') && <div className="admin-warning"><ShieldCheck size={19} /><div><strong>Privilégio amplo</strong><span>Gestão Hospitalar concede todos os módulos e ações operacionais, mas não permite administrar contas. Conceda somente após aprovação institucional.</span></div></div>}
      <div className="form-actions"><span className="draft-hint">As permissões selecionadas serão registradas na auditoria.</span><button className="button button-primary" type="submit" disabled={saving || selectedModules.length === 0}>{saving ? 'Criando…' : 'Criar usuário'}</button></div>
    </form>
    {pendingPhysicianProfile && <section className="account-create-panel physician-profile-inline">
      <div className="section-heading"><div><p className="eyebrow">FINALIZAÇÃO PENDENTE</p><h3>Perfil médico de {pendingPhysicianProfile.userName}</h3><p className="welcome-copy">A conta existe, mas o serviço médico não confirmou o perfil. Tente salvar novamente.</p></div></div>
      <div className="field-grid field-grid-three">
        <label className="field"><span className="field-label">Nome profissional</span><input required minLength={2} maxLength={120} value={physicianForm.name} onChange={(event) => setPhysicianForm((current) => ({ ...current, name: event.target.value }))} /></label>
        <label className="field"><span className="field-label">CRM</span><input required minLength={1} maxLength={24} value={physicianForm.crm} onChange={(event) => setPhysicianForm((current) => ({ ...current, crm: event.target.value.trim() }))} /></label>
        <label className="field"><span className="field-label">UF do CRM</span><input required pattern="[A-Za-z]{2}" maxLength={2} value={physicianForm.crm_state} onChange={(event) => setPhysicianForm((current) => ({ ...current, crm_state: event.target.value.toUpperCase() }))} /></label>
      </div>
      <button className="button button-primary" type="button" onClick={() => void retryPhysicianProfile()} disabled={saving}>{saving ? 'Salvando…' : 'Tentar salvar perfil médico'}</button>
    </section>}
    </>}
    <section className="users-panel">
      <div className="users-heading">
        <div><p className="eyebrow">CONTAS LOCAIS</p><h2>Usuários cadastrados</h2><p className="welcome-copy">Os filtros de nome, módulo, situação e pendências podem ser combinados; os módulos exibidos em cada conta são os acessos efetivos.</p></div>
        <span className="module-total">{visibleAccounts.length} de {users.length} contas</span>
      </div>
      <div className="account-filter-controls">
        <label className="field"><span className="field-label">Buscar por nome ou login</span><input type="search" value={accountSearch} onChange={(event) => setAccountSearch(event.target.value)} placeholder="Digite parte do nome ou usuário" /></label>
        <label className="field"><span className="field-label">Área / módulo acessível</span><select value={accountModuleFilter} onChange={(event) => setAccountModuleFilter(event.target.value)}><option value="">Todos os módulos</option>{assignableModules.map(([module, label]) => <option key={module} value={module}>{label}</option>)}</select></label>
        <label className="field"><span className="field-label">Situação da conta</span><select value={accountStatusFilter} onChange={(event) => setAccountStatusFilter(event.target.value as typeof accountStatusFilter)}><option value="all">Ativas e inativas</option><option value="active">Somente ativas</option><option value="inactive">Somente inativas</option></select></label>
        <label className="field"><span className="field-label">Pendência de acesso</span><select value={accountCredentialFilter} onChange={(event) => setAccountCredentialFilter(event.target.value as typeof accountCredentialFilter)}><option value="all">Qualquer situação</option><option value="password">Troca de senha pendente</option><option value="mfa">Configuração de MFA pendente</option></select></label>
        <label className="field"><span className="field-label">Organização</span><select value={groupAccountsByArea ? 'area' : 'list'} onChange={(event) => setGroupAccountsByArea(event.target.value === 'area')}><option value="list">Lista única</option><option value="area">Agrupar por área principal</option></select></label>
      </div>
      <div className="admin-tabs module-tabs account-filters" role="group" aria-label="Filtrar tipos de conta">
        <button className={`button ${accountFilter === 'all' ? 'button-primary' : 'button-secondary'}`} type="button" aria-pressed={accountFilter === 'all'} onClick={() => setAccountFilter('all')}>Todas as categorias</button>
        <button className={`button ${accountFilter === 'administrative' ? 'button-primary' : 'button-secondary'}`} type="button" aria-pressed={accountFilter === 'administrative'} onClick={() => setAccountFilter('administrative')}>Administração / Gestão</button>
        <button className={`button ${accountFilter === 'operational' ? 'button-primary' : 'button-secondary'}`} type="button" aria-pressed={accountFilter === 'operational'} onClick={() => setAccountFilter('operational')}>Operacionais</button>
        <button className="button button-secondary" type="button" onClick={() => { setAccountSearch(''); setAccountModuleFilter(''); setAccountStatusFilter('all'); setAccountCredentialFilter('all'); setAccountFilter('all'); setGroupAccountsByArea(false) }}>Limpar filtros</button>
      </div>
      {status === 'ready' && visibleAccounts.length === 0 && <p className="account-empty">Nenhuma conta corresponde à combinação de filtros selecionada.</p>}
      {accountGroups.map((group) => <section className="account-group" key={group.key}>
        {groupAccountsByArea && <div className="account-group-heading"><h3>{group.label}</h3><span>{group.accounts.length} usuário(s)</span></div>}
        <div className="account-list">{group.accounts.map((account) => <AccountRow key={account.id} user={account} onUpdate={updateAccount} onResetPassword={resetUserPassword} onDelete={deleteUser} currentUserId={user.id} availableModules={assignableModules} canManageBroadAccess={canManageApp} canDeleteAccounts={canDeleteAccounts} />)}</div>
      </section>)}
    </section>
    <section className="permission-map"><div className="panel-heading"><div><p className="eyebrow">CONTROLE DE ACESSO</p><h2>Matriz efetiva de permissões</h2></div><LockKeyhole size={18} /></div><div className="permission-legend"><span><strong>Módulo operacional</strong> consultar, criar e alterar por padrão</span><span><strong>Arquivamento</strong> opcional em Pacientes, Enfermagem, Nutrição e Recepção</span><span><strong>Gestão Hospitalar</strong> amplia ações operacionais em todos os módulos, mas não administra contas</span><span>Confirme a matriz institucional antes de atribuir acessos a dados reais.</span></div></section>
    </>}
    {activeTab === 'reports' && canReviewData && <AdminReportsCenter />}
    {activeTab === 'audit' && canReviewData && <AuditLogPanel />}
    {resetPasswordTarget && <div className="patient-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !resettingPassword) { setResetPasswordTarget(null); setTemporaryPassword('') } }}><section className="patient-archive-dialog credential-reset-dialog" role="dialog" aria-modal="true" aria-labelledby="credential-reset-title"><div className="credential-reset-heading"><img src="/scpo-connect-icon.png" alt="" /><div><p className="eyebrow">ADMINISTRAÇÃO · CREDENCIAIS</p><h2 id="credential-reset-title">{temporaryPassword ? 'Senha temporária gerada' : 'Redefinir senha?'}</h2></div></div>{temporaryPassword ? <><p>A senha da conta foi redefinida e as sessões encerradas. Entregue ao titular, por canal seguro, a senha temporária <strong>0000</strong>. Se a conta já usa MFA, ele deve informar o código atual do aplicativo autenticador; depois, deverá criar uma nova senha.</p><code className="credential-reset-value">{temporaryPassword}</code><div className="form-actions"><button className="button button-primary" type="button" onClick={() => { setResetPasswordTarget(null); setTemporaryPassword('') }}>Concluir</button></div></> : <><p>A senha de <strong>{resetPasswordTarget.name}</strong> será redefinida para 0000 e as sessões serão encerradas. O MFA atual, se configurado, será preservado. No próximo acesso, a pessoa deverá criar uma nova senha; se já usa MFA, também precisará do código atual do autenticador.</p>{mutationError && <ToastMessage variant="error">{mutationError}</ToastMessage>}<div className="form-actions"><button className="button button-secondary" type="button" disabled={resettingPassword} onClick={() => { setResetPasswordTarget(null); setTemporaryPassword('') }}>Cancelar</button><button className="button button-danger" type="button" disabled={resettingPassword} onClick={() => void confirmPasswordReset()}>{resettingPassword ? 'Redefinindo…' : 'Confirmar redefinição'}</button></div></>}</section></div>}
    {deleteUserTarget && <div className="patient-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !deletingUser) setDeleteUserTarget(null) }}><section className="patient-archive-dialog credential-reset-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-user-title"><div className="credential-reset-heading"><img src="/scpo-connect-icon.png" alt="" /><div><p className="eyebrow">ADMINISTRAÇÃO · CONTAS</p><h2 id="delete-user-title">Excluir usuário?</h2></div></div><p>A conta de <strong>{deleteUserTarget.name}</strong> e seu acesso serão removidos permanentemente. O histórico de auditoria permanece preservado. Essa ação não pode ser desfeita.</p>{mutationError && <ToastMessage variant="error">{mutationError}</ToastMessage>}<div className="form-actions"><button className="button button-secondary" type="button" disabled={deletingUser} onClick={() => setDeleteUserTarget(null)}>Cancelar</button><button className="button button-danger" type="button" disabled={deletingUser} onClick={() => void confirmUserDelete()}>{deletingUser ? 'Excluindo…' : 'Confirmar exclusão'}</button></div></section></div>}
  </section>
}

function AccountRow({ user, onUpdate, onResetPassword, onDelete, currentUserId, availableModules, canManageBroadAccess, canDeleteAccounts }: { user: Account; onUpdate: (user: Account, body: Record<string, unknown>, success: string) => Promise<void>; onResetPassword: (user: Account) => Promise<void>; onDelete: (user: Account) => Promise<void>; currentUserId: string; availableModules: [string, string][]; canManageBroadAccess: boolean; canDeleteAccounts: boolean }) {
  const [editModules, setEditModules] = useState(user.modules)
  const [editPermissions, setEditPermissions] = useState(user.permissions)
  const [expanded, setExpanded] = useState(false)
  const mayEditBroad = canManageBroadAccess || user.role !== 'management'
  const assignedModules = user.role === 'admin' ? ['admin'] : user.modules
  return <article className="account-row">
    <div className="account-row-main">
      <div className="user-name"><span className="avatar avatar-small">{user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span><strong>{user.name}<small>{user.username}{user.must_change_password ? ' · troca de senha pendente' : ''}{!user.mfa_enabled ? ' · MFA pendente' : ''}</small></strong></div>
      <div className="user-modules">{user.modules.map((module) => <span key={module}>{moduleLabels[module] ?? module}</span>)}</div>
      <span className={`account-state ${user.active ? 'account-active' : 'account-disabled'}`}><span className="status-dot" />{user.active ? 'Ativa' : 'Inativa'}</span>
      <div className="account-row-actions">
        {user.id !== currentUserId && <button className="user-action" type="button" onClick={() => void onResetPassword(user)}>Redefinir senha</button>}
        {mayEditBroad && <>
          <button className="user-action" type="button" onClick={() => void onUpdate(user, { active: !user.active }, `Conta ${user.active ? 'desativada' : 'ativada'}.`)}>{user.active ? 'Desativar' : 'Ativar'}</button>
          <button className="user-action" type="button" onClick={() => { setEditModules(assignedModules); setEditPermissions(user.role === 'admin' ? { admin: user.permissions.admin ?? ['consultar', 'criar', 'alterar', 'administrar'] } : user.permissions); setExpanded((value) => !value) }}>{expanded ? 'Fechar acessos' : 'Editar acessos'}</button>
          {canDeleteAccounts && user.id !== currentUserId && !user.is_superuser && <button className="user-action user-action-danger" type="button" onClick={() => void onDelete(user)}>Excluir usuário</button>}
        </>}
      </div>
    </div>
    {expanded && <div className="account-access-editor">
      <p className="field-label">Módulos permitidos</p>
      <div className="module-permission-grid">{availableModules.map(([module, label]) => <label className="checkbox-label" key={module}><input type="checkbox" checked={editModules.includes(module)} onChange={() => setEditModules((current) => current.includes(module) ? current.filter((item) => item !== module) : [...current, module])} /><span>{label}</span></label>)}</div>
      <fieldset className="module-permission-fieldset"><legend>Permitir arquivamento de registros clínicos</legend>{(['patients', 'nursing', 'nutrition', 'reception'] as const).map((module) => <label className="checkbox-label" key={module}><input type="checkbox" disabled={!editModules.includes(module)} checked={Boolean(editPermissions[module]?.includes('excluir'))} onChange={() => setEditPermissions((current) => ({ ...current, [module]: current[module]?.includes('excluir') ? current[module].filter((permission) => permission !== 'excluir') : [...(current[module] ?? ['consultar', 'criar', 'alterar']), 'excluir'] }))} /><span>{moduleLabels[module]}</span></label>)}</fieldset>
      <button className="button button-secondary" type="button" disabled={!editModules.length} onClick={() => void onUpdate(user, { modules: editModules, permissions: Object.fromEntries(editModules.map((module) => [module, editPermissions[module] ?? (module === 'admin' ? ['consultar', 'criar', 'alterar', 'administrar'] : module === 'oversight' ? ['consultar'] : ['consultar', 'criar', 'alterar'])])) }, 'Acessos atualizados e registrados na auditoria.')}>Salvar acessos</button>
    </div>}
  </article>
}

function NutritionPage() {
  const { prompt } = useAppDialogs()
  const [patients, setPatients] = useState<Patient[]>([])
  const [records, setRecords] = useState<NutritionRecordData[]>([])
  const [recordsTotal, setRecordsTotal] = useState(0)
  const [recordsOffset, setRecordsOffset] = useState(0)
  const [selectedPatient, setSelectedPatient] = useState('')
  const [selectedPatientRecord, setSelectedPatientRecord] = useState<NutritionRecordData | null>(null)
  const [recordPatientFilter, setRecordPatientFilter] = useState('')
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
  const patientName = (reference: string) => { const patient = patients.find((item) => item.reference === reference); return patient ? `${patient.name} · Quarto ${patient.room}, leito ${patient.bed}` : 'Paciente' }
  const nutritionPrintRows: PrintRow[] = records.map((record) => ({ id: String(record.id), date: record.assessment_date, title: patientName(record.patient_reference), fields: [['Peso', record.weight_kg ? `${record.weight_kg} kg` : ''], ['Altura', record.height_cm ? `${record.height_cm} cm` : ''], ['Dieta', record.diet_type], ['Alergias', record.allergies], ['Restrições', record.restrictions], ['Jejum', record.fasting_at ? `${dateTime(record.fasting_at)} · ${record.fasting_reason || ''}` : ''], ['Aceitação', record.appetite], ['Hidratação', record.hydration], ['Observações', record.notes], ['Profissional', record.actor_name]] }))
  return <section className="nutrition-page page-enter">
    <div className="page-title-row"><div><p className="eyebrow">MÓDULO · NUTRIÇÃO</p><h1>Acompanhamento nutricional</h1><p className="welcome-copy">Registre avaliação, dieta prescrita, alergias, restrições e aceitação alimentar.</p></div><span className="module-icon module-icon-nutrition"><UtensilsCrossed size={24} /></span></div>
    {message && <ToastMessage variant="success">{message}</ToastMessage>}{error && <ToastMessage variant="error">{error}</ToastMessage>}
    <PrintSelectionPanel title="Avaliações nutricionais" rows={nutritionPrintRows} />
    <form className="nutrition-form" onSubmit={(event) => void submit(event)}>
      <div className="section-heading"><div><p className="eyebrow">NOVA AVALIAÇÃO</p><h2>Dados nutricionais</h2></div></div>
      <PatientSelect className="nutrition-patient-select" label="Paciente" patients={patients} value={selectedPatient} onChange={(reference) => { const patient = patients.find((item) => item.reference === reference); setSelectedPatient(reference); setSelectedPatientRecord(null); setForm((current) => ({ ...current, allergies: patient?.allergies ?? '', allergies_status: patient?.allergies_status ?? 'unknown' })) }} required placeholder="Digite nome, quarto ou leito" optionLabel={(patient) => `${patient.name} · ${patient.room && patient.bed ? `Quarto ${patient.room}, leito ${patient.bed}` : 'sem acomodação'}`} />
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
        <PatientSelect label="Filtrar por paciente" patients={patients} value={recordPatientFilter} onChange={setRecordPatientFilter} emptyLabel="Todos os pacientes" optionLabel={patientLocationLabel} />
        <label className="field"><span className="field-label">Buscar paciente, dieta, alergias ou orientação</span><span className="search-input-wrap"><Search size={17} /><input type="search" value={recordQuery} onChange={(event) => setRecordQuery(event.target.value)} placeholder="Digite para pesquisar" /></span></label>
        <button className="button button-primary" type="submit" disabled={recordsLoading}><Search size={15} /> Pesquisar</button>
        <button className="button button-secondary" type="button" disabled={recordsLoading || (!recordPatientFilter && !recordQuery)} onClick={() => { setRecordPatientFilter(''); setRecordQuery(''); void loadRecords('', '', 0) }}>Limpar filtros</button>
      </form>
      {recordsLoading ? <div className="history-empty">Carregando histórico…</div> : records.length ? <>
        <div className="nutrition-record-list">{records.map((record) => <article className="nutrition-record-card" key={record.id}><div><h3>{patientName(record.patient_reference)}</h3><p>{new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${record.assessment_date}T00:00:00Z`))} · {record.diet_type || 'Dieta não informada'}</p>{record.weight_kg && <small>Peso: {record.weight_kg} kg</small>}{record.allergies && <small>Alergias: {record.allergies}</small>}{record.restrictions && <small>Restrições: {record.restrictions}</small>}{record.fasting_at && <small className="fasting-alert">Jejum programado: {dateTime(record.fasting_at)} · {record.fasting_reason || 'sem observação'}</small>}{record.notes && <small>{record.notes}</small>}</div><div className="nutrition-record-actions"><span className="nutrition-author">{record.actor_name}</span><button className="button button-danger" type="button" onClick={async () => { const reason = await prompt('Motivo para corrigir/remover esta avaliação (o registro será preservado na auditoria):', 'Arquivar avaliação', 'Motivo'); if (!reason?.trim()) return; try { const response = await fetch(`/api/v1/nursing/nutrition/${record.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: reason.trim() }) }); await readApiResponse(response); await loadRecords(recordPatientFilter, recordQuery, recordsOffset) } catch (archiveError) { setError(archiveError instanceof Error ? archiveError.message : 'Não foi possível arquivar a avaliação.') } }}>Arquivar</button></div></article>)}</div>
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
    {errors.map((message) => <ToastMessage variant="error" key={message}>{message}</ToastMessage>)}
    {loading && !summary ? <div className="history-empty">Carregando indicadores…</div> : <>
      <div className="hygiene-summary executive-kpis">
        <article className="status-tone-neutral"><strong>{summary?.occupied_beds ?? '—'}</strong><span>Pacientes com localização registrada</span></article>
        <article className="status-tone-neutral"><strong>{summary?.physical_beds ?? '—'}</strong><span>Leitos físicos cadastrados</span></article>
        <article className="status-tone-progress"><strong>{summary?.occupancy_percent === null || summary?.occupancy_percent === undefined ? '—' : `${summary.occupancy_percent}%`}</strong><span>Ocupação física validada</span></article>
        <article className="status-tone-neutral"><strong>{summary?.active_patients ?? '—'}</strong><span>Pacientes ativos</span></article>
        <article className="status-tone-progress"><strong>{summary?.open_emergency_arrivals ?? '—'}</strong><span>Chegadas em atendimento</span></article>
        <article className="status-tone-neutral"><strong>{summary?.emergency_arrivals_today ?? '—'}</strong><span>Chegadas hoje</span></article>
        <article className="status-tone-progress"><strong>{summary?.vital_records_today ?? '—'}</strong><span>Coletas de enfermagem hoje</span></article>
        <article className="status-tone-neutral"><strong>{summary?.appointments_today ?? '—'}</strong><span>Agendamentos hoje</span></article>
        <article className={summary && summary.beds_in_cleaning + summary.beds_in_maintenance > 0 ? 'status-tone-warning' : 'status-tone-success'}><strong>{summary ? summary.beds_in_cleaning + summary.beds_in_maintenance : '—'}</strong><span>Leitos em higienização/manutenção</span></article>
        <article className={summary?.open_safety_incidents ? 'status-tone-critical' : 'status-tone-success'}><strong>{summary?.open_safety_incidents ?? '—'}</strong><span>Incidentes de segurança abertos</span></article>
        <article className={summary?.documents_pending_review ? 'status-tone-warning' : 'status-tone-success'}><strong>{summary?.documents_pending_review ?? '—'}</strong><span>Documentos aguardando revisão</span></article>
        <article className={!stockAvailable ? 'status-tone-neutral' : criticalStock ? 'status-tone-critical' : 'status-tone-success'}><strong>{stockAvailable ? criticalStock : '—'}</strong><span>Itens abaixo do mínimo</span></article>
      </div>
      <div className="executive-risk-strip" role="status"><AlertTriangle size={18} /><span><strong>Alertas assistenciais:</strong> {summary?.patients_with_known_allergies ?? '—'} paciente(s) com alergia conhecida, {summary?.patients_without_allergy_confirmation ?? '—'} sem confirmação e {summary?.active_contraindications ?? '—'} contraindicação(ões) ativa(s).</span></div>
      <div className="executive-summary-grid">
        <article className="status-tone-progress"><strong>Fluxo de leitos hoje</strong><span>{summary?.patient_admissions_today ?? '—'} admissões · {summary?.patient_transfers_today ?? '—'} transferências · {summary?.patient_discharges_today ?? '—'} altas</span></article>
        <article className="status-tone-neutral"><strong>Agenda de hoje</strong><span>{summary?.appointments_pending_today ?? '—'} pendentes · {summary?.appointments_no_show_today ?? '—'} não compareceram</span></article>
        <article className={summary?.open_safety_incidents ? 'status-tone-critical' : 'status-tone-success'}><strong>Segurança do paciente</strong><span>{summary?.open_safety_incidents ?? '—'} incidentes abertos · {summary?.serious_open_safety_incidents ?? '—'} graves/críticos</span></article>
        <article className={summary?.documents_pending_review || summary?.approved_documents_expired ? 'status-tone-warning' : 'status-tone-success'}><strong>Documentos institucionais</strong><span>{summary?.documents_pending_review ?? '—'} aguardando revisão · {summary?.approved_documents_expired ?? '—'} vencidos · {summary?.approved_documents_expiring_soon ?? '—'} vencem em até 30 dias</span></article>
        <article className={!stockAvailable ? 'status-tone-neutral' : expiredStock ? 'status-tone-critical' : expiringStock ? 'status-tone-warning' : 'status-tone-success'}><strong>Validade de estoque</strong><span>{stockAvailable ? `${expiredStock} lote(s) vencido(s) · ${expiringStock} vencendo em até 30 dias` : 'Indicador indisponível'}</span></article>
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
    {error && <ToastMessage variant="error">{error}</ToastMessage>}
    {notice && <ToastMessage variant="success">{notice}</ToastMessage>}
    {capacity && <div className="hygiene-summary executive-kpis"><article className="status-tone-neutral"><strong>{capacity.total_beds}</strong><span>Leitos cadastrados</span></article><article className="status-tone-neutral"><strong>{capacity.occupied_beds}</strong><span>Ocupados no mapa físico</span></article><article className="status-tone-success"><strong>{capacity.available_beds}</strong><span>Liberados</span></article><article className="status-tone-neutral"><strong>{capacity.occupancy_percent === null ? '—' : `${capacity.occupancy_percent}%`}</strong><span>Ocupação física</span></article></div>}
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
      <div className="field-grid field-grid-two"><PatientSelect label="Paciente com localização pendente" patients={unreconciledPatients} value={patientReference} onChange={(reference) => { setPatientReference(reference); setReconciliationBedId('') }} required emptyLabel="Selecione" optionLabel={(patient) => `${patient.name} · Quarto ${patient.room} · Leito ${patient.bed}`} /><label className="field"><span className="field-label">Correspondência física exata</span><select required value={reconciliationBedId} onChange={(event) => setReconciliationBedId(event.target.value)} disabled={!patientReference}><option value="">Selecione</option>{reconcileCandidates.map((bed) => <option key={bed.id} value={bed.id}>{bed.unit_name} · Quarto {bed.room} · Leito {bed.label}</option>)}</select></label></div>
      <button className="button button-primary" type="submit" disabled={saving || !patientReference || !reconciliationBedId}>{saving ? 'Vinculando…' : 'Confirmar reconciliação'}</button>
    </form>}
    <section><div className="section-heading"><div><p className="eyebrow">MAPA ATUAL</p><h3>Leitos cadastrados</h3></div><span className="module-total">{beds.length}</span></div>
      {loading ? <div className="history-empty">Carregando capacidade física…</div> : beds.length ? <div className="collection-list">{beds.map((bed) => <article className="collection-row" key={bed.id}><div className="collection-row-heading"><strong>{bed.unit_name} · Quarto {bed.room} · Leito {bed.label}</strong><span className={`work-order-status status-tone-${hospitalBedTone(bed)}`}>{bed.occupied ? 'Ocupado' : bed.status === 'available' ? 'Disponível' : bed.status === 'cleaning' ? 'Em higienização' : bed.status === 'maintenance' ? 'Manutenção' : 'Bloqueado'}</span></div><small>{bed.isolation_capable ? 'Preparado para isolamento' : 'Sem característica de isolamento'}{bed.patient_reference ? ` · Paciente vinculado: ${bed.patient_reference}` : ''}</small><label className="field"><span className="field-label">Situação operacional</span><select value={bed.occupied ? 'available' : bed.status} disabled={saving || bed.occupied} onChange={(event) => void updateStatus(bed, event.target.value as HospitalBed['status'])}><option value="available">Disponível</option><option value="cleaning">Em higienização</option><option value="maintenance">Manutenção</option><option value="blocked">Bloqueado</option></select></label></article>)}</div> : <div className="history-empty">Nenhum leito foi cadastrado.</div>}
    </section>
  </section>
}

type AdminReportRecord = Record<string, unknown>

const adminReportSources = [
  { id: 'patients', label: 'Cadastro de pacientes', endpoint: '/api/v1/nursing/patients?include_inactive=true', collection: 'patients' },
  { id: 'vitals', label: 'Enfermagem · sinais vitais', endpoint: '/api/v1/nursing/vitals', collection: 'records' },
  { id: 'prescriptions', label: 'Médico · prescrições', endpoint: '/api/v1/physicians/prescriptions', collection: 'prescriptions' },
  { id: 'medications', label: 'Farmácia · dispensações', endpoint: '/api/v1/pharmacy/dispensations', collection: 'dispensations' },
  { id: 'medication-actions', label: 'Enfermagem · administrações de medicamentos', endpoint: '/api/v1/nursing/medication-administrations', collection: 'administrations' },
  { id: 'hourly-rounds', label: 'Enfermagem · verificações horárias', endpoint: '/api/v1/nursing/hourly-rounds', collection: 'rounds' },
  { id: 'patient-status', label: 'Administração · acompanhamento de pacientes', endpoint: '/api/v1/management/patient-status', collection: 'statuses' },
  { id: 'stock', label: 'Farmácia · alertas de estoque', endpoint: '/api/v1/pharmacy/stock-alerts', collection: 'alerts' },
  { id: 'arrivals', label: 'Recepção · chegadas', endpoint: '/api/v1/reception/arrivals', collection: 'arrivals' },
  { id: 'triages', label: 'Enfermagem · triagens', endpoint: '/api/v1/management/reports/triages', collection: 'triages' },
  { id: 'outpatient', label: 'Ambulatório · consultas e atendimentos', endpoint: '/api/v1/reception/encounters', collection: 'encounters' },
  { id: 'nutrition', label: 'Nutrição · avaliações', endpoint: '/api/v1/nursing/nutrition', collection: 'records' },
  { id: 'therapy', label: 'Oficina Terapêutica · atividades', endpoint: '/api/v1/therapy/activities', collection: 'activities' },
  { id: 'social', label: 'Serviço Social · encaminhamentos', endpoint: '/api/v1/social/referrals', collection: 'referrals' },
  { id: 'psychology', label: 'Psicologia · encaminhamentos', endpoint: '/api/v1/psychology/referrals', collection: 'referrals' },
  { id: 'exams', label: 'Central de Exames · solicitações', endpoint: '/api/v1/xray/requests', collection: 'requests' },
  { id: 'maintenance', label: 'Manutenção · ordens de serviço', endpoint: '/api/v1/maintenance/queue', collection: 'orders' },
  { id: 'hygiene', label: 'Higienização · solicitações', endpoint: '/api/v1/hygiene/requests', collection: 'requests' },
] as const

const adminReportPageSizes: Partial<Record<(typeof adminReportSources)[number]['id'], number>> = {
  patients: 200,
  vitals: 100,
  prescriptions: 500,
  medications: 500,
  'medication-actions': 500,
  'hourly-rounds': 100,
  nutrition: 100,
  therapy: 200,
  arrivals: 100,
  triages: 100,
  outpatient: 100,
  hygiene: 500,
}

const reportStatusLabels: Record<string, string> = {
  open: 'Aberta',
  scheduled: 'Agendada',
  confirmed: 'Confirmada',
  arrived: 'Chegou',
  called: 'Chamado',
  waiting: 'Aguardando',
  in_service: 'Em atendimento',
  in_progress: 'Em andamento',
  completed: 'Concluído',
  cancelled: 'Cancelado',
  canceled: 'Cancelado',
  no_show: 'Não compareceu',
  admitted: 'Internado',
  pending: 'Pendente',
  checked: 'Conferido',
  exception: 'Exceção',
  away: 'Ausente ou em atendimento externo',
  location: 'Em outro local da instituição',
  not_found: 'Não localizado',
  other: 'Outro',
  fulfilled: 'Atendida',
  dispensed: 'Dispensado',
  requested: 'Solicitada',
  quoted: 'Cotada',
  approved: 'Aprovada',
  ordered: 'Pedido realizado',
  received: 'Recebida',
  rejected: 'Rejeitada',
  attended: 'Presente',
  absent: 'Ausente',
  routine: 'Rotina habitual',
  priority: 'Prioritária',
  urgent: 'Urgente',
  green: 'Verde · rotina habitual',
  yellow: 'Amarelo · atenção ampliada',
  red: 'Vermelho · prioritário',
}

function reportRecordText(record: AdminReportRecord, keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value
    if (typeof value === 'number') return String(value)
    if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  }
  return ''
}

function reportPatientName(record: AdminReportRecord): string {
  const directName = reportRecordText(record, ['patient_name', 'name'])
  if (directName) return directName
  const snapshot = record.patient_snapshot
  return typeof snapshot === 'object' && snapshot !== null && !Array.isArray(snapshot)
    ? reportRecordText(snapshot as AdminReportRecord, ['name'])
    : ''
}

function reportClinicalDetails(record: AdminReportRecord, sourceId: string): string {
  if (sourceId === 'triages') {
    const allergiesStatus = reportRecordText(record, ['allergies_status'])
    const allergyLabel = allergiesStatus === 'known' ? 'Alergia conhecida'
      : allergiesStatus === 'none_known' ? 'Sem alergia conhecida'
        : allergiesStatus === 'unknown' ? 'Alergias não verificadas' : ''
    const vitalValues = record.vital_values
    const vitalLabels: Record<string, string> = {
      pressure: 'Pressão arterial',
      heartRate: 'Frequência cardíaca',
      respiratoryRate: 'Frequência respiratória',
      saturation: 'Saturação',
      temperature: 'Temperatura',
      glucose: 'Glicemia',
    }
    const vitals = typeof vitalValues === 'object' && vitalValues !== null && !Array.isArray(vitalValues)
      ? Object.entries(vitalValues).filter(([, value]) => typeof value === 'string' && value.trim()).map(([key, value]) => `${vitalLabels[key] ?? key}: ${value}`).join(', ')
      : ''
    return [
      reportRecordText(record, ['arrival_reason']) && `Motivo: ${reportRecordText(record, ['arrival_reason'])}`,
      allergyLabel,
      reportRecordText(record, ['allergies']) && `Alergias: ${reportRecordText(record, ['allergies'])}`,
      reportRecordText(record, ['conditions_treatments']) && `Condições/tratamentos: ${reportRecordText(record, ['conditions_treatments'])}`,
      vitals && `Sinais vitais: ${vitals}`,
      reportRecordText(record, ['measured_at']) && `Aferidos em: ${dateTime(reportRecordText(record, ['measured_at']))}`,
      reportRecordText(record, ['registered_by']) && `Registrado por: ${reportRecordText(record, ['registered_by'])}`,
    ].filter(Boolean).join(' · ')
  }
  if (sourceId === 'outpatient') {
    const encounterTypes: Record<string, string> = {
      outpatient: 'Ambulatorial',
      urgent_emergency: 'Urgência / emergência',
      first_consultation: 'Primeira consulta',
      return: 'Retorno',
      emergency_referral: 'Urgência / emergência / referência',
      reference_consultation: 'Consulta de referência',
    }
    const referralTypes: Record<string, string> = {
      discharge: 'Alta',
      return_same_unit: 'Retorno na mesma unidade',
      exams: 'Exames',
      specialty: 'Ambulatório especializado',
      hospital: 'Hospital',
      emergency: 'Pronto-socorro',
    }
    const programs = Array.isArray(record.programs)
      ? record.programs.map(String).join(', ')
      : ''
    const activityRows = Array.isArray(record.activity_rows)
      ? record.activity_rows.map((entry) => {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return ''
        const activity = reportRecordText(entry as AdminReportRecord, ['professional_activity'])
        const procedure = reportRecordText(entry as AdminReportRecord, ['procedure'])
        return [activity, procedure].filter(Boolean).join(' · ')
      }).filter(Boolean).join(' | ')
      : ''
    const encounterType = reportRecordText(record, ['encounter_type'])
    const referral = reportRecordText(record, ['referral'])
    return [
      encounterType && `Tipo: ${encounterTypes[encounterType] ?? encounterType}`,
      reportRecordText(record, ['physician_name']) && `Profissional: ${reportRecordText(record, ['physician_name'])}`,
      reportRecordText(record, ['examination']) && `Exame/conduta: ${reportRecordText(record, ['examination'])}`,
      activityRows && `Atividades/procedimentos: ${activityRows}`,
      reportRecordText(record, ['group_name']) && `Grupo: ${reportRecordText(record, ['group_name'])}`,
      programs && `Programas: ${programs}`,
      reportRecordText(record, ['diagnostic_hypothesis']) && `Hipótese: ${reportRecordText(record, ['diagnostic_hypothesis'])}`,
      reportRecordText(record, ['antibiotic_prescription']) && `Prescrição: ${reportRecordText(record, ['antibiotic_prescription'])}`,
      referral && `Encaminhamento: ${referralTypes[referral] ?? referral}`,
      reportRecordText(record, ['created_by']) && `Registrado por: ${reportRecordText(record, ['created_by'])}`,
    ].filter(Boolean).join(' · ')
  }
  return ''
}

function reportStatusText(record: AdminReportRecord): string {
  const status = reportRecordText(record, ['status', 'attendance', 'priority'])
  return reportStatusLabels[status] ?? status
}

function reportRowDate(record: AdminReportRecord): string {
  return reportRecordText(record, ['created_at', 'updated_at', 'recorded_at', 'measured_at', 'administered_at', 'starts_at', 'started_at', 'completed_at', 'occurred_at', 'requested_at', 'date'])
}

function AdminPatientStatusRow({ record, onSaved }: { record: AdminReportRecord; onSaved: () => void }) {
  const reference = reportRecordText(record, ['patient_reference'])
  const [attention, setAttention] = useState(reportRecordText(record, ['attention_level']))
  const [treatment, setTreatment] = useState(reportRecordText(record, ['treatment_status']))
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function saveStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await readApiResponse(await fetch(`/api/v1/management/patients/${encodeURIComponent(reference)}/observations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attention_level: attention, treatment_status: treatment, observation: note }),
      }))
      setNotice('Nova atualização registrada no histórico.')
      setNote('')
      onSaved()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível atualizar o acompanhamento.')
    } finally {
      setSaving(false)
    }
  }

  const attentionLabel = attention === 'green' ? 'Verde · rotina habitual' : attention === 'yellow' ? 'Amarelo · atenção ampliada' : attention === 'red' ? 'Vermelho · prioritário' : 'Sem classificação'
  const treatmentLabel = treatment === 'in_progress' ? 'Em andamento' : treatment === 'completed' ? 'Concluído' : treatment === 'discharged' ? 'Alta' : 'Sem classificação'
  return <article className={`admin-patient-status-row ${attention ? `attention-${attention}` : ''}`} key={reference}>
    <div className="admin-patient-status-heading"><div><strong>{reportRecordText(record, ['patient_name'])}</strong><span>{reportRecordText(record, ['room']) && reportRecordText(record, ['bed']) ? `Quarto ${reportRecordText(record, ['room'])} · Leito ${reportRecordText(record, ['bed'])} · ` : ''}{reportRecordText(record, ['active']) === 'Sim' ? 'Internado' : 'Alta registrada'}</span></div><div className="admin-patient-status-badges"><span>{attentionLabel}</span><span>{treatmentLabel}</span></div></div>
    {reportRecordText(record, ['observation']) && <p>{reportRecordText(record, ['observation'])}</p>}
    {reportRowDate(record) && <small>Última atualização: {dateTime(reportRowDate(record))} · {reportRecordText(record, ['actor_name'])}</small>}
    <form className="admin-patient-status-form" onSubmit={(event) => void saveStatus(event)}>
      <label className="field"><span className="field-label">Nível de acompanhamento</span><select required value={attention} onChange={(event) => setAttention(event.target.value)}><option value="">Sem alteração</option><option value="green">Verde · rotina habitual</option><option value="yellow">Amarelo · atenção ampliada</option><option value="red">Vermelho · prioritário</option></select></label>
      <label className="field"><span className="field-label">Situação do tratamento</span><select required value={treatment} onChange={(event) => setTreatment(event.target.value)}><option value="">Sem alteração</option><option value="in_progress">Em andamento</option><option value="completed">Concluído</option><option value="discharged">Alta</option></select></label>
      <label className="field"><span className="field-label">Justificativa da atualização</span><input required minLength={5} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <button className="button button-primary" type="submit" disabled={saving || !attention || !treatment || note.trim().length < 5}>{saving ? 'Salvando…' : 'Registrar atualização'}</button>
    </form>
    <small className="field-hint">A atualização cria novo registro auditável; não apaga nem altera observações anteriores.</small>
    {error && <ToastMessage variant="error">{error}</ToastMessage>}{notice && <ToastMessage variant="success">{notice}</ToastMessage>}
  </article>
}

function AdminReportsCenter({ scope = 'admin' }: { scope?: 'admin' | 'management' }) {
  const reportPageSize = 50
  const [sourceId, setSourceId] = useState<string>('')
  const [reportPage, setReportPage] = useState(0)
  const [rows, setRows] = useState<AdminReportRecord[]>([])
  const [reportTotal, setReportTotal] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const invalidPeriod = Boolean(fromDate && toDate && fromDate > toDate)
  const managementReportSourceIds = ['arrivals', 'hourly-rounds', 'patient-status', 'triages', 'outpatient']
  const visibleSources = scope === 'management'
    ? adminReportSources.filter((item) => managementReportSourceIds.includes(item.id))
    : adminReportSources
  const orderedSources = [...visibleSources].sort((left, right) =>
    left.label.localeCompare(right.label, 'pt-BR', { sensitivity: 'base' }),
  )
  const source = orderedSources.find((item) => item.id === sourceId) ?? orderedSources[0]
  useBreadcrumb('admin-report-source', visibleSources.find((item) => item.id === sourceId)?.label ?? null, 2)

  const loadReport = useCallback(async () => {
    const reportSource = adminReportSources.find((item) => item.id === sourceId)
    if (!reportSource) {
      setRows([])
      setReportTotal(null)
      setLoading(false)
      setError('')
      return
    }
    if (reportSource.id === 'therapy') {
      setRows([])
      setReportTotal(null)
      setLoading(false)
      setError('')
      return
    }
    setLoading(true)
    setError('')
    try {
      const pageSize = adminReportPageSizes[reportSource.id]
      const loadedRows: AdminReportRecord[] = []
      let offset = 0
      let total: number | null = null
      let shouldLoad = true
      while (shouldLoad) {
        const url = new URL(reportSource.endpoint, window.location.origin)
        if (pageSize) {
          url.searchParams.set('limit', String(pageSize))
          url.searchParams.set('offset', String(offset))
        }
        const data = await readApiResponse<Record<string, unknown>>(await fetch(`${url.pathname}${url.search}`))
        const collection = data[reportSource.collection]
        if (!Array.isArray(collection) || !collection.every((item) => typeof item === 'object' && item !== null && !Array.isArray(item))) {
          throw new Error(`A resposta do relatório “${reportSource.label}” está em formato inesperado.`)
        }
        loadedRows.push(...collection as AdminReportRecord[])
        if (typeof data.total === 'number') total = data.total
        shouldLoad = Boolean(pageSize && total !== null && loadedRows.length < total && collection.length > 0)
        if (shouldLoad) offset += collection.length
      }
      setRows(loadedRows)
      setReportTotal(total)
      if (total !== null && loadedRows.length < total) {
        throw new Error(`A consulta retornou ${loadedRows.length} de ${total} registros. Atualize o relatório antes de usá-lo.`)
      }
    } catch (loadError) {
      setRows([])
      setReportTotal(null)
      setError(loadError instanceof Error ? loadError.message : `Não foi possível carregar ${reportSource.label}.`)
    } finally {
      setLoading(false)
    }
  }, [sourceId])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadReport(), 0)
    return () => window.clearTimeout(timer)
  }, [loadReport])

  const filteredRows = rows.filter((row) => {
    if (invalidPeriod) return false
    const rowDate = reportRowDate(row)
    const matchesPeriod = !rowDate || (
      (!fromDate || new Date(rowDate).getTime() >= new Date(fromDate).getTime())
      && (!toDate || new Date(rowDate).getTime() <= new Date(toDate).getTime())
    )
    return matchesPeriod && (!searchQuery.trim() || JSON.stringify(row).toLocaleLowerCase('pt-BR').includes(searchQuery.trim().toLocaleLowerCase('pt-BR')))
  })
  const reportPageCount = Math.max(1, Math.ceil(filteredRows.length / reportPageSize))
  const currentReportPage = Math.min(reportPage, reportPageCount - 1)
  const visibleRows = filteredRows.slice(currentReportPage * reportPageSize, (currentReportPage + 1) * reportPageSize)
  const recordsWithDate = rows.filter((row) => reportRowDate(row)).length
  const printData: PrintRow[] = filteredRows.map((record, index) => {
    const patient = reportPatientName(record)
    const title = reportRecordText(record, ['title', 'item_name', 'medication_name', 'patient_name', 'name', 'request_type'])
      || patient
      || `${source.label} · ${index + 1}`
    const fields: [string, string][] = [
      ['Situação', reportStatusText(record) || 'Não informada'],
      ['Paciente', patient],
      ['Quarto / leito', [reportRecordText(record, ['room']), reportRecordText(record, ['bed'])].filter(Boolean).join(' / ')],
      ['Área / modalidade', reportRecordText(record, ['department', 'activity_type', 'modality', 'service_type', 'category', 'encounter_type'])],
      ['Responsável', reportRecordText(record, ['actor_name', 'created_by_name', 'prescriber_name', 'requester_name', 'registered_by', 'physician_name'])],
      ['Resumo', reportClinicalDetails(record, sourceId) || reportRecordText(record, ['description', 'purpose', 'notes', 'activity_report', 'instructions', 'conditions_treatments', 'diagnostic_hypothesis'])],
    ]
    if (sourceId === 'hourly-rounds') {
      fields.push(
        ['Verificações registradas', `${reportRecordText(record, ['checked_count'])} de ${reportRecordText(record, ['patient_count'])}`],
        ['Exceções anotadas', reportRecordText(record, ['exception_count'])],
      )
    }
    return {
      id: reportRecordText(record, ['id', 'reference']) || `${sourceId}-${index}`,
      date: reportRowDate(record),
      title,
      fields,
    }
  })

  function printReport() {
    if (!printRows(`Relatório · ${source.label}`, printData)) {
      setError('Permita a janela de impressão para este site e tente novamente.')
      return
    }
    setError('')
  }

  if (sourceId === 'therapy') return <TherapyReportsCenter />

  return <section className="admin-reports-center">
    <div className="patient-list-panel">
      <div className="section-heading"><div><p className="eyebrow">RELATÓRIOS DIGITAIS POR ÁREA</p><h2>Consultar relatórios</h2><p className="welcome-copy">Selecione uma área para consultar e, se necessário, imprimir os registros disponíveis no módulo.</p></div><button className="button button-secondary" type="button" onClick={() => void loadReport()} disabled={loading}>{loading ? 'Atualizando…' : 'Atualizar relatório'}</button></div>
      <div className="admin-report-controls">
        <label className="field"><span className="field-label">Área / relatório</span><select value={sourceId} onChange={(event) => { setRows([]); setReportTotal(null); setError(''); setReportPage(0); setSourceId(event.target.value) }}><option value="">Selecione uma área para consultar</option>{orderedSources.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label className="field"><span className="field-label">Pesquisar nos resultados</span><span className="search-input-wrap"><Search size={17} /><input type="search" value={searchQuery} onChange={(event) => { setReportPage(0); setSearchQuery(event.target.value) }} placeholder="Paciente, responsável, situação…" /></span></label>
        <label className="field"><span className="field-label">De (data e hora)</span><input type="datetime-local" value={fromDate} max={toDate || undefined} onChange={(event) => { setReportPage(0); setFromDate(event.target.value) }} /></label>
        <label className="field"><span className="field-label">Até (data e hora)</span><input type="datetime-local" value={toDate} min={fromDate || undefined} onChange={(event) => { setReportPage(0); setToDate(event.target.value) }} /></label>
        <div className="admin-report-actions">
          <span className="module-total">{filteredRows.length} registros</span>
          <button className="button button-secondary" type="button" onClick={printReport} disabled={loading || !filteredRows.length}><Printer size={16} /> Imprimir resultados</button>
          <button className="button button-secondary" type="button" onClick={() => { setSearchQuery(''); setFromDate(''); setToDate(''); setReportPage(0) }} disabled={!searchQuery && !fromDate && !toDate}>Limpar filtros</button>
        </div>
      </div>
      {error && <ToastMessage variant="error">{error}</ToastMessage>}
      {invalidPeriod && <ToastMessage variant="error">A data e hora inicial devem ser anteriores ou iguais à data e hora final.</ToastMessage>}
      <p className="field-hint">A consulta percorre as páginas disponíveis do módulo. {reportTotal !== null ? `Total confirmado pela API: ${reportTotal} registro(s). ` : ''}{recordsWithDate < rows.length ? 'Registros sem data são mantidos no resultado.' : ''}</p>
      {sourceId === 'patient-status' && <p className="field-hint">Os status são registros de acompanhamento identificados por cor. Alterar aqui acrescenta uma anotação ao histórico; nenhum registro anterior é sobrescrito.</p>}
      {!sourceId ? <div className="history-empty">Selecione uma área para exibir os dados do relatório.</div> : invalidPeriod ? null : loading ? <div className="history-empty" role="status">Carregando {source.label}…</div> : filteredRows.length ? <><div className="admin-report-list">{visibleRows.map((record, index) => {
        if (sourceId === 'patient-status') {
          return <AdminPatientStatusRow key={reportRecordText(record, ['patient_reference'])} record={record} onSaved={() => void loadReport()} />
        }
        const title = reportRecordText(record, ['title', 'item_name', 'medication_name', 'patient_name', 'name', 'request_type']) || reportPatientName(record) || `${source.label} · ${index + 1}`
        const status = reportStatusText(record)
        const detail = [
          sourceId === 'triages' || sourceId === 'outpatient'
            ? reportClinicalDetails(record, sourceId)
            : reportRecordText(record, ['description', 'purpose', 'department', 'activity_type', 'modality', 'service_type', 'dose']),
          sourceId === 'hourly-rounds' ? `${reportRecordText(record, ['checked_count'])}/${reportRecordText(record, ['patient_count'])} verificações · ${reportRecordText(record, ['exception_count'])} exceções` : '',
        ].filter(Boolean).join(' · ')
        const roundPatients = sourceId === 'hourly-rounds' && Array.isArray(record.patients)
          ? record.patients.filter((patient): patient is AdminReportRecord => typeof patient === 'object' && patient !== null && !Array.isArray(patient))
          : []
        return <article className="admin-report-row" key={reportRecordText(record, ['id', 'reference']) || `${sourceId}-${index}`}><div><strong>{title}</strong><span>{reportRowDate(record) ? dateTime(reportRowDate(record)) : 'Data não informada'}{detail ? ` · ${detail}` : ''}</span>{sourceId === 'hourly-rounds' && <details className="hourly-round-details"><summary>Ver detalhes por paciente ({roundPatients.length})</summary><div>{roundPatients.map((patient) => {
          const patientStatus = reportRecordText(patient, ['status'])
          const exceptionType = reportRecordText(patient, ['exception_type'])
          const patientStatusLabel = patientStatus === 'exception'
            ? `Ocorrência · ${reportStatusLabels[exceptionType] ?? (exceptionType || 'Outro')}`
            : reportStatusText(patient)
          return <section key={reportRecordText(patient, ['patient_reference'])}><strong>{reportRecordText(patient, ['patient_name'])} · Quarto {reportRecordText(patient, ['room'])} · Leito {reportRecordText(patient, ['bed'])}</strong><span className={`hourly-round-status hourly-round-status-${patientStatus}`}>{patientStatusLabel} · {reportRecordText(patient, ['checked_by_name']) || 'Sem responsável registrado'}{reportRecordText(patient, ['checked_at']) ? ` · ${dateTime(reportRecordText(patient, ['checked_at']))}` : ''}</span>{reportRecordText(patient, ['note']) && <small>{reportRecordText(patient, ['note'])}</small>}</section>
        })}</div></details>}</div>{status && <span className="entry-status">{status}</span>}</article>
      })}</div>{filteredRows.length > reportPageSize && <nav className="history-pagination" aria-label="Paginação do relatório"><span>Exibindo {currentReportPage * reportPageSize + 1}–{Math.min((currentReportPage + 1) * reportPageSize, filteredRows.length)} de {filteredRows.length}</span><div><button className="button button-secondary" type="button" disabled={currentReportPage === 0} onClick={() => setReportPage((page) => Math.max(0, page - 1))}><ArrowLeft size={15} /> Anterior</button><button className="button button-secondary" type="button" disabled={currentReportPage + 1 >= reportPageCount} onClick={() => setReportPage((page) => Math.min(reportPageCount - 1, page + 1))}>Próxima <ArrowRight size={16} /></button></div></nav>}</> : <div className="history-empty">{rows.length ? 'Nenhum registro corresponde aos filtros selecionados.' : 'Nenhum registro disponível para esta área.'}</div>}
    </div>
  </section>
}

function TherapyReportsCenter() {
  const now = new Date()
  const localDateTime = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const [fromDate, setFromDate] = useState(localDateTime(monthStart))
  const [toDate, setToDate] = useState(localDateTime(now))
  const [activities, setActivities] = useState<TherapyActivity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const reports = activities
    .filter((activity) => activity.activity_report.trim())
    .sort((left, right) => left.title.localeCompare(right.title, 'pt-BR', { sensitivity: 'base' })
      || left.starts_at.localeCompare(right.starts_at))

  useEffect(() => {
    let active = true
    async function loadReports() {
      setLoading(true)
      setError('')
      try {
        if (!fromDate || !toDate || toDate < fromDate) {
          throw new Error('Informe um período válido para consultar os relatórios.')
        }
        const start = new Date(fromDate)
        const end = new Date(new Date(toDate).getTime() + 60_000)
        const params = new URLSearchParams({
          from_date: start.toISOString(),
          to_date: end.toISOString(),
          limit: '200',
        })
        const loadedActivities = await loadTherapyActivities(`/api/v1/therapy/activities?${params}`)
        if (active) setActivities(loadedActivities)
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar os relatórios da Oficina Terapêutica.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadReports()
    return () => { active = false }
  }, [fromDate, toDate])

  function printReports() {
    const rows: PrintRow[] = reports.map((activity) => ({
      id: activity.id,
      date: activity.starts_at,
      title: activity.title,
      fields: [
        ['Modalidade', activity.activity_type],
        ['Situação', therapyActivityStatusLabels[activity.status]],
        ['Local', activity.location],
        ['Relato da atividade', activity.activity_report],
        ['Responsável pelo relato', activity.report_updated_by || ''],
      ],
    }))
    if (!printRows('Relatórios · Oficina Terapêutica', rows)) {
      setError('Permita a janela de impressão para este site e tente novamente.')
      return
    }
    setError('')
  }

  return <section className="therapy-report-panel">
    <div className="section-heading"><div><p className="eyebrow">RELATÓRIOS DIGITAIS</p><h2>Oficina Terapêutica</h2><p className="welcome-copy">Relatos salvos ficam disponíveis aqui para consulta; a impressão é opcional.</p></div><button className="button button-secondary therapy-report-print-button" type="button" onClick={printReports} disabled={loading || !reports.length}><Printer size={16} /> Imprimir resultados</button></div>
    {error && <ToastMessage variant="error">{error}</ToastMessage>}
    <div className="psychology-filter-row"><label className="field"><span className="field-label">De (data e hora)</span><input type="datetime-local" value={fromDate} max={toDate || undefined} onChange={(event) => setFromDate(event.target.value)} /></label><label className="field"><span className="field-label">Até (data e hora)</span><input type="datetime-local" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate(event.target.value)} /></label></div>
    {loading ? <div className="history-empty" role="status">Carregando relatórios…</div> : reports.length ? <div className="therapy-report-list">{reports.map((activity) => <article className="therapy-report-card" key={activity.id}><div className="therapy-report-heading"><div><p className="eyebrow">{dateTime(activity.starts_at)} · {activity.activity_type}</p><h3>{activity.title}</h3><p>{activity.location}</p></div><span className={`therapy-report-status therapy-report-status-${activity.status}`}>{therapyActivityStatusLabels[activity.status]}</span></div><p className="therapy-report-content">{activity.activity_report}</p><small className="therapy-report-author">{activity.report_updated_by ? `Registrado por ${activity.report_updated_by}` : 'Responsável não informado'}{activity.report_updated_at ? ` · ${dateTime(activity.report_updated_at)}` : ''}</small></article>)}</div> : <div className="history-empty">Nenhum relatório salvo para o período selecionado.</div>}
  </section>
}

function ManagementPage({ user, onNavigate, allowedModules }: { user: AuthUser; onNavigate: (id: ModuleId) => void; allowedModules: ModuleId[] }) {
  const [tab, setTab] = usePersistentTab(`scpo-tab-management-${user.id}`, 'overview', managementTabValues, managementTabLabels)
  const shortcuts: { id: ModuleId; label: string }[] = [
    { id: 'patients', label: 'Cadastro de pacientes' },
    { id: 'reception', label: 'Recepção e chegadas' },
    { id: 'nursing', label: 'Enfermagem' },
    { id: 'pharmacy', label: 'Farmácia e estoque' },
    { id: 'maintenance', label: 'Manutenção' },
    { id: 'admin', label: 'Administração' },
  ]
  const visibleShortcuts = shortcuts.filter(({ id }) => allowedModules.includes(id))
  return <section className="management-page page-enter">
    <div className="page-title-row"><div><p className="eyebrow">GESTÃO INSTITUCIONAL</p><h1>Painel de Gestão Hospitalar</h1><p className="welcome-copy">Visão consolidada dos indicadores operacionais existentes; não substitui relatórios contábeis, faturamento ou sistemas regulatórios.</p></div><span className="module-icon module-icon-management"><Building2 size={20} /></span></div>
    <ModuleTabNavigation
      ariaLabel="Áreas da Gestão Hospitalar"
      value={tab}
      onChange={setTab}
      alwaysShowButtons
      options={managementTabValues.map((value) => ({
        value,
        label: managementTabLabels[value],
        content: value === 'overview' ? <><Activity size={16} /> {managementTabLabels[value]}</>
          : value === 'tasks' ? <><ClipboardList size={16} /> {managementTabLabels[value]}</>
          : value === 'beds' ? <><Building2 size={16} /> {managementTabLabels[value]}</>
          : value === 'reports' ? <><ClipboardList size={16} /> {managementTabLabels[value]}</>
          : value === 'behavior' ? <><AlertTriangle size={16} /> {managementTabLabels[value]}</>
          : value === 'governance' ? <><ShieldCheck size={16} /> {managementTabLabels[value]}</>
          : <><ArrowRight size={16} /> {managementTabLabels[value]}</>,
      }))}
    />
    {tab === 'overview' && <ExecutiveDashboard />}
    {tab === 'tasks' && <Suspense fallback={<div className="history-empty" role="status">Carregando pendências operacionais…</div>}><OperationalTaskCenter user={user} onNavigate={onNavigate} /></Suspense>}
    {tab === 'beds' && <HospitalBedManagement />}
    {tab === 'reports' && <AdminReportsCenter scope="management" />}
    {tab === 'behavior' && <ManagementBehavioralStatusBoard />}
    {tab === 'governance' && <Suspense fallback={<div className="history-empty" role="status">Carregando operações administrativas…</div>}><AdministrativeRoadmapPanel userId={user.id} /></Suspense>}
    {tab === 'shortcuts' && <section className="patient-list-panel management-shortcuts"><div className="section-heading"><div><p className="eyebrow">ACOMPANHAMENTO OPERACIONAL</p><h2>Acesso rápido às áreas</h2></div></div><div>{visibleShortcuts.map(({ id, label }) => <button className="button button-secondary" type="button" key={id} onClick={() => onNavigate(id)}>{label}<ArrowRight size={15} /></button>)}</div></section>}
  </section>
}

type ManagementBehavioralStatus = {
  patient_reference: string
  patient_name: string
  room: string
  bed: string
  status: BehavioralStatus | null
  updated_at: string | null
}

function ManagementBehavioralStatusBoard() {
  const [statuses, setStatuses] = useState<ManagementBehavioralStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshVersion, setRefreshVersion] = useState(0)

  useEffect(() => {
    let active = true
    fetch('/api/v1/management/behavioral-status')
      .then(readApiResponse<{ statuses?: ManagementBehavioralStatus[] }>)
      .then((result) => {
      if (active) setStatuses(result.statuses ?? [])
    }).catch((loadError) => {
      if (active) setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar as sinalizações comportamentais.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [refreshVersion])

  return <section className="patient-list-panel behavioral-status-board-panel">
    <div className="section-heading"><div><p className="eyebrow">ACOMPANHAMENTO DE INTERNADOS</p><h2>Sinalização comportamental</h2><p className="welcome-copy">Exibe somente a cor de atenção e a data da última revisão. Observações e detalhes clínicos permanecem restritos à equipe assistencial.</p></div><button className="button button-secondary" type="button" onClick={() => { setLoading(true); setError(''); setRefreshVersion((version) => version + 1) }}>Atualizar</button></div>
    {error && <ToastMessage variant="error">{error}</ToastMessage>}
    {loading ? <div className="history-empty" role="status">Carregando sinalizações…</div> : statuses.length ? <div className="behavioral-status-board">{statuses.map((item) => <article className="behavioral-status-row" key={item.patient_reference}>
      <div><strong>{item.patient_name}</strong><small>Quarto {item.room} · leito {item.bed}</small><small>{item.updated_at ? `Última revisão: ${dateTime(item.updated_at)}` : 'Ainda sem revisão do semáforo'}</small></div>
      <BehavioralStatusBadge status={item.status} />
    </article>)}</div> : <div className="history-empty">Nenhum paciente internado está disponível para acompanhamento.</div>}
  </section>
}

function BackupExportPanel() {
  const [password, setPassword] = useState('')
  const [showBackupPassword, setShowBackupPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [restorePassword, setRestorePassword] = useState('')
  const [showRestorePassword, setShowRestorePassword] = useState(false)
  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [restoreConfirmation, setRestoreConfirmation] = useState('')
  const [restoring, setRestoring] = useState(false)
  const [restoreMessage, setRestoreMessage] = useState('')
  const [restoreError, setRestoreError] = useState('')
  async function exportBackup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('')
    try {
      const response = await fetch('/api/v1/backup/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
      if (!response.ok) { const data = await response.json() as { detail?: string }; throw new Error(data.detail ?? 'Não foi possível gerar o backup.') }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a'); link.href = url; link.download = `scpo-connect-${new Date().toISOString().replace(/[:.]/g, '-')}.rgs`; link.click(); URL.revokeObjectURL(url)
      setMessage('Backup cifrado gerado e baixado. Guarde a senha em local seguro; ela não pode ser recuperada pelo sistema.')
    } catch (exportError) { setError(exportError instanceof Error ? exportError.message : 'Falha ao gerar backup.') }
    finally { setBusy(false) }
  }
  async function restoreBackup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!restoreFile || restoreConfirmation !== 'SUBSTITUIR TODOS OS DADOS') return
    setRestoring(true); setRestoreError(''); setRestoreMessage('')
    try {
      const encodedPassword = btoa(String.fromCharCode(...new TextEncoder().encode(restorePassword)))
      const response = await fetch('/api/v1/backup/restore', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/vnd.scpo.rgs',
          'X-RGS-Password': encodedPassword,
          'X-Restore-Confirmation': restoreConfirmation,
        },
        body: restoreFile,
      })
      const data = await readApiResponse<{ message?: string }>(response)
      setRestoreMessage(data.message ?? 'Os bancos foram restaurados.')
      setRestoreFile(null)
      setRestoreConfirmation('')
      setRestorePassword('')
      const input = document.getElementById('backup-restore-file')
      if (input instanceof HTMLInputElement) input.value = ''
    } catch (restoreFailure) {
      setRestoreError(restoreFailure instanceof Error ? restoreFailure.message : 'Falha ao restaurar o backup.')
    } finally {
      setRestoring(false)
    }
  }
  const restoreReady = Boolean(restoreFile)
    && restorePassword.length >= 12
    && restorePassword.length <= 128
    && restoreConfirmation === 'SUBSTITUIR TODOS OS DADOS'
  return <section className="patient-list-panel backup-panel">
    <div className="section-heading">
      <div><p className="eyebrow">PROTEÇÃO DE DADOS</p><h2>Backup do sistema</h2><p className="welcome-copy">Exporta os sete bancos protegidos por senha.</p></div>
      <span className="module-icon module-icon-admin"><ShieldCheck size={20} /></span>
    </div>
    <form className="backup-export-form" onSubmit={(event) => void exportBackup(event)}>
      <label className="field"><span className="field-label">Senha de criptografia</span><span className="auth-password-control"><input required minLength={12} maxLength={128} type={showBackupPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Use uma senha exclusiva com 12 ou mais caracteres" /><button className="auth-password-toggle" type="button" aria-label={showBackupPassword ? 'Ocultar senha de criptografia' : 'Mostrar senha de criptografia'} aria-pressed={showBackupPassword} onClick={() => setShowBackupPassword((visible) => !visible)}>{showBackupPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button></span><span className="field-hint">A senha não é enviada para auditoria nem armazenada. Sem ela, o arquivo não pode ser aberto.</span></label>
      <button className="button button-primary" type="submit" disabled={busy || password.length < 12}>{busy ? 'Preparando bancos…' : 'Gerar backup'}</button>
    </form>
    {message && <ToastMessage variant="success">{message}</ToastMessage>}
    {error && <ToastMessage variant="error">{error}</ToastMessage>}
    <section className="backup-restore-section">
      <div className="section-heading"><div><p className="eyebrow">RESTAURAÇÃO DE BACKUP</p><h3>Substituir dados atuais</h3><p className="welcome-copy">Restaura os sete bancos do sistema a partir de um arquivo protegido por senha.</p></div></div>
      <div className="admin-warning backup-restore-guidance" role="alert"><ShieldCheck size={18} /><div><strong>Operação destrutiva e com indisponibilidade</strong><span>Esta ação substituirá todos os dados atuais. Agende uma janela de manutenção, avise os usuários e confirme que escolheu o arquivo correto. Antes da substituição, o sistema valida o arquivo e cria cópias temporárias dos bancos atuais para recuperação automática se a operação falhar. A substituição dos sete bancos não é atômica: mantenha o serviço sem uso durante todo o processo.</span></div></div>
      <form className="backup-restore-form" onSubmit={(event) => void restoreBackup(event)}>
        <div className="field"><span className="field-label">Arquivo de backup</span><div className="therapy-image-file-picker"><input className="therapy-image-file-input" id="backup-restore-file" required type="file" accept=".rgs,application/vnd.scpo.rgs" onChange={(event) => setRestoreFile(event.target.files?.[0] ?? null)} /><label className="button button-secondary" htmlFor="backup-restore-file">Escolher arquivo</label><span title={restoreFile?.name}>{restoreFile?.name ?? 'Nenhum arquivo selecionado'}</span></div><span className="field-hint">Somente pacotes .rgs exportados com senha pela Administração do Sistema.</span></div>
        <label className="field"><span className="field-label">Senha do backup</span><span className="auth-password-control"><input required minLength={12} maxLength={128} type={showRestorePassword ? 'text' : 'password'} autoComplete="current-password" value={restorePassword} onChange={(event) => setRestorePassword(event.target.value)} /><button className="auth-password-toggle" type="button" aria-label={showRestorePassword ? 'Ocultar senha do backup' : 'Mostrar senha do backup'} aria-pressed={showRestorePassword} onClick={() => setShowRestorePassword((visible) => !visible)}>{showRestorePassword ? <EyeOff size={19} /> : <Eye size={19} />}</button></span></label>
        <label className="field"><span className="field-label">Confirmação obrigatória</span><input required value={restoreConfirmation} onChange={(event) => setRestoreConfirmation(event.target.value)} placeholder="SUBSTITUIR TODOS OS DADOS" autoComplete="off" /><span className="field-hint">Digite exatamente SUBSTITUIR TODOS OS DADOS para habilitar a restauração.</span></label>
        <button className="button button-danger" type="submit" disabled={!restoreReady || restoring || busy}>{restoring ? 'Validando e restaurando…' : 'Restaurar backup e substituir dados'}</button>
      </form>
      {restoreMessage && <ToastMessage variant="success">{restoreMessage}</ToastMessage>}
      {restoreError && <ToastMessage variant="error">{restoreError}</ToastMessage>}
    </section>
  </section>
}

const auditActionLabels: Record<string, string> = {
  user_created: 'Conta criada',
  user_access_changed: 'Acessos da conta atualizados',
  user_display_name_changed: 'Nome de exibição alterado',
  user_password_changed: 'Senha alterada pelo titular',
  user_password_reset: 'Senha redefinida',
  user_credentials_reset: 'Credenciais redefinidas',
  user_deleted: 'Conta excluída',
  all_user_credentials_reset: 'Credenciais de todas as contas redefinidas',
  physician_profile_admin_updated: 'Perfil médico atualizado pela Administração',
  physician_prescription_created: 'Prescrição médica criada',
  queue_call_settings_read: 'Regra de alternância da fila consultada',
  queue_call_settings_updated: 'Regra de alternância da fila atualizada',
  anvisa_catalog_status_read: 'Catálogo público de medicamentos consultado',
  anvisa_catalog_refreshed: 'Catálogo público de medicamentos atualizado',
  inventory_read: 'Estoque consultado',
  medication_dispensed: 'Medicamento dispensado',
  patient_observations_read: 'Observações do paciente consultadas',
  patient_observation_created: 'Observação do paciente registrada',
  institutional_documents_read: 'Documentos institucionais consultados',
  safety_incident_created: 'Incidente de segurança registrado',
}

function localizedAuditAction(action: string) {
  if (auditActionLabels[action]) return auditActionLabels[action]
  const translations: Record<string, string> = {
    created: 'registrado',
    updated: 'atualizado',
    changed: 'alterado',
    read: 'consultado',
    viewed: 'consultado',
    deleted: 'excluído',
    cancelled: 'cancelado',
    completed: 'concluído',
    approved: 'aprovado',
    resolved: 'resolvido',
    refreshed: 'atualizado',
    started: 'iniciado',
  }
  const words = action.split('_')
  const verb = translations[words.at(-1) ?? '']
  return verb ? `Registro ${verb}` : 'Ação registrada'
}

function AuditLogPanel() {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [targetLabels, setTargetLabels] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [targetLabelError, setTargetLabelError] = useState('')
  const loadEvents = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/v1/audit/events')
      const data = await readApiResponse<{ events?: AuditEvent[] }>(response)
      const loadedEvents = data.events ?? []
      setEvents(loadedEvents)
      setTargetLabels({})
      setError('')
      try {
        const labelsResponse = await fetch('/api/v1/management/audit/target-labels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targets: loadedEvents.map(({ module, action, target_id }) => ({ module, action, target_id })),
          }),
        })
        const labelsData = await readApiResponse<{ labels?: Record<string, string> }>(labelsResponse)
        setTargetLabels(labelsData.labels ?? {})
        setTargetLabelError('')
      } catch (labelLoadError) {
        setTargetLabelError(labelLoadError instanceof Error
          ? `Os registros foram carregados, mas não foi possível identificar alguns destinos: ${labelLoadError.message}`
          : 'Os registros foram carregados, mas não foi possível identificar alguns destinos.')
      }
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
  const knownAuditTargets: Record<string, string> = {
    all: 'Todos os registros',
    hospital_summary: 'Resumo hospitalar',
    patient_registry: 'Cadastro de pacientes',
    triage_history: 'Histórico de triagens',
    triage_queue: 'Fila de triagem',
  }
  const auditTargetLabel = (event: AuditEvent) => {
    const key = `${event.module}:${event.action}:${event.target_id}`
    return targetLabels[key] ?? knownAuditTargets[event.target_id] ?? 'Registro relacionado'
  }
  return <section className="patient-list-panel"><div className="section-heading"><div><p className="eyebrow">RASTREABILIDADE</p><h2>Registros de auditoria</h2><p className="welcome-copy">Eventos administrativos recentes, sem conteúdo clínico detalhado.</p></div><button className="button button-secondary" type="button" onClick={() => void loadEvents()} disabled={loading}>{loading ? 'Atualizando…' : 'Atualizar registros'}</button></div>{error && <ToastMessage variant="error">{error}</ToastMessage>}{targetLabelError && <ToastMessage variant="error">{targetLabelError}</ToastMessage>}{loading && !events.length ? <div className="history-empty">Carregando registros…</div> : events.length ? <div className="collection-list">{events.map((event) => <article className="collection-row" key={event.id}><div className="collection-row-heading"><strong>{event.actor_name} · {roleLabels[event.actor_role as ProfileId] ?? 'Equipe autorizada'}</strong><time>{dateTime(event.happened_at)}</time></div><div className="collection-values"><span><small>Ação</small><strong>{localizedAuditAction(event.action)}</strong></span><span><small>Módulo</small><strong>{moduleLabels[event.module] ?? 'Sistema'}</strong></span><span><small>Registro</small><strong>{auditTargetLabel(event)}</strong>{!targetLabels[`${event.module}:${event.action}:${event.target_id}`] && !knownAuditTargets[event.target_id] && <small>Identificador interno: {event.target_id.length > 16 ? `${event.target_id.slice(0, 12)}…` : event.target_id}</small>}</span></div></article>)}</div> : <div className="history-empty">Nenhum evento registrado.</div>}</section>
}

function SystemAdminPage({ user }: { user: AuthUser }) {
  const { confirm } = useAppDialogs()
  const [tab, setTab] = usePersistentTab(`scpo-tab-system-admin-${user.id}`, 'accounts', systemAdminTabValues, systemAdminTabLabels)
  const [users, setUsers] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [deletingUserId, setDeletingUserId] = useState('')
  const [error, setError] = useState('')
  const [resetAccounts, setResetAccounts] = useState<{ username: string; temporary_password: string }[]>([])
  const [resetAllConfirmationOpen, setResetAllConfirmationOpen] = useState(false)
  const [resetAllPassword, setResetAllPassword] = useState('')
  const [resetAllPhrase, setResetAllPhrase] = useState('')
  const [showResetAllPassword, setShowResetAllPassword] = useState(false)
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
  async function resetAllCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setResetAccounts([])
    try {
      const response = await fetch('/api/v1/system-admin/reset-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: resetAllPassword, confirmation: resetAllPhrase }),
      })
      const data = await readApiResponse<{ accounts?: { username: string; temporary_password: string }[] }>(response)
      setResetAccounts(data.accounts ?? [])
      setResetAllConfirmationOpen(false)
      setResetAllPassword('')
      setResetAllPhrase('')
      await loadUsers()
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Não foi possível redefinir as credenciais.')
    } finally {
      setBusy(false)
    }
  }
  async function resetOneCredentials(user: Account) {
    if (!await confirm(`Redefinir a senha e encerrar as sessões de ${user.name}? A senha temporária será 0000, o MFA atual será mantido e o usuário precisará informar o código do autenticador no próximo acesso.`)) return
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
  async function deleteSystemUser(user: Account) {
    if (!await confirm(`Excluir permanentemente a conta ${user.username} (${user.name})? Esta ação não pode ser desfeita.`)) return
    setBusy(true)
    setDeletingUserId(user.id)
    setError('')
    try {
      await readApiResponse(await fetch(`/api/v1/access/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' }))
      await loadUsers()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Não foi possível excluir a conta.')
    } finally {
      setBusy(false)
      setDeletingUserId('')
    }
  }
  return <section className="system-admin-page page-enter">
    <div className="page-title-row"><div><p className="eyebrow">ACESSO RESTRITO · MANTENEDOR</p><h1>Administração do Sistema</h1><p className="welcome-copy">Operações de manutenção disponíveis exclusivamente à conta superadministradora.</p></div><span className="module-icon"><ShieldCheck size={20} /></span></div>
    <div className="admin-tabs module-tabs" role="tablist" aria-label="Seções da Administração do Sistema">{systemAdminTabValues.map((section) => <button key={section} className={`button ${tab === section ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={tab === section} onClick={() => setTab(section)}>{systemAdminTabLabels[section]}</button>)}</div>
    {tab === 'accounts' && <AdminPage user={user} view="accounts" />}
    {tab === 'backup' && <BackupExportPanel />}
    {tab === 'recovery' && <section className="patient-list-panel system-recovery-panel">
      <div className="section-heading"><div><p className="eyebrow">AÇÃO DE EMERGÊNCIA</p><h2>Redefinir credenciais de usuários</h2><p className="welcome-copy">A senha das contas comuns será redefinida para 0000 e as sessões serão encerradas. O MFA já cadastrado será mantido; no próximo acesso, quem já tem MFA deverá informar o código atual e criar uma nova senha. Contas sem MFA serão orientadas a configurá-lo.</p></div></div>
      <div className="system-recovery-summary"><strong>{loading ? '…' : users.length}</strong><span>contas comuns elegíveis · sua própria conta não será alterada</span><button className="button button-danger" type="button" onClick={() => { setError(''); setResetAllPassword(''); setResetAllPhrase(''); setResetAllConfirmationOpen(true) }} disabled={busy || loading || users.length === 0}>{busy ? 'Redefinindo…' : 'Redefinir credenciais de todas as contas'}</button><button className="button button-secondary" type="button" onClick={() => void loadUsers()} disabled={loading}>Atualizar lista</button></div>
      {error && !resetAllConfirmationOpen && <ToastMessage variant="error">{error}</ToastMessage>}
      {resetAccounts.length > 0 && <div className="temporary-credentials" role="status"><div><strong>{resetAccounts.length > 1 ? 'Senhas temporárias geradas' : 'Senha temporária gerada'}</strong><span>A senha temporária de cada conta é 0000. Entregue o login e a senha ao titular por canal seguro. Contas que já usam MFA mantêm o cadastro e devem usar o código atual; contas sem MFA precisarão configurá-lo.</span></div><div className="temporary-credential-list">{resetAccounts.map((account) => <p key={account.username}><strong>{account.username}</strong><code>{account.temporary_password}</code></p>)}</div><button className="button button-secondary" type="button" onClick={() => setResetAccounts([])}>Ocultar senhas</button></div>}
      {!loading && users.length > 0 && <details className="system-account-list"><summary>Contas abrangidas ({users.length})</summary><div>{users.map((account) => <article key={account.id}><span>{account.name} · {account.username}{account.active ? '' : ' · inativa'}</span><button className="button button-secondary" type="button" onClick={() => void resetOneCredentials(account)} disabled={busy}>Redefinir senha</button><button className="button button-danger" type="button" onClick={() => void deleteSystemUser(account)} disabled={busy}>{deletingUserId === account.id ? 'Excluindo…' : 'Excluir conta'}</button></article>)}</div></details>}
      {resetAllConfirmationOpen && <div className="patient-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setResetAllConfirmationOpen(false) }}>
        <section className="patient-archive-dialog credential-reset-dialog recovery-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="recovery-confirm-title">
          <div className="credential-reset-heading"><img src="/scpo-connect-icon.png" alt="" /><div><p className="eyebrow">CONFIRMAÇÃO DE SEGURANÇA</p><h2 id="recovery-confirm-title">Redefinir todas as credenciais?</h2></div></div>
          <p>Esta ação redefine as senhas para <strong>0000</strong> e encerra as sessões de {users.length} conta(s). O MFA já cadastrado será mantido; quem já usa o autenticador precisará do código atual e deverá criar uma nova senha. Contas sem MFA precisarão configurá-lo novamente.</p>
          <form className="recovery-confirm-form" onSubmit={(event) => void resetAllCredentials(event)}>
            <label className="field"><span className="field-label">Confirme sua senha de acesso</span><span className="auth-password-control"><input required type={showResetAllPassword ? 'text' : 'password'} autoComplete="current-password" value={resetAllPassword} onChange={(event) => setResetAllPassword(event.target.value)} /><button className="auth-password-toggle" type="button" aria-label={showResetAllPassword ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={showResetAllPassword} onClick={() => setShowResetAllPassword((visible) => !visible)}>{showResetAllPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button></span></label>
            <label className="field"><span className="field-label">Digite o texto abaixo para confirmar</span><input required value={resetAllPhrase} onChange={(event) => setResetAllPhrase(event.target.value)} placeholder={resetAllConfirmationText} autoComplete="off" /><span className="field-hint">Digite exatamente: {resetAllConfirmationText}</span></label>
            {error && <ToastMessage variant="error">{error}</ToastMessage>}
            <div className="form-actions"><button className="button button-secondary" type="button" disabled={busy} onClick={() => setResetAllConfirmationOpen(false)}>Cancelar</button><button className="button button-danger" type="submit" disabled={busy || !resetAllPassword || resetAllPhrase !== resetAllConfirmationText}>{busy ? 'Redefinindo…' : 'Confirmar redefinição'}</button></div>
          </form>
        </section>
      </div>}
    </section>}
  </section>
}

export default App
