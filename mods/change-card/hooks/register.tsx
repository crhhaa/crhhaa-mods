import type { EngineInterface, Register, RenderInput } from 'claude-code'
import {
  type Agent, type Change, type Sig, addBy, agentName, diffLines, elapsed, hunks, isFailed, numbered, isLive, labelOf, reconcile,
  shortModel, stats, stuck, toolEnd, toolStart, touched, tree, upsert,
} from './model'

// 改動卡：這個 session 裡 Claude（主對話＋子代理）改了哪些檔、子代理有沒有卡住。
// /stock 側欄看板下方只畫一行（key 開頭 bottom:，tw-stock-mod 會讓出行數）；側欄關著時不畫；
// 按 [改動 N 檔 ›] 開一個寬的 Pane：檔案清單、紅綠 diff、子代理樹。零模型 token。
// Write／Edit／MultiEdit／NotebookEdit 直接記；Bash 改的檔靠 Bash 前後各看一次 git 工作目錄補抓。
const PANE_ID = 'stock-band' // tw-stock-mod 的側欄 id
const VIEW_ID = 'change-card'
const POLL_MS = 2000
const STORE_PREFIX = 'changes:' // + session id；reload／resume 時接回來
const KEEP_SESSIONS = 3 // $.store 只留最近幾個 session 的快照（整個 store 上限 4 MiB）
const MAX_SNAPSHOT = 300_000 // 字元；更大的檔只列出來，不算 diff
const MAX_DIRTY = 500 // git 工作目錄髒檔超過這麼多就不幫 Bash 補抓（每個都要 stat）
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const ACCENT = '#d97757'
const MAIN = '主對話'

let agents: Agent[] = []
let changes: Change[] = []
let sid = ''
let selected = '' // 大 Pane 正在看哪個檔
let full = false // false：只看改到的地方；true：整份檔案（改到的行標紅綠）

const changed = (a: Agent[], b: Agent[]) => JSON.stringify(a) !== JSON.stringify(b)
const edited = () => changes.filter(c => c.by.length > 0) // 被拒絕或失敗的 Write 不算
const fileOf = (e: Record<string, unknown>) => (typeof e.file_path === 'string' ? e.file_path : typeof e.notebook_path === 'string' ? e.notebook_path : '')
const callKey = ({ tool_use_id, agentId, ...rest }: Record<string, unknown>) => JSON.stringify(rest)

async function poll($: EngineInterface) {
  const now = await $.clock.now()
  const next = reconcile(agents, await $.agent.list().catch(() => []), now)
  // 有子代理在跑時每次都重畫：經過時間、「幾分鐘沒動靜」要會動
  if (changed(next, agents) || next.some(a => isLive(a.status))) {
    agents = next
    $.ui.invalidate('ui.render')
  }
}

async function snapshot($: EngineInterface, path: string): Promise<Change> {
  try {
    if (!(await $.fs.exists(path))) return { path, before: null, by: [] }
    const text = await $.fs.read(path)
    return text.length > MAX_SNAPSHOT ? { path, before: '', big: true, by: [] } : { path, before: text, by: [] }
  } catch {
    return { path, before: '', big: true, by: [] } // 讀不到就不算 diff，只列出來
  }
}

async function save($: EngineInterface) {
  try {
    await $.store.set(STORE_PREFIX + sid, changes)
  } catch {} // 超過 4 MiB：只是 reload 後接不回來
}

async function restore($: EngineInterface) {
  sid = await $.session.id()
  const saved = await $.store.get(STORE_PREFIX + sid)
  if (Array.isArray(saved)) changes = saved as Change[]
  const old = (await $.store.keys()).filter(k => k.startsWith(STORE_PREFIX) && k !== STORE_PREFIX + sid)
  for (const k of old.slice(0, Math.max(0, old.length - (KEEP_SESSIONS - 1)))) await $.store.delete(k)
}

// session 工作目錄所在的 git repo 裡，改過／新增／刪掉的檔和它們的 mtime；不在 repo 裡就是 undefined
async function dirty($: EngineInterface): Promise<{ root: string; sig: Sig } | undefined> {
  try {
    const top = await $.process.run(['git', 'rev-parse', '--show-toplevel'])
    if (top.exitCode !== 0) return undefined
    const root = top.stdout.trim()
    const ls = await $.process.run(['git', '-C', root, 'ls-files', '-z', '-m', '-o', '-d', '--exclude-standard'])
    const rels = [...new Set(ls.stdout.split('\0').filter(Boolean))]
    if (ls.exitCode !== 0 || rels.length > MAX_DIRTY) return undefined
    const paths = rels.map(rel => `${root}/${rel}`)
    const mtimes = await Promise.all(paths.map(p => $.fs.stat(p).then(s => s.mtimeMs, () => -1)))
    return { root, sig: new Map(paths.map((p, i) => [p, mtimes[i]!])) }
  } catch {
    return undefined
  }
}

