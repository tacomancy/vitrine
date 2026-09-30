# 0038: A Reader-made Question writes `Q:` into the PDF

**Status:** Accepted

The `Q:` convention (ADR 0013 decision 8) lets a highlight's note become a Question on Ingest, which is how a pencil on an iPad asks one. The Reader can ask one too, from the page, in one keystroke. The open choice was whether a Question made from a selection should write that same convention into the PDF, or be a Question that merely remembers where it came from and leave the PDF alone.

With no selection there is nothing to write into, and the choice does not arise.

## Decisions

1. **With a selection, the Reader writes `Q: <text>` as the highlight's note.** The PDF then says the same thing in Preview, on the iPad and in the Reader, and is a complete record without the vault beside it. A Question that lived only in the vault would leave a highlight with no sign it had asked anything.
2. **The highlight and the Question are one act, and the once-only flag is set by it.** `sources.question` runs the ordinary highlight write (ADR 0007 decisions 6 and 12) and lets the Ingest pass that records the new annotation spawn the Question, in the same pass that writes the sidecar. The annotation's `question:` is therefore set before anything can read the `Q:` back, and no later Ingest spawns a second. There is no second code path that decides what a `Q:` note is.
3. **The Question's `context` is `reading`, not `ingest`.** It carries the Source, the page and the annotation's block as an ingested one does, and the passage as its body. The difference is who made it: the Inbox shows *ingest* for a Question the convention found and nothing extra for one the user made in the Reader.
4. **With no selection it is a Question and nothing else.** `context: reading`, the Source and the page in view, no `annotation:`, and the PDF's bytes are not opened for writing. `questions.capture` takes it, as it takes every other Provenance; its `reading` input has no annotation, because the window never decides that one.
5. **The chord is the window's.** ⌘' resolves its Provenance from what is open, as on every surface (ADR 0027 decision 1): the Reader publishes its Source, the page in view and the selection, and the chord reads them. ⌘K is unchanged and works from the Reader; with a selection it captures on the Source and page and does not write a highlight, because the highlight belongs to the one keystroke that names it.
6. **A refusal is the highlight's.** A selection over an image or a scanned page is refused in the core's words, and no Question is made, because a Question whose `Q:` could not be written would be the half-made thing decision 1 rules out.

## Considered options

- **Write the Question, then the highlight.** Rejected. A crash between the two leaves a Question with a block that does not exist, and Ingest, finding the `Q:` later, would spawn a second.
- **Write the highlight and let the next Ingest spawn the Question.** Rejected. The Question would arrive late and as *ingest*, with no word to the user that it had landed, and a failed spawn would surface a run later.
- **A colour picker on the chord.** Rejected. One keystroke and the typed question is the act; a Question's highlight is yellow, and the `?` glyph, not the colour, says it is one (spec #416 story 79).

## Consequences

- `Provenance` gains `reading`; `Question.context` gains the same value. A Question file from a selection has `page:` and `annotation:` and a `> passage` body, as an ingested one does.
- A failed spawn after a written highlight leaves a `Q:` highlight with no Question. The next Ingest finds it and spawns one, as *ingest*. That is the convention working, not a duplicate: the flag is unset, so there is no second.
