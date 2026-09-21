/**
 * api/chat.ts — the demo's hosted brain.
 *
 * WHY THIS EXISTS
 *
 * The browser-sized language model (Qwen2.5-0.5B) is the weakest part of the
 * demo's first impression: asked what drinks are on the menu, it asks a question
 * back. It is also 750 MB of the ~1.3 GB a visitor downloads before speaking,
 * which is more than a phone will ever accept.
 *
 * Routing replies through a hosted model fixes both at once, and demonstrates
 * the bring-your-own-model architecture (`onSubmit`) that the package is
 * actually selling. Hearing, voice and facial animation stay in the browser.
 *
 * WHAT PROTECTS THE ACCOUNT
 *
 * This endpoint is public, so it must be worth nothing to anyone who finds it.
 * The key never leaves the server, the system prompt is fixed here rather than
 * accepted from the caller, replies are capped at a couple of spoken sentences,
 * and both a per-visitor and a whole-site limit apply. Every refusal is a plain
 * status code the demo answers by falling back to the local model, so a visitor
 * who arrives at the cap still gets a working avatar, just a less articulate
 * one.
 *
 * The counters live in memory, so with several serverless instances warm the
 * caps are approximate — a ceiling per instance rather than per site. That is
 * deliberate: Groq's free tier is rate-limited rather than billed, so the cost
 * of drift is a 429 from them, not a charge. Exact counters need a KV store and
 * can be added if the demo ever takes real traffic.
 */

/** Who may call this. A public endpoint that answers any origin is a free API. */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://react-ai-voice-avatar.vercel.app')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

/**
 * Preview deployments get a generated hostname per branch, so a fixed list
 * would refuse the very deploys used to test a change. Matched on both ends —
 * this project's name and Vercel's domain — rather than allowing vercel.app at
 * large, which would let any site hosted there spend the quota.
 */
function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const { hostname, protocol } = new URL(origin);
    return (
      protocol === 'https:' &&
      hostname.startsWith('react-ai-voice-avatar') &&
      hostname.endsWith('.vercel.app')
    );
  } catch {
    return false;
  }
}

/**
 * Replies per visitor per hour.
 *
 * A real conversation with the demo is a handful of turns; nobody curious runs
 * out. A script does so immediately.
 */
const PER_IP_HOURLY = 12;

/**
 * Replies for the whole site per day.
 *
 * Groq's free tier allows on the order of 1,000 requests a day for this class
 * of model. Stopping at 800 leaves room for the retry path below and keeps the
 * account inside the free tier rather than relying on it to say no.
 */
const DAILY_TOTAL = 800;

/** Longer than anyone says out loud in one turn; a transcript this long is not speech. */
const MAX_INPUT_CHARS = 500;

/** Two spoken sentences. The prompt asks for that anyway; this enforces it. */
const MAX_TOKENS = 80;

/** How much of the conversation is sent back. Enough to follow up, cheap to send. */
const MAX_HISTORY_TURNS = 2;

/**
 * The persona, fixed server-side.
 *
 * If this came from the request body, anyone could point a general-purpose
 * chatbot at the endpoint and spend the quota on something that is not a demo.
 */
const SYSTEM_PROMPT =
  'You are Ananya, the demo avatar for react-ai-voice-avatar, an open-source React component. ' +
  'Facts you may use: it renders a lip-synced 3D avatar on the visitor\'s own GPU; speech ' +
  'recognition, the voice and the facial animation all run in the browser; the replies in this ' +
  'demo come from a hosted model, because developers connect their own model through an onSubmit ' +
  'prop; it is MIT licensed and installs from npm. If you do not know something, say so. ' +
  'Answer in one or two short spoken sentences. Never use markdown, lists or emoji.';

/**
 * Candidates in order of preference, tried until one answers.
 *
 * Not only a rate-limit fallback. Which models an account can reach is not
 * something the docs settle: this account has no llama-3.3-70b-versatile at
 * all, and asking for it returned `404 model_not_found` where the docs list it
 * as a production model. Providers also retire names on their own schedule. So
 * a name that is gone is treated the same as one that is busy — move to the
 * next — and the reply says which one actually answered.
 */
