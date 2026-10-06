import type { EngineInterface, Register, SessionRateLimit, SessionUsage } from 'claude-code'

// token 用量卡，畫在 /stock 側欄看板上方。數字跟狀態列同一份（$.session.usage()，不打 API）。
// 兩個帳號（~/.claude、~/.claude-b）各跑一份這個 mod：各自把 5h/7d 寫進共用資料夾，
// 再把資料夾裡每個帳號都畫出來，目前這個 Claude 用的那個標橘色 ▶。
const PANE_ID = 'stock-band' // tw-stock-mod 的側欄 id
const SHARED_DIR = '.claude/token-usage' // 在 $HOME 底下
const TICK_MS = 60_000 // 倒數一分鐘跳一次，順便讀別的帳號
const DOTS = 10
const ACCENT = '#d97757'
const MORANDI = '#c9b27c' // 莫蘭迪黃：標題和正常用量

type Usage = Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>
export type Account = { name: string; rateLimits: SessionRateLimit[] }
type Seg = { label: string; pct: number; at: string; left: string }

const NAMES: Record<string, string> = { five_hour: '5h', seven_day: '7d' }

const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`)
const p2 = (n: number) => String(n).padStart(2, '0')
export const hhmm = (d: Date) => `${p2(d.getHours())}:${p2(d.getMinutes())}`

// 重置時間：24 小時內只寫時刻，再遠加日期
export function resetAt(iso: string, now: number) {
  const d = new Date(iso)
  return d.getTime() - now < 86_400_000 ? hhmm(d) : `${d.getMonth() + 1}/${d.getDate()} ${hhmm(d)}`
}

export function countdown(iso: string, now: number) {
  const s = Math.max(0, Math.floor((Date.parse(iso) - now) / 1000))
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  return d ? `${d}d${h}h` : `${h}h${m}m`
}

// ≥90 紅、≥70 亮黃、其他莫蘭迪黃
export const color = (pct: number) => (pct >= 90 ? 'red' : pct >= 70 ? 'yellow' : MORANDI)

export const dots = (pct: number) => {
  const n = Math.min(DOTS, Math.max(0, Math.round((pct / 100) * DOTS)))
  return ['●'.repeat(n), '○'.repeat(DOTS - n)] as const
}

// ~/.claude → claude；~/.claude-b → claude-b
export const accountName = (configDir: string | undefined) =>
  (configDir?.replace(/\/+$/, '').split('/').pop() || '.claude').replace(/^\./, '')

// 別的帳號的檔案可能是幾小時前寫的：重置時間過了就當 0%
export function windows(rateLimits: SessionRateLimit[], now: number): Seg[] {
  return rateLimits.map(r => {
    const label = NAMES[r.kind] ?? r.kind
    if (r.resetsAt === undefined) return { label, pct: r.percentUsed, at: '', left: '' }
    if (Date.parse(r.resetsAt) <= now) return { label, pct: 0, at: '', left: '' }
    return { label, pct: r.percentUsed, at: resetAt(r.resetsAt, now), left: countdown(r.resetsAt, now) }
  })
}

// 第一次回覆之前引擎還沒有 percent：當 0% 畫，這一行一直都在（狀態列的 Context 已關掉）
export function contextSeg(u: Usage): Seg {
  const c = u.context
  return { label: 'ctx', pct: c.percent ?? 0, at: '', left: `${k(c.tokens ?? 0)}/${k(c.window)}` }
}

let me = ''
let dir = ''
let usage: Usage | undefined
let accounts: Account[] = []

async function save($: EngineInterface) {
  if (!usage || usage.rateLimits.length === 0) return
  const mine: Account = { name: me, rateLimits: usage.rateLimits }
  await $.fs.write(`${dir}/${me}.json`, JSON.stringify(mine))
}

async function load($: EngineInterface) {
  const got: Account[] = []
  try {
    for (const f of await $.fs.list(dir)) {
      if (!f.name.endsWith('.json')) continue
      try {
        got.push(JSON.parse(await $.fs.read(`${dir}/${f.name}`)))
      } catch {} // 另一個帳號正在寫，下一輪再讀
    }
  } catch {} // 資料夾還沒有人建
  // 自己用記憶體裡最新的；自己排第一個
  const others = got.filter(a => a.name !== me).sort((a, b) => a.name.localeCompare(b.name))
  accounts = usage ? [{ name: me, rateLimits: usage.rateLimits }, ...others] : others
  $.ui.invalidate('ui.render')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    const home = (await $.env.get('HOME')) ?? ''
    me = accountName(await $.env.get('CLAUDE_CONFIG_DIR'))
    dir = `${home}/${SHARED_DIR}`
    usage = await $.session.usage()
    await save($)
    await load($)
    $.clock.every(TICK_MS, () => void load($))
    return r
  })

  on('session.measure', async ($, e, next) => {
    usage = e
    if (e.changed.includes('rateLimits')) await save($)
    await load($)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    if (accounts.length === 0 && !usage) return next(e)
    const { Box, Text } = await $.ui.resolve(e)
    const now = await $.clock.now()
    const width = Math.max(...accounts.map(a => a.name.length), 3)
    // 一個視窗一行：5h  ●●○○○○○○○○  11% @ 13:09  4h23m
    const row = (s: Seg) => {
      const [full, empty] = dots(s.pct)
      return (
        <Text key={s.label}>
          <Text dimColor>{s.label.padEnd(3)} </Text>
          <Text color={color(s.pct)}>{full}</Text>
          <Text dimColor>{empty}</Text>
          <Text color={color(s.pct)}> {String(Math.round(s.pct)).padStart(3)}%</Text>
          {s.at ? <Text dimColor> @ {s.at}</Text> : null}
          {s.left ? <Text dimColor>  {s.left}</Text> : null}
        </Text>
      )
    }
    const ctx = usage && contextSeg(usage)
    const cost = usage?.cost && usage.cost.usd > 0 ? `$${usage.cost.usd.toFixed(2)}` : ''
    return (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text color={MORANDI} bold>TOKEN USAGE</Text>
            <Text dimColor>{hhmm(new Date(now))}</Text>
          </Box>
          {accounts.map(a => {
            const isMe = a.name === me
            return (
              <Box key={a.name} flexDirection="row">
                {isMe ? (
                  <Text color={ACCENT} bold>▶ {a.name.padEnd(width)} </Text>
                ) : (
                  <Text dimColor>{'  '}{a.name.padEnd(width)} </Text>
                )}
                <Box flexDirection="column">
                  {windows(a.rateLimits, now).map(row)}
                  {/* context 是這個對話自己的，接在自己帳號底下 */}
                  {isMe && ctx ? (
                    <Text>
                      {row(ctx)}
                      {cost ? <Text dimColor>  {cost}</Text> : null}
                    </Text>
                  ) : null}
                </Box>
              </Box>
            )
          })}
        </Box>
        {await next(e)}
      </Box>
    )
  })
}
