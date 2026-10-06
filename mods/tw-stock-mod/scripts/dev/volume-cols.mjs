// The 量 column and the width-driven column switch, offline: a 7-symbol
// Taiwan quotes file (with `amount`) through the real register.tsx and
// board.tsx at a wide and a narrow terminal. Wide draws both halves with
// 變更$ and 量 on one page; narrow drops to the single-column table AND
// pages 5 at a time, so ranks 6-7 are a page away instead of never drawn.
// Usage: node volume-cols.mjs <register.js> <board.js>
import { ok, done } from './assert.mjs'
globalThis.h = (type, props, ...kids) => ({ type, props: props ?? {}, kids: kids.flat() })
globalThis.Fragment = 'Fragment'
const [, , regPath, boardPath] = process.argv

const codes = ['1101', '1216', '1301', '2002', '2412', '2603', '2882']
const files = {
  '.claude/stock-band.json': JSON.stringify({ market: 'tw', feed: 'off', animation: 'off', tw: codes.map(code => ({ code })) }),
  '.claude/stock-quotes.json': JSON.stringify({
    asOf: Date.now(),
    market: 'tw',
    quotes: Object.fromEntries(codes.map((c, i) => [c, { price: 100 + i, prevClose: 100, amount: 32104 + i }])),
  }),
}
const $ = {
  command: { register: async () => {} },
  store: { get: async () => undefined, set: async () => {} },
  clock: { now: async () => Date.now(), every: () => {} },
  fs: { read: async p => { if (p in files) return files[p]; throw new Error('ENOENT ' + p) } },
  ui: { log: () => {}, invalidate: () => {}, resolve: async () => ({ Box: 'Box', Button: 'Button', Client: 'Client' }) },
  http: { fetch: async () => ({ ok: false, status: 599, text: '' }) },
  env: { get: async () => undefined },
  session: { cwd: async () => '/nonexistent' },
  process: {},
}
const handlers = new Map()
const { register } = await import(regPath)
register((e, a, b) => handlers.set(e, typeof a === 'function' ? a : b))
await handlers.get('session.start')($, {}, async () => ({ kids: [] }))
const board = (await import(boardPath)).default

const text = (n, acc = []) => {
  if (n == null || n === false) return acc
  if (typeof n === 'string' || typeof n === 'number') { acc.push(String(n)); return acc }
  for (const k of [...(n.kids ?? []), ...(n.props?.children != null ? [n.props.children] : [])]) text(k, acc)
  return acc
}
const render = async cols => {
  const tree = await handlers.get('ui.render')($, { props: {}, surface: 'terminal', viewport: { columns: cols } }, async () => ({ kids: [] }))
  let props
  const walk = n => { if (!n || typeof n !== 'object') return; if (n.type === 'Client') props = n.props.props; for (const k of n.kids ?? []) walk(k) }
  walk(tree)
  let state
  const surface = { columns: cols, rows: 9, elements: { Box: 'Box', Text: 'Text' }, get state() { return state }, setState: s => { state = s }, every: () => () => {}, onPointer: () => {} }
  const rows = (board(props, surface).kids ?? []).map(r => text(r).join(''))
  return { props, rows }
}

const wide = await render(140)
ok(wide.props.columns === 2 && wide.props.pageCount === 1, `140 cols: two columns, one page (columns=${wide.props.columns} pages=${wide.props.pageCount})`)
ok((wide.rows[0].match(/量/g) ?? []).length === 2 && (wide.rows[0].match(/變更\$/g) ?? []).length === 2, '140 cols: both halves head 變更$ and 量')
ok(wide.rows.some(r => r.includes('32,110')), '140 cols: 量 drawn in whole 張 with grouping (32,110)')

const narrow = await render(100)
ok(narrow.props.columns === 1 && narrow.props.pageCount === 2, `100 cols: single column, 5 a page (columns=${narrow.props.columns} pages=${narrow.props.pageCount})`)
ok(narrow.rows[0].includes('量') && narrow.rows[0].includes('變更$'), '100 cols: single-column table keeps 變更$ and 量')

const tight = await render(50)
ok(!tight.rows[0].includes('量'), '50 cols: 量 is the first column to go')
done()