// Bash 動到、而且還沒記過的檔：改之前的內容拿 HEAD 那一版（HEAD 沒有 = 新檔）。
// ponytail: Bash 之前就已經是髒的檔，diff 會連同之前沒經過 Claude 的改動一起算；平行跑的 Bash 會互相算到對方頭上
async function fromHead($: EngineInterface, root: string, path: string): Promise<Change> {
  const head = await $.process.run(['git', '-C', root, 'show', `HEAD:${path.slice(root.length + 1)}`]).catch(() => undefined)
  if (!head || head.exitCode !== 0) return { path, before: null, by: [] }
  return head.stdout.length > MAX_SNAPSHOT || head.isStdoutTruncated ? { path, before: '', big: true, by: [] } : { path, before: head.stdout, by: [] }
}

async function readNow($: EngineInterface, path: string) {
  try {
    return await $.fs.read(path)
  } catch {
    return '' // 被刪掉了
  }
}

async function openView($: EngineInterface) {
  await $.ui.open({ id: VIEW_ID, title: '改動', focus: true, closeOnEscape: true, columns: 100 })
}

function pick($: EngineInterface, path: string) {
  selected = path
  $.ui.invalidate('ui.render')
}

function showFull($: EngineInterface, on: boolean) {
  full = on
  $.ui.invalidate('ui.render')
}

