// U/I hosted-assistant proxy
//
// Sits between the hosted/index.html clone and api.anthropic.com. It holds
// the real Anthropic API key (as a Worker secret, never in this source),
// gates access behind a passcode, and enforces a hard spending cap before
// ever placing the upstream call — not just after, which would let a burst
// of concurrent requests all slip through before any of them get counted.
//
// Threat model this defends against: a small invited group, one of whom
// runs a buggy loop or a much heavier session than expected. It is NOT
// hardened against a sophisticated attacker deliberately racing this
// Worker's KV reads/writes — Workers KV is only eventually consistent, so
// under real concurrency two requests can still both read the same "spent
// so far" value before either write lands. For an invite-only personal
// tool this is an acceptable, well-understood gap; if that ever matters,
// swap the USAGE KV reads/writes below for a Durable Object, which can
// serialize them properly.
//
// ── REQUIRED SETUP — do this before deploying ──────────────────────────
// 1. wrangler kv namespace create USAGE
//    wrangler kv namespace create PASSCODES
//    → paste the two printed ids into wrangler.toml
// 2. wrangler secret put ANTHROPIC_API_KEY
//    → paste your real key when prompted; it is never written to disk here
// 3. Edit ALLOWED_ORIGIN in wrangler.toml to the exact origin hosted/ is
//    served from (e.g. https://yourname.github.io — no trailing slash).
// 4. Add at least one passcode with worker/scripts/add-passcode.mjs
//    (see worker/README.md).
// 5. VERIFY the PRICING table below against your current Anthropic console
//    pricing (console.anthropic.com → Settings → Billing, or
//    docs.anthropic.com pricing page) before trusting the caps. Getting
//    this wrong in the "too cheap" direction means the cap enforces less
//    protection than you think.

// Dollars per million tokens. Verified against Anthropic's published
// pricing (docs.claude.com/en/docs/about-claude/pricing) as of this
// writing — rates can change, so recheck there if the caps below ever
// seem to be tripping at the wrong point.
const PRICING = {
  'claude-sonnet-5': { in: 2, out: 10 },
  'claude-opus-5': { in: 5, out: 25 },
  'claude-haiku-4-5': { in: 1, out: 5 },
};
const ALLOWED_MODELS = Object.keys(PRICING);

// Ephemeral (5-minute) prompt-cache pricing, as a multiplier of the base
// input price. Also verify these.
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

// U/I asks for different max_tokens per feature (1024/2048/4096) — honor
// what the client asks for, but never above this, since a tampered client
// request could otherwise ask for far more than any real feature needs.
const MAX_OUTPUT_TOKENS_CEILING = 4096;

// Coarse anti-hammering limit, independent of the cost cap below — caps
// how many requests per passcode can even be attempted per minute.
const RATE_LIMIT_PER_MINUTE = 10;

// Pre-auth throttle, checked before the passcode is even looked up, so
// junk/missing passcodes are rate limited too. CF-Connecting-IP is set by
// Cloudflare at the edge, so a client can't spoof it to dodge this.
const IP_RATE_LIMIT_PER_MINUTE = 20;

// Both throttles above are counted in this Worker instance's memory, not
// in KV. KV's free tier allows only 1,000 writes/day (and 1 write/second
// per key), so writing a counter on every request — including junk
// requests from anyone on the internet — let a single IP exhaust the
// day's write quota and take the Worker down for everyone. In-memory
// counts are per-instance and best-effort (Cloudflare may run several
// instances), which is fine: the real guard is the spending cap below,
// and the only KV writes left happen after a passcode has been validated.
const minuteCounters = { minute: -1, counts: new Map() };
function bumpMinuteCounter(key) {
  const minute = Math.floor(Date.now() / 60000);
  if (minuteCounters.minute !== minute) {
    minuteCounters.minute = minute;
    minuteCounters.counts.clear();
  }
  const n = (minuteCounters.counts.get(key) || 0) + 1;
  minuteCounters.counts.set(key, n);
  return n;
}

// The hosted app only ever sends plain text, so that's all this proxy
// forwards. Anything else (images, PDFs, URL-sourced documents, tools) is
// rejected: those are billed for far more tokens than the request body's
// size suggests, which let a request slip past the pre-call cost estimate,
// and they'd turn the shared key into a general-purpose Claude proxy.
// MAX_INPUT_CHARS sits well above U/I's largest real request (the archive
// draft sample is ~12k chars plus its prompt).
const MAX_INPUT_CHARS = 60000;
const MAX_MESSAGES = 100;

