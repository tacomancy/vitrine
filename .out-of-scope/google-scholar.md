# Google Scholar as a Scout source

Vitrine does not support Google Scholar as a Scout source.

## Why this is out of scope

Google Scholar has no official API, and Google's terms forbid automated querying. That leaves two routes, and both break an invariant:

- **Scraping** is brittle and gets CAPTCHA-blocked. A blocked Scout would look identical to a quiet field, which the "no silent failures" invariant rules out.
- **A paid proxy** (SerpAPI and the like) sends every query to a service that is not the configured model provider. BYOK allows credentials to leave the device only for the model provider, and ADR 0048 pins the key to one origin in code.

The need behind the request, searching published venues rather than only arXiv, is met by OpenAlex, which indexes the same literature through a real API (see issue #778).

## Prior requests

- #778: "Scouts: support sources beyond arXiv and explicit web pages (e.g. Google Scholar)"
