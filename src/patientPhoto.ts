const MAX_PHOTO_EDGE = 900

function drawSquareImage(image: CanvasImageSource, width: number, height: number): string {
  const side = Math.min(width, height)
  const sourceX = (width - side) / 2
  const sourceY = (height - side) / 2
  const outputSize = Math.min(MAX_PHOTO_EDGE, side)
  const canvas = document.createElement('canvas')
  canvas.width = outputSize
  canvas.height = outputSize
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Não foi possível processar a imagem selecionada.')
  context.drawImage(image, sourceX, sourceY, side, side, 0, 0, outputSize, outputSize)
  return canvas.toDataURL('image/jpeg', 0.82)
}

export function squareVideoFrame(video: HTMLVideoElement): string {
  if (!video.videoWidth || !video.videoHeight) throw new Error('Aguarde a câmera iniciar antes de tirar a foto.')
  return drawSquareImage(video, video.videoWidth, video.videoHeight)
}

export function squareImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const objectUrl = URL.createObjectURL(file)
    image.onload = () => {
      try {
        resolve(drawSquareImage(image, image.naturalWidth, image.naturalHeight))
      } catch (error) {
        reject(error)
      } finally {
        URL.revokeObjectURL(objectUrl)
      }
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Não foi possível ler a imagem selecionada.'))
    }
    image.src = objectUrl
  })
}
