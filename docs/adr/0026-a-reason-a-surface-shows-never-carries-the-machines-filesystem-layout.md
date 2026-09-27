# 0026: A reason a surface shows never carries the machine's filesystem layout; the cut is shared, the words are the call site's

**Status:** Accepted

Three bugs in a row (#277, #285, #288) were one defect: `errorMessage(cause)` — Node's errno, `${code}: ${description}, ${syscall} '${path}'` — used to build a reason a surface prints. The absolute path reached the window, and from there a screenshot and any bug report pasted out of one. Every message that carried it already named the file it was about, so the errno repeated the path and then added the part no reader can use.

Decided, and it is two decisions rather than one:

- **The cut is shared.** `errorMessageWithoutPath` in `packages/core/src/errors.ts` removes the text Node appended, by the error's own `syscall` and `path` fields. Every reason a surface shows goes through it.
- **What a reason says *instead* of an errno is the call site's.** Only the call site knows what its own failure means, so no shared helper decides the words.

`errorMessage` itself is unchanged. Its other callers are `console.error` lines, where the path is the useful part and no reader is being written for.

## The words, per surface

Two surfaces give ENOENT the app's own words, and they are deliberately different because they mean different things by an absent file:

| Surface | ENOENT says | Because |
| --- | --- | --- |
| The Research Question page's not-found line (#277) | *missing from the vault* | A page reached by a stale hash or a link into a page since renamed. The register of the *removed from the vault* line beside it. Not *is not in the vault*, which `locate` already uses for a path **refused** for being outside the root — the opposite meaning. |
| A triage action's refusal (#285) | *the file is no longer there* | The Inbox listed the row, or the page resolved its link, and the file is gone by the time the write reads it. The same words `vault-files.write` refuses that same absence with one step later in the same write. |

Everywhere else — the walk, the sweep, the index and queue open, the watcher, every write (#288) — **ENOENT keeps its cause**. Those are not absences anyone is waiting on, and there the errno names something the reader can act on. A third surface makes its own call rather than copying either of these.

## Considered options

- **Strip inside `errorMessage`.** Rejected in #277 and it still holds: most of its callers are logs, where the path is what makes the line worth having. Changing the shared accessor would take it away from every one of them to fix the few that print to a person.

- **A regex over the message — cut back to the quote the path opens with.** What #285's first pass did, and it was a no-op on any path containing an apostrophe: `[^']*` cannot cross one, so the match never happens and the whole path survives. The real vault is `Wan Shi Tong's Library`, and a Question is named after the question, so this is the ordinary case rather than the exotic one. It passed every apostrophe-free fixture. Cutting by the error's own fields has nothing to parse and cannot be fooled this way.

- **One helper that decides the words too.** Rejected: the two surfaces above want different sentences for the same errno, and a helper that chose for them would have to be told which surface was asking — which is the call site knowing, with extra steps.

- **A backstop in the tRPC `errorFormatter`,** stripping the path from anything that escaped a procedure unwrapped. Built during #288 and removed. It works, and it closes the class a grep cannot find — the sites with no `errorMessage(` call, which is how `vault.ts`'s `remember` and `dismissals.ts`'s `save` went unnoticed. But testing it needs a site left unwrapped on purpose, and an untested rewriter of every outgoing message is a worse risk than the one it covers. The two real sites were named by hand instead.

- **Make the reasons vault-relative paths rather than removing them.** Rejected as a general rule: the index and queue folders are the only ones where a relative path is meaningful, and they name it in the message already. The app-support folder has no vault to be relative to, and naming it tells the reader nothing they can act on — `Couldn't remember the vault` says the useful half.

## Consequences

- **+** One sentence states the rule, and any message can be checked against it by eye.
- **+** The cut survives an apostrophe, a two-path errno (`rename 'a' -> 'b'`, which the write protocol makes on every commit — cutting *at* what Node appended drops the second path with the first), and an error carrying no path at all.
- **+** `packages/core/src/errors.test.ts` pins the contract at the seam, including the two shapes no `fs` call can throw, so a caller that re-throws or wraps an errno is covered before it exists.
- **−** The rule is only as good as the audit behind it. #288's own issue listed four sites that carry no path and missed three that do, because it was written from a grep for `errorMessage(`; the sites that let an errno out of a procedure unwrapped have no call to grep for. A later one will be found the same way this one was — by a test, or by reading a message on a surface.
- **−** Two spellings now exist for the same fact, on two surfaces of the same page: its not-found line says *missing from the vault* and its write-back says *the file is no longer there*. That is the decision, not drift — but it is the kind of thing that reads as an inconsistency to someone meeting it without this file.
- **−** A message that names no path at all leans entirely on its own wording to say what failed. `questions.ts`'s capture had to split one catch into two for exactly this reason: with the errno's path gone, nothing else distinguished the Question's write from the vault marker's. Any new message of this shape has to carry that weight itself.
