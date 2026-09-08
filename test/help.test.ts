import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import packageJson from '../package.json'
import { flags, globalFlagKeys, operations } from '../src/schema/index.js'

const repoRoot = path.resolve(import.meta.dirname, '..')

function runCli(args: string[]): string {
  return execFileSync('node', ['--import', 'tsx', 'src/cli.ts', ...args], { cwd: repoRoot, encoding: 'utf8' })
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Help text per operation, spawned once for the whole file so no single test pays for nine cold starts. */
const helpFor = new Map<string, string>()

describe('--help', () => {
  beforeAll(() => {
    for (const op of operations) helpFor.set(op.name, runCli([op.name, '--help']))
  }, 60_000)

  it('--version prints the package.json version', () => {
    expect(runCli(['--version']).trim()).toBe(packageJson.version)
  })

  for (const op of operations) {
    const sharedKeys = [...op.flags, ...globalFlagKeys]

    it(`ecfr ${op.name} --help lists every declared flag plus --json and --dry-run`, () => {
      const help = helpFor.get(op.name)!
      for (const key of sharedKeys) {
        expect(help).toContain(`--${flags[key].name}`)
      }
      expect(help).toContain('--json')
      expect(help).toContain('--dry-run')
      if (op.positional) {
        expect(help).toContain(`<${op.positional.name}>`)
      }
    })

    it(`ecfr ${op.name} --help shows the shared registry description for each flag`, () => {
      const help = normalize(helpFor.get(op.name)!)
      for (const key of sharedKeys) {
        expect(help).toContain(normalize(flags[key].description))
      }
    })
  }

  it('the description for a shared flag is identical across every op that declares it', () => {
    const flagKeysInUse = new Set<string>()
    for (const op of operations) for (const key of op.flags) flagKeysInUse.add(key)
    for (const key of globalFlagKeys) flagKeysInUse.add(key)

    for (const key of flagKeysInUse) {
      const declaringOps = operations.filter(op => op.flags.includes(key) || globalFlagKeys.includes(key))
      const descriptions = declaringOps.map(op => normalize(helpFor.get(op.name)!).includes(normalize(flags[key].description)))
      expect(descriptions.every(Boolean)).toBe(true)
    }
  })
})
