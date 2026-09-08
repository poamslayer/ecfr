# Driving the CLI

`ecfr` is a command line client for the public eCFR API. Every operation is defined once in `src/schema/`, and every JSON output is one envelope, so an agent can learn the whole contract from one command and parse every envelope the same way.

## Discover

Run `ecfr capabilities` first. It prints one JSON document with the CLI name and version, the retry and timeout policy, the exit code table, every error code, the global flags, and every operation with its kind, positional, flags, examples, and output schema. It also carries the JSON schemas for the envelope and the error shape. It uses no network and needs no credentials, so it works offline. The same document is checked in at `docs/capabilities.json`.

## Call

Always pass `--json`, or pipe the output. Either one makes the CLI write the envelope instead of human text. `--json` may go before or after the operation name.

Read four things from every run: the exit code, `ok`, `error.code`, and `error.remediation`. When `ok` is false the envelope has no `data`. The remediation is one sentence that says what to run or change next.

| Exit | Error codes | Meaning |
| ---: | --- | --- |
| 0 | `OK` | Success, including a dry run. |
| 1 | `UPSTREAM_ERROR`, `INTERNAL` | Unexpected upstream 4xx or an internal failure. |
| 2 | `USAGE` | Bad flags, positionals, or values. Fix the call. |
| 3 | `NOT_FOUND` | ecfr.gov returned 404. Check the title, part, section, or date. |
| 4 | `RATE_LIMITED`, `UPSTREAM_UNAVAILABLE`, `NETWORK`, `TIMEOUT` | Transient failure after the CLI retried. Wait and retry later. |

The CLI retries transient failures on its own, up to two times with backoff. Do not add a retry loop for exit 1, 2, or 3. Only exit 4 is worth retrying.

## Read the envelope

- `ok`: true on success, false on failure.
- `version`: the CLI version that produced the envelope.
- `operation`: the operation that ran.
- `params`: the effective inputs the operation ran with, after the CLI filled in any defaults.
- `defaulted`: the names of the params the CLI filled in because the caller did not supply them.
- `warnings`: things the caller should react to. `RETRIED` means the request succeeded after a retry. `OUTPUT_SCHEMA_MISMATCH` means eCFR changed a field the CLI expected, and the data is still returned.
- `source`: the upstream URL and the time the upstream reply was received. Null for an offline operation. `fetched_at` is null on a dry run.
- `currency`: the dates that say how current the served text is. Present only on title-scoped operations: `structure`, `changes`, and `read`.
- `pagination`: paging details. Present only on `search`.
- `dry_run`: true when the operation stopped before the upstream request.
- `data`: the operation specific data. Parse this, not the whole envelope.
- `error`: the error code, message, HTTP status when there is one, whether it is retryable, the remediation, and details. Present only when `ok` is false.

Two outputs are not an envelope. `read --xml` is raw output, the upstream XML bytes written unchanged. `capabilities` is always JSON and has its own shape.

## Before an expensive read

`read` on a whole title is slow and returns a very large `data.content`. Pass `--dry-run` first. The CLI resolves the params and the issue date, returns the envelope with `source.url`, `params`, `defaulted`, `currency`, `dry_run: true`, and `data: null`, and exits 0. Only the small title list is read, to resolve a defaulted date. When the request looks right, run the same command without `--dry-run`. Scope with `--part` and, when you can, `--section`.

```bash
ecfr read 48 --part 252 --dry-run --json | jq .source.url
```

## Cite text

When you quote regulation text, quote its currency too. `currency.date` is the issue date the text was served for. `currency.up_to_date_as_of` is the date the eCFR says the title is up to date as of. `currency.latest_amended_on` is when the title was last amended. Every value is resolved fresh from ecfr.gov on each run.

`defaulted` tells you who chose the issue date. `["date"]` means the CLI picked the latest issue date the eCFR publishes for that title. `[]` means the caller passed `--date`.

```bash
ecfr read 32 --part 2002 --section 2002.14 --json | jq '{date: .currency.date, up_to_date_as_of: .currency.up_to_date_as_of, defaulted}'
```

## Historical text

Pass `--date YYYY-MM-DD` to `read` or `structure` to get the text as it stood at an earlier issue date. The envelope then reports that date in `params.date` and `currency.date`, and `defaulted` no longer lists `date`.

## Paging

`search` returns `pagination` with `page`, `per_page`, `total`, `total_pages`, and `next`. `next` is a complete runnable command for the next page, such as `ecfr search CUI --title 32 --page 2 --per-page 3`. It is null on the last page. Run it as given instead of building the next call yourself.

## What not to expect

There is no cache, no offline mode for regulation data, and no local store. Every run reads live from ecfr.gov. The only operation that works offline is `capabilities`. This is a decision, recorded in ADR 0003 at `docs/adr/0003-always-live.md`. Anyone who wants a cache should reopen that ADR rather than add one.
