/**
 * wide-focus — DSH Web client plugin (local-only task panel).
 *
 * 1. Wide reading mode (default ON): the transcript is capped through
 *    `--dsh-chat-content-width`, driven by `--dsh-chat-user-width`. We set that
 *    token to `calc(100% - 40px)` on <html> and on every element that writes it
 *    inline, so it resolves against the real column instead of a measured px.
 * 2. Floating task panel: a self-contained local todo board. No taskboard, no
 *    network — tasks live in `<DSH_HOME>/wide-focus/tasks.json` via the host
 *    half, and can be dragged, re-ordered and moved through todo → doing →
 *    review. Font size is adjustable 10–28px.
 */

window.__ModuleLoader__.load({
  id: 'dsh-wide-focus',
  factory(require) {
    const React = require('react')
    const { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } = React

    // ---- extension point: other plugins can pin a small tool into the panel head ----
    const pluginTools = new Map()
    let pluginToolsSnapshot = []
    const pluginToolListeners = new Set()
    function notifyPluginTools() {
      pluginToolsSnapshot = Array.from(pluginTools.entries())
      for (const listener of pluginToolListeners) listener()
    }
    function registerPluginTool(id, component) {
      const key = String(id)
      pluginTools.set(key, component)
      notifyPluginTools()
      return () => {
        if (pluginTools.get(key) === component) {
          pluginTools.delete(key)
          notifyPluginTools()
        }
      }
    }
    function usePluginTools() {
      return useSyncExternalStore(
        (listener) => { pluginToolListeners.add(listener); return () => pluginToolListeners.delete(listener) },
        () => pluginToolsSnapshot,
      )
    }
    const h = React.createElement

    const PLUGIN_ID = 'dsh-wide-focus'
    const WIDE_KEY = 'dsh.wide-focus.enabled'
    const PANEL_KEY = 'dsh.wide-focus.panelCollapsed'
    const POS_KEY = 'dsh.wide-focus.panelPos3'
    const SIZE_KEY = 'dsh.wide-focus.panelSize'
    const FONT_KEY = 'dsh.wide-focus.fontSize'
    const TAB_KEY = 'dsh.wide-focus.activeTab'
    const LOCAL_KEYWORD = '加入待办'
    const WIDE_ATTR = 'data-dsh-wide-focus'
    const RELOAD_PARAM = '__dsh_reload'
    const FONT_MIN = 10
    const FONT_MAX = 28
    const FONT_DEFAULT = 12

    const STATUSES = [
      { key: 'in_review', label: 'statusReview', css: '#fbbf24' },
      { key: 'in_progress', label: 'statusDoing', css: '#60a5fa' },
      { key: 'todo', label: 'statusTodo', css: '#9a9aa5' },
    ]

    // The four board tabs; the accepted tab is permanent now that columns are tabs.
    const TABS = [...STATUSES, { key: 'done', label: 'sectionDone', css: '#6b7280' }]

    function stripReloadParam() {
      try {
        const url = new URL(window.location.href)
        if (!url.searchParams.has(RELOAD_PARAM)) return
        url.searchParams.delete(RELOAD_PARAM)
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
      } catch { /* ignore */ }
    }

    function hardReload() {
      try {
        const url = new URL(window.location.href)
        url.searchParams.set(RELOAD_PARAM, String(Date.now()))
        window.location.replace(url.toString())
      } catch {
        try { window.location.reload() } catch { /* ignore */ }
      }
    }

    // ---------------------------------------------------------------- i18n --

    const TEXT = {
      zh: {
        taskToggle: '召唤面板',
        taskToggleTitle: '召唤面板：恢复默认位置与尺寸，并展开面板。',
        toggleOn: '宽屏',
        toggleOff: '标准',
        toggleOnTitle: '宽屏阅读已开启：内容占满可用宽度，仅留边距。点击恢复默认宽度。',
        toggleOffTitle: '当前为默认宽度。点击开启宽屏阅读。',
        themeToDark: '切换到深色主题',
        pageReload: '异常恢复',
        pageReloadTitle: '异常恢复：清空面板位置与尺寸，再重新加载客户端（会先确认）。',
        reloadConfirmTitle: '异常恢复？',
        reloadConfirmText: '会清空任务面板的位置与尺寸并重新加载客户端；正在进行的对话与未发送的输入会中断。确定继续吗？',
        cancel: '取消',
        reloadConfirmOk: '仍然恢复',
        panelTitle: '任务面板',
        reset: '复位',
        resetTitle: '回到默认位置（右上角）',
        dragbarDrag: '自由拖拽',
        dragbarCollapse: '点击折叠',
        editHint: '点击即可编辑，输入后自动保存',
        shortcutHint: '按 R 键显示或隐藏任务面板',
        zoomHint: '按住 Ctrl 滚动滚轮（或 Ctrl + ＋ / Ctrl + −）调整字号',
        editPlaceholder: '',
        dragbarHint: '拖动移动 · 点击折叠',
        expandTitle: '展开任务面板',
        empty1: '还没有待办。点下面的「＋ 添加待办」新建一条',
        empty2: '在聊天里选中文字，右键 →「加入待办」',
        emptyTab: '这个分类暂时没有任务。',
        addTodo: '添加待办',
        manualPlaceholder: '输入待办内容，回车添加',
        manualSave: '添加',
        resizeRight: '拖动改变面板尺寸',
        resizeLeft: '从左边拖动改变宽度',
        statusTodo: '暂时搁置',
        statusDoing: '进行中',
        statusReview: '待验收',
        sectionDone: '已验收',
        jumpBack: '↩ 回到原消息',
        jumpBackTitle: '切回那条消息所在的会话并滚动到它',
        jumpNoSession: '这条待办是手动添加的，没有绑定聊天记录，所以没有“原消息”可以回。想找它的出处，可以在聊天里搜标题里的关键词。',
        jumpNotFound: '这段对话里没找到这条原文——可能是消息已被清理，或它其实来自另一个会话。可以按 Ctrl+F 搜标题关键词。',
        deleteTask: '取消',
        deleteConfirm: '再点一次取消',
        deleteTitle: '从面板移除这条待办',
        profileOffline: '任务数据存在 profile 里，宿主路由未就绪；点这里重试，或重启一次桌面客户端。',
        statusTitle: '切换状态',
        accept: '已完成',
        acceptTitle: '验收通过：标记为已完成并从列表隐藏',
        acceptedBadge: '已验收',
        undoAccept: '撤销验收',
        undoAcceptTitle: '把这条放回「待验收」',
      },
      en: {
        taskToggle: 'Summon panel',
        taskToggleTitle: 'Summon the panel: reset its position and size, then expand it.',
        toggleOn: 'Wide',
        toggleOff: 'Standard',
        toggleOnTitle: 'Wide reading is on: content uses the full column width with side margins.',
        toggleOffTitle: 'Default width. Click for wide reading.',
        themeToDark: 'Switch to the dark theme',
        pageReload: 'Restore on error',
        pageReloadTitle: 'Restore on error: clear the panel position and size, then reload the client (asks first).',
        reloadConfirmTitle: 'Force-restore the panel?',
        reloadConfirmText: 'Clears the task panel position and size, then reloads the client. The current conversation and unsent input will be interrupted. Continue?',
        cancel: 'Cancel',
        reloadConfirmOk: 'Restore anyway',
        panelTitle: 'Tasks',
        reset: 'Reset',
        resetTitle: 'Back to the default spot (top right)',
        dragbarDrag: 'Drag freely',
        dragbarCollapse: 'Click to collapse',
        editHint: 'Click to edit; saves as you type',
        shortcutHint: 'Press R to show or hide the task panel',
        zoomHint: 'Hold Ctrl and scroll (or Ctrl + plus / Ctrl + minus) to change the font size',
        editPlaceholder: '',
        dragbarHint: 'Drag to move · click to collapse',
        expandTitle: 'Open the task panel',
        empty1: 'No todos yet. Use "＋ Add a todo" below to create one.',
        empty2: 'Select text in the chat, right-click → "Add a todo".',
        emptyTab: 'Nothing in this category yet.',
        addTodo: 'Add a todo',
        manualPlaceholder: 'Type a todo, press Enter',
        manualSave: 'Add',
        resizeRight: 'Drag to resize the panel',
        resizeLeft: 'Drag from the left edge to widen',
        statusTodo: 'Todo',
        statusDoing: 'Doing',
        statusReview: 'Review',
        sectionDone: 'Accepted',
        jumpBack: '↩ Back to message',
        jumpBackTitle: 'Switch to that session and scroll to the message',
        jumpNoSession: 'This todo was typed by hand, so it has no chat message behind it. Search the chat for a keyword from its title instead.',
        jumpNotFound: 'That text is not in this conversation - it may have been cleaned up, or it came from another session. Try Ctrl+F with a keyword from the title.',
        deleteTask: 'Remove',
        deleteConfirm: 'Click again',
        deleteTitle: 'Remove this todo from the panel',
        profileOffline: 'Todos live in the profile file, but the host route is offline. Click to retry, or restart the desktop client once.',
        statusTitle: 'Change status',
        accept: 'Done',
        acceptTitle: 'Accept: mark as done and hide it from the list',
        acceptedBadge: 'Accepted',
        undoAccept: 'Undo accept',
        undoAcceptTitle: 'Move it back to Review',
      },
    }

    function detectLanguage() {
      try {
        const tag = String(navigator.language || '').toLowerCase()
        if (tag.startsWith('zh')) return 'zh'
        if (tag.startsWith('en')) return 'en'
        return 'zh'
      } catch { return 'zh' }
    }

    let language = detectLanguage()
    const languageListeners = new Set()

    function setLanguage(next) {
      if (next === language) return
      language = next
      for (const listener of languageListeners) { try { listener() } catch { /* ignore */ } }
    }

    function useLanguage() {
      return useSyncExternalStore(
        (listener) => {
          languageListeners.add(listener)
          return () => { languageListeners.delete(listener) }
        },
        () => language,
        () => language,
      )
    }

    function t(lang, key) {
      const table = TEXT[lang] || TEXT.en
      return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : (TEXT.en[key] ?? key)
    }

    function attachLocale(ctx) {
      try {
        const service = ctx.get ? ctx.get('locale') : undefined
        if (!service || typeof service.getSnapshot !== 'function') return
        const sync = () => {
          try {
            const snapshot = service.getSnapshot()
            const active = snapshot && typeof snapshot.active === 'string' ? snapshot.active : ''
            setLanguage(active.toLowerCase().startsWith('zh') ? 'zh' : active ? 'en' : detectLanguage())
          } catch { /* ignore */ }
        }
        sync()
        if (typeof service.subscribe === 'function') service.subscribe(sync)
      } catch { /* ignore */ }
    }

    // ------------------------------------------------------------ storage --

    function readJSON(key, fallback) {
      try {
        const raw = localStorage.getItem(key)
        if (raw === null) return fallback
        const parsed = JSON.parse(raw)
        return parsed === null || typeof parsed !== 'object' ? fallback : parsed
      } catch { return fallback }
    }

    function writeJSON(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* ignore */ }
    }

    function readNumberFlag(key, fallback) {
      try {
        const raw = localStorage.getItem(key)
        if (raw === null) return fallback
        const parsed = Number(raw)
        return Number.isFinite(parsed) ? parsed : fallback
      } catch { return fallback }
    }

    function readFlag(key, fallback) {
      try {
        const raw = localStorage.getItem(key)
        return raw === null ? fallback : raw === '1'
      } catch { return fallback }
    }

    function writeFlag(key, value) {
      try { localStorage.setItem(key, value ? '1' : '0') } catch { /* ignore */ }
    }

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value))
    }

    // ----------------------------------------------------------- wide mode --

    const wideListeners = new Set()
    let wideEnabled = readFlag(WIDE_KEY, true)

    function publishWide() {
      for (const listener of wideListeners) { try { listener() } catch { /* ignore */ } }
    }

    function useWide() {
      return useSyncExternalStore(
        (listener) => {
          wideListeners.add(listener)
          return () => { wideListeners.delete(listener) }
        },
        () => wideEnabled,
        () => wideEnabled,
      )
    }

    const boundTargets = new Map()

    function findWidthTargets() {
      const targets = new Set([document.documentElement])
      try {
        for (const element of document.querySelectorAll('[style*="--dsh-conversation-column-width"]')) {
          targets.add(element)
        }
        const session = document.querySelector('[data-slot="conversation.session"]')
        if (session) targets.add(session)
      } catch { /* ignore */ }
      return Array.from(targets)
    }

    function rememberTarget(element) {
      if (boundTargets.has(element)) return
      boundTargets.set(element, {
        value: element.style.getPropertyValue('--dsh-chat-user-width'),
        priority: element.style.getPropertyPriority('--dsh-chat-user-width'),
      })
    }

    function syncWide() {
      if (!wideEnabled) return
      for (const element of findWidthTargets()) {
        rememberTarget(element)
        element.style.setProperty('--dsh-chat-user-width', 'calc(100% - 40px)', 'important')
      }
    }

    function restoreWidthTargets() {
      for (const [element, saved] of boundTargets.entries()) {
        if (saved.value) element.style.setProperty('--dsh-chat-user-width', saved.value, saved.priority)
        else element.style.removeProperty('--dsh-chat-user-width')
      }
      boundTargets.clear()
    }

    function setWide(next) {
      wideEnabled = next
      writeFlag(WIDE_KEY, next)
      try {
        if (next) document.documentElement.setAttribute(WIDE_ATTR, '')
        else document.documentElement.removeAttribute(WIDE_ATTR)
      } catch { /* ignore */ }
      if (next) syncWide()
      else restoreWidthTargets()
      publishWide()
    }

    // ------------------------------------------- profile task store (host) --
    // Single source of truth: <profile>/wide-focus/tasks.json, served by the host half.
    // No localStorage / IndexedDB task copies — the file is the data.

    let tasksCache = []
    let tasksStatus = 'idle'
    let tasksLoadPromise = null
    const localListeners = new Set()

    function publishLocal() {
      for (const listener of localListeners) { try { listener() } catch { /* ignore */ } }
    }

    function setTasksStatus(next) {
      if (tasksStatus === next) return
      tasksStatus = next
      publishLocal()
    }

    function loadTasks() {
      if (tasksLoadPromise) return tasksLoadPromise
      setTasksStatus('loading')
      tasksLoadPromise = fetch('/wide-focus/tasks', { cache: 'no-store' })
        .then((response) => {
          if (!response.ok) throw new Error('HTTP ' + response.status)
          return response.json()
        })
        .then((payload) => {
          const raw = payload && payload.ok && payload.value ? payload.value.tasks : null
          if (!Array.isArray(raw)) throw new Error('bad payload')
          tasksCache = raw.map(normalizeTask).filter(Boolean)
          setTasksStatus('ready')
        })
        .catch(() => { setTasksStatus('offline') })
        .finally(() => { tasksLoadPromise = null; publishLocal() })
      return tasksLoadPromise
    }

    let serverSaveTimer = 0
    let pendingSaveList = null

    function flushServerSave() {
      if (!pendingSaveList) return
      const list = pendingSaveList
      pendingSaveList = null
      clearTimeout(serverSaveTimer)
      try {
        const body = JSON.stringify({ tasks: list })
        if (navigator.sendBeacon) {
          navigator.sendBeacon('/wide-focus/tasks', new Blob([body], { type: 'application/json' }))
        } else {
          fetch('/wide-focus/tasks', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body,
            keepalive: true,
          })
        }
      } catch { /* ignore */ }
    }

    function queueServerSave(list) {
      pendingSaveList = list
      clearTimeout(serverSaveTimer)
      serverSaveTimer = setTimeout(() => {
        pendingSaveList = null
        try {
          fetch('/wide-focus/tasks', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ tasks: list }),
          })
            .then((response) => { setTasksStatus(response.ok ? 'ready' : 'offline') })
            .catch(() => { setTasksStatus('offline') })
        } catch { setTasksStatus('offline') }
      }, 400)
    }

    function normalizeTask(raw) {
      if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null
      const title = typeof raw.title === 'string' ? raw.title : typeof raw.note === 'string' ? raw.note : ''
      if (title.trim().length === 0) return null
      const status = STATUSES.some((item) => item.key === raw.status) ? raw.status : 'todo'
      const body = typeof raw.body === 'string' ? raw.body : ''
      return {
        id: raw.id,
        title,
        body,
        html: typeof raw.html === 'string' ? raw.html : '',
        status,
        order: Number.isFinite(raw.order) ? raw.order : 0,
        createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
        sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : null,
        anchor: typeof raw.anchor === 'string' ? raw.anchor : '',
      }
    }

    function readLocalTasks() {
      return tasksCache
    }

    function commitLocal(list) {
      tasksCache = list
      publishLocal()
      queueServerSave(list)
    }

    function subscribeLocal(listener) {
      localListeners.add(listener)
      return () => { localListeners.delete(listener) }
    }

    function useLocalTasks() {
      return useSyncExternalStore(subscribeLocal, readLocalTasks, readLocalTasks)
    }

    function useTasksStatus() {
      return useSyncExternalStore(subscribeLocal, () => tasksStatus, () => tasksStatus)
    }

    function splitTaskText(raw) {
      const text = String(raw || '')
        .replace(/\r\n?/g, '\n')
        .split(LOCAL_KEYWORD).join(' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
      if (text.length === 0) return null
      const lines = text.split('\n')
      const title = (lines[0] || '').trim().slice(0, 160)
      if (title.length === 0) return null
      return { title, body: lines.slice(1).join('\n').trim() }
    }

    /**
     * A panel drag is the only drag that carries a window position preview.
     * Task drags reuse the same ref for row ordering and have no `next`;
     * returning null keeps the render path on a value it can use.
     */
    /**
     * Numbers are derived from the visible order inside one tab: every change
     * (drag, status move, accept, new task) renumbers 1..n immediately.
     */
    function numberTasks(column) {
      const map = new Map()
      column.forEach((task, index) => { map.set(task.id, index + 1) })
      return map
    }

    function panelDragPreview(drag) {
      if (!drag || drag.mode !== 'panel' || !drag.moved) return null
      return drag.next || null
    }

    function moveTaskInList(list, targetStatus, draggedId, targetId, placeAfter) {
      const moved = list.find((task) => task.id === draggedId)
      if (!moved) return list
      const column = list
        .filter((task) => task.status === targetStatus && task.id !== draggedId)
        .sort((a, b) => a.order - b.order)
      let insertAt = column.findIndex((task) => task.id === targetId)
      if (insertAt < 0) insertAt = column.length
      if (placeAfter) insertAt += 1
      column.splice(insertAt, 0, moved)
      const positions = new Map(column.map((task, index) => [task.id, (index + 1) * 10]))
      return list.map((task) => {
        if (task.id === draggedId) {
          return { ...task, status: targetStatus, order: positions.get(task.id) ?? task.order }
        }
        return positions.has(task.id) ? { ...task, order: positions.get(task.id) } : task
      })
    }

    function stripKeyword(text) {
      return String(text).split(LOCAL_KEYWORD).join(' ').replace(/\s+/g, ' ').trim()
    }

    function addLocalTask(input) {
      const raw = input && typeof input.text === 'string' ? input.text : ''
      const parsed = splitTaskText(raw)
      if (!parsed) return null
      const { title, body } = parsed
      const html = input && typeof input.html === 'string' ? input.html.slice(0, 8000) : ''
      const anchor = input && typeof input.anchor === 'string' ? input.anchor.slice(0, 1200) : ''
      const list = readLocalTasks()
      const sessionId = input && typeof input.sessionId === 'string' ? input.sessionId : null
      const duplicate = list.find((task) => task.title === title && (task.body || '') === body && task.sessionId === sessionId && task.status !== 'done')
      if (duplicate) return duplicate
      const sameStatus = list.filter((task) => task.status === 'in_progress')
      const maxOrder = sameStatus.reduce((max, task) => Math.max(max, task.order), 0)
      const task = {
        id: `lt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        title,
        body,
        html,
        status: 'in_progress',
        order: maxOrder + 10,
        createdAt: Date.now(),
        sessionId,
        anchor,
      }
      commitLocal([...list, task])
      notifyTaskAdded(task.title)
      return task
    }

    function updateLocalTask(id, patch) {
      const list = readLocalTasks()
      let changed = false
      const next = list.map((task) => {
        if (task.id !== id) return task
        changed = true
        return { ...task, ...patch }
      })
      if (changed) commitLocal(next)
    }

    function removeLocalTask(id) {
      const list = readLocalTasks()
      const next = list.filter((task) => task.id !== id)
      if (next.length !== list.length) commitLocal(next)
    }

    function moveTaskTo(targetStatus, draggedId, targetId, placeAfter) {
      const next = moveTaskInList(readLocalTasks(), targetStatus, draggedId, targetId, placeAfter)
      commitLocal(next)
    }

    // --------------------------------------------------------- jump-back --

    let uiWorkspaceService = null

    function normalizeForMatch(value) {
      return String(value || '').replace(/\s+/g, ' ').trim()
    }

    function findMessageNode(sample) {
      const probe = normalizeForMatch(sample)
      if (probe.length < 2) return null
      const roots = []
      for (const selector of ['[data-slot="conversation.chat.flow"]', '[data-slot="conversation.session"]', 'main', 'body']) {
        let root = null
        try { root = document.querySelector(selector) } catch { root = null }
        if (root) roots.push(root)
      }
      for (const root of roots) {
        const candidates = []
        for (const child of root.children) candidates.push(child)
        const nested = root.querySelectorAll('[data-message-id], [data-chat-node], article, li, [class*="turn" i], [class*="message" i]')
        for (const node of nested) candidates.push(node)
        let best = null
        let bestLength = Infinity
        for (const node of candidates) {
          const text = normalizeForMatch(node.textContent || '')
          if (text.length >= bestLength) continue
          if (!text.includes(probe)) continue
          best = node
          bestLength = text.length
        }
        if (best) return best
      }
      return null
    }

    function scrollToAnchor(sample, fallback) {
      const candidates = [sample, fallback]
        .map((value) => String(value || '').trim())
        .filter((value) => value.length > 0)
      const probes = []
      for (const candidate of candidates) {
        probes.push(candidate)
        const firstLine = candidate.split('\n')[0].trim()
        if (firstLine && firstLine !== candidate) probes.push(firstLine)
        if (candidate.length > 60) probes.push(candidate.slice(0, 60))
      }
      let node = null
      for (const probe of probes) {
        node = findMessageNode(probe)
        if (node) break
      }
      if (!node) return false
      try { node.scrollIntoView({ block: 'center', behavior: 'smooth' }) } catch { /* ignore */ }
      try {
        node.classList.remove('wf-jump-flash')
        void node.offsetWidth
        node.classList.add('wf-jump-flash')
        window.setTimeout(() => node.classList.remove('wf-jump-flash'), 1900)
      } catch { /* ignore */ }
      return true
    }

    function scrollToAnchorWhenReady(sample, fallback, timeout) {
      const limit = Number.isFinite(timeout) ? timeout : 5000
      return new Promise((resolve) => {
        const started = Date.now()
        const tick = () => {
          if (scrollToAnchor(sample, fallback)) { resolve(true); return }
          if (Date.now() - started >= limit) { resolve(false); return }
          window.setTimeout(tick, 150)
        }
        window.setTimeout(tick, 120)
      })
    }

    function jumpToLocalTask(task, report) {
      const anchor = task.anchor || task.title
      const record = (ok, mode) => {
        jumpInfo = { ok: ok, mode: mode, anchor: String(anchor || '').slice(0, 80), sessionId: task.sessionId || null, at: Date.now() }
        if (typeof report === 'function') report(ok)
      }
      if (!task.sessionId) { record(false, 'no-session'); return }
      if (scrollToAnchor(anchor, task.body)) { record(true, 'inline'); return }
      if (task.sessionId === activeSessionId) {
        scrollToAnchorWhenReady(anchor, task.body).then((ok) => record(ok, 'retry-same'))
        return
      }
      if (uiWorkspaceService && typeof uiWorkspaceService.openSession === 'function') {
        try { uiWorkspaceService.openSession(task.sessionId) } catch { /* ignore */ }
        scrollToAnchorWhenReady(anchor, task.body, 8000).then((ok) => record(ok, 'switch'))
        return
      }
      record(false, 'no-workspace-service')
    }
    let jumpInfo = null

    // ------------------------------------------------- panel geometry --

    function readSize() {
      const raw = readJSON(SIZE_KEY, null)
      const fallback = { width: 324, height: 300 }
      if (!raw || !Number.isFinite(raw.width) || !Number.isFinite(raw.height)) return fallback
      const maxWidth = Math.max(260, window.innerWidth * 0.9)
      const maxHeight = Math.max(220, window.innerHeight * 0.85)
      return {
        width: clamp(raw.width, 260, maxWidth),
        height: clamp(raw.height, 220, maxHeight),
      }
    }

    function readPosition() {
      const raw = readJSON(POS_KEY, null)
      if (!raw || !Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return null
      return { x: raw.x, y: raw.y }
    }

    function writePosition(value) {
      writeJSON(POS_KEY, value)
    }

    function clampPosition(x, y, element) {
      const width = element && element.offsetWidth ? element.offsetWidth : 324
      const height = element && element.offsetHeight ? element.offsetHeight : 220
      const margin = 8
      const maxX = Math.max(margin, window.innerWidth - Math.min(width, window.innerWidth - margin * 2) - margin)
      const maxY = Math.max(margin, window.innerHeight - Math.min(height, window.innerHeight - margin * 2) - margin)
      return { x: clamp(x, margin, maxX), y: clamp(y, margin, maxY) }
    }

    function clearInjectedStyles(element) {
      if (!element) return
      element.style.removeProperty('left')
      element.style.removeProperty('top')
      element.style.removeProperty('right')
      element.style.removeProperty('transform')
      element.style.removeProperty('will-change')
    }

    function readFontSize() {
      return clamp(readNumberFlag(FONT_KEY, FONT_DEFAULT), FONT_MIN, FONT_MAX)
    }

    // --------------------------------------------------- reset requests --

    const taskAddedListeners = new Set()

    function notifyTaskAdded(title) {
      for (const listener of taskAddedListeners) { try { listener(title) } catch { /* ignore */ } }
    }

    const panelResetListeners = new Set()

    const panelToggleListeners = new Set()

    const fontListeners = new Set()

    function requestFontAdjust(delta) {
      for (const listener of fontListeners) {
        try { listener(delta) } catch { /* ignore */ }
      }
    }

    function requestPanelToggle() {
      for (const listener of panelToggleListeners) { try { listener() } catch { /* ignore */ } }
    }

    function requestPanelReset(options) {
      const keepSize = !options || options.keepSize !== false
      try {
        localStorage.removeItem(POS_KEY)
        if (!keepSize) localStorage.removeItem(SIZE_KEY)
        localStorage.setItem(PANEL_KEY, '0')
      } catch { /* ignore */ }
      for (const listener of panelResetListeners) { try { listener() } catch { /* ignore */ } }
    }

    // ------------------------------------------------------- reload modal --

    let reloadDialogOpen = false
    const reloadDialogListeners = new Set()

    function setReloadDialog(open) {
      reloadDialogOpen = open
      for (const listener of reloadDialogListeners) { try { listener() } catch { /* ignore */ } }
    }

    function useReloadDialog() {
      return useSyncExternalStore(
        (listener) => {
          reloadDialogListeners.add(listener)
          return () => { reloadDialogListeners.delete(listener) }
        },
        () => reloadDialogOpen,
        () => reloadDialogOpen,
      )
    }

    function ReloadDialog() {
      const lang = useLanguage()
      const open = useReloadDialog()
      useEffect(() => {
        if (!open) return undefined
        const onKey = (event) => { if (event.key === 'Escape') setReloadDialog(false) }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [open])
      if (!open) return null
      return h('div', {
        className: 'wf-modal-mask',
        onPointerDown: (event) => { if (event.target === event.currentTarget) setReloadDialog(false) },
      },
        h('div', { className: 'wf-modal', role: 'dialog', 'aria-modal': 'true' },
          h('div', { className: 'wf-modal-title' }, t(lang, 'reloadConfirmTitle')),
          h('p', { className: 'wf-modal-text' }, t(lang, 'reloadConfirmText')),
          h('div', { className: 'wf-modal-actions' },
            h('button', { type: 'button', className: 'wf-modal-btn', onClick: () => setReloadDialog(false) }, t(lang, 'cancel')),
            h('button', { type: 'button', className: 'wf-modal-btn wf-modal-primary', onClick: () => { setReloadDialog(false); requestPanelReset({ keepSize: false }); hardReload() } }, t(lang, 'reloadConfirmOk')))))
    }

    // --------------------------------------------------------- header tools --

        // ------------------------------------------------------- panel theme --

    const PANEL_THEME_KEY = 'dsh.wide-focus.panelTheme'
    const panelThemeListeners = new Set()

    function readPanelTheme() {
      try {
        return localStorage.getItem(PANEL_THEME_KEY) === 'light' ? 'light' : 'dark'
      } catch {
        return 'dark'
      }
    }

    let panelTheme = readPanelTheme()

    function setPanelTheme(next) {
      panelTheme = next === 'light' ? 'light' : 'dark'
      try { localStorage.setItem(PANEL_THEME_KEY, panelTheme) } catch { /* ignore */ }
      for (const listener of panelThemeListeners) { try { listener() } catch { /* ignore */ } }
    }

    function usePanelTheme() {
      return useSyncExternalStore(
        (listener) => { panelThemeListeners.add(listener); return () => panelThemeListeners.delete(listener) },
        () => panelTheme,
        () => panelTheme,
      )
    }

    // Classic taiji: light field, dark S-shaped half, two opposite seeds.
    const TAIJI_SWIRL = 'M50 2a48 48 0 0 1 0 96 24 24 0 0 0 0-48 24 24 0 0 1 0-48z'

    function PanelThemeButton() {
      const lang = useLanguage()
      const theme = usePanelTheme()
      const toLight = theme === 'dark'
      const title = t(lang, toLight ? 'themeToLight' : 'themeToDark')
      return h('button', {
        type: 'button',
        className: theme === 'light' ? 'wf-theme-taiji wf-taiji-light' : 'wf-theme-taiji',
        title,
        'aria-label': title,
        'aria-pressed': theme === 'light' ? 'true' : 'false',
        onClick: () => setPanelTheme(toLight ? 'light' : 'dark'),
      },
        h('svg', { className: 'wf-taiji', viewBox: '0 0 100 100', 'aria-hidden': 'true', focusable: 'false' },
          h('circle', { className: 'wf-taiji-field', cx: 50, cy: 50, r: 48 }),
          h('path', { className: 'wf-taiji-swirl', d: TAIJI_SWIRL }),
          h('circle', { className: 'wf-taiji-dot wf-taiji-dot-a', cx: 50, cy: 26, r: 11.5 }),
          h('circle', { className: 'wf-taiji-dot wf-taiji-dot-b', cx: 50, cy: 74, r: 11.5 })))
    }

    function WideToggle(props) {
      const lang = useLanguage()
      const on = useWide()
      const trackedId = props && typeof props.sessionId === 'string' ? props.sessionId : null
      useEffect(() => { if (trackedId) setActiveSessionId(trackedId) }, [trackedId])
      const title = t(lang, on ? 'toggleOnTitle' : 'toggleOffTitle')
      return h(React.Fragment, null,
        h('button', {
          type: 'button',
          className: 'wf-toggle wf-task-open',
          title: t(lang, 'taskToggleTitle'),
          'aria-label': t(lang, 'taskToggleTitle'),
          onClick: () => requestPanelReset(),
        },
          h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
            h('rect', { x: 2.5, y: 2.5, width: 11, height: 11, rx: 2, stroke: 'currentColor', 'stroke-width': 1.2 }),
            h('path', { d: 'M5 6h6M5 8.5h6M5 11h3.4', stroke: 'currentColor', 'stroke-width': 1.2, 'stroke-linecap': 'round' })),
          h('span', null, t(lang, 'taskToggle'))),
        h('button', {
          type: 'button',
          className: on ? 'wf-toggle wf-toggle-on' : 'wf-toggle',
          title,
          'aria-pressed': on ? 'true' : 'false',
          onClick: () => setWide(!wideEnabled),
        },
          h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
            h('path', { d: 'M1.6 3v10M14.4 3v10', stroke: 'currentColor', 'stroke-width': 1.3, 'stroke-linecap': 'round' }),
            h('path', { d: 'M5 8h6', stroke: 'currentColor', 'stroke-width': 1.3, 'stroke-linecap': 'round' })),
          h('span', null, t(lang, on ? 'toggleOn' : 'toggleOff'))),
        h('button', {
          type: 'button',
          className: 'wf-toggle wf-page-reload',
          title: t(lang, 'pageReloadTitle'),
          onClick: () => setReloadDialog(true),
        },
          h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
            h('path', { d: 'M13.2 8a5.2 5.2 0 1 1-1.6-3.7', stroke: 'currentColor', 'stroke-width': 1.3, 'stroke-linecap': 'round' }),
            h('path', { d: 'M13.4 2.6v3.2h-3.2', stroke: 'currentColor', 'stroke-width': 1.3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })),
          h('span', null, t(lang, 'pageReload'))))
    }

    // ------------------------------------------------------ add-todo dock --

    let activeSessionId = null
    const sessionWatchers = new Set()
    function setActiveSessionId(id) {
      const next = id ? String(id) : null
      if (next === activeSessionId) return
      activeSessionId = next
      for (const watcher of sessionWatchers) { try { watcher(next) } catch { /* ignore */ } }
    }
    function watchActiveSession(watcher) {
      sessionWatchers.add(watcher)
      try { watcher(activeSessionId) } catch { /* ignore */ }
      return () => { sessionWatchers.delete(watcher) }
    }

    const KEEP_TAGS = new Set(['P', 'STRONG', 'B', 'EM', 'I', 'CODE', 'PRE', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'A', 'BR', 'DIV'])

    function escapeText(value) {
      return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }

    function serializeNode(node, out) {
      if (node.nodeType === 3) { out.push(escapeText(node.nodeValue || '')); return }
      if (node.nodeType !== 1) return
      const tag = String(node.tagName || '').toUpperCase()
      if (tag === 'BR') { out.push('<br>'); return }
      if (tag === 'SCRIPT' || tag === 'STYLE') return
      const keep = KEEP_TAGS.has(tag)
      const name = tag === 'DIV' ? 'P' : tag.toLowerCase()
      if (keep && tag !== 'DIV') out.push('<' + name + '>')
      else if (tag === 'DIV') out.push('<p>')
      for (const child of Array.from(node.childNodes || [])) serializeNode(child, out)
      if (tag === 'DIV') out.push('</p>')
      else if (keep) out.push('</' + name + '>')
    }

    function readSelectionHtml() {
      try {
        const selection = window.getSelection ? window.getSelection() : null
        if (!selection || selection.rangeCount === 0) return ''
        const out = []
        const range = selection.getRangeAt(0)
        const fragment = range.cloneContents()
        for (const child of Array.from(fragment.childNodes || [])) serializeNode(child, out)
        const html = out.join('').replace(/<p>\s*<\/p>/g, '').trim()
        return html.length > 8000 ? html.slice(0, 8000) : html
      } catch { return '' }
    }

    function readSelectedText() {
      const selection = window.getSelection ? window.getSelection() : null
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return ''
      const text = String(selection.toString() || '').replace(/\r\n?/g, '\n').trim()
      if (text.length < 2) return ''
      const range = selection.getRangeAt(0)
      const anchor = range.startContainer
      const element = anchor && anchor.nodeType === 3 ? anchor.parentElement : anchor
      if (!element || !element.closest) return ''
      if (!element.closest('[data-slot="conversation.chat.flow"], [data-slot="conversation.session"]')) return ''
      return text.slice(0, 1200)
    }

    const ComponentBase = typeof React.Component === 'function'
      ? React.Component
      : class { constructor(props) { this.props = props; this.state = {} } }

    class PanelBoundary extends ComponentBase {
      constructor(props) {
        super(props)
        this.state = { error: null, retry: 0, timer: 0 }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      componentDidCatch(error) {
        try { console.error('[wide-focus] task panel crashed', error) } catch { /* ignore */ }
        try { localStorage.setItem('dsh.wide-focus.lastError', String((error && error.stack) || error)) } catch { /* ignore */ }
        try {
          window.__wideFocus = { ...(window.__wideFocus || {}), lastError: String((error && error.stack) || error) }
        } catch { /* ignore */ }
        if (this.state.retry < 2) {
          try { window.clearTimeout(this.state.timer) } catch { /* ignore */ }
          const timer = window.setTimeout(() => {
            this.setState((previous) => ({ error: null, retry: previous.retry + 1, timer: 0 }))
          }, 900)
          this.state.timer = timer
        }
      }

      componentWillUnmount() {
        try { window.clearTimeout(this.state.timer) } catch { /* ignore */ }
      }

      render() {
        if (this.state.error === null) return this.props.children
        const message = String((this.state.error && this.state.error.message) || this.state.error)
        return h('div', { className: 'wf-panel wf-panel-crash', role: 'alert' },
          h('div', { className: 'wf-panel-head' },
            h('span', { className: 'wf-panel-title' }, '任务面板'),
            h('button', {
              className: 'wf-icon-btn',
              type: 'button',
              title: '重试',
              onClick: () => {
                try {
                  localStorage.removeItem(POS_KEY)
                  localStorage.removeItem(SIZE_KEY)
                  localStorage.removeItem('dsh.wide-focus.lastError')
                } catch { /* ignore */ }
                this.setState({ error: null, retry: 0 })
              },
            }, '⟲')),
          h('div', { className: 'wf-panel-body' },
            h('p', { className: 'wf-block-text' }, this.state.retry < 2 ? '任务面板渲染出错，正在自动重试…' : '任务面板渲染出错，点 ⟲ 重试。'),
            h('p', { className: 'wf-block-text wf-block-muted wf-crash-detail', title: message }, message.slice(0, 240))))
      }
    }

    function SelectionMenu() {
      const lang = useLanguage()
      const [menu, setMenu] = useState(null)
      const [flash, setFlash] = useState(false)
      const menuRef = useRef(null)
      const flashTimer = useRef(null)

      useEffect(() => {
        const onContextMenu = (event) => {
          const text = readSelectedText()
          if (text.length === 0) { setMenu(null); return }
          event.preventDefault()
          setMenu({ x: event.clientX, y: event.clientY, text, html: readSelectionHtml() })
        }
        const onPointerDown = (event) => {
          if (menuRef.current && menuRef.current.contains(event.target)) return
          setMenu(null)
        }
        const onKey = (event) => { if (event.key === 'Escape') setMenu(null) }
        document.addEventListener('contextmenu', onContextMenu, true)
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKey, true)
        return () => {
          document.removeEventListener('contextmenu', onContextMenu, true)
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKey, true)
        }
      }, [])

      useEffect(() => () => { window.clearTimeout(flashTimer.current) }, [])

      if (menu === null) return null
      const left = Math.max(8, Math.min(menu.x, window.innerWidth - 220))
      const top = Math.max(8, Math.min(menu.y, window.innerHeight - 64))

      const take = () => {
        const created = addLocalTask({ text: menu.text, html: menu.html, sessionId: activeSessionId || undefined, anchor: menu.text })
        if (!created) { setMenu(null); return }
        setFlash(true)
        window.clearTimeout(flashTimer.current)
        flashTimer.current = window.setTimeout(() => { setFlash(false); setMenu(null) }, 700)
      }

      return h('div', {
        ref: menuRef,
        className: 'wf-menu',
        style: { left: `${left}px`, top: `${top}px` },
        role: 'menu',
      },
        h('button', {
          type: 'button',
          className: flash ? 'wf-menu-item wf-menu-done' : 'wf-menu-item',
          onClick: take,
        }, flash ? t(lang, 'added') : t(lang, 'addTask')),
        h('span', { className: 'wf-menu-preview' }, menu.text.slice(0, 42)))
    }

    // ---------------------------------------------------------- task panel --

    function readOrderedColumn(list, status) {
      return list.filter((task) => task.status === status).sort((a, b) => a.order - b.order)
    }

    function TaskToast() {
      const lang = useLanguage()
      const [message, setMessage] = useState(null)
      const timer = useRef(null)

      useEffect(() => {
        const listener = (title) => {
          window.clearTimeout(timer.current)
          setMessage(title ? t(lang, 'added') + '：' + title : t(lang, 'added'))
          timer.current = window.setTimeout(() => setMessage(null), 1800)
        }
        taskAddedListeners.add(listener)
        return () => { taskAddedListeners.delete(listener); window.clearTimeout(timer.current) }
      }, [lang])

      if (message === null) return null
      return h('div', { className: 'wf-toast', role: 'status' }, message)
    }

    function EditableBody(props) {
      const task = props.task
      const lang = props.lang
      const save = props.save
      const [editing, setEditing] = useState(false)
      const [value, setValue] = useState(task.body || '')
      const timer = useRef(null)
      const elementRef = useRef(null)
      const initialRef = useRef(task.body || '')

      const flush = () => {
        window.clearTimeout(timer.current)
        const element = elementRef.current
        if (!element) return
        const text = element.value
        if (text === initialRef.current) return
        initialRef.current = text
        save(task.id, text)
      }

      const resize = () => {
        const element = elementRef.current
        if (!element) return
        element.style.height = 'auto'
        element.style.height = Math.min(element.scrollHeight, 360) + 'px'
      }

      useEffect(() => { if (editing) resize() }, [editing, value])

      useEffect(() => () => {
        window.clearTimeout(timer.current)
        const element = elementRef.current
        if (!element) return
        if (element.value !== initialRef.current) save(task.id, element.value)
      }, [])

      const begin = () => {
        if (editing) return
        setEditing(true)
        window.setTimeout(() => {
          const element = elementRef.current
          if (!element) return
          element.focus()
          const end = element.value.length
          try { element.setSelectionRange(end, end) } catch { }
          resize()
        }, 0)
      }

      const finish = () => {
        flush()
        setEditing(false)
      }

      if (!editing) {
        const text = value.trim()
        return h('div', {
          className: text ? 'wf-task-view' : 'wf-task-view wf-task-view-empty',
          role: 'button',
          tabIndex: 0,
          title: t(lang, 'editHint'),
          'aria-label': t(lang, 'editHint'),
          onClick: begin,
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              begin()
            }
          },
        }, text)
      }

      return h('textarea', {
        ref: elementRef,
        className: 'wf-task-editor',
        value,
        rows: 2,
        spellCheck: false,
        title: t(lang, 'editHint'),
        'aria-label': t(lang, 'editHint'),
        placeholder: t(lang, 'editPlaceholder'),
        onChange: (event) => {
          setValue(event.target.value)
          window.clearTimeout(timer.current)
          timer.current = window.setTimeout(flush, 600)
        },
        onBlur: finish,
      })
    }

    function DraftBox(props) {
      const lang = props.lang
      const value = props.value
      const elementRef = useRef(null)

      const resize = () => {
        const element = elementRef.current
        if (!element) return
        element.style.height = 'auto'
        element.style.height = Math.min(element.scrollHeight, 180) + 'px'
      }

      useEffect(() => { resize() }, [value])

      return h('textarea', {
        ref: elementRef,
        className: 'wf-input',
        rows: 2,
        maxLength: 300,
        autoFocus: true,
        value,
        placeholder: t(lang, 'manualPlaceholder'),
        onChange: (event) => { props.onChange(event.target.value); resize() },
        onKeyDown: (event) => {
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); props.onSubmit() }
          else if (event.key === 'Escape') props.onCancel()
        },
      })
    }

    function TaskPanel() {
      const lang = useLanguage()
      const theme = usePanelTheme()
      const pluginToolItems = usePluginTools()
      const tasks = useLocalTasks()
      const tasksStatus = useTasksStatus()
      const [collapsed, setCollapsed] = useState(() => readFlag(PANEL_KEY, false))
      const [position, setPosition] = useState(readPosition)
      const [size, setSize] = useState(readSize)
      const [fontSize, setFontSize] = useState(readFontSize)
      const [activeTab, setActiveTab] = useState(() => {
        const saved = readFlag(TAB_KEY, 'in_progress')
        return TABS.some((tab) => tab.key === saved) ? saved : 'in_progress'
      })

      const switchTab = (key) => {
        setActiveTab(key)
        writeFlag(TAB_KEY, key)
      }
      const [openId, setOpenId] = useState(null)
      const [draggingId, setDraggingId] = useState(null)
      const [hoverId, setHoverId] = useState(null)
      const [dropTab, setDropTab] = useState(null)
      const activeTabRef = useRef(activeTab)
      const [confirmId, setConfirmId] = useState(null)
      const [draft, setDraft] = useState(null)
      const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
      const [pillWidth, setPillWidth] = useState(140)
      const [jumpNote, setJumpNote] = useState(null)

      const reportJump = (task, ok) => {
        if (ok) { setJumpNote(null); return }
        setJumpNote(t(lang, task.sessionId ? 'jumpNotFound' : 'jumpNoSession'))
      }

      useEffect(() => {
        if (!jumpNote) return undefined
        const timer = window.setTimeout(() => setJumpNote(null), 7000)
        return () => window.clearTimeout(timer)
      }, [jumpNote])

      useEffect(() => {
        const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
      }, [])

      useLayoutEffect(() => {
        if (!collapsed) return
        const element = pillRef.current
        if (!element) return
        const width = element.offsetWidth
        if (width && Math.abs(width - pillWidth) > 1) setPillWidth(width)
      }, [collapsed, pillWidth, size.width])

      const panelRef = useRef(null)
      const pillRef = useRef(null)
      const dragRef = useRef(null)
      const panelTapRef = useRef({ at: 0, moved: false })
      const resizeRef = useRef(null)
      const longPressRef = useRef(null)
      const dragEndAtRef = useRef(0)
      const confirmTimer = useRef(null)
      const bodyRef = useRef(null)

      activeTabRef.current = activeTab

      const columns = TABS.map((tab) => ({ ...tab, tasks: readOrderedColumn(tasks, tab.key) }))
      const total = tasks.length

      const numberMap = new Map()
      for (const column of columns) {
        for (const [id, number] of numberTasks(column.tasks)) numberMap.set(id, number)
      }

      useEffect(() => {
        const listener = () => {
          setCollapsed(false)
          setPosition(null)
          setSize(readSize())
          clearInjectedStyles(panelRef.current)
          clearInjectedStyles(pillRef.current)
        }
        panelResetListeners.add(listener)
        return () => panelResetListeners.delete(listener)
      }, [])

      useEffect(() => {
        if (tasksStatus === 'offline') loadTasks()
      }, [])

      useEffect(() => {
        const listener = () => setCollapsed((current) => !current)
        panelToggleListeners.add(listener)
        return () => panelToggleListeners.delete(listener)
      }, [])

      useEffect(() => {
        const listener = () => {
          setCollapsed(false)
          setActiveTab('in_progress')
          const scroll = () => {
            const element = bodyRef.current
            if (element) element.scrollTop = element.scrollHeight
          }
          window.requestAnimationFrame(scroll)
          window.setTimeout(scroll, 120)
        }
        taskAddedListeners.add(listener)
        return () => taskAddedListeners.delete(listener)
      }, [])

      // A saved position may predate a window resize / display switch. If the
      // element is not reachable after mount, put it back where it works.
      useEffect(() => {
        const timer = window.setTimeout(() => {
          const element = panelRef.current || pillRef.current
          if (!element) return
          const rect = element.getBoundingClientRect()
          const unreachable = rect.width < 40
            || rect.height < 16
            || rect.right < 8
            || rect.bottom < 8
            || rect.left > window.innerWidth - 8
            || rect.top > window.innerHeight - 8
          if (!unreachable) return
          setCollapsed(false)
          setPosition(null)
          setSize(readSize())
          clearInjectedStyles(panelRef.current)
          clearInjectedStyles(pillRef.current)
        }, 700)
        return () => window.clearTimeout(timer)
      }, [])

      useEffect(() => {
        const element = panelRef.current || pillRef.current
        if (!element || position === null) return
        const next = clampPosition(position.x, position.y, element)
        if (next.x !== position.x || next.y !== position.y) setPosition(next)
      }, [size.width, size.height, position])

      useEffect(() => {
        const onResize = () => {
          const element = panelRef.current || pillRef.current
          if (!element || position === null) return
          setPosition(clampPosition(position.x, position.y, element))
        }
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
      }, [position])

      const toggleCollapsed = () => {
        const next = !collapsed
        setCollapsed(next)
        writeFlag(PANEL_KEY, next)
      }

      const beginDrag = (event, capture, measure) => {
        if (event.button !== 0) return
        const hitButton = event.target && event.target.closest ? event.target.closest('button') : null
        if (hitButton && hitButton !== capture) return
        const rect = measure.getBoundingClientRect()
        measure.style.left = `${rect.left}px`
        measure.style.top = `${rect.top}px`
        measure.style.right = 'auto'
        measure.style.transform = 'none'
        measure.style.willChange = 'left, top'
        dragRef.current = {
          mode: 'panel',
          originX: rect.left,
          originY: rect.top,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
          next: { x: rect.left, y: rect.top },
          pointerId: event.pointerId,
          capture,
        }
      }

      const panelDragMove = (event) => {
        const drag = dragRef.current
        if (!drag || drag.mode !== 'panel') return
        const dx = event.clientX - drag.startX
        const dy = event.clientY - drag.startY
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return
        drag.moved = true
        const next = clampPosition(drag.originX + dx, drag.originY + dy, drag.capture)
        drag.next = next
        drag.capture.style.left = `${next.x}px`
        drag.capture.style.top = `${next.y}px`
      }

      const panelDragEnd = () => {
        const drag = dragRef.current
        if (!drag || drag.mode !== 'panel') return false
        dragRef.current = null
        panelTapRef.current = { at: Date.now(), moved: drag.moved }
        const capture = drag.capture
        try { capture.releasePointerCapture(drag.pointerId) } catch { /* ignore */ }
        if (drag.moved) {
          const element = drag.capture
          const isPill = Boolean(element && element.classList && element.classList.contains('wf-pill'))
          const anchor = isPill
            ? { x: drag.next.x + pillWidth - size.width, y: drag.next.y }
            : drag.next
          setPosition(anchor)
          writePosition(anchor)
          dragEndAtRef.current = Date.now()
        } else if (position === null) {
          clearInjectedStyles(capture)
        }
        return drag.moved
      }

      const applyResize = (session) => {
        const element = panelRef.current
        if (!element) return
        element.style.width = `${session.next.width}px`
        element.style.height = `${session.next.height}px`
        if (session.next.left !== null) element.style.left = `${session.next.left}px`
        if (session.next.top !== null) element.style.top = `${session.next.top}px`
      }

      const settleResize = (pointerId) => {
        const session = resizeRef.current
        if (!session) return
        resizeRef.current = null
        if (session.frame) { window.cancelAnimationFrame(session.frame); session.frame = 0 }
        try { if (pointerId !== undefined) session.capture.releasePointerCapture(pointerId) } catch { /* ignore */ }
        panelRef.current && panelRef.current.classList.remove('wf-resizing')
        const { width, height, left, top } = session.next
        setSize({ width, height })
        writeJSON(SIZE_KEY, { width, height })
        if (session.side === 'left' && left !== null && top !== null) {
          const nextPosition = { x: left, y: top }
          setPosition(nextPosition)
          writePosition(nextPosition)
        }
      }

      const beginResize = (event, side) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        settleResize(undefined)
        const element = panelRef.current
        if (!element) return
        const rect = element.getBoundingClientRect()
        if (side === 'left') {
          element.style.left = `${rect.left}px`
          element.style.top = `${rect.top}px`
          element.style.right = 'auto'
          element.style.transform = 'none'
        }
        element.classList.add('wf-resizing')
        resizeRef.current = {
          side,
          startX: event.clientX,
          startY: event.clientY,
          startRect: rect,
          capture: element,
          frame: 0,
          next: { width: rect.width, height: rect.height, left: side === 'left' ? rect.left : null, top: side === 'left' ? rect.top : null },
        }
        try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* ignore */ }
      }

      const moveResize = (event) => {
        const session = resizeRef.current
        if (!session) return
        const dx = event.clientX - session.startX
        const dy = event.clientY - session.startY
        const maxWidth = Math.max(260, window.innerWidth * 0.9)
        const maxHeight = Math.max(220, window.innerHeight * 0.85)
        const height = clamp(session.startRect.height + dy, 220, maxHeight)
        if (session.side === 'left') {
          const maxForLeft = Math.max(260, session.startRect.right - 8)
          const width = clamp(session.startRect.width - dx, 260, Math.min(maxWidth, maxForLeft))
          session.next = {
            width,
            height,
            left: session.startRect.right - width,
            top: session.startRect.top,
          }
        } else {
          const width = clamp(session.startRect.width + dx, 260, maxWidth)
          session.next = { width, height, left: null, top: null }
        }
        if (session.frame) return
        session.frame = window.requestAnimationFrame(() => {
          const active = resizeRef.current
          if (!active) return
          active.frame = 0
          if (resizeRef.current === active) applyResize(active)
        })
      }

      const resetPosition = useCallback(() => {
        setPosition(null)
        try { localStorage.removeItem(POS_KEY) } catch { /* ignore */ }
        clearInjectedStyles(panelRef.current)
        clearInjectedStyles(pillRef.current)
      }, [])

      useEffect(() => {
        const onMove = (event) => {
          if (resizeRef.current) { moveResize(event); return }
          const drag = dragRef.current
          if (!drag) return
          if (drag.mode === 'panel') { panelDragMove(event); return }
          const dx = Math.abs(event.clientX - drag.startX)
          const dy = Math.abs(event.clientY - drag.startY)
          if (!drag.moved && dx + dy < 4) return
          drag.moved = true
          let element = null
          let row = null
          let header = null
          let tabKey = null
          try {
            element = document.elementFromPoint(event.clientX, event.clientY)
            const tabEl = element && element.closest ? element.closest('[data-tab]') : null
            if (tabEl) tabKey = tabEl.getAttribute('data-tab')
            row = tabKey === null && element && element.closest ? element.closest('[data-task-id]') : null
            header = tabKey === null && !row && element && element.closest ? element.closest('[data-drop-status]') : null
          } catch { row = null; header = null; tabKey = null }
          if (tabKey !== null) {
            if (tabKey === activeTabRef.current) {
              if (drag.target !== null && drag.target.tab) { drag.target = null; setDropTab(null) }
              setHoverId(null)
              return
            }
            if (drag.target === null || drag.target.tab !== tabKey) {
              drag.target = { tab: tabKey }
              setDropTab(tabKey)
              setHoverId(null)
            }
            return
          }
          setDropTab(null)
          if (header !== null) {
            const target = { id: null, after: true, status: header.getAttribute('data-drop-status') }
            if (drag.target === null || drag.target.status !== target.status || drag.target.id !== null) {
              drag.target = target
              setHoverId(null)
            }
            return
          }
          if (!row || row.getAttribute('data-task-id') === drag.id) {
            if (drag.target !== null) { drag.target = null; setHoverId(null) }
            return
          }
          const rect = row.getBoundingClientRect()
          const after = event.clientY > rect.top + rect.height / 2
          const target = { id: row.getAttribute('data-task-id'), after, status: row.getAttribute('data-status') }
          if (drag.target === null || drag.target.id !== target.id || drag.target.after !== target.after) {
            drag.target = target
            setHoverId(target.id)
          }
        }
        const onUp = () => {
          if (resizeRef.current) settleResize()
          const drag = dragRef.current
          if (!drag) return
          if (drag.mode === 'panel') { panelDragEnd(); return }
          dragRef.current = null
          setDraggingId(null)
          setHoverId(null)
          setDropTab(null)
          if (!drag.moved) return
          if (drag.target !== null) {
            try {
              if (drag.target.tab) {
                moveTaskTo(drag.target.tab, drag.id, null, false)
                switchTab(drag.target.tab)
                setOpenId(drag.id)
              } else {
                moveTaskTo(activeTabRef.current, drag.id, drag.target.id, drag.target.after)
              }
            } catch (error) {
              try { console.error('[wide-focus] move failed', error) } catch { /* ignore */ }
            }
          }
          dragEndAtRef.current = Date.now()
        }
        const onCancel = () => {
          if (resizeRef.current) settleResize()
          const drag = dragRef.current
          if (!drag) return
          if (drag.mode === 'panel') { panelDragEnd(); return }
          dragRef.current = null
          setDraggingId(null)
          setHoverId(null)
          setDropTab(null)
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', onCancel)
        window.addEventListener('blur', onCancel)
        return () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          window.removeEventListener('pointercancel', onCancel)
          window.removeEventListener('blur', onCancel)
        }
      }, [])

      const armTaskDrag = (event, task) => {
        const startX = event.clientX
        const startY = event.clientY
        dragRef.current = { mode: 'task', id: task.id, status: task.status, startX, startY, moved: false, target: null }
        setDraggingId(task.id)
      }

      const beginTaskDrag = (event, task) => {
        if (event.button !== 0) return
        const startX = event.clientX
        const startY = event.clientY
        window.clearTimeout(longPressRef.current)
        longPressRef.current = window.setTimeout(() => {
          longPressRef.current = null
          dragRef.current = { mode: 'task', id: task.id, status: task.status, startX, startY, moved: false, target: null }
          setDraggingId(task.id)
        }, 260)
      }

      const cancelTaskPress = () => {
        window.clearTimeout(longPressRef.current)
        longPressRef.current = null
      }

      const wasJustDragged = () => Date.now() - dragEndAtRef.current < 300

      const toggleOpen = (task) => {
        setOpenId((current) => (current === task.id ? null : task.id))
      }

      const setStatus = (task, status) => {
        updateLocalTask(task.id, { status })
        setOpenId(task.id)
      }

      // Accepting hides the item without deleting it: it stays queryable behind
      // the eye toggle at the head of the Review column.
      const acceptTask = (task) => {
        updateLocalTask(task.id, { status: 'done' })
        if (openId === task.id) setOpenId(null)
      }

      const requestDelete = (task) => {
        if (confirmId === task.id) {
          window.clearTimeout(confirmTimer.current)
          removeLocalTask(task.id)
          setConfirmId(null)
          if (openId === task.id) setOpenId(null)
          return
        }
        setConfirmId(task.id)
        window.clearTimeout(confirmTimer.current)
        confirmTimer.current = window.setTimeout(() => setConfirmId(null), 3500)
      }

      const commitDraft = () => {
        const text = typeof draft === 'string' ? draft.trim() : ''
        if (text.length > 0) addLocalTask({ text })
        setDraft(null)
      }

      const changeFont = (delta) => {
        const next = clamp(fontSize + delta, FONT_MIN, FONT_MAX)
        setFontSize(next)
        try { localStorage.setItem(FONT_KEY, String(next)) } catch { /* ignore */ }
      }
      const changeFontRef = useRef(null)
      changeFontRef.current = changeFont

      useEffect(() => {
        const listener = (delta) => changeFontRef.current(delta)
        fontListeners.add(listener)
        return () => { fontListeners.delete(listener) }
      }, [])

      // Ctrl + wheel over the panel changes the font size; a plain wheel is left
      // alone so the list can scroll normally.
      useEffect(() => {
        const element = panelRef.current
        if (!element) return undefined
        const onWheel = (event) => {
          if (!event.ctrlKey && !event.metaKey) return
          event.preventDefault()
          changeFontRef.current(event.deltaY > 0 ? -1 : 1)
        }
        element.addEventListener('wheel', onWheel, { passive: false })
        return () => element.removeEventListener('wheel', onWheel)
      }, [collapsed])

      const taskRow = (task) => {
        const open = openId === task.id
        const number = numberMap.get(task.id) || 0
        const statusMeta = STATUSES.find((item) => item.key === task.status) || { key: 'done', label: 'acceptedBadge', css: '#6b7280' }
        return h('div', {
          key: task.id,
          className: [
            'wf-task',
            open ? 'wf-task-open-item' : '',
            task.status === 'done' ? 'wf-task-done' : '',
            draggingId === task.id ? 'wf-task-dragging' : '',
            hoverId === task.id && draggingId !== task.id ? 'wf-task-drop-target' : '',
          ].filter(Boolean).join(' '),
          'data-task-id': task.id,
          'data-status': task.status,
        },
          h('button', {
            type: 'button',
            className: draggingId === task.id ? 'wf-task-head wf-task-head-drag' : 'wf-task-head',
            onPointerDown: (event) => beginTaskDrag(event, task),
            onPointerUp: cancelTaskPress,
            onClick: () => { if (!wasJustDragged()) toggleOpen(task) },
          },
            h('span', {
              className: 'wf-drag-handle',
              title: t(lang, 'dragHint'),
              onClick: (event) => event.stopPropagation(),
              onPointerDown: (event) => {
                event.stopPropagation()
                if (event.button !== 0) return
                window.clearTimeout(longPressRef.current)
                longPressRef.current = null
                armTaskDrag(event, task)
              },
            }, '≡'),
            h('span', { className: 'wf-num', style: { color: statusMeta.css } }, String(number)),
            h('span', { className: 'wf-task-title', title: task.title }, task.title),
            task.sessionId ? h('span', { className: 'wf-anchor-badge', title: t(lang, 'jumpBackTitle') }, '↩') : null,
            h('span', { className: 'wf-task-status-dot', style: { background: statusMeta.css } })),
          open ? h('div', { className: 'wf-task-body' },
            h(EditableBody, {
              key: task.id,
              task,
              lang,
              save: (id, text) => updateLocalTask(id, { body: text, html: null }),
            }),
            h('div', { className: 'wf-task-actions' },
              h('div', { className: 'wf-status-row', title: t(lang, 'statusTitle') },
                STATUSES.map((status) => h('button', {
                  key: status.key,
                  type: 'button',
                  className: task.status === status.key ? 'wf-status-btn wf-status-on' : 'wf-status-btn',
                  style: task.status === status.key ? { borderColor: status.css, color: status.css } : undefined,
                  onClick: () => setStatus(task, status.key),
                }, t(lang, status.label)))),
              h('div', { className: 'wf-actions' },
              task.sessionId
                ? h('button', {
                  type: 'button',
                  className: 'wf-btn',
                  title: t(lang, 'jumpBackTitle'),
                  onClick: () => jumpToLocalTask(task, (ok) => reportJump(task, ok)),
                }, t(lang, 'jumpBack'))
                : null,
              task.status === 'in_review'
                ? h('button', {
                  type: 'button',
                  className: 'wf-btn wf-btn-primary',
                  title: t(lang, 'acceptTitle'),
                  onClick: () => acceptTask(task),
                }, t(lang, 'accept'))
                : null,
              task.status === 'done'
                ? h('button', {
                  type: 'button',
                  className: 'wf-btn',
                  title: t(lang, 'undoAcceptTitle'),
                  onClick: () => setStatus(task, 'in_review'),
                }, t(lang, 'undoAccept'))
                : null,
              h('button', {
                type: 'button',
                className: confirmId === task.id ? 'wf-btn wf-btn-danger wf-btn-confirm' : 'wf-btn wf-btn-danger',
                title: t(lang, 'deleteTitle'),
                onClick: () => requestDelete(task),
              }, confirmId === task.id ? t(lang, 'deleteConfirm') : t(lang, 'deleteTask'))))) : null)
      }

      const tabsNode = h('div', { className: 'wf-tabs', role: 'tablist', 'aria-label': t(lang, 'panelTitle') },
        columns.map((column) => h('button', {
          key: column.key,
          type: 'button',
          role: 'tab',
          'aria-selected': activeTab === column.key ? 'true' : 'false',
          'data-tab': column.key,
          className: [
            'wf-tab',
            activeTab === column.key ? 'wf-tab-on' : '',
            dropTab === column.key ? 'wf-tab-drop' : '',
            column.tasks.length === 0 ? 'wf-tab-empty' : '',
          ].filter(Boolean).join(' '),
          onClick: () => switchTab(column.key),
        },
          h('span', { className: 'wf-tab-dot', style: { background: column.css } }),
          h('span', { className: 'wf-tab-label' }, t(lang, column.label)),
          h('span', { className: 'wf-tab-count' }, String(column.tasks.length)))))

      const activeColumn = columns.find((column) => column.key === activeTab) || columns[0]

      const sizeStyle = { width: `${size.width}px`, height: `${size.height}px`, maxHeight: 'none', fontSize: `${fontSize}px` }
      const liveDrag = panelDragPreview(dragRef.current)
      const defaultAnchor = {
        x: Math.max(8, viewport.width - 100 - size.width),
        y: Math.min(100, Math.max(8, viewport.height - 120)),
      }
      const shownPosition = liveDrag !== null ? liveDrag : (position !== null ? position : defaultAnchor)
      const positionStyle = { left: `${shownPosition.x}px`, top: `${shownPosition.y}px`, right: 'auto', transform: 'none' }
      const pillLeft = liveDrag !== null ? liveDrag.x : shownPosition.x + size.width - pillWidth
      const pillStyle = { left: `${pillLeft}px`, top: `${shownPosition.y}px`, right: 'auto', transform: 'none' }

      const wheelIcon = h('svg', {
        className: 'wf-wheel',
        viewBox: '0 0 24 24',
        width: 20,
        height: 20,
        'aria-hidden': 'true',
        focusable: 'false',
      },
        h('rect', { x: 7, y: 3, width: 10, height: 18, rx: 5, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 }),
        h('line', { x1: 12, y1: 7, x2: 12, y2: 10, stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }))

      const panelTools = h('div', { className: 'wf-panel-tools' },
        h('span', { className: 'wf-kbd-group wf-group-r', title: t(lang, 'shortcutHint'), 'aria-label': t(lang, 'shortcutHint') },
          h('span', { className: 'wf-kbd' }, 'R')),
        h('span', { className: 'wf-kbd-group wf-group-wheel', title: t(lang, 'zoomHint'), 'aria-label': t(lang, 'zoomHint') },
          h('span', { className: 'wf-kbd wf-kbd-ctrl' }, 'Ctrl', wheelIcon)),
        h(PanelThemeButton, null),
        pluginToolItems.length > 0
          ? h('div', { className: 'wf-tools' }, pluginToolItems.map(([id, ToolComponent]) => h(ToolComponent, { key: id })))
          : null)

      const dragbar = h('div', {
        className: 'wf-dragbar',
        title: t(lang, 'dragbarHint'),
        onPointerDown: (event) => beginDrag(event, event.currentTarget.parentElement, event.currentTarget.parentElement),
        onPointerUp: () => {
          panelDragEnd()
          const tap = panelTapRef.current
          if (tap.at === 0 || Date.now() - tap.at > 600) return
          panelTapRef.current = { at: 0, moved: false }
          if (!tap.moved) toggleCollapsed()
        },
      },
        h('div', { className: 'wf-dragbar-left' }, panelTools),
        h('div', { className: 'wf-dragbar-right' },
          h('span', { className: 'wf-dragbar-labels' },
            h('span', { className: 'wf-dragbar-side' }, t(lang, 'dragbarCollapse')),
            h('span', { className: 'wf-dragbar-side' }, t(lang, 'dragbarDrag')))))

      if (collapsed) {
        return h('button', {
          ref: pillRef,
          type: 'button',
          className: theme === 'light' ? 'wf-pill wf-theme-light' : 'wf-pill',
          style: pillStyle,
          title: t(lang, 'expandTitle'),
          onPointerDown: (event) => {
            event.stopPropagation()
            beginDrag(event, event.currentTarget, event.currentTarget)
          },
          onPointerUp: () => {
            panelDragEnd()
            const tap = panelTapRef.current
            if (tap.at === 0 || Date.now() - tap.at > 600) return
            panelTapRef.current = { at: 0, moved: false }
            if (!tap.moved) toggleCollapsed()
          },
        },
          h('span', { className: 'wf-pill-label' }, t(lang, 'panelTitle')))
      }

      return h(React.Fragment, null,
        h('aside', {
          ref: panelRef,
          className: theme === 'light' ? 'wf-panel wf-theme-light' : 'wf-panel',
          style: positionStyle ? { ...positionStyle, ...sizeStyle } : sizeStyle,
          'data-width-focus': 'panel',
        },
          dragbar,
          jumpNote ? h('div', { className: 'wf-note', role: 'status' }, jumpNote) : null,
          tasksStatus === 'offline'
            ? h('div', {
              className: 'wf-note wf-note-warn wf-note-action',
              role: 'status',
              title: t(lang, 'profileOffline'),
              onClick: () => loadTasks(),
            }, t(lang, 'profileOffline'))
            : null,
          tabsNode,
          h('div', { className: 'wf-panel-body', ref: bodyRef },
            total === 0
              ? h('div', { className: 'wf-empty-list' },
                h('div', { className: 'wf-empty-line' }, t(lang, 'empty1')),
                h('div', { className: 'wf-empty-line' }, t(lang, 'empty2')))
              : h('div', { className: 'wf-tabpanel', role: 'tabpanel' },
                activeColumn.tasks.length === 0
                  ? h('div', { className: 'wf-empty-list' },
                    h('div', { className: 'wf-empty-line' }, t(lang, 'emptyTab')))
                  : activeColumn.tasks.map((task) => taskRow(task)))),
          h('div', { className: draft === null ? 'wf-panel-add' : 'wf-panel-add wf-add-editing' },
            draft === null
              ? h('button', {
                type: 'button',
                className: 'wf-add-todo',
                onClick: () => setDraft(''),
              }, '＋ ' + t(lang, 'addTodo'))
              : h(React.Fragment, null,
                h(DraftBox, {
                  lang,
                  value: draft,
                  onChange: setDraft,
                  onSubmit: commitDraft,
                  onCancel: () => setDraft(null),
                }),
                h('div', { className: 'wf-add-actions' },
                  h('button', { type: 'button', className: 'wf-btn wf-btn-primary', onClick: commitDraft }, t(lang, 'manualSave')),
                  h('button', { type: 'button', className: 'wf-btn', onClick: () => setDraft(null) }, t(lang, 'cancel'))))),
          h('div', { className: 'wf-resize', title: t(lang, 'resizeRight'), onPointerDown: (event) => beginResize(event, 'right') }),
        h('div', { className: 'wf-resize wf-resize-left', title: t(lang, 'resizeLeft'), onPointerDown: (event) => beginResize(event, 'left') })))
    }

    // ---------------------------------------------------------------- css --

    const STYLES = `
      .wf-toggle { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 9px;
        border-radius: 7px; border: 1px solid transparent; background: transparent; color: inherit;
        font: inherit; font-size: 12px; cursor: pointer; opacity: .82; white-space: nowrap; }
      .wf-toggle:hover { opacity: 1; background: color-mix(in srgb, currentColor 12%, transparent); }
      .wf-toggle-on { color: #ffffff; background: #2563eb; border-color: #2563eb; opacity: 1; font-weight: 600; }
      .wf-toggle-on:hover { background: #1d4ed8; }
      .wf-toggle.wf-page-reload { color: #ffffff; background: #dc2626; border-color: #dc2626;
        opacity: 1; font-weight: 600; }
      .wf-toggle.wf-page-reload:hover { background: #b91c1c; border-color: #b91c1c; }
      .wf-toggle.wf-task-open { color: #ffffff; background: #16a34a; border-color: #16a34a;
        opacity: 1; font-weight: 600; }
      .wf-toggle.wf-task-open:hover { background: #15803d; border-color: #15803d; }
      .wf-toggle:focus-visible { outline: 2px solid #60a5fa; outline-offset: 2px; }
      html[data-dsh-wide-focus] [data-width-handle] { display: none !important; }


      .wf-panel { position: fixed; z-index: 2147483000; right: 100px; top: 100px;
        display: flex; flex-direction: column; min-width: 260px; min-height: 220px; overflow: hidden;
        border-radius: 8px; border: 1px solid rgba(56,189,248,.85);
        background: #121216; color: #f4f4f5;
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,.09),
          0 2px 4px rgba(0,0,0,.5),
          0 16px 32px -12px rgba(0,0,0,.72),
          0 34px 64px -26px rgba(0,0,0,.6),
          0 0 0 1px rgba(56,189,248,.8),
          0 0 5px 1px rgba(56,189,248,.95),
          0 0 13px 1px rgba(56,189,248,.68); }
      .wf-dragbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; height: 78px;
        padding: 0 12px; cursor: grab; user-select: none; touch-action: none;
        border-bottom: 1px solid #2e2e36;
        background: #1c1c22; }
      .wf-dragbar:active { cursor: grabbing; }
      .wf-dragbar-left { display: flex; align-items: center; gap: 2ch; min-width: 0; overflow: hidden; }
      .wf-dragbar-right { display: flex; align-items: center; gap: 8px; flex: none; }
      .wf-vline { flex: none; width: 1px; height: 14px; background: currentColor; opacity: .22; }
      .wf-dragbar-labels { display: flex; flex-direction: column; align-items: flex-end;
        justify-content: center; gap: 1px; line-height: 1.2; }
      .wf-dragbar-side { font-size: .51em; opacity: .62; letter-spacing: .02em; white-space: nowrap; }
      .wf-kbd { display: inline-flex; align-items: center; justify-content: center;
        width: 36px; height: 36px; padding: 0; border-radius: 8px;
        font-size: 17px; font-weight: 700; line-height: 1; color: #f4f4f5;
        background: linear-gradient(180deg, #3b3b46 0%, #24242c 100%);
        border: 1px solid rgba(255,255,255,.16);
        box-shadow: inset 0 1px 0 rgba(255,255,255,.24), inset 0 -2px 0 rgba(0,0,0,.5),
          0 2px 0 rgba(0,0,0,.55), 0 3px 6px rgba(0,0,0,.35);
        text-shadow: 0 -1px 0 rgba(0,0,0,.6);
        pointer-events: none; user-select: none; }
      .wf-kbd-group { display: inline-flex; align-items: center; gap: 6px; }
      .wf-kbd-ctrl { width: auto; min-width: 52px; padding: 0 11px; font-size: 13px; letter-spacing: .04em;
        display: inline-flex; align-items: center; gap: 6px; }
      .wf-kbd-ctrl .wf-wheel { width: 16px; height: 16px; opacity: .9; }
      .wf-group-r .wf-kbd { background: linear-gradient(180deg, #2f4368 0%, #1b2740 100%);
        border-color: rgba(96,165,250,.6); color: #dbe9ff; }
      .wf-group-wheel .wf-kbd { background: linear-gradient(180deg, #1f3b38 0%, #142723 100%);
        border-color: rgba(52,211,153,.55); color: #d7f7ea; }
      .wf-group-wheel .wf-wheel { color: #f4f4f5; }
      .wf-theme-light .wf-group-wheel .wf-wheel { color: #0b0b0e; }
      .wf-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 10px 3px; }
      .wf-panel-title { font-size: .95em; font-weight: 600; letter-spacing: .02em; }
      .wf-panel-tools { display: flex; align-items: center; gap: 14px; }
      .wf-tools { display: flex; align-items: center; gap: 8px; }
      .wf-tools > * { height: 36px; }
      .wf-tools .cg-chip { height: 36px; border-radius: 8px; }
      .wf-panel-tools .wf-icon-btn { width: 45px; height: 45px; font-size: 25px; }
      .wf-theme-taiji { position: relative; width: 45px; height: 36px; padding: 0; flex: none;
        display: inline-flex; align-items: center; justify-content: center;
        border-radius: 8px; background: transparent; border: 0;
        cursor: pointer; transition: background .18s ease; }
      .wf-theme-taiji:hover { background: rgba(255,255,255,.07); }
      .wf-taiji { width: 26px; height: 26px; display: block; transition: transform .35s ease; }
      .wf-theme-taiji .wf-taiji-field { fill: #f4f4f5; }
      .wf-theme-taiji .wf-taiji-swirl { fill: #0b0b0e; }
      .wf-theme-taiji .wf-taiji-dot-a { fill: #f4f4f5; }
      .wf-theme-taiji .wf-taiji-dot-b { fill: #0b0b0e; }
      .wf-taiji-light .wf-taiji { transform: rotate(180deg); }
      .wf-taiji-light .wf-taiji-field { fill: #18181b; }
      .wf-taiji-light .wf-taiji-swirl { fill: #f4f4f5; }
      .wf-taiji-light .wf-taiji-dot-a { fill: #18181b; }
      .wf-taiji-light .wf-taiji-dot-b { fill: #f4f4f5; }
      .wf-theme-light .wf-theme-taiji:hover { background: rgba(15,20,30,.06); }
      @media (prefers-reduced-motion: reduce) { .wf-taiji { transition: none; } }
      .wf-dragbar .wf-icon-btn { width: 45px; height: 45px; font-size: 25px; }
      .wf-icon-btn { width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center;
        border: 0; border-radius: 6px; background: transparent; color: inherit; font: inherit; font-size: 15px;
        cursor: pointer; opacity: .72; }
      .wf-icon-btn:hover { opacity: 1; background: #222228; }
      .wf-font-btn { font-size: .95em; font-weight: 600; }
      .wf-note-action { cursor: pointer; }
      .wf-note-warn { color: #fbbf24; }
      .wf-note { margin: 8px 12px 0; padding: 7px 9px; border-radius: 7px;
        font-size: .78em; line-height: 1.55; color: #cfe7f7;
        background: rgba(56,189,248,.1); border: 1px solid rgba(56,189,248,.3); }
      .wf-theme-light .wf-note { color: #0b4a70; background: rgba(3,105,161,.08); border-color: rgba(3,105,161,.28); }
      .wf-panel-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 2px 0 6px; }
      .wf-panel-body::-webkit-scrollbar { width: 8px; }
      .wf-panel-body::-webkit-scrollbar-thumb { background: rgba(127,127,127,.3); border-radius: 8px; }
      .wf-tabs { display: flex; align-items: center; gap: 6px; padding: 6px 10px 8px; }
      .wf-tab { flex: 1 1 0; min-width: 0; display: inline-flex; align-items: center; justify-content: center;
        gap: 6px; height: 30px; padding: 0 8px; border-radius: 8px; border: 1px solid transparent;
        background: transparent; color: inherit; font: inherit; font-size: .8em; font-weight: 600;
        letter-spacing: .03em; cursor: pointer; opacity: .6; white-space: nowrap; }
      .wf-tab:hover { opacity: .9; background: #17171c; }
      .wf-tab-on { opacity: 1; background: #1c1c22; border-color: #2e2e36; }
      .wf-tab-empty { opacity: .35; }
    .wf-tab.wf-tab-drop { opacity: 1; background: rgba(56,189,248,.18); border-color: #38bdf8; box-shadow: 0 0 0 1px rgba(56,189,248,.45); }
      .wf-tab-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; opacity: .9; }
      .wf-tab-count { font-size: .86em; opacity: .7; font-variant-numeric: tabular-nums; }
      .wf-tab-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
      .wf-tabpanel { display: flex; flex-direction: column; }
      .wf-task-done .wf-task-head { opacity: .55; }
      .wf-task-done .wf-task-title { text-decoration: line-through; }
      .wf-task-done .wf-anchor-badge { opacity: .5; }
      .wf-task { border-bottom: 1px solid #26262e; }
      .wf-task-dragging { opacity: .5; background: rgba(127,127,127,.1); }
      .wf-task-drop-target { box-shadow: inset 0 2px 0 var(--dsw-alias-brand-primary, #7d92ff); }
      .wf-task:last-child { border-bottom: 0; }
      .wf-task-head { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 12px;
        border: 0; background: #1b1b21; color: #f4f4f5; font: inherit; text-align: left; cursor: pointer;
        touch-action: none; user-select: none; }
      .wf-task-head:hover { background: #26262d; }
      .wf-task-head-drag { opacity: .55; background: rgba(127,127,127,.1); }
      .wf-drag-handle { flex: none; width: 14px; text-align: center; font-size: .9em; opacity: 0; cursor: grab;
        transition: opacity .12s ease; user-select: none; }
      .wf-task-head:hover .wf-drag-handle, .wf-task:hover .wf-drag-handle { opacity: .65; }
      .wf-drag-handle:active { cursor: grabbing; }
      .wf-num { flex: none; min-width: 1.5em; font-size: .74em; font-variant-numeric: tabular-nums; opacity: .9; }
      .wf-task-title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        font-size: .84em; }
      .wf-anchor-badge { flex: none; font-size: .72em; opacity: .5; }
      .wf-task-status-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; opacity: .8; }
      .wf-task-body { padding: 8px 12px 8px; display: flex; flex-direction: column; gap: 7px;
        background: #2b2b33; color: #ececf1; }
      .wf-task-desc { margin: 1.55em 0 0; font-size: .8em; line-height: 1.55; color: #ececf1; min-height: 1.55em; }
      .wf-task-line { margin: 0 0 4px; white-space: pre-wrap; word-break: break-word; }
      .wf-task-line:last-child { margin-bottom: 0; }
      .wf-task-view { font-size: .8em; line-height: 1.55; color: #ececf1; white-space: pre-wrap;
        word-break: break-word; border-radius: 8px; padding: 7px 9px; border: 1px solid transparent;
        cursor: text; min-height: 2.7em; }
      .wf-task-view:hover { background: rgba(255,255,255,.045); border-color: rgba(255,255,255,.09); }
      .wf-task-view:focus-visible { outline: none; border-color: #38bdf8;
        box-shadow: 0 0 0 1px rgba(56,189,248,.65), 0 0 14px rgba(56,189,248,.35); }
      .wf-task-view-empty { color: rgba(255,255,255,.42); }
      .wf-theme-light .wf-task-view { color: #26262e; }
      .wf-theme-light .wf-task-view:hover { background: rgba(15,20,30,.04); border-color: rgba(15,20,30,.1); }
      .wf-theme-light .wf-task-view-empty { color: rgba(15,20,30,.42); }
      .wf-task-editor { width: 100%; box-sizing: border-box; display: block; min-height: calc(2 * 1.55em + 16px);
        padding: 7px 9px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08);
        background: rgba(255,255,255,.04); color: #ececf1; font: inherit; font-size: .8em;
        line-height: 1.55; resize: none; overflow-y: auto; }
      .wf-task-editor:hover { border-color: rgba(255,255,255,.16); }
      .wf-task-editor:focus { outline: none; border-color: #38bdf8;
        background: rgba(56,189,248,.08);
        box-shadow: 0 0 0 1px rgba(56,189,248,.75), 0 0 16px rgba(56,189,248,.4); }
      .wf-task-editor::placeholder { color: currentColor; opacity: .5; }
      .wf-theme-light .wf-task-editor { background: rgba(15,20,30,.035); color: #26262e;
        border-color: rgba(15,20,30,.1); }
      .wf-theme-light .wf-task-editor:hover { border-color: rgba(15,20,30,.2); }
      .wf-theme-light .wf-task-editor:focus { background: #ffffff; border-color: #38bdf8;
        box-shadow: 0 0 0 1px rgba(56,189,248,.7), 0 0 16px rgba(56,189,248,.35); }
      .wf-theme-light .wf-task-view:focus-visible { border-color: #38bdf8;
        box-shadow: 0 0 0 1px rgba(56,189,248,.6), 0 0 14px rgba(56,189,248,.3); }
      .wf-task-desc p { margin: 0 0 4px; }
      .wf-task-desc p:last-child { margin-bottom: 0; }
      .wf-task-desc ul, .wf-task-desc ol { margin: 0 0 4px; padding-left: 1.2em; }
      .wf-task-desc code { font-size: .94em; background: rgba(255,255,255,.14); padding: 0 3px; border-radius: 3px; }
      .wf-task-desc pre { margin: 0 0 4px; padding: 6px 8px; background: rgba(0,0,0,.28); border-radius: 6px; overflow-x: auto; }
      .wf-task-desc pre code { background: none; padding: 0; }
      .wf-task-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;
        margin-top: .55em; }
      .wf-status-row { display: flex; gap: 4px; flex-wrap: wrap; }
      .wf-status-btn { font: inherit; font-size: .64em; padding: 1px 7px; border-radius: 999px; cursor: pointer;
        border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.35)); background: transparent;
        color: #9a9aa5; }
      .wf-status-btn:hover { color: #e4e4e9; }
      .wf-status-on { background: color-mix(in srgb, currentColor 16%, transparent); }
      .wf-actions { display: flex; justify-content: flex-end; gap: 6px; margin-left: auto; }
      .wf-task-actions .wf-btn { color: #9a9aa5; border-color: rgba(255,255,255,.12); }
      .wf-task-actions .wf-btn:hover { color: #f4f4f5; background: #3a3a44; }
      .wf-task-actions .wf-btn-danger { color: rgba(248,113,113,.72); border-color: rgba(248,113,113,.26); }
      .wf-task-actions .wf-btn-danger:hover { color: #f87171; background: rgba(248,113,113,.12); }
      .wf-btn { font: inherit; font-size: .78em; padding: 3px 10px; border-radius: 7px; cursor: pointer;
        border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.35)); background: transparent; color: inherit; }
      .wf-btn:hover { background: #3a3a44; }
      .wf-btn:disabled { opacity: .4; cursor: not-allowed; }
      .wf-btn-danger { color: #f87171; border-color: color-mix(in srgb, #f87171 45%, transparent); }
      .wf-btn-confirm { background: #dc2626; color: #ffffff; border-color: #dc2626; font-weight: 600; }
      .wf-btn-confirm:hover { background: #b91c1c; border-color: #b91c1c; color: #ffffff; }
      .wf-task-actions .wf-btn-confirm { color: #ffffff; background: #dc2626; border-color: #dc2626; }
      .wf-task-actions .wf-btn-confirm:hover { color: #ffffff; background: #b91c1c; border-color: #b91c1c; }
      .wf-theme-light .wf-task-actions .wf-btn-confirm { color: #ffffff; background: #dc2626; border-color: #dc2626; }
      .wf-btn-quiet { opacity: .6; }
      .wf-btn-primary { background: #f4f4f5; color: #0b0b0e; border-color: transparent; font-weight: 600; }
      .wf-btn-primary:hover { background: #e4e4e9; }
      .wf-panel-add { display: flex; align-items: stretch; gap: 6px;
        padding: 8px 12px 26px; border-top: 1px solid #26262e; background: #121216; justify-content: flex-start; }
      .wf-add-todo { text-align: center; font: inherit; font-size: .82em; padding: 6px 14px;
        border-radius: 8px; border: 1px dashed rgba(255,255,255,.22); background: transparent;
        color: #e6e9ef; cursor: pointer; }
      .wf-add-todo:hover { background: #14171d; border-color: rgba(255,255,255,.36); }
      .wf-input { flex: 1 1 auto; width: 100%; min-width: 0; box-sizing: border-box;
        font: inherit; font-size: .86em; padding: 8px 10px; border-radius: 8px;
        border: 1px solid #3f3f4a; background: #0f0f12; color: #f4f4f5;
        resize: none; overflow-y: auto; line-height: 1.55; display: block;
        min-height: calc(2 * 1.55em + 18px); }
      .wf-add-editing { display: flex; flex-direction: column; align-items: stretch; gap: 4px; }
      .wf-add-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 0; }
      .wf-input:focus { outline: none; border-color: #38bdf8;
        box-shadow: 0 0 0 1px rgba(56,189,248,.75), 0 0 16px rgba(56,189,248,.4); }
      .wf-empty-list { display: flex; flex-direction: column; gap: 8px; padding: 6px 2px; }
      .wf-empty-line { font-size: .82em; line-height: 1.5; color: #9a9aa5; padding-left: 26px; text-indent: -26px; }
      .wf-block-text { margin: 0; font-size: .84em; line-height: 1.55; }
      .wf-block-muted { opacity: .7; }
      .wf-crash-detail { word-break: break-word; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .72em; opacity: .75; }
      .wf-panel.wf-resizing { user-select: none; }
      .wf-theme-light.wf-panel, .wf-theme-light.wf-pill { background: #e2e5ec; color: #18181b;
        border: 1px solid rgba(3,105,161,.95);
        box-shadow: inset 0 1px 0 #ffffff,
          0 1px 2px rgba(16,24,40,.12),
          0 10px 20px -8px rgba(16,24,40,.3),
          0 28px 52px -22px rgba(16,24,40,.38),
          0 0 0 1px rgba(3,105,161,.62),
          0 0 5px 1px rgba(2,132,199,.8),
          0 0 13px 2px rgba(56,189,248,.55); }
      .wf-theme-light .wf-dragbar { background: #e2e5ec; border-bottom-color: #d2d6e0; }
      .wf-theme-light .wf-kbd { color: #26262e;
        background: linear-gradient(180deg, #ffffff 0%, #e6e9f0 100%);
        border-color: #cfd4df;
        box-shadow: inset 0 1px 0 #ffffff, inset 0 -2px 0 #d5dae4,
          0 2px 0 #c9cfda, 0 3px 6px rgba(16,24,40,.16);
        text-shadow: 0 1px 0 #ffffff; }
      .wf-theme-light .wf-icon-btn:hover, .wf-theme-light .wf-btn:hover { background: #f4f4f5; }
      .wf-theme-light .wf-panel-add { background: #e2e5ec; border-top-color: #d2d6e0; }
      .wf-theme-light .wf-add-todo { color: #52525b; border-color: #e4e4e7; }
      .wf-theme-light .wf-add-todo:hover { background: #f4f4f5; border-color: #d4d4d8; }
      .wf-theme-light .wf-input { background: #fafafa; color: #18181b; border-color: #e4e4e7; }
      .wf-theme-light .wf-input:focus { border-color: #38bdf8;
        box-shadow: 0 0 0 1px rgba(56,189,248,.7), 0 0 16px rgba(56,189,248,.35); }
      .wf-theme-light .wf-empty-line, .wf-theme-light .wf-status-btn { color: #6b6b76; }
      .wf-theme-light .wf-status-btn:hover { color: #18181b; }
      .wf-theme-light .wf-task { border-bottom-color: #d7dbe4; }
      .wf-theme-light .wf-btn-primary { background: #18181b; color: #ffffff; }
      .wf-theme-light .wf-btn-primary:hover { background: #3f3f46; }
      .wf-theme-light .wf-task-head { background: #eef0f5; color: #18181b; }
      .wf-theme-light .wf-task-head:hover { background: #e4e7ef; }
      .wf-theme-light .wf-task-body { background: #ffffff; color: #18181b; }
      .wf-theme-light .wf-task-desc { color: #26262e; }
      .wf-theme-light .wf-status-btn { color: #8a8a95; }
      .wf-theme-light .wf-task-actions .wf-btn { color: #6b6b76; border-color: rgba(15,20,30,.16); }
      .wf-theme-light .wf-task-actions .wf-btn:hover { color: #18181b; background: #dedee6; }
      .wf-theme-light .wf-task-actions .wf-btn-danger { color: rgba(220,38,38,.66); border-color: rgba(220,38,38,.22); }
      .wf-theme-light .wf-btn:hover { background: #dedee6; }
      .wf-theme-light .wf-task-desc code { background: rgba(0,0,0,.07); }
      .wf-theme-light .wf-task-desc pre { background: rgba(0,0,0,.05); }
      .wf-theme-light .wf-resize { background: linear-gradient(135deg, transparent 0 50%, rgba(24,24,27,.35) 50% 56%, transparent 56% 64%, rgba(24,24,27,.35) 64% 70%, transparent 70%); }
      .wf-theme-light .wf-menu { background: #ffffff; border-color: #e4e4e7; color: #18181b; }
      .wf-theme-light .wf-menu-item { background: #f4f4f5; color: #18181b; }
      .wf-theme-light .wf-menu-item:hover { background: #e4e4e7; }
      .wf-theme-light .wf-tabs { background: #c4cad7; border-radius: 8px; margin: 6px 8px 4px; padding: 5px; }
      .wf-theme-light .wf-tab { color: #3f4658; }
      .wf-theme-light .wf-tab:hover { background: rgba(255,255,255,.5); }
      .wf-theme-light .wf-tab-on { background: #ffffff; border-color: #b3bacb; color: #18181b;
        box-shadow: 0 1px 2px rgba(15,20,30,.12); }
      .wf-theme-light .wf-tab-count { color: #5b6478; }
      .wf-theme-light .wf-menu-preview { color: #6b6b76; }
      .wf-menu { position: fixed; z-index: 2147483100; min-width: 172px; padding: 6px; border-radius: 10px;
        background: #1c1c22; border: 1px solid #2e2e36; box-shadow: 0 16px 40px rgba(0,0,0,.55);
        display: flex; flex-direction: column; gap: 4px; }
      .wf-menu-item { font: inherit; font-size: 12.5px; text-align: left; padding: 7px 10px; border-radius: 7px;
        border: 0; background: #222228; color: #f4f4f5; cursor: pointer; }
      .wf-menu-item:hover { background: #2e2e36; }
      .wf-menu-done { background: #fff; color: #111; }
      .wf-menu-preview { font-size: 10.5px; color: #8b919d; padding: 0 10px 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .wf-resize.wf-resize-left { left: 0; right: auto; cursor: nesw-resize; transform: scaleX(-1); }
      .wf-resize { position: absolute; right: 0; bottom: 0; width: 22px; height: 22px; cursor: nwse-resize;
        touch-action: none; z-index: 6;
        background: linear-gradient(135deg, transparent 0 50%, rgba(127,127,127,.45) 50% 56%, transparent 56% 64%, rgba(127,127,127,.45) 64% 70%, transparent 70%); }
      .wf-resize::after { content: ''; position: absolute; right: 0; bottom: 0; width: 38px; height: 38px; }
      .wf-pill { position: fixed; z-index: 2147483000; right: 100px; top: 100px;
        display: inline-flex; align-items: center; justify-content: center; gap: 8px;
        height: 44px; min-width: 103px; padding: 0 14px; border-radius: 999px;
        border: 1px solid rgba(56,189,248,.85); background: #121216;
        color: #f4f4f5; font: inherit; font-size: 12px; cursor: grab;
        box-shadow: 0 2px 4px rgba(0,0,0,.4), 0 10px 22px -8px rgba(0,0,0,.6),
          0 0 0 1px rgba(56,189,248,.8), 0 0 5px 1px rgba(56,189,248,.9),
          0 0 12px 1px rgba(56,189,248,.62);
        backdrop-filter: blur(12px); user-select: none; touch-action: none; }
      .wf-pill:active { cursor: grabbing; }
      .wf-pill-label { font-size: 13px; font-weight: 600; letter-spacing: .02em; opacity: .92; }

      .wf-toast { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
        max-width: min(420px, calc(100vw - 48px)); padding: 12px 18px; border-radius: 10px;
        background: #17171b; color: #f4f4f5; border: 1px solid rgba(125,146,255,.45);
        box-shadow: 0 18px 40px -12px rgba(0,0,0,.7), 0 0 0 1px rgba(125,146,255,.18);
        font-size: 13px; line-height: 1.5; text-align: center; pointer-events: none;
        z-index: 2147483200; animation: wf-toast-in .16s ease-out; }
      .wf-theme-light .wf-toast { background: #ffffff; color: #18181b; border-color: rgba(3,105,161,.5); }
      @keyframes wf-toast-in { from { opacity: 0; transform: translate(-50%, -46%); } to { opacity: 1; transform: translate(-50%, -50%); } }
      .wf-jump-flash { animation: wf-jump-flash 1.9s ease-out; }
      @keyframes wf-jump-flash {
        0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--dsw-alias-brand-primary, #7d92ff) 70%, transparent); }
        35% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary, #7d92ff) 55%, transparent); }
        100% { box-shadow: none; }
      }

      .wf-modal-mask { position: fixed; inset: 0; z-index: 2147483100; display: flex; align-items: center;
        justify-content: center; padding: 20px; background: rgba(0,0,0,.55); backdrop-filter: blur(3px); pointer-events: auto; }
      .wf-modal { width: min(420px, calc(100vw - 40px)); display: flex; flex-direction: column; gap: 10px;
        padding: 18px; border-radius: 14px; background: #101318; border: 1px solid rgba(255,255,255,.1);
        border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.26)); box-shadow: 0 24px 64px rgba(0,0,0,.5);
        color: var(--dsw-alias-label-primary, #e8eaf0); }
      .wf-modal-title { font-size: 15px; font-weight: 600; }
      .wf-modal-text { margin: 0; font-size: 12.5px; line-height: 1.6; color: var(--dsw-alias-label-secondary, #9aa0aa); }
      .wf-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
      .wf-modal-btn { font: inherit; font-size: 12.5px; padding: 6px 14px; border-radius: 8px; cursor: pointer;
        border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.35)); background: transparent; color: inherit; }
      .wf-modal-btn:hover { background: #1b1f27; }
      .wf-modal-primary { background: #fff; color: #111; border-color: transparent; font-weight: 600; }
      .wf-modal-primary:hover { background: #ececec; }
    `

    return {
      inject: ['slots'],
      __test: { splitTaskText, moveTaskInList, normalizeTask, splitKeyword: stripKeyword, panelDragPreview, numberTasks },
      apply(ctx) {
        stripReloadParam()

        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-plugin', PLUGIN_ID)
          style.textContent = STYLES
          document.head.appendChild(style)
          return () => { style.remove() }
        }, 'wide-focus: styles')

        attachLocale(ctx)

        try { uiWorkspaceService = ctx.get ? ctx.get('uiWorkspace') : null } catch { uiWorkspaceService = null }

        const slots = ctx.slots ?? (ctx.get ? ctx.get('slots') : undefined)
        if (!slots) return

        slots.inject('conversation.session.header.utilities', () => slots.register({
          name: 'conversation.session.header.utilities',
          id: 'wide-focus-toggle',
          order: 30,
        }, WideToggle))

        loadTasks()

        ctx.effect(() => {
          const flush = () => flushServerSave()
          window.addEventListener('pagehide', flush)
          window.addEventListener('beforeunload', flush)
          const onVisibility = () => { if (document.visibilityState === 'hidden') flush() }
          document.addEventListener('visibilitychange', onVisibility)
          return () => {
            window.removeEventListener('pagehide', flush)
            window.removeEventListener('beforeunload', flush)
            document.removeEventListener('visibilitychange', onVisibility)
          }
        }, 'wide-focus: flush pending task save before the page unloads')

        try {
          window.__wideFocus = {
            reset: () => { requestPanelReset({ keepSize: false }) },
            resetWide: () => { setWide(false) },
            lastJump: () => jumpInfo,
            find: (text) => { const node = findMessageNode(text); return node ? node.tagName + '.' + node.className : null },
            reloadTasks: () => loadTasks(),
            panelKeys: [PANEL_KEY, POS_KEY, SIZE_KEY, FONT_KEY],
          }
          window.__dshWideFocus = {
            version: 1,
            registerTool: (id, component) => registerPluginTool(id, component),
            hasTool: (id) => pluginTools.has(String(id)),
            toolCount: () => pluginTools.size,
            getSessionId: () => activeSessionId,
            onSessionChange: (watcher) => watchActiveSession(watcher),
          }
        } catch { /* ignore */ }

        slots.inject('shell.overlay', () => slots.register({
          name: 'shell.overlay',
          id: 'wide-focus-task-panel',
          order: 60,
          label: '任务面板',
        }, () => h(PanelBoundary, null, h(TaskPanel))))

        slots.inject('shell.overlay', () => slots.register({
          name: 'shell.overlay',
          id: 'wide-focus-selection-menu',
          order: 59,
          label: '加入待办',
        }, SelectionMenu))

        slots.inject('shell.overlay', () => slots.register({
          name: 'shell.overlay',
          id: 'wide-focus-toast',
          order: 62,
          label: '待办提示',
        }, TaskToast))

        slots.inject('shell.overlay', () => slots.register({
          name: 'shell.overlay',
          id: 'wide-focus-reload-dialog',
          order: 61,
          label: '异常恢复确认',
        }, ReloadDialog))

        ctx.effect(() => {
          const isTypingTarget = (target) => {
            if (!(target instanceof Element)) return false
            if (target.closest('input, textarea, select')) return true
            return target instanceof HTMLElement && target.isContentEditable
          }
          const onKeyDown = (event) => {
            if (event.defaultPrevented || event.isComposing) return
            if (event.ctrlKey || event.metaKey || event.altKey) return
            if (typeof event.key !== 'string' || event.key.toLowerCase() !== 'r') return
            if (isTypingTarget(event.target)) return
            event.preventDefault()
            requestPanelToggle()
          }
          window.addEventListener('keydown', onKeyDown)
          return () => window.removeEventListener('keydown', onKeyDown)
        }, 'wide-focus: R toggles the panel')

        ctx.effect(() => {
          const onKeyDown = (event) => {
            if (event.defaultPrevented || event.isComposing) return
            if (!(event.ctrlKey || event.metaKey) || event.altKey) return
            const key = typeof event.key === 'string' ? event.key : ''
            if (key === '=' || key === '+') {
              event.preventDefault()
              requestFontAdjust(1)
              return
            }
            if (key === '-' || key === '_') {
              event.preventDefault()
              requestFontAdjust(-1)
            }
          }
          window.addEventListener('keydown', onKeyDown, true)
          return () => window.removeEventListener('keydown', onKeyDown, true)
        }, 'wide-focus: Ctrl with +/- adjusts the panel font size')

        ctx.effect(() => {
          const root = document.documentElement
          if (wideEnabled) root.setAttribute(WIDE_ATTR, '')
          syncWide()
          const timer = window.setInterval(() => { if (wideEnabled) syncWide() }, 400)
          return () => {
            window.clearInterval(timer)
            root.removeAttribute(WIDE_ATTR)
            restoreWidthTargets()
          }
        }, 'wide-focus: width axis')
      },
    }
  },
})
