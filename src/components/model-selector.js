// ── MODEL SELECTOR 面板 ──
// 選擇 LLM 模型和推理等級

import { showNotification } from './notifications.js';
import { gwRequest } from '../server/gateway.js';

let currentModel = '';
let currentReasoning = 'auto';
let availableModels = [];
let onModelChange = null;
let onReasoningChange = null;

export function getCurrentModel() { return currentModel; }
export function getCurrentReasoning() { return currentReasoning; }

export function setCallbacks({ onModel, onReasoning }) {
  onModelChange = onModel;
  onReasoningChange = onReasoning;
}

export function initModelSelector() {
  // 初始化 UI 元素
  const modelSelect = document.getElementById('model-select');
  const reasoningSelect = document.getElementById('reasoning-select');
  const refreshBtn = document.getElementById('refresh-models-btn');
  const applyBtn = document.getElementById('apply-model-btn');
  const currentModelDisplay = document.getElementById('current-model-display');
  const currentReasoningDisplay = document.getElementById('current-reasoning-display');
  
  if (!modelSelect || !reasoningSelect || !refreshBtn || !applyBtn || !currentModelDisplay || !currentReasoningDisplay) return;

  // 填充模型選擇器
  populateModelSelect(modelSelect);
  
  // 填充推理等級選擇器
  populateReasoningSelect(reasoningSelect);
  
  // 初始狀態顯示
  updateStatusDisplay();
  
  // 事件監聽器
  modelSelect?.addEventListener('change', function () {
    const value = this.value;
    currentModel = value;
    updateStatusDisplay();
  });

  reasoningSelect?.addEventListener('change', function () {
    const value = this.value;
    currentReasoning = value;
    updateStatusDisplay();
  });

  refreshBtn?.addEventListener('click', async () => {
    await refreshModelList();
    showNotification('MODELS REFRESHED');
  });

  // 應用按鈕事件
  applyBtn?.addEventListener('click', () => {
    if (onModelChange) onModelChange(currentModel);
    if (onReasoningChange) onReasoningChange(currentReasoning);
    showNotification(`MODEL APPLIED: ${currentModel.split('/').pop()}:${currentReasoning.toUpperCase()}`);
    
    // 通知其他組件模型和推理等級已更改
    window.dispatchEvent(new CustomEvent('model-changed', { detail: { model: currentModel } }));
    window.dispatchEvent(new CustomEvent('reasoning-changed', { detail: { reasoning: currentReasoning } }));
  });

  // 初始載入模型列表
  refreshModelList();
}

// 載入可用模型列表
async function refreshModelList() {
  try {
    // 嘗試從 gateway 獲取可用模型
    const result = await gwRequest('models.list', {});
    if (result && Array.isArray(result.models)) {
      availableModels = result.models;
    } else {
      // 後備：從配置中讀取備用模型
      availableModels = getFallbackModels();
    }
  } catch (err) {
    console.error('[MODEL SELECTOR] Failed to fetch models:', err);
    // 後備：使用配置中的模型
    availableModels = getFallbackModels();
  }
  
  // 更新 UI
  const modelSelect = document.getElementById('model-select');
  if (modelSelect) {
    populateModelSelect(modelSelect);
  }
}

// 從配置獲取備用模型列表
function getFallbackModels() {
  // 從全局配置獲取模型信息
  const config = window.SYNTH_CONFIG || {};
  const agent = config.agent || {};
  const modelConfig = agent.model || {};
  
  const models = [];
  
  // 主模模型
  if (modelConfig.primary) {
    models.push({
      id: modelConfig.primary,
      name: modelConfig.primary.split('/').pop(), // 取得最後一段作為名稱
      provider: modelConfig.primary.split('/')[0] || 'unknown'
    });
  }
  
  // 備用模型
  if (Array.isArray(modelConfig.fallbacks)) {
    modelConfig.fallbacks.forEach(model => {
      models.push({
        id: model,
        name: model.split('/').pop(),
        provider: model.split('/')[0] || 'unknown'
      });
    });
  }
  
  // 如果沒有找到任何模型，提供一些常見的備用選項
  if (models.length === 0) {
    models.push(
      { id: 'ollama/gemma4:12b-it-q4_K_M', name: 'gemma4:12b', provider: 'ollama' },
      { id: 'opencode/deepseek-v4-flash-free', name: 'deepseek-v4-flash', provider: 'opencode' },
      { id: 'opencode/nemotron-3-ultra-free', name: 'nemotron-3-ultra', provider: 'opencode' }
    );
  }
  
  return models;
}

// 填充模型選擇器
function populateModelSelect(selectElement) {
  // 清除現有選項
  selectElement.innerHTML = '';
  
  // 添加選項
  availableModels.forEach(model => {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = `${model.name} (${model.provider})`;
    if (model.id === currentModel) {
      option.selected = true;
    }
    selectElement.appendChild(option);
  });
  
  // 如果沒有匹配的當前模型，選擇第一個
  if (!currentModel && availableModels.length > 0) {
    selectElement.value = availableModels[0].id;
    currentModel = availableModels[0].id;
  }
}

// 填充推理等級選擇器
function populateReasoningSelect(selectElement) {
  // 清除現有選項
  selectElement.innerHTML = '';
  
  // 推理等級選項
  const reasoningLevels = [
    { value: 'auto', label: 'AUTO' },
    { value: 'off', label: 'OFF' },
    { value: 'low', label: 'LOW' },
    { value: 'medium', label: 'MEDIUM' },
    { value: 'high', label: 'HIGH' }
  ];
  
  reasoningLevels.forEach(level => {
    const option = document.createElement('option');
    option.value = level.value;
    option.textContent = level.label;
    if (level.value === currentReasoning) {
      option.selected = true;
    }
    selectElement.appendChild(option);
  });
}

// 更新狀態顯示
function updateStatusDisplay() {
  const modelDisplay = document.getElementById('current-model-display');
  const reasoningDisplay = document.getElementById('current-reasoning-display');
  
  if (modelDisplay) {
    const modelName = currentModel ? currentModel.split('/').pop().split(':')[0] : '--';
    modelDisplay.textContent = modelName;
  }
  
  if (reasoningDisplay) {
    reasoningDisplay.textContent = currentReasoning ? currentReasoning.toUpperCase() : '--';
  }
}
