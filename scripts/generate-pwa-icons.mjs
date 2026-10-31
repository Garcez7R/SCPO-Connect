import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pngjs from 'pngjs'

const { PNG } = pngjs
const root = fileURLToPath(new URL('../', import.meta.url))
const sourcePath = join(root, 'public/scpo-connect-install-512.png')
const source = PNG.sync.read(await readFile(sourcePath))

if (source.width !== 512 || source.height !== 512) {
  throw new Error(`${sourcePath} must be a 512 × 512 PNG.`)
}

const modules = [
  { name: 'nursing', color: '#246b8e', symbol: drawCross },
  { name: 'operations', color: '#455a64', symbol: drawGear },
  { name: 'pharmacy', color: '#2f855a', symbol: drawCapsule },
  { name: 'physician', color: '#1f5f99', symbol: drawStethoscope },
  { name: 'kitchen', color: '#c05621', symbol: drawUtensils },
]

for (const module of modules) {
  const icon = new PNG({ width: source.width, height: source.height })
  source.data.copy(icon.data)

  drawCircle(icon, 406, 406, 99, '#ffffff')
  drawCircle(icon, 406, 406, 88, module.color)
  module.symbol(icon, 406, 406)

  for (const size of [192, 512]) {
    const output = size === 512 ? icon : resize(icon, size)
    const outputPath = join(root, `public/scpo-connect-${module.name}-${size}.png`)
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, PNG.sync.write(output))
  }
}

function colorToRgba(color) {
  const value = Number.parseInt(color.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255]
}

function setPixel(image, x, y, color) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return
  const offset = (Math.round(y) * image.width + Math.round(x)) * 4
  image.data.set(color, offset)
}

function drawCircle(image, centerX, centerY, radius, color) {
  const rgba = colorToRgba(color)
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      if (x * x + y * y <= radius * radius) setPixel(image, centerX + x, centerY + y, rgba)
    }
  }
}

function drawLine(image, startX, startY, endX, endY, width, color) {
  const rgba = colorToRgba(color)
  const radius = width / 2
  const left = Math.floor(Math.min(startX, endX) - radius)
  const right = Math.ceil(Math.max(startX, endX) + radius)
  const top = Math.floor(Math.min(startY, endY) - radius)
  const bottom = Math.ceil(Math.max(startY, endY) + radius)
  const deltaX = endX - startX
  const deltaY = endY - startY
  const lengthSquared = deltaX * deltaX + deltaY * deltaY

  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const projection = lengthSquared === 0
        ? 0
        : Math.max(0, Math.min(1, ((x - startX) * deltaX + (y - startY) * deltaY) / lengthSquared))
      const distanceX = x - (startX + projection * deltaX)
      const distanceY = y - (startY + projection * deltaY)
      if (distanceX * distanceX + distanceY * distanceY <= radius * radius) setPixel(image, x, y, rgba)
    }
  }
}

function drawCross(image, centerX, centerY) {
  drawLine(image, centerX - 29, centerY, centerX + 29, centerY, 17, '#ffffff')
  drawLine(image, centerX, centerY - 29, centerX, centerY + 29, 17, '#ffffff')
}

function drawGear(image, centerX, centerY) {
  const white = colorToRgba('#ffffff')
  const outerRadius = 30
  const innerRadius = 17
  for (let y = -outerRadius; y <= outerRadius; y += 1) {
    for (let x = -outerRadius; x <= outerRadius; x += 1) {
      const distance = Math.sqrt(x * x + y * y)
      if (distance >= innerRadius && distance <= outerRadius) {
        setPixel(image, centerX + x, centerY + y, white)
      }
    }
  }
  drawCircle(image, centerX, centerY, 9, '#455a64')
  for (let tooth = 0; tooth < 8; tooth += 1) {
    const angle = tooth * Math.PI / 4
    drawLine(
      image,
      centerX + Math.cos(angle) * 26,
      centerY + Math.sin(angle) * 26,
      centerX + Math.cos(angle) * 35,
      centerY + Math.sin(angle) * 35,
      8,
      '#ffffff',
    )
  }
}

function drawCapsule(image, centerX, centerY) {
  const startX = centerX - 25
  const startY = centerY + 25
  const endX = centerX + 25
  const endY = centerY - 25
  drawLine(image, startX, startY, endX, endY, 32, '#ffffff')
  drawLine(image, startX, startY, endX, endY, 23, '#2f855a')
  drawLine(image, centerX, centerY, centerX + 4, centerY + 4, 3, '#ffffff')
}

function drawStethoscope(image, centerX, centerY) {
  const points = [
    [-28, -29], [-28, -7], [-25, 4], [-17, 14], [-7, 20], [7, 20], [17, 14], [25, 4], [28, -7], [28, -18],
  ]
  for (let index = 1; index < points.length; index += 1) {
    const [previousX, previousY] = points[index - 1]
    const [x, y] = points[index]
    drawLine(image, centerX + previousX, centerY + previousY, centerX + x, centerY + y, 7, '#ffffff')
  }
  drawCircle(image, centerX + 28, centerY - 27, 8, '#ffffff')
  drawCircle(image, centerX + 28, centerY - 27, 3, '#1f5f99')
}

function drawUtensils(image, centerX, centerY) {
  drawLine(image, centerX - 17, centerY - 5, centerX - 17, centerY + 31, 7, '#ffffff')
  for (let tine = -25; tine <= -9; tine += 8) {
    drawLine(image, centerX + tine, centerY - 30, centerX + tine, centerY - 8, 4, '#ffffff')
  }
  drawLine(image, centerX + 18, centerY, centerX + 18, centerY + 31, 7, '#ffffff')
  drawLine(image, centerX + 18, centerY - 26, centerX + 18, centerY - 2, 18, '#ffffff')
}

function resize(image, size) {
  const output = new PNG({ width: size, height: size })
  const ratio = image.width / size
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor((x + 0.5) * ratio))
      const sourceY = Math.min(image.height - 1, Math.floor((y + 0.5) * ratio))
      const sourceOffset = (sourceY * image.width + sourceX) * 4
      const outputOffset = (y * size + x) * 4
      image.data.copy(output.data, outputOffset, sourceOffset, sourceOffset + 4)
    }
  }
  return output
}
