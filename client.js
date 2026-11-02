/**
 * wide-focus — DSH Web client plugin (local-only task panel).
 *
 * 1. Wide reading mode (default ON): the transcript is capped through
 *    `--dsh-chat-content-width`, driven by `--dsh-chat-user-width`. We set that
 *    token to `calc(100% - 40px)` on <html> and on every element that writes it
 *    inline, so it resolves against the real column instead of a measured px.
 * 2. Floating task panel: a self-contained local todo board. No taskboard, no
 *    network — tasks live in `<DSH_HOME>/wide-focus/tasks.json` via the host
 *    half, and can be dragged, re-ordered and moved through todo → doing →  *    review. Font size is adjustable 10–8px.
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

    function firstGlyph(text) {
      const chars = Array.from(String(text || ''))
      return chars.length > 0 ? chars[0] : ''
    }

    function tabCss(key) {
      return (TABS.find((tab) => tab.key === key) || {}).css || '#7d92ff'
    }

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
        themeToDark: '切换到深色主题。',
        pageReload: '异常恢复',
        pageReloadTitle: '异常恢复：清空面板位置与尺寸，再重新加载客户端（会先确认）。',
        reloadConfirmTitle: '异常恢复？',
        reloadConfirmText: '会清空任务面板的位置与尺寸并重新加载客户端；正在进行的对话与未发送的输入会中断。确定继续吗？',
        cancel: '取消',
        reloadConfirmOk: '仍然恢复',
        panelTitle: '任务面板',
        reset: '复位',
        resetTitle: '回到默认位置（右上角）',
        editHint: '点击即可编辑，输入后自动保存',
        shortcutHint: '按 R 键显示或隐藏任务面板',
        zoomHint: '按住 Ctrl 滚动滚轮（或 Ctrl + ＋/ Ctrl + −）调整字号',
        editPlaceholder: '',
        dragbarHint: '拖动移动 · 点击折叠',
        expandTitle: '展开任务面板',
        empty1: '还没有待办。点下面的「＋ 添加待办」新建一条。',
        empty2: '在聊天里选中文字，右键 →「加入待办」',
        addTask: '加入待办',
        added: '已加入',
        movedTo: '已移到',
        emptyTab: '这个分类暂时没有任务。',
      dropHere: '放到这里',
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
        editHint: 'Click to edit; saves as you type',
        shortcutHint: 'Press R to show or hide the task panel',
        zoomHint: 'Hold Ctrl and scroll (or Ctrl + plus / Ctrl + minus) to change the font size',
        editPlaceholder: '',
        dragbarHint: 'Drag to move · click to collapse',
        expandTitle: 'Open the task panel',
        empty1: 'No todos yet. Use "＋ Add a todo" below to create one.',
        empty2: 'Select text in the chat, right-click → "Add a todo".',
        addTask: 'Add a todo',
        added: 'Added',
        movedTo: 'Moved to',
        emptyTab: 'Nothing in this category yet.',
      dropHere: 'Drop here',
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
      const [dropAt, setDropAt] = useState(null)
      const activeTabRef = useRef(activeTab)
      const [ghost, setGhost] = useState(null)
      const [flashId, setFlashId] = useState(null)
      const [passTab, setPassTab] = useState(null)
      const [freshTab, setFreshTab] = useState(null)
      const [moveNotice, setMoveNotice] = useState(null)
      const ghostRaf = useRef(0)
      const flashTimer = useRef(0)
      const passTimer = useRef(0)
      const freshTimer = useRef(0)
      const noticeTimer = useRef(0)
      const langRef = useRef(lang)
      langRef.current = lang
      const ghostRef = useRef(null)
      ghostRef.current = ghost
      const ghostClearTimer = useRef(0)
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

      useEffect(() => () => {
        window.cancelAnimationFrame(ghostRaf.current)
        window.clearTimeout(flashTimer.current)
        window.clearTimeout(passTimer.current)
        window.clearTimeout(freshTimer.current)
        window.clearTimeout(ghostClearTimer.current)
        window.clearTimeout(noticeTimer.current)
      }, [])

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
          const width = clamp(session.startRect.width - dx, 300, Math.min(maxWidth, maxForLeft))
          session.next = {
            width,
            height,
            left: session.startRect.right - width,
            top: session.startRect.top,
          }
        } else {
          const width = clamp(session.startRect.width + dx, 300, maxWidth)
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
        const hitInsertion = (clientY, draggedId) => {
          const body = bodyRef.current
          if (!body) return null
          const box = body.getBoundingClientRect()
          if (clientY < box.top - 8 || clientY > box.bottom + 8) return null
          const rows = []
          try {
            body.querySelectorAll('[data-task-id]').forEach((element) => {
              const id = element.getAttribute('data-task-id')
              if (id && id !== draggedId) rows.push({ id, rect: element.getBoundingClientRect() })
            })
          } catch { return null }
          if (rows.length === 0) return null
          for (const row of rows) {
            if (clientY < row.rect.top + row.rect.height / 2) return { id: row.id, after: false }
          }
          return { id: rows[rows.length - 1].id, after: true }
        }

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
              setDropAt(null)
              return
            }
            if (drag.target === null || drag.target.tab !== tabKey) {
              drag.target = { tab: tabKey }
              setDropTab(tabKey)
              setHoverId(null)
              setDropAt(null)
            }
            if (element && element.closest && ghostRaf.current === 0) {
              let tabRect = null
              let panelRect = null
              try {
                tabRect = element.closest('[data-tab]').getBoundingClientRect()
                panelRect = panelRef.current ? panelRef.current.getBoundingClientRect() : null
              } catch { tabRect = null }
              if (tabRect && panelRect) {
                const width = Math.max(48, Math.round(tabRect.width * 0.8))
                ghostRaf.current = window.requestAnimationFrame(() => {
                  ghostRaf.current = 0
                  setGhost({
                    x: tabRect.left - panelRect.left + tabRect.width / 2,
                    y: tabRect.top - panelRect.top + tabRect.height / 2,
                    title: drag.title || '',
                    color: drag.color || '#7d92ff',
                    compact: width,
                  })
                })
              }
            }
            return
          }
          setDropTab(null)
          if (ghostRaf.current === 0) {
            const ghostX = event.clientX
            const ghostY = event.clientY
            ghostRaf.current = window.requestAnimationFrame(() => {
              ghostRaf.current = 0
              const rect = panelRef.current ? panelRef.current.getBoundingClientRect() : null
              if (!rect) return
              setGhost({
                x: Math.max(0, ghostX - rect.left + 14),
                y: Math.max(0, ghostY - rect.top + 10),
                title: drag.title || '',
                color: drag.color || '#7d92ff',
              })
            })
          }
          if (header !== null) {
            const target = { id: null, after: true, status: header.getAttribute('data-drop-status') }
            if (drag.target === null || drag.target.status !== target.status || drag.target.id !== null) {
              drag.target = target
              setHoverId(null)
              setDropAt(null)
            }
            return
          }
          const insertion = hitInsertion(event.clientY, drag.id)
          if (insertion === null) {
            if (drag.target !== null) { drag.target = null; setHoverId(null); setDropAt(null) }
            return
          }
          const target = { id: insertion.id, after: insertion.after, status: activeTabRef.current }
          if (drag.target === null || drag.target.id !== target.id || drag.target.after !== target.after || drag.target.status !== target.status) {
            drag.target = target
            setHoverId(insertion.id)
            setDropAt({ id: insertion.id, after: insertion.after })
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
          setDropAt(null)
          const flyingGhost = ghostRef.current
          if (flyingGhost) {
            setGhost({ ...flyingGhost, dropping: true })
            window.clearTimeout(ghostClearTimer.current)
            ghostClearTimer.current = window.setTimeout(() => setGhost(null), 180)
          } else {
            setGhost(null)
          }
          window.cancelAnimationFrame(ghostRaf.current)
          ghostRaf.current = 0
          if (!drag.moved) return
          let landedTab = null
          let moved = false
          if (drag.target !== null) {
            try {
              if (drag.target.tab) {
                moveTaskTo(drag.target.tab, drag.id, null, false)
                landedTab = drag.target.tab
              } else {
                moveTaskTo(activeTabRef.current, drag.id, drag.target.id, drag.target.after)
              }
              moved = true
            } catch (error) {
              try { console.error('[wide-focus] move failed', error) } catch { /* ignore */ }
            }
          }
          if (moved) {
            window.clearTimeout(flashTimer.current)
            setFlashId(drag.id)
            flashTimer.current = window.setTimeout(() => setFlashId(null), 950)
            if (landedTab !== null) {
              window.clearTimeout(passTimer.current)
              window.clearTimeout(ghostClearTimer.current)
              setPassTab(landedTab)
              passTimer.current = window.setTimeout(() => setPassTab(null), 700)
              if (landedTab !== activeTabRef.current) {
                window.clearTimeout(freshTimer.current)
                setFreshTab(landedTab)
                freshTimer.current = window.setTimeout(() => setFreshTab(null), 2000)
              }
              const meta = TABS.find((tab) => tab.key === landedTab) || {}
              const name = t(langRef.current, meta.label || 'statusDoing')
              window.clearTimeout(noticeTimer.current)
              setMoveNotice(t(langRef.current, 'movedTo') + '「' + name + '」')
              noticeTimer.current = window.setTimeout(() => setMoveNotice(null), 1500)
            }
          }
          dragEndAtRef.current = Date.now()
        }
        const onCancel = () => {
          setDropAt(null)
          if (resizeRef.current) settleResize()
          const drag = dragRef.current
          if (!drag) return
          if (drag.mode === 'panel') { panelDragEnd(); return }
          dragRef.current = null
          setDraggingId(null)
          setHoverId(null)
          setDropTab(null)
          setDropAt(null)
          setGhost(null)
          window.cancelAnimationFrame(ghostRaf.current)
          ghostRaf.current = 0
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
        dragRef.current = { mode: 'task', id: task.id, status: task.status, title: task.title, color: tabCss(task.status), startX, startY, moved: false, target: null }
        setDraggingId(task.id)
      }

      const beginTaskDrag = (event, task) => {
        if (event.button !== 0) return
        const startX = event.clientX
        const startY = event.clientY
        window.clearTimeout(longPressRef.current)
        const start = () => {
          longPressRef.current = null
          dragRef.current = { mode: 'task', id: task.id, status: task.status, title: task.title, color: tabCss(task.status), startX, startY, moved: false, target: null }
          setDraggingId(task.id)
        }
        // Touch keeps a short long-press so scrolling the list still works; a
        // mouse drag starts on the first movement instead of after a pause.
        if (event.pointerType === 'touch') {
          longPressRef.current = window.setTimeout(start, 260)
          return
        }
        start()
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
            flashId === task.id ? 'wf-task-flash' : '',
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

      const panelNarrow = size.width < 480
      const panelTiny = size.width < 360

      const tabsNode = h('div', { className: 'wf-tabs', role: 'tablist', 'aria-label': t(lang, 'panelTitle') },
        columns.map((column) => h('button', {
          key: column.key,
          type: 'button',
          role: 'tab',
          'aria-selected': activeTab === column.key ? 'true' : 'false',
          'data-tab': column.key,
          title: t(lang, column.label),
          className: [
            'wf-tab',
            activeTab === column.key ? 'wf-tab-on' : '',
            dropTab === column.key ? 'wf-tab-drop' : '',
            passTab === column.key ? 'wf-tab-pass' : '',
            freshTab === column.key ? 'wf-tab-fresh' : '',
            column.tasks.length === 0 ? 'wf-tab-empty' : '',
          ].filter(Boolean).join(' '),
          onClick: () => switchTab(column.key),
        },
          h('span', { className: 'wf-tab-dot', style: { background: column.css } }),
          h('span', { className: 'wf-tab-label wf-tab-label-full' }, t(lang, column.label)),
          h('span', { className: 'wf-tab-label wf-tab-label-short' }, firstGlyph(t(lang, column.label))),
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
          h('span', { className: 'wf-dragbar-grip', title: t(lang, 'dragbarHint'), 'aria-hidden': 'true' },
            h('svg', { className: 'wf-grip', viewBox: '0 0 14 22', width: 14, height: 22, focusable: 'false' },
              h('circle', { cx: 3, cy: 4, r: 2, fill: 'currentColor' }),
              h('circle', { cx: 11, cy: 4, r: 2, fill: 'currentColor' }),
              h('circle', { cx: 3, cy: 11, r: 2, fill: 'currentColor' }),
              h('circle', { cx: 11, cy: 11, r: 2, fill: 'currentColor' }),
              h('circle', { cx: 3, cy: 18, r: 2, fill: 'currentColor' }),
              h('circle', { cx: 11, cy: 18, r: 2, fill: 'currentColor' }))),
          h(PanelThemeButton, null)))

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
          className: [
            'wf-panel',
            theme === 'light' ? 'wf-theme-light' : '',
            panelNarrow ? 'wf-panel-narrow' : '',
            panelTiny ? 'wf-panel-tiny' : '',
          ].filter(Boolean).join(' '),
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
                  : (() => {
                    const rows = activeColumn.tasks
                    const slotIndex = dropAt === null
                      ? -1
                      : rows.reduce((found, task, index) =>
                        found < 0 && task.id === dropAt.id ? index + (dropAt.after ? 1 : 0) : found, -1)
                    const slot = h('div', { className: 'wf-drop-slot', 'aria-hidden': 'true' },
                      h('span', { className: 'wf-drop-slot-label' }, t(lang, 'dropHere')))
                    return rows.map((task, index) => [
                      slotIndex === index ? slot : null,
                      taskRow(task),
                    ]).concat(slotIndex === rows.length ? [slot] : [])
                  })()),
            moveNotice ? h('div', { className: 'wf-move-notice', role: 'status' }, moveNotice) : null,
            ghost
              ? h('div', {
                className: ghost.dropping ? 'wf-drag-ghost wf-dropping' : 'wf-drag-ghost',
                style: {
                  left: ghost.x + 'px',
                  top: ghost.y + 'px',
                  borderColor: ghost.color,
                  maxWidth: ghost.compact ? ghost.compact + 'px' : undefined,
                  fontSize: ghost.compact ? '.7em' : undefined,
                  padding: ghost.compact ? '3px 8px' : undefined,
                },
              },
                h('span', { className: 'wf-drag-ghost-dot', style: { background: ghost.color } }),
                h('span', { className: 'wf-drag-ghost-title' }, ghost.title))
              : null),
          h('div', { className: draft === null ? 'wf-panel-add' : 'wf-panel-add wf-add-editing' },
            draft === null
              ? h('button', {
                type: 'button',
                className: 'wf-add-todo',
                onClick: () => setDraft(''),
              }, '＋' + t(lang, 'addTodo'))
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
      .wf-dragbar-grip { display: inline-flex; align-items: center; justify-content: center;
        width: 22px; height: 30px; border-radius: 6px; color: #f4f4f5;
        opacity: .56; transition: opacity .15s ease, background .15s ease; cursor: grab; }
      .wf-dragbar:hover .wf-dragbar-grip { opacity: .9; }
      .wf-dragbar:active .wf-dragbar-grip { cursor: grabbing; opacity: .92; }
      .wf-grip { display: block; }
      .wf-theme-light .wf-dragbar-grip { color: #3a4150; opacity: .6; }
      .wf-kbd { display: inline-flex; align-items: center; justify-content: center;
        width: 36px; height: 36px; padding: 0; border-radius: 8px;
        font-size: 17px; font-weight: 700; line-height: 1; color: #f2f4f8;
        background: linear-gradient(160deg, #363b47 0%, #262a33 58%, #1e222a 100%);
        border: 1px solid rgba(255,255,255,.12);
        box-shadow:
          inset 1px 1px 0 rgba(255,255,255,.26),
          inset 1px 0 0 rgba(255,255,255,.08),
          inset -1px -1px 0 rgba(0,0,0,.42),
          0 2px 0 #0b0d12,
          0 3px 6px rgba(0,0,0,.36);
        text-shadow: 0 1px 0 rgba(0,0,0,.55);
        pointer-events: none; user-select: none;
        transition: transform .08s ease, box-shadow .08s ease; }
      .wf-kbd-group { display: inline-flex; align-items: center; gap: 6px; }
      .wf-kbd-ctrl { width: auto; min-width: 52px; padding: 0 11px; font-size: 13px; letter-spacing: .04em;
        display: inline-flex; align-items: center; gap: 6px; }
      .wf-kbd-ctrl .wf-wheel { width: 16px; height: 16px; opacity: .9; }
      .wf-group-r .wf-kbd {
        background: linear-gradient(160deg, #34475f 0%, #24324b 58%, #1a2436 100%);
        border-color: rgba(140,180,255,.38); color: #e2edff;
        box-shadow:
          inset 1px 1px 0 rgba(190,215,255,.32),
          inset -1px -1px 0 rgba(0,0,0,.45),
          0 2px 0 #0b0d12,
          0 3px 6px rgba(0,0,0,.36); }
      .wf-group-wheel .wf-kbd {
        background: linear-gradient(160deg, #2c4a44 0%, #1d342f 58%, #152622 100%);
        border-color: rgba(120,220,190,.35); color: #e0faf2;
        box-shadow:
          inset 1px 1px 0 rgba(170,240,220,.28),
          inset -1px -1px 0 rgba(0,0,0,.45),
          0 2px 0 #0b0d12,
          0 3px 6px rgba(0,0,0,.36); }
      .wf-kbd:active {
        transform: translateY(1px);
        box-shadow:
          inset 1px 1px 0 rgba(255,255,255,.18),
          inset -1px -1px 0 rgba(0,0,0,.4),
          0 1px 0 #0a0c11,
          0 2px 4px rgba(0,0,0,.3);
      }
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
      .wf-tab { flex: 1 1 0; min-width: 0; white-space: nowrap; display: inline-flex; align-items: center; justify-content: center;
        gap: 6px; height: 30px; padding: 0 8px; border-radius: 8px; border: 1px solid transparent;
        background: transparent; color: inherit; font: inherit; font-size: .8em; font-weight: 600;
        letter-spacing: .03em; cursor: pointer; opacity: .6; white-space: nowrap; }
      .wf-tab:hover { opacity: .9; background: #17171c; }
      .wf-tab-on { opacity: 1; background: #1c1c22; border-color: #2e2e36; }
      .wf-tab-empty { opacity: .35; }
      .wf-tab.wf-tab-drop { opacity: 1; background: rgba(56,189,248,.18); border-color: #38bdf8; box-shadow: 0 0 0 1px rgba(56,189,248,.45); }
      .wf-tab.wf-tab-pass { animation: wf-tab-pass .64s ease-out; }
      @keyframes wf-tab-pass {
        0% { transform: scale(1.05); background: rgba(56,189,248,.42); border-color: #7dd3fc;
          box-shadow: 0 0 0 0 rgba(56,189,248,.55), inset 0 0 0 1px rgba(125,211,252,.9); }
        45% { transform: scale(.99); background: rgba(56,189,248,.2); border-color: #38bdf8;
          box-shadow: 0 0 0 8px rgba(56,189,248,0), inset 0 0 0 1px rgba(56,189,248,.5); }
        100% { transform: scale(1); background: transparent; border-color: transparent; box-shadow: none; }
      }
      .wf-task.wf-task-flash { animation: wf-task-flash .95s ease-out; }
      @keyframes wf-task-flash {
        0% { background: rgba(56,189,248,.26); box-shadow: inset 0 0 0 1px rgba(56,189,248,.75); }
        100% { background: transparent; box-shadow: inset 0 0 0 1px rgba(56,189,248,0); }
      }
      .wf-drag-ghost { transition: transform .18s ease, opacity .18s ease; position: absolute; z-index: 6; display: inline-flex; align-items: center; gap: 7px;
        max-width: 240px; padding: 5px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,.22);
        background: #1b1f2a; color: #f4f4f5; font-size: .82em; font-weight: 600;
        box-shadow: 0 12px 26px -8px rgba(0,0,0,.8); transform: translate(-50%, -50%) rotate(-2deg);
        pointer-events: none; }
      .wf-drag-ghost.wf-dropping { transform: translate(-50%, -50%) rotate(-2deg) scale(.18); opacity: 0; }
      .wf-drag-ghost-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .wf-drag-ghost-dot { width: 8px; height: 8px; border-radius: 999px; flex: none; }
      .wf-move-notice { position: absolute; left: 50%; bottom: 54px; z-index: 7; transform: translateX(-50%);
        max-width: calc(100% - 32px); padding: 6px 12px; border-radius: 999px; background: rgba(13,16,22,.94);
        color: #f4f4f5; font-size: .78em; font-weight: 600; border: 1px solid rgba(56,189,248,.45);
        box-shadow: 0 10px 24px -10px rgba(0,0,0,.8); pointer-events: none;
        animation: wf-move-notice-in .18s ease-out; }
      @keyframes wf-move-notice-in { from { opacity: 0; transform: translate(-50%, 6px); } to { opacity: 1; transform: translate(-50%, 0); } }
      .wf-theme-light .wf-drag-ghost { background: #ffffff; color: #18181b; border-color: rgba(15,20,30,.2); }
      .wf-theme-light .wf-move-notice { background: #ffffff; color: #18181b; border-color: rgba(3,105,161,.45); }
      @media (prefers-reduced-motion: reduce) {
        .wf-tab.wf-tab-pass, .wf-task.wf-task-flash, .wf-move-notice { animation: none; }
      }
      .wf-tab-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; opacity: .9; }
      .wf-drop-slot { display: flex; align-items: center; justify-content: center; height: 40px; margin: 4px 8px; border: 1px dashed #38bdf8; border-radius: 8px; background: rgba(56,189,248,.10); color: #7dd3fc; font-size: .72em; letter-spacing: .04em; animation: wf-slot-pulse 1.2s ease-in-out infinite; }
      .wf-drop-slot-label { opacity: .9; }
      @keyframes wf-slot-pulse {
        0%, 100% { border-color: rgba(56,189,248,.55); background: rgba(56,189,248,.07); }
        50% { border-color: #38bdf8; background: rgba(56,189,248,.16); }
      }
      .wf-theme-light .wf-drop-slot { background: rgba(3,105,161,.08); color: #0369a1; }
      @media (prefers-reduced-motion: reduce) {
        .wf-drop-slot { animation: none; }
        .wf-tab.wf-tab-fresh,
        .wf-tab.wf-tab-fresh .wf-tab-count { animation: none; }
      }
      .wf-tab-count { font-size: .86em; opacity: .7; font-variant-numeric: tabular-nums; }
      .wf-tab.wf-tab-fresh { animation: wf-tab-breathe 1.4s ease-in-out infinite; }
      .wf-tab.wf-tab-fresh .wf-tab-count {
        opacity: 1;
        color: #7dd3fc;
        font-size: .98em;
        font-weight: 800;
        letter-spacing: .02em;
        background: none;
        border: 0;
        text-shadow: 0 0 4px rgba(56,189,248,.85), 0 0 10px rgba(56,189,248,.5);
        animation: wf-count-glow .4s ease-in-out 5 alternate;
      }
      @keyframes wf-tab-breathe {
        0%, 100% { background-color: rgba(56,189,248,.05); }
        50% { background-color: rgba(56,189,248,.20); }
      }
      @keyframes wf-count-glow {
        0% { color: #7dd3fc; text-shadow: 0 0 3px rgba(125,211,252,.6), 0 0 8px rgba(56,189,248,.35); }
        100% { color: #ffffff; text-shadow: 0 0 6px rgba(224,242,254,.95), 0 0 14px rgba(56,189,248,.9), 0 0 26px rgba(56,189,248,.55); }
      }
      .wf-tab-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
      .wf-panel-narrow .wf-tabs { margin: 6px 6px 4px; padding: 4px; gap: 3px; }
      .wf-panel-narrow .wf-tab { padding: 0 5px; gap: 4px; font-size: .78em; }
      .wf-tab-label-short { display: none; }
      .wf-panel-narrow .wf-tab-label-full { display: none; }
      .wf-panel-narrow .wf-tab-label-short { display: inline; }
      .wf-panel-narrow .wf-tab-count { font-size: .88em; opacity: .8; }
      .wf-panel-tiny .wf-tab { padding: 0 4px; gap: 3px; font-size: .72em; }
      .wf-panel-tiny .wf-tab-dot { width: 5px; height: 5px; }
      .wf-panel-narrow .wf-panel-tools { gap: 9px; }
      .wf-panel-narrow .wf-kbd-ctrl { padding: 0 8px; gap: 4px; }
      .wf-panel-tiny .wf-kbd-ctrl { display: none; }
      .wf-panel-narrow .wf-dragbar { padding: 0 8px; gap: 8px; }
      .wf-panel-narrow .wf-task-head { gap: 6px; }
      .wf-tabpanel { display: flex; flex-direction: column; }
      .wf-task-done .wf-task-head { opacity: .55; }
      .wf-task-done .wf-task-title { text-decoration: line-through; }
      .wf-task-done .wf-anchor-badge { opacity: .5; }
      .wf-task { border-bottom: 1px solid #26262e; }
      .wf-task-dragging { opacity: .5; background: rgba(127,127,127,.1); }
      .wf-task-drop-target { box-shadow: inset 0 2px 0 var(--dsw-alias-brand-primary, #7d92ff); }
      .wf-task:last-child { border-bottom: 0; }
      .wf-task-head { cursor: grab; display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 12px;
        border: 0; background: #1b1b21; color: #f4f4f5; font: inherit; text-align: left; cursor: grab;
        touch-action: pan-y; user-select: none; }
      .wf-task-head:hover { background: #26262d; }
      .wf-task-head.wf-task-head-drag { cursor: grabbing; }
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
      .wf-theme-light .wf-kbd { color: #262b34;
        background: linear-gradient(160deg, #fdfefe 0%, #eef1f7 58%, #e3e8f1 100%);
        border-color: #c6cdda;
        box-shadow:
          inset 1px 1px 0 #ffffff,
          inset -1px -1px 0 rgba(15,20,30,.12),
          0 2px 0 #b6becd,
          0 3px 5px rgba(16,24,40,.16);
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
      .wf-theme-light .wf-tab.wf-tab-fresh { animation-name: wf-tab-breathe-light; }
      .wf-theme-light .wf-tab.wf-tab-fresh .wf-tab-count {
        opacity: 1;
        color: #075985;
        background: none;
        text-shadow: 0 0 1px rgba(7,89,133,.95), 0 0 5px rgba(2,132,199,.7), 0 0 14px rgba(3,105,161,.45);
        animation-name: wf-count-glow-light;
      }
      @keyframes wf-count-glow-light {
        0% { color: #075985; text-shadow: 0 0 3px rgba(3,105,161,.5), 0 0 10px rgba(56,189,248,.35); }
        100% { color: #0c4a6e; text-shadow: 0 0 7px rgba(2,132,199,.85), 0 0 16px rgba(56,189,248,.65), 0 0 30px rgba(3,105,161,.4); }
      }
      @keyframes wf-tab-breathe-light {
        0%, 100% { transform: scale(1); background-color: rgba(3,105,161,.05); }
        50% { transform: scale(1.015); background-color: rgba(3,105,161,.14); }
      }
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


    // ---- context guard (merged from @local/context-guard) -----------------------
    const __contextGuard = (() => {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useSyncExternalStore } = React

    const WARN = 0.6
    const MID = 0.7
    const HIGH = 0.8
    const SWITCH = 0.85
    const REFRESH_MS = 20000

    const TEXT = {
      zh: {
        badgeTitle: '上下文管家：查看占用、连贯性与交接',
        cardTitle: '上下文健康度',
        refresh: '刷新',
        close: '关闭',
        loading: '读取中…',
        offline: '宿主路由未就绪：重启一次桌面客户端后生效。',
        unavailable: '会话不在当前进程内（可能来自别的窗口）。',
        noSession: '等待会话…',
        statusHealthy: '宽裕',
        statusTight: '偏紧',
        statusHigh: '偏高',
        statusCritical: '临界',
        adviceKeep: '上下文还很宽裕，继续本会话即可。',
        adviceTight: '还能继续，但建议找机会压缩一次，避免清空重来。',
        adviceMigrate: '建议交接后新开会话，别让下一轮重发整段历史。',
        adviceCritical: '上下文接近耗尽，请立刻交接并新开会话。',
        tokens: 'Token 占用',
        cache: '缓存命中',
        turns: '轮次',
        coherence: '任务连贯性',
        coherenceHigh: '高',
        coherenceMid: '中',
        coherenceLow: '低',
        coherenceHighHint: '多轮工具调用与文件改动交织，任务强连贯，换会话会丢上下文。',
        coherenceMidHint: '已有若干轮推进，仍可继续；交接时把关键决策写清楚。',
        coherenceLowHint: '对话还短或偏讨论，换会话成本低。',
        decideTitle: '决策方向',
        keepTitle: '这些情况下不切换',
        keepWhen: [
          '同一目标、同一处代码还在改，切换要重建现场。',
          '下一步要用到刚讨论过的细节，重新交代比继续更贵。',
          '验证还没收尾，结论还没落到代码或文档里。',
        ],
        newTitle: '这些情况下建议换',
        newWhen: [
          '任务已经收口，接着要开的是另一个主题。',
          '前面几轮主要是探索，结论已经写下来、不再依赖过程。',
          '同一个问题反复返工，越修越乱，说明上下文在干扰判断。',
        ],
        recKeep: '建议继续：占用还低，且任务强连贯，留在本会话最省信息。',
        recAfterCompress: '建议继续：刚压缩过，当前是「轻量连贯」状态，正好接着推进。',
        recEither: '两边都行：接近中段，建议先压缩一次，再决定是否换。',
        recNew: '建议新开：占用已高，先做交接再重开，比强行续命更稳。',
        migrateNow: '生成交接文档并新开会话',
        working: '正在生成交接文档…',
        handoffFail: '生成失败',
        copied: '已复制',
        handoffDone: '交接文档已写入',
        startNote: '新会话里说「读这个文件继续」即可；路径已复制。',
        estNote: '该会话暂无真实 usage，数字来自 DSH tokenMeter 的估算。',
        error: '读取失败',
      },
      en: {
        badgeTitle: 'Context guard: pressure, coherence and handoff',
        cardTitle: 'Context health',
        refresh: 'Refresh',
        close: 'Close',
        loading: 'Loading…',
        offline: 'Host routes are not loaded yet — restart the desktop client once.',
        unavailable: 'Session is not live in this process.',
        noSession: 'Waiting for a session…',
        statusHealthy: 'Plenty',
        statusTight: 'Tight',
        statusHigh: 'High',
        statusCritical: 'Critical',
        adviceKeep: 'There is plenty of room; keep this session going.',
        adviceTight: 'Still fine, but take the next chance to compact once.',
        adviceMigrate: 'Hand off and start a new session before the next turn resends everything.',
        adviceCritical: 'Almost exhausted — hand off and start a new session now.',
        tokens: 'Token usage',
        cache: 'Cache hit',
        turns: 'Turns',
        coherence: 'Task coherence',
        coherenceHigh: 'High',
        coherenceMid: 'Medium',
        coherenceLow: 'Low',
        coherenceHighHint: 'Many tool calls and file edits build on each other; a fresh session would lose that.',
        coherenceMidHint: 'Several rounds in; you can continue, but write the key decisions into the handoff.',
        coherenceLowHint: 'The conversation is still short or mostly discussion; switching is cheap.',
        decideTitle: 'Decision direction',
        keepTitle: 'Do not switch when',
        keepWhen: [
          'The same goal or the same code path is still being changed; switching means rebuilding the scene.',
          'The next step needs details discussed just now; re-explaining costs more than continuing.',
          'Verification is still open, and the outcome is not in code or docs yet.',
        ],
        newTitle: 'Switch when',
        newWhen: [
          'The task is closed and the next thing is a different topic.',
          'Earlier turns were mostly exploration whose conclusions are already written down.',
          'The same problem is being reworked in circles; the context is now part of the noise.',
        ],
        recKeep: 'Keep going: context is still light and the task is tightly coupled.',
        recAfterCompress: 'Keep going: a fresh compression made this light but coherent; continue here.',
        recEither: 'Either works: near the middle; compact once, then decide whether to switch.',
        recNew: 'Start a new session: occupancy is high; hand off first instead of stretching this one.',
        migrateNow: 'Build handoff and start a new session',
        working: 'Building the handoff…',
        handoffFail: 'Failed to build the handoff',
        copied: 'Copied',
        handoffDone: 'Handoff written',
        startNote: 'In the new session say "read this file and continue". Path copied.',
        estNote: 'No real usage yet; numbers come from the DSH tokenMeter estimate.',
        error: 'Read failed',
      },
    }

    function detectLanguage() {
      const raw = (typeof navigator !== 'undefined' && navigator.language) || 'zh'
      return String(raw).toLowerCase().startsWith('en') ? 'en' : 'zh'
    }
    let language = detectLanguage()
    function useLang() {
      return language
    }

    function t(lang, key) {
      const dict = TEXT[lang] || TEXT.zh
      return dict[key] || TEXT.zh[key] || key
    }

    // ---- shared state -----------------------------------------------------
    let state = { status: 'idle', sessionId: null, data: null, error: null }
    let simulated = null
    const stateListeners = new Set()
    function setState(patch) {
      state = { ...state, ...patch }
      for (const listener of stateListeners) listener()
    }
    function useStore(selector) {
      return useSyncExternalStore(
        (listener) => { stateListeners.add(listener); return () => stateListeners.delete(listener) },
        () => selector(state),
      )
    }

    // ---- card open state --------------------------------------------------
    let openState = false
    const openListeners = new Set()
    function setOpen(next) {
      const value = Boolean(next)
      if (value === openState) return
      openState = value
      for (const listener of openListeners) listener()
    }
    function useOpen() {
      return useSyncExternalStore(
        (listener) => { openListeners.add(listener); return () => openListeners.delete(listener) },
        () => openState,
      )
    }

    let toast = { text: '', at: 0 }
    const toastListeners = new Set()
    function showToast(text) {
      toast = { text, at: Date.now() }
      for (const listener of toastListeners) listener()
      setTimeout(() => { if (Date.now() - toast.at >= 1800) { toast = { text: '', at: 0 }; for (const listener of toastListeners) listener() } }, 2000)
    }
    function useToast() {
      return useSyncExternalStore(
        (listener) => { toastListeners.add(listener); return () => toastListeners.delete(listener) },
        () => toast.text,
      )
    }

    async function fetchJson(path, init) {
      const response = await fetch(path, { cache: 'no-store', ...init })
      let payload = null
      try { payload = await response.json() } catch { payload = null }
      if (!response.ok || !payload || payload.ok !== true) {
        const message = payload && payload.error ? payload.error.message : `HTTP ${response.status}`
        const code = payload && payload.error ? payload.error.code : 'http_error'
        const error = new Error(message)
        error.code = code
        throw error
      }
      return payload.value
    }

    let refreshTimer = null
    async function refresh(sessionId) {
      const target = sessionId || state.sessionId
      if (!target) return
      if (simulated) {
        setState({ status: 'ready', sessionId: target, data: simulated, error: null })
        notifyThreshold(simulated)
        return
      }
      try {
        const value = await fetchJson(`/context-guard/state?sessionId=${encodeURIComponent(target)}`)
        setState({ status: 'ready', sessionId: target, data: value, error: null })
        notifyThreshold(value)
      } catch (error) {
        const code = error && error.code ? error.code : 'http_error'
        const message = error instanceof Error ? error.message : String(error)
        const missingRoute = code === 'http_error' && /404|not found/i.test(message)
        setState({
          status: missingRoute ? 'offline' : code === 'session_not_live' ? 'offline-session' : 'error',
          sessionId: target,
          error: message,
        })
      }
    }

    const autoOpenedSessions = new Set()
    function autoOpenOnce(session) {
      if (!session || autoOpenedSessions.has(session)) return
      try {
        if (localStorage.getItem(`dsh.context-guard.autoOpened:${session}`) === '1') {
          autoOpenedSessions.add(session)
          return
        }
      } catch { /* ignore */ }
      autoOpenedSessions.add(session)
      try { localStorage.setItem(`dsh.context-guard.autoOpened:${session}`, '1') } catch { /* ignore */ }
      setOpen(true)
    }

    function notifyThreshold(value) {
      if (!value || !value.session) return
      const ratio = Number(value.ratio) || 0
      const key = `dsh.context-guard.notified:${value.session}`
      let notified = 0
      try { notified = Number(localStorage.getItem(key) || 0) } catch { notified = 0 }
      const level = ratio >= SWITCH ? 85 : ratio >= HIGH ? 80 : ratio >= MID ? 70 : ratio >= WARN ? 60 : 0
      if (level > notified) {
        try { localStorage.setItem(key, String(level)) } catch { /* ignore */ }
        if (level >= 70) {
          const text = level >= 85
            ? `上下文 ${(ratio * 100).toFixed(0)}%：红色警报，立刻生成交接并开新会话`
            : level >= 80
              ? `上下文 ${(ratio * 100).toFixed(0)}%：建议开新会话并迁移摘要`
              : `上下文 ${(ratio * 100).toFixed(0)}%：可再次压缩或继续`
          if (!openState) showToast(text)
          if (level >= 80) autoOpenOnce(value.session)
        }
      }
    }

    // dev-only: simulate a context ratio without waiting for a real session
    function simulate(input) {
      if (input === null || input === undefined) {
        simulated = null
        setState({ status: 'idle', data: null, error: null })
        return null
      }
      const ratio = Math.max(0, Math.min(1, Number(typeof input === 'number' ? input : input.ratio) || 0))
      const window = 128000
      const promptTokens = Math.round(window * ratio)
      const session = currentSessionId || state.sessionId || 'simulated'
      simulated = {
        session,
        model: 'deepseek-flash',
        provider: 'deepseek-account',
        contextWindow: window,
        promptTokens,
        ratio,
        estimated: true,
        cacheReadTokens: Math.round(promptTokens * 0.55),
        cacheWriteTokens: 0,
        cacheHitRate: 0.55,
        turns: 9,
        toolCalls: 7,
        files: ['client.js', 'index.js'],
        looksLikeDiscussion: false,
        thresholds: { warn: WARN, mid: MID, high: HIGH, switch: SWITCH },
      }
      try { localStorage.removeItem(`dsh.context-guard.notified:${session}`) } catch { /* ignore */ }
      setState({ status: 'ready', sessionId: session, data: simulated, error: null })
      notifyThreshold(simulated)
      return simulated
    }

    function usePolling(sessionId) {
      useEffect(() => {
        if (!sessionId) return undefined
        refresh(sessionId)
        const timer = setInterval(() => refresh(sessionId), REFRESH_MS)
        refreshTimer = timer
        return () => { clearInterval(timer); refreshTimer = null }
      }, [sessionId])
    }

    const asList = (value) => (Array.isArray(value) ? value : [value])

    function percent(ratio) {
      const value = Number(ratio) || 0
      return `${Math.max(0, Math.min(999, value * 100)).toFixed(0)}%`
    }
    function tone(ratio) {
      if (ratio >= SWITCH) return 'alarm'
      if (ratio >= HIGH) return 'danger'
      if (ratio >= MID) return 'hot'
      if (ratio >= WARN) return 'warn'
      return 'ok'
    }
    const TONE_COLOR = { ok: '#34d399', warn: '#fbbf24', hot: '#fb923c', danger: '#ef4444', alarm: '#ff2d55' }

    function compactTokens(value) {
      const n = Number(value) || 0
      if (n >= 1000000) return `${(n / 1000000).toFixed(2)}M`
      if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
      return String(Math.round(n))
    }

    // ---- current session id (published by an invisible header slot) ----
    let currentSessionId = ''
    const currentSessionListeners = new Set()
    function setCurrentSession(id) {
      const next = String(id || '')
      if (next === currentSessionId) return
      currentSessionId = next
      for (const listener of currentSessionListeners) listener()
    }
    function useCurrentSession() {
      return useSyncExternalStore(
        (listener) => { currentSessionListeners.add(listener); return () => currentSessionListeners.delete(listener) },
        () => currentSessionId,
      )
    }
    function SessionRecorder({ sessionId }) {
      useEffect(() => { if (sessionId) setCurrentSession(sessionId) }, [sessionId])
      return null
    }

    // ---- handoff + clipboard ---------------------------------------------
    async function buildHandoff(sessionId) {
      return fetchJson('/context-guard/handoff', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
    }

    async function copyText(text) {
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(text)
          return true
        }
      } catch { /* fall through */ }
      try {
        const area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        document.execCommand('copy')
        area.remove()
        return true
      } catch {
        return false
      }
    }

    let uiWorkspaceService = null

    // ---- task-panel chip / header badge ----------------------------------
    function Chip() {
      const lang = useLang()
      const sessionId = useCurrentSession()
      const open = useOpen()
      const ratio = useStore((s) => (s.data ? s.data.ratio : 0))
      const status = useStore((s) => s.status)
      const estimated = useStore((s) => Boolean(s.data && s.data.estimated))
      const error = useStore((s) => s.error)
      const sameSession = useStore((s) => String(s.sessionId || '') === String(currentSessionId || ''))
      usePolling(sessionId || null)
      const ready = status === 'ready' && sameSession
      const level = tone(ratio)
      const color = ready ? TONE_COLOR[level] : 'var(--dsw-alias-label-secondary, #8b8b96)'
      const label = ready ? `${estimated ? '≈' : ''}${percent(ratio)}` : status === 'loading' ? '…' : sameSession ? '—' : '…'
      return h('button', {
        type: 'button',
        className: `cg-chip${ready && level === 'alarm' ? ' cg-alarm' : ''}`,
        title: status === 'error' && error ? t(lang, 'badgeTitle') + ' · ' + error : t(lang, 'badgeTitle'),
        'aria-expanded': open,
        style: { color, borderColor: ready ? color : undefined },
        onClick: () => setOpen(!openState),
      }, h('span', { className: 'cg-chip-dot', style: { background: color } }), label)
    }

    function Badge({ sessionId }) {
      const lang = useLang()
      const open = useOpen()
      const ratio = useStore((s) => (s.data ? s.data.ratio : 0))
      const status = useStore((s) => s.status)
      const sameSession = useStore((s) => String(s.sessionId || '') === String(sessionId || ''))
      useEffect(() => { if (sessionId) setState({ sessionId: String(sessionId) }) }, [sessionId])
      usePolling(sessionId ? String(sessionId) : null)
      const ready = status === 'ready' && sameSession
      const color = ready ? TONE_COLOR[tone(ratio)] : 'var(--dsw-alias-label-secondary, #8b8b96)'
      const label = ready ? percent(ratio) : status === 'loading' ? '…' : sameSession ? '—' : '…'
      return h('button', {
        type: 'button',
        className: `cg-badge${ready && tone(ratio) === 'alarm' ? ' cg-alarm' : ''}`,
        title: t(lang, 'badgeTitle'),
        'aria-expanded': open,
        style: { borderColor: ready ? color : undefined, color: ready ? color : undefined },
        onClick: () => setOpen(!openState),
      }, h('span', { className: 'cg-badge-dot', style: { background: color } }), label)
    }

    // ---- the context card ------------------------------------------------
    function Card() {
      const lang = useLang()
      const open = useOpen()
      const data = useStore((s) => s.data)
      const status = useStore((s) => s.status)
      const error = useStore((s) => s.error)
      const sessionId = useStore((s) => s.sessionId) || currentSessionId
      const toastText = useToast()
      const cardRef = useRef(null)
      const [anchor, setAnchor] = useState(null)
      const [busy, setBusy] = useState(false)
      const [handoff, setHandoff] = useState(null)
      const [previousRatio] = useState(() => {
        try { return Number(localStorage.getItem(`dsh.context-guard.last:${currentSessionId}`) || 0) } catch { return 0 }
      })

      const ratio = data ? Number(data.ratio) || 0 : 0
      const used = Math.round(Math.max(0, Math.min(1, ratio)) * 100)
      const overflow = Boolean(data && (data.overflow || Number(data.rawRatio) > 1.02))
      const toneName = tone(ratio)
      const promptTokens = data ? Number(data.promptTokens) || 0 : 0
      const contextWindow = data ? Number(data.contextWindow) || 0 : 0
      const cacheHitRate = data ? Number(data.cacheHitRate) || 0 : 0
      const turns = data ? Number(data.turns) || 0 : 0
      const toolCalls = data ? Number(data.toolCalls) || 0 : 0
      const fileCount = data && Array.isArray(data.files) ? data.files.length : 0
      const looksLikeDiscussion = Boolean(data && data.looksLikeDiscussion)

      const statusKey = ratio >= SWITCH ? 'statusCritical' : ratio >= HIGH ? 'statusHigh' : ratio >= WARN ? 'statusTight' : 'statusHealthy'
      const adviceKey = ratio >= SWITCH ? 'adviceCritical' : ratio >= HIGH ? 'adviceMigrate' : ratio >= WARN ? 'adviceTight' : 'adviceKeep'

      const coherence = turns >= 8 && (toolCalls >= 5 || fileCount >= 2) ? 'high' : turns >= 3 ? 'mid' : 'low'
      const coherenceKey = coherence === 'high' ? 'coherenceHigh' : coherence === 'mid' ? 'coherenceMid' : 'coherenceLow'
      const coherenceColor = coherence === 'high' ? '#34d399' : coherence === 'mid' ? '#fbbf24' : '#8b8b96'

      const compressedRecently = previousRatio > 0 && ratio > 0 && ratio < previousRatio * 0.75
      const recommend = ratio >= SWITCH
        ? 'new'
        : compressedRecently
          ? 'keep'
          : ratio >= HIGH
            ? (looksLikeDiscussion ? 'new' : 'either')
            : 'keep'
      const recommendTextKey = recommend === 'new'
        ? 'recNew'
        : compressedRecently
          ? 'recAfterCompress'
          : recommend === 'either'
            ? 'recEither'
            : 'recKeep'

      useEffect(() => {
        if (!open) return undefined
        refresh(sessionId)
        return undefined
      }, [open, sessionId])

      useEffect(() => {
        try {
          if (sessionId) localStorage.setItem(`dsh.context-guard.last:${sessionId}`, String(ratio))
        } catch { /* ignore */ }
      }, [ratio, sessionId])

      useEffect(() => {
        if (!open) return undefined
        const place = () => {
          try {
            const panel = document.querySelector('.wf-panel') || document.querySelector('.wf-pill')
            if (panel) panel.classList.add('cg-panel-blurred')
            const card = cardRef.current
            if (!card) return
            if (!panel) { setAnchor(null); return }
            const rect = panel.getBoundingClientRect()
            const width = card.offsetWidth || 420
            const height = card.offsetHeight || 520
            const centerX = rect.left + rect.width / 2
            const centerY = rect.top + rect.height / 2
            const next = {
              left: Math.max(8, Math.min(Math.max(8, window.innerWidth - width - 8), centerX - width / 2)),
              top: Math.max(8, Math.min(Math.max(8, window.innerHeight - height - 8), centerY - height / 2)),
            }
            setAnchor((current) => (
              current && Math.abs(current.left - next.left) < 1 && Math.abs(current.top - next.top) < 1 ? current : next
            ))
          } catch { /* keep the default CSS position */ }
        }
        place()
        const veilTimer = setInterval(() => {
          try {
            const panel = document.querySelector('.wf-panel') || document.querySelector('.wf-pill')
            if (panel) panel.classList.add('cg-panel-blurred')
          } catch { /* ignore */ }
        }, 120)
        const timer = setInterval(place, 400)
        window.addEventListener('resize', place)
        return () => {
          clearInterval(veilTimer)
          clearInterval(timer)
          window.removeEventListener('resize', place)
          const panel = document.querySelector('.wf-panel, .wf-pill')
          if (panel) panel.classList.remove('cg-panel-blurred')
        }
      }, [open])

      useEffect(() => {
        if (!open) return undefined
        const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
        const onDown = (event) => {
          const card = cardRef.current
          if (card && !card.contains(event.target)) setOpen(false)
        }
        window.addEventListener('keydown', onKey)
        document.addEventListener('pointerdown', onDown, true)
        return () => {
          window.removeEventListener('keydown', onKey)
          document.removeEventListener('pointerdown', onDown, true)
        }
      }, [open])

      async function doMigrate() {
        if (busy || !sessionId) return
        setBusy(true)
        try {
          const result = await buildHandoff(String(sessionId))
          setHandoff(result || null)
          if (result && result.path) await copyText(result.path)
          if (result && result.markdown) await copyText(result.markdown)
          showToast(t(lang, 'handoffDone') + (result && result.path ? '：' + result.path : ''))
          if (uiWorkspaceService && typeof uiWorkspaceService.startSession === 'function') {
            uiWorkspaceService.startSession()
          }
        } catch (err) {
          showToast(`${t(lang, 'handoffFail')}：${err && err.message ? err.message : String(err)}`)
        } finally {
          setBusy(false)
        }
      }

      if (!open) return null

      const headline = status === 'offline'
        ? t(lang, 'offline')
        : status === 'offline-session'
          ? t(lang, 'unavailable')
          : status === 'error'
            ? `${t(lang, 'error')}${error ? '：' + error : ''}`
            : !sessionId
              ? t(lang, 'noSession')
              : null

      const statRow = (label, value) => h('div', { className: 'cg-stat' },
        h('span', { className: 'cg-stat-label' }, label),
        h('span', { className: 'cg-stat-value' }, value),
      )

      return h('div', { className: 'cg-mask', style: { pointerEvents: 'none' } },
        h('section', {
          className: 'cg-card',
          ref: cardRef,
          style: anchor ? { left: anchor.left, top: anchor.top, right: 'auto' } : undefined,
          'aria-label': t(lang, 'cardTitle'),
        },
        h('header', { className: 'cg-head' },
          h('span', { className: 'cg-title' }, t(lang, 'cardTitle')),
          h('button', { type: 'button', className: 'cg-icon', title: t(lang, 'refresh'), onClick: () => refresh(sessionId) }, '↻'),
          h('button', { type: 'button', className: 'cg-icon', title: t(lang, 'close'), onClick: () => setOpen(false) }, '✕'),
        ),
        headline ? h('p', { className: 'cg-note' }, headline) : null,
        h('div', { className: 'cg-health' },
          h('div', { className: 'cg-health-num', style: { color: TONE_COLOR[toneName] } },
            status === 'ready' ? (overflow ? '>100%' : `${used}%`) : '—'),
          h('div', { className: 'cg-health-meta' },
            h('span', { className: 'cg-health-status', style: { color: TONE_COLOR[toneName] } }, t(lang, statusKey)),
            h('span', { className: 'cg-health-cap' }, `${compactTokens(promptTokens)} / ${compactTokens(contextWindow)}`),
          ),
        ),
        h('div', { className: 'cg-bar' },
          h('div', { className: 'cg-bar-fill', style: { width: percent(Math.min(1, ratio)), background: TONE_COLOR[toneName] } }),
        ),
        h('p', { className: 'cg-advice' }, t(lang, adviceKey)),
        h('div', { className: 'cg-stats' },
          statRow(t(lang, 'tokens'), `${overflow ? '>100%' : percent(ratio)} · ${compactTokens(promptTokens)} / ${compactTokens(contextWindow)}`),
          statRow(t(lang, 'cache'), data && data.cacheReadTokens > 0 ? `${Math.round(cacheHitRate * 100)}%` : '—'),
          statRow(t(lang, 'turns'), `${turns}${toolCalls > 0 ? ' · ' + toolCalls + ' 次工具' : ''}`),
          statRow(t(lang, 'coherence'), h('span', { className: 'cg-coherence', style: { color: coherenceColor } }, t(lang, coherenceKey))),
        ),
        h('div', { className: 'cg-decide' },
          h('div', { className: 'cg-decide-title' }, t(lang, 'decideTitle')),
          h('div', { className: 'cg-decide-grid' },
            h('div', { className: 'cg-decide-card cg-decide-keep' },
              h('div', { className: 'cg-decide-head' }, t(lang, 'keepTitle')),
              h('ul', { className: 'cg-decide-list' },
                asList(t(lang, 'keepWhen')).map((line, index) => h('li', { key: 'keep-' + index, className: 'cg-pro' }, line)),
              ),
            ),
            h('div', { className: 'cg-decide-card cg-decide-new' },
              h('div', { className: 'cg-decide-head' }, t(lang, 'newTitle')),
              h('ul', { className: 'cg-decide-list' },
                asList(t(lang, 'newWhen')).map((line, index) => h('li', { key: 'new-' + index, className: 'cg-con' }, line)),
              ),
            ),
          ),
          h('div', { className: `cg-rec cg-rec-${recommend}` }, t(lang, recommendTextKey)),
        ),
        h('button', {
          type: 'button',
          className: `cg-migrate${recommend === 'new' ? ' cg-migrate-primary' : ''}`,
          disabled: busy || !sessionId,
          onClick: doMigrate,
        }, busy ? t(lang, 'working') : t(lang, 'migrateNow')),
        handoff && handoff.path ? h('div', { className: 'cg-path' }, h('code', null, handoff.path)) : null,
        data && data.estimated ? h('p', { className: 'cg-hint cg-dim' }, t(lang, 'estNote')) : null,
        toastText ? h('div', { className: 'cg-toast' }, toastText) : null,
        ),
      )
    }

    function Toast() {
      const text = useToast()
      if (!text) return null
      return h('div', { className: 'cg-toast-floating' }, text)
    }

    const STYLES = `
.cg-badge { display:inline-flex; align-items:center; gap:6px; height:26px; padding:0 9px; border-radius:7px; border:1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.35)); background:transparent; color:inherit; font:inherit; font-size:12px; line-height:1; font-variant-numeric:tabular-nums; cursor:pointer; }
.cg-badge-dot { width:7px; height:7px; border-radius:50%; display:inline-block; }
.cg-chip { display:inline-flex; align-items:center; gap:6px; height:30px; padding:0 9px; border-radius:7px; border:1px solid rgba(255,255,255,.14); background:linear-gradient(160deg, #333842 0%, #24272e 58%, #1d2027 100%); color:inherit; font:inherit; font-size:13px; line-height:1; font-variant-numeric:tabular-nums; cursor:pointer;
  box-shadow: inset 1px 1px 0 rgba(255,255,255,.22), inset -1px -1px 0 rgba(0,0,0,.4), 0 2px 0 #0b0d12, 0 3px 5px rgba(0,0,0,.32);
  transition: transform .08s ease, box-shadow .08s ease; }
.wf-theme-light .cg-chip { border-color:#c6cdda; background:linear-gradient(160deg, #fdfefe 0%, #eef1f7 58%, #e3e8f1 100%); color:#262b34;
  box-shadow: inset 1px 1px 0 #ffffff, inset -1px -1px 0 rgba(15,20,30,.12), 0 2px 0 #b6becd, 0 3px 5px rgba(16,24,40,.16); }
.cg-chip:active { transform: translateY(1px); box-shadow: inset 1px 1px 0 rgba(255,255,255,.16), inset -1px -1px 0 rgba(0,0,0,.38), 0 1px 0 #0b0d12, 0 2px 3px rgba(0,0,0,.28); }
.cg-chip-dot { width:7px; height:7px; border-radius:50%; display:inline-block; }
.cg-chip.cg-alarm, .cg-badge.cg-alarm { background: rgba(255,45,85,.14); animation: cg-alarm-pulse 1s ease-in-out infinite; }
@keyframes cg-alarm-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255,45,85,.55); opacity: 1; }
  50% { box-shadow: 0 0 0 7px rgba(255,45,85,0); opacity: .5; }
}
.cg-mask { position:fixed; inset:0; z-index:2147483200; pointer-events:none; }
.cg-mask > .cg-card { pointer-events:auto; }
.cg-card { position:absolute; top:64px; right:24px; width:420px; max-width:calc(100vw - 48px); max-height:calc(100vh - 48px); overflow:auto; padding:18px 20px 16px; border-radius:12px; border:1px solid rgba(96,165,250,.55); background:var(--dsw-alias-bg-layer-1, #17171b); color:var(--dsw-alias-label-primary, #f4f4f5); box-shadow: 0 0 0 1px rgba(96,165,250,.35), 0 0 18px rgba(96,165,250,.32), 0 0 44px rgba(255,255,255,.10), 0 24px 48px -16px rgba(0,0,0,.6), 0 8px 20px -8px rgba(0,0,0,.35); font-size:14px; }
.cg-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.cg-title { font-size:13px; font-weight:600; letter-spacing:.02em; flex:1 1 auto; }
.cg-icon { display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; border-radius:6px; border:1px solid transparent; background:transparent; color:inherit; font-size:14px; line-height:1; cursor:pointer; opacity:.7; }
.cg-icon:hover { opacity:1; background:rgba(255,255,255,.08); }
.cg-note { margin:10px 0 0; padding:8px 10px; border-radius:8px; border:1px solid rgba(251,191,36,.4); background:rgba(251,191,36,.08); color:#fbbf24; font-size:12px; line-height:1.6; }
.cg-health { display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin:14px 0 2px; }
.cg-health-num { font-size:40px; line-height:1; font-weight:700; font-variant-numeric:tabular-nums; letter-spacing:-.02em; }
.cg-health-meta { display:flex; flex-direction:column; align-items:flex-end; gap:3px; text-align:right; }
.cg-health-status { font-size:13px; font-weight:600; }
.cg-health-cap { font-size:11.5px; opacity:.6; font-variant-numeric:tabular-nums; }
.cg-bar { height:6px; border-radius:999px; background:rgba(255,255,255,.08); overflow:hidden; margin:10px 0 2px; }
.cg-bar-fill { height:100%; border-radius:inherit; transition: width .3s ease; }
.cg-advice { margin:12px 0 10px; line-height:1.7; font-size:13.5px; }
.cg-stats { display:flex; flex-direction:column; gap:6px; padding:10px 12px; border-radius:9px; background:rgba(255,255,255,.04); }
.cg-stat { display:flex; align-items:center; justify-content:space-between; gap:12px; font-size:12.5px; }
.cg-stat-label { opacity:.6; }
.cg-stat-value { font-variant-numeric:tabular-nums; text-align:right; }
.cg-coherence { font-weight:700; }
.cg-decide { margin-top:14px; padding-top:12px; border-top:1px solid rgba(255,255,255,.08); }
.cg-decide-title { font-size:12.5px; font-weight:600; margin-bottom:8px; opacity:.85; }
.cg-decide-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.cg-decide-card { padding:10px 11px; border-radius:9px; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.06); }
.cg-decide-head { font-size:12.5px; font-weight:600; margin-bottom:6px; }
.cg-decide-list { margin:0; padding:0; list-style:none; display:flex; flex-direction:column; gap:5px; font-size:11.5px; line-height:1.6; }
.cg-decide-list li { position:relative; padding-left:12px; opacity:.85; }
.cg-decide-list li::before { content:''; position:absolute; left:0; top:.62em; width:4px; height:4px; border-radius:50%; background:currentColor; opacity:.6; }
.cg-decide-list .cg-pro { color:#6ee7b7; }
.cg-decide-list .cg-con { color:#fbbf24; }
.cg-decide-keep .cg-decide-head { color:#6ee7b7; }
.cg-decide-new .cg-decide-head { color:#fbbf24; }
.cg-rec { margin-top:10px; padding:9px 11px; border-radius:9px; font-size:12.5px; line-height:1.6; border:1px solid rgba(255,255,255,.08); background:rgba(255,255,255,.04); }
.cg-rec-new { border-color:rgba(239,68,68,.45); background:rgba(239,68,68,.10); color:#fecaca; }
.cg-rec-keep { border-color:rgba(52,211,153,.40); background:rgba(52,211,153,.08); color:#a7f3d0; }
.cg-rec-either { border-color:rgba(251,191,36,.45); background:rgba(251,191,36,.08); color:#fde68a; }
.cg-migrate { width:100%; height:38px; margin:12px 0 4px; border-radius:9px; border:1px solid rgba(255,255,255,.16); background:rgba(255,255,255,.08); color:inherit; font-size:13.5px; font-weight:600; cursor:pointer; transition: background .16s ease, box-shadow .16s ease; }
.cg-migrate-primary { background:#f4f4f5; color:#0b0b0e; }
.cg-migrate:hover:not(:disabled) { box-shadow: 0 0 0 1px rgba(96,165,250,.5), 0 0 16px rgba(96,165,250,.28); }
.cg-migrate-primary:hover:not(:disabled) { background:#ffffff; }
.cg-migrate:disabled { opacity:.55; cursor:default; }
.cg-path { margin-top:6px; font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:11.5px; word-break:break-all; opacity:.85; }
.cg-hint { margin:8px 0 0; font-size:11.5px; }
.cg-dim { opacity:.6; }
.cg-toast { margin-top:8px; font-size:12px; line-height:1.5; opacity:.85; }
.cg-toast-floating { position:fixed; left:50%; bottom:48px; transform:translateX(-50%); z-index:2147483210; max-width:min(560px, calc(100vw - 48px)); padding:10px 14px; border-radius:9px; border:1px solid rgba(125,146,255,.35); background:#1b1b22; color:#f4f4f5; font-size:13px; line-height:1.5; box-shadow:0 12px 28px -10px rgba(0,0,0,.7); pointer-events:none; }
.wf-panel.cg-panel-blurred, .wf-pill.cg-panel-blurred { filter: blur(2.5px) saturate(.8) brightness(.86); opacity:.42; pointer-events:none; transition: filter .18s ease, opacity .18s ease; }
@media (prefers-reduced-motion: reduce) {
  .cg-chip.cg-alarm, .cg-badge.cg-alarm { animation: none; }
  .wf-panel.cg-panel-blurred, .wf-pill.cg-panel-blurred { transition: none; }
}
`

    function injectStyles() {
      if (typeof document === 'undefined') return () => {}
      const id = 'context-guard-styles'
      let element = document.getElementById(id)
      if (!element) {
        element = document.createElement('style')
        element.id = id
        element.setAttribute('data-plugin', 'dsh-context-guard')
        element.textContent = STYLES
        document.head.appendChild(element)
      }
      return () => {
        const current = document.getElementById(id)
        if (current) current.remove()
      }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const slots = ctx.slots || ctx.get('slots')
        if (!slots) return
        uiWorkspaceService = ctx.get('uiWorkspace') || null
        ctx.effect(() => injectStyles(), 'context-guard: styles')
        ctx.effect(() => {
          const off = slots.inject('conversation.session.header.utilities', () => slots.register({ name: 'conversation.session.header.utilities', id: 'context-guard-session', order: 25 }, SessionRecorder))
          return off
        }, 'context-guard: session recorder')
        ctx.effect(() => {
          let cancel = null
          let timer = null
          const attach = () => {
            const bridge = typeof window !== 'undefined' ? window.__dshWideFocus : null
            if (!bridge || typeof bridge.onSessionChange !== 'function') return
            if (timer) { clearInterval(timer); timer = null }
            if (typeof bridge.getSessionId === 'function') {
              const initial = bridge.getSessionId()
              if (initial) setCurrentSession(initial)
            }
            cancel = bridge.onSessionChange((id) => setCurrentSession(id))
          }
          attach()
          timer = setInterval(attach, 500)
          return () => {
            if (timer) clearInterval(timer)
            if (cancel) cancel()
          }
        }, 'context-guard: session from wide-focus bridge')
        ctx.effect(() => {
          let cancelTool = null
          let cancelBadge = null
          let attachedTo = null
          const attachTool = () => {
            const bridge = typeof window !== 'undefined' ? window.__dshWideFocus : null
            if (!bridge || typeof bridge.registerTool !== 'function') return
            if (attachedTo === bridge
              && typeof bridge.hasTool === 'function'
              && bridge.hasTool('context-guard')) return
            if (cancelTool) { try { cancelTool() } catch { /* ignore */ } cancelTool = null }
            attachedTo = bridge
            cancelTool = bridge.registerTool('context-guard', Chip)
            if (cancelBadge) { try { cancelBadge() } catch { /* ignore */ } cancelBadge = null }
          }
          attachTool()
          const timer = setInterval(attachTool, 1000)
          const fallback = setTimeout(() => {
            if (cancelTool || cancelBadge) return
            cancelBadge = slots.inject('conversation.session.header.utilities', () => slots.register({ name: 'conversation.session.header.utilities', id: 'context-guard-badge', order: 26 }, Badge))
          }, 2500)
          return () => {
            clearInterval(timer)
            clearTimeout(fallback)
            if (cancelTool) cancelTool()
            if (cancelBadge) cancelBadge()
          }
        }, 'context-guard: panel chip or header badge')
        ctx.effect(() => {
          const off = slots.inject('shell.overlay', () => slots.register({ name: 'shell.overlay', id: 'context-guard-card', order: 63, label: '上下文健康度' }, Card))
          return off
        }, 'context-guard: context card')
        ctx.effect(() => {
          const off = slots.inject('shell.overlay', () => slots.register({ name: 'shell.overlay', id: 'context-guard-toast', order: 64, label: '上下文提醒' }, Toast))
          return off
        }, 'context-guard: toast')
        try {
          window.__contextGuard = {
            version: '0.9.2',
            hasBridge: () => Boolean(window.__dshWideFocus),
            toolAttached: () => Boolean(window.__dshWideFocus && typeof window.__dshWideFocus.hasTool === 'function' && window.__dshWideFocus.hasTool('context-guard')),
            open: () => openState,
            toggle: (next) => setOpen(next === undefined ? !openState : next),
            simulate: (input) => simulate(input),
          }
        } catch { /* ignore */ }
      },
    }
    })()
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

        __contextGuard.apply(ctx)
      },
    }
  },
})
