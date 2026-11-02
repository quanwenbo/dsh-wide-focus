// Static preview generator for README screenshots.
// Renders the real panel components through a tiny React shim, then wraps the
// markup in a mock DSH window so the screenshots look like real usage.
import fs from 'node:fs'
import path from 'node:path'

const styleNodes = []
const registered = new Map()

const fakeDocument = {
  documentElement: {
    lang: 'zh',
    style: {
      values: new Map(),
      setProperty(name, value) { this.values.set(name, value) },
      removeProperty(name) { this.values.delete(name) },
      getPropertyValue(name) { return this.values.get(name) || '' },
      getPropertyPriority() { return '' },
    },
    setAttribute() {},
    removeAttribute() {},
  },
  head: { appendChild(node) { styleNodes.push(node) }, removeChild() {} },
  body: { appendChild() {}, removeChild() {} },
  getElementById() { return null },
  createElement(tag) {
    return {
      tagName: tag,
      setAttribute() {},
      textContent: '',
      remove() {},
      style: {},
      appendChild() {},
    }
  },
  querySelectorAll() { return [] },
  querySelector() { return null },
  elementFromPoint() { return null },
  addEventListener() {},
  removeEventListener() {},
}

globalThis.window = {
  __ModuleLoader__: { load(spec) { globalThis.__loaded = spec } },
  document: fakeDocument,
  location: { href: 'http://127.0.0.1/' },
  innerWidth: 1680,
  innerHeight: 1000,
  setInterval() { return 0 },
  clearInterval() {},
  setTimeout() { return 0 },
  clearTimeout() {},
  addEventListener() {},
  removeEventListener() {},
  getSelection: () => null,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
}
globalThis.document = fakeDocument
globalThis.setInterval = () => 0
globalThis.clearInterval = () => {}
globalThis.setTimeout = () => 0
globalThis.clearTimeout = () => {}
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)) },
  removeItem: (k) => { store.delete(k) },
}
globalThis.MutationObserver = class { observe() {} disconnect() {} }
globalThis.NodeFilter = { SHOW_TEXT: 4 }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true })

// Start from a roomy panel so the screenshot shows the full tab labels.
const SHOT = process.env.SHOT || 'overview'
const PANEL_W = SHOT === 'narrow' ? 340 : 470
const PANEL_H = 470
store.set('dsh.wide-focus.panelSize', JSON.stringify({ width: PANEL_W, height: PANEL_H }))

// Mock tasks: a plausible slice of the Bobstar short-drama workboard.
const now = Date.now()
const tasks = [
  {
    id: 't1',
    title: '首页 Hero 改版：标题字重与两行副标题',
    body: '把 56px 标题压到 48px，副标题允许两行；移动端断点 640px 缩到 32px。',
    status: 'in_review',
    order: 10,
    createdAt: now - 86400000,
    sessionId: 'sess-preview',
  },
  {
    id: 't2',
    title: 'P1 修复项目页横向滚动',
    body: 'grid 列宽改成 minmax(0, 1fr)，图片容器加 overflow: hidden。',
    status: 'in_review',
    order: 20,
    createdAt: now - 86000000,
    sessionId: 'sess-preview',
  },
  {
    id: 't3',
    title: '分镜数据结构：从 scene 拆出 shot',
    html: '<p>每个 scene 下面挂 shots[]，字段跟分镜表对齐。</p><p><strong>迁移</strong>只做新项目，旧数据不兼容。</p>',
    status: 'in_progress',
    order: 30,
    createdAt: now - 72000000,
    sessionId: 'sess-preview',
  },
  {
    id: 't4',
    title: '角色卡：锁定后的视觉状态',
    body: '锁定后给 8% 灰度 + 右上角小锁，不弹窗。',
    status: 'in_progress',
    order: 40,
    createdAt: now - 68000000,
    sessionId: 'sess-preview',
  },
  {
    id: 't8',
    title: '首屏加载骨架：三行占位 + 渐显',
    body: '骨架屏 120ms 内出现，图片解码完再淡入。',
    status: 'in_progress',
    order: 45,
    createdAt: now - 66000000,
    sessionId: 'sess-preview',
  },
  {
    id: 't9',
    title: '短剧详情页：剧集列表分页',
    body: '每页 20 集，滚动到底自动加载；失败重试按钮放在列表底部。',
    status: 'in_progress',
    order: 48,
    createdAt: now - 64000000,
    sessionId: 'sess-preview',
  },
  {
    id: 't5',
    title: '视觉规范 v2.1：按钮对比度复核',
    body: '黑底白字按钮在浅色页面上的 hover 需要再压 6%。',
    status: 'todo',
    order: 50,
    createdAt: now - 36000000,
    sessionId: 'sess-preview',
  },
  {
    id: 't6',
    title: 'P2 首页动效收尾',
    body: '滚动进场的 stagger 目前 120ms，改到 80ms 更稳。',
    status: 'todo',
    order: 60,
    createdAt: now - 30000000,
    sessionId: 'sess-preview',
  },
  {
    id: 't7',
    title: '宽屏模式 + 任务面板 0.11.x 收尾',
    body: '响应式分档、计数发光、拖拽抓手都已验证。',
    status: 'done',
    order: 70,
    createdAt: now - 200000000,
    sessionId: 'sess-preview',
  },
]

