#!/usr/bin/env node
import { Command, CommanderError, Option } from 'commander'
import packageJson from '../package.json'
import { flags, globalFlagKeys, operations, optionSpec, type FlagKey } from './schema/index.js'
import type { AnyOperation } from './schema/types.js'
import { writeResult } from './runtime/output.js'
import { runOperation } from './runtime/run.js'

function addFlag(command: Command, key: FlagKey): void {
  const definition = flags[key]
  command.addOption(new Option(optionSpec(key), definition.description))
}

function rawInputFor(op: AnyOperation, command: Command, positionalValue?: unknown): Record<string, unknown> {
  const merged = command.optsWithGlobals<Record<string, unknown>>()
  const input: Record<string, unknown> = {}
  for (const key of op.flags) {
    if (merged[key] !== undefined) input[key] = merged[key]
  }
  if (op.positional) input[op.positional.name] = positionalValue
  return input
}

const program = new Command()
program
  .name('ecfr')
  .description('CLI for the Electronic Code of Federal Regulations (eCFR)')
  .version(packageJson.version)
  .exitOverride()
  .configureOutput({
    writeOut: text => process.stdout.write(text),
    writeErr: () => {},
  })

for (const key of globalFlagKeys) addFlag(program, key)

for (const op of operations) {
  const command = program.command(op.name).description(op.summary)
  if (op.positional) command.argument(`<${op.positional.name}>`, op.positional.description)
  for (const key of op.flags) addFlag(command, key)
  for (const key of globalFlagKeys) addFlag(command, key)

  command.action(async (...args: unknown[]) => {
    const invoked = args.at(-1) as Command
    const positional = op.positional ? args[0] : undefined
    const merged = invoked.optsWithGlobals<Record<string, unknown>>()
    const input = rawInputFor(op, invoked, positional)
    const result = await runOperation(op, input, { dryRun: merged.dryRun === true })
    writeResult(result, {
      json: merged.json === true,
      isTTY: process.stdout.isTTY === true,
      stdout: process.stdout,
      stderr: process.stderr,
    })
    process.exitCode = result.exit_code
  })
}

try {
  await program.parseAsync(process.argv)
} catch (err) {
  if (err instanceof CommanderError) {
    if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') {
      process.exitCode = 0
    } else {
      const message = err.message.replace(/^error:\s*/i, '')
      process.stderr.write(`error [USAGE]: ${message}\n`)
      if (process.stderr.isTTY) process.stderr.write('hint: Run `ecfr --help`.\n')
      process.exitCode = 2
    }
  } else {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(`error [INTERNAL]: ${message}\n`)
    process.exitCode = 1
  }
}
