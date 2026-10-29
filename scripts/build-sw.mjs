import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = process.env.SCPO_BUILD_DIR ? resolve(process.env.SCPO_BUILD_DIR) : fileURLToPath(new URL('../dist/', import.meta.url))
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? files(join(dir, entry.name)) : join(dir, entry.name)))).flat()
}
const staticFiles = await files(root)
const fingerprint = await Promise.all(staticFiles.filter((file) => !file.endsWith('/sw.js')).map(async (file) => `${relative(root, file)}:${createHash('sha256').update(await readFile(file)).digest('hex')}`))
const version = createHash('sha256').update(fingerprint.sort().join('\n')).digest('hex').slice(0, 16)
const precache = staticFiles
  .filter((file) => {
    const path = relative(root, file).replaceAll('\\', '/')
    return path.startsWith('assets/') && /\.(?:js|css|woff2?)$/.test(path)
  })
  .map((file) => `/${relative(root, file).replaceAll('\\', '/')}`)
const source = `const CACHE = 'scpo-connect-${version}';
const PRECACHE = ${JSON.stringify([
  ...precache,
  '/offline.html',
  '/nursing.html',
  '/operations.html',
  '/pharmacy.html',
  '/physician.html',
  '/nursing.webmanifest',
  '/operations.webmanifest',
  '/pharmacy.webmanifest',
  '/physician.webmanifest',
  '/scpo-connect-icon.png',
  '/scpo-connect-install-192.png',
  '/scpo-connect-install.png',
  '/sidebar-health-watermark.svg',
])};
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('scpo-connect-') && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('install', (event) => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await cache.addAll(PRECACHE);
})()));
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await caches.match(request)) || (await caches.match('/offline.html')) || Response.error()));
    return;
  }
  if (!/\\.(?:js|css|avif|jpe?g|png|svg|webp|woff2?)$/.test(url.pathname)) return;
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
    return response;
  })());
});
`
await writeFile(join(root, 'sw.js'), source)
