// Unit tests for the pure helpers exposed by client.js (`plugin.__test`).
// Run with: node --test tests.mjs
import test from 'node:test'
import assert from 'node:assert/strict'

const fakeDocument = {
  documentElement: { lang: 'zh', style: { setProperty() {}, removeProperty() {} }, setAttribute() {}, removeAttribute() {} },
  head: { appendChild() {}, removeChild() {} },
  body: { appendChild() {}, removeChild() {} },
  createElement() { return { setAttribute() {}, textContent: '', remove() {} } },
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
}
globalThis.document = fakeDocument
const store = new Map()
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => { store.set(key, String(value)) },
  removeItem: (key) => { store.delete(key) },
}
Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true })
globalThis.MutationObserver = class { observe() {} disconnect() {} }

const fakeReact = {
  createElement() { return {} },
  useCallback(fn) { return fn },
  useEffect() {},
  useMemo(fn) { return fn() },
  useRef(value) { return { current: value } },
  useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}] },
  useSyncExternalStore(subscribe, get) { return get() },
}

await import('./client.js')
const spec = globalThis.__loaded
const plugin = spec.factory((name) => {
  if (name === 'react') return fakeReact
  throw new Error(`unexpected require(${name})`)
})
const { splitTaskText, moveTaskInList, normalizeTask, splitKeyword } = plugin.__test

test('splitTaskText keeps the first line as title and the rest as body', () => {
  const parsed = splitTaskText('第一段标题\n\n第二段内容\n第三行')
  assert.equal(parsed.title, '第一段标题')
  assert.equal(parsed.body, '第二段内容\n第三行')
})

test('splitTaskText strips the keyword and collapses runs of blank lines only', () => {
  const parsed = splitTaskText('把这段加入待办\n\n\n结尾')
  assert.equal(parsed.title, '把这段')
  assert.equal(parsed.body, '结尾')
})

test('splitTaskText rejects empty input', () => {
  assert.equal(splitTaskText('   \n\n '), null)
  assert.equal(splitTaskText(''), null)
})

test('splitKeyword removes the keyword runs', () => {
  assert.equal(splitKeyword('a 加入待办 b'), 'a b')
})

const baseList = [
  { id: 'a', title: 'a', body: '', status: 'todo', order: 10, sessionId: null },
  { id: 'b', title: 'b', body: '', status: 'todo', order: 20, sessionId: null },
  { id: 'c', title: 'c', body: '', status: 'in_progress', order: 10, sessionId: null },
]

test('moveTaskInList moves a task into another column at the target position', () => {
  const next = moveTaskInList(baseList, 'in_progress', 'a', 'c', false)
  const a = next.find((task) => task.id === 'a')
  const c = next.find((task) => task.id === 'c')
  assert.equal(a.status, 'in_progress')
  assert.ok(a.order < c.order)
  assert.equal(next.find((task) => task.id === 'b').status, 'todo')
})

test('moveTaskInList appends when the target is last and after=true', () => {
  const next = moveTaskInList(baseList, 'in_progress', 'b', 'c', true)
  const c = next.find((task) => task.id === 'c')
  const b = next.find((task) => task.id === 'b')
  assert.equal(b.status, 'in_progress')
  assert.ok(b.order > c.order)
})

test('moveTaskInList reorders inside one column', () => {
  const next = moveTaskInList(baseList, 'todo', 'b', 'a', false)
  const a = next.find((task) => task.id === 'a')
  const b = next.find((task) => task.id === 'b')
  assert.ok(b.order < a.order)
})

test('moveTaskInList is a no-op for an unknown id', () => {
  const next = moveTaskInList(baseList, 'todo', 'missing', 'a', false)
  assert.deepEqual(next.map((task) => task.id), baseList.map((task) => task.id))
})

test('normalizeTask keeps html and body and defaults bad statuses', () => {
  const task = normalizeTask({ id: 'x', title: '标题', body: '正文', html: '<p>正文</p>', status: 'nope' })
  assert.equal(task.status, 'todo')
  assert.equal(task.body, '正文')
  assert.equal(task.html, '<p>正文</p>')
  assert.equal(task.order, 0)
})

test('normalizeTask drops entries without a title', () => {
  assert.equal(normalizeTask({ id: 'x', title: '   ' }), null)
  assert.equal(normalizeTask(null), null)
})
