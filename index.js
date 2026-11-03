/**
 * Host half of wide-focus.
 *
 * Provides one local route so the client can mirror its todo list into the
 * DSH profile directory (`<profile>/wide-focus/tasks.json`):
 *
 * - `GET  /wide-focus/tasks` -> `{ ok: true, value: { tasks: Task[] } }`
 * - `PUT  /wide-focus/tasks` <- `{ tasks: Task[] }` (atomic replace)
 *
 * The write goes to a sibling temp file first and is renamed over the target,
 * so a crash mid-write cannot leave a truncated list behind. Everything is
 * local: no network, no third-party store, no taskboard dependency.
 *
 * @module wide-focus (host)
 */
import fs from 'node:fs/promises'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export const name = 'wide-focus'

const ROUTE = '/wide-focus/tasks'
const MAX_BODY = 2 * 1024 * 1024

// context guard constants (merged)
const CG_MAX_BODY = 64 * 1024
const ROUTE_EFFORT = '/wide-focus/effort'
const EFFORT_LEVELS = ['off', 'low', 'high', 'max']
const EFFORT_LABELS = { off: 'Off', low: 'Low', high: 'High', max: 'Max' }

const ROUTE_STATE = '/context-guard/state'
const ROUTE_HANDOFF = '/context-guard/handoff'
const WARN_RATIO = 0.6
const MID_RATIO = 0.7
const HIGH_RATIO = 0.8
const SWITCH_RATIO = 0.85
const DEFAULT_WINDOW = 128000

