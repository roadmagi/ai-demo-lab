# Demo video script — 75 seconds

Record at 1280×720 or larger, browser zoom ~110% so text is readable in
Upwork's small player. No intro card, no logo animation — the first frame
should already be the product.

**Before recording:** ask each suggested question once so they're warm in the
cache and answer instantly. Then hard-refresh so the conversation is empty.

---

### 0:00–0:08 — Open on the thing that's different

*(Screen: `/chat`, empty state)*

> This is a support agent for a fictional SaaS company. It answers from a help
> center — but the interesting part isn't that it answers.

*Click the suggested question "How do I export all my project data?"*

---

### 0:08–0:25 — The citation click

*(Answer streams in with numbered footnotes)*

> Every claim has a footnote. These aren't references the model wrote out —

*Click footnote 1. The source pane scrolls and highlights.*

> — they're character offsets the API returns, so clicking one jumps to the
> exact sentence the answer came from. It can't cite something the document
> doesn't say.

*Click footnote 2 to show it jumping to a different span.*

---

### 0:25–0:45 — The refusal

> The failure mode that kills these projects is the confident wrong answer.
> So let's ask something the help center genuinely doesn't cover.

*Click "Do you have a mobile app?"*

> It says so. No invented feature, no "typically products like this" — and it
> offers a human instead.

*(Point at the "Not covered by the docs" badge and the escalation button)*

---

### 0:45–1:00 — The gap report

*Click "Ask a human instead", fill the email, send. Then navigate to `/chat/gaps`.*

> And every refusal lands here, ranked by how often it was asked. That's the
> list of docs the support team should write next — generated as a side effect
> of running the bot, not as a separate research project.

---

### 1:00–1:15 — Close on the engineering

*Back to `/chat`. Point at the token badge under an answer.*

> It's a real API key on a public URL, so there's a response cache, a
> per-visitor rate limit, and a daily token budget in front of the model — the
> corpus is prompt-cached, which is why repeat questions cost about a tenth as
> much.

*Optional, if the recording is running short: click "Use your own document",
upload a file, ask one question about it.*

> And you can point it at your own document.

> Full write-up and source in the description.

---

## If you only have 30 seconds

Cut to: the citation click (0:08–0:25) and the refusal (0:25–0:45). Those two
moments are the entire pitch. Everything else is supporting evidence.

## Thumbnail frame

Grab a still with the answer visible on the left and a highlighted citation
span on the right — the split view with an active highlight is the single
clearest image of what this does.
