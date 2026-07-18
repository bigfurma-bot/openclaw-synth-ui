// ── 通知系統 ──

const notification = document.getElementById('notification');
const notifHistory = [];
const MAX_HISTORY = 50;

let panelVisible = false;

export function showNotification(message, type = 'info') {
  // Toast
  if (notification) {
    notification.textContent = message;
    notification.style.opacity = 1;
    setTimeout(() => {
      notification.style.opacity = 0;
    }, 3000);
  }

  // History
  notifHistory.unshift({
    message,
    time: new Date(),
    type,
  });
  if (notifHistory.length > MAX_HISTORY) notifHistory.pop();

  updateBell();
  renderList();
}

function updateBell() {
  const bell = document.getElementById('notif-bell');
  if (!bell) return;
  // Only show bell for important (error) notifications
  const hasErrors = notifHistory.some(n => n.type === 'error');
  if (hasErrors) {
    bell.classList.add('has-new');
  }
}

function renderList() {
  const list = document.getElementById('notif-list');
  if (!list || !panelVisible) return;
  list.innerHTML = notifHistory.map(n => {
    const t = n.time;
    const timeStr = `${t.getHours().toString().padStart(2, '0')}:${t.getMinutes().toString().padStart(2, '0')}:${t.getSeconds().toString().padStart(2, '0')}`;
    return `<div class="notif-item ${n.type}"><span class="notif-time">${timeStr}</span>${n.message}</div>`;
  }).join('');
  if (notifHistory.length === 0) {
    list.innerHTML = '<div class="notif-item" style="opacity:0.4">No notifications yet</div>';
  }
}

function togglePanel() {
  const panel = document.getElementById('notif-panel');
  if (!panel) return;
  panelVisible = !panelVisible;
  panel.style.display = panelVisible ? 'block' : 'none';
  const bell = document.getElementById('notif-bell');
  if (bell) bell.classList.remove('has-new');
  if (panelVisible) renderList();
}

// Close panel on click outside
document.addEventListener('click', (e) => {
  if (!panelVisible) return;
  const panel = document.getElementById('notif-panel');
  const bell = document.getElementById('notif-bell');
  if (!panel || !bell) return;
  if (!panel.contains(e.target) && !bell.contains(e.target)) {
    panelVisible = false;
    panel.style.display = 'none';
  }
});

// Init bell click
document.addEventListener('DOMContentLoaded', () => {
  const bell = document.getElementById('notif-bell');
  if (bell) bell.addEventListener('click', togglePanel);
});