const MODELS = ['llama-3.3-70b-versatile', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'];

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

/** Recent request times per address, pruned as it goes so the map cannot grow forever. */
const hits = new Map<string, number[]>();

/** Today's total, keyed by date so it resets without a timer. */
let today = { day: '', count: 0 };

const HOUR_MS = 60 * 60 * 1000;

function clientIp(req: any): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return (first || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
}

function withinPerIpLimit(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < HOUR_MS);

  if (recent.length >= PER_IP_HOURLY) {
    hits.set(ip, recent);
    return false;
  }

  recent.push(now);
  hits.set(ip, recent);

  // Addresses that stopped calling an hour ago are dead weight in a long-lived
  // instance. Sweeping on write keeps this to one pass over a small map.
  if (hits.size > 500) {
    for (const [key, times] of hits) {
      if (times.every(t => now - t >= HOUR_MS)) hits.delete(key);
    }
  }

  return true;
}

function withinDailyTotal(): boolean {
  const day = new Date().toISOString().slice(0, 10);
  if (today.day !== day) today = { day, count: 0 };
  if (today.count >= DAILY_TOTAL) return false;
  today.count += 1;
  return true;
}

/** Only strings, only the recent turns, only the two roles the API accepts. */
function sanitizeHistory(raw: unknown): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (turn: any) =>
        turn &&
        (turn.role === 'user' || turn.role === 'assistant') &&
        typeof turn.content === 'string' &&
        turn.content.length > 0
    )
    .slice(-MAX_HISTORY_TURNS * 2)
    .map((turn: any) => ({
      role: turn.role,
      content: turn.content.slice(0, MAX_INPUT_CHARS),
    }));
}

export default async function handler(req: any, res: any) {
  const origin = req.headers.origin;
  const allowed = origin && isAllowedOrigin(origin);

  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });

  // A browser always sends Origin on a POST, so requiring it costs a genuine
  // visitor nothing and turns away anything pointed at this endpoint directly.
  // It is a speed bump, not a lock — the limits below are what actually hold.
  if (!allowed) return res.status(403).json({ error: 'origin-not-allowed' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    // Local development has no key by design, so this is the normal answer
    // there: the demo hears it and keeps using the in-browser model.
    return res.status(503).json({ error: 'unconfigured' });
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : req.body || {};
  const text = typeof body.text === 'string' ? body.text.trim() : '';

  if (!text) return res.status(400).json({ error: 'empty' });
  if (text.length > MAX_INPUT_CHARS) return res.status(413).json({ error: 'too-long' });

  if (!withinPerIpLimit(clientIp(req))) {
    return res.status(429).json({ error: 'per-visitor-limit' });
  }
  if (!withinDailyTotal()) {
    return res.status(429).json({ error: 'daily-limit' });
  }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...sanitizeHistory(body.history),
    { role: 'user', content: text },
  ];

  for (const model of MODELS) {
    try {
      const upstream = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: MAX_TOKENS,
          temperature: 0.6,
        }),
      });

      if (upstream.status === 429 || upstream.status >= 500) continue; // busy — try the next model

      const data: any = await upstream.json();

      // A name this account cannot reach is worth exactly as much as a busy
      // one: move on. Without this, one retired model id takes the whole demo
      // down until someone redeploys.
      const code = data?.error?.code || data?.error?.type || null;
      if (!upstream.ok && (upstream.status === 404 || code === 'model_not_found' || code === 'model_decommissioned')) {
        console.warn(`[api/chat] ${model} unavailable (${code}), trying the next one`);
        continue;
      }

      if (!upstream.ok) {
        // The provider's message can name the account, so only its status and
        // machine-readable code come back out. Those two are enough to tell an
        // expired key from a model that needs its terms accepted, which is
        // otherwise invisible: runtime logs need a login to read.
        console.error('[api/chat] upstream rejected', upstream.status, code);
        return res.status(502).json({ error: 'upstream', upstreamStatus: upstream.status, code });
      }

      const reply = data?.choices?.[0]?.message?.content?.trim();
      if (!reply) return res.status(502).json({ error: 'empty-reply' });

      return res.status(200).json({ reply, model });
    } catch (err: any) {
      console.error('[api/chat] request failed', err?.message);
    }
  }

  return res.status(503).json({ error: 'unavailable' });
}

function safeParse(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
