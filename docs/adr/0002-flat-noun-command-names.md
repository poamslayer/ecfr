---
status: accepted
---

# Flat noun command names instead of resource-verb pairs

Agent-first CLI guidance favors `resource verb` names (`titles list`, `title get`). We keep the existing flat nouns (`titles`, `agencies`, `structure`, `search`, `counts`, `changes`, `corrections`, `read`) because they were already uniform, `search`, `counts`, and `read` do not map cleanly onto `list` or `get`, and renaming would break every caller for no gain in clarity. The shape each operation has is recorded as `kind` in the schema for introspection, and lint forbids drift verbs (`info`, `show`, `fetch`, `view`, `describe`) so the set stays flat and consistent.

## Consequences

- New operations must be single nouns or a namespace plus verb agreed in an ADR, never a synonym of an existing one.