// 一行摘要（● 進行中 ⚠ 卡住 · [改動 N 檔 ›]）＋每個卡住的子代理一行；什麼都沒有就是 undefined
async function summary($: EngineInterface, e: RenderInput<'Pane'>) {
  const now = await $.clock.now()
  const live = agents.filter(a => isLive(a.status))
  const stuckRows = live.flatMap(a => {
    const why = stuck(a, now)
    return why ? [{ a, why }] : []
  })
  const files = edited().length
  if (live.length === 0 && files === 0) return undefined
  const { Box, Button, Text } = await $.ui.resolve(e)
  return (
    <Box key="bottom:change" height={1 + stuckRows.length} flexDirection="column">
      <Box flexDirection="row">
        {live.length ? <Text color={ACCENT}>● {live.length} 進行中 </Text> : null}
        {stuckRows.length ? <Text color="yellow">⚠ {stuckRows.length} 卡住 </Text> : null}
        {live.length && files ? <Text dimColor>· </Text> : null}
        {files ? <Button key="change:open" label={`改動 ${files} 檔 ›`} onPress={() => openView($)} /> : null}
      </Box>
      {stuckRows.map(({ a, why }) => (
        <Text key={a.id} color="yellow" wrap="truncate">
          {'  '}⚠ {agentName(agents, a.id)} {why}
        </Text>
      ))}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await restore($).catch(() => undefined)
    $.clock.every(POLL_MS, () => void poll($).catch(() => undefined))
    return r
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    try {
      if (r.deny === undefined && r.agentId) {
        agents = upsert(agents, r.agentId, await $.clock.now(), {
          label: e.description,
          type: e.fork ? 'fork' : e.subagentType,
          model: r.model,
          status: 'running',
          ...(e.parentAgentId ? { parentId: e.parentAgentId } : {}),
        })
        $.ui.invalidate('ui.render')
      }
    } catch {} // 已經派出去了：記錄失敗也不能讓它重派
    return r
  })

  // 在 next(e) 之前出錯才會走到 .catch（照樣跑工具）；next(e) 之後的記錄自己吞掉錯誤，免得工具被跑兩次
  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const id = e.agentId
    if (id) agents = toolStart(agents, id, labelOf(e.tool, input), e.tool, callKey(input), await $.clock.now())
    const path = EDIT_TOOLS.has(e.tool) ? fileOf(input) : ''
    if (path && !changes.some(c => c.path === path)) changes = [...changes, await snapshot($, path)]
    const before = e.tool === 'Bash' ? await dirty($) : undefined
    const r = await next(e)
    try {
      if (id) agents = toolEnd(agents, id, r.deny !== undefined || r.isError === true, await $.clock.now())
      let paths = path && r.deny === undefined && !r.isError ? [path] : []
      if (before && r.deny === undefined) {
        const after = await dirty($)
        paths = after ? touched(before.sig, after.sig) : []
        for (const p of paths) if (!changes.some(c => c.path === p)) changes = [...changes, await fromHead($, before.root, p)]
      }
      for (const p of paths) changes = addBy(changes, p, id ?? '')
      if (paths.length) {
        void save($)
        $.ui.invalidate('ui.render')
      }
    } catch {}
    return r
  }).catch(($, e, next) => next(e))

  // 側欄：看板下方一行，有卡住的子代理才多列
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    const card = await summary($, e)
    if (!card) return next(e)
    const { Box } = await $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {await next(e)}
        {card}
      </Box>
    )
  })

  // 大 Pane：檔案清單（按檔名切換）、選中那個檔的 diff、子代理樹。內容比 Pane 高時引擎會讓人捲動
  on('ui.render', { component: 'Pane', requestId: VIEW_ID }, async ($, e) => {
    const { Box, Button, Text } = await $.ui.resolve(e)
    const list = edited()
    const now = await $.clock.now()
    const files = await Promise.all(
      list.map(async c => ({ c, ops: c.big ? [] : diffLines(c.before ?? '', await readNow($, c.path)) })),
    )
    const cur = files.find(f => f.c.path === selected) ?? files[files.length - 1]
    const who = (c: Change) => c.by.map(b => (b ? agentName(agents, b) : MAIN)).join('、')
    const rows = tree(agents)
    return (
      <Box flexDirection="column">
        {files.length === 0 ? <Text dimColor>這個 session 還沒改任何檔案</Text> : null}
        {files.map(({ c, ops }, i) => {
          const { plus, minus } = stats(ops)
          const name = c.path.split('/').pop() ?? c.path
          return (
            <Box key={c.path} flexDirection="row">
              <Text color={ACCENT}>{c === cur?.c ? '▸' : ' '} </Text>
              <Button key={`change:file:${i}`} label={name} onPress={() => pick($, c.path)} />
              <Text dimColor> {who(c)} </Text>
              {c.before === null ? <Text color="green">新檔 </Text> : null}
              {c.big ? <Text dimColor>太大，不算 diff</Text> : <Text><Text color="green">+{plus}</Text> <Text color="red">−{minus}</Text></Text>}
            </Box>
          )
        })}
        {cur ? (
          <Box flexDirection="column" marginTop={1}>
            <Box flexDirection="row">
              <Button key="change:diff" label={full ? '差異' : '▸差異'} onPress={() => showFull($, false)} />
              <Button key="change:full" label={full ? '▸全文' : '全文'} onPress={() => showFull($, true)} />
              <Text dimColor wrap="truncate"> {cur.c.path}</Text>
            </Box>
            {cur.c.big ? <Text dimColor>檔案太大，不顯示內容</Text> : null}
            {(full ? numbered(cur.ops) : hunks(numbered(cur.ops))).map((o, i) =>
              o === null ? (
                <Text key={`h${i}`} dimColor>…</Text>
              ) : (
                <Text key={`h${i}`} wrap="truncate">
                  <Text dimColor>{(o.n === undefined ? '' : String(o.n)).padStart(4)} </Text>
                  <Text color={o.t === '+' ? 'green' : o.t === '-' ? 'red' : undefined} dimColor={o.t === ' '}>
                    {o.t} {o.s.replace(/\t/g, '  ')}
                  </Text>
                </Text>
              ),
            )}
          </Box>
        ) : null}
        {rows.length ? (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>子代理</Text>
            {rows.map(({ agent: a, depth }) => {
              const live = isLive(a.status)
              const mark = live ? '●' : isFailed(a.status) ? '✗' : '✓'
              const why = stuck(a, now)
              const meta = [shortModel(a.model), live ? a.doing : '', `${a.tools}次`, elapsed((a.endedAt ?? now) - a.startedAt)].filter(Boolean).join(' · ')
              return (
                <Text key={a.id} wrap="truncate">
                  {'  '.repeat(depth)}
                  <Text color={live ? ACCENT : isFailed(a.status) ? 'red' : undefined} dimColor={!live && !isFailed(a.status)}>{mark} </Text>
                  <Text>{agentName(agents, a.id)} {a.label} </Text>
                  {why ? <Text color="yellow">⚠ {why} </Text> : null}
                  <Text dimColor>{meta}</Text>
                </Text>
              )
            })}
          </Box>
        ) : null}
      </Box>
    )
  })
}
