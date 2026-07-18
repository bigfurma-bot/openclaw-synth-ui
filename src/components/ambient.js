// ── Ambient Mode Toggle ──

let ambientMode = false;

export function initAmbientToggle() {
  const btn = document.getElementById('ambient-toggle');
  if (!btn) return;

  btn.addEventListener('click', () => {
    ambientMode = !ambientMode;
    // Apply transition only during toggle so dragging isn't affected
    document.body.classList.add('ambient-transition');
    document.body.classList.toggle('ambient-mode', ambientMode);
    btn.classList.toggle('active', ambientMode);
    // Remove transition class after animation completes
    setTimeout(() => {
      document.body.classList.remove('ambient-transition');
    }, 450);
  });
}

export function isAmbientMode() {
  return ambientMode;
}
