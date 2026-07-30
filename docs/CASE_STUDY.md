# Case study — a support agent you can actually put in front of customers

*Paste-ready for an Upwork proposal. Swap the fictional client for a real one
once this ships for someone.*

---

## The problem

Almost every "chatbot trained on our docs" project fails the same way in
production, and it isn't a retrieval problem.

The bot answers confidently when it shouldn't. A customer asks something the
help center doesn't cover, and instead of saying so it produces a fluent,
plausible, wrong answer — the SSO tier that doesn't exist, the refund window
nobody promised. Support then spends more time undoing those answers than they
saved.

The second failure is quieter. Even when the bot behaves, nobody learns
anything from it. The questions it couldn't answer are exactly the list of docs
that should be written next, and that list goes nowhere.

## The approach

Three decisions, each aimed at one of those failures.

**1. Make citations verifiable rather than decorative.**
Sources are passed to the model as document blocks with citations enabled, so
the API returns the exact character range behind each claim. The UI renders
those as footnotes; clicking one highlights the precise sentence in the source.
A citation cannot point at text the source doesn't contain, because the offsets
come from the API rather than from the model's prose. Reviewing an answer stops
being a matter of trust and becomes a matter of clicking.

**2. Make "I don't know" a first-class outcome.**
The system prompt gives the model an explicit signal to emit when the sources
don't cover a question. The UI treats that as a distinct state: no invented
answer, a visible "not covered by the docs" marker, and an immediate handoff to
a human. The demo ships with two questions the corpus deliberately doesn't
answer so this can be watched rather than described — and a test that keeps
them uncovered, so a later edit can't quietly remove the proof.

**3. Turn refusals into a work item.**
Every refusal is logged and ranked by frequency, with escalation counts
alongside. The result is a content-gap backlog that maintains itself: the
support team opens one page and sees what to write next, ordered by how many
customers asked.

## What it cost to run safely

A public demo on a real API key is an unbounded bill unless something stands in
front of it. Three layers do:

- A **response cache** keyed on the question and a fingerprint of the corpus —
  the first visitor to ask something pays for it, everyone after reads the
  stored answer, and editing a source document invalidates only what it should.
- A **per-visitor rate limit** on live questions. Cache hits bypass it, because
  serving them costs nothing.
- A **daily token budget** for the whole deployment, counted from the API's own
  usage numbers rather than an estimate.

When a limit trips, the visitor gets a cached answer and an honest explanation
rather than an error page.

Cost per answer is dominated by the corpus, which is identical on every request
— so it sits behind a prompt-cache breakpoint and is read back at roughly a
tenth of the input price.

## Engineering notes

- **Retrieval strategy is chosen by corpus size.** A small corpus is sent whole,
  which answers better than retrieval — the model sees everything, so "none of
  this covers it" is a real conclusion — and caches as one stable prefix. An
  arbitrary uploaded document is chunked and retrieved with BM25 against a token
  budget. Same pipeline, different strategy, picked deliberately.
- **BM25 over embeddings** at this scale: no vector database, no second
  provider, no extra key. The retrieval module is the only thing that changes if
  that trade stops making sense.
- **Uploads are text-only** because PDF citations come back as page numbers
  rather than character offsets, which would break the click-to-verify
  behaviour the whole demo rests on.
- Unit tests cover retrieval ranking and budgeting, citation accumulation and
  offset mapping, the guard's cache/limit/budget transitions, span highlighting,
  and upload ownership.

## Result

A support agent whose answers can be checked in one click, that declines
instead of guessing, that produces a content backlog as a by-product, and that
can be left on a public URL without an open-ended bill.

**Live demo:** *(add the deployed URL)*
**Source:** *(add the repo URL, or offer it on request)*
