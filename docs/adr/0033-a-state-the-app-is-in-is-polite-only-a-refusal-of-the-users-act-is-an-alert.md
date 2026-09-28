# 0033: A state the app is in is polite; only a refusal of the user's act is an alert

**Status:** Accepted

ADR 0032 decision 11 named the drift in the shipped Inbox: a failed listing carried on `role="alert"`, which is assertive and interrupts a screen reader mid-sentence. That is at odds with prototype 12's *wrong* Voice — *"never red, can't be dismissed"* — and with the standing rule that a failure is stated in the same quiet voice as an ordinary fact. The renderer had eleven `role="alert"` sites and no rule for which of them earned it. Spec #344 asked for the question to be answered deliberately rather than by a drive-by edit; the answers below were settled on #344 on 2026-09-28 and ship with #345.

## Decisions

1. **The line is who acted.** `role="alert"` is for a **refusal of something the user just did**: a vault that would not open, a capture the core would not write, a triage key it refused, a link the picker could not make, a resolution on Loose Ends that did not land. The user is waiting on that act, the answer arrives because of it, and interrupting is what they asked for. `role="status"` is for a **state the app is in**: the *wrong* Voice — a listing that failed, a vault that is not watched. Nobody asked; the fact is simply true until it stops being true, so it is announced politely and never interrupts. Progress (*reading the vault · 1,250 of 8,400 files*) has no live region at all, because it changes on every chunk of a sweep and a polite region would still chatter.
2. **The *wrong* Voice's reason goes to the footer channel and nowhere else**, prototype 12's rule, extended to a failure that is the surface's own and not the vault's. A failed Inbox listing is a footer line, `‖ not read — <reason>`, beside the vault's `‖ not watching — <reason> · retry`, and a `vault.status` that failed is `‖ vault state not known — <reason>`; the first slot says only `‖ not known`. The paragraph that used to sit under the header is gone. Putting the reason inline in the slot was rejected: it would give one failure two places to speak, which is how a surface ends up with two half-versions of the same message.
3. **Only a read in full, while watched, may claim.** The Inbox's first slot is the *claim* only when the listing answered with nothing, `vault.status` answered, no sweep is running, and the watcher is live. A sweep in progress, or an answer not yet arrived, is *not yet*. A watcher that is down, a `vault.status` that failed, a listing that failed, or a listing with files it could not read is *wrong*: an Inbox swept once and then left unwatched is accurate as of the sweep and nothing more, so it cannot warrant `read in full · watching`. A surface with rows shows its rows whatever the Voice would have been; the Voice speaks only where the rows would begin. The Inbox's header count goes with it: an Inbox with no Question in it shows no `0 questions`, because the claim is the only word on how many and a zero beside it reads as *all clear* (prototype 12, panel 2).
4. **The claim's paragraph describes only ways in that exist.** Prototype 12's paragraph names two: `⌘'` from anywhere, and `Q` on a passage in the Reader. The Reader is beat 5, so the second clause is left out until it ships; a line describing how questions arrive is a description, and a description of a path that is not there is a promise.

## Considered options

- **No live region for the *wrong* Voice.** Rejected: a failure that arrives after the page is read — the watcher dying mid-session — would then never be announced at all, which is a silent failure for a screen-reader user.
- **`status` everywhere, refusals included.** Rejected: a refusal answers a keypress the user is waiting on, and a polite announcement queued behind whatever the reader is saying arrives after they have moved on.

## Consequences

- The eight refusal sites keep `role="alert"`; the Inbox's triage refusal is pinned by `promote.test.tsx`. Loose Ends' failed read and its *problems* lines are states and move to `status` in #346.
- `docs/architecture.md` § Index, Status carries the footer wording prototype 12 drew.
