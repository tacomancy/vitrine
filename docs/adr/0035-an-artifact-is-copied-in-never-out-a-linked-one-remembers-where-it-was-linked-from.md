# 0035: An Artifact is copied in, never out; a linked one remembers where it was linked from

**Status:** Accepted

Experiment Artifacts are the first vault content that is neither Markdown the user wrote nor a PDF they acquired (brief § Artifact storage). They exist nowhere else, so losing one loses the result. ADR 0008's closed set of write operations covers Markdown only, and "Vitrine never moves a byte" (`docs/architecture.md` § Decided, KEEP-11) was written about the PDF folder. Beat 4 (#171) had to say who puts an Artifact's bytes in the vault, and what a heavyweight Artifact left outside it records about itself, so that attaching it as Evidence can check it (story TEST-13). Settled in the beat 4 grill, together with #94's threshold.

## Decisions

1. **The app copies a stored Artifact in.** Adding one on the Experiment page, by *+ artifact* or by dropping a file on it, copies the file into `experiments/<name>/` and appends its line to `## Artifacts`, as one write. The copy is written to a temp file and renamed, as every write is, and the source file is left where it was. This is an eighth kind of write, the only one whose bytes are not Markdown, and it reopens ADR 0008 for this case alone: `copyArtifact(source, experiment)`.
2. **Never out, never moved.** No operation copies an Artifact out of the vault, moves one between Experiments, or deletes one. Removing its line from the page leaves the file in the folder, where decision 3 finds it again. A file the app never took in is never the app's to touch.
3. **A file that arrives by other means is offered, not adopted.** A plot a script wrote into the Experiment's folder, or one dragged there in Finder, is an Index row with no line on the page. The page draws it as *in the folder, not on the page*, with *show it here*, which appends the line and copies nothing.
4. **The threshold proposes, and the user decides.** Under 25 MB is proposed as stored, and anything heavier is proposed as linked, with the warning the brief asks for (#94). Either proposal can be overridden per Artifact. The number is a code constant and a property of the Artifact, never a Setting (ADR 0025 decision 2).
5. **A linked Artifact remembers where it was linked from.** Its line records the path or URL, size, date and description (ADR 0006 decision 8), plus the machine's computer name and a Fingerprint. The Fingerprint is the size, the modification time, and a SHA-256 of the first and last mebibyte. All of it is plain text in the vault, readable in Obsidian.
6. **The check runs when the Artifact is trusted, and never refuses.** Attaching an Experiment as Evidence checks each linked Artifact and says one of three things: *here and unchanged*, *on another machine* (named), or *changed or gone*. None of them blocks the attach. A URL is not checked, and the page says so. The check would need a network call and often a login, and a claim the app has not checked is not one it makes.
7. **A link made on another machine is never judged missing here.** The Loose Ends row for a missing linked Artifact (REP-6) fires only for links recorded on this machine. Otherwise the two-machine arrangement KEEP-11 leaves to the researcher would fill the dashboard with rows nobody can resolve from here.

## Considered options

- **The user places every stored Artifact, and the app never writes a binary.** Rejected: *+ artifact* and drop-to-add are what the prototype drew and what makes plots "the record" (design-prompts § Experiment view). It is kept as decision 3, because scripts that write plots into a results folder are the other honest path.
- **A full SHA-256 as the Fingerprint.** Rejected: a 40 GB checkpoint takes about a minute to hash, at the moment the user is attaching Evidence. Size and modification time alone miss a replacement of the same size. The first and last mebibyte catch that without reading the file whole.
- **Size and modification time only.** Rejected for the same reason: *unchanged* would be a claim resting on two fields that a copy or a `touch` can make agree.

## Consequences

- **+** The vault stays self-contained for everything under the threshold, and the app is the only thing that writes those bytes when the user adds a file on the page.
- **+** Evidence resting on a file outside the vault is checked at the moment it is trusted, and the two-machine case is named rather than reported as loss.
- **−** Stored Artifacts are the vault's one byte-growth vector (ADR 0006 Consequences). Nothing here caps the total, and the per-Artifact override can store a 2 GB file if the user asks for it.
- **−** The Fingerprint can call a file unchanged when only its middle changed and its size and modification time were restored. That takes deliberate effort, and the page says *same size, date and ends* rather than *identical*.
- **−** The Host gains a second method, `pickFile`, for *+ artifact*'s chooser. `CONTEXT.md`'s Host is no longer one method.
