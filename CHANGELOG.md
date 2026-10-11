# Changelog

Built from the GitHub release notes. Each version links to its release page.

## 0.1.5 (2026-10-11)

Spend limits, version 2. Before this, a pull was limited only by the cap per pull, an in-memory rate limit and the token balance. Nothing limited spend across pulls, and two requests started together could both pass the cap.

What changed

- Period budget: a daily and a monthly amount (UTC), $10 and $50 by default, saved in `budget.json` in `LOOOT_REVIEWS_DATA_DIR`. The signed-in owner changes it on the new Costs page (`PUT /api/budget`). A run request cannot raise it, and one that carries a budget field is refused with 400. The spend cap per pull still comes only from the server (`REVIEWS_SPEND_CAP_USD`); a cap in a request is ignored.
- Reserve then settle: each paid call reserves its list price under a lock file before it is made, and is refused if used plus reserved plus the price would pass either budget. The reservation becomes the real cost when the call ends and goes back if looot refused the call. A call still running keeps its reservation and is never counted as $0. The next pull looks up pending calls with `GET /v1/runs/{id}` and settles them. A reservation that cannot be looked up is released after 24 hours.
- Stored results: a finished call is stored under its stable key for 40 days, so the same request is answered with no call and no charge. The up-front budget check ignores calls that have a stored answer.
- Stable keys: keys were already free of any date. This release checked every call input for a hidden date and found none, and a test now fails if a date enters a key. `--fresh <tag>` is still the explicit way to pull again.
- The sidebar spend panel and the Costs page show used, reserved and remaining for today and this month. The CLI refuses a pull above what is left of the budget unless `--partial` is passed.
- README: the Spending and Securing a deployment sections describe the new limits. The token balance is still the final limit.

For upgraders

- No migration. This repo has no database. `budget.json` is a new file, created in `LOOOT_REVIEWS_DATA_DIR` (default `.looot-data`) on first use. Run one instance on a persistent disk, since the file is not shared between hosts.
- `/api/budget` and `/costs` are new admin routes. The route map and its tests include them.
- Keys are unchanged, so looot still replays earlier pulls without a new charge.

[Release page](https://github.com/loootai/looot-reviews/releases/tag/v0.1.5)

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
