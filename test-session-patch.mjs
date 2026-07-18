import WebSocket from 'ws';
import { readFile } from 'fs/promises';

const GATEWAY_URL = 'ws://127.0.0.1:18789';
const config = JSON.parse(await readFile('/home/prime/.openclaw/openclaw.json', 'utf-8'));
const token = config.gateway?.token || config.token;

// Load device identity
let deviceIdentity = null;
try {
  deviceIdentity = JSON.parse(await readFile('/home/prime/.openclaw/identity/jarvis-device.json', 'utf-8'));
} catch {}

const ws = new WebSocket(GATEWAY_URL, [], { 
  origin: 'http://localhost:9999', 
  followRedirects: true 
});

const pending = new Map();
let seq = 1;

function request(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = String(seq++);
    pending.set(id, { resolve, reject: (e) => { console.log(`  [${id}] ${method} failed:`, e?.message || e); reject(e); } });
    ws.send(JSON.stringify({ type: 'req', id, method, params }));
    setTimeout(() => { 
      if (pending.has(id)) { 
        pending.delete(id); 
        reject(new Error('timeout')); 
      }
    }, 10000);
  });
}

// Sign device payload (same as gateway.js)
import crypto from 'crypto';

function publicKeyRawBase64UrlFromPem(pem) {
  const der = crypto.createPublicKey(pem).export({ type: 'der' });
  const raw = der.slice(16);
  return raw.toString('base64url');
}

function signDevicePayload(privateKeyPem, payload) {
  const sign = crypto.createSign('sha256');
  sign.update(Buffer.from(JSON.stringify(payload)));
  sign.end();
  const sig = sign.sign({ key: privateKeyPem, format: 'pem', type: 'pkcs8' });
  return sig.toString('base64url');
}

function buildDeviceAuthPayload(params) {
  const parts = [
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    [...params.scopes].sort().join(','),
    String(params.signedAtMs),
    params.token ?? '',
    params.nonce ?? '',
  ];
  return parts.join('.');
}

async function connectAndTest() {
  console.log('Connecting...');
  await new Promise((resolve, reject) => {
    ws.on('open', () => {
      console.log('WebSocket open, sending connect...');
      resolve();
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('WS connect timeout')), 5000);
  });

  // Step 1: Connect with proper device auth
  const signedAtMs = Date.now();
  const nonce = crypto.randomBytes(16).toString('base64url');
  const role = 'operator';
  const scopes = ['operator.admin', 'operator.approvals', 'operator.pairing'];
  
  const device = (() => {
    if (!deviceIdentity) return undefined;
    const payload = buildDeviceAuthPayload({
      deviceId: deviceIdentity.deviceId,
      clientId: 'openclaw-control-ui',
      clientMode: 'webchat',
      role,
      scopes,
      signedAtMs,
      token: token ?? null,
      nonce,
    });
    const signature = signDevicePayload(deviceIdentity.privateKeyPem, payload);
    return {
      id: deviceIdentity.deviceId,
      publicKey: publicKeyRawBase64UrlFromPem(deviceIdentity.publicKeyPem),
      signature,
      signedAt: signedAtMs,
      nonce,
    };
  })();

  const connectResult = await request('connect', {
    minProtocol: 3,
    maxProtocol: 4,
    client: {
      id: 'openclaw-control-ui',
      version: 'dev',
      platform: 'node',
      mode: 'webchat',
      instanceId: 'jarvis-backend-test',
    },
    role,
    scopes,
    auth: { token },
    device,
    caps: [],
    userAgent: 'jarvis-backend/1.0',
    locale: 'en-US',
  });
  console.log('connect ok, sessionKey:', connectResult?.sessionKey);

  // Step 2: hello.ok
  const helloResult = await request('hello.ok', { version: '1.0.0', client: { mode: 'webchat', ...device }, maxProtocol: 4 });
  console.log('hello.ok ok, sessionKey:', helloResult?.sessionKey);

  // Step 3: sessions.get for agent:main:jarvis
  try {
    const getResult = await request('sessions.get', { key: 'agent:main:jarvis' });
    console.log('sessions.get result:', JSON.stringify(getResult, null, 2));
  } catch(e) { console.log('sessions.get error (session may not exist):', e.message); }

  // Step 4: sessions.patch to set model
  try {
    const patchResult = await request('sessions.patch', { 
      key: 'agent:main:jarvis',
      model: 'opencode/deepseek-v4-flash-free'
    });
    console.log('sessions.patch result:', JSON.stringify(patchResult, null, 2));
  } catch(e) { console.log('sessions.patch error:', e.message); }

  // Step 5: chat.send to test
  try {
    const chatResult = await request('chat.send', { 
      message: 'say: test model',
      sessionKey: 'agent:main:jarvis',
      idempotencyKey: 'test-' + Date.now(),
      deliver: false
    });
    console.log('chat.send result:', JSON.stringify(chatResult, null, 2));
  } catch(e) { console.log('chat.send error:', e.message); }

  ws.close();
}

ws.on('message', async (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === 'res' && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.payload);
    else p.reject(new Error(msg.error?.message || JSON.stringify(msg.error)));
  }
});

ws.on('error', (err) => console.error('WS error:', err.message));
ws.on('close', () => console.log('WS closed'));

await connectAndTest();