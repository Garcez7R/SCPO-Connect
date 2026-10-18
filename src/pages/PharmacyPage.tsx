import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { AlertTriangle, ArrowRight, Camera, CalendarDays, Package, Search } from 'lucide-react'
import { readApiResponse } from '../api'
import PrintSelectionPanel, { type PrintRow } from '../components/PrintSelectionPanel'

type Patient = { reference: string; name: string; room: string; bed: string; allergies?: string; allergies_status?: 'unknown' | 'none_known' | 'known' }
type AuthUser = { id: string; username: string; name: string; role: string; modules: string[]; permissions: Record<string, string[]> }
type PharmacyItem = { id: number; item_name: string; balance: string; unit: string; lot: string; expiry_date: string; created_at: string; barcode: string; category: string; active_ingredient: string; presentation: string; supplier: string; storage_location: string; minimum_balance: string; average_balance: string }
type PharmacyMovement = { id: number; item_id: number; movement_type: 'opening_balance' | 'entry' | 'issue' | 'adjustment'; quantity: string; balance_after: string; reason: string; actor_name: string; created_at: string }
type MedicationDispensation = { id: string; patient_reference: string; item_id: number; medication_name: string; quantity: string; unit: string; instructions: string; prescription_reference: string; prescriber_name: string; allergy_reviewed: boolean; status: 'dispensed' | 'cancelled'; actor_name: string; created_at: string }
function patientLocationLabel(patient: Pick<Patient, 'room' | 'bed'>) {
  return patient.room.trim() && patient.bed.trim() ? `Quarto ${patient.room} · leito ${patient.bed}` : 'Sem quarto/leito atribuído'
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function PatientAllergyAlert({ patient }: { patient?: Pick<Patient, 'allergies' | 'allergies_status'> }) {
  if (!patient) return null
  if (patient.allergies_status === 'known' && patient.allergies) return <div className="clinical-alert" role="alert"><strong>Alerta cadastral · alergia conhecida</strong><span>{patient.allergies}</span></div>
  if (patient.allergies_status === 'none_known') return <div className="clinical-alert clinical-alert-clear" role="status"><strong>Sem alergias conhecidas</strong></div>
  return <div className="clinical-alert clinical-alert-unknown" role="status"><strong>Alergias não verificadas</strong></div>
}

function playBarcodeTone(audioContext: AudioContext | null) {
  if (!audioContext) return
  void audioContext.resume()
  const oscillator = audioContext.createOscillator()
  const gain = audioContext.createGain()
  oscillator.frequency.value = 880
  gain.gain.setValueAtTime(0.0001, audioContext.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.16, audioContext.currentTime + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.12)
  oscillator.connect(gain)
  gain.connect(audioContext.destination)
  oscillator.start()
  oscillator.stop(audioContext.currentTime + 0.13)
}

function PharmacyPage({ user }: { user: AuthUser }) {
  const [items, setItems] = useState<PharmacyItem[]>([])
  const [patients, setPatients] = useState<Patient[]>([])
  const [dispensations, setDispensations] = useState<MedicationDispensation[]>([])
  const [dispenseForm, setDispenseForm] = useState({ patient_reference: '', item_id: '', quantity: '', instructions: '', prescription_reference: '', prescriber_name: '', allergy_reviewed: false })
  const [dispensing, setDispensing] = useState(false)
  const [movements, setMovements] = useState<PharmacyMovement[]>([])
  const [movementTotal, setMovementTotal] = useState(0)
  const [movementOffset, setMovementOffset] = useState(0)
  const [movementItemId, setMovementItemId] = useState<number | null>(null)
  const [movementForm, setMovementForm] = useState({ movement_type: 'entry' as 'entry' | 'issue' | 'adjustment', quantity: '', reason: '' })
  const [movementSaving, setMovementSaving] = useState(false)
  const [form, setForm] = useState({ item_name: '', barcode: '', category: 'Medicamento', active_ingredient: '', presentation: '', balance: '', minimum_balance: '0', unit: '', lot: '', expiry_date: '', supplier: '', storage_location: '' })
  const [query, setQuery] = useState('')
  const [stockFilter, setStockFilter] = useState<'all' | 'expired' | 'expiring' | 'critical' | 'attention'>('all')
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [cameraScannerOpen, setCameraScannerOpen] = useState(false)
  const [cameraScannerMessage, setCameraScannerMessage] = useState('')
  const barcodeVideoRef = useRef<HTMLVideoElement>(null)
  const audioContextRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    if (!cameraScannerOpen) return
    let cancelled = false
    let stream: MediaStream | undefined
    let controls: { stop: () => void } | undefined
    let timer = 0
    let scanning = false
    let detectedCode = ''
    const Detector = (window as Window & { BarcodeDetector?: { new (options?: { formats: string[] }): { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> }; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector
    if (!navigator.mediaDevices?.getUserMedia) {
      return () => { cancelled = true }
    }
    const videoElement = barcodeVideoRef.current
    if (!videoElement) return

    function acceptBarcode(code: string) {
      if (cancelled || code === detectedCode) return
      detectedCode = code
      setForm((current) => ({ ...current, barcode: code.slice(0, 40) }))
      setCameraScannerMessage(`Código lido: ${code}`)
      playBarcodeTone(audioContextRef.current)
      setCameraScannerOpen(false)
    }

    if (!Detector) {
      let activeControls: { stop: () => void } | undefined
      void import('@zxing/browser').then(({ BrowserMultiFormatReader }) => {
        if (cancelled) return
        const reader = new BrowserMultiFormatReader()
        return reader.decodeFromVideoDevice(undefined, videoElement, (result) => {
          const code = result?.getText().trim()
          if (code) acceptBarcode(code)
        })
      }).then((scannerControls) => {
        if (!scannerControls) return
        activeControls = scannerControls
        controls = scannerControls
        if (cancelled) scannerControls.stop()
      }).catch(() => {
        if (!cancelled) setCameraScannerMessage('Não foi possível iniciar a câmera. Verifique a permissão ou use o leitor USB.')
      })
      return () => {
        cancelled = true
        activeControls?.stop()
        controls?.stop()
        videoElement.srcObject = null
      }
    }

    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }).then(async (mediaStream) => {
      stream = mediaStream
      if (cancelled) { mediaStream.getTracks().forEach((track) => track.stop()); return }
      videoElement.srcObject = mediaStream
      await videoElement.play()
      const requestedFormats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'data_matrix']
      const supportedFormats = Detector.getSupportedFormats ? await Detector.getSupportedFormats() : requestedFormats
      const formats = requestedFormats.filter((format) => supportedFormats.includes(format))
      if (!formats.length) { setCameraScannerMessage('Este aparelho não oferece formatos de código compatíveis pela câmera. Use o leitor USB ou digite o código.'); return }
      const detector = new Detector({ formats })
      timer = window.setInterval(async () => {
        if (scanning || cancelled || videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
        scanning = true
        try {
          const results = await detector.detect(videoElement)
          const code = results[0]?.rawValue?.trim()
          if (code) acceptBarcode(code)
        } catch { setCameraScannerMessage('Não foi possível ler esse código. Ajuste a distância ou digite o número.') }
        finally { scanning = false }
      }, 300)
    }).catch(() => {
      if (!cancelled) setCameraScannerMessage('Não foi possível acessar a câmera. Verifique a permissão ou use o leitor USB.')
    })
    return () => {
      cancelled = true
      window.clearInterval(timer)
      stream?.getTracks().forEach((track) => track.stop())
      if (videoElement) videoElement.srcObject = null
    }
  }, [cameraScannerOpen])

  useEffect(() => () => {
    void audioContextRef.current?.close()
  }, [])

  const barcodeCameraUnavailable = !navigator.mediaDevices?.getUserMedia
    ? 'A câmera requer HTTPS e permissão do navegador. Use o leitor USB ou digite o código.'
    : ''

  function prepareBarcodeAudio() {
    if (typeof window.AudioContext === 'undefined') return
    audioContextRef.current ??= new window.AudioContext()
    void audioContextRef.current.resume()
  }

  const loadItems = useCallback(async (offset = movementOffset) => {
    try {
      const [itemResponse, movementResponse] = await Promise.all([
        fetch('/api/v1/pharmacy/items'),
        fetch(`/api/v1/pharmacy/movements?limit=25&offset=${offset}`),
      ])
      const [itemData, movementData] = await Promise.all([
        readApiResponse<{ items?: PharmacyItem[] }>(itemResponse),
        readApiResponse<{ movements?: PharmacyMovement[]; total?: number }>(movementResponse),
      ])
      setItems(itemData.items ?? [])
      setMovements(movementData.movements ?? [])
      setMovementTotal(movementData.total ?? 0)
      setMovementOffset(offset)
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar o estoque.')
    } finally { setLoading(false) }
  }, [movementOffset])

  useEffect(() => {
    let active = true
    const loadInventory = async () => {
      try {
        const [itemResponse, movementResponse] = await Promise.all([
          fetch('/api/v1/pharmacy/items'),
          fetch(`/api/v1/pharmacy/movements?limit=25&offset=${movementOffset}`),
        ])
        const [itemData, movementData] = await Promise.all([
          readApiResponse<{ items?: PharmacyItem[] }>(itemResponse),
          readApiResponse<{ movements?: PharmacyMovement[]; total?: number }>(movementResponse),
        ])
        if (!active) return
        setItems(itemData.items ?? [])
        setMovements(movementData.movements ?? [])
        setMovementTotal(movementData.total ?? 0)
        setError('')
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar o estoque.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadInventory()
    return () => { active = false }
  }, [movementOffset])

  useEffect(() => {
    let current = true
    const loadRelatedData = async () => {
      try {
        const [patientResponse, dispenseResponse] = await Promise.all([
          fetch('/api/v1/nursing/patients'),
          fetch('/api/v1/pharmacy/dispensations?status=dispensed'),
        ])
        const [patientData, dispenseData] = await Promise.all([
          readApiResponse<{ patients?: Patient[] }>(patientResponse),
          readApiResponse<{ dispensations?: MedicationDispensation[] }>(dispenseResponse),
        ])
        if (!current) return
        setPatients(patientData.patients ?? [])
        setDispensations(dispenseData.dispensations ?? [])
      } catch (loadError) {
        if (current) setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar pacientes e dispensações.')
      }
    }

    void loadRelatedData()
    return () => { current = false }
  }, [user.id])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true); setError(''); setNotice('')
    try {
      const response = await fetch('/api/v1/pharmacy/items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, item_name: form.item_name.trim(), balance: form.balance.replace(',', '.'), unit: form.unit.trim(), lot: form.lot.trim() }) })
      const data = await readApiResponse<PharmacyItem>(response)
      setItems((current) => [...current, data].sort((a, b) => a.item_name.localeCompare(b.item_name, 'pt-BR')))
      setForm({ item_name: '', barcode: '', category: 'Medicamento', active_ingredient: '', presentation: '', balance: '', minimum_balance: '0', unit: '', lot: '', expiry_date: '', supplier: '', storage_location: '' })
      setShowForm(false)
      setNotice('Lote cadastrado no estoque.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Falha ao cadastrar o lote.')
    } finally { setSaving(false) }
  }

  async function submitMovement(event: FormEvent<HTMLFormElement>, item: PharmacyItem) {
    event.preventDefault()
    setMovementSaving(true); setError(''); setNotice('')
    try {
      const response = await fetch(`/api/v1/pharmacy/items/${item.id}/movements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...movementForm, quantity: movementForm.quantity.replace(',', '.'), reason: movementForm.reason.trim() }),
      })
      await readApiResponse<PharmacyMovement>(response)
      setMovementItemId(null)
      setMovementForm({ movement_type: 'entry', quantity: '', reason: '' })
      setNotice('Movimentação registrada com saldo atualizado.')
      await loadItems(0)
    } catch (movementError) {
      setError(movementError instanceof Error ? movementError.message : 'Falha ao registrar movimentação.')
    } finally { setMovementSaving(false) }
  }

  async function submitDispensation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setDispensing(true); setError(''); setNotice('')
    try {
      const response = await fetch('/api/v1/pharmacy/dispensations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...dispenseForm, item_id: Number(dispenseForm.item_id), quantity: dispenseForm.quantity.replace(',', '.') }),
      })
      const data = await readApiResponse<MedicationDispensation>(response)
      setDispensations((current) => [data, ...current])
      setDispenseForm({ patient_reference: '', item_id: '', quantity: '', instructions: '', prescription_reference: '', prescriber_name: '', allergy_reviewed: false })
      setNotice('Dispensação registrada, vinculada ao paciente e debitada do lote.')
      await loadItems(0)
    } catch (dispenseError) {
      setError(dispenseError instanceof Error ? dispenseError.message : 'Não foi possível registrar a dispensação.')
    } finally { setDispensing(false) }
  }

  const dispensePatient = patients.find((patient) => patient.reference === dispenseForm.patient_reference)

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
  const soonDate = new Date(`${today}T12:00:00`)
  soonDate.setDate(soonDate.getDate() + 30)
  const soon = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(soonDate)
  const expiredCount = items.filter((item) => item.expiry_date < today).length
  const expiringCount = items.filter((item) => item.expiry_date >= today && item.expiry_date <= soon).length
  const stockLevels = items.map(stockLevel)
  const criticalCount = stockLevels.filter((level) => level === 'critical').length
  const attentionCount = stockLevels.filter((level) => level === 'attention').length
  const healthyCount = stockLevels.filter((level) => level === 'healthy').length
  const unconfiguredCount = stockLevels.filter((level) => level === 'unconfigured').length
  const filteredItems = items.filter((item) => {
    const matchesSearch = `${item.item_name} ${item.lot} ${item.barcode} ${item.category} ${item.active_ingredient} ${item.presentation} ${item.storage_location}`.toLocaleLowerCase('pt-BR').includes(query.trim().toLocaleLowerCase('pt-BR'))
    const level = stockLevel(item)
    const matchesFilter = stockFilter === 'all'
      || (stockFilter === 'expired' && item.expiry_date < today)
      || (stockFilter === 'expiring' && item.expiry_date >= today && item.expiry_date <= soon)
      || (stockFilter === 'critical' && level === 'critical')
      || (stockFilter === 'attention' && level === 'attention')
    return matchesSearch && matchesFilter
  }).sort((a, b) => a.expiry_date.localeCompare(b.expiry_date) || a.item_name.localeCompare(b.item_name, 'pt-BR'))
  const pharmacyPrintRows: PrintRow[] = filteredItems.map((item) => ({ id: String(item.id), date: item.created_at, title: item.item_name, fields: [['Categoria', item.category], ['Princípio ativo', item.active_ingredient], ['Apresentação', item.presentation], ['Saldo', `${item.balance} ${item.unit}`], ['Lote', item.lot], ['Validade', item.expiry_date], ['Código de barras', item.barcode], ['Localização', item.storage_location], ['Fornecedor', item.supplier]] }))

  return <section className="pharmacy-page page-enter">
    <div className="page-title-row"><div><p className="eyebrow">MÓDULO · FARMÁCIA</p><h1>Estoque e validade</h1><p className="welcome-copy">Cadastre itens por lote e acompanhe saldo e prazo de validade.</p></div><button className="button button-primary" type="button" onClick={() => { setShowForm((current) => !current); setNotice(''); setError('') }}><Package size={16} /> {showForm ? 'Fechar cadastro' : 'Cadastrar lote'}</button></div>
    <div className="pharmacy-summary"><article><span>Itens e lotes</span><strong>{items.length}</strong><small>Registros cadastrados</small></article><article className={expiringCount ? 'pharmacy-summary-warning' : ''}><span>Vencem em até 30 dias</span><strong>{expiringCount}</strong><small>Acompanhe as datas</small></article><article className={expiredCount ? 'pharmacy-summary-danger' : ''}><span>Vencidos</span><strong>{expiredCount}</strong><small>Verifique o lote</small></article><article className={criticalCount ? 'pharmacy-summary-danger' : ''}><span>Estoque crítico</span><strong>{criticalCount}</strong><small>No limite mínimo ou abaixo</small></article></div>
    <div className="pharmacy-quick-filters" role="group" aria-label="Filtrar estoque">
      {([
        ['all', 'Todos', items.length],
        ['critical', 'Estoque crítico', criticalCount],
        ['attention', 'Atenção', attentionCount],
        ['expired', 'Vencidos', expiredCount],
        ['expiring', 'Vencem em 30 dias', expiringCount],
      ] as const).map(([value, label, count]) => <button className={`button ${stockFilter === value ? 'button-primary' : 'button-secondary'}`} type="button" key={value} aria-pressed={stockFilter === value} onClick={() => setStockFilter(value)}>{label}<span>{count}</span></button>)}
    </div>
    <PharmacyStockOverview items={items} onSaved={(updated) => setItems((current) => current.map((item) => item.id === updated.id ? updated : item))} counts={{ critical: criticalCount, attention: attentionCount, healthy: healthyCount, unconfigured: unconfiguredCount }} />
    {notice && <div className="form-message form-message-success" role="status">{notice}</div>}{error && <div className="form-message form-message-error" role="alert">{error}</div>}
    <section className="pharmacy-dispensation-panel">
      <div className="section-heading"><div><p className="eyebrow">SAÍDA ASSISTENCIAL</p><h2>Dispensar para paciente</h2><p className="welcome-copy">Registre a prescrição, confirme as alergias e selecione o lote dispensado. A Enfermagem receberá o vínculo para registrar a administração.</p></div></div>
      <form className="field-grid field-grid-two" onSubmit={(event) => void submitDispensation(event)}>
        <label className="field"><span className="field-label">Paciente</span><select required value={dispenseForm.patient_reference} onChange={(event) => setDispenseForm({ ...dispenseForm, patient_reference: event.target.value, allergy_reviewed: false })}><option value="">Selecione</option>{patients.map((patient) => <option key={patient.reference} value={patient.reference}>{patient.name} · {patientLocationLabel(patient)}</option>)}</select></label>
        <label className="field"><span className="field-label">Medicamento e lote</span><select required value={dispenseForm.item_id} onChange={(event) => setDispenseForm({ ...dispenseForm, item_id: event.target.value })}><option value="">Selecione lote válido</option>{items.filter((item) => item.category.toLocaleLowerCase('pt-BR') === 'medicamento' && item.expiry_date >= today && Number(item.balance.replace(',', '.')) > 0).map((item) => <option key={item.id} value={item.id}>{item.item_name} · Lote {item.lot} · saldo {item.balance} {item.unit}</option>)}</select></label>
        <label className="field"><span className="field-label">Quantidade</span><input required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,3})?" maxLength={32} value={dispenseForm.quantity} onChange={(event) => setDispenseForm({ ...dispenseForm, quantity: event.target.value })} /></label>
        <label className="field"><span className="field-label">Referência da prescrição</span><input required minLength={2} maxLength={80} value={dispenseForm.prescription_reference} onChange={(event) => setDispenseForm({ ...dispenseForm, prescription_reference: event.target.value })} /></label>
        <label className="field"><span className="field-label">Profissional prescritor</span><input required minLength={2} maxLength={120} value={dispenseForm.prescriber_name} onChange={(event) => setDispenseForm({ ...dispenseForm, prescriber_name: event.target.value })} /></label>
        <label className="field"><span className="field-label">Instruções para administração (conforme prescrição)</span><input maxLength={500} value={dispenseForm.instructions} onChange={(event) => setDispenseForm({ ...dispenseForm, instructions: event.target.value })} /></label>
        {dispensePatient && <PatientAllergyAlert patient={dispensePatient} />}
        <label className="pharmacy-allergy-confirm"><input type="checkbox" required checked={dispenseForm.allergy_reviewed} onChange={(event) => setDispenseForm({ ...dispenseForm, allergy_reviewed: event.target.checked })} /><span><strong>Revisão de alergias do paciente</strong><small>Confirme que consultou o status e os detalhes cadastrais antes de dispensar.</small></span></label>
        <div className="pharmacy-dispensation-safety" role="note"><AlertTriangle size={19} /><div><strong>Importante: o registro não substitui a conferência assistencial.</strong><p>Esta tela documenta a dispensação informada. Não substitui validação da prescrição, conferência farmacêutica, avaliação de alergias, protocolo institucional ou registro de administração pela Enfermagem. Confira paciente, medicamento, apresentação, quantidade, unidade e lote antes de concluir.</p></div></div>
        <button className="button button-primary pharmacy-dispensation-submit" type="submit" disabled={dispensing || !patients.length}>{dispensing ? 'Registrando…' : 'Registrar dispensação'} <ArrowRight size={16} /></button>
      </form>
      <p className="field-hint">O registro salvo preserva a referência da prescrição, o lote e quem realizou a dispensação.</p>
      {!!dispensations.length && <div className="pharmacy-dispensation-list"><h3>Dispensações aguardando registro da Enfermagem</h3>{dispensations.map((item) => <article key={item.id}><strong>{patients.find((patient) => patient.reference === item.patient_reference)?.name ?? 'Paciente vinculado'} · {item.medication_name}</strong><span>{item.quantity} {item.unit} · prescrição {item.prescription_reference} · {dateTime(item.created_at)}</span></article>)}</div>}
    </section>
    {showForm && <form className="pharmacy-form" onSubmit={(event) => void submit(event)}><div className="section-heading"><div><p className="eyebrow">ENTRADA DE ESTOQUE</p><h2>Produto, lote e armazenamento</h2></div></div>    <div className="field-grid field-grid-two"><label className="field"><span className="field-label">Código de barras / GTIN</span><input inputMode="numeric" autoComplete="off" maxLength={40} value={form.barcode} onChange={(event) => setForm({ ...form, barcode: event.target.value.slice(0, 40) })} onFocus={prepareBarcodeAudio} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); if (form.barcode.trim()) { prepareBarcodeAudio(); playBarcodeTone(audioContextRef.current); setNotice(`Código recebido: ${form.barcode.trim()}`) } } }} placeholder="Leia com o leitor USB ou digite" /><span className="field-hint">Leitores USB enviam o código como teclado; ao concluir, o sistema confirma com um som. A câmera também funciona em celulares com HTTPS.</span></label>    <div className="field pharmacy-scan-field"><span className="field-label">Leitura pela câmera</span><button className="button button-secondary" type="button" onClick={() => { prepareBarcodeAudio(); setCameraScannerMessage(''); setCameraScannerOpen((open) => !open) }}><Camera size={16} /> {cameraScannerOpen ? 'Fechar câmera' : 'Ler código pela câmera'}</button>{cameraScannerOpen && <><video ref={barcodeVideoRef} className="pharmacy-scanner-video" autoPlay muted playsInline aria-label="Câmera para leitura do código de barras" /><span className="field-hint" role="status">{cameraScannerMessage || barcodeCameraUnavailable || 'Aponte a câmera para o código de barras.'}</span></>}</div><label className="field"><span className="field-label">Nome do produto</span><input required minLength={1} maxLength={120} value={form.item_name} onChange={(event) => setForm({ ...form, item_name: event.target.value })} placeholder="Nome do item ou medicamento" /></label><label className="field"><span className="field-label">Categoria</span><select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option>Medicamento</option><option>Material hospitalar</option><option>Material de consumo</option><option>Higiene e limpeza</option><option>Outro</option></select></label><label className="field"><span className="field-label">Princípio ativo</span><input maxLength={120} value={form.active_ingredient} onChange={(event) => setForm({ ...form, active_ingredient: event.target.value })} placeholder="Ex.: dipirona sódica" /></label><label className="field"><span className="field-label">Apresentação / concentração</span><input maxLength={120} value={form.presentation} onChange={(event) => setForm({ ...form, presentation: event.target.value })} placeholder="Ex.: comprimido 500 mg, solução 20 mg/mL" /></label><label className="field"><span className="field-label">Quantidade recebida</span><input required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,3})?" maxLength={32} value={form.balance} onChange={(event) => setForm({ ...form, balance: event.target.value })} placeholder="Ex.: 24" /></label><label className="field"><span className="field-label">Unidade de medida</span><input required maxLength={24} list="pharmacy-units" value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} placeholder="Ex.: caixa, frasco, unidade" /><datalist id="pharmacy-units"><option value="unidade" /><option value="caixa" /><option value="frasco" /><option value="ampola" /><option value="pacote" /><option value="mL" /><option value="mg" /></datalist></label><label className="field"><span className="field-label">Estoque mínimo</span><input inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,3})?" maxLength={32} value={form.minimum_balance} onChange={(event) => setForm({ ...form, minimum_balance: event.target.value })} /><span className="field-hint">O painel alerta quando o saldo atingir este limite.</span></label><label className="field"><span className="field-label">Lote</span><input required maxLength={80} value={form.lot} onChange={(event) => setForm({ ...form, lot: event.target.value })} /></label><label className="field"><span className="field-label">Validade</span><input required type="date" value={form.expiry_date} onChange={(event) => setForm({ ...form, expiry_date: event.target.value })} /></label><label className="field"><span className="field-label">Fornecedor</span><input maxLength={120} value={form.supplier} onChange={(event) => setForm({ ...form, supplier: event.target.value })} /></label><label className="field"><span className="field-label">Local de armazenamento</span><input maxLength={80} value={form.storage_location} onChange={(event) => setForm({ ...form, storage_location: event.target.value })} placeholder="Ex.: armário 2, prateleira B" /></label></div><div className="pharmacy-form-actions"><button className="button button-secondary" type="button" onClick={() => { setShowForm(false); setCameraScannerOpen(false) }} disabled={saving}>Cancelar</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Cadastrar lote'} <ArrowRight size={16} /></button></div></form>}
    <section className="pharmacy-inventory"><div className="section-heading"><div><p className="eyebrow">INVENTÁRIO</p><h2>Itens cadastrados</h2></div><button className="button button-secondary" type="button" onClick={() => void loadItems()} disabled={loading}>{loading ? 'Atualizando…' : 'Atualizar'}</button></div><label className="field pharmacy-search"><span className="field-label">Buscar item, princípio ativo, lote ou localização</span><span className="search-input-wrap"><Search size={17} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Digite nome, código de barras ou lote" /></span></label>
      {loading ? <div className="history-empty">Carregando estoque…</div> : filteredItems.length ? <div className="pharmacy-item-grid">{filteredItems.map((item) => { const expired = item.expiry_date < today; const expiring = !expired && item.expiry_date <= soon; const low = Number(item.minimum_balance.replace(',', '.')) > 0 && Number(item.balance.replace(',', '.')) <= Number(item.minimum_balance.replace(',', '.')); return <article className="pharmacy-item-card" key={item.id}><div className="pharmacy-item-heading"><span className="pharmacy-item-icon"><Package size={18} /></span><span className={`pharmacy-expiry ${expired ? 'pharmacy-expired' : expiring || low ? 'pharmacy-expiring' : ''}`}>{expired ? <AlertTriangle size={14} /> : expiring || low ? <AlertTriangle size={14} /> : <CalendarDays size={14} />}{expired ? 'Vencido' : expiring ? 'Vence em breve' : low ? 'Abaixo do mínimo' : 'Dentro da validade'}</span></div><h3>{item.item_name}</h3><p className="pharmacy-item-description">{item.category}{item.active_ingredient ? ` · ${item.active_ingredient}` : ''}{item.presentation ? ` · ${item.presentation}` : ''}</p><div className="pharmacy-stock"><strong>{item.balance}</strong><span>{item.unit}{low ? ` · mínimo ${item.minimum_balance}` : ''}</span></div><div className="pharmacy-item-meta"><span><small>Código</small><strong>{item.barcode || 'Não informado'}</strong></span><span><small>Lote</small><strong>{item.lot}</strong></span><span><small>Validade</small><strong>{new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${item.expiry_date}T00:00:00Z`))}</strong></span><span><small>Armazenamento</small><strong>{item.storage_location || 'Não informado'}</strong></span>{item.supplier && <span><small>Fornecedor</small><strong>{item.supplier}</strong></span>}</div><button className="button button-secondary pharmacy-movement-toggle" type="button" onClick={() => { setMovementItemId(movementItemId === item.id ? null : item.id); setMovementForm({ movement_type: 'entry', quantity: '', reason: '' }) }}>{movementItemId === item.id ? 'Cancelar' : 'Movimentar estoque'}</button>{movementItemId === item.id && <form className="pharmacy-stock-movement-form" onSubmit={(event) => void submitMovement(event, item)}><label className="field"><span className="field-label">Operação</span><select value={movementForm.movement_type} onChange={(event) => setMovementForm({ ...movementForm, movement_type: event.target.value as typeof movementForm.movement_type })}><option value="entry">Entrada</option><option value="issue">Saída / dispensação</option><option value="adjustment">Ajuste de inventário</option></select></label><label className="field"><span className="field-label">Quantidade {movementForm.movement_type === 'adjustment' ? '(negativa para reduzir)' : ''}</span><input required type="text" inputMode="decimal" pattern="-?[0-9]+([.,][0-9]{1,3})?" maxLength={32} value={movementForm.quantity} onChange={(event) => setMovementForm({ ...movementForm, quantity: event.target.value })} placeholder="Ex.: 5 ou -2" /></label><label className="field"><span className="field-label">Motivo da movimentação</span><input required minLength={3} maxLength={500} value={movementForm.reason} onChange={(event) => setMovementForm({ ...movementForm, reason: event.target.value })} placeholder="Ex.: dispensação, recebimento da nota fiscal" /></label><button className="button button-primary" type="submit" disabled={movementSaving}>{movementSaving ? 'Salvando…' : 'Registrar movimentação'}</button></form>}</article> })}</div> : <div className="history-empty"><Package size={20} /><span>{query || stockFilter !== 'all' ? 'Nenhum lote corresponde à busca ou ao filtro selecionado.' : 'Nenhum lote cadastrado.'}</span></div>}
      <section className="pharmacy-movement-ledger"><div className="section-heading"><div><p className="eyebrow">RASTREABILIDADE DO ESTOQUE</p><h3>Movimentações recentes <span className="module-total">{movementTotal}</span></h3><p className="welcome-copy">Cada linha registra quantidade, saldo após a operação, responsável e motivo.</p></div><button className="button button-secondary" type="button" onClick={() => void loadItems(movementOffset)} disabled={loading}>Atualizar histórico</button></div>{movements.length ? <><div className="pharmacy-movement-list">{movements.map((movement) => { const item = items.find((candidate) => candidate.id === movement.item_id); const labels = { opening_balance: 'Saldo inicial legado', entry: 'Entrada', issue: 'Saída', adjustment: 'Ajuste' }; return <article className="pharmacy-movement-row" key={movement.id}><div><strong>{item ? `${item.item_name} · Lote ${item.lot}` : `Item #${movement.item_id}`}</strong><small>{labels[movement.movement_type]} · {dateTime(movement.created_at)}</small><small>{movement.reason}</small></div><div className="pharmacy-movement-values"><span>{movement.quantity} {item?.unit ?? ''}</span><small>Saldo: {movement.balance_after} {item?.unit ?? ''}</small></div><small className="pharmacy-movement-author">{movement.actor_name}</small></article> })}</div><div className="pharmacy-ledger-pagination"><span>{movementTotal ? `${movementOffset + 1}–${Math.min(movementOffset + movements.length, movementTotal)} de ${movementTotal}` : '0 registros'}</span><div><button className="button button-secondary" type="button" disabled={loading || movementOffset === 0} onClick={() => void loadItems(Math.max(0, movementOffset - 25))}>Anterior</button><button className="button button-secondary" type="button" disabled={loading || movementOffset + movements.length >= movementTotal} onClick={() => void loadItems(movementOffset + 25)}>Próxima</button></div></div></> : <div className="history-empty">Nenhuma movimentação registrada.</div>}</section>
    </section>
    <PrintSelectionPanel title="Relatório de estoque por lote" rows={pharmacyPrintRows} />
  </section>
}

