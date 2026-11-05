import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { AlertTriangle, ArrowRight, BookOpen, Camera, CalendarDays, ClipboardList, Package, Pill, Printer, Search, X } from 'lucide-react'
import { readApiResponse, readableApiError } from '../api'
import PatientSelect from '../components/PatientSelect'
import { usePersistentTab } from '../components/PageNavigationContext'
import ModuleTabNavigation from '../components/ModuleTabNavigation'
import ToastMessage from '../components/ToastMessage'
import PrintSelectionPanel from '../components/PrintSelectionPanel'
import type { PrintRow } from '../printReport'
import { formatDecimalInput } from '../inputFormatting'

type Patient = { reference: string; name: string; room: string; bed: string; allergies?: string; allergies_status?: 'unknown' | 'none_known' | 'known' }
type AuthUser = { id: string; username: string; name: string; role: string; modules: string[]; permissions: Record<string, string[]> }
type PackagingLevel = { unit: string; units_per_parent: string }
type PharmacyItem = { id: number; product_id: number; item_name: string; balance: string; unit: string; purchase_quantity: string; purchase_unit: string; units_per_purchase_unit: string; packaging_levels: PackagingLevel[]; product_packaging_unit: string; product_packaging_levels: PackagingLevel[]; lot: string; expiry_date: string; created_at: string; barcode: string; category: string; active_ingredient: string; presentation: string; supplier: string; storage_location: string; minimum_balance: string; average_balance: string }
type AnvisaCatalogSuggestion = { gtin: string; product_name: string; active_ingredient: string; presentation: string; manufacturer: string; registration: string }
type AnvisaCatalogStatus = { source: string; source_url: string; entry_count: number; imported_at: string | null; source_updated_at: string | null; automatic_enabled?: boolean; automatic_run_time?: string; automatic_timezone?: string; automatic_last_attempt_at?: string | null; automatic_last_success_at?: string | null; automatic_last_entry_count?: number; automatic_last_error?: string }
type PharmacyBarcodeLookup = { gtin: string; lot: string | null; expiry_date: string | null; serial: string | null; matches: PharmacyItem[]; catalog_suggestions: AnvisaCatalogSuggestion[]; catalog_imported_at: string | null }
type PharmacyMovement = { id: number; item_id: number; movement_type: 'opening_balance' | 'entry' | 'issue' | 'adjustment'; quantity: string; balance_after: string; reason: string; actor_name: string; created_at: string }
type MedicationDispensation = { id: string; patient_reference: string; item_id: number; medication_name: string; quantity: string; unit: string; instructions: string; prescription_reference: string; prescriber_name: string; allergy_reviewed: boolean; prescription_fulfillment_pending?: boolean; status: 'dispensed' | 'cancelled'; actor_name: string; created_at: string }
type InternalPrescription = { id: string; patient_reference: string; medication_name: string; active_ingredient: string; presentation: string; dose: string; route: string; frequency: string; administration_times: string[]; duration: string; quantity: string; unit: string; instructions: string; is_controlled: boolean; prescriber_name: string; crm: string; crm_state: string; status: 'pending' | 'fulfilled' | 'cancelled'; created_at: string }
type PurchaseRequest = { id: string; product_id: number | null; item_name: string; category: string; active_ingredient: string; presentation: string; base_unit: string; purchase_quantity: string; purchase_unit: string; units_per_purchase_unit: string; packaging_levels: PackagingLevel[]; received_quantity: string; supplier: string; quoted_unit_price: string; justification: string; status: 'requested' | 'quoted' | 'approved' | 'ordered' | 'received' | 'rejected'; requested_by: string; approved_by: string; received_by: string; created_at: string; updated_at: string }
type StockLevel = 'critical' | 'attention' | 'healthy' | 'unconfigured'
type StockFilter = 'all' | 'expired' | 'expiring' | 'critical' | 'attention'
type MovementReportFilters = {
  from_date: string
  to_date: string
  item_id: string
  movement_type: '' | PharmacyMovement['movement_type']
}
type PharmacyProductStock = {
  product_id: number
  item_name: string
  active_ingredient: string
  presentation: string
  category: string
  unit: string
  available_balance: number
  minimum_balance: string
  average_balance: string
  lots: PharmacyItem[]
}

function matchesStockFilter(item: PharmacyItem, filter: StockFilter, today: string, soon: string, level: StockLevel) {
  return filter === 'all'
    || (filter === 'expired' && item.expiry_date < today)
    || (filter === 'expiring' && item.expiry_date >= today && item.expiry_date <= soon)
    || (filter === 'critical' && level === 'critical')
    || (filter === 'attention' && level === 'attention')
}

function stockLevel(balance: number, minimumValue: string, averageValue: string): StockLevel {
  const minimum = Number(minimumValue.replace(',', '.'))
  const average = Number((averageValue || '0').replace(',', '.'))
  if (!Number.isFinite(minimum) || !Number.isFinite(average) || average <= 0) return 'unconfigured'
  if (balance <= minimum) return 'critical'
  if (balance <= average) return 'attention'
  return 'healthy'
}

function patientLocationLabel(patient: Pick<Patient, 'room' | 'bed'>) {
  return patient.room.trim() && patient.bed.trim() ? `Quarto ${patient.room} · leito ${patient.bed}` : 'Sem quarto/leito atribuído'
}

function prescriptionMatchesLot(prescription: InternalPrescription | undefined, item: PharmacyItem | undefined): boolean {
  if (!prescription || !item) return false
  const normalize = (value: string) => value.trim().toLocaleLowerCase('pt-BR')
  return normalize(prescription.medication_name) === normalize(item.item_name)
    && normalize(prescription.unit) === normalize(item.unit)
    && normalize(prescription.presentation) === normalize(item.presentation)
    && normalize(prescription.active_ingredient) === normalize(item.active_ingredient)
}

function packagingLevelsForBase(levels: PackagingLevel[], baseUnit: string): PackagingLevel[] {
  const resolved = levels.length
    ? levels.map((level) => ({ ...level }))
    : [{ unit: baseUnit, units_per_parent: '1' }]
  resolved[resolved.length - 1].unit = baseUnit
  return resolved
}

function packagingFactor(levels: PackagingLevel[]): number {
  return levels.reduce((factor, level) => factor * Number(level.units_per_parent.replace(',', '.')), 1)
}

function packagingFormula(quantity: string, purchaseUnit: string, levels: PackagingLevel[], baseUnit: string): string {
  if (!quantity.trim() || !purchaseUnit.trim() || !baseUnit.trim()) return 'Complete a quantidade, a embalagem recebida e a unidade base para visualizar o cálculo.'
  const amount = Number(quantity.replace(',', '.'))
  const factor = packagingFactor(levels)
  if (!Number.isFinite(amount) || !Number.isFinite(factor) || factor <= 0 || !levels.length) return 'Complete a quantidade e os níveis de embalagem para visualizar o cálculo.'
  const steps = levels.map((level, index) => {
    const parentUnit = index === 0 ? purchaseUnit : levels[index - 1].unit
    return `× ${level.units_per_parent || '0'} ${level.unit || 'unidade'} por ${parentUnit || 'embalagem anterior'}`
  })
  const result = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(amount * factor)
  return `${quantity || '0'} ${purchaseUnit || 'embalagem'} ${steps.join(' ')} = ${result} ${baseUnit || 'unidade base'}`
}

function PackagingConversionEditor({
  purchaseUnit,
  baseUnit,
  receivedQuantity,
  levels,
  onChange,
}: {
  purchaseUnit: string
  baseUnit: string
  receivedQuantity: string
  levels: PackagingLevel[]
  onChange: (levels: PackagingLevel[]) => void
}) {
  const resolvedLevels = packagingLevelsForBase(levels, baseUnit)
  return <section className="pharmacy-packaging-editor" aria-label="Conversão das embalagens para a unidade base">
    <div><strong>Como as embalagens viram saldo de estoque</strong><span>Informe cada embalagem interna e quantas unidades dela cabem na embalagem anterior. A última etapa sempre termina na unidade base.</span></div>
    <details>
      <summary>Configurar embalagens (opcional para unidades únicas)</summary>
      <div className="pharmacy-packaging-steps">
    {resolvedLevels.map((level, index) => {
      const isBaseUnit = index === resolvedLevels.length - 1
      const parentUnit = index === 0 ? purchaseUnit : resolvedLevels[index - 1].unit
      return <div className="pharmacy-packaging-step" key={`packaging-step-${index}`}>
        {!isBaseUnit && <label className="field"><span className="field-label">Nome da embalagem interna {index + 1}</span><input required maxLength={24} value={level.unit} onChange={(event) => onChange(resolvedLevels.map((entry, entryIndex) => entryIndex === index ? { ...entry, unit: event.target.value } : entry))} placeholder="Ex.: caixa" /></label>}
        {isBaseUnit && <div className="pharmacy-packaging-base"><span className="field-label">Unidade base do estoque</span><strong>{baseUnit || 'Informe a unidade base abaixo'}</strong></div>}
        <label className="field"><span className="field-label">Quantas {level.unit || (isBaseUnit ? 'unidades base' : 'embalagens')} há em cada {parentUnit || 'unidade anterior'}?</span><input required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,3})?" maxLength={32} value={level.units_per_parent} onChange={(event) => onChange(resolvedLevels.map((entry, entryIndex) => entryIndex === index ? { ...entry, units_per_parent: formatDecimalInput(event.target.value) } : entry))} /></label>
        {!isBaseUnit && <button className="button button-secondary pharmacy-packaging-remove" type="button" aria-label={`Remover nível ${level.unit || index + 1}`} onClick={() => onChange(resolvedLevels.filter((_, entryIndex) => entryIndex !== index))}>Remover nível</button>}
      </div>
    })}
    {resolvedLevels.length < 5 && <button className="button button-secondary" type="button" onClick={() => onChange([...resolvedLevels.slice(0, -1), { unit: '', units_per_parent: '1' }, resolvedLevels[resolvedLevels.length - 1]])}>Adicionar nível de embalagem</button>}
      </div>
    </details>
    <div className="pharmacy-packaging-formula" aria-live="polite"><span>Conferência da conta</span><strong>{packagingFormula(receivedQuantity, purchaseUnit, resolvedLevels, baseUnit)}</strong></div>
  </section>
}

