# U/I

A text-to-text tool that reworks a neurodivergent person's own message into
phrasing more legible to a neurotypical reader — aimed at diffusing the
tension misunderstanding causes, not just at literal fidelity.

- **`index.html`** — the app. A single portable file, no build step, no
  server. Open it directly, or serve it as a static site (e.g. GitHub Pages)
  to install it on a phone.
- **`DESIGN.md`** — the reasoning behind every decision in it: why the
  translation direction is ND → NT only, where personalization comes from
  and why it's user-authored rather than inferred, why output isn't claimed
  to be 100% complete, and what's deliberately out of scope for this version.

Bring-your-own Anthropic API key — the app calls the Claude API directly
from your browser. Your key, your voice notes, and any chat-archive-derived
data are stored only in your own browser and are never sent anywhere except
directly to Anthropic when you translate.
