#!/usr/bin/env node
// 狀態列用：Context 一行＋每個帳號一行，排成對齊的表，寫法跟 claude-hud 一樣。長條是 10 格 ■，亮的是用掉的、暗的是剩的；
// 正在用的帳號（和 Context）淡紫、別的帳號灰，≥70 黃、≥90 紅。用 24-bit 顏色，不吃終端機主題的 cyan/dim。
//   Context   ■■■■■■■■■■   0%
//   ▶claude   ■■■■■■■■■■   5% (4h 12m / 5h)   ■■■■■■■■■■   1% (6d 15h / 7d)
//   claude-b  ■■■■■■■■■■  19% (4h 12m / 5h)   ■■■■■■■■■■  56% (1d 20h / 7d)
// 5h/7d 讀 ~/.claude/token-usage/*.json（token-usage mod 寫的）；Context 讀狀態列 stdin 的 JSON。
// 狀態列會吃掉每行開頭的空白，所以每行都從標籤開始，不靠前導空白對齊。
// 目前這個 Claude 的帳號（看 CLAUDE_CONFIG_DIR）標 ▶、排第一。沒有任何帳號的檔就什麼都不印。
// 自我檢查：node statusline.mjs --check
import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'

const NAMES = { five_hour: '5h', seven_day: '7d' }
const CELLS = 10
const DIM = '\x1b[2m', RESET = '\x1b[0m'
const dim = s => `${DIM}${s}${RESET}`

// ≥90 紅、≥70 黃；其他：正在用的帳號（和它的 Context）淡紫，別的帳號灰
const rgb = (r, g, b) => `\x1b[38;2;${r};${g};${b}m`
const MINE = rgb(177, 185, 249)
const OTHER = rgb(150, 150, 150)
const EMPTY = rgb(80, 80, 80) // 剩下的格子：固定深灰，dim 在有些主題下跟用掉的分不出來
const color = (pct, mine) => (pct >= 90 ? '\x1b[31m' : pct >= 70 ? '\x1b[33m' : mine ? MINE : OTHER)

export function countdown(iso, now) {
  const s = Math.max(0, Math.floor((Date.parse(iso) - now) / 1000))
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  return d ? `${d}d ${h}h` : `${h}h ${m}m`
}

// ~/.claude → claude；~/.claude-b → claude-b（跟 hooks/register.tsx 的 accountName 一樣）
export const accountName = dir => (dir?.replace(/\/+$/, '').split('/').pop() || '.claude').replace(/^\./, '')

const PAREN = 14 // 「(1d 20h / 7d)」最寬 13，再留一格

// ■■■■■■■■■■  32%
function bar(pct, mine) {
  const n = Math.min(CELLS, Math.max(0, Math.round(pct / 10)))
  const c = color(pct, mine)
  // ■ 不佔滿整格，上下兩行的長條中間才有空隙；剩下的格子用深灰的 ■
  return `${c}${'■'.repeat(n)}${EMPTY}${'■'.repeat(CELLS - n)}${RESET} ${c}${String(pct).padStart(3)}%${RESET}`
}

// ■■■■■■■■■■  32% (2h 13m / 5h)；別的帳號的檔可能是幾小時前寫的：重置時間過了就當 0%
function seg(r, now, mine) {
  const label = NAMES[r.kind] ?? r.kind
  const reset = r.resetsAt && Date.parse(r.resetsAt) > now
  const pct = r.resetsAt && !reset ? 0 : Math.round(r.percentUsed)
  const paren = `(${reset ? `${countdown(r.resetsAt, now)} / ` : ''}${label})`
  return `${bar(pct, mine)} ${dim(paren)}${' '.repeat(Math.max(0, PAREN - paren.length))}` // 補白放在色碼外，行尾才 trim 得掉
}

export function lines(accounts, me, input, now) {
  const list = [...accounts.filter(a => a.name === me), ...accounts.filter(a => a.name !== me).sort((a, b) => a.name.localeCompare(b.name))]
    .filter(a => a.rateLimits?.length)
  if (!list.length) return ''
  const label = s => s.padEnd(Math.max('Context'.length, ...list.map(a => a.name.length + 1)) + 2)
  const out = []
  const ctx = input?.context_window
  if (ctx?.context_window_size) out.push(`${dim(label('Context'))}${bar(Math.round(ctx.used_percentage ?? 0), true)}`)
  for (const a of list) {
    const name = a.name === me ? `\x1b[1m${label(`▶${a.name}`)}${RESET}` : dim(label(a.name))
    out.push(`${name}${a.rateLimits.map(r => seg(r, now, a.name === me)).join('  ').trimEnd()}`)
  }
  return out.map(l => l.trimEnd()).join('\n')
}

function read(dir) {
  const got = []
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue
      try { got.push(JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'))) } catch {} // 另一個帳號正在寫
    }
  } catch {} // 資料夾還沒有人建
  return got
}

if (process.argv.includes('--check')) {
  const { strict: assert } = await import('node:assert')
  const plain = s => s.replace(/\x1b\[[0-9;]*m/g, '')
  const now = Date.parse('2026-10-06T00:00:00Z')
  assert.equal(countdown('2026-10-06T02:13:00Z', now), '2h 13m')
  assert.equal(countdown('2026-10-09T04:00:00Z', now), '3d 4h')
  assert.equal(accountName('/Users/x/.claude-b/'), 'claude-b')
  const accounts = [
    { name: 'claude-b', rateLimits: [{ kind: 'five_hour', percentUsed: 99, resetsAt: '2026-10-05T23:00:00Z' }] },
    { name: 'claude', rateLimits: [{ kind: 'five_hour', percentUsed: 72.4, resetsAt: '2026-10-06T02:13:00Z' }, { kind: 'seven_day', percentUsed: 9 }] },
  ]
  const input = { context_window: { context_window_size: 200_000, used_percentage: 3.4 } }
  assert.equal(plain(lines(accounts, 'claude', input, now)), [
    'Context    ■■■■■■■■■■   3%',
    '▶claude    ■■■■■■■■■■  72% (2h 13m / 5h)   ■■■■■■■■■■   9% (7d)',
    'claude-b   ■■■■■■■■■■   0% (5h)',
  ].join('\n'))
  assert.equal(lines([], 'claude', input, now), '')
  console.log('ok')
} else {
  let input
  try { input = process.stdin.isTTY ? undefined : JSON.parse(readFileSync(0, 'utf8')) } catch {} // 沒有 stdin 就不畫 Context
  const out = lines(read(`${homedir()}/.claude/token-usage`), accountName(process.env.CLAUDE_CONFIG_DIR), input, Date.now())
  if (out) console.log(out)
}
