---
status: accepted
---

# Introspection stays `capabilities`, not `describe`

The agent-first CLI conventions name the introspection operation `describe`. This CLI keeps `capabilities`, and it now takes an optional operation name so a caller can ask for one operation's contract instead of all nine. ADR 0002 forbids `describe` because it is a drift verb: a name that says nothing about what comes back, so unrelated behaviour accumulates behind it over time. The schema lint in `src/schema/lint.ts` enforces that ban mechanically, so adopting the conventional name would mean deleting a rule the codebase relies on to keep operation names flat and honest. Renaming would also break the additive-only rule. `capabilities` is released, and agents store invocations in skill files and replay them later.

## Considered options

- Rename `capabilities` to `describe`. Rejected: it removes a released command name, and it is the exact name ADR 0002 rules out.
- Keep `capabilities` and add `describe` as an alias. Rejected: two names for one thing doubles the surface an agent has to learn and read, and the alias would still be a drift verb attracting behaviour that does not belong under it.
- Add a drift-verb exemption to the lint rule for this one case. Rejected: the rule is doing its job, and an exemption weakens it for every operation added later.

## Consequences

- An agent arriving from the conventions looks for `describe` and does not find it. `capabilities` is the first entry in `--help` and in the generated skill, and both name it, so the cost is one lookup.
- The contract carries `schema_version`, so a caller can tell whether its understanding of the shape is current. It is bumped when the shape changes, not when an operation is added.
- Introspection stays credential-free and offline. A test passes a `fetch` stub that throws and asserts it is never called.
