# dsh-wide-focus · 宽屏 + 悬浮任务面板

Two things for the DSH desktop client, both local and dependency-free:

1. **Wide reading mode** — the chat column stops at `100% - 40px` instead of a
   narrow reading measure, so long answers and back-and-forth stay on screen.
2. **Floating task panel** — a small todo board that lives above the
   conversation. Drag it anywhere, collapse it to a pill, resize it from either
   bottom corner, and press `R` to bring it back when the chat buries it.

Everything is stored on this machine; the plugin makes no network calls of its
own (the panel talks to its own host route, see *Storage* below).

## Install

```powershell
# 1) 从 AtomGit（公开仓库，固定 commit）
dsh plugin --profile desktop add git+https://atomgit.com/17725785770/dsh-wide-focus.git#<commit-sha>

# 2) 从本地目录（开发时）
dsh plugin --profile desktop add C:\Users\BOB\dsh-plugins\wide-focus
```

The client half hot-reloads on refresh. The host half (`index.js`) registers
`/wide-focus/tasks`, so it takes one desktop restart the first time (or after
editing `index.js`).

本插件不依赖任何 npm 运行时包：`client.js` 是预构建 ESM，`index.js` 是普通 ESM，
`cordis.patch.yml` 在包根目录，因此从 git 或 tgz 安装都不需要构建步骤。
`jsdom / react / react-dom` 只用于测试脚本，放在 `devDependencies` 里。

## Wide mode

- `html[data-dsh-wide-focus]` overrides `--dsh-chat-user-width` with
  `calc(100% - 40px) !important`.
- The host rewrites the inline `--dsh-conversation-column-width` variable on
  every resize, so the plugin re-writes it on those nodes every 400 ms while
  wide mode is on.
- `[data-width-handle]` is hidden — the column is not meant to be resized back
  by accident; toggle wide mode instead.
- Toggle: the **宽屏 / 标准** button in the session header
  (`conversation.session.header.utilities`, id `wide-focus-toggle`, order 30).
  Default is on; the choice persists in `dsh.wide-focus.enabled`.

## Task panel

- Slot `shell.overlay`, id `wide-focus-task-panel`, order 60.
- Header (one 78 px bar): a left tool row of four equal-height (36 px) stops —
  `R` keycap, `Ctrl` + wheel keycap, the theme button, then the context-guard
  chip when that plugin is loaded — and, at the far right, the two small
  labels “点击折叠” / “自由拖拽”.
- Drag anywhere on the bar to move it; the panel is clamped to the viewport.
- Collapse → pill; click the pill (or press `R`) to expand again.
- Double-click the bar restores the default size and position.
- Resize from either bottom corner (▼ right / left).
- Font size: `Ctrl` + wheel over the panel, or `Ctrl` + `=` / `Ctrl` + `-`.
  There are no on-screen `+` / `−` buttons.

### Tabs

Four tabs, in this order: **待验收 / 进行中 / 暂时搁置 / 已验收**.

- One tab is rendered at a time; the tab strip is pinned above the list and
  does not scroll with it.
- Each tab shows a status dot, its label and the number of tasks inside.
- Switch categories with the status buttons inside an expanded task
  (完成 / 进行中 / 暂时搁置 / 撤销验收), or drag the row handle `≡` onto another
  tab: the tab highlights and the task moves to the end of it. The panel stays
  on the tab you were reading; for two seconds the target tab breathes
  slightly and its count glows and blinks its halo (both themes)
  so you can tell new content landed in it.
- Dragging has motion feedback: the grabbed row dims, a floating copy of its
  title follows the pointer, the tab or row under the pointer highlights, and
  after a drop the row flashes, the receiving tab bumps, and a short
  「已移到「…」」 pill confirms the move.
- Hovering a tab shrinks the floating copy to 80% of that tab's width and snaps
  it onto the tab; dropping there plays a short “pass-through” flash on the tab
  (scale + ring glow) as the task lands inside.
- Releasing anywhere shrinks the floating copy into the drop point (180 ms)
  before it disappears, so the drop reads as “put in” rather than “vanish”.
- With a mouse a row starts dragging on the first movement of its header (touch
  keeps a 260 ms long-press so the list can still scroll); rows inside one tab
  reorder freely and the numbers renumber 1..n after every drop.
