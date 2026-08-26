# U/I

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A text-to-text tool that reworks a neurodivergent person's own message into
phrasing more legible to a neurotypical reader — aimed at diffusing the
tension misunderstanding causes, not just at literal fidelity.

## Features

- **Translate** — paste or write a message and get a version reworded for a
  neurotypical reader, with an honest note when part of it didn't fully
  carry over.
- **Detail level** — per message, choose Plain, Balanced, or Full detail:
  how much nuance survives versus how quick the result is to read.
- **Your voice** — a freeform, user-authored description of how you
  naturally communicate, read before every translation. Nothing about your
  style is inferred silently.
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
| [`DESIGN.md`](DESIGN.md) | The reasoning behind every decision in it — why translation is one direction only, where personalization comes from, why output isn't claimed to be 100% complete, and what's deliberately out of scope. |
| [`LICENSE`](LICENSE) | MIT. |

## Why one direction, and not 100%

U/I only reworks neurodivergent phrasing into neurotypical-legible phrasing,
on purpose — the work of crossing that gap already falls disproportionately
on neurodivergent people, and this meets people where that labor already
sits rather than claiming to fix the imbalance itself. It also won't claim a
message translated completely when it didn't; some things genuinely don't
have a clean equivalent, and that's disclosed rather than smoothed over. See
[`DESIGN.md`](DESIGN.md) for the full reasoning.

## License

[MIT](LICENSE)
