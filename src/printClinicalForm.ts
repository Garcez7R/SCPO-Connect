function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character)
}

function openPrintDocument(title: string, body: string) {
  const popup = window.open('', '_blank', 'width=900,height=700')
  if (!popup) return false
  popup.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><base href="${escapeHtml(window.location.origin)}/"><title>${escapeHtml(title)}</title><style>
    @page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;padding:16mm;color:#172b3a;font:12pt Arial,sans-serif}
    header{display:grid;grid-template-columns:24mm 1fr;align-items:center;gap:8mm;padding-bottom:7mm;border-bottom:2px solid #246b8e}
    header img{width:22mm;height:22mm;object-fit:contain}h1{margin:0;font-size:16pt}h2{margin:4mm 0 0;font-size:13pt;font-weight:600}
    section{margin-top:8mm}h3{margin:0 0 4mm;font-size:12pt}dl{display:grid;grid-template-columns:1fr 1fr;gap:4mm 8mm;margin:0}
    dl div{border-bottom:1px solid #9aa7b0;padding:2mm 0}dt{font-size:9pt;color:#526575}dd{margin:1mm 0 0;min-height:6mm;font-weight:600}
    ul{margin:0;padding-left:7mm}li{margin:2mm 0}.observations{min-height:24mm;white-space:pre-wrap;border:1px solid #9aa7b0;padding:4mm}
    footer{margin-top:22mm;display:grid;grid-template-columns:1fr 1fr;gap:20mm;text-align:center}footer span{border-top:1px solid #526575;padding-top:2mm}
    .disclaimer{margin-top:8mm;color:#526575;font-size:9pt}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
  </style></head><body>${body}</body></html>`)
  popup.document.close()
  const imagesLoaded = Promise.all(Array.from(popup.document.images, (image) => {
    if (image.complete) return Promise.resolve()
    return new Promise<void>((resolve) => {
      image.addEventListener('load', () => resolve(), { once: true })
      image.addEventListener('error', () => resolve(), { once: true })
    })
  }))
  const imageTimeout = new Promise<void>((resolve) => window.setTimeout(resolve, 1500))
  void Promise.race([imagesLoaded, imageTimeout]).then(() => {
    if (!popup.closed) {
      popup.focus()
      popup.print()
    }
  })
  return true
}

export type ExamPrintPatient = {
  name: string
  birth_date?: string | null
  room: string
  bed: string
}

export function printLaboratoryRequest(patient: ExamPrintPatient, exams: string[], other: string, observations: string) {
  const rows = [
    ['Paciente', patient.name],
    ['Data de nascimento', patient.birth_date ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${patient.birth_date}T12:00:00Z`)) : 'Não informada'],
    ['Quarto', patient.room || 'Não informado'],
    ['Leito', patient.bed || 'Não informado'],
  ]
  const body = `<header class="exam-print-header"><img src="/scpo-connect-icon.png" alt="Logotipo SCPO Connect"><div><h1>SANTA CASA DE PEDRO OSÓRIO</h1><h2>Solicitação de Exames</h2></div></header>
    <section><h3>Identificação do paciente</h3><dl>${rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl></section>
    <section><h3>Exames solicitados</h3><ul>${[...exams, ...(other.trim() ? [`Outros: ${other.trim()}`] : [])].map((exam) => `<li>${escapeHtml(exam)}</li>`).join('')}</ul></section>
    <section><h3>Observações</h3><div class="observations">${escapeHtml(observations || ' ')}</div></section>
    <style>.exam-print-header{display:grid;grid-template-columns:1fr;justify-items:center;gap:3mm;padding:0 0 5mm;border:0;text-align:center}.exam-print-header img{width:22mm;height:22mm;object-fit:contain}.exam-print-header h1,.exam-print-header h2{text-align:center}</style>`
  return openPrintDocument('Solicitação de Exames', body)
}

export type PrescriptionPrintData = {
  patient: ExamPrintPatient
  prescriberName: string
  crm: string
  crmState: string
  medicationName: string
  activeIngredient: string
  presentation: string
  dose: string
  route: string
  frequency: string
  administrationTimes?: string[]
  duration: string
  quantity: string
  unit: string
  instructions: string
}

export function printExternalPrescription(prescription: PrescriptionPrintData) {
  const { patient } = prescription
  const birthDate = patient.birth_date
    ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${patient.birth_date}T12:00:00Z`))
    : 'Não informada'
  const medication = [
    prescription.medicationName,
    prescription.activeIngredient && `Princípio ativo: ${prescription.activeIngredient}`,
    prescription.presentation,
  ].filter(Boolean).map(escapeHtml).join(' · ')
  const body = `<header><img src="/scpo-connect-icon.png" alt=""><div><h1>SANTA CASA DE PEDRO OSÓRIO</h1><h2>Receita médica simples</h2></div></header>
    <section><h3>Paciente</h3><dl>${[
      ['Nome', patient.name],
      ['Data de nascimento', birthDate],
      ['Quarto', patient.room || 'Não informado'],
      ['Leito', patient.bed || 'Não informado'],
    ].map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl></section>
    <section><h3>Uso conforme orientação médica</h3><p><strong>${medication}</strong></p><dl>${[
      ['Dose', prescription.dose],
      ['Via', prescription.route],
      ['Frequência', prescription.frequency],
      ...(prescription.administrationTimes?.length ? [['Horários prescritos', prescription.administrationTimes.join(' · ')] as [string, string]] : []),
      ['Duração', prescription.duration],
      ['Quantidade', `${prescription.quantity} ${prescription.unit}`],
    ].map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>${prescription.instructions ? `<p>${escapeHtml(prescription.instructions)}</p>` : ''}</section>
    <section><p>Pedro Osório, ${new Intl.DateTimeFormat('pt-BR').format(new Date())}</p></section>
    <footer><span>${escapeHtml(prescription.prescriberName)}<br>CRM ${escapeHtml(prescription.crm)}/${escapeHtml(prescription.crmState)}</span><span>Assinatura e carimbo</span></footer>
    <p class="disclaimer">Impresso para assinatura manual. Não substitui receituários legalmente exigidos para medicamentos sujeitos a controle especial.</p>`
  return openPrintDocument('Receita médica simples', body)
}

export function printMedicationAdministrationLabels(data: {
  patient: ExamPrintPatient
  medicationName: string
  dose: string
  route: string
  times: string[]
  prescriberName: string
}) {
  if (!data.times.length) return false
  const labels = data.times.map((time) => `<article><header><img src="/scpo-connect-icon.png" alt=""><div><strong>SCPO Connect</strong><span>Administração · ${escapeHtml(time)}</span></div></header><h1>${escapeHtml(data.patient.name)}</h1><p>${escapeHtml(data.patient.room || 'Quarto —')} · Leito ${escapeHtml(data.patient.bed || '—')}</p><h2>${escapeHtml(data.medicationName)}</h2><p>${escapeHtml(data.dose)} · ${escapeHtml(data.route)}</p><small>Prescritor: ${escapeHtml(data.prescriberName)}</small></article>`).join('')
  const popup = window.open('', '_blank', 'width=720,height=720')
  if (!popup) return false
  popup.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Etiquetas de administração</title><style>@page{margin:8mm}*{box-sizing:border-box}body{font:12px Arial,sans-serif;color:#172b3a;margin:0;display:grid;grid-template-columns:1fr 1fr;gap:5mm}article{min-height:48mm;padding:5mm;border:1px dashed #667985;break-inside:avoid}header{display:flex;align-items:center;gap:3mm;border-bottom:1px solid #ccd7df;padding-bottom:2mm}header img{width:10mm;height:10mm;object-fit:contain}header div{display:grid;gap:1mm}header span,small,p{color:#526579}h1{font-size:14px;margin:3mm 0 1mm}h2{font-size:13px;margin:3mm 0 1mm}p{margin:1mm 0 2mm}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}</style></head><body>${labels}</body></html>`)
  popup.document.close()
  window.setTimeout(() => {
    if (!popup.closed) {
      popup.focus()
      popup.print()
    }
  }, 150)
  return true
}
