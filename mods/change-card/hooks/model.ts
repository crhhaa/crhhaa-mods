// 純邏輯，沒碰引擎，測試可以直接跑。
// 子代理那一半改自 OneWave-AI/claude-code-mods 的 swarm/hooks/model.ts（MIT）。
import type { AgentInfo } from 'claude-code'

export type Agent = {
  id: string
  label: string
  type: string
  status: string
  parentId?: string
  model?: string
  doing?: string
  tools: number
  startedAt: number
  endedAt?: number
  // 判斷卡住用
  lastKey?: string // 上一次呼叫：工具＋參數
  lastTool?: string
  repeat: number // 同一個呼叫連續幾次
  fails: number // 工具連續失敗幾次
  running: number // 正在跑的工具呼叫數
  lastAt: number // 最後一次有動靜
}

export const isLive = (s: string) => s === 'running' || s === 'pending' || s === 'starting'
export const isFailed = (s: string) => s === 'failed' || s === 'killed' || s === 'error'

const MAX_AGENTS = 60

export function upsert(list: Agent[], id: string, now: number, patch: Partial<Agent>): Agent[] {
  const i = list.findIndex(a => a.id === id)
  if (i < 0) {
    const a: Agent = { id, label: 'worker', type: 'worker', status: 'running', tools: 0, startedAt: now, repeat: 0, fails: 0, running: 0, lastAt: now, ...patch }
    return [...list, a].slice(-MAX_AGENTS)
  }
  const next = list.slice()
  next[i] = { ...next[i]!, ...patch }
  return next
}

// 子代理裡的一次工具呼叫開始：記下在做什麼、次數、是不是跟上一次一模一樣
export function toolStart(list: Agent[], id: string, doing: string, tool: string, key: string, now: number): Agent[] {
  const had = list.find(a => a.id === id)
  const repeat = had?.lastKey === key ? had.repeat + 1 : 1
  return upsert(list, id, now, { doing, tools: (had?.tools ?? 0) + 1, lastTool: tool, lastKey: key, repeat, running: (had?.running ?? 0) + 1, lastAt: now })
}

// 工具呼叫結束：失敗就累加，成功就歸零
export function toolEnd(list: Agent[], id: string, failed: boolean, now: number): Agent[] {
  const had = list.find(a => a.id === id)
  if (!had) return list
  return upsert(list, id, now, { running: Math.max(0, had.running - 1), fails: failed ? had.fails + 1 : 0, lastAt: now })
}

export const STUCK_REPEAT = 3
export const STUCK_FAILS = 3
export const IDLE_MS = 3 * 60_000

// 卡住的原因；沒卡住是 undefined。工具正在跑（長指令）不算沒動靜
export function stuck(a: Agent, now: number): string | undefined {
  if (!isLive(a.status)) return undefined
  if (a.repeat >= STUCK_REPEAT) return `同一個 ${a.lastTool} 重複 ${a.repeat} 次`
  if (a.fails >= STUCK_FAILS) return `連續 ${a.fails} 次工具失敗`
  if (a.running === 0 && now - a.lastAt >= IDLE_MS) return `${Math.floor((now - a.lastAt) / 60_000)} 分鐘沒動靜`
  return undefined
}

// Explore#2：類型＋第幾個派出去的
export function agentName(list: Agent[], id: string) {
  const i = list.findIndex(a => a.id === id)
  return i < 0 ? '子代理' : `${list[i]!.type}#${i + 1}`
}

// 把 $.agent.list() 併進來；從進行中變成結束的，記下結束時間
export function reconcile(list: Agent[], listed: AgentInfo[], now: number): Agent[] {
  let agents = list
  for (const l of listed) {
    const had = agents.find(a => a.id === l.id)
    const patch: Partial<Agent> = {
      label: l.description || had?.label || l.name || l.type,
      type: l.type || had?.type || 'worker',
      status: l.status,
      ...(l.parentId ? { parentId: l.parentId } : {}),
    }
    const teammateIdle = l.type === 'teammate' && l.status === 'idle'
    if ((had ? isLive(had.status) : true) && !isLive(l.status) && !teammateIdle && !had?.endedAt) patch.endedAt = now
    agents = upsert(agents, l.id, now, patch)
  }
  return agents
}

// 派生樹，深度優先、同層照開始時間排
export type Row = { agent: Agent; depth: number }
export function tree(list: Agent[]): Row[] {
  const ids = new Set(list.map(a => a.id))
  const kids = new Map<string, Agent[]>()
  for (const a of list) {
    const p = a.parentId && ids.has(a.parentId) ? a.parentId : ''
    kids.set(p, [...(kids.get(p) ?? []), a])
  }
  const rows: Row[] = []
  const walk = (p: string, depth: number) => {
    for (const a of (kids.get(p) ?? []).sort((x, y) => x.startedAt - y.startedAt)) {
      rows.push({ agent: a, depth })
      walk(a.id, depth + 1)
    }
  }
  walk('', 0)
  return rows
}

const base = (p: unknown) => (typeof p === 'string' ? p.split('/').filter(Boolean).pop() ?? p : '')
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

