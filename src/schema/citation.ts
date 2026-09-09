/**
 * Parsing for the citation form of `read`'s positional.
 *
 * Humans and regulations cite a section as `32 CFR 2002.14`, and an agent extracting citations
 * from a document passes them straight through. This module turns that text into a title, a
 * part, and a section, or explains in one sentence why it is not a citation the eCFR API can
 * address.
 *
 * Pure: no I/O, no zod, no knowledge of the runtime, so it can be tested as its own seam. The
 * part and section it returns are still validated by the hardened identifier schemas in the
 * flag registry before anything is sent upstream — this parser is never the last line of
 * input hardening.
 */

export interface ParsedCitation {
  /** CFR title number. */
  title: string
  /** Part, given directly by the `part` form or derived from the section by D3. */
  part?: string
  /** Section in full dotted form. Absent for the `part` form. */
  section?: string
  /** The citation exactly as the caller typed it. */
  citation: string
}

export type CitationResult =
  | { ok: true; value: ParsedCitation }
  | { ok: false; reason: string; remediation: string }

/**
 * `<title> CFR part <part>`, tried first: the section form would otherwise read the word
 * `part` as the section and the part number as a trailing qualifier.
 */
const partForm = /^(\d+)\s+CFR\s+part\s+(\S+)(?:\s+(.*\S))?$/i

/** `<title> CFR [§] <section>`. The section sign is optional and carries no meaning. */
const sectionForm = /^(\d+)\s+CFR\s+(?:§\s*)?(\S+)(?:\s+(.*\S))?$/i

/** `DFARS 252.204-7012` and friends: a name that is not `CFR` followed by one identifier. */
const alternateReferenceForm = /^([A-Za-z][A-Za-z.]*)\s+(\S+)$/

/** Titles for the alternate references the eCFR itself publishes, used only in a remediation. */
const alternateReferenceTitles: Record<string, string> = { DFARS: '48', FAR: '48' }

const bothForms = 'Pass a CFR title number, as in `ecfr read 32 --part 2002 --section 2002.14`, '
  + 'or a citation, as in `ecfr read "32 CFR 2002.14"` or `ecfr read "32 CFR part 2002"`. '
  + 'Run `ecfr titles` to list valid title numbers.'

function reject(reason: string, remediation: string): CitationResult {
  return { ok: false, reason, remediation }
}

function excerpt(text: string): string {
  return text.length > 60 ? `${text.slice(0, 60)}…` : text
}

/**
 * D3: the part is everything before the first dot of the section. `2002.14` gives `2002`,
 * `252.204-7012` gives `252`, `1.1031(a)-1` gives `1`.
 */
export function partOf(section: string): string {
  return section.slice(0, section.indexOf('.'))
}

/**
 * D4: a section is a range when it contains a hyphen AND the text after the last hyphen
 * contains a dot. A hyphen alone does not mean a range — `252.204-7012` is a real DFARS
 * section and `1.148-1A` a real Title 26 one, and rejecting either would break the CLI's
 * most important use.
 */
export function isSectionRange(section: string): boolean {
  const lastHyphen = section.lastIndexOf('-')
  return lastHyphen !== -1 && section.slice(lastHyphen + 1).includes('.')
}

/** The part a range spans, for the remediation: `2002.14-2002.16` points at part `2002`. */
function partOfRange(section: string): string {
  return section.split('-')[0]!.split('.')[0]!
}

/**
 * D5: the upstream API slices by part and section only. Accepting `Subpart B` and quietly
 * dropping it would be silent repair, so any trailing qualifier is rejected.
 */
function rejectQualifier(title: string, part: string, qualifier: string): CitationResult {
  return reject(
    `"${excerpt(qualifier)}" is a subpart, appendix, or other qualifier, and the eCFR API addresses parts and sections only.`,
    `Drop the qualifier and read the part, as in \`ecfr read ${title} --part ${part}\`.`,
  )
}

export function parseCitation(input: string): CitationResult {
  const text = input.trim()
  if (text.length === 0) {
    return reject('An empty positional is neither a CFR title number nor a CFR citation.', bothForms)
  }

  const asPart = partForm.exec(text)
  if (asPart) {
    const [, title, part, qualifier] = asPart as unknown as [string, string, string, string | undefined]
    if (qualifier !== undefined) return rejectQualifier(title, part, qualifier)
    return { ok: true, value: { title, part, citation: input } }
  }

  const asSection = sectionForm.exec(text)
  if (asSection) {
    const [, title, section, qualifier] = asSection as unknown as [string, string, string, string | undefined]
    if (isSectionRange(section)) {
      return reject(
        `"${excerpt(section)}" is a range of sections, and the eCFR API addresses one section at a time.`,
        `Read the part instead, as in \`ecfr read ${title} --part ${partOfRange(section)}\`, and pick the sections you need out of its content.`,
      )
    }
    if (!section.includes('.')) {
      return reject(
        `"${excerpt(section)}" is not a section number; a section is written in full dotted form, such as 2002.14.`,
        `Pass the section in full dotted form, as in \`ecfr read "${title} CFR 2002.14"\`, or read the part with \`ecfr read "${title} CFR part ${excerpt(section)}"\`.`,
      )
    }
    if (qualifier !== undefined) return rejectQualifier(title, partOf(section), qualifier)
    return { ok: true, value: { title, part: partOf(section), section, citation: input } }
  }

  const asAlternate = alternateReferenceForm.exec(text)
  if (asAlternate && asAlternate[1]!.toUpperCase() !== 'CFR') {
    const name = asAlternate[1]!.toUpperCase().replace(/\.$/, '')
    const identifier = asAlternate[2]!
    const title = alternateReferenceTitles[name]
    return reject(
      `"${name}" is an alternate reference, not a CFR citation.`,
      title === undefined
        ? `Pass the CFR citation instead, as in \`ecfr read "48 CFR 252.204-7012"\`, with the CFR title number in place of "${name}". Read it from \`data.sections[].citation\`, not \`data.sections[].alternate_reference\`.`
        : `Pass the CFR citation instead: \`ecfr read "${title} CFR ${identifier}"\`. Read it from \`data.sections[].citation\`, not \`data.sections[].alternate_reference\`.`,
    )
  }

  return reject(`"${excerpt(text)}" is not a CFR citation.`, bothForms)
}
