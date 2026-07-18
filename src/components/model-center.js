// ── MODEL CENTER ──
// Independent model panel: provider tabs + model-select buttons + reasoning presets

import { showNotification } from './notifications.js';

let currentModel = '';
let currentThinkingLevel = null; // null = default (off)
let availableThinkingLevels = null; // [{id, label}, ...] from session, null = all base presets
let providerModels = {};
let providerOrder = [];
let onModelChange = null;

// Base presets shown when the session doesn't specify model-specific levels
const BASE_THINKING_PRESETS = [
  { id: 'off',      label: 'OFF' },
  { id: 'minimal',  label: 'MIN' },
  { id: 'low',      label: 'LOW' },
  { id: 'medium',   label: 'MED' },
  { id: 'high',     label: 'HIGH' },
  { id: 'xhigh',    label: 'X-HI' },
  { id: 'adaptive', label: 'ADAPT' },
  { id: 'max',      label: 'MAX' },
  { id: 'ultra',    label: 'ULTRA' },
];

export function getCurrentModel() { return currentModel; }
export function getCurrentThinkingLevel() { return currentThinkingLevel; }

export function setCallbacks({ onModel }) {
  onModelChange = onModel;
}

export function initModelCenter() {
  wireTabSwitching();
  fetchStatus().then(() => {
    refreshModels();
    renderReasoningSection();
  });
}

// ── Tab switching ──
function wireTabSwitching() {
  const panel = document.querySelector('.model-center');
  if (!panel) return;
  panel.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn-r');
    if (!btn) return;
    panel.querySelectorAll('.tab-btn-r').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const id = btn.dataset.rtab;
    panel.querySelectorAll('.rtab-content').forEach(c => c.classList.remove('active'));
    const target = document.getElementById('rtab-' + id);
    if (target) target.classList.add('active');
  });
}

// ── Fetch current session status (model + thinking) ──
async function fetchStatus() {
  try {
    const res = await fetch('/api/models/status');
    if (!res.ok) return;
    const data = await res.json();
    if (data.available) {
      currentModel = data.model || '';
      currentThinkingLevel = data.thinkingLevel || null;
      availableThinkingLevels = data.thinkingLevels || null;
    }
  } catch (err) {
    console.error('[MODEL CENTER] status fetch error:', err);
  }
}

// ── Determine which presets are available ──
function getEffectivePresets() {
  if (availableThinkingLevels && Array.isArray(availableThinkingLevels) && availableThinkingLevels.length > 0) {
    return availableThinkingLevels; // [{id, label}] from session
  }
  return BASE_THINKING_PRESETS;
}

function isPresetAvailable(id) {
  if (!availableThinkingLevels || !Array.isArray(availableThinkingLevels) || availableThinkingLevels.length === 0) {
    return true; // All base presets available
  }
  return availableThinkingLevels.some(p => p.id === id);
}

// ── Load models from backend ──
async function refreshModels() {
  try {
    const res = await fetch('/api/models');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const models = data.models || [];
    if (models.length) {
      groupByProvider(models);
      renderPanel();
      return;
    }
  } catch (err) {
    console.error('[MODEL CENTER] fetch error:', err);
  }
  groupByProvider(fallbackModels());
  renderPanel();
}

// ── Group by provider ──
function groupByProvider(models) {
  providerModels = {};
  providerOrder = [];
  for (const m of models) {
    const p = m.provider || 'unknown';
    if (!providerModels[p]) {
      providerModels[p] = [];
      providerOrder.push(p);
    }
    providerModels[p].push(m);
  }
}

// ── Render model list ──
function renderPanel() {
  const tabBar = document.querySelector('.model-center .tab-bar');
  const tabContent = document.querySelector('.model-center .panel-tabs-content');
  if (!tabBar || !tabContent) return;

  // Preserve active tab before re-render
  const activeTabId = tabBar.querySelector('.tab-btn-r.active')?.dataset?.rtab || null;

  tabBar.innerHTML = '';
  tabContent.innerHTML = '';

  if (!providerOrder.length) {
    tabContent.innerHTML = '<div class="mc-empty">NO MODELS AVAILABLE</div>';
    return;
  }

  providerOrder.forEach((provider, i) => {
    const tabId = 'mc-' + provider;
    const isActive = activeTabId === tabId || (!activeTabId && i === 0);
    const btn = document.createElement('button');
    btn.className = 'tab-btn-r' + (isActive ? ' active' : '');
    btn.dataset.rtab = tabId;
    btn.textContent = provider.toUpperCase();
    tabBar.appendChild(btn);

    const content = document.createElement('div');
    content.className = 'rtab-content' + (isActive ? ' active' : '');
    content.id = 'rtab-' + tabId;

    const list = document.createElement('div');
    list.className = 'mc-model-list';

    for (const model of (providerModels[provider] || [])) {
      const isActive = model.id === currentModel;
      const opt = document.createElement('button');
      opt.className = 'mc-model-opt' + (isActive ? ' mc-model-opt--active' : '');
      opt.dataset.modelId = model.id;

      const title = document.createElement('span');
      title.className = 'mc-model-opt-title';
      title.textContent = model.name || model.id.split('/').pop() || model.id;

      const sub = document.createElement('span');
      sub.className = 'mc-model-opt-provider';
      const ctx = model.contextWindow ? formatCtx(model.contextWindow) : '';
      sub.textContent = ctx || provider;

      if (isActive) {
        const check = document.createElement('span');
        check.className = 'mc-model-opt-check';
        check.textContent = '✓';
        opt.appendChild(check);
      }

      opt.appendChild(title);
      opt.appendChild(sub);

      opt.addEventListener('click', () => {
        if (model.id !== currentModel) applyModel(model);
      });

      list.appendChild(opt);
    }

    content.appendChild(list);
    tabContent.appendChild(content);
  });
}

