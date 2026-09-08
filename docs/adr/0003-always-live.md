---
status: accepted
---

# Always fetch live: no cache, no record and replay store

The first draft of the rebuild copied the Cloudflare `cf` pattern of an explicit `--local` target backed by a record and replay store. We dropped it. The eCFR is a service we read, not one we own, and the user's requirement is the latest regulation text every time. A store that can serve old text is a store that will one day serve old text by mistake. Every run therefore hits ecfr.gov, and title-scoped operations return a `currency` block (issue date served, `latest_amended_on`, `up_to_date_as_of`) resolved fresh each time, so the response proves its freshness instead of freezing it.

## Considered options

- Record and replay store with `--record` and `--local`. Rejected as above.
- Transparent cache with a TTL. Rejected: invalidation rules and silent staleness, for a saving of one request per run.

## Consequences

- Reproducibility for tests comes from committed fixtures served by a `fetch` stub, produced by a dev script. That is a test concern, not a CLI feature.
- Historical text is still available on request through `--date`; the envelope's `defaulted` field says whether the date was chosen by the caller or the CLI.
- Anyone proposing a cache should reopen this ADR rather than add one quietly.
