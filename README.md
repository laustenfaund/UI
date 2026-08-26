# U/I

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A text-to-text tool that reworks your own message into phrasing more legible
to a reader who communicates differently than you do — aimed at diffusing
the tension misunderstanding causes, not just at literal fidelity.

## Features

- **Translate** — paste or write a message and get a version reworded for a
  reader who communicates differently than you do, with an honest note when
  part of it didn't fully carry over.
- **Detail level** — per message, choose Plain, Balanced, or Full detail:
  how much nuance survives versus how quick the result is to read.
- **Incoming mode** — flip it around: paste a message you received and get
  what it likely means, plus anything worth watching for that could be easy
  for you specifically to misread.
- **Your voice** — a freeform, user-authored description of how you
  naturally communicate, read before every translation. Nothing about your
  style is inferred silently. Share it (as plain text) with someone else so
  their copy of U/I can read your messages more accurately in incoming mode.
- **Chat archive uploads** (optional) — draft a starting point for your
  voice notes from a ChatGPT or Claude export. Only your own messages are
  read; a draft is never saved without your review.
- **Built-in manual** — click "manual" in the app for a full walkthrough of
  every feature.

## Getting started

U/I is a single portable HTML file — no build step, no install.

1. Download [`index.html`](index.html) (or clone this repo).
2. Open it directly in a browser.
3. Click **settings**, paste in your own [Anthropic API key](https://console.anthropic.com/), and save.
4. Type a message and click **translate**.

It can also be served as a static site (e.g. GitHub Pages) so it installs
like an app on a phone — the same file works both ways.

## Privacy & data

U/I calls the Claude API directly from your browser using your own API key.
There is no server, no account with U/I itself, and nothing is sent
anywhere except the direct call to Anthropic when you translate. Your key,
voice notes, and any archive-derived messages are stored only in your
browser's local storage. **Clear all local data** in the app permanently
deletes all of it — a real delete, not a UI reset.

## Repository contents

| File | What it is |
| --- | --- |
| [`index.html`](index.html) | The app. |
| [`DESIGN.md`](DESIGN.md) | The reasoning behind every decision in it — where personalization comes from, why output isn't claimed to be 100% complete, and what's deliberately out of scope. |
| [`manifest.json`](manifest.json), [`sw.js`](sw.js), [`icons/`](icons) | Make the app installable on a phone once hosted (e.g. GitHub Pages) — app icon, name, and a minimal offline shell cache. |
| [`LICENSE`](LICENSE) | MIT. |

## Why it isn't 100%

U/I won't claim a message translated completely when it didn't; some things
genuinely don't have a clean equivalent for a different kind of reader, and
that's disclosed rather than smoothed over. See [`DESIGN.md`](DESIGN.md) for
the full reasoning.

## License

[MIT](LICENSE)