function formatCtx(ctx) {
  if (ctx >= 1000000) return (ctx / 1000).toFixed(0) + 'K';
  if (ctx >= 1000) return Math.round(ctx / 1000) + 'K';
  return String(ctx);
}

// ── Apply model (calls gateway) ──
async function applyModel(model) {
  const prev = currentModel;
  currentModel = model.id;
  renderPanel(); // optimistic

  try {
    const res = await fetch('/api/models/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model.id }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'HTTP ' + res.status);
    }
    showNotification('MODEL: ' + (model.name || model.id));
    if (onModelChange) onModelChange(model.id);
    window.dispatchEvent(new CustomEvent('model-changed', { detail: { model: model.id } }));

    // Refresh status to get updated thinkingLevels for the new model
    await fetchStatus();
    renderReasoningSection();
  } catch (err) {
    console.error('[MODEL CENTER] switch failed:', err);
    currentModel = prev; // rollback
    renderPanel();
    showNotification('Model switch failed!');
  }
}

// ── Thinking (reasoning) preset buttons ──
function renderReasoningSection() {
  const panel = document.querySelector('.model-center');
  if (!panel) return;

  const existing = panel.querySelector('.mc-reasoning');
  if (existing) existing.remove();

  const presets = getEffectivePresets();

  const section = document.createElement('div');
  section.className = 'mc-reasoning';

  // Header label
  const header = document.createElement('div');
  header.className = 'mc-reasoning-header';

  const label = document.createElement('span');
  label.className = 'mc-reasoning-label';
  label.textContent = 'REASONING';

  const resetBtn = document.createElement('button');
  resetBtn.className = 'mc-reasoning-reset';
  resetBtn.textContent = '↺';
  resetBtn.title = 'Reset to default';
  resetBtn.addEventListener('click', () => applyThinkingLevel(null));

  header.appendChild(label);
  header.appendChild(resetBtn);

  // Preset buttons row
  const row = document.createElement('div');
  row.className = 'mc-reasoning-row';

  for (const preset of presets) {
    const isAvailable = isPresetAvailable(preset.id);
    const isActive = currentThinkingLevel === preset.id;

    const btn = document.createElement('button');
    btn.className = 'mc-reasoning-btn' +
      (isActive ? ' mc-reasoning-btn--active' : '') +
      (!isAvailable ? ' mc-reasoning-btn--unavailable' : '');
    btn.dataset.level = preset.id;
    btn.textContent = preset.label || preset.id.toUpperCase();
    btn.disabled = !isAvailable;

    if (isAvailable) {
      btn.addEventListener('click', () => {
        if (currentThinkingLevel !== preset.id) applyThinkingLevel(preset.id);
      });
    }

    row.appendChild(btn);
  }

  section.appendChild(header);
  section.appendChild(row);
  panel.appendChild(section);
}

async function applyThinkingLevel(levelId) {
  const prev = currentThinkingLevel;
  currentThinkingLevel = levelId;
  renderReasoningSection(); // optimistic update

  try {
    const res = await fetch('/api/models/reasoning', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thinkingLevel: levelId }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    showNotification('REASONING: ' + (levelId || 'DEFAULT'));
  } catch (err) {
    console.error('[MODEL CENTER] reasoning set failed:', err);
    currentThinkingLevel = prev; // rollback
    renderReasoningSection();
    showNotification('Reasoning set failed!');
  }
}

// ── Fallback models ──
function fallbackModels() {
  const cfg = window.SYNTH_CONFIG && window.SYNTH_CONFIG.agent && window.SYNTH_CONFIG.agent.model;
  const models = [];
  if (cfg && cfg.primary) {
    const p = cfg.primary.split('/')[0] || 'unknown';
    models.push({ id: cfg.primary, name: cfg.primary.split('/').pop(), provider: p, contextWindow: 0 });
  }
  if (cfg && Array.isArray(cfg.fallbacks)) {
    for (const id of cfg.fallbacks) {
      const p = id.split('/')[0] || 'unknown';
      models.push({ id, name: id.split('/').pop(), provider: p, contextWindow: 0 });
    }
  }
  if (!models.length) {
    models.push(
      { id: 'ollama/gemma4:12b-it-q4_K_M', name: 'gemma4:12b', provider: 'ollama', contextWindow: 262144 },
      { id: 'opencode/deepseek-v4-flash-free', name: 'deepseek-v4-flash', provider: 'opencode', contextWindow: 128000 },
      { id: 'opencode/nemotron-3-ultra-free', name: 'nemotron-3-ultra', provider: 'opencode', contextWindow: 128000 },
    );
  }
  return models;
}
