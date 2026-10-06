// The 台指期 footer card, offline: a stubbed 期交所 answer through the real
// register.tsx at fixed Taipei times. Checks which session each time asks
// for (day 0 / night 1), that the near-month contract becomes a card after
// the stock indices, and that a closed stock market still gets it.
// Usage: node futures.mjs <register.js>
import { ok, done } from './assert.mjs'
globalThis.h = (type, props, ...kids) => ({ type, props: props ?? {}, kids: kids.flat() })
globalThis.Fragment = 'Fragment'
const [, , regPath] = process.argv

const TAIFEX = JSON.stringify({
  RtCode: '0',
  RtData: {
    QuoteList: [
      { SymbolID: 'TXF-P', CLastPrice: '', CRefPrice: '48353.49', CDiff: '0', CDiffRate: '0' },
      { SymbolID: 'TXFJ6-M', CLastPrice: '48475.00', CRefPrice: '48698.00', CDiff: '-223.00', CDiffRate: '-0.46' },
      { SymbolID: 'TXFK6-M', CLastPrice: '48655.00', CRefPrice: '48858.00', CDiff: '-203.00', CDiffRate: '-0.42' },
    ],
  },
})
const config = JSON.stringify({ market: 'tw', twSources: ['mis'], tw: [{ code: '2317' }], twIndices: [{ code: 't00', name: 'TAIEX' }, { code: 'TXF', ex: 'futures' }] })

// Taipei = UTC+8, so each case is the UTC instant of that Taipei wall time
const cases = [
  ['Tue 10:00 (day session)', Date.UTC(2026, 8, 29, 2, 0), '0'],
  ['Fri 23:00 (night session, stocks closed)', Date.UTC(2026, 9, 2, 15, 0), '1'],
  ['Sat 10:00 (weekend, Fri night is latest)', Date.UTC(2026, 9, 3, 2, 0), '1'],
  ['Mon 07:00 (before the day open)', Date.UTC(2026, 9, 4, 23, 0), '1'],
]

for (const [label, now, wantType] of cases) {
  const sent = []
  const timers = []
  const $ = {
    command: { register: async () => {} },
    clock: { now: async () => now, every: (ms, fn) => timers.push(fn) },
    fs: { read: async p => { if (p === '.claude/stock-band.json') return config; throw new Error('ENOENT') } },
    ui: { log: () => {}, invalidate: () => {}, resolve: async () => ({ Box: 'Box', Button: 'Button', Client: 'Client' }) },
    http: {
      fetch: async (url, init) => {
        if (url.includes('taifex')) { sent.push(JSON.parse(init.body)); return { ok: true, status: 200, text: TAIFEX } }
        return { ok: false, status: 599, text: '' }
      },
    },
    env: { get: async () => undefined },
    session: { cwd: async () => '/nonexistent' },
    process: {},
  }
  // a fresh module per case: futuresCard/futuresAt are module state
  const { register } = await import(`${regPath}?case=${now}`)
  const handlers = new Map()
  register((e, a, b) => handlers.set(e, typeof a === 'function' ? a : b))
  await handlers.get('session.start')($, {}, async () => ({ kids: [] }))
  for (const fn of timers) await fn()
  await new Promise(r => setTimeout(r, 50))
  const tree = await handlers.get('ui.render')($, { props: {}, surface: 'terminal', viewport: { columns: 140 } }, async () => ({ kids: [] }))
  let props
  const walk = n => { if (!n || typeof n !== 'object') return; if (n.type === 'Client') props = n.props.props; for (const k of n.kids ?? []) walk(k) }
  walk(tree)
  const last = props?.indices?.at(-1)
  ok(sent.length > 0 && sent.every(b => b.MarketType === wantType && b.CID === 'TXF'), `${label}: asks MarketType ${wantType} (sent ${sent.map(b => b.MarketType).join(',') || 'nothing'})`)
  ok(last?.name === '台指期' && last.value === 48475 && last.pct === -0.46 && props.indices.length >= 2, `${label}: near-month 台指期 card follows the stock index`)
}
done()
