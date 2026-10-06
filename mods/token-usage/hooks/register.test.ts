import { expect, test } from 'claude-code/testing'
import { accountName, color, contextSeg, countdown, dots, resetAt, windows } from './register.tsx'

test('windows: dots, reset clock, countdown, and a passed reset reads 0%', () => {
  const now = new Date(2026, 9, 6, 8, 0).getTime() // 本機時間 10/6 08:00
  const at = (d: number, h: number, m: number) => new Date(2026, 9, d, h, m).toISOString()
  expect(
    windows(
      [
        { kind: 'five_hour', percentUsed: 72, resetsAt: at(6, 10, 13) },
        { kind: 'seven_day', percentUsed: 46, resetsAt: at(9, 12, 0) },
        { kind: 'five_hour', percentUsed: 99, resetsAt: at(6, 7, 0) },
      ],
      now,
    ),
  ).toEqual([
    { label: '5h', pct: 72, at: '10:13', left: '2h13m' },
    { label: '7d', pct: 46, at: '10/9 12:00', left: '3d4h' },
    { label: '5h', pct: 0, at: '', left: '' },
  ])
  expect(resetAt(at(7, 7, 59), now)).toBe('07:59')
  expect(countdown(at(6, 7, 0), now)).toBe('0h0m')
  expect(dots(50)).toEqual(['●●●●●', '○○○○○'])
  expect(dots(120)).toEqual(['●●●●●●●●●●', ''])
  expect(color(72)).toBe('yellow')
  expect(color(11)).toBe('#c9b27c')
  expect(contextSeg({ context: { tokens: 90_000, window: 200_000, percent: 45 }, rateLimits: [] })).toEqual({
    label: 'ctx', pct: 45, at: '', left: '90k/200k',
  })
  expect(contextSeg({ context: { window: 200_000 }, rateLimits: [] })).toEqual({ label: 'ctx', pct: 0, at: '', left: '0/200k' })
})

test('accountName: one name per config dir', () => {
  expect(accountName(undefined)).toBe('claude')
  expect(accountName('/Users/x/.claude')).toBe('claude')
  expect(accountName('/Users/x/.claude-b/')).toBe('claude-b')
})
