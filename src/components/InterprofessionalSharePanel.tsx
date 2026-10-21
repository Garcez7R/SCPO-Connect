import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, LockKeyhole } from 'lucide-react'
import { readApiResponse } from '../api'
import ToastMessage from './ToastMessage'

type ShareModule = 'social' | 'psychology'
type ShareCategory = 'care_needs' | 'family_support' | 'social_context' | 'safety_followup' | 'contact_plan' | 'other'
type SharePatient = { reference: string; name: string; room: string; bed: string }
type InterprofessionalShare = {
  id: number
  patient_reference: string
  sender_module: ShareModule
  recipient_module: ShareModule
  direction: 'sent' | 'received'
  categories: ShareCategory[]
  summary: string
  purpose: string
  created_by_name: string
  created_at: string
  expires_at: string | null
  expired: boolean
  revoked_at: string | null
}

const categoryLabels: Record<ShareCategory, string> = {
  care_needs: 'Necessidades de cuidado',
  family_support: 'Apoio familiar',
  social_context: 'Contexto social',
  safety_followup: 'Acompanhamento de segurança',
  contact_plan: 'Plano de contato / retorno',
  other: 'Outro item necessário',
}

function moduleLabel(module: ShareModule) {
  return module === 'social' ? 'Serviço Social' : 'Psicologia / Psiquiatria'
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export default function InterprofessionalSharePanel({
  moduleId,
  patients,
}: {
  moduleId: ShareModule
  patients: SharePatient[]
}) {
  const recipientModule: ShareModule = moduleId === 'social' ? 'psychology' : 'social'
  const [shares, setShares] = useState<InterprofessionalShare[]>([])
  const [patientReference, setPatientReference] = useState('')
  const [categories, setCategories] = useState<ShareCategory[]>([])
  const [summary, setSummary] = useState('')
  const [purpose, setPurpose] = useState('')
  const [expiresInDays, setExpiresInDays] = useState<7 | 14 | 30 | null>(7)
  const [filter, setFilter] = useState<'all' | 'received' | 'sent'>('all')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [revoking, setRevoking] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const response = await fetch(`/api/v1/interprofessional/shares?module=${moduleId}`)
        const data = await readApiResponse<{ shares?: InterprofessionalShare[] }>(response)
        if (active) {
          setShares(data.shares ?? [])
          setError('')
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar os compartilhamentos.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [moduleId])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/v1/interprofessional/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_reference: patientReference,
          sender_module: moduleId,
          recipient_module: recipientModule,
          categories,
          summary: summary.trim(),
          purpose: purpose.trim(),
          expires_in_days: expiresInDays,
        }),
      })
      const data = await readApiResponse<InterprofessionalShare>(response)
      setShares((current) => [data, ...current])
      setPatientReference('')
      setCategories([])
      setSummary('')
      setPurpose('')
      setExpiresInDays(7)
      setNotice(`Resumo compartilhado com ${moduleLabel(recipientModule)}.`)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Falha ao compartilhar as informações.')
    } finally {
      setSaving(false)
    }
  }

  async function revoke(share: InterprofessionalShare) {
    setRevoking(share.id)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`/api/v1/interprofessional/shares/${share.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revoked: true }),
      })
      const data = await readApiResponse<InterprofessionalShare>(response)
      setShares((current) => current.map((item) => item.id === data.id ? data : item))
      setNotice('Compartilhamento revogado. O destinatário não poderá mais consultá-lo.')
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'Falha ao revogar o compartilhamento.')
    } finally {
      setRevoking(null)
    }
  }

  const visibleShares = shares.filter((share) => filter === 'all' || share.direction === filter)
  const patientName = (reference: string) => {
    const patient = patients.find((item) => item.reference === reference)
    return patient ? `${patient.name}${patient.room && patient.bed ? ` · Quarto ${patient.room}, leito ${patient.bed}` : ''}` : 'Paciente não localizado'
  }

  return <section className="interprofessional-sharing">
    <form className="psychology-panel interprofessional-share-form" onSubmit={(event) => void submit(event)}>
      <div className="section-heading"><div><p className="eyebrow">COMPARTILHAMENTO SELETIVO</p><h2>Enviar resumo assistencial</h2><p className="welcome-copy">Destino: {moduleLabel(recipientModule)}. Nenhum registro privado do módulo será copiado automaticamente; o envio também não cria encaminhamento nem atendimento no módulo destinatário.</p></div><LockKeyhole size={19} /></div>
      <div className="field-grid field-grid-two">
        <label className="field"><span className="field-label">Paciente</span><select required value={patientReference} onChange={(event) => setPatientReference(event.target.value)}><option value="">Selecione o paciente</option>{patients.map((patient) => <option key={patient.reference} value={patient.reference}>{patientName(patient.reference)}</option>)}</select></label>
        <label className="field"><span className="field-label">Finalidade do compartilhamento</span><input required minLength={10} maxLength={300} value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="Ex.: coordenar o acompanhamento após alta" /></label>
        <fieldset className="interprofessional-share-categories">
          <legend>Marque somente as informações necessárias</legend>
          {Object.entries(categoryLabels).map(([category, label]) => <label key={category}><input type="checkbox" checked={categories.includes(category as ShareCategory)} onChange={(event) => setCategories((current) => event.target.checked ? [...current, category as ShareCategory] : current.filter((item) => item !== category))} /> {label}</label>)}
        </fieldset>
        <label className="field"><span className="field-label">Resumo mínimo necessário</span><textarea required minLength={3} maxLength={2000} rows={4} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Registre somente o que a equipe destinatária precisa saber para esta finalidade." /></label>
        <label className="field"><span className="field-label">Acesso do destinatário</span><select value={expiresInDays ?? 'never'} onChange={(event) => setExpiresInDays(event.target.value === 'never' ? null : Number(event.target.value) as 7 | 14 | 30)}><option value={7}>Expira em 7 dias</option><option value={14}>Expira em 14 dias</option><option value={30}>Expira em 30 dias</option><option value="never">Sem expiração automática</option></select></label>
      </div>
      <p className="psychology-help">Confirme que o compartilhamento segue a finalidade assistencial e as regras institucionais. O sistema mantém autoria e auditoria. Sem expiração automática, o acesso permanece ativo até ser revogado pelo autor.</p>
      {error && <ToastMessage variant="error">{error}</ToastMessage>}
      {notice && <ToastMessage variant="success">{notice}</ToastMessage>}
      <button className="button button-primary" type="submit" disabled={saving || !patients.length || !categories.length}>{saving ? 'Compartilhando…' : 'Compartilhar resumo'} <ArrowRight size={16} /></button>
    </form>
    <section className="psychology-panel interprofessional-share-list">
      <div className="section-heading"><div><p className="eyebrow">REGISTROS SELETIVOS</p><h2>Compartilhamentos</h2><p className="welcome-copy">A equipe destinatária visualiza somente resumos ativos destinados ao seu módulo. Se o caso exigir atendimento, a equipe destinatária deve avaliar o resumo e registrar a demanda na própria fila.</p></div><span className="module-total">{visibleShares.length}</span></div>
      <div className="psychology-filter-row"><label className="field"><span className="field-label">Exibir</span><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">Enviados e recebidos</option><option value="received">Recebidos</option><option value="sent">Enviados por mim</option></select></label></div>
      {loading ? <div className="history-empty">Carregando compartilhamentos…</div> : visibleShares.length ? <div className="interprofessional-share-items">{visibleShares.map((share) => {
        const revoked = Boolean(share.revoked_at)
        const expired = share.expired
        const isSender = share.direction === 'sent'
        const destination = isSender ? moduleLabel(share.recipient_module) : moduleLabel(share.sender_module)
        return <article className="interprofessional-share-card" key={share.id}>
          <div className="interprofessional-share-heading"><div><h3>{patientName(share.patient_reference)}</h3><p>{isSender ? `Enviado para ${destination}` : `Recebido de ${destination}`} · {dateTime(share.created_at)}</p></div><span className={`work-order-status ${revoked || expired ? 'status-cancelled' : 'status-in_progress'}`}>{revoked ? 'Revogado' : expired ? 'Expirado' : share.expires_at ? 'Ativo até ' + dateTime(share.expires_at) : 'Ativo · sem expiração'}</span></div>
          <p><strong>Finalidade:</strong> {share.purpose}</p>
          <div className="interprofessional-share-tags">{share.categories.map((category) => <span key={category}>{categoryLabels[category]}</span>)}</div>
          <p className="interprofessional-share-summary">{share.summary}</p>
          <small>Compartilhado por {share.created_by_name}</small>
          {isSender && !revoked && !expired && <button className="button button-secondary" type="button" onClick={() => void revoke(share)} disabled={revoking === share.id}>{revoking === share.id ? 'Revogando…' : 'Revogar acesso'}</button>}
        </article>
      })}</div> : <div className="history-empty">Nenhum compartilhamento nesta lista.</div>}
    </section>
  </section>
}
