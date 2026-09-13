# 0010: Public site on GitHub Pages at the apex of tacomancy.com

**Status:** Accepted

## Context

Vitrine has no public surface beyond the repository. The owner holds
`tacomancy.com` and wants the project reachable there. GitHub Pages was
already enabled on the repository (Actions build type, no domain bound). An
apex domain can be bound to only one repository per organization, so choosing
the apex for Vitrine commits the domain to this project rather than to a
future org-wide landing page.

## Decision

The site is the contents of `site/` on `main`, static files only, deployed by
`.github/workflows/pages.yml` on every push that touches `site/` or the
workflow. It is bound to the apex `tacomancy.com`; `www` redirects to it. DNS
lives at the registrar (four `A` records to GitHub's Pages IPs, `CNAME www` →
`tacomancy.github.io`), and the domain is verified at the organization level
so no other Pages site can claim a `tacomancy.com` subdomain.

The site follows `design/vitrine-design-system-brief.md` (ADR 0004) the same
way the app does: tokens only, sapphire for actions, brass as punctuation.
No generator, no framework, until a page needs one.

## Consequences

- **+** One `site/` folder and one workflow; nothing to install, no build step.
- **+** CI (`ci.yml`) stays one job on pull requests only, as ADR 0006 states.
- **−** The apex is Vitrine's. A separate org landing page would need its own
  domain or a subdomain, and moving Vitrine off the apex later means a DNS
  change and a Pages rebinding.
- **−** Fonts load from Google Fonts on the site, unlike the bundled fonts in
  the app (ADR 0009). Revisit if the site grows past a landing page.
- A later ADR is expected when the site needs a generator (docs, changelog).