const TTL_DAY = 60 * 60 * 24 * 2; // usage keys outlive a day so late writes still land
const TTL_MONTH = 60 * 60 * 24 * 40;

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env);
    try {
      return await handle(request, env, cors);
    } catch (e) {
      // Always answer with CORS headers, so the browser shows this message
      // instead of a generic network error.
      return jsonError(500, 'Proxy error: ' + (e && e.message ? e.message : 'unknown'), cors);
    }
  },
};

async function handle(request, env, cors) {
  const origin = request.headers.get('Origin') || '';

  const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (bumpMinuteCounter(`ip:${clientIp}`) > IP_RATE_LIMIT_PER_MINUTE) {
    return jsonError(429, 'Too many requests from this address. Try again shortly.', cors);
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  const url = new URL(request.url);
  if (url.pathname !== '/v1/messages') {
    return jsonError(404, 'Not found', cors);
  }
  if (request.method !== 'POST') {
    return jsonError(405, 'Method not allowed', cors);
  }

  // Origin header can be forged by a non-browser client (curl, etc.), so
  // this is not the real access control — the passcode below is. This
  // just stops other websites from using a visitor's browser to spend
  // your budget without them noticing.
  if (!env.ALLOWED_ORIGIN || origin !== env.ALLOWED_ORIGIN) {
    return jsonError(403, 'Origin not allowed', cors);
  }

  const passcode = request.headers.get('x-passcode') || '';
  if (!passcode) return jsonError(401, 'Missing passcode', cors);

  const passHash = await sha256Hex(passcode);
  const record = await env.PASSCODES.get(`passcode:${passHash}`, 'json');
  if (!record || record.active === false) {
    return jsonError(401, 'Invalid or revoked passcode', cors);
  }
  const userId = record.name || passHash;

  if (bumpMinuteCounter(`user:${userId}`) > RATE_LIMIT_PER_MINUTE) {
    return jsonError(
      429,
      `Too many requests — limit is ${RATE_LIMIT_PER_MINUTE}/minute per passcode. Try again shortly.`,
      cors
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON body', cors);
  }

  if (!ALLOWED_MODELS.includes(body.model)) {
    return jsonError(400, `Model not allowed: ${body.model}`, cors);
  }
  const model = body.model;
  const maxTokens = clamp(parseInt(body.max_tokens, 10) || 1024, 1, MAX_OUTPUT_TOKENS_CEILING);

  const system = sanitizeSystem(body.system);
  const messages = sanitizeMessages(body.messages);
  if (system === null || messages === null) {
    return jsonError(400, 'Only plain-text system and message content is accepted.', cors);
  }
  if (countChars(system, messages) > MAX_INPUT_CHARS) {
    return jsonError(400, `Request too long (limit ${MAX_INPUT_CHARS} characters).`, cors);
  }

  const outgoing = { model, max_tokens: maxTokens, messages };
  if (system !== undefined) outgoing.system = system;

  const now = new Date();
  const day = now.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const month = day.slice(0, 7); // YYYY-MM
  const userDayKey = `user:${userId}:${day}`;
  const globalMonthKey = `global:${month}`;
  const perUserCapCents = parseInt(env.PER_USER_DAILY_CAP_CENTS, 10);
  const globalCapCents = parseInt(env.GLOBAL_MONTHLY_CAP_CENTS, 10);

  const [userSpent, globalSpent] = await Promise.all([
    readInt(env.USAGE, userDayKey),
    readInt(env.USAGE, globalMonthKey),
  ]);

  const estimateCents = estimateCostCents(model, outgoing, maxTokens);

  if (userSpent + estimateCents > perUserCapCents) {
    return jsonError(
      429,
      `Daily cap reached for this passcode ($${(perUserCapCents / 100).toFixed(
        2
      )}/day). Resets at midnight UTC.`,
      cors
    );
  }
  if (globalSpent + estimateCents > globalCapCents) {
    return jsonError(
      429,
      `This instance's monthly budget cap has been reached. Resets next month.`,
      cors
    );
  }

  // Reserve the worst-case cost BEFORE the slow upstream call. This is
  // what closes the race where several requests could otherwise all pass
  // the checks above while none of them has been recorded yet.
  // If the reservation can't be recorded (e.g. KV's daily write quota is
  // used up), fail closed: no upstream call without a recorded hold.
  try {
    await Promise.all([
      env.USAGE.put(userDayKey, String(userSpent + estimateCents), {
        expirationTtl: TTL_DAY,
      }),
      env.USAGE.put(globalMonthKey, String(globalSpent + estimateCents), {
        expirationTtl: TTL_MONTH,
      }),
    ]);
  } catch (e) {
    return jsonError(503, 'Usage tracking is unavailable right now, so this request was not sent. Try again later.', cors);
  }

  let upstream;
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(outgoing),
    });
  } catch (e) {
    await releaseReservation(env, userDayKey, globalMonthKey, estimateCents);
    return jsonError(502, 'Could not reach Anthropic: ' + e.message, cors);
  }

  const text = await upstream.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // leave parsed null
  }

  // The call has already happened (and been billed) by now, so a failed
  // KV write here must not throw away the response. The reservation was
  // already recorded as the worst case, so the cap stays conservative.
  try {
    if (upstream.ok && parsed && parsed.usage) {
      const actualCents = actualCostCents(model, parsed.usage);
      await reconcileReservation(env, userDayKey, globalMonthKey, estimateCents, actualCents);
    } else {
      // Upstream call failed outright — nothing was billed, release the hold.
      await releaseReservation(env, userDayKey, globalMonthKey, estimateCents);
    }
  } catch {
    // leave the worst-case reservation in place
  }

  return new Response(text, {
    status: upstream.status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}

// Returns a text-only copy of `system` (string or array of text blocks),
// undefined if absent, or null if it contains anything else.
function sanitizeSystem(system) {
  if (system === undefined || system === null) return undefined;
  if (typeof system === 'string') return system;
  return sanitizeTextBlocks(system);
}

// Returns a text-only copy of `messages`, or null if any message has a
// role other than user/assistant or any non-text content.
function sanitizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) return null;
  const out = [];
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) return null;
    let content;
    if (typeof m.content === 'string') content = m.content;
    else content = sanitizeTextBlocks(m.content);
    if (content === null) return null;
    out.push({ role: m.role, content });
  }
  return out;
}

