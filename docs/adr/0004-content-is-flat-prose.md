---
status: accepted
---

# Regulation text is flat prose, not a paragraph tree

The eCFR XML for a section is one `DIV8` wrapping a flat run of `P` siblings with no attributes: in 48 CFR 252.204-7012 there are 54 of them, and the designators `(a)`, `(b)(2)(i)`, `(ii)(A)` are literal characters at the start of the text, not markup. `read` therefore returns `data.content` as a single prose string spanning `HEAD` through `HD3` in document order, and puts the structured facts the source does carry into `data.sections[]` (`number`, `citation`, `alternate_reference`, `federal_register_citation`) rather than inventing a hierarchy that is not there.

## Considered options

- Infer a paragraph tree by parsing the leading designator of each `P` and tracking a depth stack. Rejected: the hierarchy would be guessed, not read, and the designators are ambiguous — `(i)` is both roman one and the ninth letter, and `(ii)(A)` is two designators in one paragraph. It also only pays off alongside a paragraph addressing flag, which the upstream API cannot serve because it does not slice below section level.
- `content` limited to the `EXTRACT` block, which holds the clause itself. Rejected: it silently discards `As prescribed in 204.7304(c), use the following clause:`, which is what tells a reader when the clause applies.

## Consequences

- `content` includes the CFR's own editorial voice around the clause. That is safe because the document delimits itself in prose: the prescription opens it and `(End of clause)` closes it, so a reader can see the boundary without markup.
- Whitespace inside a block is preserved byte for byte and only the whitespace between blocks is normalised, to `\n\n`. Injecting a separator at every element boundary instead would corrupt tight punctuation such as `(<I>e.g.,</I>` into `( e.g.,`.
- `CITA` is excluded from `content` and read into `sections[].federal_register_citation`. It sits outside `EXTRACT` in the source, so this needs no heuristic.
- Anyone who parsed `content` before 0.3.0 sees different bytes, which is why the version moves rather than taking a patch.
