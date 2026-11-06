import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Bone,
  FileCheck2,
  FlaskConical,
  Microscope,
  Info,
  Link2,
  Printer,
  Radio,
  Search,
  ShieldCheck,
} from 'lucide-react'
import { readApiResponse } from '../api'
import { printLaboratoryRequest } from '../printClinicalForm'
import PatientSelect from '../components/PatientSelect'
import { usePersistentTab } from '../components/PageNavigationContext'
import ModuleTabNavigation from '../components/ModuleTabNavigation'
import PrintSelectionPanel from '../components/PrintSelectionPanel'
import type { PrintRow } from '../printReport'
import ToastMessage from '../components/ToastMessage'

type Patient = {
  reference: string
  name: string
  room: string
  bed: string
  birth_date?: string | null
  allergies?: string
  allergies_status?: 'unknown' | 'none_known' | 'known'
}
type AuthUser = { id: string; permissions: Record<string, string[]> }
type XrayStatus = 'requested' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
type EcgPreviewTab = 'equipment' | 'reception' | 'review'
type XrayRequest = {
  id: number
  patient_reference: string
  exam_label: string
  exam_type?: 'xray' | 'ecg' | 'laboratory'
  group_id?: string | null
  observations?: string
  status: XrayStatus
  result: string
  result_recorded_by: string
  result_recorded_at: string | null
  created_at: string
}

const xrayStatuses: Record<XrayStatus, string> = {
  requested: 'Solicitado',
  scheduled: 'Agendado',
  in_progress: 'Em execução',
  completed: 'Concluído',
  cancelled: 'Cancelado',
}

const laboratoryExamOptions = [
  'TGO', 'TGP', 'Gama GT', 'EQU (urina)', 'HIV', 'Sífilis', 'TSH', 'T3', 'T4',
  'Vitamina B12', 'Vitamina D', 'HCV', 'Anti-HBs', 'Hemograma', 'VHS', 'PCR', 'PSA',
  'Colesterol total', 'Colesterol fracionado', 'Triglicerídeos', 'Ureia', 'Creatinina',
  'Bilirrubina direta', 'Bilirrubina indireta', 'Bilirrubina total', 'Amilase', 'Lipase',
].sort((left, right) => left.localeCompare(right, 'pt-BR'))
const xraySections = ['xray', 'ecg', 'laboratory'] as const
const xraySectionLabels: Record<(typeof xraySections)[number], string> = { xray: 'Raio X', ecg: 'Eletrocardiograma', laboratory: 'Exames laboratoriais' }

