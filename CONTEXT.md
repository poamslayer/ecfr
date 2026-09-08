# ecfr

A command line client for the public eCFR API, built so that agents and humans can drive it from one typed description of every command.

## Language

### Commands

**Operation**:
One thing the CLI can do, such as `read` or `local clear`. Every command, help page, and capabilities entry is derived from an operation.
_Avoid_: Command handler, action, subcommand (use only when talking about Commander itself)

**Kind**:
The shape of an operation: `list`, `get`, `search`, or `introspect`. Recorded for introspection; it does not appear in the command name. The CLI only reads, so there is no mutating kind.

**Capabilities**:
The machine readable description of every operation, flag, error code, and exit code. Works offline and needs no credentials.
_Avoid_: Manifest, schema dump, introspection output

### Output

**Envelope**:
The single JSON shape every operation returns: whether it succeeded, which operation ran, the effective params, and either data or an error.
_Avoid_: Response, result object, wrapper

**Data**:
The operation specific payload inside a successful envelope.
_Avoid_: Body, payload, result

**Params**:
The effective inputs an operation ran with, after the CLI filled in any defaults.
_Avoid_: Options, arguments, resolved input

**Defaulted**:
The names of the params the CLI filled in because the caller did not supply them.

**Warning**:
Something the caller should react to, such as a retry that happened or a response that was truncated. Never used for informational counts or defaults.
_Avoid_: Note, info, message

**Error code**:
A stable uppercase identifier for a failure class, such as `NOT_FOUND` or `USAGE`, paired with a fixed exit code and a remediation.
_Avoid_: Error type, reason

**Remediation**:
The one sentence in an error that tells the caller what to run or change next.
_Avoid_: Hint (fine in terminal text, not in the envelope), suggestion, help text

**Content**:
A regulation's prose as one plain text string, carrying the section heading, the CFR's prescription note, and the clause itself in the order they are published. Never a serialization of the upstream markup.
_Avoid_: Text, body, extracted text

**Raw output**:
The one exception to the envelope: `read --xml` writes the upstream XML bytes to stdout unchanged.

### Freshness

**Currency**:
The dates that say how current a served regulation text is: the issue date it was served for, when the title was last amended, and when the eCFR says it is up to date as of. Resolved fresh from ecfr.gov on every run.
_Avoid_: Freshness, version info, as-of

**Issue date**:
The date a regulation text is served for. The CLI defaults it to the latest one the eCFR publishes for that title; a caller may pass an earlier one to read historical text.
_Avoid_: Snapshot date, effective date, version date

**Dry run**:
Running an operation up to the point of the upstream request and returning the envelope with the request it would have made and no data.