const guardPayload = {
  session: 'sess-preview',
  model: 'deepseek-flash',
  provider: 'deepseek-account',
  contextWindow: 1048576,
  promptTokens: 868000,
  ratio: 0.828,
  estimated: false,
  cacheReadTokens: 530000,
  cacheWriteTokens: 0,
  cacheHitRate: 0.61,
  turns: 41,
  toolCalls: 96,
  files: ['client.js', 'index.js', 'README.md', 'styles.css'],
  looksLikeDiscussion: false,
  thresholds: { warn: 0.6, mid: 0.7, high: 0.8, switch: 0.85 },
}

const fetched = []
globalThis.fetch = async (url) => {
  fetched.push(String(url))
  if (String(url).includes('/wide-focus/tasks')) {
    return { ok: true, status: 200, json: async () => ({ ok: true, value: { tasks } }) }
  }
  return { ok: true, status: 200, json: async () => ({ ok: true, value: guardPayload }) }
}

let hookState = []
let hookIndex = 0
class FakeComponent {
  constructor(props) { this.props = props; this.state = {} }
}
FakeComponent.prototype.isReactComponent = {}
const fakeReact = {
  Component: FakeComponent,
  Fragment: 'Fragment',
  createElement(type, props, ...children) {
    return { type, props: { ...(props || {}), children: children.length === 1 ? children[0] : children } }
  },
  useCallback(fn) { return fn },
  useEffect(fn) { try { fn() } catch { /* preview ignores effect errors */ } },
  useLayoutEffect(fn) { try { fn() } catch { /* preview ignores effect errors */ } },
  useMemo(fn) { return fn() },
  useRef(value) { return { current: value } },
  useState(initial) {
    const index = hookIndex++
    if (!hookState[index]) hookState[index] = ['state', typeof initial === 'function' ? initial() : initial]
    return [hookState[index][1], (value) => { hookState[index][1] = typeof value === 'function' ? value(hookState[index][1]) : value }]
  },
  useSyncExternalStore(subscribe, get) { return get() },
}

await import('../client.js')
const spec = globalThis.__loaded
const plugin = spec.factory((name) => {
  if (name === 'react') return fakeReact
  throw new Error(`unexpected require(${name})`)
})

const ctx = {
  slots: {
    inject(name, callback) { callback() },
    register(options, component) { registered.set(options.id, component); return () => {} },
  },
  get() { return undefined },
  effect(callback) { try { callback() } catch { /* preview ignores side effects */ } },
}

plugin.apply(ctx)
await new Promise((resolve) => setImmediate(resolve))

// First pass runs the guard chip's mount effects (which fetch /context-guard/state);
// flush the microtask queue so the second pass reads the real numbers.
const toggle = registered.get('wide-focus-toggle')
if (toggle) renderComponent(toggle, { sessionId: 'sess-preview' })
const recorder = registered.get('context-guard-session')
if (recorder) renderComponent(recorder, { sessionId: 'sess-preview' })

// Warm-up render happens after the serializer is defined (below).

const esc = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

