import { expect, test } from 'claude-code/testing'
import type { AgentInfo } from 'claude-code'
import { type Change, addBy, agentName, diffLines, hunks, labelOf, numbered, reconcile, stats, stuck, toolEnd, toolStart, touched, tree, upsert } from './model'

test('派生、結束：樹的層級、結束時間都對', () => {
  let a = upsert([], 'A', 0, { label: '查資料', type: 'Explore', status: 'running' })
  a = upsert(a, 'B', 10, { label: '子任務', type: 'fork', status: 'running', parentId: 'A' })
  expect(tree(a).map(r => [r.agent.id, r.depth])).toEqual([['A', 0], ['B', 1]])
  expect(agentName(a, 'B')).toBe('fork#2')
  const listed = [
    { id: 'A', description: '查資料', type: 'Explore', status: 'completed' },
    { id: 'B', description: '子任務', type: 'fork', status: 'failed', parentId: 'A' },
  ] as AgentInfo[]
  a = reconcile(a, listed, 100)
  expect(reconcile(a, listed, 200).map(x => x.endedAt)).toEqual([100, 100]) // 結束時間不會一直往後推
})

test('卡住：重複、連續失敗、太久沒動靜（工具正在跑不算）', () => {
  const grep = { tool: 'Grep', pattern: 'foo' }
  let a = upsert([], 'A', 0, { type: 'Explore', status: 'running' })
  for (let t = 1; t <= 3; t++) a = toolEnd(toolStart(a, 'A', labelOf('Grep', grep), 'Grep', JSON.stringify(grep), t), 'A', false, t)
  expect(stuck(a[0]!, 10)).toBe('同一個 Grep 重複 3 次')

  let b = upsert([], 'B', 0, { status: 'running' })
  for (let t = 1; t <= 3; t++) b = toolEnd(toolStart(b, 'B', '', 'Bash', `k${t}`, t), 'B', true, t)
  expect(stuck(b[0]!, 10)).toBe('連續 3 次工具失敗')
  b = toolEnd(toolStart(b, 'B', '', 'Bash', 'k9', 20), 'B', false, 20)
  expect(stuck(b[0]!, 21)).toBe(undefined) // 成功一次就歸零

  const running = toolStart(upsert([], 'C', 0, { status: 'running' }), 'C', '', 'Bash', 'x', 0)
  expect(stuck(running[0]!, 10 * 60_000)).toBe(undefined)
  expect(stuck(toolEnd(running, 'C', false, 0)[0]!, 4 * 60_000)).toBe('4 分鐘沒動靜')
  expect(stuck(upsert([], 'D', 0, { status: 'completed' })[0]!, 99 * 60_000)).toBe(undefined)
})

test('diff：最小差異、刪在加前面、只留改到的地方', () => {
  const ops = diffLines('a\nb\nc\nd\ne\nf\ng\nh', 'a\nb\nC\nd\ne\nf\ng\nh\ni')
  expect(stats(ops)).toEqual({ plus: 2, minus: 1 })
  expect(ops.slice(1, 4).map(o => o.t + o.s)).toEqual([' b', '-c', '+C'])
  expect(hunks(ops, 1).map(o => (o ? o.t + o.s : '…'))).toEqual([' b', '-c', '+C', ' d', '…', ' h', '+i'])
  expect(stats(diffLines('', 'x\ny'))).toEqual({ plus: 2, minus: 0 }) // 新檔
  expect(diffLines('same', 'same').every(o => o.t === ' ')).toBe(true)
})

test('誰改的：同一個人只記一次', () => {
  let c: Change[] = [{ path: '/p', before: '', by: [] }]
  c = addBy(addBy(addBy(c, '/p', ''), '/p', 'A'), '/p', '')
  expect(c[0]!.by).toEqual(['', 'A'])
})

test('Bash 動到的檔：新變髒的、mtime 變了的、變回乾淨的', () => {
  const before = new Map([['/r/a', 1], ['/r/b', 1], ['/r/c', 1]])
  const after = new Map([['/r/a', 1], ['/r/b', 2], ['/r/d', 5]])
  expect(touched(before, after).sort()).toEqual(['/r/b', '/r/c', '/r/d'])
  expect(touched(after, after)).toEqual([])
})

test('行號：跟著現在的檔，刪掉的行沒有', () => {
  expect(numbered(diffLines('a\nb\nc', 'a\nB\nc')).map(o => `${o.n ?? '-'}${o.t}${o.s}`)).toEqual(['1 a', '--b', '2+B', '3 c'])
})