function groupLaboratoryRequests(requests: XrayRequest[]) {
  const groups = new Map<string, XrayRequest>()
  for (const request of requests) {
    const key = request.group_id ? `group:${request.group_id}` : `request:${request.id}`
    const group = groups.get(key)
    if (!group) {
      groups.set(key, { ...request })
      continue
    }
    group.exam_label = `${group.exam_label} · ${request.exam_label}`
  }
  return [...groups.values()]
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function patientLocationLabel(patient: Pick<Patient, 'room' | 'bed'>) {
  return patient.room.trim() && patient.bed.trim()
    ? `Quarto ${patient.room} · leito ${patient.bed}`
    : 'Sem quarto/leito atribuído'
}

function PatientAllergyAlert({ patient }: { patient?: Patient }) {
  if (!patient) return null
  if (patient.allergies_status === 'known' && patient.allergies) {
    return <div className="clinical-alert" role="alert"><AlertTriangle size={19} /><div><strong>Alerta cadastral · alergia conhecida</strong><span>{patient.allergies}</span></div></div>
  }
  if (patient.allergies_status === 'none_known') {
    return <div className="clinical-alert clinical-alert-clear" role="status"><BadgeCheck size={19} /><div><strong>Sem alergias conhecidas</strong><span>Informação confirmada no cadastro.</span></div></div>
  }
  return <div className="clinical-alert clinical-alert-unknown" role="status"><Info size={19} /><div><strong>Alergias não verificadas</strong><span>Confirme antes de iniciar condutas ou administrar substâncias.</span></div></div>
}

export default function XrayPage({ user }: { user: AuthUser }) {
  const [section, setSection] = usePersistentTab(`scpo-tab-xray-${user.id}`, 'xray', xraySections, xraySectionLabels)
  const [patients, setPatients] = useState<Patient[]>([])
  const [requests, setRequests] = useState<XrayRequest[]>([])
  const [patientReference, setPatientReference] = useState('')
  const [examLabel, setExamLabel] = useState('')
  const [selectedLaboratoryExams, setSelectedLaboratoryExams] = useState<string[]>([])
  const [otherExam, setOtherExam] = useState('')
  const [observations, setObservations] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'active' | 'all' | XrayStatus>('active')
  const [reportStatus, setReportStatus] = useState<'active' | 'all' | XrayStatus>('active')
  const [reportResultFilter, setReportResultFilter] = useState<'all' | 'with_result' | 'without_result'>('all')
  const [queueView, setQueueView] = useState<'queue' | 'reports' | 'device-preview'>('queue')
  const [ecgPreviewTab, setEcgPreviewTab] = useState<EcgPreviewTab>('equipment')
  const [loading, setLoading] = useState(true)
  const [requestsLoadFailed, setRequestsLoadFailed] = useState(false)
  const [patientsLoadFailed, setPatientsLoadFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [updating, setUpdating] = useState<number | null>(null)
  const [resultDrafts, setResultDrafts] = useState<Record<number, string>>({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const canUpdate = user.permissions.xray?.includes('alterar') ?? false
  const selectedPatient = patients.find((patient) => patient.reference === patientReference)

  async function loadData() {
    setLoading(true)
    const [patientResult, requestResult] = await Promise.allSettled([
      fetch('/api/v1/nursing/patients').then((response) => readApiResponse<{ patients?: Patient[] }>(response)),
      fetch('/api/v1/xray/requests').then((response) => readApiResponse<{ requests?: XrayRequest[] }>(response)),
    ])
    const errors: string[] = []
    setRequestsLoadFailed(requestResult.status === 'rejected')
    setPatientsLoadFailed(patientResult.status === 'rejected')
    if (patientResult.status === 'fulfilled') setPatients(patientResult.value.patients ?? [])
    else errors.push(`Pacientes: ${patientResult.reason instanceof Error ? patientResult.reason.message : 'não foi possível carregar.'}`)
    if (requestResult.status === 'fulfilled') setRequests(requestResult.value.requests ?? [])
    else errors.push(`Solicitações: ${requestResult.reason instanceof Error ? requestResult.reason.message : 'não foi possível carregar.'}`)
    setError(errors.join(' · '))
    setLoading(false)
  }

  useEffect(() => {
    let active = true
    const loadXrayData = async () => {
      setLoading(true)
      const [patientResult, requestResult] = await Promise.allSettled([
        fetch('/api/v1/nursing/patients').then((response) => readApiResponse<{ patients?: Patient[] }>(response)),
        fetch('/api/v1/xray/requests').then((response) => readApiResponse<{ requests?: XrayRequest[] }>(response)),
      ])
      if (!active) return
      const errors: string[] = []
      setRequestsLoadFailed(requestResult.status === 'rejected')
      setPatientsLoadFailed(patientResult.status === 'rejected')
      if (patientResult.status === 'fulfilled') setPatients(patientResult.value.patients ?? [])
      else errors.push(`Pacientes: ${patientResult.reason instanceof Error ? patientResult.reason.message : 'não foi possível carregar.'}`)
      if (requestResult.status === 'fulfilled') setRequests(requestResult.value.requests ?? [])
      else errors.push(`Solicitações: ${requestResult.reason instanceof Error ? requestResult.reason.message : 'não foi possível carregar.'}`)
      setError(errors.join(' · '))
      setLoading(false)
    }
    void loadXrayData()
    return () => { active = false }
  }, [user.id])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (section === 'laboratory') return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/v1/xray/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_reference: patientReference,
          exam_label: examLabel.trim(),
          exam_type: section,
        }),
      })
      const data = await readApiResponse<XrayRequest>(response)
      setRequests((current) => [data, ...current])
      setPatientReference('')
      setExamLabel('')
      setNotice(`Exame incluído na fila de ${xraySectionLabels[section]}.`)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Falha ao solicitar o exame.')
    } finally {
      setSaving(false)
    }
  }

  async function submitLaboratory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/v1/xray/laboratory-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_reference: patientReference,
          exams: selectedLaboratoryExams,
          other_exam: otherExam.trim(),
          observations: observations.trim(),
        }),
      })
      const data = await readApiResponse<{ requests: XrayRequest[] }>(response)
      setRequests((current) => [...data.requests, ...current])
      setSelectedLaboratoryExams([])
      setOtherExam('')
      setObservations('')
      setNotice(`${data.requests.length} exame(s) incluído(s) na fila laboratorial.`)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Falha ao solicitar os exames laboratoriais.')
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
      setRequests((current) => current.map((item) => item.group_id && item.group_id === updated.group_id
        ? { ...item, status: updated.status }
        : item.id === updated.id ? updated : item))
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
    setUpdating(request.id)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`/api/v1/xray/requests/${request.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result }),
      })
      const updated = await readApiResponse<XrayRequest>(response)
      setRequests((current) => current.map((item) => item.group_id && item.group_id === updated.group_id
        ? { ...item, result: updated.result, result_recorded_by: updated.result_recorded_by, result_recorded_at: updated.result_recorded_at }
        : item.id === updated.id ? updated : item))
      setResultDrafts((current) => {
        const next = { ...current }
        delete next[request.id]
        return next
      })
      setNotice('Resultado registrado na solicitação do exame.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível registrar o resultado.')
    } finally {
      setUpdating(null)
    }
  }

  const sectionRequests = groupLaboratoryRequests(requests.filter((request) => (request.exam_type ?? 'xray') === section))
  const activeCount = sectionRequests.filter((request) => ['requested', 'scheduled', 'in_progress'].includes(request.status)).length
  const selectedPatientLabel = (patient: Patient) => `${patient.name} · ${patientLocationLabel(patient)}`

  const matchesRequestStatus = (request: XrayRequest, selectedFilter: typeof filter) => selectedFilter === 'all' || (selectedFilter === 'active'
    ? ['requested', 'scheduled', 'in_progress'].includes(request.status)
    : request.status === selectedFilter)
  const matchesQuickSearch = (request: XrayRequest) => {
    const patient = patients.find((item) => item.reference === request.patient_reference)
    const searchable = `${patient?.name ?? ''} ${patient?.room ?? ''} ${patient?.bed ?? ''} ${request.exam_label} ${xrayStatuses[request.status]}`.toLocaleLowerCase('pt-BR')
    return searchable.includes(query.trim().toLocaleLowerCase('pt-BR'))
  }
  const visibleRequests = sectionRequests.filter((request) => {
    return matchesRequestStatus(request, filter) && matchesQuickSearch(request)
  })
  const reportRequests = sectionRequests.filter((request) => {
    const hasResult = Boolean(request.result.trim())
    return matchesRequestStatus(request, reportStatus)
      && (reportResultFilter === 'all' || (reportResultFilter === 'with_result' ? hasResult : !hasResult))
  })
  const patientName = (reference: string) => {
    const patient = patients.find((item) => item.reference === reference)
    return patient ? `${patient.name} · ${patientLocationLabel(patient)}` : 'Paciente não localizado'
  }
  const xrayPrintRows: PrintRow[] = reportRequests.map((request) => ({
    id: String(request.id),
    date: request.created_at,
    title: patientName(request.patient_reference),
    fields: [
      ['Exame', request.exam_label],
      ['Modalidade', xraySectionLabels[section]],
      ['Situação', xrayStatuses[request.status]],
      ['Resultado', request.result.trim() ? 'Registrado' : 'Pendente'],
      ['Data do resultado', request.result_recorded_at ? dateTime(request.result_recorded_at) : 'Não informado'],
    ],
  }))

  return <section className="xray-page page-enter">
    <div className="page-title-row"><div><p className="eyebrow">MÓDULO · CENTRAL DE EXAMES</p><h1>Central de Exames</h1><p className="welcome-copy">Solicite Raio X, eletrocardiogramas e exames laboratoriais e acompanhe cada fila.</p></div><span className="module-icon module-icon-xray"><Microscope size={23} /></span></div>
    <ModuleTabNavigation
      className="xray-tabs"
      ariaLabel="Seções da Central de Exames"
      value={section}
      onChange={(value) => {
        setSection(value)
        if (value !== 'ecg' && queueView === 'device-preview') setQueueView('queue')
      }}
      options={xraySections.map((value) => ({
        value,
        label: xraySectionLabels[value],
        content: value === 'xray' ? <><Bone size={16} /> {xraySectionLabels[value]}</>
          : value === 'ecg' ? <><Activity size={16} /> {xraySectionLabels[value]}</>
          : <><FlaskConical size={16} /> {xraySectionLabels[value]}</>,
      }))}
    />
    <ModuleTabNavigation
      className="xray-view-tabs"
      ariaLabel="Fila, relatórios ou prévia do equipamento"
      value={queueView}
      onChange={setQueueView}
      options={[
        { value: 'queue', label: 'Fila', content: <><Activity size={16} /> Fila</> },
        { value: 'reports', label: 'Relatórios', content: <><Printer size={16} /> Relatórios</> },
        ...(section === 'ecg' ? [{ value: 'device-preview' as const, label: 'Integração EKS2000', content: <><Radio size={16} /> Integração EKS2000</> }] : []),
      ]}
    />
    {error && <ToastMessage variant="error">{error}</ToastMessage>}
    {notice && <ToastMessage variant="success">{notice}</ToastMessage>}
    {section === 'ecg' && queueView === 'device-preview' && <section className="patient-list-panel ecg-device-preview">
      <div className="ecg-preview-heading">
        <div><p className="eyebrow">PRÉVIA DE INTERFACE · SEM CONEXÃO</p><h2>Integração Bionet CardioCare 2000 / EKS2000</h2><p className="welcome-copy">Fluxo visual para discussão com a equipe. O protocolo, o firmware e a forma de exportação ainda precisam ser confirmados com o fabricante.</p></div>
        <span className="ecg-demo-badge"><Info size={15} /> Demonstração</span>
      </div>
      <div className="ecg-preview-notice" role="note"><ShieldCheck size={19} /><div><strong>Nenhum equipamento conectado</strong><span>Esta tela não abre portas, não recebe arquivos e não grava nem envia dados. Todos os exemplos abaixo são fictícios.</span></div></div>
      <ModuleTabNavigation
        className="ecg-preview-tabs"
        ariaLabel="Etapas da prévia de integração ECG"
        value={ecgPreviewTab}
        onChange={setEcgPreviewTab}
        options={[
          { value: 'equipment', label: 'Equipamento', content: <><Radio size={16} /> Equipamento</> },
          { value: 'reception', label: 'Recepção de exame', content: <><FileCheck2 size={16} /> Recepção de exame</> },
          { value: 'review', label: 'Conferência e vínculo', content: <><Link2 size={16} /> Conferência e vínculo</> },
        ]}
      />
      {ecgPreviewTab === 'equipment' && <div className="ecg-preview-content">
        <div className="ecg-device-status"><span className="ecg-status-dot" /><div><strong>Desconectado</strong><span>Aguardando avaliação técnica presencial</span></div></div>
        <dl className="ecg-device-details">
          <div><dt>Equipamento informado</dt><dd>Bionet CardioCare 2000 (EKS2000)</dd></div>
          <div><dt>Identificação vista em impressão de teste</dt><dd>EKG2000 · 6.05 / 3.26 (significado a confirmar)</dd></div>
          <div><dt>Protocolo de integração</dt><dd>Não confirmado</dd></div>
          <div><dt>Possíveis formatos</dt><dd>Exportação oficial ou DICOM, se suportado pelo modelo/firmware</dd></div>
          <div><dt>PACS / Orthanc</dt><dd>Não configurado; avaliar somente após confirmar suporte DICOM</dd></div>
        </dl>
        <p className="ecg-preview-footnote">Os números foram observados numa impressão de teste; ainda não foi confirmado se identificam versões de firmware nem a quais componentes se referem. A proposta de PACS é aproveitável como caminho padronizado caso o fabricante confirme exportação DICOM ECG. DICOM, por si só, não garante que o traçado seja exibido corretamente nesta aplicação.</p>
      </div>}
      {ecgPreviewTab === 'reception' && <div className="ecg-preview-content">
        <div className="ecg-demo-file"><FileCheck2 size={22} /><div><strong>Exemplo fictício de exame recebido</strong><span>ECG_DEMONSTRACAO.dcm · formato ilustrativo, não validado no EKS2000</span></div><span className="ecg-file-tag">SIMULADO</span></div>
        <figure className="ecg-demo-tracing">
          <figcaption><strong>Traçado ilustrativo</strong><span>Onda sintética para demonstrar a visualização; não é um exame real nem tem finalidade diagnóstica.</span></figcaption>
          <svg viewBox="0 0 760 150" role="img" aria-labelledby="ecg-demo-waveform-title ecg-demo-waveform-desc">
            <title id="ecg-demo-waveform-title">Traçado eletrocardiográfico fictício</title>
            <desc id="ecg-demo-waveform-desc">Onda sintética decorativa sobre grade. Não representa paciente nem resultado clínico.</desc>
            <defs>
              <pattern id="ecg-demo-small-grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" className="ecg-demo-grid-small" /></pattern>
              <pattern id="ecg-demo-large-grid" width="50" height="50" patternUnits="userSpaceOnUse"><rect width="50" height="50" fill="url(#ecg-demo-small-grid)" /><path d="M 50 0 L 0 0 0 50" className="ecg-demo-grid-large" /></pattern>
            </defs>
            <rect width="760" height="150" fill="url(#ecg-demo-large-grid)" />
            <path className="ecg-demo-trace" d="M0 76 H34 L41 72 L47 76 H88 L94 76 L101 62 L108 91 L116 35 L125 111 L134 76 H169 L176 72 L182 76 H224 L230 76 L237 62 L244 91 L252 35 L261 111 L270 76 H304 L311 72 L317 76 H359 L365 76 L372 62 L379 91 L387 35 L396 111 L405 76 H439 L446 72 L452 76 H494 L500 76 L507 62 L514 91 L522 35 L531 111 L540 76 H574 L581 72 L587 76 H629 L635 76 L642 62 L649 91 L657 35 L666 111 L675 76 H709 L716 72 L722 76 H760" />
          </svg>
        </figure>
        <dl className="ecg-device-details">
          <div><dt>Origem</dt><dd>Equipamento de demonstração</dd></div>
          <div><dt>Paciente / solicitação</dt><dd>Não identificados nesta prévia</dd></div>
          <div><dt>Integridade e formato</dt><dd>Serão verificados após definir a interface oficial</dd></div>
        </dl>
        <p className="ecg-preview-footnote">A etapa real deverá validar formato, tamanho, origem autorizada e integridade antes de disponibilizar qualquer arquivo clínico.</p>
      </div>}
      {ecgPreviewTab === 'review' && <div className="ecg-preview-content">
        <div className="ecg-review-step"><span>1</span><div><strong>Conferir identidade do paciente</strong><p>Comparar os identificadores do exame com uma solicitação existente; não vincular automaticamente em caso de dúvida.</p></div></div>
        <div className="ecg-review-step"><span>2</span><div><strong>Vincular após confirmação humana</strong><p>Exemplo fictício: solicitação ECG DEMO-001 · paciente de demonstração, sem dados reais.</p></div></div>
        <div className="ecg-preview-disabled-action"><Link2 size={17} /><span>Vínculo e importação indisponíveis nesta demonstração</span></div>
        <p className="ecg-preview-footnote">O fluxo definitivo deverá registrar autoria e auditoria, preservar o arquivo original e respeitar o processo clínico de revisão e laudo.</p>
      </div>}
    </section>}
    {queueView === 'queue' && <>
    <div className="hygiene-summary" aria-label={`Resumo da fila de ${xraySectionLabels[section]}`} aria-busy={loading}><article className="status-tone-neutral"><strong>{loading ? '…' : requestsLoadFailed ? '—' : sectionRequests.length}</strong><span>Total de solicitações</span></article><article className={activeCount ? 'status-tone-progress' : 'status-tone-neutral'}><strong>{loading ? '…' : requestsLoadFailed ? '—' : activeCount}</strong><span>Exames ativos</span></article><article className={sectionRequests.some((request) => request.status === 'in_progress') ? 'status-tone-progress' : 'status-tone-neutral'}><strong>{loading ? '…' : requestsLoadFailed ? '—' : sectionRequests.filter((request) => request.status === 'in_progress').length}</strong><span>Em execução</span></article></div>
    <form className="hygiene-panel" onSubmit={(event) => void (section === 'laboratory' ? submitLaboratory(event) : submit(event))}>
      <div className="section-heading"><div><p className="eyebrow">{section === 'laboratory' ? 'REQUISIÇÃO LABORATORIAL' : 'NOVO EXAME'}</p><h2>{section === 'laboratory' ? 'Solicitar exames' : `Adicionar à fila de ${xraySectionLabels[section]}`}</h2></div></div>
      <div className="field-grid field-grid-two">
        <PatientSelect label="Paciente" patients={patients} value={patientReference} onChange={setPatientReference} required optionLabel={selectedPatientLabel} />
        {section !== 'laboratory' ? <label className="field xray-field-wide"><span className="field-label">{section === 'ecg' ? 'Modalidade do exame' : 'Exame solicitado'}</span><input required minLength={2} maxLength={80} value={examLabel} onChange={(event) => setExamLabel(event.target.value)} placeholder={section === 'ecg' ? 'Eletrocardiograma' : 'Ex.: radiografia de tórax'} /></label> : <>
          <fieldset className="laboratory-exam-fieldset xray-field-wide"><legend>Exames disponíveis</legend><div className="laboratory-exam-heading"><span className="field-hint">{selectedLaboratoryExams.length} de {laboratoryExamOptions.length} selecionado(s)</span><button className="button button-secondary laboratory-select-all" type="button" aria-pressed={selectedLaboratoryExams.length === laboratoryExamOptions.length} onClick={() => setSelectedLaboratoryExams(selectedLaboratoryExams.length === laboratoryExamOptions.length ? [] : [...laboratoryExamOptions])}>{selectedLaboratoryExams.length === laboratoryExamOptions.length ? 'Desmarcar todos' : 'Selecionar todos os exames'}</button></div><div className="laboratory-exam-grid">{laboratoryExamOptions.map((exam) => <label className="checkbox-label" key={exam}><input type="checkbox" checked={selectedLaboratoryExams.includes(exam)} onChange={() => setSelectedLaboratoryExams((current) => current.includes(exam) ? current.filter((item) => item !== exam) : [...current, exam])} /><span>{exam}</span></label>)}</div></fieldset>
          <label className="field"><span className="field-label">Outros exames</span><input maxLength={72} value={otherExam} onChange={(event) => setOtherExam(event.target.value)} placeholder="Descreva outro exame" /></label>
          <label className="field"><span className="field-label">Observações</span><textarea maxLength={1000} rows={3} value={observations} onChange={(event) => setObservations(event.target.value)} placeholder="Informações adicionais para a solicitação" /></label>
          {selectedPatient && (selectedLaboratoryExams.length > 0 || otherExam.trim()) && <div className="xray-field-wide laboratory-print-preview"><strong>Prévia da identificação</strong><span>{selectedPatient.name} · Nascimento: {selectedPatient.birth_date || 'não informado'} · Quarto {selectedPatient.room || '—'} · Leito {selectedPatient.bed || '—'}</span><button className="button button-secondary" type="button" onClick={() => { if (!printLaboratoryRequest(selectedPatient, selectedLaboratoryExams, otherExam, observations)) setError('Permita a janela de impressão para gerar o formulário.') }}><Printer size={16} /> Imprimir formulário</button></div>}
        </>}
      </div>
      <PatientAllergyAlert patient={selectedPatient} />
      {section === 'xray' && <p className="work-order-privacy">Registre somente o nome do exame neste campo. Não inclua diagnóstico ou dados clínicos adicionais.</p>}
      <button className="button button-primary" type="submit" disabled={saving || !patients.length || (section === 'laboratory' && selectedLaboratoryExams.length === 0 && !otherExam.trim())}>{saving ? 'Registrando…' : section === 'laboratory' ? 'Registrar exames' : 'Solicitar exame'} <ArrowRight size={16} /></button>
    </form>
    <section className="patient-list-panel xray-queue-panel">
      <div className="section-heading"><div><p className="eyebrow">PAINEL OPERACIONAL</p><h2>Fila de {xraySectionLabels[section]} <span className="module-total">{loading || requestsLoadFailed ? '—' : visibleRequests.length}</span></h2></div><button className="button button-secondary" type="button" onClick={() => void loadData()} disabled={loading}>{loading ? 'Atualizando…' : 'Atualizar fila'}</button></div>
      <div className="service-tabs module-tabs" role="tablist" aria-label="Filtrar exames por situação">
        {([
          ['active', 'Ativos'],
          ['all', 'Todos'],
          ...Object.entries(xrayStatuses),
        ] as [typeof filter, string][]).map(([value, label]) => <button className={`button ${filter === value ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={filter === value} key={value} onClick={() => setFilter(value)}>{label}{value === 'active' && <span>{activeCount}</span>}</button>)}
      </div>
      <div className="xray-quick-filters">
        <label className="field xray-search"><span className="field-label">Buscar por paciente, quarto, leito, exame ou situação</span><span className="search-input-wrap"><Search size={17} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Digite para localizar um exame" /></span></label>
        <button className="button button-secondary xray-clear-filters" type="button" onClick={() => { setQuery(''); setFilter('active') }} disabled={!query && filter === 'active'}>Limpar busca</button>
      </div>
      {loading ? <div className="history-empty">Carregando fila de exames…</div> : requestsLoadFailed ? <div className="history-empty">Não foi possível carregar a fila. Use “Atualizar fila” para tentar novamente.</div> : visibleRequests.length ? <div className="xray-request-list">{visibleRequests.map((request) => <article className="xray-request-card" key={request.id}>
        <div className="xray-request-main"><div><h3>{patientName(request.patient_reference)}</h3><p>{request.exam_label}</p>{request.observations && <small>Observações: {request.observations}</small>}<time>{dateTime(request.created_at)}</time></div><span className={`work-order-status status-${request.status === 'requested' ? 'open' : request.status === 'scheduled' ? 'in_progress' : request.status === 'in_progress' ? 'in_progress' : request.status === 'completed' ? 'completed' : 'cancelled'}`}>{xrayStatuses[request.status]}</span></div>
        {request.result && <div className="xray-result"><strong>Resultado registrado</strong><p>{request.result}</p><small>{request.result_recorded_by}{request.result_recorded_at ? ` · ${dateTime(request.result_recorded_at)}` : ''}</small></div>}
        {canUpdate && <form className="xray-result-form" onSubmit={(event) => { event.preventDefault(); void saveResult(request) }}><label className="field"><span className="field-label">{request.result ? 'Atualizar resultado' : 'Resultado do exame'}</span><textarea required minLength={3} maxLength={4000} rows={3} value={resultDrafts[request.id] ?? ''} onChange={(event) => setResultDrafts((current) => ({ ...current, [request.id]: event.target.value }))} placeholder="Registre o resultado/laudo conjunto conforme fluxo institucional" /></label><button className="button button-secondary" type="submit" disabled={updating === request.id || (resultDrafts[request.id] ?? '').trim().length < 3}>{updating === request.id ? 'Salvando…' : request.result ? 'Atualizar resultado' : 'Salvar resultado'}</button></form>}
        {canUpdate && <label className="field xray-status-control"><span className="field-label">Atualizar situação</span><select value={request.status} disabled={updating === request.id || request.status === 'completed' || request.status === 'cancelled'} onChange={(event) => void updateStatus(request, event.target.value as XrayStatus)}><option value="requested">Solicitado</option><option value="scheduled">Agendado</option><option value="in_progress">Em execução</option><option value="completed">Concluído</option><option value="cancelled">Cancelado</option></select></label>}
      </article>)}</div> : <div className="history-empty"><Activity size={20} /><span>{sectionRequests.length ? 'Nenhum exame nesta fila corresponde aos filtros.' : `Nenhuma solicitação de ${xraySectionLabels[section].toLocaleLowerCase('pt-BR')} foi registrada.`}</span></div>}
    </section>
    </>}
    {queueView === 'reports' && <section className="patient-list-panel xray-report-panel">
      <div className="section-heading"><div><p className="eyebrow">CONSULTA E IMPRESSÃO</p><h2>Relatório de {xraySectionLabels[section]}</h2><p className="welcome-copy">Refine a população por situação e presença de resultado; depois use o painel para período, busca, seleção e impressão.</p></div><span className="module-total">{loading || requestsLoadFailed ? '—' : reportRequests.length} registro(s)</span></div>
      <div className="xray-report-filters">
        <label className="field"><span className="field-label">Situação</span><select value={reportStatus} onChange={(event) => setReportStatus(event.target.value as typeof reportStatus)}><option value="active">Ativos</option><option value="all">Todos</option>{Object.entries(xrayStatuses).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select></label>
        <label className="field"><span className="field-label">Resultado</span><select value={reportResultFilter} onChange={(event) => setReportResultFilter(event.target.value as typeof reportResultFilter)}><option value="all">Todos</option><option value="with_result">Resultado registrado</option><option value="without_result">Sem resultado</option></select></label>
        <button className="button button-secondary" type="button" onClick={() => { setReportStatus('active'); setReportResultFilter('all') }} disabled={reportStatus === 'active' && reportResultFilter === 'all'}>Limpar filtros</button>
      </div>
      {loading ? <div className="history-empty">Carregando registros para o relatório…</div> : requestsLoadFailed || patientsLoadFailed ? <div className="history-empty">Não foi possível preparar o relatório porque a fila ou o cadastro de pacientes não foi carregado. Atualize os dados e tente novamente.</div> : xrayPrintRows.length ? <PrintSelectionPanel title={`Relatório da fila de ${xraySectionLabels[section]}`} rows={xrayPrintRows} /> : <div className="history-empty">Nenhuma solicitação corresponde aos filtros do relatório.</div>}
    </section>}
  </section>
}
