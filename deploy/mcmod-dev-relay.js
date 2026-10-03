import { randomUUID } from 'node:crypto'

const ATTEMPT_TIMEOUT = 8000
const MAX_BYTES = 2 * 1024 * 1024

class UpstreamError extends Error {
  constructor(code, message, retryable = false, status) {
    super(message)
    Object.assign(this, { code, retryable, status })
  }
}

async function fetchHtml(query) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT)
  let upstream
  try {
    upstream = await fetch('https://dict.mcmod.cn/connection/search.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html',
        Referer: 'https://dict.mcmod.cn/',
        Origin: 'https://dict.mcmod.cn',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: new URLSearchParams({ key: query, max: '100', range: '1' }),
      signal: controller.signal,
      redirect: 'error',
    })
    if (!upstream.ok) {
      await upstream.body?.cancel()
      throw new UpstreamError(
        'UPSTREAM_HTTP',
        `MC百科返回 HTTP ${upstream.status}`,
        [502, 503, 504].includes(upstream.status),
        upstream.status,
      )
    }
    if (!upstream.headers.get('content-type')?.includes('text/html')) {
      await upstream.body?.cancel()
      throw new UpstreamError('UPSTREAM_CONTENT_TYPE', 'MC百科返回了非 HTML 响应')
    }
    if (!upstream.body) throw new UpstreamError('UPSTREAM_EMPTY', 'MC百科返回空响应', true)
    const reader = upstream.body.getReader()
    const chunks = []
    let size = 0
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BYTES) {
        await reader.cancel()
        throw new UpstreamError('UPSTREAM_TOO_LARGE', 'MC百科响应超过大小限制')
      }
      chunks.push(value)
    }
    const body = Buffer.concat(chunks)
    if (!body.toString('utf8').trim())
      throw new UpstreamError('UPSTREAM_EMPTY', 'MC百科返回空响应', true)
    return body
  } catch (error) {
    if (controller.signal.aborted)
      throw new UpstreamError('UPSTREAM_TIMEOUT', 'MC百科请求超时', true)
    if (error instanceof UpstreamError) throw error
    const networkError = new UpstreamError('UPSTREAM_NETWORK', '无法连接MC百科', true)
    networkError.cause = error
    throw networkError
  } finally {
    clearTimeout(timer)
  }
}

// Transport only: normalization, filtering and pagination run in the browser.
export default async function handler(req, res) {
  const requestId = randomUUID()
  res.setHeader('X-Mcmod-Request-Id', requestId)
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    res.statusCode = 405
    return res.end('Method Not Allowed')
  }
  const query = new URL(req.url, 'http://localhost').searchParams.get('q')?.trim()
  if (!query || query.length > 50) {
    res.statusCode = 400
    return res.end('搜索词必须为1到50个字符')
  }
  for (let attempt = 1; attempt <= 2; attempt++) {
    const start = Date.now()
    try {
      const body = await fetchHtml(query)
      res.setHeader('X-Mcmod-Attempts', String(attempt))
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300')
      res.statusCode = 200
      return res.end(body)
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'mcmod_upstream_failure',
          requestId,
          attempt,
          code: error.code,
          upstreamStatus: error.status,
          durationMs: Date.now() - start,
          cause: error.cause?.cause?.code || error.cause?.code || error.cause?.message,
          region: 'local',
        }),
      )
      if (attempt < 2 && error.retryable) {
        await new Promise((resolve) => setTimeout(resolve, 250))
        continue
      }
      res.statusCode = error.code === 'UPSTREAM_TIMEOUT' ? 504 : 502
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('X-Mcmod-Attempts', String(attempt))
      return res.end(JSON.stringify({ error: error.message, code: error.code, requestId }))
    }
  }
}
