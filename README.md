<p align="center"><img src="assets/hero.png" alt="looot-reviews" width="100%"></p>

# looot-reviews

[![License](https://img.shields.io/github/license/loootai/looot-reviews)](LICENSE) [![Release](https://img.shields.io/github/v/release/loootai/looot-reviews)](https://github.com/loootai/looot-reviews/releases) [![Docs](https://img.shields.io/badge/docs-docs.looot.ai-12A06A)](https://docs.looot.ai)

An open-source alternative to paid review monitoring such as ReviewTrackers, and to reading Google, App Store and Tripadvisor reviews by hand. ReviewTrackers' pricing page, read on 2026-10-10, says plans start "per location per month, paid annually" but did not show the amount to a browser, so no number is quoted here. This repo reads reviews on demand through one looot key and charges per call. A pull of five companies on Google Maps, two pages each, is at most $0.015 at list prices.

Name your company or place and its competitors. looot-reviews pulls their reviews, groups them into themes with counts and example quotes, tracks the average rating by month and lists the themes where a competitor's customers are unhappy and yours are not.

![Overview, light theme](docs/screenshots/overview-light.png)

![Themes, dark theme](docs/screenshots/themes-dark.png)

The demo data is invented. Marlow & Finch Coffee, Copper Kettle Roasters and Tidewater Brew House do not exist, and every review was generated from sentence templates. The patterns in it (Copper Kettle is slow and its rating falls, Tidewater is expensive) were planted so the screens have something to show.

## Three ways to run it

**Demo, no account and no token.**

```bash
npm install --ignore-scripts
npm run demo        # web UI at http://localhost:3240 with invented shops
```

**Headless CLI.** One command in, JSON, CSV and markdown out.

```bash
export LOOOT_TOKEN=...                       # https://looot.ai/settings
npm run reviews -- --target "Blue Door Cafe @ Austin TX" --competitors "Copper Pot @ Austin TX; Tin Roof @ Austin TX" --dry-run
npm run reviews -- --config reviews.example.yaml --max-spend 0.10 --out out
```

Options: `--sources google_maps,app_store,google_play,tripadvisor`, `--pages 1..5` (default 2, about 20 reviews a page on Google Maps), `--max-spend <usd>` (default 0.50), `--fresh <tag>` to pull again, `--demo` to write the demo report. It writes `reviews.json`, `reviews.csv` and `brief.md`. Exit code 0 is done, 1 means a call failed or is pending, 2 is bad usage. The CLI uses every source an entity has an id for. Google Maps needs only a name.

**Web UI on the same engine.** `npm run dev`, open `/new`, enter the target and the competitors, press "Show the price", then "Run". The run button works only on a quote you have seen. If the live price rose above the quote, the server refuses with a 409 and asks you to quote again. The web form reads Google Maps only; use the CLI and a YAML file to add the other sources. Supabase and sign-in are not used. The last pull is saved to `.looot-data/latest.json` on your machine.

![New pull page](docs/screenshots/new-light.png)

## Where the reviews come from

Prices are per-call list prices in the public looot catalog on 2026-10-10. The CLI reads live prices before running and uses these only for `--dry-run` or when the catalog cannot be read.

| Source | Needs | looot job | Endpoint | Price per call |
| --- | --- | --- | --- | --- |
| Google Maps, place lookup | name, optional city | `maps.place.get` | `serper-places` | $0.0010 |
| Google Maps, reviews | place from the lookup, or `placeId` or `cid` | `maps.place.reviews` | `serper-reviews` | $0.0010 per page |
| App Store | `appStoreId` | `reviews.appstore.reviews` | `searchapi-io-apple-product-reviews` | $0.0040 per page |
| Google Play | `playPackage` | `api.google.play.apps.reviews` | `anysite-api-google-play-apps-reviews` | $0.03597 per call |
| Tripadvisor | `tripadvisorId` | `search.tripadvisor-reviews` | `searchapi-io-tripadvisor-reviews` | $0.0040 per page |

Not available: Trustpilot and G2. The public looot catalog has no endpoint for either, so they are dropped, not faked. Other Google Maps review endpoints exist (SearchApi, AnyAPI, Anysite, SerpApi). Swap one in by editing `src/lib/sources.ts`. Each endpoint is pinned with no provider fallback, so the quoted price is the price.

A typical run, the real output of the dry run on five Google Maps companies:

```text
Up to $0.0150 ($0.0100 if each source ends after one page) at list prices dated 2026-10-10. 2 page(s) per source. Spend cap $0.5000.
```

## Money rules

- The price of every call is shown before the call. The CLI prints the plan first. The web UI shows a table and the most the run can cost.
- A per-run spend cap is enforced before each call. A call that would pass the cap is not made and is marked "blocked".
- Each call has a stable idempotency key made from the endpoint and the input. Running the same input again replays the stored run and is not charged twice. `--fresh <tag>` changes the key when you want a new pull.
- A run still going when waiting stops is "pending", never "failed". It counts against the cap at its quoted price until it settles, and it ends that source for this run.
- A failed run costs nothing, and the report says why.
- Pages after the first happen only when the provider says there are more, so the quote is a maximum.

## How themes are made

No model is needed.

1. Named themes. `config/themes.json` lists a dozen themes (staff and service, wait times, price and value, cleanliness, app reliability and so on) with keywords. A review mentions a theme when it contains a keyword at the start of a word. Edit the file to fit your market.
2. Found themes. For reviews no named theme covers, the code counts single words and adjacent word pairs, keeps the ones that at least 3 reviews (or 3 percent) share, and merges phrases that appear in the same reviews into one theme. This is plain n-gram clustering. It is English only.
3. Each theme gets the number of reviews that mention it, the share of all reviews, the average rating, a count per company and up to three quotes (the lowest rated, the highest rated and a middle one). A quote is the sentence that holds the keyword, from a review whose rating is shown beside it.

Optional LLM step. Set `REVIEWS_LLM_API_KEY` and `REVIEWS_LLM_MODEL` (and `REVIEWS_LLM_BASE_URL` if you do not use the Anthropic API) and the code sends the theme labels, keywords and two quotes per theme to the model, which answers with groups to merge and short labels. It never sees the full review set, and counts are always recomputed locally from the merged keywords. If the call fails the report keeps the keyword themes and says so in a note. The cost of this call is your model provider's, not looot's.

## Rating over time and weak spots

Rating by month is the average of dated reviews. Google Maps gives relative dates such as "3 months ago", which are turned into a day by counting back from the pull date, so months are approximate. Each company also gets the change between the last 90 days and the 90 days before, shown only when both windows have 5 or more dated reviews.

A weak spot is a theme where a competitor has 3 or more mentions and either averages 3 or lower or has 40 percent negative mentions, and where your reviewers average at least half a star higher on the same theme or rarely raise it. The list is ranked by the gap and the number of mentions.

## What it does not do

- It reads public reviews as the providers return them. It does not reply, post or monitor continuously. Run the CLI on a schedule if you want that.
- It keeps rating, text, title and date. It does not keep reviewer names.
- It makes the first pages the provider gives, up to 5 pages a source. It does not fetch every review of a large place.
- Trustpilot, G2 and Yelp reviews are missing because the catalog has no endpoint for them.
- Sentiment is the star rating, not text analysis. Themes count words and do not judge tone.
- Found themes only work on English text. A review set under about 30 reviews gets a warning in the report.

## What is not tested

No paid looot run was made while building this. The code that turns a provider response into reviews is built from the endpoint descriptions in the catalog, from the field names those providers document, and from fixtures written to match. It reads several alias names for each field and skips rows it cannot read, but the first real pull may show a field it misses. If a provider returns reviews that come out empty, open `out/reviews.json`, send the raw shape in an issue, and add the alias in `src/lib/normalize.ts`. The optional LLM step was tested only against a mocked HTTP endpoint. The unit tests mock all HTTP.

## Develop

```bash
npm test            # vitest, mocked HTTP
npm run typecheck
npm run lint
npm run build
npm run leak-scan   # run before every push; git config core.hooksPath .githooks turns it on
```

Stack: TypeScript, Next.js App Router, Tailwind. Versions are pinned exactly and install scripts are off (`.npmrc`).

## Install for agents

Read `llms.txt`, then use the Claude Code skill in `skills/looot-reviews/SKILL.md`. To add it to a project:

```bash
mkdir -p .claude/skills && cp -r skills/looot-reviews .claude/skills/
```

The skill runs `--dry-run` first, shows the total, and runs only after you agree.

## Licence

MIT, copyright looot. ReviewTrackers, Trustpilot, G2 and Google are trademarks of their owners. This project is not affiliated with them and uses none of their code, text or images.

## Related

Other open-source projects built on [looot](https://looot.ai):

- [looot-intent](https://github.com/loootai/looot-intent): account intent and buying-stage scoring (6sense)
- [looot-score](https://github.com/loootai/looot-score): lead and ICP fit scoring (MadKudu)
- [looot-reveal](https://github.com/loootai/looot-reveal): which companies visit your site (RB2B, Clearbit Reveal)
- [looot-techstack](https://github.com/loootai/looot-techstack): website technologies from several providers (BuiltWith, Wappalyzer)
- [looot-signals](https://github.com/loootai/looot-signals): hiring, funding and news triggers (TheirStack, Harmonic)
- [looot-lookalike](https://github.com/loootai/looot-lookalike): lookalike company search (Ocean.io)
- [looot-ads](https://github.com/loootai/looot-ads): competitor ad board (Foreplay)
- [looot-battlecards](https://github.com/loootai/looot-battlecards): competitor battlecards (Klue, Crayon)
- [looot-mentions](https://github.com/loootai/looot-mentions): brand and keyword listening (Brand24)
- [looot-crm](https://github.com/loootai/looot-crm): a small CRM with buying signals built in
- [looot-seo](https://github.com/loootai/looot-seo): self-hosted SEO workspace
- [looot-monitor](https://github.com/loootai/looot-monitor): brand and competitor monitoring with alerts
