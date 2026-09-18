import { API_BASE_URL } from '../store.js'

export async function requestSearch({ query, page, mode, modFilter, signal }) {
  const params = new URLSearchParams({ q: query, page: String(page), mode })
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
      throw new Error(text || `请求失败: ${response.status}`)
    }
    throw error
  }

  if (!response.ok) {
    const message = data?.error || data?.message || data?.details || `请求失败: ${response.status}`
    const requestError = new Error(message)
    requestError.status = response.status
    throw requestError
  }

  return data
}
