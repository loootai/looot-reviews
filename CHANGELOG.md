# Changelog

Built from the GitHub release notes. Each version links to its release page.

## 0.1.4 (2026-10-11)

Security release. Versions 0.1.3 and older had no admin authentication. Anyone who could reach a running copy could read the saved pull and start paid pulls on your looot token and your LLM key. If you run any earlier version on a host other people can reach, upgrade now and set an admin password.

What changed

- Every page and API route is now public on purpose or admin. Admin routes need a signed session cookie and, for state-changing requests, a same-origin check and a CSRF token.
- Public: /login, /api/health, /api/auth/login, /api/auth/logout, /favicon.ico, /brand/*. Admin: /, /themes, /new, /api/quote, /api/run. Any unlisted path is admin.
- Set REVIEWS_ADMIN_PASSWORD (12 characters or more) or REVIEWS_ADMIN_PASSWORD_HASH (npm run hash-password). Without one, admin pages redirect to /login and admin API routes answer 503.
- The spend cap for a web pull now comes from REVIEWS_SPEND_CAP_USD on the server (default 0.50). The browser can no longer set it, and the cap field on the New pull page is now a read-only label.
- A session can start 6 paid pulls in 10 minutes.
- Security headers on every response, and Cache-Control: no-store on admin responses.
- npm run demo refuses to start next to LOOOT_TOKEN, REVIEWS_LLM_API_KEY or a saved pull, unless an admin password is set. The demo shows a "Demo, no sign-in" badge.

The CLI is unchanged. See "Securing a deployment" in the README.

[Release page](https://github.com/loootai/looot-reviews/releases/tag/v0.1.4)

## 0.1.3 (2026-10-10)

Sidebar: nested-item support in the shared shell

[Release page](https://github.com/loootai/looot-reviews/releases/tag/v0.1.3)

## 0.1.2 (2026-10-10)

Sidebar layout.

[Release page](https://github.com/loootai/looot-reviews/releases/tag/v0.1.2)

## 0.1.1 (2026-10-10)

Dependency security bump. next and eslint-config-next 16.3.7 to 16.3.8, which fixes six Next.js advisories (GHSA-3w37-wq28-93x7, GHSA-4jqv-mc3x-m676, GHSA-39w2-rjm5-chcv, GHSA-f87g-xv8r-7p7x, GHSA-mcj8-r9mp-w47p, GHSA-cjq9-62q9-8jv4). No code changes. v0.1.0 is unchanged.

[Release page](https://github.com/loootai/looot-reviews/releases/tag/v0.1.1)

## 0.1.0 (2026-10-09)

First release. Review intelligence over Google Maps, App Store, Google Play and Tripadvisor reviews through looot. Themes by keywords and repeated phrases with no LLM key (optional LLM merge step behind an env var), rating by month, competitor weak spots. Demo mode with invented shops, a headless CLI with --dry-run and a spend cap, and a web UI on the same engine. No paid looot run was made; response parsing is built from catalog descriptions and fixtures. Trustpilot and G2 are not in the looot catalog and are dropped.

[Release page](https://github.com/loootai/looot-reviews/releases/tag/v0.1.0)
