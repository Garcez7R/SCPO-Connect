import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const dataDirectory = mkdtempSync(join(tmpdir(), 'scpo-connect-e2e-'))
const playwrightCli = join(repositoryRoot, 'node_modules', '@playwright', 'test', 'cli.js')
const localKey = () => randomBytes(32).toString('base64url')

try {
  const child = spawn(process.execPath, [playwrightCli, 'test', ...process.argv.slice(2)], {
    cwd: repositoryRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      SCPO_ENV: 'development',
      SCPO_LOCAL_DATA_DIR: dataDirectory,
      SCPO_E2E_DATA_DIR: dataDirectory,
      SCPO_SESSION_SIGNING_KEY: localKey(),
      SCPO_MFA_ENCRYPTION_KEY: localKey(),
      SCPO_BOOTSTRAP_ADMIN_TOKEN: localKey(),
      SCPO_COOKIE_SECURE: 'false',
    },
  })

  const exitCode = await new Promise((resolveExit, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      resolveExit(code ?? (signal ? 1 : 0))
    })
  })
  process.exitCode = exitCode
} finally {
  rmSync(dataDirectory, { recursive: true, force: true })
}
