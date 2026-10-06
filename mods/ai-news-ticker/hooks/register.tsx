import type { EngineInterface, Register } from 'claude-code'

// AI 新聞跑馬燈：Google 新聞 RSS（近 24 小時、繁中）每 15 分鐘抓一次，每 20 秒換一則。/stock 側欄開著畫在側欄最上面，沒開畫在輸入框上方。
const FEED =
  'https://news.google.com/rss/search?q=AI+%E4%BA%BA%E5%B7%A5%E6%99%BA%E6%85%A7+when:1d&hl=zh-TW&gl=TW&ceid=TW:zh-Hant'
const FETCH_MS = 15 * 60_000
const ROTATE_MS = 20_000
const MAX_ITEMS = 20

type Item = { title: string; source: string; link: string }

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()

const tag = (xml: string, name: string) => decode(xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? '')

// ponytail: regex RSS 解析，只吃 Google 新聞這種扁平 <item>；換成結構複雜的 feed 再換 XML parser
export function parseRss(xml: string): Item[] {
  const items: Item[] = []
  for (const [, body] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const source = tag(body, 'source')
    let title = tag(body, 'title')
    // Google 新聞標題尾巴會掛「 - 媒體名」，來源另外顯示就砍掉
    const cut = title.lastIndexOf(' - ')
    if (cut > 0) title = title.slice(0, cut)
    const link = tag(body, 'link')
    if (title && link) items.push({ title, source, link })
    if (items.length >= MAX_ITEMS) break
  }
  return items
}

const PANE_ID = 'stock-band' // tw-stock-mod 的側欄 id
const ACCENT = '#d97757'
const MORANDI = '#c9b27c'

let items: Item[] = []
let idx = 0
let inPane = false // 側欄畫過新聞卡：輸入框上方那條就收起來

function step($: EngineInterface, d: number) {
  idx = (idx + d + items.length) % items.length
  $.ui.invalidate('ui.render')
}

// 按鈕走 macOS `open`；失敗就跳 toast 說原因，不再默默沒反應
async function openLink($: EngineInterface, href: string) {
  try {
    const r = await $.process.run(['open', href])
    if (r.exitCode !== 0) $.ui.toast(`開啟失敗：${r.stderr.trim() || `exit ${r.exitCode}`}`)
  } catch (err) {
    $.ui.toast(`開啟失敗：${err}`)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)

    const refresh = async () => {
      try {
        const res = await $.http.fetch(FEED)
        if (!res.ok) return $.ui.log(`ai-news-ticker: HTTP ${res.status}`)
        const got = parseRss(res.text)
        if (got.length === 0) return // 抓到空的就保留舊的
        items = got
        idx = 0
        $.ui.invalidate('ui.render')
      } catch (err) {
        $.ui.log(`ai-news-ticker: ${err}`)
      }
    }

    await refresh()
    $.clock.every(FETCH_MS, () => void refresh())
    $.clock.every(ROTATE_MS, () => {
      if (items.length < 2) return
      step($, 1)
    })
    return r
  })

  // /stock 側欄最上面：key 開頭 top:，tw-stock-mod 會把它排到 TOKEN USAGE 前面
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    const item = items[idx]
    if (!item) return next(e)
    if (!inPane) {
      inPane = true
      $.ui.invalidate('ui.render')
    }
    const { Box, Button, Link, Text } = await $.ui.resolve(e)
    const href = new URL(item.link).href
    return (
      <Box flexDirection="column">
        <Box key="top:ai-news" flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text color={MORANDI} bold>
              AI NEWS <Text dimColor>{idx + 1}/{items.length}</Text>
            </Text>
            <Box flexShrink={0}>
              <Button key="ai-news:pane-prev" label="上一則" onPress={() => step($, -1)} />
              <Button key="ai-news:pane-open" label="開啟" onPress={() => openLink($, href)} />
              <Button key="ai-news:pane-next" label="下一則" onPress={() => step($, 1)} />
            </Box>
          </Box>
          {/* 標題太長就換行；⌘+點擊 由終端機開連結 */}
          <Text wrap="wrap">
            <Link href={href}>{item.title}</Link>
          </Text>
          <Text dimColor>{item.source}</Text>
        </Box>
        {await next(e)}
      </Box>
    )
  })

  // 側欄關掉（/stock、×、ctrl+x x）：新聞回到輸入框上方
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE_ID) {
      inPane = false
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const item = items[idx]
    if (inPane || e.props.hasSurvey || !item) return next(e)

    const { Box, Button, Link, Text } = $.ui.resolve(e)
    const href = new URL(item.link).href

    return (
      <Box flexDirection="column">
        {/* 右邊留 4 格：引擎的 [-] 收合鈕畫在這一區右上角，會蓋住最後一顆按鈕 */}
        <Box flexDirection="row" paddingRight={4}>
          {/* 標籤不縮：被擠的話會折成兩行，變成「AI 新聞」一行、「4/20」一行 */}
          <Box flexShrink={0}>
            <Text color={ACCENT} bold>
              AI 新聞 {idx + 1}/{items.length}{' '}
            </Text>
          </Box>
          {/* 標題太長就換行，不截斷 */}
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="wrap">
              {/* 標題本身是超連結：⌘+點擊 由終端機直接開 */}
              <Link href={href}>{item.title}</Link>
              <Text dimColor> — {item.source}</Text>
            </Text>
          </Box>
          {/* 按鈕列不縮，空間讓給標題換行，不然最右邊的按鈕會被擠掉 */}
          <Box flexShrink={0}>
            <Button key="ai-news:prev" label="上一則" onPress={() => step($, -1)} />
            <Button key="ai-news:open" label="開啟" onPress={() => openLink($, href)} />
            <Button key="ai-news:next" label="下一則" onPress={() => step($, 1)} />
          </Box>
        </Box>
        {await next(e)}
      </Box>
    )
  })
}
