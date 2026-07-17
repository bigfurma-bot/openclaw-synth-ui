// ── Voice Chat Route: /api/voice ──

import { Router } from 'express';
import multer from 'multer';
import os from 'os';
import path from 'path';
import { readFile } from 'fs/promises';
import { unlink } from 'fs/promises';
import { gwRequest } from '../gateway.js';
import { addVoiceHandler, removeVoiceHandler } from '../sse.js';
import { ttsSentence, splitSentences } from '../tts.js';

const router = Router();
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── Parakeet STT ──
const PARAKEET_URL = process.env.PARAKEET_URL || 'http://localhost:5093/v1/audio/transcriptions';

async function parakeetTranscribe(audioPath) {
  const audioBuffer = await readFile(audioPath);
  const blob = new Blob([audioBuffer], { type: 'audio/wav' });

  const form = new FormData();
  form.set('file', blob, 'audio.wav');
  form.set('model', 'parakeet');

  const res = await fetch(PARAKEET_URL, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Parakeet STT failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.text || data.transcript || '').trim();
}

// ── Message count tracking ──
let msgCountToday = 0;
let msgCountDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });

router.post('/voice', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'audio file required' });

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache', 'Transfer-Encoding': 'chunked',
  });

  const send = (obj) => res.write(JSON.stringify(obj) + '\n');
  const audioPath = req.file.path;

  try {
    const transcript = await parakeetTranscribe(audioPath);
    if (!transcript) { send({ type: 'error', message: 'No speech detected' }); send({ type: 'done' }); res.end(); return; }

    send({ type: 'transcript', text: transcript });
    console.log(`[VOICE] transcript: "${transcript}"`);

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
    if (today !== msgCountDate) { msgCountToday = 0; msgCountDate = today; }
    msgCountToday++;

    const idempotencyKey = `voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const voice = 'F4';

    const responseText = await new Promise((resolve, reject) => {
      let fullText = '';
      let sentenceBuffer = '';
      let currentRunId = null;
      const ttsQueue = [];

      // Serial TTS processor — processes one sentence at a time, in order
      let ttsProcessing = Promise.resolve();

      const enqueueTts = (sentences) => {
        ttsQueue.push(...sentences);
        ttsProcessing = ttsProcessing.then(async () => {
          while (ttsQueue.length > 0) {
            const sentence = ttsQueue.shift();
            try {
              const audioBuffer = await ttsSentence(sentence, voice);
              if (audioBuffer.length > 0) {
                const base64 = audioBuffer.toString('base64');
                send({ type: 'tts-chunk', audio: base64, contentType: 'audio/wav', text: sentence });
              }
            } catch (err) { console.error('[VOICE] TTS error:', err.message); }
          }
        });
        return ttsProcessing;
      };

      const handler = async (payload) => {
        const text = (() => {
          if (!payload.message?.content) return '';
          const c = payload.message.content;
          if (Array.isArray(c)) return c.filter(x => x.type === 'text').map(x => x.text).join('');
          return typeof c === 'string' ? c : '';
        })();

        if (!currentRunId && payload.runId) currentRunId = payload.runId;
        if (currentRunId && payload.runId !== currentRunId) return;

        if (payload.state === 'streaming' || payload.state === 'delta' || payload.state === 'final') {
          const newChars = text.slice(fullText.length);
          fullText = text;
          if (newChars) {
            send({ type: 'text-chunk', text: newChars });
            sentenceBuffer += newChars;
            const sentences = splitSentences(sentenceBuffer);
            if (sentences.length > 1) {
              const complete = sentences.slice(0, -1);
              sentenceBuffer = sentences[sentences.length - 1];
              await enqueueTts(complete);
            }
          }
        }

        if (payload.state === 'final' || payload.state === 'aborted') {
          if (sentenceBuffer.trim()) await enqueueTts([sentenceBuffer.trim()]);
          removeVoiceHandler(handler);
          resolve(fullText);
        }
      };

      addVoiceHandler(handler);

      gwRequest('chat.send', {
        message: transcript, sessionKey: req.app.locals.sessionKey,
        idempotencyKey, deliver: false,
      }).catch((err) => { removeVoiceHandler(handler); reject(err); });

      // Safety net: resolve after 120s even if agent never sends final
      setTimeout(() => {
        removeVoiceHandler(handler);
        resolve(fullText || 'timeout');
      }, 120000);
    });

    send({ type: 'done', fullText: responseText });
  } catch (err) {
    console.error('[VOICE] error:', err);
    send({ type: 'error', message: err.message });
  } finally {
    try { await unlink(audioPath); } catch {}
    res.end();
  }
});

export default router;
