import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMcmodHtml, mcmodPage } from './mcmodParser.js'
import { requestSearch } from './apiClient.js'
import { highlightQuery } from '../utils.js'

const html = `<p>在 702734 项中找到 120 个结果。</p><table><tr><th>翻译结果</th><th>原文</th><th>所属模组</th><th>出现频率</th></tr>
<tr title="key.a&#10;key.a&#10;key.b"><td>蜜蜂 &amp; &lt;img src=x onerror=alert(1)&gt;<script>bad()</script></td><td><code>Bee</code></td><td>test (1.20) <a href="https://www.curseforge.com/minecraft/mc-mods/test/"><svg></svg></a>,<br>test (1.21) <a href="javascript:alert(1)"><svg></svg></a>,<br>other (1.20) <a href="https://www.curseforge.com/minecraft/mc-mods/Unknown/"><svg></svg></a></td><td>3 个模组, 5 处.</td></tr></table>`

test('local parser removes markup, decodes text, merges mods and preserves unassigned keys', () => {
  const snapshot = parseMcmodHtml(html)
  const row = snapshot.results[0]
  assert.equal(row.trans_name, '蜜蜂 & <img src=x onerror=alert(1)>')
  assert.ok(!highlightQuery(row.trans_name, 'bee').includes('<img'))
  assert.equal(row.origin_name, 'Bee')
  assert.equal(row.all_mods, 'test (1.20/1.21), other (1.20)')
  assert.equal(row.all_curseforges, 'test,')
  assert.equal(row.all_keys, ',')
  assert.equal(row.frequency, 2)
  assert.deepEqual(row.source_keys, ['key.a', 'key.b'])
  const filtered = mcmodPage(snapshot, { query: 'bee', mode: 'en2zh', modFilter: 'test', page: 1 })
  assert.equal(filtered.results[0].all_mods, 'test (1.20/1.21)')
  assert.equal(filtered.results[0].frequency, 2)
  assert.equal(filtered.totalIsExact, false)
  assert.equal(filtered.hasMore, false)
})

test('empty and unexpected HTML fail while real zero results succeed', () => {
  assert.throws(() => parseMcmodHtml(''))
  assert.throws(() => parseMcmodHtml('<html>Vite fallback</html>'))
  assert.throws(() => parseMcmodHtml(html.replace('所属模组', 'Changed')))
  assert.equal(parseMcmodHtml('<p>在 702734 项中没有找到结果。</p>').results.length, 0)
})

test('MC百科 requests only same-site raw relay; pages and filters use local snapshot', async () => {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url) => {
    calls.push(url)
    return new Response(html)
  }
  try {
    const options = { query: 'bee-local', mode: 'en2zh', source: 'mcmod', page: 1 }
    const result = await requestSearch(options)
    assert.equal(result.source, 'mcmod')
    assert.deepEqual(calls, ['/api/mcmod?q=bee-local'])
    assert.equal((await requestSearch({ ...options, page: 2 })).results.length, 0)
    assert.equal(
      (await requestSearch({ ...options, modFilter: 'other' })).results[0].all_mods,
      'other (1.20)',
    )
    assert.equal(calls.length, 1)
  } finally {
    globalThis.fetch = original
  }
})

test('relay error details and request ID reach the user', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () =>
    Response.json(
      { error: 'MC百科请求超时', code: 'UPSTREAM_TIMEOUT', requestId: 'test-id' },
      { status: 504 },
    )
  try {
    await assert.rejects(
      requestSearch({ query: 'error-detail', mode: 'en2zh', source: 'mcmod', page: 1 }),
      (error) => {
        assert.match(error.message, /MC百科请求超时/)
        assert.match(error.message, /test-id/)
        assert.equal(error.code, 'UPSTREAM_TIMEOUT')
        assert.equal(error.status, 504)
        return true
      },
    )
  } finally {
    globalThis.fetch = original
  }
})