const styleToCss = (style) => {
  if (!style) return ''
  if (typeof style === 'string') return style
  return Object.entries(style)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}:${value}`)
    .join(';')
}

const childrenOf = (node) => {
  const props = node.props || {}
  const raw = props.children
  return Array.isArray(raw) ? raw : [raw]
}

function renderComponent(type, props) {
  const savedHooks = hookState
  const savedIndex = hookIndex
  hookState = []
  hookIndex = 0
  try {
    if (type.prototype && type.prototype.isReactComponent) {
      const instance = new type(props || {})
      instance.props = props || {}
      instance.state = instance.state || {}
      return instance.render()
    }
    return type(props || {})
  } finally {
    hookState = savedHooks
    hookIndex = savedIndex
  }
}

function serialize(node) {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string') return esc(node)
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(serialize).join('')
  if (typeof node.type === 'function') {
    return serialize(renderComponent(node.type, node.props))
  }
  if (node.type === 'Fragment') {
    return childrenOf(node).map(serialize).join('')
  }
  const tag = node.type
  const props = node.props || {}
  const attrs = []
  if (props.className) attrs.push(`class="${esc(props.className)}"`)
  const styleCss = styleToCss(props.style)
  if (styleCss) attrs.push(`style="${esc(styleCss)}"`)
  for (const [key, value] of Object.entries(props)) {
    if (key === 'children' || key === 'style' || key === 'className' || key === 'dangerouslySetInnerHTML') continue
    if (value === null || value === undefined || value === false) continue
    if (typeof value === 'function') continue
    if (key === 'key' || key === 'ref') continue
    if (/^(on|use)/.test(key)) continue
    const keepCamel = /^(viewBox|preserveAspectRatio|gradientUnits|patternUnits|clipPathUnits)$/.test(key)
    const name = keepCamel ? key : key.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
    if (value === true) { attrs.push(name); continue }
    attrs.push(`${name}="${esc(value)}"`)
  }
  const open = `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>`
  if (props.dangerouslySetInnerHTML && props.dangerouslySetInnerHTML.__html) {
    return `${open}${props.dangerouslySetInnerHTML.__html}</${tag}>`
  }
  const inner = childrenOf(node).map(serialize).join('')
  return `${open}${inner}</${tag}>`
}

// Warm-up render: walk the whole tree once so the chip's mount effect fires its
// fetch, then flush microtasks and serialize again with real numbers in the store.
serialize(renderComponent(registered.get('wide-focus-task-panel'), {}))
for (let i = 0; i < 48; i += 1) await Promise.resolve()

const panelHtml = serialize(renderComponent(registered.get('wide-focus-task-panel'), {}))
const cardHtml = (() => {
  const card = registered.get('context-guard-card')
  if (!card) return ''
  globalThis.window.__contextGuard.toggle(true)
  return serialize(renderComponent(card, {}))
})()
const styles = styleNodes.map((node) => node.textContent || '').join('\n')

const page = ({ width, height, withCard, label }) => `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; width: ${width}px; height: ${height}px; overflow: hidden;
    background: #050506;
    font-family: "Microsoft YaHei UI", "PingFang SC", "Segoe UI", system-ui, sans-serif;
    color: #e8e8ea;
  }
  .demo {
    position: relative; width: 100%; height: 100%;
    background:
      radial-gradient(1200px 600px at 18% -10%, rgba(124,108,255,.10), transparent 60%),
      radial-gradient(900px 500px at 100% 110%, rgba(56,189,248,.07), transparent 60%),
      #050506;
  }
  .titlebar {
    height: 44px; display: flex; align-items: center; gap: 10px;
    padding: 0 14px; border-bottom: 1px solid #17171c; background: #07070a;
    color: #9a9aa5; font-size: 12px;
  }
  .titlebar .dots { display: flex; gap: 6px; }
  .titlebar .dots i { width: 9px; height: 9px; border-radius: 50%; background: #232329; display: block; }
  .titlebar .brand { color: #d6d6dc; font-weight: 600; letter-spacing: .2px; }
  .titlebar .spacer { flex: 1; }
  .titlebar .chip { border: 1px solid #26262e; background: #101015; color: #8b8b96; border-radius: 999px; padding: 3px 10px; }
  .titlebar .wide { border: 1px solid rgba(56,189,248,.45); color: #8ed8ff; background: rgba(56,189,248,.08); border-radius: 7px; padding: 4px 12px; font-weight: 600; }

  .shell { display: flex; height: ${height - 44}px; }
  .sidebar {
    width: 232px; padding: 14px 12px; border-right: 1px solid #141418; background: #08080b;
    display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: #9a9aa5;
  }
  .sidebar .brand { color: #e6e6ea; font-size: 15px; font-weight: 700; padding: 8px 10px 18px; }
  .sidebar .item { padding: 8px 10px; border-radius: 8px; }
  .sidebar .item.on { background: #14141b; color: #f0f0f4; box-shadow: inset 0 0 0 1px #232330; }
  .sidebar .item small { color: #6b6b78; margin-left: 6px; }

  .main { position: relative; flex: 1; min-width: 0; }
  .thread {
    width: calc(100% - 40px); max-width: none; margin: 0 auto;
    padding: 30px 530px 120px 0; display: flex; flex-direction: column; gap: 22px;
  }
  .composer {
    position: absolute; left: 46%; bottom: 22px; transform: translateX(-50%);
    width: 52%; height: 58px; border-radius: 14px; border: 1px solid #26262f; background: #0d0d12;
    display: flex; align-items: center; padding: 0 16px; color: #6a6a76; font-size: 13px; gap: 10px;
  }
  .meta { color: #63636f; font-size: 12px; display: flex; gap: 12px; align-items: center; }
  .msg { padding: 16px 18px; border-radius: 14px; line-height: 1.75; font-size: 14.5px; }
  .msg.user { align-self: flex-end; max-width: 72%; background: #141420; border: 1px solid #24243a; color: #e7e7ee; }
  .msg.ai { background: #0a0a0e; border: 1px solid #17171d; color: #d9d9e0; }
  .msg.ai h3 { margin: 4px 0 10px; font-size: 17px; color: #f5f5f7; letter-spacing: .2px; }
  .msg.ai p { margin: 0 0 10px; }
  .msg.ai code { background: #15151c; border: 1px solid #26262f; border-radius: 5px; padding: 1px 5px; font-size: 12.5px; color: #9ecbff; }
  .msg.ai ul { margin: 0 0 10px; padding-left: 20px; }
  .msg.ai li { margin: 3px 0; }
  .msg.ai .accent { color: #a5b4fc; }
  .composer .send { margin-left: auto; width: 30px; height: 30px; border-radius: 50%; background: #f4f4f5; color: #0b0b0e; display: grid; place-items: center; font-size: 15px; }

  ${withCard ? '.wf-panel { filter: blur(2.5px) saturate(.8) brightness(.86); opacity: .42; }' : ''}
  .wf-panel, .cg-card { position: absolute !important; }
  .cg-mask { position: absolute !important; inset: 0 !important; }
  .cg-card { left: auto !important; top: auto !important; }
  .demo-panel { position: absolute; right: 26px; top: 74px; z-index: 40; }
  .demo-panel .wf-panel { position: relative !important; left: auto !important; top: auto !important; right: auto !important; bottom: auto !important; width: ${PANEL_W}px !important; height: ${PANEL_H}px !important; }
  .demo-card { position: absolute; right: 52px; top: 96px; width: 420px; z-index: 41; }
  .demo-card .cg-card { position: relative !important; left: auto !important; top: auto !important; width: 100% !important; }
  .caption {
    position: absolute; right: 26px; bottom: 20px; font-size: 11.5px; color: #5c5c68; letter-spacing: .3px;
  }
  ${styles}
</style>
</head>
<body>
<div class="demo">
  <div class="titlebar">
    <div class="dots"><i></i><i></i><i></i></div>
    <div class="brand">deepseek</div>
    <div class="chip">deepseek-flash</div>
    <div class="spacer"></div>
    <div class="wide">宽屏模式</div>
  </div>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">Bobstar</div>
      <div class="item on">新会话 <small>⌘N</small></div>
      <div class="item">任务面板 <small>12</small></div>
      <div class="item">插件</div>
      <div class="item">记忆宫殿</div>
      <div class="item">设置</div>
      <div style="flex:1"></div>
      <div class="item">最近会话</div>
      <div class="item on">官网首页改版</div>
      <div class="item">分镜数据结构</div>
    </aside>
    <main class="main">
      <div class="thread">
        <div class="meta">今天 21:08 · 上下文 82%</div>
        <div class="msg user">首页 Hero 区还是有点散，标题、副标题、两个按钮之间的呼吸感不对。宽屏开着我这边看还是有点挤，帮我把版式重新排一下。</div>
        <div class="msg ai">
          <h3>Hero 区：收束成左侧单列</h3>
          <p>现在的问题不是空间不够，而是三块内容在抢注意力。把主标题压到 <code>48px</code>、副标题限制两行，按钮只留一个主按钮和一个文本链接，视线会自然往下走。</p>
          <ul>
            <li>标题 <span class="accent">48 / 1.15</span>，字重 700；副标题 <span class="accent">17 / 1.7</span>，最多两行。</li>
            <li>主按钮与文本链接之间留 <code>16px</code>，不要并排等宽。</li>
            <li>640px 以下标题降到 <code>32px</code>，副标题改成一行截断。</li>
          </ul>
          <p>宽屏模式下这一列会铺到 <code>100% - 40px</code>，右侧不再有大片空白，长回答和对照表都能一次看完。</p>
        </div>
      </div>
      <div class="composer"><span>发消息或创建任务…</span><span class="send">↑</span></div>
    </main>
  </div>
  <div class="demo-panel">${panelHtml}</div>
  ${withCard ? `<div class="demo-card">${cardHtml}</div>` : ''}
  <div class="caption">${label}</div>
</div>
</body>
</html>`

const outDir = path.resolve('docs/screenshots')
fs.mkdirSync(outDir, { recursive: true })

const shots = SHOT === 'narrow'
  ? [{ file: 'narrow.png', width: 1680, height: 1000, withCard: false, label: '窄宽度（340px）：单字标签 + 计数，工具条自动收紧（示例数据）' }]
  : [
      { file: 'overview.png', width: 1680, height: 1000, withCard: false, label: '宽屏模式 + 悬浮任务面板（示例数据）' },
      { file: 'context-card.png', width: 1680, height: 1000, withCard: true, label: '上下文管家：占用、缓存、连贯性与继续/新开建议（示例数据）' },
    ]

for (const shot of shots) {
  const file = path.join(outDir, shot.file.replace(/\.png$/, '.html'))
  fs.writeFileSync(file, page(shot))
  console.log('wrote', file)
}