type StockLevel = 'critical' | 'attention' | 'healthy' | 'unconfigured'

function stockLevel(item: PharmacyItem): StockLevel {
  const balance = Number(item.balance.replace(',', '.'))
  const minimum = Number(item.minimum_balance.replace(',', '.'))
  const average = Number((item.average_balance || '0').replace(',', '.'))
  if (Number.isFinite(minimum) && balance <= minimum) return 'critical'
  if (!Number.isFinite(average) || average <= 0) return 'unconfigured'
  if (balance <= average) return 'attention'
  return 'healthy'
}

function PharmacyStockOverview({ items, counts, onSaved }: { items: PharmacyItem[]; counts: Record<StockLevel, number>; onSaved: (item: PharmacyItem) => void }) {
  const [editing, setEditing] = useState<number | null>(null)
  const [minimum, setMinimum] = useState('0')
  const [average, setAverage] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const label: Record<StockLevel, string> = { critical: 'Crítico', attention: 'Atenção', healthy: 'Adequado', unconfigured: 'Defina a meta' }
  const rows = [...items].sort((a, b) => {
    const order: Record<StockLevel, number> = { critical: 0, attention: 1, unconfigured: 2, healthy: 3 }
    return order[stockLevel(a)] - order[stockLevel(b)] || a.item_name.localeCompare(b.item_name, 'pt-BR')
  })
  async function save(item: PharmacyItem) {
    setSaving(true); setMessage('')
    try {
      const response = await fetch(`/api/v1/pharmacy/items/${item.id}/stock-thresholds`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ minimum_balance: minimum.replace(',', '.'), average_balance: average.replace(',', '.') }) })
      const data = await readApiResponse<PharmacyItem>(response)
      onSaved(data); setEditing(null); setMessage(`Metas atualizadas para ${item.item_name}.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Falha ao salvar metas.') }
    finally { setSaving(false) }
  }
  return <section className="pharmacy-stock-overview" aria-label="Níveis do estoque">
    <div className="pharmacy-stock-levels" aria-label="Resumo dos níveis de estoque">
      {(['critical', 'attention', 'healthy', 'unconfigured'] as StockLevel[]).map((level) => <div className={`pharmacy-level-count level-${level}`} key={level}><span className="pharmacy-level-dot" /><strong>{counts[level]}</strong><span>lotes</span><small>{label[level]}</small></div>)}
    </div>
    <details className="pharmacy-stock-details"><summary>Ver níveis e configurar metas por lote</summary>
      <p>Crítico: saldo no mínimo ou abaixo. Atenção: saldo entre o mínimo e a meta média. Adequado: acima da meta média. Defina a meta média para ativar o acompanhamento do lote.</p>
      {message && <div className="form-message form-message-success" role="status">{message}</div>}
      <div className="pharmacy-stock-level-list">{rows.map((item) => { const level = stockLevel(item); const isEditing = editing === item.id; return <article className="pharmacy-stock-level-row" key={item.id}><div className="pharmacy-stock-level-name"><span className={`pharmacy-level-dot level-${level}`} /><div><strong>{item.item_name}</strong><small>Lote {item.lot} · Saldo {item.balance} {item.unit}</small></div></div><span className={`pharmacy-stock-badge level-${level}`}>{label[level]}</span>{isEditing ? <div className="pharmacy-threshold-editor"><label className="field"><span className="field-label">Mínimo</span><input inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,3})?" value={minimum} onChange={(event) => setMinimum(event.target.value)} /></label><label className="field"><span className="field-label">Meta média</span><input required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,3})?" value={average} onChange={(event) => setAverage(event.target.value)} /></label><button className="button button-primary" type="button" disabled={saving || !average} onClick={() => void save(item)}>{saving ? 'Salvando…' : 'Salvar metas'}</button><button className="button button-secondary" type="button" disabled={saving} onClick={() => setEditing(null)}>Cancelar</button></div> : <button className="button button-secondary pharmacy-threshold-button" type="button" onClick={() => { setEditing(item.id); setMinimum(item.minimum_balance || '0'); setAverage(item.average_balance && Number(item.average_balance) > 0 ? item.average_balance : '') }}>Configurar</button>}</article> })}</div>
    </details>
  </section>
}


export default PharmacyPage
