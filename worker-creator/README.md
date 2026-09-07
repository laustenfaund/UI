# U/I creator (uncapped) proxy

A second Cloudflare Worker, separate from [`worker/`](../worker), that
stands between the [`creator/`](../creator) build of U/I and Anthropic's
API. It's the same idea as `worker/` — holds your real Anthropic API key
server-side, gated by a passcode — with the caps taken out, because this
build is for you, not for guests.

## How this differs from `worker/`

- **No spend cap.** `worker/` reserves cost against a daily/monthly budget
  before every call; this Worker doesn't track cost at all.
- **No max_tokens ceiling.** `worker/` clamps whatever a request asks for
  down to a fixed number; this Worker forwards what the client sends and
  lets Anthropic's own API be the limiter.
- **A generous rate limit stays, as a bug guard, not a budget control.**
  60 requests/minute per passcode, 90/minute per IP — high enough that no
  real interactive session (including the chat-based voice-note builder's
  multi-turn exchanges) should ever hit it. Raise `RATE_LIMIT_PER_MINUTE` /
  `IP_RATE_LIMIT_PER_MINUTE` in `src/index.js`, or remove those checks
  outright, if you'd rather have zero limits.
- **Still passcode-gated**, same reasoning as `worker/`. Add exactly one
  passcode (yourself).

## Setup — dashboard only, same as `worker/`

Mirrors [`worker/README.md`](../worker/README.md)'s setup exactly, just
pointed at a second, separate Worker.

1. **Create the Worker.**
   - Dashboard → **Workers & Pages** → **Create** → **Workers** → name it
     `ui-creator` (or anything — this becomes part of its URL) → deploy
     the placeholder.
   - Open it → **Edit code**. Select all, delete, paste in the entire
     contents of [`src/index.js`](src/index.js) from this folder. **Deploy**.
   - Always replace the *whole* file this way when updating later.

2. **Create two KV namespaces — new ones, not `worker/`'s.**
   - Dashboard → **Storage & Databases** → **KV** → **Create a
     namespace**. Name them something distinct, e.g. `ui-creator-usage`
     and `ui-creator-passcodes`.

3. **Bind the namespaces.**
   - Worker → **Settings** → **Bindings** → **Add binding** → **KV
     Namespace**.
   - `USAGE` → your new usage namespace.
   - `PASSCODES` → your new passcodes namespace.

4. **Add the one plain-text setting.**
   - Same **Settings** page → **Variables and Secrets** → add
     `ALLOWED_ORIGIN` — the exact origin `creator/index.html` is served
     from, no trailing slash.

5. **Add your Anthropic key as a secret.**
   - Same page → **Variables and Secrets** → add `ANTHROPIC_API_KEY`, type
     **Secret**. Can be the same key `worker/` uses, or a different one.

6. **Redeploy after saving Settings** — same Cloudflare quirk as `worker/`:
   go back to **Edit code** → **Deploy** again to force the new
   bindings/secret to take effect.

7. **Copy the Worker's URL** from its overview page:
   `https://ui-creator.<your-subdomain>.workers.dev`. Paste that into
   `ASSISTANT_PROXY_URL` near the top of the `<script>` block in
   `creator/index.html`.

8. **Create your one passcode.** Same process as `worker/README.md` step 9
   — hash it in a browser console, then Dashboard → **Storage & Databases**
   → **KV** → this Worker's `PASSCODES` namespace → **Add entry**:
   - Key: `passcode:` + the hash.
   - Value: `{"name":"you","active":true}`.
   - Or run `node worker-creator/scripts/add-passcode.mjs "your-passcode" "you"`
     for the exact `wrangler kv key put` command instead.

## Cost note

There is no cap here — this Worker will forward whatever `creator/`
sends, and you pay Anthropic for all of it. Keep an eye on
`console.anthropic.com` yourself.
