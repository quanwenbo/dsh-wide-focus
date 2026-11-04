// Regression tests for the host half: the handoff builder must work with a
// bare session stub. A missing `path`/`join` import used to surface here as a
// runtime "path is not defined" 500 from POST /context-guard/handoff.
// Run with: node --test host-tests.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const { buildHandoff } = await import('./index.js').then((mod) => mod.__test)

function fakeSession(cwd, id = 'session-test-0000abcd') {
  return {
    id,
    header: { cwd },
    snapshotEvents() {
      return [
        { type: 'user/message', data: { message: { content: [{ type: 'text', text: '把首页改宽一点' }] } } },
        { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '已改成 100% - 40px。' }] } } },
      ]
    },
  }
}

const analysis = {
  ratio: 0.42,
  estimated: true,
  turns: 3,
  toolCalls: 5,
  eventCount: 12,
  model: 'deepseek-chat',
  reasoningEffort: 'high',
  files: [{ path: 'client.js', count: 4 }],
}

test('buildHandoff writes the markdown file under docs/handoff', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'wide-focus-handoff-'))
  try {
    const result = await buildHandoff(fakeSession(cwd), analysis)
    assert.ok(result.path.startsWith(path.join(cwd, 'docs', 'handoff')))
    const text = await fs.readFile(result.path, 'utf8')
    assert.match(text, /# 会话交接/)
    assert.match(text, /## 五、下一步/)
    assert.match(text, /client\.js/)
  } finally {
    await fs.rm(cwd, { recursive: true, force: true })
  }
})
