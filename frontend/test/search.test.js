import assert from 'node:assert/strict'
import test, { beforeEach } from 'node:test'
import { applyModFilter, search } from '../services/searchService.js'
import { updateState, useStore } from '../store.js'

beforeEach((context) => {
  context.mock.timers.enable({ apis: ['Date'], now: 10_000 })
})

function reset(query) {
  updateState({
    searchQuery: query,
    searchMode: 'en2zh',
    modFilterValue: '',
    appliedModFilter: '',
    currentPage: 1,
    currentApiResults: [],
    searchLoading: false,
    lastSearchTime: 0,
    lastFullSearchKey: '',
    lastSearchQuery: '',
    hasMoreResults: false,
    pageLimitReached: false,
    availableMods: [],
    totalApiMatches: null,
    totalIsExact: false,
    resultsUiMessage: '',
    searchInfoMessage: '',
  })
}

function pageResponse(page) {
  return Response.json({
    results: [{ origin_name: `Iron page ${page}`, trans_name: '铁', all_mods: 'example (1)' }],
    total: 151,
    hasMore: true,
    totalIsExact: false,
  })
}

test('explicit submission restores a cached result after invalid input without another fetch', async () => {
  reset('restore')
  let requests = 0
  globalThis.fetch = async () => {
    requests += 1
    return pageResponse(1)
  }
  await search(true)
  updateState({ searchQuery: '' })
  await search(true)
  assert.equal(useStore().totalApiMatches, null)
  updateState({ searchQuery: 'restore' })
  await search(true)
  assert.equal(useStore().resultsUiMessage, '')
  assert.equal(useStore().currentApiResults[0].origin_name, 'Iron page 1')
  assert.equal(useStore().hasMoreResults, true)
  assert.equal(requests, 1)
})

test('pending and throttled page requests cannot change the displayed page', async () => {
  reset('pages')
  let finishPage
  globalThis.fetch = async (input) => {
    const page = Number(new URL(input).searchParams.get('page'))
    if (page === 2)
      return new Promise((resolve) => {
        finishPage = () => resolve(pageResponse(2))
      })
    return pageResponse(page)
  }
  await search(true)
  await search(false, 2)
  assert.equal(useStore().currentPage, 1)
  updateState({ lastSearchTime: 0 })
  const pending = search(false, 2)
  await search(false, 3)
  assert.equal(useStore().currentPage, 1)
  finishPage()
  await pending
  assert.equal(useStore().currentPage, 2)
  assert.equal(useStore().currentApiResults[0].origin_name, 'Iron page 2')
})

test('failed page keeps its predecessor available and displays the server error', async () => {
  reset('quota')
  globalThis.fetch = async () => pageResponse(1)
  await search(true)
  updateState({ lastSearchTime: 0 })
  globalThis.fetch = async () => Response.json({ error: 'D1 今日额度已用尽' }, { status: 503 })
  await search(false, 2)
  assert.equal(useStore().currentPage, 1)
  assert.equal(useStore().currentApiResults[0].origin_name, 'Iron page 1')
  assert.equal(useStore().resultsUiMessage, 'D1 今日额度已用尽')
  await search(true)
  assert.equal(useStore().resultsUiMessage, '')
})

test('uncached explicit searches are throttled without changing the displayed page', async () => {
  reset('explicit-throttle')
  let requests = 0
  globalThis.fetch = async () => {
    requests += 1
    return pageResponse(1)
  }
  updateState({ lastSearchTime: Date.now() })

  const result = await search(true)
  assert.equal(result.status, 'throttled')
  assert.equal(requests, 0)
  assert.equal(useStore().currentPage, 1)
  assert.deepEqual(useStore().currentApiResults, [])

  updateState({ lastSearchTime: 0 })
  const accepted = await search(true)
  assert.equal(accepted.status, 'accepted')
  assert.equal(requests, 1)
})

test('mod filters obey the uncached request interval and preserve server frequency', async () => {
  reset('filter-throttle')
  globalThis.fetch = async () =>
    Response.json({
      results: [
        {
          origin_name: 'Iron',
          trans_name: '铁',
          all_mods: 'example (1), other (1)',
          frequency: 2,
        },
      ],
      total: 1,
      hasMore: false,
      totalIsExact: true,
    })
  await search(true)

  updateState({ modFilterValue: 'example', lastSearchTime: Date.now() })
  const throttled = await applyModFilter()
  assert.equal(throttled.status, 'throttled')
  assert.equal(useStore().appliedModFilter, '')
  assert.equal(useStore().currentApiResults[0].frequency, 2)

  updateState({ lastSearchTime: 0 })
  globalThis.fetch = async () =>
    Response.json({
      results: [
        {
          origin_name: 'Iron',
          trans_name: '铁',
          all_mods: 'example (1)',
          frequency: 2,
        },
      ],
      mod: 'example',
      total: 1,
      hasMore: false,
      totalIsExact: true,
    })
  const accepted = await applyModFilter()
  assert.equal(accepted.status, 'accepted')
  assert.equal(useStore().currentApiResults[0].all_mods, 'example (1)')
  assert.equal(useStore().currentApiResults[0].frequency, 2)
})

test('cached navigation restores and clears the cap notice for the correct page', async () => {
  reset('page-cap')
  let requests = 0
  globalThis.fetch = async (input) => {
    requests += 1
    const page = Number(new URL(input).searchParams.get('page'))
    return Response.json({
      results: [{ origin_name: `Iron ${page}`, trans_name: '铁', frequency: 1 }],
      total: page === 100 ? 5001 : 51,
      totalIsExact: false,
      hasMore: page < 100,
      pageLimitReached: page === 100,
    })
  }

  await search(true)
  updateState({ lastSearchTime: 0 })
  await search(false, 100)
  assert.equal(useStore().currentPage, 100)
  assert.equal(useStore().hasMoreResults, false)
  assert.equal(useStore().pageLimitReached, true)
  await search(false, 1)
  assert.equal(useStore().currentPage, 1)
  assert.equal(useStore().pageLimitReached, false)
  assert.equal(useStore().hasMoreResults, true)
  await search(false, 100)
  assert.equal(useStore().currentPage, 100)
  assert.equal(useStore().pageLimitReached, true)
  assert.equal(requests, 2)
})

test('throttling a new search preserves the applied filter of displayed results', async () => {
  reset('old-query')
  updateState({
    lastFullSearchKey: JSON.stringify(['old-query', 'en2zh', 3, 'example']),
    currentPage: 3,
    modFilterValue: 'example',
    appliedModFilter: 'example',
    availableMods: ['example'],
    currentApiResults: [{ origin_name: 'Old item' }],
    lastSearchTime: Date.now(),
    searchQuery: 'new-query',
  })
  globalThis.fetch = async () => {
    throw new Error('Throttled search must not fetch')
  }
  const result = await search(true)
  assert.equal(result.status, 'throttled')
  assert.equal(useStore().currentPage, 3)
  assert.equal(useStore().appliedModFilter, 'example')
  assert.equal(useStore().modFilterValue, 'example')
  assert.equal(useStore().currentApiResults[0].origin_name, 'Old item')
})
