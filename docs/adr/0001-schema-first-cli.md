---
status: accepted
---

# Schema-first CLI with the envelope as the public contract

Eight hand-written Commander commands drifted: the version string lied, help text went stale, one flag was dead, and the README named the wrong package. We now define every operation once in `src/schema/` with Zod, and generate the Commander program, `capabilities`, the README command block, the agent skill, and JSON schemas from it. Every JSON response is one envelope shape (`ok`, `version`, `operation`, `params`, `defaulted`, `warnings`, `source`, `currency`, `data` or `error`), which breaks agents that parsed bare data and is why the version moved to 0.2.0.

## Considered options

- Keep hand-written commands and add a doc lint. Rejected: the lint cannot see the drift that lives in prose, and it does not give agents introspection.
- Envelope only under a new `--envelope` flag, bare data by default. Rejected: two shapes means two things to document and test, and the bare shape is the one that hides errors.

## Consequences

- Generated files are checked in and a test fails when they are stale. Edit the schema, run `npm run generate`.
- `read --xml` and `capabilities` are the only outputs that bypass the envelope; both are marked in the schema.
