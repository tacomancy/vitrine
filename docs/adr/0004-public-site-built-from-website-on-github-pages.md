# 0004: The public site is built from `website/` and deployed to GitHub Pages

**Status:** Accepted

The repository's GitHub Pages is already bound to the apex `tacomancy.com` (workflow build type, HTTPS enforced), and the tree wipe that started the reimagining removed the v1 site and its deploy workflow, so the domain has been serving v1's last deployment since. The site is rebuilt from scratch in `website/` — static files, no generator, no framework — and `Scripts/build-site.sh` assembles it into `build/site` together with the pieces it borrows from the frozen tier: the brand tokens and marks from `docs/reference/branding/`, copied as they are, and the pinned prototypes from `docs/reference/prototypes/`, rewritten into the brand by `Scripts/rebrand-prototypes.py`. The exports use Claude Design's own palette and type; the site shows them in Vitrine's, with their interactivity intact, and the rewrite is a total mapping that fails the build on any colour it doesn't know. `.github/workflows/pages.yml` runs that script and deploys the result on every push to `main` that touches the site or its inputs. Nothing from v1's `site/` is carried over.

## Considered options

- **Commit copies of the tokens and prototypes into `website/`.** Rejected: a second copy of frozen material drifts, and the frozen-tier check can't see it. This holds for the rebranded prototypes too: they are a build output, and the mapping is what is reviewed.
- **Rebrand the prototypes by hand.** Rejected: each export carries its colours in hundreds of inline styles, and a re-pinned prototype would need the work redone.
- **Deploy from the reimagining branch while it was open.** Rejected: the domain shows `main`, and `main` is now the reimagining.
- **A static-site generator.** Deferred until a page needs one; a landing page and a prototype gallery don't.

## Consequences

- **+** One folder, one script, one workflow. The same script previews locally (`.claude/launch.json`, `site`) and builds in CI, so there is no second build to keep in step.
- **+** The frozen tier stays the single source for tokens and prototypes; the site cannot show a stale copy.
- **−** The rebrand is mechanical. Links and filled buttons are re-pointed at sapphire (`BRAND.md` law 2) by pattern: a button is an amber fill with dark text on it in one style attribute. Any other amber becomes brass, so an action styled some other way would slip through as punctuation. The app's own UI does not inherit any of this: it is built from the tokens, not from the exports.
- **−** The exports set questions and quotations in a serif the brand doesn't have. They become Inter, which loses a distinction the prototypes drew on purpose. Whether the app wants a serif role is a branding question for later, not decided here.
- **−** Fonts load from Google Fonts on the site. The app's own font policy is undecided (`docs/architecture.md` § Open).
- **−** The Pages deploy is not a merge gate; a broken site build is noticed after merge, from the Actions run, not before.
- The site's content beyond the landing page is not decided by this ADR.
