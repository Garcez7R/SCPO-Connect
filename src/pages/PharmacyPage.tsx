import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { AlertTriangle, ArrowRight, Camera, CalendarDays, Package, Search, X } from 'lucide-react'
import { readApiResponse } from '../api'
import PrintSelectionPanel from '../components/PrintSelectionPanel'
import type { PrintRow } from '../printReport'
import { formatDecimalInput } from '../inputFormatting'

type Patient = { reference: string; name: string; room: string; bed: string; allergies?: string; allergies_status?: 'unknown' | 'none_known' | 'known' }
type AuthUser = { id: string; username: string; name: string; role: string; modules: string[]; permissions: Record<string, string[]> }
type PharmacyItem = { id: number; product_id: number; item_name: string; balance: string; unit: string; purchase_quantity: string; purchase_unit: string; units_per_purchase_unit: string; lot: string; expiry_date: string; created_at: string; barcode: string; category: string; active_ingredient: string; presentation: string; supplier: string; storage_location: string; minimum_balance: string; average_balance: string }
type AnvisaCatalogSuggestion = { gtin: string; product_name: string; active_ingredient: string; presentation: string; manufacturer: string; registration: string }
type AnvisaCatalogStatus = { source: string; source_url: string; entry_count: number; imported_at: string | null; source_updated_at: string | null }
type PharmacyBarcodeLookup = { gtin: string; lot: string | null; expiry_date: string | null; serial: string | null; matches: PharmacyItem[]; catalog_suggestions: AnvisaCatalogSuggestion[]; catalog_imported_at: string | null }
type PharmacyMovement = { id: number; item_id: number; movement_type: 'opening_balance' | 'entry' | 'issue' | 'adjustment'; quantity: string; balance_after: string; reason: string; actor_name: string; created_at: string }
type MedicationDispensation = { id: string; patient_reference: string; item_id: number; medication_name: string; quantity: string; unit: string; instructions: string; prescription_reference: string; prescriber_name: string; allergy_reviewed: boolean; status: 'dispensed' | 'cancelled'; actor_name: string; created_at: string }
type PurchaseRequest = { id: string; product_id: number | null; item_name: string; category: string; active_ingredient: string; presentation: string; base_unit: string; purchase_quantity: string; purchase_unit: string; units_per_purchase_unit: string; received_quantity: string; supplier: string; quoted_unit_price: string; justification: string; status: 'requested' | 'quoted' | 'approved' | 'ordered' | 'received' | 'rejected'; requested_by: string; approved_by: string; received_by: string; created_at: string; updated_at: string }
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
  const [pharmacyTab, setPharmacyTab] = useState<'stock' | 'dispensation' | 'purchases'>('stock')
  const [items, setItems] = useState<PharmacyItem[]>([])
  const [patients, setPatients] = useState<Patient[]>([])
  const [dispensations, setDispensations] = useState<MedicationDispensation[]>([])
  const [dispenseForm, setDispenseForm] = useState({ patient_reference: '', item_id: '', quantity: '', instructions: '', prescription_reference: '', prescriber_name: '', allergy_reviewed: false })
  const [dispensing, setDispensing] = useState(false)
  const [movements, setMovements] = useState<PharmacyMovement[]>([])
  const [movementTotal, setMovementTotal] = useState(0)
  const [movementOffset, setMovementOffset] = useState(0)
  const [movementItemId, setMovementItemId] = useState<number | null>(null)
  const [movementForm, setMovementFormState] = useState({ movement_type: 'entry' as 'entry' | 'issue' | 'adjustment', quantity: '', reason: '' })
  const setMovementForm = (value: { movement_type: 'entry' | 'issue' | 'adjustment'; quantity: string; reason: string }) =>
    setMovementFormState({ ...value, quantity: formatDecimalInput(value.quantity) })
  const [movementSaving, setMovementSaving] = useState(false)
  const [form, setForm] = useState({ item_name: '', barcode: '', category: 'Medicamento', active_ingredient: '', presentation: '', catalog_registration: '', purchase_quantity: '', purchase_unit: '', units_per_purchase_unit: '1', minimum_balance: '0', unit: '', lot: '', expiry_date: '', supplier: '', storage_location: '' })
  const canManagePurchases = (user.modules.includes('pharmacy') && Boolean(user.permissions.pharmacy?.includes('criar') || user.permissions.pharmacy?.includes('alterar'))) || (user.modules.includes('management') && Boolean(user.permissions.management?.includes('consultar')))
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
        ...(clearOldAutofill && current.barcode.trim() !== result.gtin ? {
          item_name: '',
          category: 'Medicamento',
          active_ingredient: '',
          presentation: '',
          unit: '',
        } : {}),
        ...(result.matches[0] ? {
          item_name: result.matches[0].item_name,
          category: result.matches[0].category,
          active_ingredient: result.matches[0].active_ingredient,
          presentation: result.matches[0].presentation,
          unit: result.matches[0].unit,
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
      item_name: suggestion.product_name,
      category: 'Medicamento',
      active_ingredient: suggestion.active_ingredient,
      presentation: suggestion.presentation,
      catalog_registration: suggestion.registration,
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
      ...(replaceAutofilledProduct ? {
        item_name: '',
        category: 'Medicamento',
        active_ingredient: '',
        presentation: '',
        unit: '',
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
      const response = await fetch('/api/v1/pharmacy/items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, item_name: form.item_name.trim(), balance: null, purchase_quantity: form.purchase_quantity.replace(',', '.'), purchase_unit: form.purchase_unit.trim(), units_per_purchase_unit: form.units_per_purchase_unit.replace(',', '.'), unit: form.unit.trim(), lot: form.lot.trim() }) })
      const data = await readApiResponse<PharmacyItem>(response)
      setItems((current) => [...current, data].sort((a, b) => a.item_name.localeCompare(b.item_name, 'pt-BR')))
      setForm({ item_name: '', barcode: '', category: 'Medicamento', active_ingredient: '', presentation: '', catalog_registration: '', purchase_quantity: '', purchase_unit: '', units_per_purchase_unit: '1', minimum_balance: '0', unit: '', lot: '', expiry_date: '', supplier: '', storage_location: '' })
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
      setDispensations((current) => [data, ...current])
      setDispenseForm({ patient_reference: '', item_id: '', quantity: '', instructions: '', prescription_reference: '', prescriber_name: '', allergy_reviewed: false })
      setNotice('Dispensação registrada, vinculada ao paciente e debitada do lote.')
      await loadItems(0)
    } catch (dispenseError) {
      setError(dispenseError instanceof Error ? dispenseError.message : 'Não foi possível registrar a dispensação.')
    } finally { setDispensing(false) }
  }

  const dispensePatient = patients.find((patient) => patient.reference === dispenseForm.patient_reference)
  const selectedDispenseLot = items.find((item) => String(item.id) === dispenseForm.item_id)

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
    const level = stockLevel(item)
    const matchesFilter = stockFilter === 'all'
      || (stockFilter === 'expired' && item.expiry_date < today)
      || (stockFilter === 'expiring' && item.expiry_date >= today && item.expiry_date <= soon)
      || (stockFilter === 'critical' && level === 'critical')
      || (stockFilter === 'attention' && level === 'attention')
    return matchesSearch && matchesFilter
  }).sort((a, b) => a.expiry_date.localeCompare(b.expiry_date) || a.item_name.localeCompare(b.item_name, 'pt-BR'))
  const pharmacyPrintRows: PrintRow[] = filteredItems.map((item) => ({ id: String(item.id), date: item.created_at, title: item.item_name, fields: [['Categoria', item.category], ['Princípio ativo', item.active_ingredient], ['Apresentação', item.presentation], ['Saldo', `${item.balance} ${item.unit}`], ['Entrada original', `${item.purchase_quantity} ${item.purchase_unit} × ${item.units_per_purchase_unit} ${item.unit}`], ['Lote', item.lot], ['Validade', item.expiry_date], ['Código de barras', item.barcode], ['Localização', item.storage_location], ['Fornecedor', item.supplier]] }))
  const requestedPackages = Number(form.purchase_quantity.replace(',', '.'))
  const unitsPerPackage = Number(form.units_per_purchase_unit.replace(',', '.'))
  const convertedBalance = requestedPackages * unitsPerPackage

  return <section className="pharmacy-page page-enter">
    <div className="page-title-row"><div><p className="eyebrow">MÓDULO · FARMÁCIA</p><h1>{pharmacyTab === 'stock' ? 'Estoque e validade' : pharmacyTab === 'purchases' ? 'Compras e suprimentos' : 'Dispensação'}</h1><p className="welcome-copy">{pharmacyTab === 'stock' ? 'Cadastre lotes com conversão explícita para a unidade de controle.' : pharmacyTab === 'purchases' ? 'Solicite, cote, aprove, acompanhe pedidos e registre recebimentos por lote.' : 'Registre e acompanhe a dispensação de medicamentos para pacientes.'}</p></div>{pharmacyTab === 'stock' && <button className="button button-primary" type="button" onClick={() => { setShowForm((current) => !current); setNotice(''); setError('') }}><Package size={16} /> {showForm ? 'Fechar cadastro' : 'Cadastrar lote'}</button>}</div>
    <div className="admin-tabs module-tabs pharmacy-tabs" role="tablist" aria-label="Seções da Farmácia">
      <button className={`button ${pharmacyTab === 'stock' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={pharmacyTab === 'stock'} onClick={() => setPharmacyTab('stock')}><Package size={16} /> Estoque e lotes</button>
      <button className={`button ${pharmacyTab === 'dispensation' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={pharmacyTab === 'dispensation'} onClick={() => setPharmacyTab('dispensation')}><ArrowRight size={16} /> Dispensação</button>
      {canManagePurchases && <button className={`button ${pharmacyTab === 'purchases' ? 'button-primary' : 'button-secondary'}`} type="button" role="tab" aria-selected={pharmacyTab === 'purchases'} onClick={() => setPharmacyTab('purchases')}><Package size={16} /> Compras e suprimentos</button>}
    </div>
    {notice && <div className="form-message form-message-success" role="status">{notice}</div>}{error && <div className="form-message form-message-error" role="alert">{error}</div>}
    {pharmacyTab === 'stock' && <>
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
    </>}
    {pharmacyTab === 'dispensation' && <section className="pharmacy-dispensation-panel">
      <div className="section-heading"><div><p className="eyebrow">SAÍDA ASSISTENCIAL</p><h2>Dispensar para paciente</h2><p className="welcome-copy">Registre a prescrição, confirme as alergias e selecione o lote dispensado. A Enfermagem receberá a quantidade e poderá registrar administrações parciais vinculadas à mesma dispensação.</p></div></div>
      <form className="field-grid field-grid-two" onSubmit={(event) => void submitDispensation(event)}>
        <label className="field"><span className="field-label">Paciente</span><select required value={dispenseForm.patient_reference} onChange={(event) => setDispenseForm({ ...dispenseForm, patient_reference: event.target.value, allergy_reviewed: false })}><option value="">Selecione</option>{patients.map((patient) => <option key={patient.reference} value={patient.reference}>{patient.name} · {patientLocationLabel(patient)}</option>)}</select></label>
        <label className="field"><span className="field-label">Medicamento e lote</span><select required value={dispenseForm.item_id} onChange={(event) => setDispenseForm({ ...dispenseForm, item_id: event.target.value })}><option value="">Selecione lote válido</option>{eligibleMedicationLots.map((item) => <option key={item.id} value={item.id}>{item.item_name} · Lote {item.lot}{suggestedFefoLotIds.has(item.id) ? ' · sugestão FEFO' : ''} · saldo {item.balance} {item.unit}</option>)}</select><span className="field-hint">A sugestão FEFO indica o lote válido com vencimento mais próximo por produto; a seleção permanece manual e deve seguir a política da instituição.</span></label>
        <label className="field"><span className="field-label">Quantidade ({selectedDispenseLot?.unit || 'unidade do lote'})</span><input required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,3})?" maxLength={32} value={dispenseForm.quantity} onChange={(event) => setDispenseForm({ ...dispenseForm, quantity: formatDecimalInput(event.target.value) })} /><span className="field-hint">Informe a quantidade entregue nesta unidade. O mesmo total fica disponível para registro de doses parciais na Enfermagem.</span></label>
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
    </section>}
    {pharmacyTab === 'purchases' && canManagePurchases && <PurchaseRequestsPanel user={user} items={items} onReceived={() => void loadItems(0)} />}
    {pharmacyTab === 'stock' && <>
    {showForm && <form className="pharmacy-form" onSubmit={(event) => void submit(event)}>
      <div className="section-heading"><div><p className="eyebrow">ENTRADA DE ESTOQUE</p><h2>Produto, lote e armazenamento</h2><p className="welcome-copy">Mantenha saldo, movimentações, dispensações e administrações na mesma unidade de estoque.</p></div></div>
      <div className="pharmacy-catalog-panel">
        <div><strong>Catálogo público de medicamentos · Anvisa/CMED</strong><span>{catalogStatus ? `${catalogStatus.entry_count.toLocaleString('pt-BR')} sugestões disponíveis · última importação: ${catalogStatus.imported_at ? dateTime(catalogStatus.imported_at) : 'ainda não importado'}` : 'Consultando disponibilidade do catálogo…'}</span><a href={catalogStatus?.source_url ?? 'https://dados.anvisa.gov.br/dados/TA_PRECO_MEDICAMENTO.csv'} target="_blank" rel="noreferrer">Ver fonte pública</a></div>
        <button className="button button-secondary" type="button" onClick={() => void refreshAnvisaCatalog()} disabled={catalogRefreshing}>{catalogRefreshing ? 'Atualizando catálogo…' : 'Atualizar catálogo Anvisa'}</button>
        {catalogStatusError && <span className="pharmacy-catalog-error" role="alert">{catalogStatusError}</span>}
        <p className="field-hint">A atualização consulta a lista pública CMED. Os dados são sugestões de identificação, não confirmam registro ativo, autenticidade ou adequação clínica; confira e aprove cada dado antes de cadastrar.</p>
      </div>
      <div className="field-grid field-grid-two">
        <label className="field">
          <span className="field-label">Código de barras / GTIN</span>
          <input inputMode="numeric" autoComplete="off" maxLength={200} value={form.barcode} onChange={(event) => changeBarcode(event.target.value)} onFocus={prepareBarcodeAudio} onKeyDown={(event) => { if (event.key === 'Enter' && form.barcode.trim()) { event.preventDefault(); prepareBarcodeAudio(); playBarcodeTone(audioContextRef.current); void lookupBarcode(form.barcode.trim()) } }} placeholder="Leia com o leitor USB ou digite" />
          <span className="field-hint">A leitura USB consulta o cadastro após a leitura; Enter consulta imediatamente. A câmera também funciona em celulares com HTTPS.</span>
        </label>
        <div className="field pharmacy-scan-field">
          <span className="field-label">Leitura e consulta do código</span>
          <button className="button button-secondary" type="button" onClick={() => { prepareBarcodeAudio(); setCameraScannerMessage(''); setCameraScannerOpen((open) => !open) }}><Camera size={16} /> {cameraScannerOpen ? 'Fechar câmera' : 'Ler código pela câmera'}</button>
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
        <label className="field"><span className="field-label">Unidades de estoque em cada embalagem</span><input required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,3})?" maxLength={32} value={form.units_per_purchase_unit} onChange={(event) => setForm({ ...form, units_per_purchase_unit: formatDecimalInput(event.target.value) })} placeholder="Ex.: 20 comprimidos por caixa" /></label>
        <label className="field"><span className="field-label">Unidade mínima movimentada e dispensada</span><input required maxLength={24} value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} placeholder="Ex.: comprimido, frasco, mL" /><span className="field-hint">O fator converte a embalagem para esta unidade base. Exemplo: 10 caixas × 20 comprimidos = 200 comprimidos no saldo, permitindo dispensar 1 comprimido.</span></label>
        <div className="pharmacy-opening-balance" aria-live="polite"><span>Saldo inicial calculado</span><strong>{Number.isFinite(convertedBalance) ? convertedBalance : '—'} {form.unit || 'unidade base'}</strong><small>Embalagens recebidas × unidades por embalagem. O servidor valida e registra esse saldo.</small></div>
        <label className="field"><span className="field-label">Estoque mínimo</span><input inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,3})?" maxLength={32} value={form.minimum_balance} onChange={(event) => setForm({ ...form, minimum_balance: formatDecimalInput(event.target.value) })} /><span className="field-hint">O painel alerta quando o saldo atingir este limite.</span></label>
        <label className="field"><span className="field-label">Lote</span><input required maxLength={80} value={form.lot} onChange={(event) => setForm({ ...form, lot: event.target.value })} /></label>
        <label className="field"><span className="field-label">Validade</span><input required type="date" value={form.expiry_date} onChange={(event) => setForm({ ...form, expiry_date: event.target.value })} /></label>
        <label className="field"><span className="field-label">Fornecedor</span><input maxLength={120} value={form.supplier} onChange={(event) => setForm({ ...form, supplier: event.target.value })} /></label>
        <label className="field"><span className="field-label">Local de armazenamento</span><input maxLength={80} value={form.storage_location} onChange={(event) => setForm({ ...form, storage_location: event.target.value })} placeholder="Ex.: armário 2, prateleira B" /></label>
      </div>
      <div className="pharmacy-form-actions"><button className="button button-secondary" type="button" onClick={() => { setShowForm(false); setCameraScannerOpen(false) }} disabled={saving}>Cancelar</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Cadastrar lote'} <ArrowRight size={16} /></button></div>
    </form>}
    <section className="pharmacy-inventory"><div className="section-heading"><div><p className="eyebrow">INVENTÁRIO</p><h2>Itens cadastrados</h2></div><button className="button button-secondary" type="button" onClick={() => void loadItems()} disabled={loading}>{loading ? 'Atualizando…' : 'Atualizar'}</button></div><label className="field pharmacy-search"><span className="field-label">Buscar item, princípio ativo, lote ou localização</span><span className="search-input-wrap"><Search size={17} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Digite nome, código de barras ou lote" /></span></label>
      {loading ? <div className="history-empty">Carregando estoque…</div> : filteredItems.length ? <div className="pharmacy-item-grid">{filteredItems.map((item) => { const expired = item.expiry_date < today; const expiring = !expired && item.expiry_date <= soon; const low = Number(item.minimum_balance.replace(',', '.')) > 0 && Number(item.balance.replace(',', '.')) <= Number(item.minimum_balance.replace(',', '.')); return <article className="pharmacy-item-card" key={item.id}><div className="pharmacy-item-heading"><span className="pharmacy-item-icon"><Package size={18} /></span><span className={`pharmacy-expiry ${expired ? 'pharmacy-expired' : expiring || low ? 'pharmacy-expiring' : ''}`}>{expired ? <AlertTriangle size={14} /> : expiring || low ? <AlertTriangle size={14} /> : <CalendarDays size={14} />}{expired ? 'Vencido' : expiring ? 'Vence em breve' : low ? 'Abaixo do mínimo' : 'Dentro da validade'}</span></div><h3>{item.item_name}</h3><p className="pharmacy-item-description">{item.category}{item.active_ingredient ? ` · ${item.active_ingredient}` : ''}{item.presentation ? ` · ${item.presentation}` : ''}</p><div className="pharmacy-stock"><strong>{item.balance}</strong><span>{item.unit}{low ? ` · mínimo ${item.minimum_balance}` : ''}</span></div><div className="pharmacy-item-meta"><span><small>Entrada</small><strong>{item.purchase_quantity} {item.purchase_unit} × {item.units_per_purchase_unit} {item.unit}</strong></span><span><small>Código</small><strong>{item.barcode || 'Não informado'}</strong></span><span><small>Lote</small><strong>{item.lot}</strong></span><span><small>Validade</small><strong>{new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${item.expiry_date}T00:00:00Z`))}</strong></span><span><small>Armazenamento</small><strong>{item.storage_location || 'Não informado'}</strong></span>{item.supplier && <span><small>Fornecedor</small><strong>{item.supplier}</strong></span>}</div><button className="button button-secondary pharmacy-movement-toggle" type="button" onClick={() => { setMovementItemId(movementItemId === item.id ? null : item.id); setMovementForm({ movement_type: 'entry', quantity: '', reason: '' }) }}>{movementItemId === item.id ? 'Cancelar' : 'Movimentar estoque'}</button>{movementItemId === item.id && <form className="pharmacy-stock-movement-form" onSubmit={(event) => void submitMovement(event, item)}><label className="field"><span className="field-label">Operação</span><select value={movementForm.movement_type} onChange={(event) => setMovementForm({ ...movementForm, movement_type: event.target.value as typeof movementForm.movement_type })}><option value="entry">Entrada</option><option value="issue">Saída / dispensação</option><option value="adjustment">Ajuste de inventário</option></select></label><label className="field"><span className="field-label">Quantidade ({item.unit}) {movementForm.movement_type === 'adjustment' ? '(negativa para reduzir)' : ''}</span><input required type="text" inputMode="decimal" pattern="-?[0-9]+([.,][0-9]{1,3})?" maxLength={32} value={movementForm.quantity} onChange={(event) => setMovementForm({ ...movementForm, quantity: event.target.value })} placeholder="Ex.: 5 ou -2" /><span className="field-hint">Use a mesma unidade do saldo deste lote: {item.unit}.</span></label><label className="field"><span className="field-label">Motivo da movimentação</span><input required minLength={3} maxLength={500} value={movementForm.reason} onChange={(event) => setMovementForm({ ...movementForm, reason: event.target.value })} placeholder="Ex.: dispensação, recebimento da nota fiscal" /></label><button className="button button-primary" type="submit" disabled={movementSaving}>{movementSaving ? 'Salvando…' : 'Registrar movimentação'}</button></form>}</article> })}</div> : <div className="history-empty"><Package size={20} /><span>{query || stockFilter !== 'all' ? 'Nenhum lote corresponde à busca ou ao filtro selecionado.' : 'Nenhum lote cadastrado.'}</span></div>}
      <section className="pharmacy-movement-ledger"><div className="section-heading"><div><p className="eyebrow">RASTREABILIDADE DO ESTOQUE</p><h3>Movimentações recentes <span className="module-total">{movementTotal}</span></h3><p className="welcome-copy">Cada linha registra quantidade na unidade do lote, saldo após a operação, responsável e motivo.</p></div><button className="button button-secondary" type="button" onClick={() => void loadItems(movementOffset)} disabled={loading}>Atualizar histórico</button></div>{movements.length ? <><div className="pharmacy-movement-list">{movements.map((movement) => { const item = items.find((candidate) => candidate.id === movement.item_id); const labels = { opening_balance: 'Saldo inicial legado', entry: 'Entrada', issue: 'Saída', adjustment: 'Ajuste' }; return <article className="pharmacy-movement-row" key={movement.id}><div><strong>{item ? `${item.item_name} · Lote ${item.lot}` : `Item #${movement.item_id}`}</strong><small>{labels[movement.movement_type]} · {dateTime(movement.created_at)}</small><small>{movement.reason}</small></div><div className="pharmacy-movement-values"><span>{movement.quantity} {item?.unit ?? ''}</span><small>Saldo: {movement.balance_after} {item?.unit ?? ''}</small></div><small className="pharmacy-movement-author">{movement.actor_name}</small></article> })}</div><div className="pharmacy-ledger-pagination"><span>{movementTotal ? `${movementOffset + 1}–${Math.min(movementOffset + movements.length, movementTotal)} de ${movementTotal}` : '0 registros'}</span><div><button className="button button-secondary" type="button" disabled={loading || movementOffset === 0} onClick={() => void loadItems(Math.max(0, movementOffset - 25))}>Anterior</button><button className="button button-secondary" type="button" disabled={loading || movementOffset + movements.length >= movementTotal} onClick={() => void loadItems(movementOffset + 25)}>Próxima</button></div></div></> : <div className="history-empty">Nenhuma movimentação registrada.</div>}</section>
    </section>
    <PrintSelectionPanel title="Relatório de estoque por lote" rows={pharmacyPrintRows} />
    </>}
    {cameraScannerOpen && <div className="pharmacy-scanner-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setCameraScannerOpen(false) }}>
      <section className="pharmacy-scanner-dialog" role="dialog" aria-modal="true" aria-labelledby="pharmacy-scanner-title">
        <header><div><p className="eyebrow">LEITURA DE CÓDIGO DE BARRAS</p><h2 id="pharmacy-scanner-title">Enquadre o código na câmera</h2></div><button className="pharmacy-scanner-close" type="button" autoFocus aria-label="Fechar câmera" onClick={() => setCameraScannerOpen(false)}><X size={20} /></button></header>
        <video ref={barcodeVideoRef} className="pharmacy-scanner-video" autoPlay muted playsInline aria-label="Visualização da câmera para leitura do código de barras" />
        <span className="field-hint" role="status">{cameraScannerMessage || barcodeCameraUnavailable || 'Aponte a câmera para o código de barras.'}</span>
      </section>
    </div>}
  </section>
}

function PurchaseRequestsPanel({ user, items, onReceived }: { user: AuthUser; items: PharmacyItem[]; onReceived: () => void }) {
  const [requests, setRequests] = useState<PurchaseRequest[]>([])
  const [form, setForm] = useState({ product_id: '', item_name: '', category: 'Medicamento', active_ingredient: '', presentation: '', base_unit: '', purchase_quantity: '', purchase_unit: '', units_per_purchase_unit: '1', justification: '' })
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
      const response = await fetch('/api/v1/pharmacy/purchase-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          product_id: form.product_id ? Number(form.product_id) : null,
          purchase_quantity: form.purchase_quantity.replace(',', '.'),
          units_per_purchase_unit: form.units_per_purchase_unit.replace(',', '.'),
        }),
      })
      const created = await readApiResponse<PurchaseRequest>(response)
      setRequests((current) => [created, ...current])
      setForm({ product_id: '', item_name: '', category: 'Medicamento', active_ingredient: '', presentation: '', base_unit: '', purchase_quantity: '', purchase_unit: '', units_per_purchase_unit: '1', justification: '' })
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
    <div className="section-heading"><div><p className="eyebrow">SUPRIMENTOS → FARMÁCIA</p><h2>Solicitações e pedidos de compra</h2><p className="welcome-copy">O recebimento converte a quantidade da embalagem para a unidade base e cria saldo por lote e validade.</p></div><span className="module-total">{requests.length}</span></div>
    {error && <div className="form-message form-message-error" role="alert">{error}</div>}
    {notice && <div className="form-message form-message-success" role="status">{notice}</div>}
    {canCreate && <form className="account-create-panel" onSubmit={(event) => void createRequest(event)}>
      <h3>Nova solicitação</h3>
      <div className="field-grid field-grid-two">
        <label className="field"><span className="field-label">Produto cadastrado (opcional)</span><select value={form.product_id} onChange={(event) => { const item = products.find((product) => String(product.product_id) === event.target.value); setForm((current) => ({ ...current, product_id: event.target.value, ...(item ? { item_name: item.item_name, category: item.category, active_ingredient: item.active_ingredient, presentation: item.presentation, base_unit: item.unit } : {}) })) }}><option value="">Novo produto</option>{products.map((item) => <option key={item.product_id} value={item.product_id}>{item.item_name} · base: {item.unit}</option>)}</select></label>
        <label className="field"><span className="field-label">Nome do produto</span><input required minLength={2} maxLength={120} value={form.item_name} onChange={(event) => setForm({ ...form, item_name: event.target.value })} /></label>
        {!form.product_id && <><label className="field"><span className="field-label">Categoria</span><input required minLength={2} maxLength={40} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} /></label><label className="field"><span className="field-label">Unidade base do estoque</span><input required maxLength={24} value={form.base_unit} onChange={(event) => setForm({ ...form, base_unit: event.target.value })} placeholder="Comprimido, mL, unidade..." /></label></>}
        <label className="field"><span className="field-label">Princípio ativo (opcional)</span><input maxLength={120} value={form.active_ingredient} onChange={(event) => setForm({ ...form, active_ingredient: event.target.value })} /></label>
        <label className="field"><span className="field-label">Apresentação (opcional)</span><input maxLength={120} value={form.presentation} onChange={(event) => setForm({ ...form, presentation: event.target.value })} /></label>
        <label className="field"><span className="field-label">Quantidade solicitada</span><input required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,3})?" value={form.purchase_quantity} onChange={(event) => setForm({ ...form, purchase_quantity: formatDecimalInput(event.target.value) })} /></label>
        <label className="field"><span className="field-label">Unidade comprada</span><input required maxLength={24} value={form.purchase_unit} onChange={(event) => setForm({ ...form, purchase_unit: event.target.value })} placeholder="Caixa, frasco, pacote..." /></label>
        <label className="field"><span className="field-label">Unidades base por embalagem</span><input required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,3})?" value={form.units_per_purchase_unit} onChange={(event) => setForm({ ...form, units_per_purchase_unit: formatDecimalInput(event.target.value) })} /><span className="field-hint">Ex.: 20 comprimidos por caixa.</span></label>
        <label className="field"><span className="field-label">Justificativa da compra</span><textarea required minLength={5} maxLength={500} value={form.justification} onChange={(event) => setForm({ ...form, justification: event.target.value })} /></label>
      </div>
      <button className="button button-primary" type="submit" disabled={saving || !form.base_unit.trim()}>{saving ? 'Enviando…' : 'Enviar para cotação'}</button>
    </form>}
    {loading ? <div className="history-empty">Carregando solicitações…</div> : requests.length ? <div className="collection-list">{requests.map((request) => {
      const receipt = receipts[request.id] ?? { lot: '', expiry_date: '', quantity: '', storage_location: '' }
      const remaining = Math.max(0, Number(request.purchase_quantity.replace(',', '.')) - Number(request.received_quantity.replace(',', '.')))
      return <article className="collection-row" key={request.id}>
        <div className="collection-row-heading"><strong>{request.item_name} · {request.purchase_quantity} {request.purchase_unit} × {request.units_per_purchase_unit} {request.base_unit}</strong><span className={`work-order-status status-${request.status === 'received' ? 'completed' : request.status === 'rejected' ? 'cancelled' : request.status === 'requested' ? 'open' : 'in_progress'}`}>{purchaseStatusLabels[request.status]}</span></div>
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
  const [minimum, setMinimumState] = useState('0')
  const [average, setAverageState] = useState('')
  const setMinimum = (value: string) => setMinimumState(formatDecimalInput(value))
  const setAverage = (value: string) => setAverageState(formatDecimalInput(value))
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
