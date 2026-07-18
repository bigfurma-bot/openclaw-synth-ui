// ── Models Routes: /api/models ──
// Proxies to gateway: model list, model switch, thinking level control

import { Router } from 'express';
import { gwRequest } from '../gateway.js';

const router = Router();

// GET /api/models — list available models from gateway
router.get('/models', async (req, res) => {
  try {
    const view = req.query.view || 'default';
    const result = await gwRequest('models.list', { view });
    res.json(result);
  } catch (err) {
    console.error('[MODELS] gateway error:', err.message);
    res.json({
      models: [
        { id: 'ollama/gemma4:12b-it-q4_K_M', name: 'gemma4:12b', provider: 'ollama' },
        { id: 'opencode/deepseek-v4-flash-free', name: 'deepseek-v4-flash', provider: 'opencode' },
        { id: 'opencode/nemotron-3-ultra-free', name: 'nemotron-3-ultra', provider: 'opencode' },
        { id: 'opencode/big-pickle', name: 'big-pickle', provider: 'opencode' },
        { id: 'ollama/ornith:9b', name: 'ornith:9b', provider: 'ollama' },
        { id: 'ollama/qwen3.5:9b-it-q4_K_M', name: 'qwen3.5:9b', provider: 'ollama' },
        { id: 'ollama/qwen2.5-coder:7b', name: 'qwen2.5-coder:7b', provider: 'ollama' },
      ],
    });
  }
});

// POST /api/models/switch — switch model for active session
router.post('/models/switch', async (req, res) => {
  try {
    const { model } = req.body;
    if (!model) {
      return res.status(400).json({ error: 'model required' });
    }
    const sessionKey = req.app.locals.sessionKey;
    if (!sessionKey) {
      return res.status(400).json({ error: 'no session key configured' });
    }
    await gwRequest('sessions.patch', { key: sessionKey, model });
    console.log(`[MODELS] switched session ${sessionKey} → model ${model}`);
    res.json({ ok: true, model });
  } catch (err) {
    console.error('[MODELS] switch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/models/reasoning — set thinking level (named preset)
// Valid: off|minimal|low|medium|high|xhigh|adaptive|max|ultra
const VALID_THINKING_LEVELS = [
  'off', 'minimal', 'low', 'medium', 'high',
  'xhigh', 'adaptive', 'max', 'ultra'
];

router.post('/models/reasoning', async (req, res) => {
  try {
    const { thinkingLevel } = req.body;
    const sessionKey = req.app.locals.sessionKey;
    if (!sessionKey) {
      return res.status(400).json({ error: 'no session key configured' });
    }
    // null/empty = reset to default
    const tlValue = (thinkingLevel && VALID_THINKING_LEVELS.includes(thinkingLevel))
      ? thinkingLevel
      : null;
    await gwRequest('sessions.patch', { key: sessionKey, thinkingLevel: tlValue });
    console.log(`[MODELS] session ${sessionKey} → thinkingLevel ${tlValue}`);
    res.json({ ok: true, thinkingLevel: tlValue });
  } catch (err) {
    console.error('[MODELS] reasoning error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/models/status — get current session state (model + thinking)
router.get('/models/status', async (req, res) => {
  try {
    const sessionKey = req.app.locals.sessionKey;
    if (!sessionKey) {
      return res.status(400).json({ error: 'no session key configured' });
    }
    const result = await gwRequest('sessions.list', { search: sessionKey, limit: 1 });
    const sessions = result?.sessions || [];
    const session = sessions.find(s => s.key === sessionKey);
    if (!session) {
      return res.json({ model: '', thinkingLevel: 0, available: false });
    }
    // Include thinkingLevels if the session has them (model-specific presets)
    const thinkingLevels = session.thinkingLevels || null;
    res.json({
      model: session.model || '',
      thinkingLevel: session.thinkingLevel || null,
      thinkingLevels,  // array of {id, label} or null
      fastMode: session.fastMode || null,
      available: true,
    });
  } catch (err) {
    console.error('[MODELS] status error:', err.message);
    res.json({ model: '', thinkingLevel: null, available: false });
  }
});

export default router;
