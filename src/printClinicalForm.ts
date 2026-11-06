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
    <style>.exam-print-header{display:grid;grid-template-columns:24mm 1fr;justify-items:stretch;gap:8mm;padding:0 0 5mm;border:0;text-align:center}.exam-print-header img{width:22mm;height:22mm;object-fit:contain}.exam-print-header h1,.exam-print-header h2{text-align:center}</style>`
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
  administrationDate: string
}) {
  if (!data.times.length) return false
  const dateParts = data.administrationDate.split('-').map(Number)
  const dateLabel = dateParts.length === 3 && dateParts.every(Number.isInteger)
    ? new Intl.DateTimeFormat('pt-BR').format(new Date(dateParts[0], dateParts[1] - 1, dateParts[2]))
    : data.administrationDate
  const sheets: string[] = []
  for (let index = 0; index < data.times.length; index += 3) {
    const labels = data.times.slice(index, index + 3).map((time) => `
      <article>
        <small class="cup-label-heading">MEDICAÇÃO · ${escapeHtml(time)}</small>
        <strong class="cup-label-patient">${escapeHtml(data.patient.name)}</strong>
        <span class="cup-label-location">Quarto ${escapeHtml(data.patient.room || '—')} · Leito ${escapeHtml(data.patient.bed || '—')}</span>
        <strong class="cup-label-medication">${escapeHtml(data.medicationName)}</strong>
        <span class="cup-label-dose">${escapeHtml(data.dose)} · ${escapeHtml(data.route)}</span>
        <small class="cup-label-date">${escapeHtml(dateLabel)}</small>
      </article>`).join('')
    sheets.push(`<section class="cup-label-sheet">${labels}</section>`)
  }
  const popup = window.open('', '_blank', 'width=720,height=720')
  if (!popup) return false
  popup.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Etiquetas para copinhos de medicação</title><style>
    @page{size:134mm 34mm;margin:0}*{box-sizing:border-box}
    body{width:134mm;height:34mm;margin:0;overflow:hidden;color:#172b3a;font:7pt Arial,sans-serif}
    .cup-label-sheet{display:grid;box-sizing:border-box;width:134mm;height:34mm;grid-template-columns:repeat(3,36mm);grid-template-rows:28mm;column-gap:3mm;row-gap:2mm;align-content:start;justify-content:start;padding:4mm 16mm 2mm 4mm;transform:scaleX(1.5);transform-origin:top left;break-after:page;page-break-after:always}
    .cup-label-sheet:last-child{break-after:auto;page-break-after:auto}
    article{position:relative;display:flex;width:36mm;height:28mm;flex-direction:column;justify-content:center;gap:.7mm;overflow:hidden;padding:1mm;background:#fff;break-inside:avoid}
    article::before{position:absolute;inset:0;z-index:0;background:url('/scpo-connect-icon.png') center/18mm no-repeat;content:'';opacity:.08}
    article>*{position:relative;z-index:1;overflow-wrap:anywhere}
    .cup-label-heading{font-size:5.5pt;font-weight:700;letter-spacing:.2pt}
    .cup-label-patient{font-size:8pt;line-height:1.05}
    .cup-label-location,.cup-label-date{font-size:6pt;color:#526579}
    .cup-label-medication{margin-top:.5mm;font-size:7.5pt;line-height:1.05}
    .cup-label-dose{font-size:6.5pt;font-weight:600}
    @media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
  </style></head><body>${sheets.join('')}</body></html>`)
  popup.document.close()
  window.setTimeout(() => {
    if (!popup.closed) {
      popup.focus()
      popup.print()
    }
  }, 150)
  return true
}

export function printMedicationScheduleSheet(data: {
  dateLabel: string
  timeLabel: string
  rows: Array<{
    patient: ExamPrintPatient
    medications: Array<{
      medicationName: string
      dose: string
      route: string
      instructions?: string
      unit?: string
    }>
  }>
}) {
  const body = `<header><img src="/scpo-connect-icon.png" alt=""><div><h1>SANTA CASA DE PEDRO OSÓRIO</h1><h2>Escala de medicações por horário</h2><p>${escapeHtml(data.dateLabel)} · ${escapeHtml(data.timeLabel)}</p></div></header>
    ${data.rows.map((row) => `<section class="patient-sheet"><h3>${escapeHtml(row.patient.name)} · Quarto ${escapeHtml(row.patient.room || '—')} · Leito ${escapeHtml(row.patient.bed || '—')}</h3>
      <table><thead><tr><th>Medicamento</th><th>Dose</th><th>Via</th><th>Observação</th><th>Ministrado</th></tr></thead><tbody>${row.medications.map((item) => `<tr><td>${escapeHtml(item.medicationName)}</td><td>${escapeHtml(item.dose)}</td><td>${escapeHtml(item.route)}</td><td>${escapeHtml(item.instructions || item.unit || '')}</td><td>□</td></tr>`).join('')}</tbody></table></section>`).join('')}
    <footer><span>Registro da equipe de enfermagem</span><span>Data/Hora: ${escapeHtml(new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date()))}</span></footer>`
  const popup = window.open('', '_blank', 'width=980,height=760')
  if (!popup) return false
  popup.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Escala de medicações</title><style>@page{size:A4;margin:12mm}*{box-sizing:border-box}body{font:10pt Arial,sans-serif;color:#172b3a;margin:0;padding:0}header{display:grid;grid-template-columns:18mm 1fr;gap:6mm;align-items:center;padding-bottom:5mm;border-bottom:2px solid #246b8e}header img{width:16mm;height:16mm;object-fit:contain}h1,h2,h3{margin:0}h1{font-size:14pt}h2{font-size:11pt;margin-top:2mm;font-weight:600}header p{margin:2mm 0 0;color:#526575}section{margin-top:8mm}h3{font-size:11pt;margin-bottom:3mm}table{width:100%;border-collapse:collapse}th,td{border:1px solid #9aa7b0;padding:2mm 2.5mm;text-align:left;vertical-align:top;font-size:9pt}th{background:#edf3f8}tr td:last-child{width:18mm;text-align:center}footer{margin-top:10mm;display:grid;grid-template-columns:1fr 1fr;gap:12mm;color:#526575;font-size:9pt}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}</style></head><body>${body}</body></html>`)
  popup.document.close()
  window.setTimeout(() => {
    if (!popup.closed) {
      popup.focus();
      popup.print();
    }
  }, 150)
  return true
}
