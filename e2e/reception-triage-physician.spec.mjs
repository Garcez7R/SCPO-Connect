import { createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

function decodeBase32(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const bits = [...secret.replace(/=+$/, '').toUpperCase()]
    .map((character) => {
      const value = alphabet.indexOf(character)
      if (value < 0) throw new Error('Chave MFA de teste inválida.')
      return value.toString(2).padStart(5, '0')
    })
    .join('')
  const bytes = []
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2))
  }
  return Buffer.from(bytes)
}

function currentTotp(secret) {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)))
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff)
  return String(binary % 1_000_000).padStart(6, '0')
}

test('Recepção registra chegada, Enfermagem tria e Médico recebe o atendimento', async ({ page }) => {
  const dataDirectory = process.env.SCPO_E2E_DATA_DIR
  if (!dataDirectory) throw new Error('Diretório de dados E2E não configurado.')
  const bootstrapToken = (await readFile(join(dataDirectory, 'bootstrap-admin.token'), 'utf8')).trim()
  const patientName = `Paciente E2E ${Date.now()}`

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Configurar administrador master' })).toBeVisible()
  await page.getByLabel('Nome do administrador').fill('Administrador E2E')
  await page.getByLabel('Usuário').fill('e2e-admin')
  await page.getByLabel('Token de bootstrap').fill(bootstrapToken)
  await page.getByRole('button', { name: 'Criar administrador' }).click()

  await expect(page.getByRole('heading', { name: 'Troque sua senha inicial' })).toBeVisible()
  await page.getByLabel('Nova senha').fill('E2e-local-2026!Senha')
  await page.getByRole('button', { name: 'Salvar nova senha' }).click()

  await expect(page.getByRole('heading', { name: 'Ative a autenticação em duas etapas' })).toBeVisible()
  const mfaSecretElement = page.locator('.auth-mfa-instructions code')
  await expect(mfaSecretElement).not.toHaveText('Carregando chave segura…')
  const mfaSecret = await mfaSecretElement.innerText()
  await page.getByLabel('Código do aplicativo').fill(currentTotp(mfaSecret))
  await page.getByRole('button', { name: 'Ativar MFA' }).click()

  await expect(page.getByRole('button', { name: 'Recepção', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Recepção', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Recepção' })).toBeVisible()
  await page.getByRole('button', { name: 'Registrar chegada', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Criar também o cadastro central sem quarto ou leito' }).check()
  await page.getByLabel('Nome completo para novo cadastro').fill(patientName)
  await page.getByLabel('Motivo informado para a procura').fill('Fluxo sintético de validação E2E')
  await page.locator('#reception-arrival-form').getByRole('button', { name: 'Registrar chegada' }).click()
  await expect(page.locator('.reception-arrival-list').getByText(patientName)).toBeVisible()

  await page.getByRole('button', { name: 'Enfermagem', exact: true }).click()
  await page.getByRole('tab', { name: 'Triagem' }).click()
  await page.locator('.nursing-triage-arrival').filter({ hasText: patientName }).click()
  await page.getByLabel('Alergias neste atendimento').selectOption('none_known')
  await page.getByLabel('Condições, comorbidades ou tratamentos relatados')
    .fill('Registro sintético para teste de integração')
  await page.getByLabel('Saturação (%)').fill('98')
  await page.getByRole('button', { name: 'Registrar triagem' }).click()
  await expect(page.getByText('Triagem registrada para este atendimento; o Médico já pode consultá-la.')).toBeVisible()

  await page.getByRole('button', { name: 'Médico', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Aguardando avaliação médica' })).toBeVisible()
  const physicianCard = page.locator('.physician-triage-card').filter({ hasText: patientName })
  await expect(physicianCard).toContainText('Triagem concluída')
  await expect(physicianCard).toContainText('Registro sintético para teste de integração')
  await expect(physicianCard).toContainText('98%')
  await physicianCard.getByRole('button', { name: 'Abrir ficha do paciente' }).click()
  await expect(page.locator('.physician-care-roster-item.is-selected')).toContainText(patientName)
})
