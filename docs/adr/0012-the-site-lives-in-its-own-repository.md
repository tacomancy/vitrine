# 0012: The site lives in its own repository

**Status:** Accepted

ADR 0011 made the site the studio's — the root is Tacomancy, each project under its own path — but kept it in this repository, and rejected "a third repository" because the build borrows from the frozen tier here. Once the root page, the Skills page, and the studio's own marks lived in a repository whose CI, ADR sequence, and issue tracker are about a desktop app, that read backwards too. Decided: **the site moves whole to [`tacomancy/tacomancy`](https://github.com/tacomancy/tacomancy), and nothing site-related stays here.** That repository carries a copy of `docs/reference/branding/` and `docs/reference/prototypes/`, taken at `043f765`; both are frozen on both sides, so a copy of what never changes cannot drift. Its ADR 0003 records the move from its side, and ADRs 0004 and 0011 continue there as its 0001 and 0002.

## Consequences

- **+** This repository's CI, scripts, and guidance are about the app only. `.github/workflows/pages.yml`, `Scripts/build-site.sh`, `Scripts/rebrand-prototypes.py`, the social cards, `website/`, and the `site` launch configuration are gone.
- **+** The custom domain moves to the new repository's Pages settings. Until it does, `tacomancy.com` serves this repository's last deploy, which is the same site.
- **−** The site describes this project from outside it. A PR here that changes what `/vitrine/` should say — a re-pinned prototype, a branding change, a shipped surface the page lists as designed-only, a changed README status line — opens an issue in `tacomancy/tacomancy` before merge (`CLAUDE.md` § The public site). Nobody edits the site from here.
- **−** A re-pinned prototype or a revised branding package reaches the site only when someone copies the folder over there and bumps the commit its `docs/reference/README.md` names. Both are rare by construction.
