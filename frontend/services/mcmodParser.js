import { parseFragment } from 'parse5'

const ignored = new Set(['script', 'style', 'svg', 'iframe', 'object', 'template'])
const children = (node) => node.childNodes || []
const attr = (node, name) => node.attrs?.find((a) => a.name === name)?.value || ''
function text(node) {
  if (ignored.has(node.tagName)) return ''
  if (node.nodeName === '#text') return node.value
  if (node.tagName === 'br') return '\n'
  return children(node).map(text).join('')
}
function find(node, tag) {
  if (ignored.has(node.tagName)) return []
  return [...(node.tagName === tag ? [node] : []), ...children(node).flatMap((n) => find(n, tag))]
}

function parseMods(cell) {
  const groups = [[]]
  for (const node of children(cell)) {
    if (node.tagName === 'br') groups.push([])
    else groups.at(-1).push(node)
  }
  const mods = new Map()
  for (const childNodes of groups) {
    const fragment = { childNodes }
    const match = text(fragment)
      .trim()
      .replace(/,$/, '')
      .trim()
      .match(/^([^,]+?)\s+\(([^)]+)\)$/)
    if (!match) throw new Error('MC百科模组数据格式已变化')
    const [, id, version] = match
    let slug = ''
    for (const link of find(fragment, 'a')) {
      try {
        const url = new URL(attr(link, 'href'))
        const path = url.pathname.match(/^\/minecraft\/mc-mods\/([a-zA-Z0-9_-]+)\/?$/)
        if (
          url.protocol === 'https:' &&
          url.hostname === 'www.curseforge.com' &&
          path &&
          path[1].toLowerCase() !== 'unknown'
        )
          slug = path[1]
      } catch {
        /* Ignore non-project links. */
      }
    }
    if (!mods.has(id)) mods.set(id, { versions: new Set(), slug })
    mods.get(id).versions.add(version)
    if (!mods.get(id).slug) mods.get(id).slug = slug
  }
  return mods
}

export function parseMcmodHtml(html) {
  if (!html.trim()) throw new Error('MC百科返回空响应，请稍后重试')
  const root = parseFragment(html)
  const summary = find(root, 'p').map(text).join(' ')
  const count = summary.match(/找到\s*(\d+)\s*个结果/)
  const tables = find(root, 'table')
  if (!tables.length && /没有找到结果/.test(summary))
    return { results: [], upstreamTotal: 0, truncated: false }
  if (!count || tables.length !== 1) throw new Error('MC百科响应格式无法识别，请稍后重试')
  const table = tables[0]
  if (find(table, 'th').map(text).join('|') !== '翻译结果|原文|所属模组|出现频率')
    throw new Error('MC百科表格结构已变化')
  const results = []
  for (const row of find(table, 'tr')) {
    const cells = children(row).filter((node) => node.tagName === 'td')
    if (!cells.length) continue
    if (cells.length !== 4) throw new Error('MC百科结果列数异常')
    const mods = parseMods(cells[2])
    results.push({
      trans_name: text(cells[0]).trim(),
      origin_name: text(cells[1]).trim(),
      all_mods: [...mods].map(([id, data]) => `${id} (${[...data.versions].join('/')})`).join(', '),
      // Upstream row titles cannot be reliably associated with individual mods.
      all_keys: [...mods].map(() => '').join(','),
      all_curseforges: [...mods.values()].map((data) => data.slug).join(','),
      frequency: mods.size,
      source_keys: [
        ...new Set(
          attr(row, 'title')
            .split('\n')
            .map((key) => key.trim())
            .filter(Boolean),
        ),
      ],
    })
  }
  if (!results.length) throw new Error('MC百科返回了不完整的结果表格')
  const upstreamTotal = Number(count[1])
  return { results, upstreamTotal, truncated: upstreamTotal > results.length }
}

export function filterResultForMod(result, modFilter) {
  if (!modFilter) return result

  const selectedMod = modFilter.toLowerCase()
  const mods = String(result.all_mods || '').split(', ')
  const keys = String(result.all_keys || '').split(',')
  const curseforges = String(result.all_curseforges || '').split(',')
  const selectedIndexes = []

  mods.forEach((mod, index) => {
    const match = mod.match(/^(.*) \(.*\)$/)
    const modId = (match ? match[1] : mod).trim().toLowerCase()
    if (modId === selectedMod) selectedIndexes.push(index)
  })

  if (selectedIndexes.length === 0) return null

  return {
    ...result,
    all_mods: selectedIndexes.map((index) => mods[index]).join(', '),
    all_keys: selectedIndexes.map((index) => keys[index] || '').join(','),
    all_curseforges: selectedIndexes.map((index) => curseforges[index] || '').join(','),
  }
}

export function mcmodPage(snapshot, { query, mode, modFilter, page }) {
  const filtered = snapshot.results.map((row) => filterResultForMod(row, modFilter)).filter(Boolean)
  const offset = (page - 1) * 50
  return {
    query,
    mode,
    mod: modFilter,
    page,
    source: 'mcmod',
    results: filtered.slice(offset, offset + 50),
    total: filtered.length,
    totalIsExact: !snapshot.truncated,
    hasMore: offset + 50 < filtered.length,
    pageLimitReached: false,
    upstreamTotal: snapshot.upstreamTotal,
    sourceNotice:
      'MC百科：分页与模组筛选仅针对本次返回的最多100条；Key为整行汇总，可能被上游截断。' +
      (snapshot.truncated ? ' 上游还有更多匹配，请细化关键词。' : ''),
  }
}
