/**
 * Convention checks over the schema. Run by tests and by the generator.
 */
import type { AnyOperation } from './types.js'
import { flags, type FlagKey } from './flags.js'

export interface LintIssue {
  rule: string
  operation: string
  message: string
}

const driftVerbs = ['info', 'show', 'fetch', 'view', 'describe']
const namePattern = /^[a-z]+(?: [a-z]+)*$/

type Rule = (op: AnyOperation, all: AnyOperation[]) => string[]

export const rules: Record<string, Rule> = {
  'name-is-lowercase-words': op =>
    namePattern.test(op.name) ? [] : [`name "${op.name}" must be lowercase words separated by single spaces`],

  'name-has-no-drift-verb': op => {
    const words = op.name.split(' ')
    const bad = words.filter(w => driftVerbs.includes(w))
    return bad.length ? [`name "${op.name}" uses forbidden verb(s): ${bad.join(', ')}`] : []
  },

  'flags-exist-in-registry': op =>
    op.flags.filter(k => !(k in flags)).map(k => `flag key "${String(k)}" is not in the registry`),

  'flags-are-not-global': op =>
    op.flags.filter(k => (flags[k as FlagKey] as { global?: boolean })?.global).map(k => `global flag "${String(k)}" must not be declared per op`),

  'has-summary': op => (op.summary?.trim() ? [] : ['missing summary']),

  'has-description': op => (op.description?.trim() ? [] : ['missing description']),

  'has-example': op => (op.examples?.length ? [] : ['needs at least one example']),

  'has-output-schema': op => (op.output ? [] : ['missing output schema']),

  'has-render': op => (typeof op.render === 'function' ? [] : ['missing render']),

  'network-matches-request': op => {
    if (op.network === 'remote' && typeof op.request !== 'function') return ['network "remote" requires request()']
    if (op.network === 'none' && op.request) return ['network "none" must not define request()']
    if (op.network === 'none' && typeof op.compute !== 'function') return ['network "none" requires compute()']
    return []
  },

  'examples-start-with-name': op =>
    (op.examples ?? [])
      .filter(e => !e.command.startsWith(`ecfr ${op.name}`))
      .map(e => `example "${e.command}" must start with "ecfr ${op.name}"`),

  'name-is-unique': (op, all) =>
    all.filter(o => o.name === op.name).length > 1 ? [`name "${op.name}" is declared more than once`] : [],

  'title-scoped-has-title': op => {
    if (!op.titleScoped) return []
    const hasTitle = op.positional?.name === 'title' || op.flags.includes('title')
    return hasTitle ? [] : ['titleScoped requires a "title" positional or flag']
  },

  'raw-output-xml-has-xml-flag': op =>
    op.rawOutput === 'xml' && !op.flags.includes('xml') ? ['rawOutput "xml" requires the "xml" flag'] : [],
}

export function lintOperations(ops: AnyOperation[]): LintIssue[] {
  const issues: LintIssue[] = []
  for (const op of ops) {
    for (const [rule, check] of Object.entries(rules)) {
      for (const message of check(op, ops)) {
        issues.push({ rule, operation: op.name ?? '<unnamed>', message })
      }
    }
  }
  return issues
}

export function formatLintIssues(issues: LintIssue[]): string {
  return issues.map(i => `${i.operation}: [${i.rule}] ${i.message}`).join('\n')
}
