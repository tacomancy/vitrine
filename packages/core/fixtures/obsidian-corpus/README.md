# Obsidian-written corpus — observations

Files in this vault were created and edited in Obsidian by hand (#112) and committed exactly as Obsidian wrote them. This table records what Obsidian *did* with each case; the parser's golden tests (#119) assert every row by its id, and `docs/architecture.md` § Markdown restates the rows as rules.

Fill only the **Observed** column. Use the vocabulary in the *Answer with* column so a test can match it; add a short note after a `—` if something needs explaining.

Obsidian version: 1.13.7 (installer 1.8.10), macOS, 2026-09-21. Rows were answered from the Tags pane; where the console cache (`app.metadataCache.getFileCache`) differed, the pane is the answer and the cache is the note.

## Frontmatter (Properties panel)

| id  | file                              | question                                                        | answer with                                        | observed                                          |
| --- | --------------------------------- | --------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------- |
| F1  | props-list-tags.md                | how does the panel write a two-entry list with a nested tag?    | (file is the record)                               | —                                                 |
| F2a | props-comma-tags.md               | after adding a third tag in the panel, what form is `tags:`?    | `scalar` / `sequence-split` / `sequence-unsplit`   | sequence-unsplit — `- alpha, beta` then `- gamma` |
| F2b | props-comma-tags.md               | what does the Tags view list for this file?                     | tag names                                          | `alpha` and `gamma` — no bare `beta`: the entry `alpha, beta` yields only `alpha`. Cache `frontmatter.tags` shows the raw `["alpha, beta", "gamma"]` |
| F3a | props-legacy-tag-key.md           | does `tag: legacy` survive a reading-mode round trip unchanged? | `yes` / `no`                                       | yes                                               |
| F3b | props-legacy-tag-key.md           | does the Tags view list `legacy`?                               | `read` / `ignored`                                 | ignored — no `legacy` in the pane; the cache exposes the raw `frontmatter.tag` |
| F4a | props-comment-and-order.md        | both `#` comments survived the panel edit?                      | `both` / `first` / `second` / `none`               | none                                              |
| F4b | props-comment-and-order.md        | key order preserved?                                            | `yes` / `no`                                       | yes                                               |
| F4c | props-comment-and-order.md        | single quotes on `zebra` preserved?                             | `yes` / `no`                                       | no                                                |
| F4d | props-comment-and-order.md        | double quotes on `apple` preserved?                             | `yes` / `no`                                       | no                                                |
| F4e | props-comment-and-order.md        | blank line inside frontmatter preserved?                        | `yes` / `no`                                       | no                                                |
| F4f | props-comment-and-order.md        | 4-space list indent preserved?                                  | `yes` / `2-space` / `other`                        | 2-space                                           |
| F5  | props-link-value.md               | how is `[[Sleep and consolidation]]` written as a text value?   | `bare` / `double-quoted` / `single-quoted` / other | double-quoted                                     |
| F6  | props-types.md                    | (file is the record)                                            | —                                                  | —                                                 |
| F7  | props-hashtag-in-text-property.md | does the Tags view list `a-tag`?                                | `counted` / `not-counted`                          | not-counted                                       |
| F8  | props-tag-with-space.md           | what does the Tags view list for `[machine learning, other]`?   | tag names, or `none`                               | `other` only                                      |

## Body tags

| id  | file                      | question                                                      | answer with                          | observed     |
| --- | ------------------------- | ------------------------------------------------------------- | ------------------------------------ | ------------ |
| T1a | tags-valid.md             | how many distinct tags does the Tags view show for this file? | number                               | 7 — `simple`, `with-dash`, `with_underscore`, `nested/two/levels`, `y1984`, `émoji🙂`, `ml/probing`. First recorded as 8, which is the cache's `tags` count for the file: 8 occurrences, both casings of `ml/probing` listed (#158, re-read from the pane 2026-09-21) |
| T1b | tags-valid.md             | `#ML/Probing` and `#ml/probing` — one entry or two?           | `one` / `two`                        | one — the cache lists both occurrences |
| T1c | tags-valid.md             | if one, which casing does the view display?                   | as displayed                         | `ml` → `probing`, lowercase, count 3 (both casings here plus props-list-tags) |
| T1d | tags-valid.md             | is `émoji🙂` counted?                                         | `counted` / `not-counted`            | counted      |
| T2a | tags-invalid.md           | `#1984`                                                       | `counted` / `not-counted`            | not-counted  |
| T2b | tags-invalid.md           | `#tag/` — counted as what?                                    | `not-counted` / `tag` / `tag/`       | `tag` — the trailing slash is dropped |
| T2c | tags-invalid.md           | `#a//b` — counted as what?                                    | `not-counted` / `a` / `a//b` / `a/b` | `a//b` — shown as `a` → *(empty)* → `b`, a literal empty segment |
| T2d | tags-invalid.md           | `# heading-not-tag`                                           | `counted` / `not-counted`            | not-counted  |
| T2e | tags-invalid.md           | bare `#`                                                      | `counted` / `not-counted`            | not-counted  |
| T3a | tags-excluded-contexts.md | `#control` (sanity)                                           | `counted` / `not-counted`            | counted      |
| T3b | tags-excluded-contexts.md | `#infence` (fenced code)                                      | `counted` / `not-counted`            | not-counted  |
| T3c | tags-excluded-contexts.md | `#inindent` (indented code)                                   | `counted` / `not-counted`            | not-counted  |
| T3d | tags-excluded-contexts.md | `#inspan` (code span)                                         | `counted` / `not-counted`            | not-counted  |
| T3e | tags-excluded-contexts.md | `#inwikilink` (wikilink fragment)                             | `counted` / `not-counted`            | not-counted  |
| T3f | tags-excluded-contexts.md | `#inmdlink` (markdown link URL)                               | `counted` / `not-counted`            | not-counted  |
| T3g | tags-excluded-contexts.md | `#inbareurl` (bare URL)                                       | `counted` / `not-counted`            | not-counted  |
| T3h | tags-excluded-contexts.md | `#inautolink` (`<https://…>`)                                 | `counted` / `not-counted`            | not-counted  |
| T3i | tags-excluded-contexts.md | `#inmath` (inline `$…$`)                                      | `counted` / `not-counted`            | not-counted  |
| T3j | tags-excluded-contexts.md | `#incomment` (`%%…%%`)                                        | `counted` / `not-counted`            | counted      |
| T3k | tags-excluded-contexts.md | `#inhtmlcomment` (`<!-- … -->`)                               | `counted` / `not-counted`            | not-counted  |
| T4a | fence-unclosed.md         | `#infence1`                                                   | `counted` / `not-counted`            | not-counted  |
| T4b | fence-unclosed.md         | `#infence2` (after `~~~` inside a backtick fence)             | `counted` / `not-counted`            | not-counted  |
| T4c | fence-unclosed.md         | `#afterfence`                                                 | `counted` / `not-counted`            | counted      |
| T5  | lt-before-tag.md          | `#comparison` after `a < b`                                   | `counted` / `not-counted`            | counted      |
| T5b | lt-before-tag.md          | `#insidehtml`                                                 | `counted` / `not-counted`            | counted — inline HTML is not an excluded context |

## Links

| id  | file                      | question                                                     | answer with                | observed                                                  |
| --- | ------------------------- | ------------------------------------------------------------ | -------------------------- | --------------------------------------------------------- |
| L1a | links-all-forms.md        | `[[Sleep and consolidation]]`                                | `resolves` / `unresolved`  | resolves |
| L1b | links-all-forms.md        | `[[…\|alias]]`                                               | `resolves` / `unresolved`  | resolves |
| L1c | links-all-forms.md        | `[[…#Heading]]`                                              | `resolves` / `unresolved`  | resolves |
| L1d | links-all-forms.md        | `[[…#H1#H2]]`                                                | `resolves` / `unresolved`  | resolves |
| L1e | links-all-forms.md        | `[[…#^blockid]]`                                             | `resolves` / `unresolved`  | resolves |
| L1f | links-all-forms.md        | `[[#Own heading]]`                                           | `resolves` / `unresolved`  | resolves |
| L1g | links-all-forms.md        | `![[Sleep and consolidation]]`                               | `embeds` / `unresolved`    | embeds — the note renders inline in reading mode |
| L1h | links-all-forms.md        | `![[image.png\|200]]`                                        | `embeds` / `unresolved`    | embeds |
| L1i | links-all-forms.md        | `[md link](Sleep%20and%20consolidation.md)`                  | `resolves` / `unresolved`  | resolves |
| L1j | links-all-forms.md        | `[md link](…%20….md#Heading)`                                | `resolves` / `unresolved`  | resolves |
| L1k | links-all-forms.md | `[[Sleep and consolidation\|shown]]` — displayed text? | text as shown | `shown` |
| L1l | links-all-forms.md | `[[Sleep and consolidation\|shown]]` — resolves? | `resolves` / `unresolved` | resolves |
| L2a | links-same-name.md        | `[[Klinzing 2019]]` opens which file?                        | `a/` / `b/` / `asks`       | a/ — equal depth; Obsidian picks the first it indexed (alphabetical) |
| L2b | links-same-name.md        | does Obsidian rewrite the link to include a folder on click? | `yes` / `no`               | no |
| L3  | links-case.md             | `[[sleep AND consolidation]]`                                | `resolves` / `unresolved`  | resolves |
| L4a | links-heading-fragment.md | `[[…#heading]]` (lowercase)                                  | `resolves` / `unresolved`  | resolves |
| L4b | links-heading-fragment.md | `[[…# Heading ]]` (stray spaces)                             | `resolves` / `unresolved`  | resolves |
| L4c | links-heading-fragment.md | `[[…#HEADING]]`                                              | `resolves` / `unresolved`  | resolves |

## Block ids

| id  | file                  | question                                                   | answer with                      | observed       |
| --- | --------------------- | ---------------------------------------------------------- | -------------------------------- | -------------- |
| B1a | blocks-generated.md   | id on the paragraph — placed where?                        | `end-of-line` / `own-line-after` | end-of-line    |
| B1b | blocks-generated.md   | id on the list item — placed where?                        | `end-of-line` / `own-line-after` | end-of-line    |
| B1c | blocks-generated.md   | id on the table — placed where?                            | `end-of-line` / `own-line-after` | own-line-after |
| B1d | blocks-generated.md   | id on the callout — placed where?                          | `end-of-line` / `own-line-after` | own-line-after |
| B1e | blocks-generated.md   | generated id character set (e.g. 6 lowercase alnum)        | describe                         | `^6ea9c9`      |
| B2  | blocks-on-heading.md  | **`[[blocks-on-heading#^c1]]` with `^c1` on a `###` line** | `resolves` / `unresolved`        | resolves       |
| B3a | blocks-handwritten.md | `#^h12`                                                    | `resolves` / `unresolved`        | resolves       |
| B3b | blocks-handwritten.md | `#^c3`                                                     | `resolves` / `unresolved`        | resolves       |
| B3c | blocks-handwritten.md | `#^my-own-id` (on a list item)                             | `resolves` / `unresolved`        | resolves       |

## File shape

| id  | file                            | question                                       | answer with            | observed  |
| --- | ------------------------------- | ---------------------------------------------- | ---------------------- | --------- |
| S1  | shape-no-frontmatter.md         | (file is the record)                           | —                      | —         |
| S2  | shape-frontmatter-not-at-top.md | does the panel show `kind`?                    | `frontmatter` / `body` | body      |
| S3  | shape-crlf.md                   | line endings after an Obsidian edit            | `CRLF` / `LF`          | LF        |
| S4a | shape-bom.md                    | does the panel show `kind` with a BOM present? | `yes` / `no`           | yes       |
| S4b | shape-bom.md                    | BOM still present after an Obsidian edit?      | `kept` / `stripped`    | stripped  |
| S5  | shape-no-trailing-newline.md    | trailing newline after an Obsidian edit?       | `added` / `not-added`  | not-added |
