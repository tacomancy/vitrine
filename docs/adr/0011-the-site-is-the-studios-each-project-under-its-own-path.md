# 0011: The site is the studio's; each project lives under its own path

**Status:** Accepted

ADR 0004 left "the site's content beyond the landing page" open and built `tacomancy.com` as Vitrine's site, with the studio as a page off it. Once the domain became the thing a shared link or a resume points at (#125), and the studio made a second thing, that arrangement read backwards: the root introduced one project, the studio was a footnote, and the skills repository had no page at all. Decided: **the root is Tacomancy; each project is a page under its own path, and its assets move with it.** `/` is the studio, `/vitrine/` and `/vitrine/prototypes/` are Vitrine, `/skills/` is the skills repository. The masthead is the studio's on every page — the Fold mark and the `Tacomancy` wordmark, nav `Vitrine · Skills · GitHub` — and each project opens its hero with its own lockup, so the product brand lands on the product's page and nowhere else.

The studio's marks are drawn in the Case's grammar (BRAND.md § Marks: the 8px steps, the brass and glass gradients, the plinth) and live in `website/marks/` — the Fold for Tacomancy, the Tiers for Skills. They are the site's, not the branding package's: the package is frozen and is Vitrine's; a mark that belongs to the studio would be a second thing for the package to be about.

## Considered options

- **Leave Vitrine at the root, add `/skills/`.** Rejected: the root would still introduce a project rather than the studio that made it, and the studio page would stay a nav item on its own product's site.
- **A GitHub Pages site per project repository, under the org's domain.** Rejected for now: Pages binds the apex to one repository, so the studio page would need a third repository and each project would lose the shared build (the rebrand, the tokens copied from the frozen tier). Revisit when a project has a site of its own to maintain.
- **Reuse the Case as the studio's mark.** Rejected: the Case is Vitrine's, and a masthead that shows it on the Skills page says the wrong thing. The favicon follows the same rule: each section's own mark.
- **Hard cut, no redirects.** Rejected: the two old addresses have been shared. `/tacomancy/` and `/prototypes/` are stubs that forward, carrying a gallery deep link's `#hash` across.

## Consequences

- **+** One build, one deploy, one stylesheet still (ADR 0004 holds); the hierarchy is folders under `website/`, readable from the tree.
- **+** A project page is self-contained under its path: the gallery's relative links from the Vitrine landing did not change because the two moved together.
- **−** Two social cards to keep in step instead of one; `Scripts/render-social-card.sh` renders both.
- **−** Full-size prototype links of the form `/prototypes/NN-*.html` are not redirected; the 404 page points at the gallery. Add per-file stubs if those links turn out to be in circulation.
- **−** The site now carries marks the branding package does not know about. If the package is ever revised, the Fold and the Tiers should go into it and `website/marks/` should be replaced by a copy from the frozen tier, as the tokens are today.