function dataPath() {
  const base = process.env.DSH_PROFILE_DIR
    || (process.env.DSH_HOME ? resolve(process.env.DSH_HOME) : join(homedir(), '.dsh'))
  return join(base, 'wide-focus', 'tasks.json')
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

function readBody(req) {
  return new Promise((resolvePromise, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) { reject(new Error('payload_too_large')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function readTasks(file) {
  try {
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed
    if (parsed && Array.isArray(parsed.tasks)) return parsed.tasks
    return []
  } catch {
    return []
  }
}

async function writeTasks(file, tasks) {
  await mkdir(dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  await writeFile(temp, JSON.stringify({ version: 1, tasks }, null, 2), 'utf8')
  try {
    await rename(temp, file)
  } catch (error) {
    try { await unlink(temp) } catch { /* ignore */ }
    throw error
  }
}

// ---- context guard analysis (merged from @local/context-guard) ---------------
function textOfMessage(message) {
  if (!message) return ''
  const content = message.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts = []
    for (const block of content) {
      if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    }
    return parts.join('\n')
  }
  return ''
}

const FILE_KEYS = ['path', 'file_path', 'notebook_path', 'target_file', 'filePath', 'filepath']

function noteFilePath(argumentsText, files) {
  if (typeof argumentsText !== 'string' || argumentsText.length === 0 || argumentsText.length > 20000) return
  let args
  try { args = JSON.parse(argumentsText) } catch { return }
  if (!args || typeof args !== 'object') return
  for (const key of FILE_KEYS) {
    const value = args[key]
    if (typeof value === 'string' && value.length > 0 && value.length < 400) files.set(value, (files.get(value) || 0) + 1)
  }
}

function analyze(session, tokenMeter, projections) {
  const events = session.snapshotEvents()
  let usage = null
  let model = null
  let provider = null
  let turns = 0
  let toolCalls = 0
  const files = new Map()
  const turnStats = []
  let messageChars = 0
  for (const event of events) {
    if (event.type === 'user/message' || event.type === 'assistant/message') {
      const data = event.data || {}
      messageChars += textOfMessage(data.message).length
    }
    if (event.type === 'turn/start') {
      turns += 1
      turnStats.push({ tools: 0, answers: 0 })
      continue
    }
    const current = turnStats[turnStats.length - 1]
    if (event.type === 'tool/call') {
      toolCalls += 1
      if (current) current.tools += 1
      noteFilePath(event.data && event.data.arguments, files)
    } else if (event.type === 'assistant/message') {
      if (current) current.answers += 1
      const data = event.data || {}
      if (data.usage) usage = data.usage
      const source = data.message && data.message.source
      if (source && typeof source.model === 'string') model = source.model
      if (source && typeof source.provider === 'string') provider = source.provider
    }
  }
  const recentTurns = turnStats.slice(-10)
  const answerOnly = recentTurns.filter((turn) => turn.tools === 0 && turn.answers > 0).length
  const looksLikeDiscussion = recentTurns.length >= 3 && answerOnly / recentTurns.length >= 0.5
  const requestContext = typeof session.requestContext === 'function' ? session.requestContext() : undefined
  const requestHeader = typeof session.requestHeader === 'function' ? session.requestHeader() : undefined
  let projectionPressure = 0
  let projectionWindow = 0
  if (projections && typeof projections.stateOf === 'function') {
    try {
      const pressure = projections.stateOf(session, 'contextPressure')
      if (pressure) {
        projectionPressure = Number(pressure.projectedTokens) || 0
        projectionWindow = Number(pressure.contextWindow) || 0
        if (projectionPressure === 0) projectionPressure = Number(pressure.pressureTokens) || 0
      }
    } catch { /* projection unavailable in this process */ }
  }
  const windowFromContext = Number(requestContext && requestContext.contextWindow) || 0
  const contextWindow = projectionWindow > 0 ? projectionWindow : (windowFromContext > 0 ? windowFromContext : DEFAULT_WINDOW)
  if (requestContext && typeof requestContext.model === 'string') model = model || requestContext.model
  if (requestContext && typeof requestContext.provider === 'string') provider = provider || requestContext.provider
  const reasoningEffort = requestHeader && requestHeader.config && requestHeader.config.reasoningEffort
    ? String(requestHeader.config.reasoningEffort)
    : null
  let inputTokens = Number(usage && usage.inputTokens) || 0
  let outputTokens = Number(usage && usage.outputTokens) || 0
  let cacheReadTokens = Number(usage && usage.cacheReadTokens) || 0
  let cacheWriteTokens = Number(usage && usage.cacheWriteTokens) || 0
  let estimated = false
  let source = 'none'
  let promptTokens = 0

  // 1) The provider's own last report, folded by sessionProjections, is the
  //    closest thing to "what the model actually saw last".
  const usagePrompt = inputTokens + cacheReadTokens + cacheWriteTokens
  if (projectionPressure > 0) {
    promptTokens = projectionPressure
    source = 'pressure'
  } else if (usagePrompt > 0) {
    promptTokens = usagePrompt
    source = 'usage'
  }

  // 2) tokenMeter only wins when it can reuse the provider's accounting for the
  //    current envelope. A full-envelope re-estimate can exceed the model window
  //    and must never be displayed as the live prompt size.
  if (source === 'none' && tokenMeter && typeof tokenMeter.measure === 'function') {
    try {
      const measured = tokenMeter.measure(session, requestHeader)
      const total = Number(measured && measured.totalTokens)
      const kind = measured && measured.baseline ? measured.baseline.kind : 'none'
      if (total > 0 && (kind === 'usage' || total <= contextWindow)) {
        promptTokens = total
        source = 'meter'
        estimated = kind !== 'usage'
        const baseUsage = kind === 'usage' ? measured.baseline.usage : null
        if (baseUsage) {
          inputTokens = Number(baseUsage.inputTokens) || inputTokens
          cacheReadTokens = Number(baseUsage.cacheReadTokens) || cacheReadTokens
          cacheWriteTokens = Number(baseUsage.cacheWriteTokens) || cacheWriteTokens
        }
      }
    } catch { /* fall back to character estimate */ }
  }

  if (promptTokens === 0) {
    // Restored / background sessions often keep no `usage` on the live snapshot:
    // fall back to a character-based estimate of the replayed history so the badge
    // is never stuck at 0% for a session that clearly has content.
    try {
      const messages = typeof session.deriveMessages === 'function' ? session.deriveMessages() : []
      let chars = 0
      for (const message of messages) {
        const content = message && Array.isArray(message.content) ? message.content : []
        for (const block of content) {
          if (block && typeof block.text === 'string') chars += block.text.length
          else if (block && typeof block.arguments === 'string') chars += block.arguments.length
        }
      }
      if (chars > 0) {
        inputTokens = Math.round(chars / 3.2)
        promptTokens = inputTokens
        estimated = true
      }
    } catch { /* keep 0 */ }
    if (promptTokens === 0 && messageChars > 0) {
      inputTokens = Math.round(messageChars / 3.2)
      promptTokens = inputTokens
      estimated = true
    }
  }
  const rawRatio = contextWindow > 0 ? promptTokens / contextWindow : 0
  const ratio = Math.min(rawRatio, 1)
  const overflow = rawRatio > 1.02
  const cacheHitRate = promptTokens > 0 ? Math.min(cacheReadTokens / promptTokens, 1) : 0
  return {
    model,
    provider,
    reasoningEffort,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    promptTokens,
    contextWindow,
    ratio,
    rawRatio,
    overflow,
    source,
    estimated,
    cacheHitRate,
    turns,
    toolCalls,
    eventCount: events.length,
    recentTurns: recentTurns.length,
    answerOnly,
    looksLikeDiscussion,
    effortHint: looksLikeDiscussion ? 'low' : null,
    files: Array.from(files.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([path, count]) => ({ path, count })),
    thresholds: { warn: WARN_RATIO, mid: MID_RATIO, high: HIGH_RATIO, switch: SWITCH_RATIO },
  }
}

// Exposed for local probes: the measurement chain is the part most likely to
// drift when DSH changes its usage/projection contracts.
export const __test = { analyze }


function profileDir() {
  const base = process.env.DSH_PROFILE_DIR || process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return base
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text) { resolve({}); return }
      try { resolve(JSON.parse(text)) } catch (error) { reject(error) }
    })
    req.on('error', reject)
  })
}

