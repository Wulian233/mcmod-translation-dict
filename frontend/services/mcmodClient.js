import { parseMcmodHtml, mcmodPage } from './mcmodParser.js'

const snapshots = new Map()
const TTL = 5 * 60 * 1000

export async function requestMcmod({ query, mode, modFilter = '', page = 1, signal }) {
  if (mode !== 'en2zh') throw new Error('MC百科当前仅支持英文查中文')
  let snapshot = snapshots.get(query)
  if (!snapshot || snapshot.expires <= Date.now()) {
    // Same-site relay only supplies HTML; no request goes to the D1 API.
    const response = await fetch(`/api/mcmod?${new URLSearchParams({ q: query })}`, { signal })
    if (!response.ok) {
      let detail
      if (response.headers.get('content-type')?.includes('application/json')) {
        try {
          detail = await response.json()
        } catch {
          /* Platform errors may not be JSON. */
        }
      }
      const error = new Error(
        response.status === 404
          ? '百科转发接口未部署，请将 api/mcmod.js 随网站一起部署'
          : (typeof detail?.error === 'string'
              ? detail.error
              : `MC百科请求失败 (${response.status})`) +
              (typeof detail?.requestId === 'string' ? `（请求编号：${detail.requestId}）` : ''),
      )
      error.status = response.status
      error.code = detail?.code
      throw error
    }
    const html = await response.text()
    if (html.length > 2 * 1024 * 1024) throw new Error('MC百科响应超过大小限制')
    snapshot = { data: parseMcmodHtml(html), expires: Date.now() + TTL }
    snapshots.delete(query)
    snapshots.set(query, snapshot)
    if (snapshots.size > 20) snapshots.delete(snapshots.keys().next().value)
  }
  return mcmodPage(snapshot.data, { query, mode, modFilter, page })
}
