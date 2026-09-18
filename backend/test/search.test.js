import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import worker from '../src/index.js'

const schema = readFileSync(new URL('../schema/search-indexes.sql', import.meta.url), 'utf8')
const allowLimiter = { limit: async () => ({ success: true }) }
const missCache = { match: async () => undefined, put: async () => {} }
globalThis.caches = { default: missCache }

function database(rows) {
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE dict(trans_name, origin_name, modid, version, "key", curseforge)')
  const insert = db.prepare('INSERT INTO dict VALUES (?, ?, ?, ?, ?, ?)')
  for (const [origin, translation, mod = 'example'] of rows) {
    insert.run(translation, origin, mod, '1.0', `item.${origin}`, mod)
  }
  db.exec(schema)
  return db
}

async function search(
  db,
  query,
  params = {},
  { limiter = allowLimiter, cache, calls, method = 'GET', path = '/search' } = {},
) {
  globalThis.caches = { default: cache || missCache }
  const url = new URL(`https://example.test${path}`)
  url.search = new URLSearchParams({ q: query, ...params })
  const response = await worker.fetch(
    new Request(url, { method }),
    {
      DB: {
        prepare(sql) {
          if (calls) calls.value += 1
          return {
            bind(...values) {
              return {
                all: async () => ({
                  results: db.prepare(sql).all(...values),
                }),
              }
            },
          }
        },
      },
      SEARCH_RATE_LIMITER: limiter,
    },
    { waitUntil() {} },
  )
  const body = await response.text()
  let data
  try {
    data = JSON.parse(body)
  } catch {
    data = body
  }
  return { response, data }
}

test('literal Chinese substrings preserve punctuation, ASCII folding and short tokens', async () => {
  const db = database([
    ['literal', '矿石_%\\箱ABC'],
    ['wildcard', '矿石XYZ箱ABC'],
    ['short', '铜锭'],
    ['long', '这是一个超过五十字节但不超过五十字符的中文矿石名称'],
  ])
  try {
    for (const [query, expected] of [
      ['矿石_%\\箱abc', 'literal'],
      ['铜', 'short'],
      ['铜锭', 'short'],
      ['这是一个超过五十字节但不超过五十字符的中文矿石名称', 'long'],
    ]) {
      const { response, data } = await search(db, query, { mode: 'zh2en' })
      assert.equal(response.status, 200)
      assert.deepEqual(
        data.results.map((row) => row.origin_name),
        [expected],
      )
    }
  } finally {
    db.close()
  }
})

test('mixed FTS, Chinese inclusion and exclusions retain matching semantics', async () => {
  const db = database([
    ['Iron 铜矿石', '一'],
    ['Iron 铜矿石 input', '二'],
    ['Gold 铜矿石', '三'],
    ['Iron 银矿石', '四'],
  ])
  try {
    const mixed = await search(db, 'Iron 铜矿石 -input')
    assert.deepEqual(
      mixed.data.results.map((row) => row.origin_name),
      ['Iron 铜矿石'],
    )
    const excluded = await search(db, '铜矿石 -Iron')
    assert.deepEqual(
      excluded.data.results.map((row) => row.origin_name),
      ['Gold 铜矿石'],
    )
  } finally {
    db.close()
  }
})

test('mod filtering precedes pagination, trims metadata, and retains global frequency', async () => {
  const db = database([
    ...Array.from({ length: 65 }, (_, i) => [`Iron ${i}`, `铁${i}`, 'other']),
    ['Iron target', '铁目标', 'wanted'],
    ['Iron target', '铁目标', 'other'],
  ])
  try {
    const { data } = await search(db, 'Iron', { mod: 'WANTED' })
    assert.equal(data.total, 1)
    assert.equal(data.hasMore, false)
    assert.equal(data.pageLimitReached, false)
    assert.deepEqual(
      data.results.map((row) => row.all_mods),
      ['wanted (1.0)'],
    )
    assert.equal(data.results[0].frequency, 2)
  } finally {
    db.close()
  }
})