function stamp(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
}

async function readOpenTodos() {
  try {
    const file = path.join(profileDir(), 'wide-focus', 'tasks.json')
    const raw = await fs.readFile(file, 'utf8')
    const parsed = JSON.parse(raw)
    const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : []
    return tasks.filter((task) => task && task.status !== 'done' && !task.trashedAt)
  } catch {
    return []
  }
}

function recentUserTexts(events, limit) {
  const texts = []
  for (const event of events) {
    if (event.type !== 'user/message') continue
    const text = textOfMessage(event.data && event.data.message).trim()
    if (text) texts.push(text)
  }
  return texts.slice(-limit)
}

function lastAssistantText(events, limit) {
  let last = ''
  for (const event of events) {
    if (event.type !== 'assistant/message') continue
    const text = textOfMessage(event.data && event.data.message).trim()
    if (text) last = text
  }
  return last.slice(0, limit)
}

async function buildHandoff(session, analysis) {
  const events = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : []
  const cwd = session.header && session.header.cwd ? String(session.header.cwd) : process.cwd()
  const asks = recentUserTexts(events, 8)
  const lastAnswer = lastAssistantText(events, 1200)
  const todos = await readOpenTodos()
  const files = Array.isArray(analysis.files) ? analysis.files.slice(0, 8) : []
  const percent = Math.round((Number(analysis.ratio) || 0) * 100)
  const sessionShort = String(session.id || '').slice(-8)

  const lines = []
  lines.push(`# 会话交接：${sessionShort}`, '')
  lines.push(`> 生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })} · 会话 \`${session.id}\` · 模型 \`${analysis.model || 'unknown'}\` · 占用 ${percent}%${analysis.estimated ? '（估算）' : ''}`, '')
  lines.push('## 一、我们在做什么', '')
  if (asks.length) {
    lines.push('最近的需求（从旧到新）：', '')
    for (const ask of asks) lines.push(`- ${ask.split('\n')[0].slice(0, 160)}`)
  } else {
    lines.push('- （没有拿到用户消息，从「三、当前状态」继续。）')
  }
  lines.push('')
  lines.push('## 二、最近改了什么', '')
  if (files.length) {
    for (const file of files) lines.push(`- \`${file.path}\`（${file.count} 次）`)
  } else {
    lines.push('- （没有记录到文件改动。）')
  }
  lines.push('')
  lines.push('## 三、当前状态', '')
  lines.push(`- 上下文占用：${percent}%${analysis.estimated ? '（按消息长度估算）' : ''}`)
  lines.push(`- 轮次：${analysis.turns} · 工具调用：${analysis.toolCalls} · 事件数：${analysis.eventCount}`)
  lines.push(`- 模型：\`${analysis.model || 'unknown'}\` · 推理强度：\`${analysis.reasoningEffort || 'default'}\``)
  if (lastAnswer) {
    lines.push('', '最后一条回答（截断）：', '', '> ' + lastAnswer.replace(/\n+/g, '\n> '))
  }
  lines.push('')
  lines.push('## 四、关键决策 / 约束', '')
  lines.push('- 见任务面板里的待办与上文记录；未写下来的隐性上下文不会自动带过去。')
  lines.push('')
  lines.push('## 五、下一步（自动生成，可修改）', '')
  if (todos.length > 0) {
    lines.push(`- [ ] 继续任务面板里的「${String(todos[0].title || '').slice(0, 60)}」（当前状态 ${todos[0].status}）`)
  }
  for (const file of files.slice(0, 3)) lines.push(`- [ ] 回归最近改动：\`${file.path}\``)
  lines.push('- [ ] 先把这份交接读一遍，再继续')
  if (asks.length > 0) lines.push(`- [ ] 最近一条请求：${asks[asks.length - 1].split('\n')[0].slice(0, 120)}`)
  lines.push('')

  const markdown = lines.join('\n')
  const dir = path.join(cwd, 'docs', 'handoff')
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, `${stamp(new Date())}-${sessionShort}.md`)
  await fs.writeFile(file, markdown, 'utf8')
  return { path: file, markdown }
}

