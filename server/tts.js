// ── TTS Engine — Supertonic (OpenAI-compatible REST API) ──

import { Readable } from 'node:stream';

const SUPERTONIC_URL = process.env.SUPERTONIC_URL || 'http://localhost:8766/v1/audio/speech';
const SUPERTONIC_MODEL = process.env.SUPERTONIC_MODEL || 'supertonic-3';
const DEFAULT_VOICE = process.env.SUPERTONIC_VOICE || 'F4';

export function initTTS(config) {
  // config is accepted but we always use Supertonic
}

/**
 * Strip markdown/emoji for cleaner TTS output.
 */
export function stripMarkdown(str) {
  return str
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]+)\]\(.*?\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/^---+$/gm, '')
    .replace(/\|/g, '')
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function stripEmoji(str) {
  return str.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').replace(/\s{2,}/g, ' ').trim();
}

export function getEngines() {
  return {
    current: 'supertonic',
    engines: [{ id: 'supertonic', name: 'Supertonic ONNX (local)', available: true, selected: true }],
  };
}

export function setEngine(engine) {
  if (engine !== 'supertonic') throw new Error('only supertonic engine is available');
  return 'supertonic';
}

export function getCurrentVoice() { return DEFAULT_VOICE; }

/**
 * POST text to Supertonic and pipe the audio response.
 */
export async function synthesizeToResponse(text, voice, res) {
  const cleanText = stripMarkdown(text);
  if (!cleanText) { res.status(400).json({ error: 'no speakable text' }); return; }

  try {
    const supRes = await fetch(SUPERTONIC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: SUPERTONIC_MODEL,
        input: cleanText,
        voice: voice || DEFAULT_VOICE,
        response_format: 'wav',
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!supRes.ok) {
      const body = await supRes.text();
      throw new Error(`Supertonic TTS failed (${supRes.status}): ${body.slice(0, 200)}`);
    }

    res.setHeader('Content-Type', 'audio/wav');
    // Convert Web ReadableStream to Node.js stream and pipe
    const nodeStream = Readable.fromWeb(supRes.body);
    nodeStream.pipe(res);
  } catch (err) {
    console.error('[TTS] error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
}

/**
 * Generate single-sentence audio buffer (for streaming voice chat).
 */
export async function ttsSentence(text, voice) {
  const clean = stripMarkdown(text);
  if (!clean) return Buffer.alloc(0);

  try {
    const supRes = await fetch(SUPERTONIC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: SUPERTONIC_MODEL,
        input: clean,
        voice: voice || DEFAULT_VOICE,
        response_format: 'wav',
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!supRes.ok) {
      const body = await supRes.text();
      console.error('[TTS] sentence error:', body.slice(0, 200));
      return Buffer.alloc(0);
    }

    const arrayBuffer = await supRes.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    console.error('[TTS] sentence error:', err.message);
    return Buffer.alloc(0);
  }
}

/**
 * Split text into sentences for streaming TTS.
 */
export function splitSentences(text) {
  return text.split(/(?<=[。！？.!?\n])\s*/).filter(s => s.trim().length > 0);
}