test('pagination distinguishes lower bounds, final totals and empty offsets', async () => {
  const db = database(Array.from({ length: 51 }, (_, i) => [`Iron ${i}`, `铁${i}`]))
  try {
    const first = (await search(db, 'Iron')).data
    assert.equal(first.results.length, 50)
    assert.equal(first.total, 51)
    assert.equal(first.hasMore, true)
    assert.equal(first.pageLimitReached, false)
    assert.equal(first.totalIsExact, false)
    const last = (await search(db, 'Iron', { page: '2' })).data
    assert.equal(last.results.length, 1)
    assert.equal(last.total, 51)
    assert.equal(last.totalIsExact, true)
    const beyond = (await search(db, 'Iron', { page: '3' })).data
    assert.equal(beyond.total, null)
    assert.equal(beyond.totalIsExact, false)
    assert.equal(beyond.hasMore, false)
    assert.equal(beyond.pageLimitReached, false)
  } finally {
    db.close()
  }
})

test('missing indexes fail closed without caching errors or poisoning later requests', async () => {
  const db = new DatabaseSync(':memory:')
  try {
    const unavailable = await search(db, 'Iron')
    assert.equal(unavailable.response.status, 503)
    assert.equal(unavailable.response.headers.get('Cache-Control'), 'no-store')
    db.exec('CREATE TABLE dict(trans_name, origin_name, modid, version, "key", curseforge)')
    db.exec("INSERT INTO dict VALUES ('铁', 'Iron', 'example', '1', 'item.iron', '')")
    db.exec(schema)
    const available = await search(db, 'Iron')
    assert.equal(available.response.status, 200)
    assert.equal(available.data.results[0].origin_name, 'Iron')
  } finally {
    db.close()
  }
})

test('daily quota errors remain retryable and are not confused with storage limits', async () => {
  for (const limit of ['read', 'write', 'storage']) {
    const message =
      limit === 'storage'
        ? "Your account has exceeded D1's maximum account storage limit"
        : `Your account has exceeded D1's free tier daily row ${limit} limit.`
    const db = {
      prepare() {
        throw new Error(`D1_ERROR: ${message}`)
      },
    }
    const { response } = await search(db, 'Iron')
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
    if (limit === 'storage') {
      assert.equal(response.headers.get('Retry-After'), null)
    } else {
      assert.equal(response.status, 503)
      const retryAfter = Number(response.headers.get('Retry-After'))
      assert.ok(retryAfter > 0 && retryAfter <= 86400)
    }
  }
})

test('strict page parsing rejects malformed values before cache, limiter, or D1', async () => {
  const calls = { value: 0 }
  const cacheCalls = { value: 0 }
  const limiterCalls = { value: 0 }
  const cache = {
    match: async () => {
      cacheCalls.value += 1
      return undefined
    },
    put: async () => {},
  }
  const limiter = {
    limit: async () => {
      limiterCalls.value += 1
      return { success: true }
    },
  }
  const db = {
    prepare() {
      throw new Error('D1 must not be called')
    },
  }
  for (const page of ['', '0', '-1', '1.0', '1e2', '101', '999999999999999999999999999999']) {
    const { response } = await search(db, 'Iron', { page }, { calls, cache, limiter })
    assert.equal(response.status, 400, page)
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
  }
  assert.equal(cacheCalls.value, 0)
  assert.equal(limiterCalls.value, 0)
  assert.equal(calls.value, 0)
})

test('page 100 reports whether the query was capped by a real extra row', async () => {
  for (const count of [5000, 5001]) {
    const db = database(Array.from({ length: count }, (_, i) => [`Iron ${i}`, `铁${i}`]))
    try {
      const { response, data } = await search(db, 'Iron', { page: '100' })
      assert.equal(response.status, 200)
      assert.equal(data.results.length, 50)
      assert.equal(data.total, count)
      assert.equal(data.totalIsExact, count === 5000)
      assert.equal(data.hasMore, false)
      assert.equal(data.pageLimitReached, count === 5001)
    } finally {
      db.close()
    }
  }
})