- While a row is dragged inside its tab a dashed “放到这里” slot opens at the
  insertion point and the list makes room for it, so the drop position is
  visible before releasing; the hit test is geometry based, so releasing in the
  gap between two rows still lands where the slot shows.
- Dragging inside the active tab reorders rows; dropping on the active tab
  itself is a no-op. Dropping on **已验收** accepts the task, and dragging a
  task out of 已验收 reopens it.
- The active tab persists in `dsh.wide-focus.activeTab`.
- An empty tab says “这个分类暂时没有任务。” — the strip never collapses on
  its own.

### Rows

- First line is the task title; the rest of the captured text (or the typed
  description) is the body, rendered with its original paragraphs and inline
  formatting (sanitized HTML — p, strong, em, code, pre, lists, blockquote,
  links, br).
- Click the body to edit it in place (textarea, 2 rows by default, grows up to
  360 px). Empty bodies stay as a clickable blank area; there is no
  placeholder text.
- Right-click any selection in the conversation → “加入待办”; the selection
  becomes a task with its title on the first line.
- “＋ 添加待办” sits as the first row of the list; type and press `Enter`
  (multi-line, `Shift` + `Enter` for a newline).
- Adding a task expands the panel, jumps to 进行中, scrolls to the new row and
  shows a short “已添加：…” toast (skipped for duplicates).

### Theme

The panel owns its palette; it never follows the host theme.

- One 45 × 36 button in the left tool row (third stop, after `R` and
  `Ctrl` + wheel), no border and no background until hover, with transparent
  corners: a round taiji (☯) inside — light field, dark half, two opposite
  seeds. Clicking it switches the panel between dark and light; the disc
  rotates 180° as feedback, and the choice persists in
  `dsh.wide-focus.panelTheme`.
- Dark palette runs `#17171b` shell → `#0b0b0e` title band → `#1c2f4f` body;
  the light palette is `#ffffff` shell → `#18181b` title band → `#2563eb` body.
  Status colours: 暂时搁置 `#9a9aa5`, 进行中 `#60a5fa`, 待验收 `#fbbf24`,
  已验收 `#6b7280`.

## Storage

- Tasks live in **one** place: `$DSH_PROFILE_DIR/wide-focus/tasks.json`
  (falls back to `$DSH_HOME/...`, then `~/.dsh/wide-focus/tasks.json`).
- The host half exposes `GET /wide-focus/tasks` and `PUT /wide-focus/tasks`
  (atomic `tmp` + rename). The client keeps no IndexedDB or localStorage copy;
  it loads on start, debounces saves (400 ms) and flushes with `sendBeacon` on
  `pagehide` / `beforeunload`.
- A panel that cannot reach the host shows a small “…” note; click it to retry.
- UI preferences stay in localStorage: `enabled`, `activeTab`, `panelCollapsed`,
  `panelPos`, `panelSize`, `fontSize`, `panelTheme`.

## Extension point

Other desktop plugins can pin a compact control into the panel head:

```js
const bridge = window.__dshWideFocus
if (bridge) {
  const dispose = bridge.registerTool('my-plugin', MyChip) // returns dispose()
  bridge.hasTool('my-plugin') // true once registered
  bridge.getSessionId() // current session id, or null
  bridge.onSessionChange((id) => {}) // returns unsubscribe
  bridge.toolCount()
}
```

The bridge waits up to a few seconds for the host plugin to load; a control
registered after that falls back to the session header, which the plugin
removes once the chip is attached.

## Verified with

```powershell
node --check client.js
node render.mjs       # renders the real components with a fake React
node smoke.mjs        # slot / effect registration
node --test tests.mjs # pure helpers (splitTaskText, moveTaskInList, ...)
```

`render.mjs` also checks that Chinese is used when `navigator.language` is
`zh-*` and that the four tab labels are present.

## Known limits

- The wide column is re-asserted every 400 ms while enabled; there is no
  ResizeObserver hook into the host.
- Dragging is pointer-based and needs a mouse or pen; there is no keyboard
  reordering.
- Deleting a task is a two-step confirm, with no undo.
- Task numbers are the visible row order inside the current tab (1..n) and are
  recomputed on every change: drag, status move, accept, new task.

## License

MIT © 2026 BOB
