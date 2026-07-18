// ── TTS Engine — Supertonic (OpenAI-compatible REST API) ──

import { Readable } from 'node:stream';

const SUPERTONIC_URL = process.env.SUPERTONIC_URL || 'http://localhost:8766/v1/audio/speech';
const SUPERTONIC_MODEL = process.env.SUPERTONIC_MODEL || 'supertonic-3';
const DEFAULT_VOICE = process.env.SUPERTONIC_VOICE || 'F4';

let voicesByLang = {
  en: 'F4',
  ru: 'F5',
};

let pauseMs = 600;       // pause between sentences (ms)
let ttsSpeed = 1.5;      // speaking rate (1.0 = normal)
let endSilenceMs = 100;   // silence appended to end of each WAV chunk (ms)

/**
 * Simple language detection — checks for Cyrillic / Spanish markers.
 * Mirrors the logic in tts_lang.sh (CLI talk skill).
 */
export function detectLang(text) {
  if (!text) return 'en';
  // Russian / Cyrillic
  if (/[а-яёА-ЯЁ]/.test(text)) return 'ru';
  // Spanish — accented chars or common words
  if (/[áéíóúñü¿¡ÁÉÍÓÚÑÜ]/.test(text) ||
      /\b(hola|gracias|qué|como|para|pero|muy|más|por|favor|adiós|entonces|también|señor|señora)\b/i.test(text)) return 'es';
  return 'en';
}

/**
 * Resolve voice for text content.
 * @param {string} text — utterance to speak
 * @param {string} [preferredVoice] — explicit override; 'auto' uses language detection
 * @returns {string} voice id (F1–F5 / M1–M5)
 */
export function resolveVoice(text, preferredVoice) {
  if (preferredVoice && preferredVoice !== 'auto') return preferredVoice;
  if (!text) return DEFAULT_VOICE;
  const lang = detectLang(text);
  return voicesByLang[lang] || DEFAULT_VOICE;
}

export function initTTS(config) {
  if (config) {
    if (config.voicesByLang) {
      Object.assign(voicesByLang, config.voicesByLang);
    }
    if (typeof config.pauseMs === 'number') {
      pauseMs = config.pauseMs;
    }
    if (typeof config.speed === 'number') {
      ttsSpeed = config.speed;
    }
    if (typeof config.endSilenceMs === 'number') {
      endSilenceMs = config.endSilenceMs;
    }
  }
}

export function getPauseMs() { return pauseMs; }
export function getSpeed() { return ttsSpeed; }

/**
 * Append silence to the end of a WAV buffer.
 * Parses the WAV header to determine sample rate and bit depth.
 */
function appendSilence(wavBuffer, silenceMs) {
  if (silenceMs <= 0) return wavBuffer;
  const view = new DataView(wavBuffer.buffer, wavBuffer.byteOffset, wavBuffer.byteLength);
  // WAV header offsets
  const sampleRate = view.getUint32(24, true);
  const numChannels = view.getUint16(22, true);
  const bitsPerSample = view.getUint16(34, true);
  const dataSize = view.getUint32(40, true);
  const bytesPerSample = bitsPerSample / 8;
  // Calculate silence samples
  const silenceSamples = Math.floor(sampleRate * (silenceMs / 1000));
  const silenceBytes = silenceSamples * numChannels * bytesPerSample;
  // Create silence buffer
  const silence = Buffer.alloc(silenceBytes, 0);
  const result = Buffer.concat([wavBuffer, silence]);
  // Update WAV header sizes
  const newDataSize = dataSize + silenceBytes;
  result.writeUInt32LE(newDataSize, 40);       // data chunk size
  result.writeUInt32LE(newDataSize + 36, 4);    // RIFF file size - 8
  return result;
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
        speed: ttsSpeed,
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
        speed: ttsSpeed,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!supRes.ok) {
      const body = await supRes.text();
      console.error('[TTS] sentence error:', body.slice(0, 200));
      return Buffer.alloc(0);
    }

    const arrayBuffer = await supRes.arrayBuffer();
    let buf = Buffer.from(arrayBuffer);
    if (endSilenceMs > 0) {
      buf = appendSilence(buf, endSilenceMs);
    }
    return buf;
  } catch (err) {
    console.error('[TTS] sentence error:', err.message);
    return Buffer.alloc(0);
  }
}

/**
 * Split text into sentences for streaming TTS.
 */
export function splitSentences(text) {
  // Split on punctuation followed by whitespace — simplest rule:
  // a period, exclamation, or question mark followed by a space is a sentence boundary.
  // Numbers like "0.6" are never split since there's no space after the dot.
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}
