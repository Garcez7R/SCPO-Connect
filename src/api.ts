function readableApiError(detail: unknown): string {
  if (detail instanceof Error) {
    if (/failed to fetch|networkerror|load failed/i.test(detail.message)) {
      return 'Não foi possível conectar ao serviço. Verifique se a API correspondente está em execução e tente novamente.'
    }
    return detail.message
  }
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const issues = detail.flatMap((issue) => {
      if (!issue || typeof issue !== 'object') return []
      const item = issue as { loc?: unknown[]; msg?: unknown }
      const field = Array.isArray(item.loc) ? item.loc.filter((part) => part !== 'body').at(-1) : undefined
      const label = field === 'username' ? 'Usuário' : field === 'name' ? 'Nome' : field === 'x_bootstrap_token' ? 'Token' : 'Campo'
      const message = typeof item.msg === 'string' ? item.msg : 'valor inválido'
      return [`${label}: ${message}`]
    })
    if (issues.length) return issues.join(' ')
  }
  if (detail && typeof detail === 'object' && 'message' in detail) {
    const message = (detail as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return 'Não foi possível concluir esta etapa. Confira os campos e tente novamente.'
}

export async function readApiResponse<T>(response: Response): Promise<T> {
  const body = await response.text()
  let data: unknown
  try {
    data = body ? JSON.parse(body) as unknown : {}
  } catch {
    const plainText = body.trim()
    const usefulText = plainText && !plainText.startsWith('<') ? plainText.slice(0, 180) : ''
    const detail = usefulText || `O servidor não retornou JSON válido (HTTP ${response.status}).`
    throw new Error(response.ok ? detail : `HTTP ${response.status}: ${detail}`)
  }
  if (!response.ok) {
    const detail = data && typeof data === 'object' && 'detail' in data
      ? (data as { detail: unknown }).detail
      : response.status >= 500
        ? `O serviço está indisponível (HTTP ${response.status}). Tente novamente em instantes ou avise a equipe responsável.`
        : `Erro HTTP ${response.status}.`
    throw new Error(readableApiError(detail))
  }
  return data as T
}

export { readableApiError }
