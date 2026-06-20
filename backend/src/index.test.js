import assert from 'node:assert/strict'
import { describe, it, beforeEach } from 'node:test'

import worker, { buildSearchPlan } from './index.js'

function createMockEnv() {
  const prepared = []
  const env = {
    DB: {
      prepare(sql) {
        const statement = {
          sql,
          params: [],
          bind(...params) {
            statement.params = params
            prepared.push(statement)
            return statement
          },
          async all() {
            return {
              results: [
                {
                  trans_name: '卷心菜',
                  origin_name: 'Cabbage',
                  all_mods: 'example (1.0)',
                  all_keys: 'item.example.cabbage',
                  all_curseforges: '',
                  frequency: 1,
                },
              ],
            }
          },
        }
        return statement
      },
      async batch(statements) {
        return [
          await statements[0].all(),
          {
            results: [{ total: 1 }],
          },
        ]
      },
    },
    prepared,
  }

  return env
}

describe('search planning', () => {
  it('uses substring SQL filters for CJK tokens', () => {
    assert.deepEqual(buildSearchPlan('菜', 'trans_name'), {
      ftsQuery: '',
      sqlConditions: ["trans_name LIKE ? ESCAPE '\\'"],
      sqlParams: ['%菜%'],
    })
  })

  it('uses substring SQL filters for CJK expand tokens', () => {
    assert.deepEqual(buildSearchPlan('菜+', 'trans_name'), {
      ftsQuery: '',
      sqlConditions: ["trans_name LIKE ? ESCAPE '\\'"],
      sqlParams: ['%菜%'],
    })
  })

  it('uses substring SQL filters for excluded CJK expand tokens', () => {
    assert.deepEqual(buildSearchPlan('卷心 -菜+', 'trans_name'), {
      ftsQuery: '',
      sqlConditions: ["trans_name LIKE ? ESCAPE '\\'", "trans_name NOT LIKE ? ESCAPE '\\'"],
      sqlParams: ['%卷心%', '%菜%'],
    })
  })

  it('keeps existing FTS behavior for English tokens', () => {
    assert.deepEqual(buildSearchPlan('cabbage', 'origin_name'), {
      ftsQuery: 'origin_name:"cabbage"',
      sqlConditions: [],
      sqlParams: [],
    })
  })

  it('keeps existing FTS expand behavior for English tokens', () => {
    assert.deepEqual(buildSearchPlan('cabbage+', 'origin_name'), {
      ftsQuery: '(origin_name:"cabbage"* NOT origin_name:"cabbage")',
      sqlConditions: [],
      sqlParams: [],
    })
  })
})

describe('/search', () => {
  beforeEach(() => {
    globalThis.caches = {
      default: {
        async match() {
          return null
        },
        async put() {},
      },
    }
  })

  it('searches Chinese terms by substring instead of FTS prefix matching', async () => {
    const env = createMockEnv()
    const response = await worker.fetch(
      new Request('https://api.example/search?q=%E8%8F%9C&mode=zh2en'),
      env,
      { waitUntil() {} },
    )
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.equal(body.total, 1)
    assert.equal(body.results[0].trans_name, '卷心菜')

    const [resultsStatement, countStatement] = env.prepared
    assert.match(resultsStatement.sql, /FROM dict_mod_bundle AS b/)
    assert.doesNotMatch(resultsStatement.sql, /MATCH/)
    assert.match(resultsStatement.sql, /trans_name LIKE \? ESCAPE '\\'/)
    assert.deepEqual(resultsStatement.params, ['菜', '%菜%', 50, 0])
    assert.deepEqual(countStatement.params, ['%菜%'])
  })
})
