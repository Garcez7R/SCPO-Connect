import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { extname } from 'node:path'

const imageDirectory = new URL('../public/reception-screensaver/', import.meta.url)
const imageExtensions = new Set(['.avif', '.jpg', '.jpeg', '.png', '.webp'])

await mkdir(imageDirectory, { recursive: true })
const imageNames = (await readdir(imageDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && imageExtensions.has(extname(entry.name).toLowerCase()))
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right, 'pt-BR'))

const manifest = {
  images: imageNames.map((name) => `/reception-screensaver/${encodeURIComponent(name)}`),
}

await writeFile(new URL('manifest.json', imageDirectory), `${JSON.stringify(manifest, null, 2)}\n`)
