/**
 * The single list every surface is generated from.
 */
import type { AnyOperation } from './types.js'
import { agencies } from './ops/agencies.js'
import { capabilities } from './ops/capabilities.js'
import { changes } from './ops/changes.js'
import { corrections } from './ops/corrections.js'
import { counts } from './ops/counts.js'
import { read } from './ops/read.js'
import { search } from './ops/search.js'
import { structure } from './ops/structure.js'
import { titles } from './ops/titles.js'

export const operations: AnyOperation[] = [
  titles,
  agencies,
  structure,
  search,
  counts,
  changes,
  corrections,
  read,
  capabilities,
]

export function findOperation(name: string): AnyOperation | undefined {
  return operations.find(op => op.name === name)
}

export * from './types.js'
export * from './flags.js'
export * from './env.js'
export * from './policy.js'
export { lintOperations, formatLintIssues, rules as lintRules } from './lint.js'
