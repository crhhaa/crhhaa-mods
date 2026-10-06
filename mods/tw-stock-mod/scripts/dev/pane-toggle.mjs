// /stock moves the board from the band into a pane and back, offline:
// open → the Pane draws the board and the band steps aside; /stock again or
// the person's close mark → the band draws it again. The open/closed choice
// survives into the next session through $.store.
// Usage: node pane-toggle.mjs <register.js>
import { ok, done } from './assert.mjs'
globalThis.h = (type, props, ...kids) => ({ type, props: props ?? {}, kids: kids.flat() })
globalThis.Fragment = 'Fragment'
const [, , regPath] = process.argv

const codes = ['1101', '1216', '1301', '2002', '2412', '2603', '2882']
const files = {
  '.claude/stock-band.json': JSON.stringify({ market: 'tw', feed: 'off', animation: 'off', columns: 1, tw: codes.map(code => ({ code })) }),
  '.claude/stock-quotes.json': JSON.stringify({
    asOf: Date.now(), market: 'tw', quotes: Object.fromEntries(codes.map((c, i) => [c, { price: 100 + i, prevClose: 100 }])),
  }),
}
const panes = []
const store = new Map()
const $ = {
  command: { register: async () => {} },
  store: { get: async k => store.get(k), set: async (k, v) => { store.set(k, v) } },
  clock: { now: async () => Date.now(), every: () => {} },
  fs: { read: async p => { if (p in files) return files[p]; throw new Error('ENOENT ' + p) } },
  ui: {
    log: () => {}, invalidate: () => {},
    resolve: async () => ({ Box: 'Box', Button: 'Button', Client: 'Client', Text: 'Text' }),
    open: async a => { panes.push(a.id) },
    close: async a => { panes.splice(panes.indexOf(a.id), 1) },
  },
  http: { fetch: async () => ({ ok: false, status: 599, text: '' }) },
  env: { get: async () => undefined },
  session: { cwd: async () => '/nonexistent' },
  process: {},
}
let handlers
// a fresh copy of the module = a new session (module state starts over, $.store stays)
let session = 0
async function startSession() {
  handlers = new Map()
  const { register } = await import(regPath + '?s=' + ++session)
  register((ev, a, b) => handlers.set(ev + (typeof a === 'function' ? '' : ':' + (a.component ?? a.command ?? '')), b ?? a))
  await handlers.get('session.start')($, {}, async () => ({ kids: [] }))
}
await startSession()

const NEXT = { kids: [], next: true }
const client = n => (n?.type === 'Client' ? n : (n?.kids ?? []).map(client).find(Boolean))
const hasClient = n => Boolean(client(n))
const band = () => handlers.get('ui.render:AbovePrompt')($, { props: {}, surface: 'terminal', viewport: { columns: 120 } }, async () => NEXT)
const pane = () => handlers.get('ui.render:Pane')($, { props: { bodyColumns: 64, scroll: { bodyRows: 30 } }, surface: 'terminal' }, async () => NEXT)
const stock = () => handlers.get('command.run:stock')($, { command: 'stock' }, async () => ({}))

const inBand = client(await band()).props
ok(inBand.props.quotes.length === 5 && inBand.height === 8, 'band keeps 5 a page, 8 rows')
await stock()
ok(panes.includes('stock-band') && store.get('paneOpen') === true, '/stock opens the pane and remembers it')
ok(hasClient(await band()), 'band stays until the pane has actually drawn (a narrow terminal holds it undrawn)')
const inPane = client(await pane()).props
ok((await band()) === NEXT, 'band steps aside once the pane is drawn')
ok(inPane.props.quotes.length === 7 && inPane.props.pageCount === 1, 'pane fits all 7 symbols on one page')
ok(inPane.height === 10, `pane board grows to the list, not past it (got ${inPane.height})`)
await stock()
ok(panes.length === 0 && hasClient(await band()) && store.get('paneOpen') === false, '/stock again closes the pane, band is back, remembered closed')
await startSession()
ok(panes.length === 0, 'next session after closing: no pane')
await stock()
await startSession()
ok(panes.includes('stock-band'), 'next session after leaving it open: pane opens by itself')
panes.length = 0
await pane()
await handlers.get('ui.close')($, { id: 'stock-band', origin: { kind: 'person' } }, async () => {})
ok(hasClient(await band()) && store.get('paneOpen') === false, 'closing the pane by hand brings the band back and stays closed')
await stock()
await handlers.get('ui.close')($, { id: 'stock-band', origin: { kind: 'unload' } }, async () => {})
ok(store.get('paneOpen') === true, 'a reload unload does not forget the choice')
done()
