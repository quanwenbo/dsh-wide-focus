// Render-probe: run the real component functions under a tiny React shim to
// surface runtime errors that smoke.mjs cannot see (smoke's createElement is a no-op).
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
  createElement() { return { setAttribute() {}, textContent: '', remove() {}, style: {}, appendChild() {} } },
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
  innerWidth: 1600,
  innerHeight: 960,
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
// the merged context-guard half polls the session bridge on a real timer; keep
// the probe process single-shot by neutralising timers globally as well.
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
const seedTasks = [
  { id: 'lt-1', title: '第一条待办', body: '第二行内容\n第三行', html: '<p>第一段</p><p><strong>粗体</strong>与<code>代码</code></p>', status: 'in_progress', order: 10, createdAt: 1, sessionId: 's1' },
  { id: 'lt-2', title: '第二条', status: 'todo', order: 20, createdAt: 2 },
  { id: 'lt-3', title: '已验收', status: 'in_review', order: 30, createdAt: 3 },
]
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, value: { tasks: seedTasks } }) })
Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true })
globalThis.MutationObserver = class { observe() {} disconnect() {} }
globalThis.NodeFilter = { SHOW_TEXT: 4 }

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
  useEffect(fn) { hookState.push(['effect', fn]) },
  useLayoutEffect(fn) { hookState.push(['effect', fn]) },
  useMemo(fn) { return fn() },
  useRef(value) { const ref = { current: value }; hookState.push(['ref', ref]); return ref },
  useState(initial) {
    const index = hookIndex++
    if (!hookState[index]) hookState[index] = ['state', typeof initial === 'function' ? initial() : initial]
    return [hookState[index][1], (value) => { hookState[index][1] = typeof value === 'function' ? value(hookState[index][1]) : value }]
  },
  useSyncExternalStore(subscribe, get) { return get() },
}

await import('./client.js')
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
  effect(callback, label) { try { callback() } catch (error) { throw new Error(`effect failed (${label}): ${error.message}`) } },
}

plugin.apply(ctx)
await new Promise((resolve) => setImmediate(resolve))

// Bridge probe: a third-party tool registered through window.__dshWideFocus must
// show up inside the panel head, and hooks inside it must survive the render.
function ProbeTool() {
  const [counter] = fakeReact.useState(7)
  fakeReact.useEffect(() => {}, [])
  return fakeReact.createElement('span', { className: 'probe-tool' }, 'CG-PROBE:' + counter)
}
if (!globalThis.window.__dshWideFocus || typeof globalThis.window.__dshWideFocus.registerTool !== 'function') {
  console.error('bridge missing on window.__dshWideFocus')
  process.exitCode = 1
} else {
  globalThis.window.__dshWideFocus.registerTool('probe', ProbeTool)
}

const walk = (node, path, out) => {
  if (node === null || node === undefined) return
  if (typeof node === 'string' || typeof node === 'number') return
  if (Array.isArray(node)) { node.forEach((child, i) => walk(child, `${path}[${i}]`, out)); return }
  if (typeof node.type === 'function') {
    hookIndex = 0
    let rendered
    if (node.type.prototype && node.type.prototype.isReactComponent) {
      const instance = new node.type(node.props || {})
      instance.props = node.props || {}
      instance.state = instance.state || {}
      rendered = instance.render()
    } else {
      rendered = node.type(node.props || {})
    }
    walk(rendered, `${path}>${node.type.name || 'anon'}`, out)
    return
  }
  out.push(path + ':' + String(node.type))
  walk(node.props && node.props.children, path, out)
}

const render = (id) => {
  const component = registered.get(id)
  if (!component) throw new Error(`not registered: ${id}`)
  hookIndex = 0
  hookState = []
  const tree = component({})
  const out = []
  walk(tree, id, out)
  return out
}

const collectText = (node, out = []) => {
  if (node === null || node === undefined) return out
  if (typeof node === 'string') { out.push(node); return out }
  if (Array.isArray(node)) { node.forEach((child) => collectText(child, out)); return out }
  if (typeof node.type === 'function') {
    hookIndex = 0
    let rendered
    if (node.type.prototype && node.type.prototype.isReactComponent) {
      const instance = new node.type(node.props || {})
      instance.props = node.props || {}
      instance.state = instance.state || {}
      rendered = instance.render()
    } else {
      rendered = node.type(node.props || {})
    }
    return collectText(rendered, out)
  }
  return collectText(node.props && node.props.children, out)
}

const report = {}
for (const id of ['wide-focus-toggle', 'wide-focus-task-panel', 'wide-focus-reload-dialog', 'wide-focus-selection-menu']) {
  try {
    report[id] = render(id).length
  } catch (error) {
    report[id] = 'ERROR: ' + error.message
  }
}
console.log(JSON.stringify(report, null, 2))
if (Object.values(report).some((value) => typeof value === 'string')) process.exitCode = 1

// Language probe: with zh-CN the panel must render Chinese copy, not English.
const panelText = (() => {
  const component = registered.get('wide-focus-task-panel')
  hookIndex = 0
  hookState = []
  return collectText(component({})).join(' | ')
})()
const englishLeaks = ['Click to collapse', 'Drag', 'Add a todo', 'Hard restart', 'Add todo', 'No todos'].filter((needle) => panelText.includes(needle))
const chineseMarkers = ['暂时搁置', '进行中', '待验收', '已验收'].filter((needle) => panelText.includes(needle))
if (!panelText.includes('CG-PROBE:')) {
  console.error(JSON.stringify({ bridge: 'FAIL', sample: panelText.slice(0, 240) }))
  process.exitCode = 1
}
if (englishLeaks.length || chineseMarkers.length < 3) {
  console.error(JSON.stringify({ language: 'FAIL', englishLeaks, chineseMarkers, sample: panelText.slice(0, 240) }))
  process.exitCode = 1
} else {
  console.log(JSON.stringify({ language: 'zh', chineseMarkers }))
}

