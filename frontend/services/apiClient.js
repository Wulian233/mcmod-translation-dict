import { API_BASE_URL } from '../store.js'
import { extractModIds } from '../utils.js'

export async function requestSearch(options) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.source === 'mcmod' ? 22000 : 15000)
  options.signal?.addEventListener('abort', abort, { once: true })
  if (options.signal?.aborted) abort()
  try {
    return await performSearch({ ...options, signal: controller.signal })
  } catch (error) {
    if (timedOut && !options.signal?.aborted) {
      const timeout = new Error('请求超时，请稍后重试')
      timeout.name = 'TimeoutError'
      throw timeout
    }
    throw error
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
  }
}

async function performSearch({ query, page, mode, modFilter, source = 'extended', signal }) {
  if (source === 'mcmod') {
    const { requestMcmod } = await import('./mcmodClient.js')
    return requestMcmod({ query, page, mode, modFilter, signal })
  }
  const params = new URLSearchParams({ q: query, page: String(page), mode })
  params.set('source', source)
  if (modFilter) params.set('mod', modFilter)
  // v5 includes page-cap metadata and the current global-frequency contract.
  params.set('v', '5')
  const url = `${API_BASE_URL}/search?${params}`
  const response = await fetch(url, { signal })
  let data
  try {
    data = await response.json()
  } catch (error) {
    if (!response.ok) {
      let text = ''
      if (typeof response.text === 'function') {
        try {
          text = (await response.text()).trim()
        } catch {
          // Fall back to the HTTP status when the error body is not readable.
        }
      }
      const requestError = new Error(text || `请求失败: ${response.status}`)
      requestError.status = response.status
      throw requestError
    }
    throw error
  }

  if (!response.ok) {
    const message = data?.error || data?.message || data?.details || `请求失败: ${response.status}`
    const requestError = new Error(message)
    requestError.status = response.status
    throw requestError
  }

  if (modFilter) {
    const expectedMod = modFilter.trim().toLowerCase()
    const confirmedMod = typeof data?.mod === 'string' ? data.mod.trim().toLowerCase() : ''
    const validResults =
      Array.isArray(data?.results) &&
      data.results.every((result) => {
        const mods = extractModIds(result.all_mods)
        return mods.length > 0 && mods.every((mod) => mod.toLowerCase() === expectedMod)
      })
    if (confirmedMod !== expectedMod || !validResults) {
      throw new Error('服务器未正确应用模组筛选，请等待后端更新后重试。')
    }
  }

  return data
}