function sanitizeTextBlocks(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  const out = [];
  for (const b of blocks) {
    if (!b || b.type !== 'text' || typeof b.text !== 'string') return null;
    const block = { type: 'text', text: b.text };
    if (b.cache_control !== undefined) {
      if (!b.cache_control || b.cache_control.type !== 'ephemeral') return null;
      block.cache_control = { type: 'ephemeral' };
    }
    out.push(block);
  }
  return out;
}

function countChars(system, messages) {
  const len = (c) =>
    c === undefined ? 0 : typeof c === 'string' ? c.length : c.reduce((n, b) => n + b.text.length, 0);
  return len(system) + messages.reduce((n, m) => n + len(m.content), 0);
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-passcode',
    // Lets the browser cache a preflight for a day instead of re-sending an
    // OPTIONS request before every single POST — halves real request volume
    // against the Workers free-tier quota, on top of the throttle above.
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function jsonError(status, message, cors) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function readInt(kv, key) {
  const v = await kv.get(key);
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

async function releaseReservation(env, userDayKey, globalMonthKey, estimateCents) {
  await reconcileReservation(env, userDayKey, globalMonthKey, estimateCents, 0);
}

// Replaces a held reservation with the real cost. Not perfectly atomic
// under concurrent requests (see the top-of-file note on KV consistency),
// but re-reads immediately before writing to keep the window small.
async function reconcileReservation(env, userDayKey, globalMonthKey, estimateCents, actualCents) {
  const delta = actualCents - estimateCents;
  if (delta === 0) return;
  const [userSpent, globalSpent] = await Promise.all([
    readInt(env.USAGE, userDayKey),
    readInt(env.USAGE, globalMonthKey),
  ]);
  await Promise.all([
    env.USAGE.put(userDayKey, String(Math.max(0, userSpent + delta)), {
      expirationTtl: TTL_DAY,
    }),
    env.USAGE.put(globalMonthKey, String(Math.max(0, globalSpent + delta)), {
      expirationTtl: TTL_MONTH,
    }),
  ]);
}

// Rough, deliberately conservative token estimate (chars/3, i.e. fewer
// chars per token than English text really averages) so the pre-call
// reservation errs toward over-counting rather than under-counting.
function estimateInputTokens(outgoing) {
  return Math.ceil(JSON.stringify(outgoing).length / 3);
}

function estimateCostCents(model, outgoing, maxTokens) {
  const price = PRICING[model];
  const inputTokens = estimateInputTokens(outgoing);
  const inCost = (inputTokens * price.in) / 1e6;
  const outCost = (maxTokens * price.out) / 1e6;
  return Math.ceil((inCost + outCost) * 100);
}

function actualCostCents(model, usage) {
  const price = PRICING[model];
  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const dollars =
    (input * price.in +
      cacheWrite * price.in * CACHE_WRITE_MULTIPLIER +
      cacheRead * price.in * CACHE_READ_MULTIPLIER) /
      1e6 +
    (output * price.out) / 1e6;
  return Math.ceil(dollars * 100);
}
