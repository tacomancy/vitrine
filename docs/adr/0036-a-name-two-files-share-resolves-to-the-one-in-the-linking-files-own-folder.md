# 0036: A name two files share resolves to the one in the linking file's own folder

**Status:** Accepted

The index calls a bare name that reaches two files *ambiguous*. It resolves to nothing and raises a Loose Ends row, rather than picking the first file indexed as Obsidian does (L2a, `docs/architecture.md` § Markdown, Divergences). An Experiment stores each Artifact beside its page and embeds it by bare name, `- ![[plot.png]] — caption` (ADR 0035, § Vault layout (Experiment)). Names like `plot.png` and `loss.png` repeat from run to run, so under that rule every stored Artifact would go ambiguous once a second run kept a file with the same name. The page would still draw the right file, but Loose Ends would have a row for every run, and a user can't act on any of them.

Obsidian doesn't pick the first file indexed in that case. `getLinkpathDest` in 1.13.7 ranks candidates under the linking file's folder ahead of the rest, shortest path first. Links and embeds go through the same function. Corpus rows L2c and L2d observe it: from `b/`, `[[Klinzing 2019]]` reaches `b/`'s file although alphabetical order puts `a/` first, and two runs each embedding `![[plot.png]]` each draw their own.

## Decisions

1. **When exactly one candidate sits in the linking file's own folder, the name resolves to it.** This applies to links and embeds alike, as it does in Obsidian.
2. **Only the linking file's own folder counts.** Obsidian's test is a string prefix of the folder path. It also ranks a candidate in a subfolder, or in a sibling folder whose name starts with the folder's name (`run 2/` from `run/`), and then breaks ties by path length. The app treats those cases as ambiguous, as it did before. A file sitting beside the linking file is the one case Obsidian settles without guessing. For a note at the vault root, the rule applies to other files at the root. L2a stays ambiguous because its two candidates are in `a/` and `b/`, not beside the linking file.
3. **Stored lines keep the bare name.** `copyArtifact` writes `![[plot.png]]` whatever else in the vault carries the name, which is also what Obsidian's *shortest path when possible* setting writes.

## Considered options

- **Path-qualify the stored line when the name is taken elsewhere.** Rejected. The collision usually comes after the line is written: run A stores `plot.png` while the name is unique, and run B stores its own a week later. A's line would go ambiguous anyway. Qualified lines would also differ from what Obsidian writes for the same embed.
- **Adopt Obsidian's whole ranking.** Rejected: the prefix match and the shortest-path tie-break are the same first-indexed guess the divergence exists to refuse, just with a different ordering.

## Consequences

- **+** An Experiment's Artifacts stay out of Loose Ends however many runs share a file name, and the index agrees with the page about which file each line means.
- **+** The divergence from Obsidian narrows to cases where Obsidian itself is guessing.
- **−** Resolution depends on where the linking file is. Moving a note to another folder can change what its bare links reach. The recompute already runs per link, with the linking path in hand, so no extra machinery is needed. A reader should still know that folder matters.