// 一次工具呼叫翻成一句短中文
export function labelOf(tool: string, input: Record<string, unknown>): string {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  switch (tool) {
    case 'Bash': return `執行 ${clip(s('description') || s('command').split('\n')[0]!, 40)}`
    case 'Read': return `讀 ${base(input.file_path)}`
    case 'Write': return `寫 ${base(input.file_path)}`
    case 'Edit': case 'MultiEdit': return `改 ${base(input.file_path)}`
    case 'Grep': case 'Glob': return `搜 ${clip(s('pattern'), 30)}`
    case 'WebFetch': return `抓 ${clip(s('url').replace(/^https?:\/\//, ''), 30)}`
    case 'WebSearch': return `查 ${clip(s('query'), 30)}`
    case 'Agent': case 'Task': return `派 ${clip(s('description'), 30)}`
    case 'SendMessage': return `傳訊給 ${clip(s('to'), 20)}`
    default: return `用 ${tool.startsWith('mcp__') ? tool.split('__').pop() : tool}`
  }
}

export function shortModel(m?: string) {
  const hit = m && /(opus|sonnet|haiku|fable)[-\s]?(\d+(?:[-.]\d+)?)?/i.exec(m)
  if (!hit) return m ? clip(m, 12) : ''
  return `${hit[1]!.toLowerCase()}${hit[2] ? ` ${hit[2].replace('-', '.')}` : ''}`
}

export function elapsed(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

// ── 改動 ──────────────────────────────────────────────

// 一個被改過的檔：第一次改之前的內容（null = 本來沒有這個檔），誰改的（'' = 主對話）
export type Change = { path: string; before: string | null; big?: true; by: string[] }

export function addBy(list: Change[], path: string, who: string): Change[] {
  return list.map(c => (c.path === path && !c.by.includes(who) ? { ...c, by: [...c.by, who] } : c))
}

// Bash 前後各拍一次 git 工作目錄（絕對路徑 → mtime，-1 = 檔案不見了），比出這次 Bash 動到的檔
export type Sig = Map<string, number>
export function touched(before: Sig, after: Sig): string[] {
  const out = [...after].filter(([p, m]) => before.get(p) !== m).map(([p]) => p)
  return [...out, ...[...before.keys()].filter(p => !after.has(p))] // 變回乾淨的（例如 git checkout）也算
}

export type Op = { t: ' ' | '+' | '-'; s: string }

const lines = (s: string) => (s === '' ? [] : s.split('\n'))
// ponytail: O(n·m) 的 LCS，頭尾相同的行先切掉；中段超過這麼多格就整段當「刪掉再加回」，要更準換 Myers
const MAX_CELLS = 4_000_000

export function diffLines(before: string, after: string): Op[] {
  const x = lines(before), y = lines(after)
  let p = 0
  while (p < x.length && p < y.length && x[p] === y[p]) p++
  let q = 0
  while (q < x.length - p && q < y.length - p && x[x.length - 1 - q] === y[y.length - 1 - q]) q++
  const xs = x.slice(p, x.length - q), ys = y.slice(p, y.length - q)
  const n = xs.length, m = ys.length
  const mid: Op[] = []
  if (n * m > MAX_CELLS) {
    for (const s of xs) mid.push({ t: '-', s })
    for (const s of ys) mid.push({ t: '+', s })
  } else {
    const w = m + 1
    const L = new Uint32Array((n + 1) * w)
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        L[i * w + j] = xs[i] === ys[j] ? L[(i + 1) * w + j + 1]! + 1 : Math.max(L[(i + 1) * w + j]!, L[i * w + j + 1]!)
    let i = 0, j = 0
    while (i < n || j < m) {
      if (i < n && j < m && xs[i] === ys[j]) { mid.push({ t: ' ', s: xs[i]! }); i++; j++ }
      else if (i < n && (j === m || L[(i + 1) * w + j]! >= L[i * w + j + 1]!)) mid.push({ t: '-', s: xs[i++]! }) // 刪的排在加的前面
      else mid.push({ t: '+', s: ys[j++]! })
    }
  }
  return [...x.slice(0, p).map(s => ({ t: ' ' as const, s })), ...mid, ...x.slice(x.length - q).map(s => ({ t: ' ' as const, s }))]
}

export function stats(ops: Op[]) {
  return { plus: ops.filter(o => o.t === '+').length, minus: ops.filter(o => o.t === '-').length }
}

// 標上現在這個檔的行號（刪掉的行沒有行號）
export type Line = Op & { n?: number }
export function numbered(ops: Op[]): Line[] {
  let n = 0
  return ops.map(o => (o.t === '-' ? o : { ...o, n: ++n }))
}

// 只留改到的行和前後 ctx 行；中間跳過的地方放一個 null（畫成 …）
export function hunks<T extends Op>(ops: T[], ctx = 2): (T | null)[] {
  const keep = ops.map(() => false)
  ops.forEach((o, i) => {
    if (o.t === ' ') return
    for (let k = Math.max(0, i - ctx); k <= Math.min(ops.length - 1, i + ctx); k++) keep[k] = true
  })
  const out: (T | null)[] = []
  ops.forEach((o, i) => {
    if (keep[i]) out.push(o)
    else if (out.length && out[out.length - 1] !== null) out.push(null)
  })
  if (out[out.length - 1] === null) out.pop()
  return out
}
