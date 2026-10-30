import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, RefreshCw } from 'lucide-react'
import { readApiResponse } from '../api'
import ToastMessage from './ToastMessage'
import type { TriageArrival } from '../triageTypes'

const vitalLabels: Record<string, string> = {
  pressure: 'Pressão arterial',
  heartRate: 'Frequência cardíaca',
  respiratoryRate: 'Frequência respiratória',
  saturation: 'Saturação',
  temperature: 'Temperatura',
  glucose: 'Glicemia',
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

export default function PhysicianTriageQueue({ onOpenPatient, compact = false }: { onOpenPatient: (reference: string) => void; compact?: boolean }) {
  const [arrivals, setArrivals] = useState<TriageArrival[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const data = await readApiResponse<{ arrivals: TriageArrival[] }>(
        await fetch('/api/v1/physicians/triage/arrivals', { cache: 'no-store' }),
      )
      setArrivals(data.arrivals)
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar os atendimentos triados.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  return <section className={`physician-triage-queue patient-list-panel${compact ? ' physician-triage-queue-compact' : ''}`}>
    <div className="section-heading"><div><p className="eyebrow">ENFERMAGEM → MÉDICO</p><h2>{compact ? 'Aguardando avaliação' : 'Aguardando avaliação médica'}</h2><p className="welcome-copy">{compact ? 'Abra uma ficha para continuar o atendimento.' : 'Atendimentos da Recepção com triagem registrada, separados da consulta aos pacientes do cadastro.'}</p></div><button className="button button-secondary" type="button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} /> Atualizar</button></div>
    {error && <ToastMessage variant="error">{error}</ToastMessage>}
    {loading ? <p className="history-empty">Carregando atendimentos triados…</p> : arrivals.length ? <div className="physician-triage-list">{arrivals.map((arrival) => {
      const triage = arrival.triage
      if (!triage) return null
      const vitalEntries = Object.entries(triage.vital_values).filter(([, value]) => value)
      return <article className="physician-triage-card" key={`${arrival.arrival_id}-${triage.id}`}>
        <div className="physician-triage-heading"><div><p className="eyebrow">{arrival.queue_type === 'priority' ? 'FILA PRIORITÁRIA' : 'FILA COMUM'} · {arrival.status === 'waiting' ? 'AGUARDANDO' : arrival.status === 'called' ? 'CHAMADO' : 'EM ATENDIMENTO'}</p><h3>{arrival.patient_name}</h3><span>{arrival.reason}</span></div><span className="hourly-round-status hourly-round-status-checked">Triagem concluída</span></div>
        <div className="physician-triage-details">
          <section><strong>Alergias neste atendimento</strong><span>{triage.allergies_status === 'unknown' ? 'Não avaliadas / informação indisponível' : triage.allergies_status === 'none_known' ? 'Sem alergias conhecidas após conferência' : triage.allergies}</span></section>
          <section><strong>Condições, comorbidades ou tratamentos relatados</strong><span>{triage.conditions_treatments || 'Não informado'}</span></section>
          <section><strong>Sinais vitais medidos</strong>{vitalEntries.length ? <ul>{vitalEntries.map(([key, value]) => <li key={key}>{vitalLabels[key] ?? key}: {value}{key === 'pressure' ? ' mmHg' : key === 'heartRate' ? ' bpm' : key === 'respiratoryRate' ? ' rpm' : key === 'saturation' ? '%' : key === 'temperature' ? ' °C' : key === 'glucose' ? ` ${triage.glucose_unit}` : ''}</li>)}</ul> : <span>Nenhum valor registrado</span>}{triage.measured_at && <small>Aferidos em {formatDateTime(triage.measured_at)}</small>}</section>
        </div>
        <p className="physician-triage-meta">Registrado por {triage.registered_by} em {formatDateTime(triage.registered_at)} · Chegada {formatDateTime(arrival.created_at)}</p>
        {arrival.patient_reference
          ? <button className="button button-primary" type="button" onClick={() => onOpenPatient(arrival.patient_reference!)}>{compact ? 'Abrir ficha' : 'Abrir ficha do paciente'} <ArrowRight size={16} /></button>
          : <p className="form-message form-message-warning">Esta chegada não está vinculada a um cadastro. Vincule/regularize a identificação antes de usar prescrições internas.</p>}
        <p className="field-hint">Alergias e condições exibidas são o registro deste atendimento; confirme clinicamente antes de decidir condutas. Não há diagnóstico ou classificação automática.</p>
      </article>
    })}</div> : <p className="history-empty">Não há atendimentos triados aguardando avaliação.</p>}
  </section>
}
