---
name: looot-reviews
description: Pull customer reviews for a company or place and its competitors (Google Maps, App Store, Google Play, Tripadvisor), group them into themes with counts and quotes, track rating over time and find where competitors are weak. Use when asked to read, compare or summarise reviews, or to find competitor weaknesses from what their customers say. Prices every call before it runs.
---

# looot-reviews

Runs the `looot-reviews` CLI in this repo. Needs `LOOOT_TOKEN` for a real pull; `--dry-run` and `--demo` need nothing.

## Steps

1. Get the target (the person's company or place) and the competitors. A city after `@` helps the Google Maps lookup: `"Blue Door Cafe @ Austin TX"`. For App Store, Google Play or Tripadvisor, write a YAML file like `reviews.example.yaml` with `appStoreId`, `playPackage` or `tripadvisorId`.
2. Price it first, always:
   `npm run reviews -- --target "Blue Door Cafe @ Austin TX" --competitors "Copper Pot @ Austin TX; Tin Roof @ Austin TX" --dry-run`
   Show the total. Five Google Maps companies at 2 pages each is at most $0.015 at list prices dated 2026-10-10.
3. Run it only after they agree, with a cap at or just above the quoted maximum:
   `npm run reviews -- --target "..." --competitors "..." --max-spend 0.05 --out out`
4. Read `out/brief.md` for ratings, weak spots and themes, `out/reviews.csv` for the rows, `out/reviews.json` for everything.
5. Report what came back and what did not. Each source row in `brief.md` says completed, failed, pending, skipped or blocked, and why.

## Rules

- Exit code 1 and the word "pending" mean a call is still going. Run the same command again. The stored run is replayed and not charged twice. Never call a pending run failed.
- Use `--fresh <tag>` only when the person wants a new pull of an input that already ran. It is charged again.
- Never raise `--max-spend` unprompted.
- Themes come from keyword rules in `config/themes.json` and from repeated phrases. Say so. They count words, not intent.
- Under about 30 reviews, say that themes and weak spots are weak evidence.
- Trustpilot and G2 are not available. Say so if asked.
- Do not set REVIEWS_LLM_API_KEY or REVIEWS_LLM_MODEL unless the person asks for the LLM step.