test('cause-wrapped missing-table and daily-quota errors classify through cycles', async () => {
  const missingCause = new Error('no such table: dict_search_fts')
  const missingWrapper = new Error('query wrapper', { cause: missingCause })
  missingCause.cause = missingWrapper
  const missing = await search(
    {
      prepare: () => {
        throw missingWrapper
      },
    },
    'Iron',
  )
  assert.equal(missing.response.status, 503)
  assert.equal(missing.response.headers.get('Cache-Control'), 'no-store')
  assert.equal(missing.response.headers.get('Retry-After'), '60')
  assert.doesNotMatch(JSON.stringify(missing.data), /no such table/)

  const quotaCause = new Error("Your account has exceeded D1's free tier daily row read limit.")
  const quotaWrapper = new Error('query wrapper', { cause: quotaCause })
  quotaCause.cause = quotaWrapper
  const quota = await search(
    {
      prepare: () => {
        throw quotaWrapper
      },
    },
    'Iron',
  )
  assert.equal(quota.response.status, 503)
  assert.equal(quota.response.headers.get('Cache-Control'), 'no-store')
  const retryAfter = Number(quota.response.headers.get('Retry-After'))
  assert.ok(retryAfter > 0 && retryAfter <= 86400)
  assert.doesNotMatch(JSON.stringify(quota.data), /free tier/)
})

test('limiter denial blocks D1 while a cached success bypasses limiter denial', async () => {
  const db = database([['Iron', '铁']])
  const calls = { value: 0 }
  let cachedResponse
  const cache = {
    match: async () => cachedResponse?.clone(),
    put: async (_key, response) => {
      cachedResponse = response
    },
  }
  try {
    const denied = await search(
      db,
      'Iron',
      {},
      { cache: missCache, limiter: { limit: async () => ({ success: false }) }, calls },
    )
    assert.equal(denied.response.status, 429)
    assert.equal(denied.response.headers.get('Cache-Control'), 'no-store')
    assert.equal(denied.response.headers.get('Retry-After'), '60')
    assert.equal(calls.value, 0)

    const first = await search(db, 'Iron', {}, { cache, calls })
    assert.equal(first.response.status, 200)
    assert.equal(calls.value, 1)
    const cached = await search(
      db,
      'Iron',
      {},
      { cache, limiter: { limit: async () => ({ success: false }) }, calls },
    )
    assert.equal(cached.response.status, 200)
    assert.equal(cached.data.results[0].origin_name, 'Iron')
    const cachedOutage = await search(
      db,
      'Iron',
      {},
      {
        cache,
        limiter: {
          limit: async () => {
            throw new Error('limiter outage')
          },
        },
        calls,
      },
    )
    assert.equal(cachedOutage.response.status, 200)
    assert.equal(cachedOutage.data.results[0].origin_name, 'Iron')
    assert.equal(calls.value, 1)
  } finally {
    db.close()
  }
})

test('missing or throwing limiter fails closed before D1', async () => {
  const calls = { value: 0 }
  const db = {
    prepare() {
      throw new Error('D1 must not be called')
    },
  }
  for (const limiter of [
    null,
    {
      limit: async () => {
        throw new Error('limiter outage')
      },
    },
  ]) {
    const { response } = await search(db, 'Iron', {}, { limiter, calls })
    assert.equal(response.status, 503)
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
  }
  assert.equal(calls.value, 0)
})

test('method and route errors are never publicly cacheable', async () => {
  const db = {
    prepare: () => {
      throw new Error('D1 must not be called')
    },
  }
  const method = await search(db, 'Iron', {}, { method: 'POST' })
  const route = await search(db, 'Iron', {}, { path: '/other' })
  assert.equal(method.response.status, 405)
  assert.equal(method.response.headers.get('Cache-Control'), 'no-store')
  assert.equal(route.response.status, 404)
  assert.equal(route.response.headers.get('Cache-Control'), 'no-store')
})