const pharmacyTabs = ['stock', 'inventory', 'dispensation', 'prescriptions', 'reports', 'purchases', 'guide'] as const
const pharmacyTabLabels: Record<(typeof pharmacyTabs)[number], string> = {
  stock: 'Movimentações',
  inventory: 'Estoque geral A–Z',
  dispensation: 'Dispensação',
  prescriptions: 'Prescrições médicas',
  reports: 'Relatórios',
  purchases: 'Compras e suprimentos',
  guide: 'Como funciona',
}
const movementTypeLabels: Record<PharmacyMovement['movement_type'], string> = {
  opening_balance: 'Saldo inicial legado',
  entry: 'Entrada',
  issue: 'Saída',
  adjustment: 'Ajuste',
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

function PharmacyPage({ user, mobileMode = false }: { user: AuthUser; mobileMode?: boolean }) {
  const canManagePurchases = (user.modules.includes('pharmacy') && Boolean(user.permissions.pharmacy?.includes('criar') || user.permissions.pharmacy?.includes('alterar'))) || (user.modules.includes('management') && Boolean(user.permissions.management?.includes('consultar')))
  const canReadMovementReports = !mobileMode && user.modules.includes('pharmacy')
  const availablePharmacyTabs = pharmacyTabs.filter((tab) =>
    (tab !== 'purchases' || (!mobileMode && canManagePurchases))
      && (tab !== 'reports' || canReadMovementReports),
  )
  const [pharmacyTab, setPharmacyTab] = usePersistentTab(`scpo-tab-pharmacy${mobileMode ? '-mobile' : ''}-${user.id}`, 'stock', availablePharmacyTabs, pharmacyTabLabels)
  const [items, setItems] = useState<PharmacyItem[]>([])
  const [patients, setPatients] = useState<Patient[]>([])
  const [dispensations, setDispensations] = useState<MedicationDispensation[]>([])
  const [prescriptions, setPrescriptions] = useState<InternalPrescription[]>([])
  const [dispenseForm, setDispenseForm] = useState({ patient_reference: '', item_id: '', quantity: '', instructions: '', prescription_reference: '', prescriber_name: '', allergy_reviewed: false })
  const [dispensing, setDispensing] = useState(false)
  const [movements, setMovements] = useState<PharmacyMovement[]>([])
  const [movementTotal, setMovementTotal] = useState(0)
  const [movementOffset, setMovementOffset] = useState(0)
  const [movementItemId, setMovementItemId] = useState<number | null>(null)
  const [reportStockQuery, setReportStockQuery] = useState('')
  const [reportCategory, setReportCategory] = useState('all')
  const [reportStockFilter, setReportStockFilter] = useState<StockFilter>('all')
  const [movementReportFilters, setMovementReportFilters] = useState<MovementReportFilters>({
    from_date: '',
    to_date: '',
    item_id: '',
    movement_type: '',
  })
  const [appliedMovementReportFilters, setAppliedMovementReportFilters] = useState<MovementReportFilters>({
    from_date: '',
    to_date: '',
    item_id: '',
    movement_type: '',
  })
  const [reportMovements, setReportMovements] = useState<PharmacyMovement[]>([])
  const [movementReportTotal, setMovementReportTotal] = useState(0)
  const [movementReportOffset, setMovementReportOffset] = useState(0)
  const [movementReportLoading, setMovementReportLoading] = useState(true)
  const [movementReportError, setMovementReportError] = useState('')
  const [movementForm, setMovementFormState] = useState({ movement_type: 'entry' as 'entry' | 'issue' | 'adjustment', quantity: '', reason: '' })
  const setMovementForm = (value: { movement_type: 'entry' | 'issue' | 'adjustment'; quantity: string; reason: string }) =>
    setMovementFormState({ ...value, quantity: formatDecimalInput(value.quantity) })
  const [movementSaving, setMovementSaving] = useState(false)
  const [form, setForm] = useState({ item_name: '', barcode: '', category: 'Medicamento', active_ingredient: '', presentation: '', catalog_registration: '', pharmacy_registration_confirmed: false, purchase_quantity: '', purchase_unit: 'unidade', packaging_levels: [] as PackagingLevel[], unit: 'unidade', lot: '', expiry_date: '', supplier: '', storage_location: '' })
  const [labelItem, setLabelItem] = useState<PharmacyItem | null>(null)
  const [labelWidth, setLabelWidth] = useState('50')
  const [labelHeight, setLabelHeight] = useState('30')
  const [labelCount, setLabelCount] = useState('1')
  const [query, setQuery] = useState('')
  const [stockFilter, setStockFilter] = useState<'all' | 'expired' | 'expiring' | 'critical' | 'attention'>('all')
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [cameraScannerOpen, setCameraScannerOpen] = useState(false)
  const [cameraScannerMessage, setCameraScannerMessage] = useState('')
  const [catalogSuggestions, setCatalogSuggestions] = useState<AnvisaCatalogSuggestion[]>([])
  const [catalogStatus, setCatalogStatus] = useState<AnvisaCatalogStatus | null>(null)
  const [catalogRefreshing, setCatalogRefreshing] = useState(false)
  const [catalogStatusError, setCatalogStatusError] = useState('')
  const barcodeVideoRef = useRef<HTMLVideoElement>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const lastBarcodeLookupRef = useRef('')
  const barcodeProductAutofillRef = useRef(false)
  const barcodeLookupVersionRef = useRef(0)

  const lookupBarcode = useCallback(async (code: string) => {
    const requestVersion = ++barcodeLookupVersionRef.current
    lastBarcodeLookupRef.current = code
    setError('')
    setNotice('Consultando GTIN no cadastro local…')
    setCatalogSuggestions([])
    try {
      const result = await readApiResponse<PharmacyBarcodeLookup>(
        await fetch(`/api/v1/pharmacy/items/lookup?code=${encodeURIComponent(code)}`),
      )
      if (requestVersion !== barcodeLookupVersionRef.current) return
      lastBarcodeLookupRef.current = result.gtin
      setCatalogSuggestions(result.catalog_suggestions)
      const clearOldAutofill = !result.matches[0] && barcodeProductAutofillRef.current
      setForm((current) => ({
        ...current,
        barcode: result.gtin,
        catalog_registration: '',
        pharmacy_registration_confirmed: false,
        ...(clearOldAutofill && current.barcode.trim() !== result.gtin ? {
          item_name: '',
          category: 'Medicamento',
          active_ingredient: '',
          presentation: '',
          unit: '',
          packaging_levels: [],
        } : {}),
        ...(result.matches[0] ? {
          item_name: result.matches[0].item_name,
          category: result.matches[0].category,
          active_ingredient: result.matches[0].active_ingredient,
          presentation: result.matches[0].presentation,
          purchase_unit: result.matches[0].product_packaging_unit,
          unit: result.matches[0].unit,
          packaging_levels: packagingLevelsForBase(result.matches[0].product_packaging_levels, result.matches[0].unit),
          catalog_registration: '',
        } : {}),
        ...(result.lot ? { lot: result.lot } : {}),
        ...(result.expiry_date ? { expiry_date: result.expiry_date } : {}),
      }))
      barcodeProductAutofillRef.current = Boolean(result.matches[0])
      const parsedDetails = [
        result.lot ? `lote lido ${result.lot}` : '',
        result.expiry_date ? `validade ${result.expiry_date}` : '',
        result.serial ? `série ${result.serial} (não rastreada no cadastro atual)` : '',
      ].filter(Boolean).join(' · ')
      const productMatches = result.matches.slice(0, 5).map((item) =>
        `${item.item_name}${item.active_ingredient ? ` · ${item.active_ingredient}` : ''}${item.presentation ? ` · ${item.presentation}` : ''} · lote ${item.lot} · validade ${item.expiry_date} · saldo ${item.balance} ${item.unit}${item.storage_location ? ` · ${item.storage_location}` : ''}`,
      )
      const moreMatches = result.matches.length > productMatches.length
        ? `; e mais ${result.matches.length - productMatches.length} lote(s)`
        : ''
      const catalogNote = result.catalog_suggestions.length
        ? ` Há ${result.catalog_suggestions.length} sugestão(ões) Anvisa disponível(is) para conferência.`
        : ''
      setNotice(result.matches.length
        ? `GTIN ${result.gtin} encontrado: ${productMatches.join('; ')}${moreMatches}${parsedDetails ? ` · ${parsedDetails}` : ''}. A leitura não alterou o estoque.${catalogNote}`
        : `GTIN ${result.gtin} não encontrado no cadastro local${parsedDetails ? ` · ${parsedDetails}` : ''}. Confira uma sugestão Anvisa ou complete os dados manualmente; nenhuma movimentação foi registrada.${catalogNote}`)
    } catch (lookupError) {
      if (requestVersion === barcodeLookupVersionRef.current) {
        setError(lookupError instanceof Error ? lookupError.message : 'Não foi possível consultar o GTIN.')
      }
    }
  }, [])

  useEffect(() => {
    let current = true
    fetch('/api/v1/pharmacy/catalog/anvisa/status')
      .then(readApiResponse<AnvisaCatalogStatus>)
      .then((status) => { if (current) { setCatalogStatus(status); setCatalogStatusError('') } })
      .catch((statusError: unknown) => {
        if (current) setCatalogStatusError(statusError instanceof Error ? statusError.message : 'Não foi possível consultar o catálogo Anvisa.')
      })
    return () => { current = false }
  }, [user.id])

  async function refreshAnvisaCatalog() {
    setCatalogRefreshing(true)
    setCatalogStatusError('')
    try {
      const response = await fetch('/api/v1/pharmacy/catalog/anvisa/refresh', { method: 'POST' })
      const status = await readApiResponse<AnvisaCatalogStatus>(response)
      setCatalogStatus(status)
      setNotice(`Catálogo público Anvisa/CMED atualizado: ${status.entry_count} registros GTIN disponíveis. As sugestões precisam ser conferidas antes do cadastro.`)
      if (form.barcode.trim()) void lookupBarcode(form.barcode.trim())
    } catch (refreshError) {
      setCatalogStatusError(refreshError instanceof Error ? refreshError.message : 'Não foi possível atualizar o catálogo Anvisa.')
    } finally {
      setCatalogRefreshing(false)
    }
  }

  function applyAnvisaSuggestion(suggestion: AnvisaCatalogSuggestion) {
    barcodeProductAutofillRef.current = true
    setForm((current) => ({
      ...current,
      barcode: suggestion.gtin,
      pharmacy_registration_confirmed: false,
      item_name: suggestion.product_name,
      category: 'Medicamento',
      active_ingredient: suggestion.active_ingredient,
      presentation: suggestion.presentation,
      catalog_registration: suggestion.registration,
      purchase_unit: '',
      unit: '',
      packaging_levels: [],
    }))
    setNotice('Sugestão Anvisa aplicada ao rascunho. Confira produto, apresentação, unidade, lote e validade antes de cadastrar.')
  }

  function changeBarcode(code: string) {
    const replaceAutofilledProduct = barcodeProductAutofillRef.current
      && form.barcode.trim() === lastBarcodeLookupRef.current
      && form.barcode.trim() !== code.trim()
    if (replaceAutofilledProduct) barcodeProductAutofillRef.current = false
    setCatalogSuggestions([])
    setForm((current) => ({
      ...current,
      barcode: code,
      catalog_registration: '',
      pharmacy_registration_confirmed: false,
      ...(replaceAutofilledProduct ? {
        item_name: '',
        category: 'Medicamento',
        active_ingredient: '',
        presentation: '',
        unit: '',
        packaging_levels: [],
      } : {}),
    }))
  }

  useEffect(() => {
    const code = form.barcode.trim()
    const requestVersion = ++barcodeLookupVersionRef.current
    if (code.length < 8 || code === lastBarcodeLookupRef.current) return
    setNotice('')
    setError('')
    const timeout = window.setTimeout(() => {
      if (requestVersion === barcodeLookupVersionRef.current) void lookupBarcode(code)
    }, 500)
    return () => window.clearTimeout(timeout)
  }, [form.barcode, lookupBarcode])

  useEffect(() => {
    if (!cameraScannerOpen) return
    let cancelled = false
    let stream: MediaStream | undefined
    let controls: { stop: () => void } | undefined
    let timer = 0
    let scanning = false
    let detectedCode = ''
    const Detector = (window as Window & { BarcodeDetector?: { new (options?: { formats: string[] }): { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> }; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector
    const getSupportedFormats = Detector?.getSupportedFormats?.bind(Detector)
    if (!navigator.mediaDevices?.getUserMedia) {
      return () => { cancelled = true }
    }
    const videoElement = barcodeVideoRef.current
    if (!videoElement) return

    function acceptBarcode(code: string) {
      if (cancelled || code === detectedCode) return
      detectedCode = code
      setCameraScannerMessage(`Código lido: ${code}`)
      playBarcodeTone(audioContextRef.current)
      void lookupBarcode(code)
      setCameraScannerOpen(false)
    }

    function startZXingScanner() {
      void import('@zxing/browser').then(({ BrowserMultiFormatReader }) => {
        if (cancelled) return
        const reader = new BrowserMultiFormatReader()
        return reader.decodeFromVideoDevice(undefined, videoElement ?? undefined, (result) => {
          const code = result?.getText().trim()
          if (code) acceptBarcode(code)
        })
      }).then((scannerControls) => {
        if (!scannerControls) return
        controls = scannerControls
        if (cancelled) scannerControls.stop()
      }).catch(() => {
        if (!cancelled) setCameraScannerMessage('Não foi possível iniciar a leitura por câmera. Verifique a permissão ou use o leitor USB.')
      })
    }

    if (!Detector || !getSupportedFormats) {
      startZXingScanner()
      return () => {
        cancelled = true
        controls?.stop()
        videoElement.srcObject = null
      }
    }

    const requestedFormats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'data_matrix', 'qr_code']
    void getSupportedFormats().then((supportedFormats) => {
      if (cancelled) return
      const formats = requestedFormats.filter((format) => supportedFormats.includes(format))
      if (!formats.includes('qr_code')) {
        startZXingScanner()
        return
      }
      const detector = new Detector({ formats })
      return navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }).then(async (mediaStream) => {
        stream = mediaStream
        if (cancelled) { mediaStream.getTracks().forEach((track) => track.stop()); return }
        videoElement.srcObject = mediaStream
        await videoElement.play()
        timer = window.setInterval(async () => {
          if (scanning || cancelled || videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
          scanning = true
          try {
            const results = await detector.detect(videoElement)
            const code = results[0]?.rawValue?.trim()
            if (code) acceptBarcode(code)
          } catch {
            if (!cancelled) setCameraScannerMessage('Não foi possível ler esse código. Ajuste a distância ou digite o identificador.')
          }
          finally { scanning = false }
        }, 300)
      })
    }).catch(() => {
      if (cancelled) return
      stream?.getTracks().forEach((track) => track.stop())
      stream = undefined
      videoElement.srcObject = null
      startZXingScanner()
    })
    return () => {
      cancelled = true
      window.clearInterval(timer)
      stream?.getTracks().forEach((track) => track.stop())
      controls?.stop()
      if (videoElement) videoElement.srcObject = null
    }
  }, [cameraScannerOpen, lookupBarcode])

  useEffect(() => {
    if (!cameraScannerOpen) return
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setCameraScannerOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
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
    if (!canReadMovementReports || pharmacyTab !== 'reports') return
    let active = true
    const params = new URLSearchParams({ limit: '100', offset: String(movementReportOffset) })
    if (appliedMovementReportFilters.from_date) params.set('from_date', appliedMovementReportFilters.from_date)
    if (appliedMovementReportFilters.to_date) params.set('to_date', appliedMovementReportFilters.to_date)
    if (appliedMovementReportFilters.item_id) params.set('item_id', appliedMovementReportFilters.item_id)
    if (appliedMovementReportFilters.movement_type) params.set('movement_type', appliedMovementReportFilters.movement_type)
    const loadMovementReport = async () => {
      try {
        const result = await readApiResponse<{ movements?: PharmacyMovement[]; total?: number }>(
          await fetch(`/api/v1/pharmacy/movements?${params.toString()}`),
        )
        if (!active) return
        setReportMovements(result.movements ?? [])
        setMovementReportTotal(result.total ?? 0)
      } catch (loadError) {
        if (!active) return
        setReportMovements([])
        setMovementReportTotal(0)
        setMovementReportError(loadError instanceof Error ? loadError.message : 'Falha ao carregar o relatório de movimentações.')
      } finally {
        if (active) setMovementReportLoading(false)
      }
    }
    void loadMovementReport()
    return () => { active = false }
  }, [appliedMovementReportFilters, canReadMovementReports, movementReportOffset, pharmacyTab])

  useEffect(() => {
    let current = true
    const loadRelatedData = async () => {
      try {
        const [patientResponse, dispenseResponse, prescriptionResponse] = await Promise.all([
          fetch('/api/v1/nursing/patients'),
          fetch('/api/v1/pharmacy/dispensations?status=dispensed'),
          fetch('/api/v1/physicians/prescriptions?status=pending'),
        ])
        const [patientData, dispenseData, prescriptionData] = await Promise.all([
          readApiResponse<{ patients?: Patient[] }>(patientResponse),
          readApiResponse<{ dispensations?: MedicationDispensation[] }>(dispenseResponse),
          readApiResponse<{ prescriptions?: InternalPrescription[] }>(prescriptionResponse),
        ])
        if (!current) return
        setPatients(patientData.patients ?? [])
        setDispensations(dispenseData.dispensations ?? [])
        setPrescriptions(prescriptionData.prescriptions ?? [])
      } catch (loadError) {
        if (current) setError(readableApiError(loadError))
      }
    }

    void loadRelatedData()
    return () => { current = false }
  }, [user.id])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true); setError(''); setNotice('')
    try {
      const levels = packagingLevelsForBase(form.packaging_levels, form.unit.trim())
      const conversion = packagingFactor(levels)
      const response = await fetch('/api/v1/pharmacy/items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, item_name: form.item_name.trim(), balance: null, purchase_quantity: form.purchase_quantity.replace(',', '.'), purchase_unit: form.purchase_unit.trim(), packaging_levels: levels.map((level) => ({ ...level, units_per_parent: level.units_per_parent.replace(',', '.') })), units_per_purchase_unit: String(conversion), unit: form.unit.trim(), lot: form.lot.trim() }) })
      const data = await readApiResponse<PharmacyItem>(response)
      setItems((current) => [...current, data].sort((a, b) => a.item_name.localeCompare(b.item_name, 'pt-BR')))
      setForm({ item_name: '', barcode: '', category: 'Medicamento', active_ingredient: '', presentation: '', catalog_registration: '', pharmacy_registration_confirmed: false, purchase_quantity: '', purchase_unit: 'unidade', packaging_levels: [], unit: 'unidade', lot: '', expiry_date: '', supplier: '', storage_location: '' })
      lastBarcodeLookupRef.current = ''
      barcodeProductAutofillRef.current = false
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
      setDispensations((current) => [data, ...current.filter((item) => item.id !== data.id)])
      setDispenseForm({ patient_reference: '', item_id: '', quantity: '', instructions: '', prescription_reference: '', prescriber_name: '', allergy_reviewed: false })
      if (!data.prescription_fulfillment_pending) {
        setPrescriptions((current) => current.filter((prescription) => prescription.id !== data.prescription_reference))
        setNotice('Dispensação registrada, prescrição atendida, paciente vinculado e lote debitado.')
      } else {
        setError('A dispensação e a baixa do lote foram registradas, mas não foi possível atualizar o status da prescrição. Selecione novamente a mesma prescrição para concluir a sincronização; uma nova baixa de estoque não será feita.')
      }
      await loadItems(0)
    } catch (dispenseError) {
      setError(`${readableApiError(dispenseError)} Se a conexão caiu durante o envio, confira a fila antes de repetir; o servidor reutiliza a dispensação já registrada para a mesma prescrição.`)
    } finally { setDispensing(false) }
  }

  const dispensePatient = patients.find((patient) => patient.reference === dispenseForm.patient_reference)
  const selectedDispenseLot = items.find((item) => String(item.id) === dispenseForm.item_id)
  const selectedDispensePrescription = prescriptions.find(
    (prescription) => prescription.id === dispenseForm.prescription_reference,
  )
  const prescriptionMatchesSelectedLot = prescriptionMatchesLot(
    selectedDispensePrescription,
    selectedDispenseLot,
  )

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
  const soonDate = new Date(`${today}T12:00:00`)
  soonDate.setDate(soonDate.getDate() + 30)
  const soon = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(soonDate)
  const expiredCount = items.filter((item) => item.expiry_date < today).length
  const expiringCount = items.filter((item) => item.expiry_date >= today && item.expiry_date <= soon).length
  const productStocks = Array.from(
    items.reduce((grouped, item) => {
      const group = grouped.get(item.product_id) ?? {
        product_id: item.product_id,
        item_name: item.item_name,
        active_ingredient: item.active_ingredient,
        presentation: item.presentation,
        category: item.category,
        unit: item.unit,
        available_balance: 0,
        minimum_balance: item.minimum_balance,
        average_balance: item.average_balance,
        lots: [] as PharmacyItem[],
      }
      if (item.expiry_date >= today) {
        const balance = Number(item.balance.replace(',', '.'))
        group.available_balance += Number.isFinite(balance) ? balance : 0
      }
      group.lots.push(item)
      grouped.set(item.product_id, group)
      return grouped
    }, new Map<number, PharmacyProductStock>()).values(),
  ).sort((a, b) => a.item_name.localeCompare(b.item_name, 'pt-BR'))
  const productLevelById = new Map(productStocks.map((product) => [
    product.product_id,
    stockLevel(product.available_balance, product.minimum_balance, product.average_balance),
  ]))
  const stockLevelCounts = productStocks.reduce<Record<StockLevel, number>>((counts, product) => {
    const level = productLevelById.get(product.product_id) ?? 'unconfigured'
    counts[level] += 1
    return counts
  }, { critical: 0, attention: 0, healthy: 0, unconfigured: 0 })
  const criticalCount = stockLevelCounts.critical
  const attentionCount = stockLevelCounts.attention
  const normalCount = stockLevelCounts.healthy
  const unconfiguredCount = stockLevelCounts.unconfigured
  const eligibleMedicationLots = items
    .filter((item) => item.category.toLocaleLowerCase('pt-BR') === 'medicamento' && item.expiry_date >= today && Number(item.balance.replace(',', '.')) > 0)
    .sort((a, b) => a.product_id - b.product_id || a.expiry_date.localeCompare(b.expiry_date) || a.id - b.id)
  const suggestedFefoLotIds = new Set<number>()
  const suggestedProducts = new Set<number>()
  eligibleMedicationLots.forEach((item) => {
    if (suggestedProducts.has(item.product_id)) return
    suggestedProducts.add(item.product_id)
    suggestedFefoLotIds.add(item.id)
  })
  const filteredItems = items.filter((item) => {
    const matchesSearch = `${item.item_name} ${item.lot} ${item.barcode} ${item.category} ${item.active_ingredient} ${item.presentation} ${item.storage_location}`.toLocaleLowerCase('pt-BR').includes(query.trim().toLocaleLowerCase('pt-BR'))
    const level = productLevelById.get(item.product_id) ?? 'unconfigured'
    const matchesFilter = matchesStockFilter(item, stockFilter, today, soon, level)
    return matchesSearch && matchesFilter
  }).sort((a, b) => a.expiry_date.localeCompare(b.expiry_date) || a.item_name.localeCompare(b.item_name, 'pt-BR'))
  const reportCategories = [...new Set(items.map((item) => item.category))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const reportStockItems = items.filter((item) => {
    const searchText = `${item.item_name} ${item.lot} ${item.barcode} ${item.category} ${item.active_ingredient} ${item.presentation} ${item.storage_location} ${item.supplier}`.toLocaleLowerCase('pt-BR')
    const matchesSearch = searchText.includes(reportStockQuery.trim().toLocaleLowerCase('pt-BR'))
    const matchesCategory = reportCategory === 'all' || item.category === reportCategory
    const level = productLevelById.get(item.product_id) ?? 'unconfigured'
    return matchesSearch && matchesCategory && matchesStockFilter(item, reportStockFilter, today, soon, level)
  }).sort((a, b) => a.expiry_date.localeCompare(b.expiry_date) || a.item_name.localeCompare(b.item_name, 'pt-BR'))
  const alphabeticMedicationStock = productStocks.filter((item) =>
    item.category.toLocaleLowerCase('pt-BR') === 'medicamento',
  )
  const visibleAlphabeticMedicationStock = alphabeticMedicationStock.filter((item) =>
    `${item.item_name} ${item.active_ingredient} ${item.presentation} ${item.lots.map((lot) => `${lot.lot} ${lot.storage_location}`).join(' ')}`
      .toLocaleLowerCase('pt-BR').includes(query.trim().toLocaleLowerCase('pt-BR')),
  )
  const visibleProductStock = productStocks.filter((product) =>
    `${product.item_name} ${product.active_ingredient} ${product.presentation} ${product.category} ${product.lots.map((lot) => `${lot.lot} ${lot.storage_location}`).join(' ')}`
      .toLocaleLowerCase('pt-BR').includes(query.trim().toLocaleLowerCase('pt-BR')),
  )
  const pharmacyPrintRows: PrintRow[] = reportStockItems.map((item) => ({ id: String(item.id), date: item.created_at, title: item.item_name, fields: [['Categoria', item.category], ['Princípio ativo', item.active_ingredient], ['Apresentação', item.presentation], ['Saldo', `${item.balance} ${item.unit}`], ['Entrada original', packagingFormula(item.purchase_quantity, item.purchase_unit, item.packaging_levels, item.unit)], ['Lote', item.lot], ['Validade', item.expiry_date], ['Código de barras', item.barcode], ['Localização', item.storage_location], ['Fornecedor', item.supplier]] }))
  const movementReportPrintRows: PrintRow[] = reportMovements.map((movement) => {
    const item = items.find((candidate) => candidate.id === movement.item_id)
    return {
      id: String(movement.id),
      date: movement.created_at,
      title: item ? `${item.item_name} · Lote ${item.lot}` : `Item #${movement.item_id}`,
      fields: [
        ['Tipo', movementTypeLabels[movement.movement_type]],
        ['Quantidade', `${movement.quantity} ${item?.unit ?? ''}`],
        ['Saldo após a operação', `${movement.balance_after} ${item?.unit ?? ''}`],
        ['Motivo', movement.reason],
        ['Responsável', movement.actor_name],
      ],
    }
  })
  const conversionLevels = packagingLevelsForBase(form.packaging_levels, form.unit)
  const requestedPackages = Number(form.purchase_quantity.replace(',', '.'))
  const unitsPerPackage = packagingFactor(conversionLevels)
  const convertedBalance = requestedPackages * unitsPerPackage
  const labelWidthValue = Number(labelWidth)
  const labelHeightValue = Number(labelHeight)
  const labelCountValue = Number(labelCount)
  const canPrintLabels = Number.isFinite(labelWidthValue) && labelWidthValue >= 10 && labelWidthValue <= 200
    && Number.isFinite(labelHeightValue) && labelHeightValue >= 10 && labelHeightValue <= 200
    && Number.isInteger(labelCountValue) && labelCountValue >= 1 && labelCountValue <= 500

  function printLabels() {
    if (!labelItem || !canPrintLabels) return
    const printStyle = document.createElement('style')
    printStyle.textContent = `@page { size: ${labelWidthValue}mm ${labelHeightValue}mm; margin: 0; }`
    document.head.append(printStyle)
    document.body.classList.add('print-pharmacy-labels')
    let fallbackTimer = 0
    const finishPrint = () => {
      window.clearTimeout(fallbackTimer)
      document.body.classList.remove('print-pharmacy-labels')
      printStyle.remove()
      window.removeEventListener('afterprint', finishPrint)
    }
    window.addEventListener('afterprint', finishPrint)
    fallbackTimer = window.setTimeout(finishPrint, 60_000)
    window.print()
  }

  return <section className={`pharmacy-page page-enter${mobileMode ? ' pharmacy-page-mobile' : ''}`}>
    <div className="page-title-row"><span className="module-icon module-icon-pharmacy"><Pill size={23} /></span><div><p className="eyebrow">{mobileMode ? 'MÓDULO MÓVEL · FARMÁCIA' : 'MÓDULO · FARMÁCIA'}</p><h1>{pharmacyTab === 'stock' ? 'Estoque e validade' : pharmacyTab === 'inventory' ? 'Estoque geral de medicamentos' : pharmacyTab === 'purchases' ? 'Compras e suprimentos' : pharmacyTab === 'prescriptions' ? 'Prescrições médicas' : pharmacyTab === 'reports' ? 'Relatórios da Farmácia' : pharmacyTab === 'guide' ? 'Como funcionam as unidades e os medicamentos' : 'Dispensação'}</h1><p className="welcome-copy">{pharmacyTab === 'stock' ? 'Consulte saldos e validades; use a câmera para agilizar a busca de produtos.' : pharmacyTab === 'inventory' ? 'Lista alfabética dos medicamentos cadastrados e seus saldos por lote.' : pharmacyTab === 'purchases' ? 'Solicite, cote, aprove, acompanhe pedidos e registre recebimentos por lote.' : pharmacyTab === 'prescriptions' ? 'Prescrições internas pendentes, prontas para conferência e dispensação.' : pharmacyTab === 'reports' ? 'Filtre o estoque e o histórico de movimentações para consulta e impressão.' : pharmacyTab === 'guide' ? 'Entenda a conta do estoque e a diferença entre embalagem, dispensação, prescrição e administração.' : 'Registre e acompanhe a dispensação de medicamentos para pacientes.'}</p></div>{!mobileMode && <a className="button button-secondary" href="/pharmacy.html" target="_blank" rel="noreferrer">Abrir Farmácia no celular</a>}{(pharmacyTab === 'stock' || pharmacyTab === 'inventory') && <button className="button button-primary" type="button" onClick={() => { setPharmacyTab('stock'); setShowForm((current) => !current); setNotice(''); setError('') }}><Package size={16} /> {showForm ? 'Fechar cadastro' : 'Cadastrar lote'}</button>}</div>
    <ModuleTabNavigation
      className="pharmacy-tabs"
      ariaLabel="Seções da Farmácia"
      alwaysShowButtons
      value={pharmacyTab}
      onChange={(tab) => {
        setPharmacyTab(tab)
        if (tab === 'reports') {
          setMovementReportLoading(true)
          setMovementReportError('')
        }
      }}
      options={availablePharmacyTabs.map((value) => ({
        value,
        label: pharmacyTabLabels[value],
        content: value === 'stock' || value === 'inventory'
          ? <><Package size={16} /> {pharmacyTabLabels[value]}</>
          : value === 'prescriptions'
            ? <><ArrowRight size={16} /> {pharmacyTabLabels[value]} <span>{prescriptions.length}</span></>
            : value === 'reports'
              ? <><ClipboardList size={16} /> {pharmacyTabLabels[value]}</>
            : value === 'purchases'
              ? <><Package size={16} /> {pharmacyTabLabels[value]}</>
              : value === 'guide'
                ? <><BookOpen size={16} /> {pharmacyTabLabels[value]}</>
              : <><ArrowRight size={16} /> {pharmacyTabLabels[value]}</>,
      }))}
    />
    {notice && <ToastMessage variant="success">{notice}</ToastMessage>}{error && <ToastMessage variant="error">{error}</ToastMessage>}
    {pharmacyTab === 'stock' && <>
    <div className={`hygiene-summary${loading ? ' is-loading' : ''}`} role="group" aria-label="Resumo de lotes e validade" aria-busy={loading}>
      <article className="status-tone-neutral"><span>Itens e lotes</span><strong>{items.length}</strong><small>Registros cadastrados</small></article>
      <article className={expiringCount ? 'status-tone-warning' : items.length ? 'status-tone-success' : 'status-tone-neutral'}><span>Vencem em até 30 dias</span><strong>{expiringCount}</strong><small>Acompanhe as datas</small></article>
      <article className={expiredCount ? 'status-tone-critical' : items.length ? 'status-tone-success' : 'status-tone-neutral'}><span>Vencidos</span><strong>{expiredCount}</strong><small>Verifique o lote</small></article>
    </div>
    <div className="hygiene-summary" role="group" aria-label="Níveis de estoque por produto">
      <article className={normalCount ? 'status-tone-success' : 'status-tone-neutral'}><span>Normal</span><strong>{normalCount}</strong><small>Acima da meta média</small></article>
      <article className={attentionCount ? 'status-tone-warning' : productStocks.length ? 'status-tone-success' : 'status-tone-neutral'}><span>Atenção</span><strong>{attentionCount}</strong><small>Acima do mínimo até a meta média</small></article>
      <article className={criticalCount ? 'status-tone-critical' : productStocks.length ? 'status-tone-success' : 'status-tone-neutral'}><span>Estoque crítico</span><strong>{criticalCount}</strong><small>No mínimo ou abaixo</small></article>
      <article className={unconfiguredCount ? 'status-tone-neutral' : productStocks.length ? 'status-tone-success' : 'status-tone-neutral'}><span>Metas pendentes</span><strong>{unconfiguredCount}</strong><small>Configure mínimo e meta média</small></article>
    </div>
    <div className="pharmacy-quick-filters" role="group" aria-label="Filtrar estoque">
      {([
        ['all', 'Todos', items.length],
        ['critical', 'Estoque crítico', criticalCount],
        ['attention', 'Atenção', attentionCount],
        ['expired', 'Vencidos', expiredCount],
        ['expiring', 'Vencem em 30 dias', expiringCount],
      ] as const).map(([value, label, count]) => <button className={`button ${stockFilter === value ? 'button-primary' : 'button-secondary'}`} type="button" key={value} aria-pressed={stockFilter === value} onClick={() => setStockFilter(value)}>{label}<span>{count}</span></button>)}
    </div>
    </>}
    {pharmacyTab === 'inventory' && <section className="patient-list-panel pharmacy-alphabetic-inventory">
      <div className="section-heading"><div><p className="eyebrow">CATÁLOGO COM SALDO</p><h2>Medicamentos cadastrados por ordem alfabética</h2><p className="welcome-copy">Cada medicamento aparece uma vez; o saldo total e os lotes são consolidados por produto.</p></div><span className="module-total">{visibleAlphabeticMedicationStock.length} medicamento(s)</span></div>
      <label className="field"><span className="field-label">Buscar medicamento, princípio ativo, apresentação ou lote</span><span className="search-input-wrap"><Search size={17} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Digite para localizar no estoque" /></span></label>
      {loading ? <div className="history-empty">Carregando estoque…</div> : visibleAlphabeticMedicationStock.length ? <div className="pharmacy-alphabetic-list">{visibleAlphabeticMedicationStock.map((item) => <article className="pharmacy-alphabetic-item" key={item.product_id}><div className="pharmacy-alphabetic-heading"><div><h3>{item.item_name}</h3><p>{item.active_ingredient || 'Princípio ativo não informado'}{item.presentation ? ` · ${item.presentation}` : ''}</p></div><strong>{item.available_balance.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} {item.unit}</strong></div><div className="pharmacy-alphabetic-lots">{[...item.lots].sort((a, b) => a.expiry_date.localeCompare(b.expiry_date, 'pt-BR') || a.lot.localeCompare(b.lot, 'pt-BR')).map((lot) => <span key={lot.id}>Lote {lot.lot || '—'} · {lot.balance} {lot.unit} · validade {new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${lot.expiry_date}T12:00:00Z`))}{lot.storage_location ? ` · ${lot.storage_location}` : ''}</span>)}</div></article>)}</div> : <div className="history-empty"><Package size={20} /><span>{items.some((item) => item.category.toLocaleLowerCase('pt-BR') === 'medicamento') ? 'Nenhum medicamento corresponde à busca.' : 'Nenhum medicamento foi cadastrado no estoque.'}</span></div>}
      <PharmacyProductThresholds
        products={visibleProductStock}
        onSaved={(productId, updated) => setItems((current) => current.map((item) =>
          item.product_id === productId
            ? {
              ...item,
              minimum_balance: updated.minimum_balance,
              average_balance: updated.average_balance,
            }
            : item,
        ))}
      />
    </section>}
    {pharmacyTab === 'reports' && <section className="patient-list-panel pharmacy-reports">
      <div className="section-heading"><div><p className="eyebrow">CONSULTA E IMPRESSÃO</p><h2>Relatórios operacionais</h2><p className="welcome-copy">Os relatórios usam dados de estoque e movimentações já registrados; não incluem prescrições nem informações clínicas.</p></div></div>
      <section className="pharmacy-report-group">
        <div className="section-heading"><div><p className="eyebrow">POSIÇÃO ATUAL</p><h3>Estoque por lote</h3><p className="welcome-copy">Filtre por categoria, situação do saldo ou validade. As datas do painel de impressão se referem ao cadastro do lote.</p></div><span className="module-total">{reportStockItems.length} lote(s)</span></div>
        <div className="pharmacy-report-filters">
          <label className="field"><span className="field-label">Buscar produto, princípio ativo, lote ou localização</span><span className="search-input-wrap"><Search size={17} /><input type="search" value={reportStockQuery} onChange={(event) => setReportStockQuery(event.target.value)} placeholder="Digite para filtrar" /></span></label>
          <label className="field"><span className="field-label">Categoria</span><select value={reportCategory} onChange={(event) => setReportCategory(event.target.value)}><option value="all">Todas as categorias</option>{reportCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
          <label className="field"><span className="field-label">Estoque e validade</span><select value={reportStockFilter} onChange={(event) => setReportStockFilter(event.target.value as StockFilter)}><option value="all">Todos</option><option value="critical">Estoque crítico</option><option value="attention">Atenção</option><option value="expired">Vencidos</option><option value="expiring">Vencem em até 30 dias</option></select></label>
        </div>
        {loading ? <div className="history-empty">Carregando estoque…</div> : reportStockItems.length
          ? <PrintSelectionPanel title="Relatório de estoque por lote" rows={pharmacyPrintRows} />
          : <div className="history-empty">Nenhum lote corresponde aos filtros selecionados.</div>}
      </section>
      <section className="pharmacy-report-group">
        <div className="section-heading"><div><p className="eyebrow">RASTREABILIDADE</p><h3>Histórico de movimentações</h3><p className="welcome-copy">Filtre por período, operação ou lote. A impressão inclui somente os registros da página carregada (até 100 por página).</p></div><span className="module-total">{movementReportTotal} registro(s)</span></div>
        <form className="pharmacy-report-filters pharmacy-movement-report-filters" onSubmit={(event) => { event.preventDefault(); setMovementReportLoading(true); setMovementReportError(''); setMovementReportOffset(0); setAppliedMovementReportFilters({ ...movementReportFilters }) }}>
          <label className="field"><span className="field-label">De</span><input type="date" value={movementReportFilters.from_date} max={movementReportFilters.to_date || undefined} onChange={(event) => setMovementReportFilters((current) => ({ ...current, from_date: event.target.value }))} /></label>
          <label className="field"><span className="field-label">Até</span><input type="date" value={movementReportFilters.to_date} min={movementReportFilters.from_date || undefined} onChange={(event) => setMovementReportFilters((current) => ({ ...current, to_date: event.target.value }))} /></label>
          <label className="field"><span className="field-label">Produto e lote</span><select value={movementReportFilters.item_id} onChange={(event) => setMovementReportFilters((current) => ({ ...current, item_id: event.target.value }))}><option value="">Todos os lotes</option>{items.map((item) => <option key={item.id} value={item.id}>{item.item_name} · Lote {item.lot}</option>)}</select></label>
          <label className="field"><span className="field-label">Operação</span><select value={movementReportFilters.movement_type} onChange={(event) => setMovementReportFilters((current) => ({ ...current, movement_type: event.target.value as MovementReportFilters['movement_type'] }))}><option value="">Todas</option>{Object.entries(movementTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <div className="pharmacy-report-actions"><button className="button button-primary" type="submit">Aplicar filtros</button><button className="button button-secondary" type="button" onClick={() => { const emptyFilters: MovementReportFilters = { from_date: '', to_date: '', item_id: '', movement_type: '' }; setMovementReportLoading(true); setMovementReportError(''); setMovementReportFilters(emptyFilters); setMovementReportOffset(0); setAppliedMovementReportFilters(emptyFilters) }}>Limpar filtros</button></div>
        </form>
        {movementReportError && <ToastMessage variant="error">{movementReportError}</ToastMessage>}
        {movementReportLoading ? <div className="history-empty">Carregando movimentações…</div> : movementReportError
          ? null
          : movementReportTotal === 0
          ? <div className="history-empty">Nenhuma movimentação corresponde aos filtros selecionados.</div>
          : <>
            <div className="pharmacy-movement-list">{reportMovements.map((movement) => {
              const item = items.find((candidate) => candidate.id === movement.item_id)
              return <article className="pharmacy-movement-row" key={movement.id}>
                <div><strong>{item ? `${item.item_name} · Lote ${item.lot}` : `Item #${movement.item_id}`}</strong><small>{movementTypeLabels[movement.movement_type]} · {dateTime(movement.created_at)}</small><small>{movement.reason}</small></div>
                <div className="pharmacy-movement-values"><span>{movement.quantity} {item?.unit ?? ''}</span><small>Saldo: {movement.balance_after} {item?.unit ?? ''}</small></div>
                <small className="pharmacy-movement-author">{movement.actor_name}</small>
              </article>
            })}</div>
            <div className="pharmacy-ledger-pagination"><span>{movementReportOffset + 1}–{Math.min(movementReportOffset + reportMovements.length, movementReportTotal)} de {movementReportTotal} registros</span><div><button className="button button-secondary" type="button" disabled={movementReportLoading || movementReportOffset === 0} onClick={() => { setMovementReportLoading(true); setMovementReportOffset(Math.max(0, movementReportOffset - 100)) }}>Anterior</button><button className="button button-secondary" type="button" disabled={movementReportLoading || movementReportOffset + reportMovements.length >= movementReportTotal} onClick={() => { setMovementReportLoading(true); setMovementReportOffset(movementReportOffset + 100) }}>Próxima</button></div></div>
            <PrintSelectionPanel title="Relatório de movimentações de estoque — página exibida" rows={movementReportPrintRows} />
          </>}
      </section>
    </section>}
    {pharmacyTab === 'prescriptions' && <section className="patient-list-panel">
      <div className="section-heading"><div><p className="eyebrow">FILA DA FARMÁCIA</p><h2>Prescrições internas pendentes</h2><p className="welcome-copy">A prescrição só é marcada como atendida após registrar a dispensação e debitar o lote.</p></div><span className="module-total">{prescriptions.length} pendente(s)</span></div>
      {prescriptions.length ? <div className="patient-list">{prescriptions.map((prescription) => {
        const patient = patients.find((candidate) => candidate.reference === prescription.patient_reference)
        const matchingLot = eligibleMedicationLots.find((item) =>
          prescriptionMatchesLot(prescription, item),
        )
        return <article className="patient-list-row" key={prescription.id}>
          <div><strong>{prescription.medication_name}{prescription.presentation ? ` · ${prescription.presentation}` : ''}</strong><p>{patient?.name ?? 'Paciente não localizado'} · {patient ? patientLocationLabel(patient) : ''}</p><p>{prescription.dose} · {prescription.route} · {prescription.frequency} · {prescription.duration} · {prescription.quantity} {prescription.unit}</p>{prescription.administration_times.length > 0 && <p>Horários definidos pelo prescritor: {prescription.administration_times.join(' · ')}</p>}<small>{prescription.prescriber_name} · CRM {prescription.crm}/{prescription.crm_state}{prescription.is_controlled ? ' · medicamento controlado' : ''}</small>{prescription.instructions && <small>{prescription.instructions}</small>}</div>
          <button className="button button-primary" type="button" disabled={!patient} onClick={() => {
            setPharmacyTab('dispensation')
            setDispenseForm({
              patient_reference: prescription.patient_reference,
              item_id: matchingLot ? String(matchingLot.id) : '',
              quantity: matchingLot ? prescription.quantity : '',
              instructions: `${prescription.dose} · ${prescription.route} · ${prescription.frequency} · ${prescription.duration}${prescription.instructions ? ` · ${prescription.instructions}` : ''}`.slice(0, 500),
              prescription_reference: prescription.id,
              prescriber_name: prescription.prescriber_name,
              allergy_reviewed: false,
            })
            setNotice(matchingLot ? 'Confira dose, quantidade, lote e alergias antes de dispensar.' : 'Não há lote válido com medicamento, apresentação, princípio ativo e unidades exatamente iguais à prescrição. Confira os dados; a quantidade não foi convertida.')
            setError('')
          }}>Preparar dispensação</button>
        </article>
      })}</div> : <div className="history-empty">Não há prescrições pendentes no momento.</div>}
    </section>}
    {pharmacyTab === 'dispensation' && <section className="pharmacy-dispensation-panel">
      <div className="section-heading"><div><p className="eyebrow">SAÍDA ASSISTENCIAL</p><h2>Dispensar para paciente</h2><p className="welcome-copy">Registre a prescrição, confirme as alergias e selecione o lote dispensado. A Enfermagem receberá a quantidade e poderá registrar administrações parciais vinculadas à mesma dispensação.</p></div></div>
      <form className="field-grid field-grid-two" onSubmit={(event) => void submitDispensation(event)}>
        <PatientSelect label="Paciente" patients={patients} value={dispenseForm.patient_reference} onChange={(reference) => setDispenseForm({ ...dispenseForm, patient_reference: reference, prescription_reference: '', prescriber_name: '', instructions: '', allergy_reviewed: false })} required optionLabel={(patient) => `${patient.name} · ${patientLocationLabel(patient)}`} />
        <label className="field"><span className="field-label">Medicamento e lote</span><select required value={dispenseForm.item_id} onChange={(event) => {
          const nextLot = eligibleMedicationLots.find((candidate) => String(candidate.id) === event.target.value)
          const matches = prescriptionMatchesLot(selectedDispensePrescription, nextLot)
          setDispenseForm((current) => ({
            ...current,
            item_id: event.target.value,
            quantity: selectedDispensePrescription
              ? matches
                ? current.quantity || selectedDispensePrescription.quantity
                : ''
              : current.quantity,
          }))
        }}><option value="">Selecione lote válido</option>{eligibleMedicationLots.map((item) => <option key={item.id} value={item.id}>{item.item_name} · Lote {item.lot}{suggestedFefoLotIds.has(item.id) ? ' · sugestão FEFO' : ''} · saldo {item.balance} {item.unit}</option>)}</select><span className="field-hint">A sugestão FEFO indica o lote válido com vencimento mais próximo por produto; a seleção permanece manual e deve seguir a política da instituição.</span></label>
        <label className="field"><span className="field-label">Quantidade ({selectedDispenseLot?.unit || 'unidade do lote'})</span><input required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,3})?" maxLength={32} value={dispenseForm.quantity} onChange={(event) => setDispenseForm({ ...dispenseForm, quantity: formatDecimalInput(event.target.value) })} /><span className="field-hint">Informe a quantidade entregue nesta unidade. O total fica disponível para registro na Enfermagem; o sistema não converte a dose prescrita.</span></label>
        <label className="field"><span className="field-label">Prescrição pendente</span><select required value={dispenseForm.prescription_reference} onChange={(event) => {
          const prescription = prescriptions.find((item) => item.id === event.target.value)
          setDispenseForm((current) => ({
            ...current,
            prescription_reference: prescription?.id ?? '',
            patient_reference: prescription?.patient_reference ?? current.patient_reference,
            quantity: prescription && prescriptionMatchesLot(prescription, selectedDispenseLot)
              ? prescription.quantity
              : '',
            prescriber_name: prescription?.prescriber_name ?? '',
            instructions: prescription ? `${prescription.dose} · ${prescription.route} · ${prescription.frequency} · ${prescription.duration}${prescription.instructions ? ` · ${prescription.instructions}` : ''}`.slice(0, 500) : '',
            allergy_reviewed: false,
          }))
        }}><option value="">Selecione uma prescrição pendente</option>{prescriptions.filter((item) => item.patient_reference === dispenseForm.patient_reference || !dispenseForm.patient_reference).map((item) => <option key={item.id} value={item.id}>{item.medication_name} · {patients.find((patient) => patient.reference === item.patient_reference)?.name ?? 'Paciente'} · {item.prescriber_name}</option>)}</select></label>
        {selectedDispensePrescription && selectedDispenseLot && !prescriptionMatchesSelectedLot && <div className="pharmacy-dispensation-safety" role="alert"><AlertTriangle size={19} /><div><strong>Produto, apresentação ou unidade divergente; quantidade não preenchida automaticamente.</strong><p>Confira a prescrição ({selectedDispensePrescription.medication_name}{selectedDispensePrescription.presentation ? ` · ${selectedDispensePrescription.presentation}` : ''} · {selectedDispensePrescription.quantity} {selectedDispensePrescription.unit}) e o lote ({selectedDispenseLot.item_name}{selectedDispenseLot.presentation ? ` · ${selectedDispenseLot.presentation}` : ''} · unidade {selectedDispenseLot.unit}). A interface não presume equivalência nem converte dose clínica.</p></div></div>}
        <label className="field"><span className="field-label">Profissional prescritor</span><input required minLength={2} maxLength={120} value={dispenseForm.prescriber_name} readOnly /></label>
        <label className="field"><span className="field-label">Instruções para administração (conforme prescrição)</span><input maxLength={500} value={dispenseForm.instructions} onChange={(event) => setDispenseForm({ ...dispenseForm, instructions: event.target.value })} /></label>
        {dispensePatient && <PatientAllergyAlert patient={dispensePatient} />}
        <label className="pharmacy-allergy-confirm"><input type="checkbox" required checked={dispenseForm.allergy_reviewed} onChange={(event) => setDispenseForm({ ...dispenseForm, allergy_reviewed: event.target.checked })} /><span><strong>Revisão de alergias do paciente</strong><small>Confirme que consultou o status e os detalhes cadastrais antes de dispensar.</small></span></label>
        <div className="pharmacy-dispensation-safety" role="note"><AlertTriangle size={19} /><div><strong>Importante: o registro não substitui a conferência assistencial.</strong><p>Esta tela documenta a dispensação informada. Não substitui validação da prescrição, conferência farmacêutica, avaliação de alergias, protocolo institucional ou registro de administração pela Enfermagem. Confira paciente, medicamento, apresentação, quantidade, unidade e lote antes de concluir.</p></div></div>
        <button className="button button-primary pharmacy-dispensation-submit" type="submit" disabled={dispensing || !patients.length}>{dispensing ? 'Registrando…' : 'Registrar dispensação'} <ArrowRight size={16} /></button>
      </form>
      <p className="field-hint">O registro salvo preserva a referência da prescrição, o lote e quem realizou a dispensação.</p>
      {!!dispensations.length && <div className="pharmacy-dispensation-list"><h3>Dispensações aguardando registro da Enfermagem</h3>{dispensations.map((item) => <article key={item.id}><strong>{patients.find((patient) => patient.reference === item.patient_reference)?.name ?? 'Paciente vinculado'} · {item.medication_name}</strong><span>{item.quantity} {item.unit} · prescrição {item.prescription_reference} · {dateTime(item.created_at)}</span></article>)}</div>}
    </section>}
    {pharmacyTab === 'purchases' && canManagePurchases && <PurchaseRequestsPanel user={user} items={items} onReceived={() => void loadItems(0)} />}
    {pharmacyTab === 'guide' && <section className="patient-list-panel pharmacy-explanation" aria-labelledby="pharmacy-explanation-title">
      <div className="section-heading"><div><p className="eyebrow">GUIA DE REFERÊNCIA</p><h2 id="pharmacy-explanation-title">Como registrar o estoque da Farmácia</h2><p className="welcome-copy">A sequência funciona como uma planilha: produto, entrada, lote, validade e localização.</p></div></div>
      <article><h3>1. Cadastre o produto uma vez</h3><p>Informe o nome, categoria e apresentação/concentração. Use o princípio ativo como busca complementar. GTIN, QR e sugestão Anvisa ajudam a identificar, mas não completam automaticamente a quantidade recebida ou a validade.</p></article>
      <article><h3>2. Registre a entrada do lote</h3><p>Informe quantas embalagens chegaram e em qual unidade. Para itens sem embalagem interna, mantenha <strong>unidade</strong> na compra e na unidade base. O padrão já deixa esses dois campos prontos para uso.</p><div className="pharmacy-packaging-example"><strong>Exemplo com caixa de medicamentos</strong><span>10 caixas × 20 comprimidos por caixa = 200 comprimidos em estoque.</span><small>Saldo, lote, validade, movimentações e dispensações usam comprimidos.</small></div></article>
      <article><h3>3. Embalagem é um detalhe opcional</h3><p>Abra “Configurar embalagens” somente quando houver caixas, frascos ou níveis internos. O sistema multiplica os fatores na tela antes de salvar e preserva a conta no lote. Para unidades iguais, não é necessário adicionar nível.</p></article>
      <article><h3>4. Lote, validade e localização ficam separados do produto</h3><p>O mesmo produto pode ter vários lotes, validades e locais. O estoque geral consolida o produto; os lotes continuam individualizados. FEFO orienta visualmente para o vencimento mais próximo, sem escolher ou baixar estoque automaticamente.</p></article>
      <article><h3>5. Dispense e administre sem confundir unidade e dose</h3><ul><li><strong>Movimentação:</strong> lance entrada, saída ou ajuste na unidade base do lote.</li><li><strong>Prescrição:</strong> dose, via, frequência e horários são definidos pelo prescritor.</li><li><strong>Dispensação:</strong> confira paciente, produto, apresentação, unidade, quantidade e lote.</li><li><strong>Administração:</strong> a Enfermagem registra o que foi efetivamente administrado.</li></ul><p><strong>Embalagem não determina dose.</strong> Uma caixa com 20 comprimidos permite contar o estoque, mas não informa quantos miligramas serão administrados. Conversões clínicas exigem apresentação/concentração e regra institucional.</p></article>
    </section>}
    {pharmacyTab === 'stock' && <>
    {showForm && <form className="pharmacy-form" onSubmit={(event) => void submit(event)}>
      <div className="section-heading"><div><p className="eyebrow">ENTRADA DE ESTOQUE</p><h2>Produto, lote e armazenamento</h2><p className="welcome-copy">Mantenha saldo, movimentações, dispensações e administrações na mesma unidade de estoque.</p></div></div>
      <div className="pharmacy-catalog-panel">
        <div><strong>Catálogo público de medicamentos · Anvisa/CMED</strong><span>{catalogStatus ? `${catalogStatus.entry_count.toLocaleString('pt-BR')} sugestões disponíveis · última importação: ${catalogStatus.imported_at ? dateTime(catalogStatus.imported_at) : 'ainda não importado'}${catalogStatus.automatic_enabled ? ` · atualização automática: ${catalogStatus.automatic_run_time ?? '00:00'} (${catalogStatus.automatic_timezone ?? 'America/Sao_Paulo'})` : ' · atualização automática: desativada'}` : 'Consultando disponibilidade do catálogo…'}</span>{catalogStatus?.automatic_last_attempt_at && <small>{catalogStatus.automatic_last_error ? `Última tentativa automática: ${catalogStatus.automatic_last_error}` : `Última atualização automática: ${dateTime(catalogStatus.automatic_last_success_at ?? catalogStatus.automatic_last_attempt_at)} · ${catalogStatus.automatic_last_entry_count ?? 0} registros`}</small>}<a href={catalogStatus?.source_url ?? 'https://dados.anvisa.gov.br/dados/TA_PRECO_MEDICAMENTO.csv'} target="_blank" rel="noreferrer">Ver fonte pública</a></div>
        <button className="button button-secondary" type="button" onClick={() => void refreshAnvisaCatalog()} disabled={catalogRefreshing}>{catalogRefreshing ? 'Atualizando catálogo…' : 'Atualizar catálogo Anvisa'}</button>
        {catalogStatusError && <span className="pharmacy-catalog-error" role="alert">{catalogStatusError}</span>}
        <p className="field-hint">A atualização consulta a lista pública CMED. Os dados são sugestões de identificação, não confirmam registro ativo, autenticidade ou adequação clínica; confira e aprove cada dado antes de cadastrar.</p>
      </div>
      <div className="field-grid field-grid-two">
        <label className="field">
          <span className="field-label">Código de barras ou QR · GTIN/GS1</span>
          <input inputMode="numeric" autoComplete="off" maxLength={200} value={form.barcode} onChange={(event) => changeBarcode(event.target.value)} onFocus={prepareBarcodeAudio} onKeyDown={(event) => { if (event.key === 'Enter' && form.barcode.trim()) { event.preventDefault(); prepareBarcodeAudio(); playBarcodeTone(audioContextRef.current); void lookupBarcode(form.barcode.trim()) } }} placeholder="Leia com o leitor USB ou digite" />
          <span className="field-hint">O leitor USB consulta após a leitura; Enter consulta imediatamente. A câmera lê códigos de barras e QR com GTIN/GS1 reconhecido em celulares com HTTPS.</span>
        </label>
        <div className="field pharmacy-scan-field">
            <span className="field-label">Leitura e consulta do identificador</span>
            <button className="button button-secondary" type="button" onClick={() => { prepareBarcodeAudio(); setCameraScannerMessage(''); setCameraScannerOpen((open) => !open) }}><Camera size={16} /> {cameraScannerOpen ? 'Fechar câmera' : 'Ler código ou QR pela câmera'}</button>
          <button className="button button-secondary" type="button" disabled={!form.barcode.trim()} onClick={() => { prepareBarcodeAudio(); playBarcodeTone(audioContextRef.current); void lookupBarcode(form.barcode.trim()) }}><Search size={16} /> Consultar código</button>
        </div>
        {!!catalogSuggestions.length && <section className="pharmacy-catalog-suggestions" aria-label="Sugestões do catálogo Anvisa">
          <div><strong>Sugestões para conferência</strong><span>Escolha uma opção para preencher o rascunho; isso não cadastra o produto nem movimenta o estoque.</span></div>
          {catalogSuggestions.map((suggestion, index) => <article key={`${suggestion.gtin}-${suggestion.registration}-${suggestion.presentation}-${index}`}>
            <div><strong>{suggestion.product_name}</strong><span>{[suggestion.active_ingredient, suggestion.presentation].filter(Boolean).join(' · ') || 'Descrição complementar não disponível'}</span><small>{suggestion.manufacturer ? `Fabricante indicado pela fonte: ${suggestion.manufacturer}` : 'Fabricante não informado'}{suggestion.registration ? ` · Registro informado: ${suggestion.registration}` : ''}</small></div>
            <button className="button button-secondary" type="button" onClick={() => applyAnvisaSuggestion(suggestion)}>Usar no rascunho</button>
          </article>)}
        </section>}
        <label className="field"><span className="field-label">Nome do produto</span><input required minLength={1} maxLength={120} value={form.item_name} onChange={(event) => setForm({ ...form, item_name: event.target.value })} placeholder="Nome do item ou medicamento" /></label>
        <label className="field"><span className="field-label">Categoria</span><select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option>Medicamento</option><option>Material hospitalar</option><option>Material de consumo</option><option>Higiene e limpeza</option><option>Outro</option></select></label>
        <label className="field"><span className="field-label">Princípio ativo</span><input maxLength={120} value={form.active_ingredient} onChange={(event) => setForm({ ...form, active_ingredient: event.target.value })} placeholder="Ex.: dipirona sódica" /></label>
        <label className="field"><span className="field-label">Apresentação / concentração</span><input maxLength={120} value={form.presentation} onChange={(event) => setForm({ ...form, presentation: event.target.value })} placeholder="Ex.: comprimido 500 mg, solução 20 mg/mL" /></label>
        <label className="field"><span className="field-label">Registro informado pela fonte</span><input maxLength={32} value={form.catalog_registration} readOnly placeholder="Preenchido ao aplicar sugestão Anvisa" /><span className="field-hint">Referência informativa da sugestão; confirme os dados na fonte oficial.</span></label>
        <label className="field pharmacy-quantity-field"><span className="field-label">Quantidade de embalagens recebidas</span><input required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,3})?" maxLength={32} value={form.purchase_quantity} onChange={(event) => setForm({ ...form, purchase_quantity: formatDecimalInput(event.target.value) })} placeholder="Ex.: 10" /><span className="field-hint">Informe quantas embalagens deste lote foram recebidas.</span></label>
        <label className="field"><span className="field-label">Unidade de compra</span><input required maxLength={24} list="pharmacy-units" value={form.purchase_unit} onChange={(event) => setForm({ ...form, purchase_unit: event.target.value })} placeholder="Ex.: caixa" /><datalist id="pharmacy-units"><option value="unidade" /><option value="comprimido" /><option value="cápsula" /><option value="frasco" /><option value="ampola" /><option value="pacote" /><option value="mL" /><option value="mg" /><option value="caixa" /></datalist></label>
        <label className="field"><span className="field-label">Unidade base do estoque</span><input required maxLength={24} value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value, packaging_levels: packagingLevelsForBase(form.packaging_levels, event.target.value) })} placeholder="Ex.: comprimido, frasco, mL" /><span className="field-hint">É a unidade usada para registrar saldo, movimentações e dispensações. Ela não determina a dose prescrita.</span></label>
        <PackagingConversionEditor purchaseUnit={form.purchase_unit} baseUnit={form.unit} receivedQuantity={form.purchase_quantity} levels={form.packaging_levels} onChange={(packaging_levels) => setForm({ ...form, packaging_levels })} />
        <div className="pharmacy-opening-balance" aria-live="polite"><span>Saldo inicial calculado</span><strong>{Number.isFinite(convertedBalance) ? new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(convertedBalance) : '—'} {form.unit || 'unidade base'}</strong><small>Confira os fatores e as unidades; o servidor valida e registra a conversão no lote.</small></div>
        <label className="field"><span className="field-label">Lote</span><input required maxLength={80} value={form.lot} onChange={(event) => setForm({ ...form, lot: event.target.value })} /></label>
        <label className="field"><span className="field-label">Validade</span><input required type="date" value={form.expiry_date} onChange={(event) => setForm({ ...form, expiry_date: event.target.value })} /></label>
        <label className="field"><span className="field-label">Fornecedor</span><input maxLength={120} value={form.supplier} onChange={(event) => setForm({ ...form, supplier: event.target.value })} /></label>
        <label className="field"><span className="field-label">Local de armazenamento</span><input maxLength={80} value={form.storage_location} onChange={(event) => setForm({ ...form, storage_location: event.target.value })} placeholder="Ex.: armário 2, prateleira B" /></label>
        <label className="pharmacy-allergy-confirm">
          <input type="checkbox" required checked={form.pharmacy_registration_confirmed} onChange={(event) => setForm({ ...form, pharmacy_registration_confirmed: event.target.checked })} />
          <span><strong>Conferência responsável pela Farmácia</strong><small>Confirmo que conferi produto, princípio ativo, apresentação, unidade, embalagem, lote, validade, quantidade e dados do responsável antes de registrar.</small></span>
        </label>
      </div>
      <div className="pharmacy-form-actions"><button className="button button-secondary" type="button" onClick={() => { setShowForm(false); setCameraScannerOpen(false) }} disabled={saving}>Cancelar</button><button className="button button-primary" type="submit" disabled={saving || !form.pharmacy_registration_confirmed}>{saving ? 'Salvando…' : 'Cadastrar lote'} <ArrowRight size={16} /></button></div>
    </form>}
    <section className="pharmacy-inventory"><div className="section-heading"><div><p className="eyebrow">INVENTÁRIO</p><h2>Itens cadastrados</h2></div><button className="button button-secondary" type="button" onClick={() => void loadItems()} disabled={loading}>{loading ? 'Atualizando…' : 'Atualizar'}</button></div><label className="field pharmacy-search"><span className="field-label">Buscar item, princípio ativo, lote ou localização</span><span className="search-input-wrap"><Search size={17} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Digite nome, código de barras ou lote" /></span></label>
      {loading ? <div className="history-empty">Carregando estoque…</div> : filteredItems.length ? <div className="pharmacy-item-grid">{filteredItems.map((item) => {
        const expired = item.expiry_date < today
        const expiring = !expired && item.expiry_date <= soon
        const level = productLevelById.get(item.product_id) ?? 'unconfigured'
        const low = level === 'critical'
        const product = productStocks.find((candidate) => candidate.product_id === item.product_id)
        return <article className="pharmacy-item-card" key={item.id}>
          <div className="pharmacy-item-heading"><span className="pharmacy-item-icon"><Package size={18} /></span><span className={`pharmacy-expiry ${expired ? 'pharmacy-expired' : expiring || low ? 'pharmacy-expiring' : ''}`}>{expired || expiring || low ? <AlertTriangle size={14} /> : <CalendarDays size={14} />}{expired ? 'Vencido' : expiring ? 'Vence em breve' : low ? 'Estoque crítico' : 'Dentro da validade'}</span></div>
          <h3>{item.item_name}</h3>
          <p className="pharmacy-item-description">{item.category}{item.active_ingredient ? ` · ${item.active_ingredient}` : ''}{item.presentation ? ` · ${item.presentation}` : ''}</p>
          <div className="pharmacy-stock"><strong>{item.balance}</strong><span>{item.unit}{low && product ? ` · disponível no produto: ${product.available_balance.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${item.unit} (mínimo ${product.minimum_balance})` : ''}</span></div>
          <div className="pharmacy-item-meta"><span><small>Entrada · conta registrada</small><strong>{packagingFormula(item.purchase_quantity, item.purchase_unit, item.packaging_levels, item.unit)}</strong></span><span><small>Código</small><strong>{item.barcode || 'Não informado'}</strong></span><span><small>Lote</small><strong>{item.lot}</strong></span><span><small>Validade</small><strong>{new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${item.expiry_date}T00:00:00Z`))}</strong></span><span><small>Armazenamento</small><strong>{item.storage_location || 'Não informado'}</strong></span>{item.supplier && <span><small>Fornecedor</small><strong>{item.supplier}</strong></span>}</div>
          {!mobileMode && <button className="button button-secondary pharmacy-label-button" type="button" onClick={() => setLabelItem(item)}><Printer size={16} /> Imprimir etiquetas</button>}
          <button className="button button-secondary pharmacy-movement-toggle" type="button" onClick={() => { setMovementItemId(movementItemId === item.id ? null : item.id); setMovementForm({ movement_type: 'entry', quantity: '', reason: '' }) }}>{movementItemId === item.id ? 'Cancelar' : 'Movimentar estoque'}</button>
          {movementItemId === item.id && <form className="pharmacy-stock-movement-form" onSubmit={(event) => void submitMovement(event, item)}><label className="field"><span className="field-label">Operação</span><select value={movementForm.movement_type} onChange={(event) => setMovementForm({ ...movementForm, movement_type: event.target.value as typeof movementForm.movement_type })}><option value="entry">Entrada</option><option value="issue">Saída / dispensação</option><option value="adjustment">Ajuste de inventário</option></select></label><label className="field"><span className="field-label">Quantidade ({item.unit}) {movementForm.movement_type === 'adjustment' ? '(negativa para reduzir)' : ''}</span><input required type="text" inputMode="decimal" pattern="-?[0-9]+([.,][0-9]{1,3})?" maxLength={32} value={movementForm.quantity} onChange={(event) => setMovementForm({ ...movementForm, quantity: event.target.value })} placeholder="Ex.: 5 ou -2" /><span className="field-hint">Use a mesma unidade do saldo deste lote: {item.unit}.</span></label><label className="field"><span className="field-label">Motivo da movimentação</span><input required minLength={3} maxLength={500} value={movementForm.reason} onChange={(event) => setMovementForm({ ...movementForm, reason: event.target.value })} placeholder="Ex.: dispensação, recebimento da nota fiscal" /></label><button className="button button-primary" type="submit" disabled={movementSaving}>{movementSaving ? 'Salvando…' : 'Registrar movimentação'}</button></form>}
        </article>
      })}</div> : <div className="history-empty"><Package size={20} /><span>{query || stockFilter !== 'all' ? 'Nenhum lote corresponde à busca ou ao filtro selecionado.' : 'Nenhum lote cadastrado.'}</span></div>}
      <section className="pharmacy-movement-ledger"><div className="section-heading"><div><p className="eyebrow">RASTREABILIDADE DO ESTOQUE</p><h3>Movimentações recentes <span className="module-total">{movementTotal}</span></h3><p className="welcome-copy">Cada linha registra quantidade na unidade do lote, saldo após a operação, responsável e motivo.</p></div><button className="button button-secondary" type="button" onClick={() => void loadItems(movementOffset)} disabled={loading}>Atualizar histórico</button></div>{movements.length ? <><div className="pharmacy-movement-list">{movements.map((movement) => { const item = items.find((candidate) => candidate.id === movement.item_id); const labels = { opening_balance: 'Saldo inicial legado', entry: 'Entrada', issue: 'Saída', adjustment: 'Ajuste' }; return <article className="pharmacy-movement-row" key={movement.id}><div><strong>{item ? `${item.item_name} · Lote ${item.lot}` : `Item #${movement.item_id}`}</strong><small>{labels[movement.movement_type]} · {dateTime(movement.created_at)}</small><small>{movement.reason}</small></div><div className="pharmacy-movement-values"><span>{movement.quantity} {item?.unit ?? ''}</span><small>Saldo: {movement.balance_after} {item?.unit ?? ''}</small></div><small className="pharmacy-movement-author">{movement.actor_name}</small></article> })}</div><div className="pharmacy-ledger-pagination"><span>{movementTotal ? `${movementOffset + 1}–${Math.min(movementOffset + movements.length, movementTotal)} de ${movementTotal}` : '0 registros'}</span><div><button className="button button-secondary" type="button" disabled={loading || movementOffset === 0} onClick={() => void loadItems(Math.max(0, movementOffset - 25))}>Anterior</button><button className="button button-secondary" type="button" disabled={loading || movementOffset + movements.length >= movementTotal} onClick={() => void loadItems(movementOffset + 25)}>Próxima</button></div></div></> : <div className="history-empty">Nenhuma movimentação registrada.</div>}</section>
    </section>
    </>}
    {labelItem && <>
      <div className="pharmacy-label-print-root" aria-hidden="true">
        {canPrintLabels && Array.from({ length: labelCountValue }, (_, index) => (
          <article
            className={`pharmacy-label-print${index === labelCountValue - 1 ? ' pharmacy-label-print-last' : ''}`}
            key={index}
            style={{ width: `${labelWidthValue}mm`, height: `${labelHeightValue}mm` }}
          >
            <strong className="pharmacy-label-name">{labelItem.item_name}</strong>
            {(labelItem.active_ingredient || labelItem.presentation) && <span className="pharmacy-label-description">{[labelItem.active_ingredient, labelItem.presentation].filter(Boolean).join(' · ')}</span>}
            <span className="pharmacy-label-lot"><small>Lote</small><strong>{labelItem.lot}</strong></span>
            <span className="pharmacy-label-expiry"><small>Validade</small><strong>{new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${labelItem.expiry_date}T00:00:00Z`))}</strong></span>
          </article>
        ))}
      </div>
      <div className="pharmacy-label-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setLabelItem(null) }}>
        <section className="pharmacy-label-dialog" role="dialog" aria-modal="true" aria-labelledby="pharmacy-label-title">
          <header><div><p className="eyebrow">ETIQUETA DE LOTE</p><h2 id="pharmacy-label-title">Imprimir etiqueta</h2><p>{labelItem.item_name} · Lote {labelItem.lot}</p></div><button className="pharmacy-scanner-close" type="button" aria-label="Fechar impressão de etiquetas" onClick={() => setLabelItem(null)}><X size={20} /></button></header>
          <div className="pharmacy-label-fields">
            <label className="field"><span className="field-label">Largura (mm)</span><input type="number" min="10" max="200" step="0.1" required value={labelWidth} onChange={(event) => setLabelWidth(event.target.value)} /></label>
            <label className="field"><span className="field-label">Altura (mm)</span><input type="number" min="10" max="200" step="0.1" required value={labelHeight} onChange={(event) => setLabelHeight(event.target.value)} /></label>
            <label className="field pharmacy-label-count"><span className="field-label">Quantidade de etiquetas</span><input type="number" min="1" max="500" step="1" required value={labelCount} onChange={(event) => setLabelCount(event.target.value)} /><span className="field-hint">Escolha a quantidade conforme o uso deste lote (de 1 a 500).</span></label>
          </div>
          <p className="field-hint">Ajuste largura e altura para o rolo instalado. No diálogo de impressão, escolha a Zebra ZD220 e o tamanho correspondente; desative cabeçalhos e rodapés e use escala de 100%. Confira uma etiqueta antes de imprimir o restante.</p>
          {!canPrintLabels && <p className="pharmacy-label-error" role="alert">Informe dimensões entre 10 e 200 mm e uma quantidade inteira de 1 a 500.</p>}
          <div className="pharmacy-label-actions"><button className="button button-secondary" type="button" onClick={() => setLabelCount('1')}>1 etiqueta</button><button className="button button-secondary" type="button" onClick={() => setLabelCount('5')}>5 etiquetas</button><button className="button button-secondary" type="button" onClick={() => setLabelCount('10')}>10 etiquetas</button><button className="button button-secondary" type="button" onClick={() => setLabelItem(null)}>Cancelar</button><button className="button button-primary" type="button" disabled={!canPrintLabels} onClick={printLabels}><Printer size={16} /> Imprimir {labelCountValue} etiqueta(s)</button></div>
        </section>
      </div>
    </>}
    {cameraScannerOpen && <div className="pharmacy-scanner-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setCameraScannerOpen(false) }}>
      <section className="pharmacy-scanner-dialog" role="dialog" aria-modal="true" aria-labelledby="pharmacy-scanner-title">
        <header><div><p className="eyebrow">LEITURA DE CÓDIGO OU QR</p><h2 id="pharmacy-scanner-title">Enquadre o identificador na câmera</h2></div><button className="pharmacy-scanner-close" type="button" autoFocus aria-label="Fechar câmera" onClick={() => setCameraScannerOpen(false)}><X size={20} /></button></header>
        <video ref={barcodeVideoRef} className="pharmacy-scanner-video" autoPlay muted playsInline aria-label="Visualização da câmera para leitura de código de barras ou QR" />
        <span className="field-hint" role="status">{cameraScannerMessage || barcodeCameraUnavailable || 'Aponte a câmera para um código de barras ou QR com GTIN/GS1.'}</span>
      </section>
    </div>}
  </section>
}

function PurchaseRequestsPanel({ user, items, onReceived }: { user: AuthUser; items: PharmacyItem[]; onReceived: () => void }) {
  const [requests, setRequests] = useState<PurchaseRequest[]>([])
  const [form, setForm] = useState({ product_id: '', item_name: '', category: 'Medicamento', active_ingredient: '', presentation: '', base_unit: 'unidade', purchase_quantity: '', purchase_unit: 'unidade', packaging_levels: [] as PackagingLevel[], justification: '' })
  const [quotes, setQuotes] = useState<Record<string, { supplier: string; price: string }>>({})
  const [receipts, setReceipts] = useState<Record<string, { lot: string; expiry_date: string; quantity: string; storage_location: string }>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const canCreate = user.permissions.pharmacy?.includes('criar') || user.permissions.management?.includes('criar')
  const canManage = user.permissions.management?.includes('alterar') ?? false
  const canReceive = Boolean(user.permissions.pharmacy?.includes('criar') || user.permissions.pharmacy?.includes('alterar') || user.permissions.management?.includes('alterar'))
  const products = [...new Map(items.map((item) => [item.product_id, item])).values()]

  async function load() {
    try {
      const data = await readApiResponse<{ requests?: PurchaseRequest[] }>(await fetch('/api/v1/pharmacy/purchase-requests'))
      setRequests(data.requests ?? [])
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar solicitações de compra.')
    } finally { setLoading(false) }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [])

  async function createRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('')
    try {
      const levels = packagingLevelsForBase(form.packaging_levels, form.base_unit.trim())
      const conversion = packagingFactor(levels)
      const response = await fetch('/api/v1/pharmacy/purchase-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          product_id: form.product_id ? Number(form.product_id) : null,
          purchase_quantity: form.purchase_quantity.replace(',', '.'),
          units_per_purchase_unit: String(conversion),
          packaging_levels: levels.map((level) => ({ ...level, units_per_parent: level.units_per_parent.replace(',', '.') })),
        }),
      })
      const created = await readApiResponse<PurchaseRequest>(response)
      setRequests((current) => [created, ...current])
      setForm({ product_id: '', item_name: '', category: 'Medicamento', active_ingredient: '', presentation: '', base_unit: 'unidade', purchase_quantity: '', purchase_unit: 'unidade', packaging_levels: [], justification: '' })
      setNotice('Solicitação enviada para cotação e aprovação.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível criar a solicitação.')
    } finally { setSaving(false) }
  }

  async function changeStatus(request: PurchaseRequest, status: PurchaseRequest['status']) {
    const quote = quotes[request.id] ?? { supplier: '', price: '' }
    setSaving(true); setError(''); setNotice('')
    try {
      const updated = await readApiResponse<PurchaseRequest>(await fetch(`/api/v1/pharmacy/purchase-requests/${encodeURIComponent(request.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, supplier: quote.supplier, quoted_unit_price: quote.price.replace(',', '.') }),
      }))
      setRequests((current) => current.map((item) => item.id === updated.id ? updated : item))
      setNotice(`Solicitação atualizada: ${purchaseStatusLabels[updated.status]}.`)
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Não foi possível atualizar a solicitação.')
    } finally { setSaving(false) }
  }

  async function receive(request: PurchaseRequest) {
    const receipt = receipts[request.id]
    if (!receipt) return
    setSaving(true); setError(''); setNotice('')
    try {
      const result = await readApiResponse<{ request: PurchaseRequest; lot: PharmacyItem }>(await fetch(`/api/v1/pharmacy/purchase-requests/${encodeURIComponent(request.id)}/receipts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lot: receipt.lot,
          expiry_date: receipt.expiry_date,
          actual_purchase_quantity: receipt.quantity.replace(',', '.'),
          storage_location: receipt.storage_location,
        }),
      }))
      setRequests((current) => current.map((item) => item.id === result.request.id ? result.request : item))
      setReceipts((current) => ({ ...current, [request.id]: { ...receipt, lot: '', expiry_date: '', quantity: '', storage_location: '' } }))
      setNotice(`Entrada registrada: ${result.lot.balance} ${result.lot.unit} vinculados ao lote ${result.lot.lot}.`)
      onReceived()
    } catch (receiveError) {
      setError(receiveError instanceof Error ? receiveError.message : 'Não foi possível receber o pedido.')
    } finally { setSaving(false) }
  }

  return <section className="patient-list-panel">
    <div className="section-heading"><div><p className="eyebrow">FARMÁCIA · ABA COMPRAS E SUPRIMENTOS</p><h2>Solicitações e pedidos de compra</h2><p className="welcome-copy">Os pedidos enviados ficam nesta fila. A Gestão registra fornecedor e preço cotado, aprova ou rejeita a compra; após o pedido ao fornecedor, a Farmácia registra o recebimento por lote e validade.</p></div><span className="module-total">{requests.length}</span></div>
    {error && <ToastMessage variant="error">{error}</ToastMessage>}
    {notice && <ToastMessage variant="success">{notice}</ToastMessage>}
    {canCreate && <form className="account-create-panel" onSubmit={(event) => void createRequest(event)}>
      <h3>Nova solicitação</h3>
      <div className="field-grid field-grid-two">
        <label className="field"><span className="field-label">Produto cadastrado (opcional)</span><select value={form.product_id} onChange={(event) => { const item = products.find((product) => String(product.product_id) === event.target.value); setForm((current) => ({ ...current, product_id: event.target.value, ...(item ? { item_name: item.item_name, category: item.category, active_ingredient: item.active_ingredient, presentation: item.presentation, base_unit: item.unit, purchase_unit: item.product_packaging_unit || 'unidade', packaging_levels: packagingLevelsForBase(item.product_packaging_levels, item.unit) } : { item_name: '', category: 'Medicamento', active_ingredient: '', presentation: '', base_unit: 'unidade', purchase_unit: 'unidade', packaging_levels: [] }) })) }}><option value="">Novo produto</option>{products.map((item) => <option key={item.product_id} value={item.product_id}>{item.item_name} · base: {item.unit}</option>)}</select></label>
        <label className="field"><span className="field-label">Nome do produto</span><input required minLength={2} maxLength={120} value={form.item_name} onChange={(event) => setForm({ ...form, item_name: event.target.value })} /></label>
        {!form.product_id && <><label className="field"><span className="field-label">Categoria</span><input required minLength={2} maxLength={40} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} /></label><label className="field"><span className="field-label">Unidade base do estoque</span><input required maxLength={24} value={form.base_unit} onChange={(event) => setForm({ ...form, base_unit: event.target.value, packaging_levels: packagingLevelsForBase(form.packaging_levels, event.target.value) })} placeholder="Comprimido, mL, unidade..." /></label></>}
        <label className="field"><span className="field-label">Princípio ativo (opcional)</span><input maxLength={120} value={form.active_ingredient} onChange={(event) => setForm({ ...form, active_ingredient: event.target.value })} /></label>
        <label className="field"><span className="field-label">Apresentação (opcional)</span><input maxLength={120} value={form.presentation} onChange={(event) => setForm({ ...form, presentation: event.target.value })} /></label>
        <label className="field"><span className="field-label">Quantidade solicitada</span><input required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,3})?" value={form.purchase_quantity} onChange={(event) => setForm({ ...form, purchase_quantity: formatDecimalInput(event.target.value) })} /></label>
        <label className="field"><span className="field-label">Unidade comprada</span><input required maxLength={24} value={form.purchase_unit} onChange={(event) => setForm({ ...form, purchase_unit: event.target.value })} placeholder="Caixa, frasco, pacote..." /></label>
        <PackagingConversionEditor purchaseUnit={form.purchase_unit} baseUnit={form.base_unit} receivedQuantity={form.purchase_quantity} levels={form.packaging_levels} onChange={(packaging_levels) => setForm({ ...form, packaging_levels })} />
        <div className="pharmacy-packaging-example"><strong>Conversão solicitada</strong><span>{packagingFormula(form.purchase_quantity, form.purchase_unit, packagingLevelsForBase(form.packaging_levels, form.base_unit), form.base_unit)}</span><small>A mesma hierarquia será preservada no pedido e aplicada aos recebimentos por lote.</small></div>
        <label className="field"><span className="field-label">Justificativa da compra</span><textarea required minLength={5} maxLength={500} value={form.justification} onChange={(event) => setForm({ ...form, justification: event.target.value })} /></label>
      </div>
      <button className="button button-primary" type="submit" disabled={saving || !form.base_unit.trim()}>{saving ? 'Enviando…' : 'Enviar para cotação'}</button>
    </form>}
    {loading ? <div className="history-empty">Carregando solicitações…</div> : requests.length ? <div className="collection-list">{requests.map((request) => {
      const receipt = receipts[request.id] ?? { lot: '', expiry_date: '', quantity: '', storage_location: '' }
      const remaining = Math.max(0, Number(request.purchase_quantity.replace(',', '.')) - Number(request.received_quantity.replace(',', '.')))
      return <article className="collection-row" key={request.id}>
        <div className="collection-row-heading"><strong>{request.item_name} · {packagingFormula(request.purchase_quantity, request.purchase_unit, request.packaging_levels, request.base_unit)}</strong><span className={`work-order-status status-${request.status === 'received' ? 'completed' : request.status === 'rejected' ? 'cancelled' : request.status === 'requested' ? 'open' : 'in_progress'}`}>{purchaseStatusLabels[request.status]}</span></div>
        <p>{request.justification}</p>
        <small>Solicitado por {request.requested_by} · {dateTime(request.created_at)}{request.supplier ? ` · Fornecedor ${request.supplier}` : ''}{request.quoted_unit_price ? ` · Cotação ${request.quoted_unit_price} por ${request.purchase_unit}` : ''}</small>
        {canManage && request.status === 'requested' && <form className="field-grid field-grid-two" onSubmit={(event) => { event.preventDefault(); void changeStatus(request, 'quoted') }}><label className="field"><span className="field-label">Fornecedor cotado</span><input required minLength={2} maxLength={120} value={quotes[request.id]?.supplier ?? ''} onChange={(event) => setQuotes((current) => ({ ...current, [request.id]: { supplier: event.target.value, price: current[request.id]?.price ?? '' } }))} /></label><label className="field"><span className="field-label">Preço por embalagem</span><input required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" value={quotes[request.id]?.price ?? ''} onChange={(event) => setQuotes((current) => ({ ...current, [request.id]: { supplier: current[request.id]?.supplier ?? '', price: formatDecimalInput(event.target.value) } }))} /></label><button className="button button-secondary" type="submit" disabled={saving}>Registrar cotação</button></form>}
        {canManage && request.status === 'quoted' && <div className="patient-detail-actions"><button className="button button-primary" type="button" disabled={saving} onClick={() => void changeStatus(request, 'approved')}>Aprovar compra</button><button className="button button-danger" type="button" disabled={saving} onClick={() => void changeStatus(request, 'rejected')}>Rejeitar</button></div>}
        {canManage && request.status === 'approved' && <button className="button button-primary" type="button" disabled={saving} onClick={() => void changeStatus(request, 'ordered')}>Registrar pedido enviado ao fornecedor</button>}
        {canReceive && request.status === 'ordered' && remaining > 0 && <form className="field-grid field-grid-two" onSubmit={(event) => { event.preventDefault(); void receive(request) }}>
          <p className="field-hint">Restam {remaining} {request.purchase_unit} para recebimento.</p>
          <label className="field"><span className="field-label">Lote recebido</span><input required maxLength={80} value={receipt.lot} onChange={(event) => setReceipts((current) => ({ ...current, [request.id]: { ...receipt, lot: event.target.value } }))} /></label>
          <label className="field"><span className="field-label">Validade do lote</span><input required type="date" value={receipt.expiry_date} onChange={(event) => setReceipts((current) => ({ ...current, [request.id]: { ...receipt, expiry_date: event.target.value } }))} /></label>
          <label className="field"><span className="field-label">Quantidade recebida ({request.purchase_unit})</span><input required inputMode="decimal" max={remaining} pattern="[0-9]+([.,][0-9]{1,3})?" value={receipt.quantity} onChange={(event) => setReceipts((current) => ({ ...current, [request.id]: { ...receipt, quantity: formatDecimalInput(event.target.value) } }))} /></label>
          <div className="pharmacy-packaging-example"><strong>Saldo que será adicionado neste lote</strong><span>{packagingFormula(receipt.quantity, request.purchase_unit, request.packaging_levels, request.base_unit)}</span></div>
          <label className="field"><span className="field-label">Localização (opcional)</span><input maxLength={80} value={receipt.storage_location} onChange={(event) => setReceipts((current) => ({ ...current, [request.id]: { ...receipt, storage_location: event.target.value } }))} /></label>
          <button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Recebendo…' : 'Receber no estoque por lote'}</button>
        </form>}
        {request.status === 'received' && <small>Recebido por {request.received_by} · quantidade total: {request.received_quantity} {request.purchase_unit}</small>}
      </article>
    })}</div> : <div className="history-empty">Nenhuma solicitação de compra registrada.</div>}
  </section>
}

const purchaseStatusLabels: Record<PurchaseRequest['status'], string> = {
  requested: 'Solicitada',
  quoted: 'Cotada',
  approved: 'Aprovada',
  ordered: 'Pedido emitido',
  received: 'Recebida',
  rejected: 'Rejeitada',
}

function PharmacyProductThresholds({
  products,
  onSaved,
}: {
  products: PharmacyProductStock[]
  onSaved: (productId: number, item: PharmacyItem) => void
}) {
  const [editing, setEditing] = useState<number | null>(null)
  const [minimum, setMinimumState] = useState('0')
  const [average, setAverageState] = useState('')
  const setMinimum = (value: string) => setMinimumState(formatDecimalInput(value))
  const setAverage = (value: string) => setAverageState(formatDecimalInput(value))
  const validThresholds = average.trim() !== ''
    && Number.isFinite(Number(minimum.replace(',', '.')))
    && Number.isFinite(Number(average.replace(',', '.')))
    && Number(average.replace(',', '.')) > Number(minimum.replace(',', '.'))
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [messageVariant, setMessageVariant] = useState<'success' | 'error'>('success')
  const label: Record<StockLevel, string> = { critical: 'Crítico', attention: 'Atenção', healthy: 'Normal', unconfigured: 'Defina as metas' }
  const rows = [...products].sort((a, b) => {
    const order: Record<StockLevel, number> = { critical: 0, attention: 1, unconfigured: 2, healthy: 3 }
    return order[stockLevel(a.available_balance, a.minimum_balance, a.average_balance)] - order[stockLevel(b.available_balance, b.minimum_balance, b.average_balance)] || a.item_name.localeCompare(b.item_name, 'pt-BR')
  })
  async function save(product: PharmacyProductStock) {
    if (!validThresholds) {
      setMessageVariant('error')
      setMessage('A meta média deve ser maior que o saldo mínimo.')
      return
    }
    setSaving(true); setMessage('')
    try {
      const response = await fetch(`/api/v1/pharmacy/products/${product.product_id}/stock-thresholds`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ minimum_balance: minimum.replace(',', '.'), average_balance: average.replace(',', '.') }) })
      const data = await readApiResponse<PharmacyItem>(response)
      onSaved(product.product_id, data); setEditing(null); setMessageVariant('success'); setMessage(`Metas atualizadas para ${product.item_name}.`)
    } catch (error) { setMessageVariant('error'); setMessage(error instanceof Error ? error.message : 'Falha ao salvar metas.') }
    finally { setSaving(false) }
  }
  return <section className="pharmacy-stock-overview" aria-label="Metas de estoque por produto">
    <div className="section-heading"><div><p className="eyebrow">NÍVEIS DE ESTOQUE</p><h3>Metas por medicamento</h3><p className="welcome-copy">O saldo considera a soma dos lotes dentro da validade. Configure as metas uma vez por medicamento.</p></div></div>
    <details className="pharmacy-stock-details">
      <summary>Ver níveis e configurar metas por medicamento</summary>
      <p>Configure o mínimo e a meta média por produto. Verde, Normal: saldo acima da meta média. Amarelo, Atenção: acima do mínimo e até a meta média. Vermelho, Crítico: no mínimo ou abaixo. Produtos sem metas válidas ficam pendentes de configuração; lotes vencidos não entram no saldo acompanhado.</p>
      {message && <ToastMessage variant={messageVariant}>{message}</ToastMessage>}
      {rows.length ? <div className="pharmacy-stock-level-list">{rows.map((product) => {
        const level = stockLevel(product.available_balance, product.minimum_balance, product.average_balance)
        const isEditing = editing === product.product_id
        return <article className="pharmacy-stock-level-row" key={product.product_id}>
          <div className="pharmacy-stock-level-name"><span className={`pharmacy-level-dot level-${level}`} /><div><strong>{product.item_name}</strong><small>Saldo válido {product.available_balance.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} {product.unit} · mínimo {product.minimum_balance} · meta média {product.average_balance}</small></div></div>
          <span className={`pharmacy-stock-badge level-${level}`}>{label[level]}</span>
          {isEditing ? <div className="pharmacy-threshold-editor"><label className="field"><span className="field-label">Mínimo</span><input inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,3})?" value={minimum} onChange={(event) => setMinimum(event.target.value)} /></label><label className="field"><span className="field-label">Meta média</span><input required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,3})?" value={average} onChange={(event) => setAverage(event.target.value)} /><span className="field-hint">Deve ser maior que o mínimo.</span></label><button className="button button-primary" type="button" disabled={saving || !validThresholds} onClick={() => void save(product)}>{saving ? 'Salvando…' : 'Salvar metas'}</button><button className="button button-secondary" type="button" disabled={saving} onClick={() => setEditing(null)}>Cancelar</button></div> : <button className="button button-secondary pharmacy-threshold-button" type="button" onClick={() => { setEditing(product.product_id); setMinimum(product.minimum_balance || '0'); setAverage(product.average_balance && Number(product.average_balance) > 0 ? product.average_balance : '') }}>Configurar metas</button>}
        </article>
      })}</div> : <div className="history-empty">Nenhum produto encontrado.</div>}
    </details>
  </section>
}


export default PharmacyPage
