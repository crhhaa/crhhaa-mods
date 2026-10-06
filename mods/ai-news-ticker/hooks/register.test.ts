import { expect, test } from 'claude-code/testing'
import { parseRss } from './register.tsx'

test('parseRss strips the source suffix from the title', () => {
  const xml = '<item><title>Claude 5 發表 - 科技新報</title><link>https://x.test/a</link><source url="x">科技新報</source></item>'
  expect(parseRss(xml)).toEqual([{ title: 'Claude 5 發表', source: '科技新報', link: 'https://x.test/a' }])
})
