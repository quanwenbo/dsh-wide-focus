import fs from 'node:fs'

let s = fs.readFileSync('client.js', 'utf8')

function replaceOnce(from, to) {
  const at = s.indexOf(from)
  if (at < 0) throw new Error('missing: ' + from.slice(0, 70))
  if (s.indexOf(from, at + 1) >= 0) throw new Error('duplicate: ' + from.slice(0, 70))
  s = s.slice(0, at) + to + s.slice(at + from.length)
}

// Dragging onto a tab is now the quick way to change status, so the 已验收 tab
// accepts a drop (= accept) and a task can also be dragged back out of it.
replaceOnce(
  `    function moveTaskTo(targetStatus, draggedId, targetId, placeAfter) {
      if (targetStatus === 'done') return
      const next = moveTaskInList(readLocalTasks(), targetStatus, draggedId, targetId, placeAfter)`,
  `    function moveTaskTo(targetStatus, draggedId, targetId, placeAfter) {
      const next = moveTaskInList(readLocalTasks(), targetStatus, draggedId, targetId, placeAfter)`,
)

fs.writeFileSync('client.js', s)
console.log('done-tab drop enabled')
