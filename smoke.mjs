// Headless smoke test: load client.js with a minimal browser shim and verify
// that the plugin object is well-formed and both slots register.
const styleNodes = []
const registered = []

class FakeEventSource {
  constructor(url) { this.url = url; this.listeners = new Map() }
  addEventListener(type, fn) { this.listeners.set(type, fn) }
  removeEventListener() {}
  close() {}
}

const fakeDocument = {
  documentElement: {
    lang: 'zh',
    style: {
      values: new Map(),
      setProperty(name, value) { this.values.set(name, value) },
      removeProperty(name) { this.values.delete(name) },
      getPropertyValue() { return '' },
      getPropertyPriority() { return '' },
    },
    setAttribute() {},
    removeAttribute() {},
  },
  head: { appendChild(node) { styleNodes.push(node) }, removeChild() {} },
  body: { appendChild() {}, removeChild() {} },
  getElementById() { return null },
  createElement() {
    return {
      attrs: {},
      setAttribute(name, value) { this.attrs[name] = value },
      textContent: '',
      remove() { this.removed = true },
    }
  },
  querySelectorAll() { return [] },
  querySelector() { return null },
  elementFromPoint() { return null },
  addEventListener() {},
  removeEventListener() {},
}

const fakeWindow = {
  __ModuleLoader__: {
    load(spec) {
      globalThis.__loaded = spec
    },
  },
  document: fakeDocument,
  location: { href: 'http://127.0.0.1:49924/' },
  innerWidth: 1600,
  innerHeight: 960,
  setInterval() { return 0 },
  clearInterval() {},
  setTimeout(fn) { return 0 },
  clearTimeout() {},
  addEventListener() {},
  removeEventListener() {},
}

const fakeLocalStorage = {
  store: new Map(),
  getItem(key) { return this.store.has(key) ? this.store.get(key) : null },
  setItem(key, value) { this.store.set(key, String(value)) },
  removeItem(key) { this.store.delete(key) },
}

globalThis.window = fakeWindow
globalThis.document = fakeDocument
globalThis.localStorage = fakeLocalStorage
Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true })
globalThis.EventSource = FakeEventSource
// merged context-guard half uses real global timers to watch the bridge
globalThis.setInterval = () => 0
globalThis.clearInterval = () => {}
globalThis.setTimeout = () => 0
globalThis.clearTimeout = () => {}
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, value: { tasks: [], workspaces: [] } }) })
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
}

const fakeReact = {
  createElement() { return {} },
  useCallback(fn) { return fn },
  useEffect() {},
  useMemo(fn) { return fn() },
  useRef(value) { return { current: value } },
  useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}] },
  useSyncExternalStore(subscribe, get) { return get() },
}
globalThis.__fakeReact = fakeReact

await import('./client.js')

const spec = globalThis.__loaded
if (!spec) throw new Error('module loader was not called')
if (spec.id !== 'dsh-wide-focus') throw new Error(`unexpected plugin id ${spec.id}`)

const plugin = spec.factory((name) => {
  if (name === 'react') return fakeReact
  throw new Error(`unexpected require(${name})`)
})

if (!plugin || typeof plugin.apply !== 'function') throw new Error('plugin.apply missing')
if (!Array.isArray(plugin.inject) || !plugin.inject.includes('slots')) throw new Error('plugin.inject missing slots')

const effects = []
const ctx = {
  slots: {
    inject(name, callback) {
      callback()
    },
    register(options, component) {
      registered.push({ slot: options.name, id: options.id, order: options.order, component })
      return () => {}
    },
  },
  get() { return undefined },
  effect(callback, label) { effects.push(label); callback() },
}

plugin.apply(ctx)

const slots = registered.map((entry) => entry.slot)
const expected = ['conversation.session.header.utilities', 'shell.overlay']
for (const slot of expected) {
  if (!slots.includes(slot)) throw new Error(`missing registration for ${slot}`)
}
for (const entry of registered) {
  if (typeof entry.id !== 'string' || entry.id.length === 0) throw new Error('registration id missing')
  if (typeof entry.order !== 'number') throw new Error('registration order missing')
  if (typeof entry.component !== 'function') throw new Error('registration component missing')
}
if (!styleNodes.some((node) => node.attrs && node.attrs['data-plugin'] === 'dsh-wide-focus')) {
  throw new Error('style element was not injected')
}
if (effects.length === 0) throw new Error('no effects registered')

console.log(JSON.stringify({
  pluginId: spec.id,
  registered: registered.map((entry) => ({ slot: entry.slot, id: entry.id, order: entry.order })),
  styles: styleNodes.length,
  effects,
}, null, 2))
console.log('smoke OK')