function effortPath() {
  const base = process.env.DSH_PROFILE_DIR
    || (process.env.DSH_HOME ? resolve(process.env.DSH_HOME) : join(homedir(), '.dsh'))
  return join(base, 'wide-focus', 'effort.json')
}

const effortDefaults = () => ({ mode: 'auto', fixed: 'high' })

async function readEffort(file) {
  try {
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw)
    const mode = ['auto', 'suggest', 'fixed'].includes(parsed.mode) ? parsed.mode : 'auto'
    const fixed = EFFORT_LEVELS.includes(parsed.fixed) ? parsed.fixed : 'high'
    return { mode, fixed }
  } catch {
    return effortDefaults()
  }
}

async function writeEffort(file, next) {
  const tmp = file + '.tmp'
  await mkdir(dirname(file), { recursive: true })
  await writeFile(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8')
  await rename(tmp, file)
}

function recommendEffort(text) {
  const value = String(text || '').trim()
  if (!value) return { effort: 'high', reason: '没有拿到本轮提问，保持默认' }
  const short = value.length <= 40
  const confirm = short && /^(继续|好|好的|可以|嗯|是|是的|行|对|ok|okay|谢谢|收到|明白)/i.test(value)
  if (confirm) return { effort: 'low', reason: '短确认 / 继续指令' }
  const code = /```/.test(value)
  const heavy = /(架构|重构|设计|方案|调试|排查|为什么|多文件|全部|彻底|深入|性能|优化|测试失败|报错|崩溃|分析)/i.test(value)
  const deep = /(全面|系统性地|彻底|一次性|仔细|全部改|重构一遍)/i.test(value)
  const todo = /(实现|新增|添加|修改|修复|改一下|换成|调整|删除|合并|迁移)/i.test(value)
  if (deep && (code || value.length > 200)) return { effort: 'max', reason: '大范围 / 深挖型任务' }
  if (heavy && (code || value.length > 120)) return { effort: 'high', reason: '排查、设计或多文件改动' }
  if (value.length > 900) return { effort: 'max', reason: '长需求，信息量很大' }
  if (todo && !code && value.length < 200) return { effort: 'high', reason: '代码改动' }
  if (!code && value.length < 120 && !/\?$/.test(value)) return { effort: 'low', reason: '短问答' }
  if (/(为什么|怎么回事|报错|失败)/.test(value)) return { effort: 'high', reason: '需要定位原因' }
  return { effort: 'high', reason: '默认保持高一点' }
}

export function apply(ctx) {
  const file = dataPath()

  const handler = async (req, res) => {
    try {
      if (req.method === 'GET') {
        const tasks = await readTasks(file)
        sendJson(res, 200, { ok: true, value: { tasks } })
        return
      }
      if (req.method === 'PUT' || req.method === 'POST') {
        const raw = await readBody(req)
        const parsed = JSON.parse(raw)
        const tasks = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.tasks) ? parsed.tasks : null
        if (!tasks) { sendJson(res, 400, { ok: false, error: { code: 'invalid_payload', message: 'tasks array expected' } }); return }
        await writeTasks(file, tasks)
        sendJson(res, 200, { ok: true, value: { count: tasks.length } })
        return
      }
      sendJson(res, 405, { ok: false, error: { code: 'method_not_allowed', message: req.method } })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      sendJson(res, message === 'payload_too_large' ? 413 : 500, { ok: false, error: { code: 'storage_error', message } })
    }
  }

  const effortFile = effortPath()
  let effort = effortDefaults()
  let lastUserText = ''
  let lastApplied = null
  let lastObserved = null
  let lastAdvice = { effort: 'high', reason: '尚未观察' }

  void readEffort(effortFile).then((value) => { effort = value })

  ctx.effect(() => ctx.on('session/event', (event) => {
    try {
      if (event && event.type === 'user/message') {
        const text = textOfMessage(event.data && event.data.message)
        if (text.trim()) lastUserText = text
      }
    } catch { /* ignore malformed events */ }
  }))

  ctx.effect(() => ctx.on('llm/stream', (options) => {
    if (options && typeof options === 'object' && options.reasoningEffort) lastObserved = String(options.reasoningEffort)
  }))

  ctx.effect(() => ctx.on('agent/request', async (payload, next) => {
    const config = await next()
    if (!config || typeof config !== 'object') return config
    const advice = recommendEffort(lastUserText)
    lastAdvice = advice
    if (!lastObserved) lastObserved = config.reasoningEffort || null
    try {
      if (effort.mode === 'fixed') {
        lastApplied = effort.fixed
        return { ...config, reasoningEffort: effort.fixed }
      }
      if (effort.mode === 'auto') {
        const manual = Boolean(lastApplied && config.reasoningEffort && config.reasoningEffort !== lastApplied)
        if (manual) return config
        lastApplied = advice.effort
        return { ...config, reasoningEffort: advice.effort }
      }
    } catch { /* never break a model call because of the plugin */ }
    return config
  }))

  const effortHandler = async (req, res) => {
    try {
      if (req.method === 'GET') {
        sendJson(res, 200, {
          ok: true,
          value: {
            mode: effort.mode,
            fixed: effort.fixed,
            levels: EFFORT_LEVELS.map((id) => ({ id, label: EFFORT_LABELS[id] })),
            current: lastObserved,
            applied: lastApplied,
            recommended: lastAdvice.effort,
            reason: lastAdvice.reason,
          },
        })
        return
      }
      if (req.method === 'POST') {
        const raw = await readBody(req)
        const parsed = JSON.parse(raw || '{}')
        const mode = ['auto', 'suggest', 'fixed'].includes(parsed.mode) ? parsed.mode : effort.mode
        const fixed = EFFORT_LEVELS.includes(parsed.fixed) ? parsed.fixed : effort.fixed
        effort = { mode, fixed }
        await writeEffort(effortFile, effort)
        sendJson(res, 200, { ok: true, value: effort })
        return
      }
      sendJson(res, 405, { ok: false, error: { code: 'method_not_allowed', message: req.method } })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      sendJson(res, message === 'payload_too_large' ? 413 : 500, { ok: false, error: { code: 'effort_failed', message } })
    }
  }

  ctx.inject(['webServer'], (webCtx) => {
    const disposeEffort = webCtx.webServer.register({ kind: 'exact', path: ROUTE_EFFORT, handler: effortHandler })
    return () => { disposeEffort() }
  })

  ctx.inject(['webServer'], (webCtx) => {
    const dispose = webCtx.webServer.register({ kind: 'exact', path: ROUTE, handler })
    return () => { dispose() }
  })

  // ---- context guard routes (merged) ----------------------------------------
const stateHandler = async (req, res) => {
      try {
        if (req.method !== 'GET') { sendJson(res, 405, { ok: false, error: { code: 'method_not_allowed', message: req.method } }); return }
        const url = new URL(req.url || '/', 'http://localhost')
        const sessionId = url.searchParams.get('sessionId') || ''
        const sessions = ctx.get('sessions')
        if (!sessions || typeof sessions.get !== 'function') {
          sendJson(res, 503, { ok: false, error: { code: 'sessions_unavailable', message: 'session store not ready' } })
          return
        }
        const session = sessionId ? sessions.get(sessionId) : undefined
        if (!session) {
          sendJson(res, 404, { ok: false, error: { code: 'session_not_live', message: 'session is not live in this process' } })
          return
        }
        const analysis = analyze(session, ctx.get('tokenMeter'), ctx.get('sessionProjections'))
        sendJson(res, 200, { ok: true, value: { session: String(session.id), cwd: session.header && session.header.cwd ? session.header.cwd : null, ...analysis } })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        sendJson(res, 500, { ok: false, error: { code: 'state_failed', message } })
      }
    }
  
    const handoffHandler = async (req, res) => {
      try {
        if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: { code: 'method_not_allowed', message: req.method } }); return }
        const body = await readJsonBody(req)
        const sessionId = String((body && body.sessionId) || '')
        const sessions = ctx.get('sessions')
        if (!sessions || typeof sessions.get !== 'function') {
          sendJson(res, 503, { ok: false, error: { code: 'sessions_unavailable', message: 'session store not ready' } })
          return
        }
        const session = sessionId ? sessions.get(sessionId) : undefined
        if (!session) {
          sendJson(res, 404, { ok: false, error: { code: 'session_not_live', message: 'session is not live in this process' } })
          return
        }
        const analysis = analyze(session, ctx.get('tokenMeter'), ctx.get('sessionProjections'))
        const value = await buildHandoff(session, analysis)
        sendJson(res, 200, { ok: true, value })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        sendJson(res, 500, { ok: false, error: { code: 'handoff_failed', message } })
      }
    }
  
    ctx.inject(['webServer'], (webCtx) => {
      const disposeState = webCtx.webServer.register({ kind: 'exact', path: ROUTE_STATE, handler: stateHandler })
      const disposeHandoff = webCtx.webServer.register({ kind: 'exact', path: ROUTE_HANDOFF, handler: handoffHandler })
      return () => {
        disposeState()
        disposeHandoff()
      }
    })
}
