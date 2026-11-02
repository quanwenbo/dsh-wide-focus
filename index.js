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
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export const name = 'wide-focus'

const ROUTE = '/wide-focus/tasks'
const MAX_BODY = 2 * 1024 * 1024

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

  ctx.inject(['webServer'], (webCtx) => {
    const dispose = webCtx.webServer.register({ kind: 'exact', path: ROUTE, handler })
    return () => { dispose() }
  })
}
