<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AI Demo Lab

A portfolio of working AI systems, deployed at https://ai-demo-lab-azure.vercel.app.
Demo 1 (`/chat`) is live. `/extract` and `/repurpose` are placeholder cards on the
hub with no routes behind them — the cards render as non-clickable `<article>`s, so
the missing routes aren't reachable.

## Commands

```
npm run dev      # Turbopack dev server (only one per directory — Next 16 refuses a second)
npm test         # vitest, 89 tests across 6 files
npm run lint     # eslint
npm run build    # production build
```

Run `npm test` and `npm run lint` before calling anything done. Both are fast.

## Stack

Next 16.2.12 App Router · React 19 · Tailwind v4 · TypeScript · vitest ·
`@anthropic-ai/sdk` · `@upstash/redis` · deployed on Vercel.

`@/` resolves to the repo root.

## Layout

```
app/           routes; api/chat streams SSE, api/upload and api/escalate return JSON
components/    ChatWorkbench (the demo's UI), SourcePane, DocumentBar, EscalationForm
content/       the seed help-center corpus, six markdown files under kestrel/
lib/           all the logic — see below
tests/         vitest, one file per lib module
docs/          CASE_STUDY.md and VIDEO_SCRIPT.md (portfolio copy, not code)
```

**`lib/` at a glance:**

| File | What it owns |
|---|---|
| `anthropic.ts` | Model config, system prompt, document blocks with citations enabled |
| `citations.ts` | Streams the API's citation deltas into an `Answer` of segments + spans |
| `corpus.ts` | Loads and chunks markdown docs |
| `retrieval.ts` | Keyword ranking over chunks, used only for uploads |
| `highlight.ts` | Splits answer text into rendered pieces by citation span |
| `guard.ts` | Cache, rate limit, daily token budget, `recordTurn` bookkeeping |
| `store.ts` | The KV interface, Redis/memory implementations, resilience |
| `uploads.ts` | Bring-your-own-document storage, TTL, ownership |
| `gaps.ts` | Unanswered-question log behind `/chat/gaps` |
| `protocol.ts` | The SSE event shape, shared by route and client |
| `kestrel.ts` | The fictional company the demo is built around |

## Invariants — break these and production breaks quietly

**Bookkeeping must go through `after()`.** This is serverless: once the response
closes, the instance can be frozen before a write to Redis lands. `app/api/chat/route.ts`
hands `recordTurn` to `after()` from `next/server` for exactly this reason. Work
scheduled any other way after `controller.close()` is racing the freeze, and it
loses silently — `Promise.allSettled` swallows the rejection, and the cache, the
token budget, and the gap log all no-op with no error anywhere.

**Rate limits and budget exhaustion return HTTP 200, not 429.** They're delivered
as an SSE `notice` event so the UI can explain them in place. If you probe
`/api/chat` for a status code you'll conclude the limiter is broken when it isn't.
`/api/upload` *does* use a real 429 — the two routes differ on purpose.

**`lib/guard.ts` contains a literal NUL byte** at line 78, inside the cache-key
hash: `` `${corpusFingerprint}\0${normalizeQuestion(question)}` ``. It's a domain
separator preventing hash-boundary collisions, and it makes grep report the file as
binary. Leave it — that is not corruption.

**`getStore()` lives on `globalThis`,** keyed by `Symbol.for("ai-demo-lab.store")`.
Next bundles route handlers and pages into separate module graphs, so a
module-scoped singleton gives `/api/escalate` and `/chat/gaps` two different
`MemoryStore` instances — writes land in one, reads come from the other, and the
gap report silently stays empty. Hot reload has the same effect.

**`new Redis()` validates its URL in the constructor.** A malformed value throws
before any call is made, which is why `createStore()` wraps construction in
try/catch rather than relying on `ResilientStore`'s per-call guard. Related:
`credential()` strips one layer of surrounding quotes, because dashboards store
whatever was pasted into them and `"https://…"` is not a URL.

**The corpus is read from disk at request time.** File tracing can't see a dynamic
`readdir`, so `next.config.ts` lists `content/**/*` in `outputFileTracingIncludes`.
Move or rename `content/` and the deployed bundle loses the markdown.

## How the chat demo works

Two context strategies, picked by corpus size:

- **Seed corpus** — small enough to send whole. Better answers (the model sees
  every document, so "none of these cover it" is a conclusion it can actually
  reach) and it caches as one stable prefix behind a cache breakpoint on the last
  block.
- **Uploaded document** — unknown size, so it's chunked and retrieved against a
  6,000-token budget. Retrieved chunk text ships with the response, because the
  client doesn't have it and a citation needs something to highlight.

Citations come from the API's own character offsets into the document blocks, not
from anything the model writes. That's what makes them verifiable rather than
decorative — never replace them with model-authored references.

Refusal is explicit: no supporting document means the answer is `[[NO_ANSWER]]`,
which the route turns into `noAnswer: true`, logs as a content gap, and the UI
turns into an offer to reach a human.

## Guards

Three layers in `lib/guard.ts`, checked in order, and the order matters:

1. **Response cache** — an identical question costs nothing twice
2. **Per-visitor rate limit** — fixed window, 12/hour by default
3. **Global daily token budget** — 300k tokens per UTC day

A cache hit skips 2 and 3 deliberately: serving it is free, so there's nothing to
ration. Visitor identity is a SHA-256 of the forwarded IP — raw addresses are never
written to the store.

## Environment

`ANTHROPIC_API_KEY` is required. `UPSTASH_REDIS_REST_URL` / `_TOKEN` are optional
locally and **required in production** — without them everything falls back to
process memory, which is fine for `npm run dev` and useless across serverless
instances. See `.env.example` for the tuning knobs.

Never print, echo, or commit a key. To confirm a credential without exposing it,
compare SHA-256 fingerprints. `.env.local` is gitignored; `.env.example` is
deliberately not, and the negation in `.gitignore` is order-sensitive — a later
`.env*` line silently re-ignores it. `vercel link` appends both, so check
`git diff` after running it.

## Conventions

Comments explain *why*, not *what*, and several of them record a production
failure — treat those as load-bearing. Tests are TDD: write the failing test,
watch it fail, then implement. When a bug shows up, reproduce it in a test first.
