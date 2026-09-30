import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';

/**
 * Three routes in front of Groq, so the key stays on the server.
 *
 * Mounted on Vite's dev and preview servers to keep the example to one
 * command. In production they belong wherever your API lives: each is one
 * fetch, and none depends on Vite.
 *
 *   POST /api/transcribe  WAV bytes      -> { text }   Whisper large v3 turbo
 *   POST /api/chat        { text, history } -> { reply }  GPT-OSS 20B
 *   POST /api/speak       { text }       -> WAV bytes  Orpheus
 *
 * Groq's rate-limit headers are passed through, so the page can show how much
 * of the free tier is left rather than a table of what it was when this was
 * written.
 */

const GROQ = 'https://api.groq.com/openai/v1';

export const MODELS = {
  transcribe: 'whisper-large-v3-turbo',
  chat: 'openai/gpt-oss-20b',
  speak: 'canopylabs/orpheus-v1-english',
} as const;

/** One of the voices in Groq's Orpheus examples. Others: troy, austin. */
const VOICE = 'hannah';

const SYSTEM_PROMPT =
  'You are a helpful voice assistant. Answer in one or two short spoken sentences. ' +
  'Never use markdown, lists or emoji: everything you write is read aloud.';

export function groq(apiKey: string | undefined): Plugin {
  const handle: Connect.NextHandleFunction = async (req, res, next) => {
    const route = req.url?.split('?')[0];
    if (req.method !== 'POST' || !route || !['/api/transcribe', '/api/chat', '/api/speak'].includes(route)) {
      return next();
    }
    if (!apiKey) {
      return json(res, 500, { error: 'no-key', message: 'Set GROQ_API_KEY in .env.local and restart the dev server.' });
    }
    try {
      const body = await readBody(req);
      if (route === '/api/transcribe') return await transcribe(apiKey, body, res);
      if (route === '/api/chat') return await chat(apiKey, JSON.parse(body.toString('utf8')), res);
      return await speak(apiKey, JSON.parse(body.toString('utf8')), res);
    } catch (err) {
      json(res, 502, { error: 'failed', message: String((err as Error)?.message || err) });
    }
  };

  return {
    name: 'groq-routes',
    configureServer: server => { server.middlewares.use(handle); },
    configurePreviewServer: server => { server.middlewares.use(handle); },
  };
}

async function transcribe(apiKey: string, wav: Buffer, res: ServerResponse) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'speech.wav');
  form.append('model', MODELS.transcribe);
  form.append('language', 'en');
  form.append('response_format', 'json');

  const upstream = await fetch(`${GROQ}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!upstream.ok) return refuse(upstream, res);
  const data = await upstream.json();
  passLimits(upstream, res);
  json(res, 200, { text: data.text ?? '' });
}

async function chat(apiKey: string, body: { text?: string; history?: unknown[] }, res: ServerResponse) {
  const history = Array.isArray(body.history) ? body.history.slice(-6) : [];
  const upstream = await fetch(`${GROQ}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELS.chat,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...history, { role: 'user', content: body.text ?? '' }],
      // GPT-OSS reasons before it answers and bills that to max_tokens. At 80
      // it spent the lot thinking and returned nothing; this leaves room for
      // both at the lowest effort.
      max_tokens: 400,
      reasoning_effort: 'low',
      temperature: 0.3,
    }),
  });
  if (!upstream.ok) return refuse(upstream, res);
  const data = await upstream.json();
  passLimits(upstream, res);
  json(res, 200, { reply: data.choices?.[0]?.message?.content?.trim() ?? '' });
}

async function speak(apiKey: string, body: { text?: string }, res: ServerResponse) {
  // Orpheus takes at most 200 characters a request. The hook already sends a
  // sentence at a time, cut to 200, so this only guards against misuse.
  const input = (body.text ?? '').slice(0, 200);
  const upstream = await fetch(`${GROQ}/audio/speech`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODELS.speak, voice: VOICE, input, response_format: 'wav' }),
  });
  if (!upstream.ok) return refuse(upstream, res);
  passLimits(upstream, res);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'audio/wav');
  res.end(Buffer.from(await upstream.arrayBuffer()));
}

/** Copy Groq's rate-limit headers onto our response. */
function passLimits(upstream: Response, res: ServerResponse) {
  upstream.headers.forEach((value, name) => {
    if (name.startsWith('x-ratelimit-') || name === 'retry-after') res.setHeader(name, value);
  });
}

/**
 * Pass a refusal on with its status and Groq's own code, which is what tells
 * a used-up quota (429) from a model whose terms need accepting in the console.
 */
async function refuse(upstream: Response, res: ServerResponse) {
  const data: any = await upstream.json().catch(() => ({}));
  passLimits(upstream, res);
  json(res, upstream.status, {
    error: upstream.status === 429 ? 'limit' : 'upstream',
    code: data?.error?.code ?? null,
    message: data?.error?.message ?? upstream.statusText,
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
