import { API_BASE_URL } from '../store.js'

export async function requestSearch({ query, page, mode, modFilter, signal }) {
  const params = new URLSearchParams({ q: query, page: String(page), mode })
  if (modFilter) params.set('mod', modFilter)
  // API behavior changed; keep this in sync when cached response semantics change.
  params.set('v', '3')
  const url = `${API_BASE_URL}/search?${params}`
  const response = await fetch(url, { signal })

  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`)
  }

  return response.json()
}
