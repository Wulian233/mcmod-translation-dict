import { API_BASE_URL } from '../store.js'

export async function requestSearch({ query, page, mode, signal }) {
  const url = `${API_BASE_URL}/search?q=${encodeURIComponent(query)}&page=${page}&mode=${mode}`
  const response = await fetch(url, { signal })

  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`)
  }

  return response.json()
}
