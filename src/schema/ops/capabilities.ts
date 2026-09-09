import { z } from 'zod'
import packageJson from '../../../package.json'
import { CliError } from '../../runtime/errors.js'
import { flags, globalFlagKeys } from '../flags.js'
import { envVars } from '../env.js'
import { defaultTarget, policy, targets } from '../policy.js'
import {
  defineOperation,
  envelopeSchema,
  errorCodes,
  errorSchema,
  exitCodeTable,
  schemaVersion,
} from '../types.js'

const outputSchema = z.looseObject({
  cli: z.looseObject({ name: z.string(), version: z.string() }),
  schema_version: z.string(),
  targets: z.record(z.string(), z.looseObject({
    name: z.string(),
    base_url: z.string(),
    description: z.string(),
  })),
  default_target: z.string(),
  environment: z.array(z.object({ name: z.string(), description: z.string() })),
  operations: z.array(z.looseObject({ name: z.string() })),
})

export const capabilities = defineOperation({
  name: 'capabilities',
  kind: 'introspect',
  summary: 'Describe CLI capabilities',
  description: 'Returns the machine-readable contract for operations, flags, policy, error codes, exit codes, and envelope schemas without using the network. Naming one operation returns the same document scoped to that operation alone.',
  positional: {
    name: 'operation',
    description: 'Name of a single operation to describe. Omit for the full contract.',
    schema: z.string().optional(),
    optional: true,
  },
  flags: [],
  input: z.object({ operation: z.string().optional() }),
  network: 'none',
  rawOutput: 'json',
  compute: async input => {
    const { operations } = await import('../index.js')
    const names = operations.map(op => op.name)
    const scoped = input.operation === undefined
      ? operations
      : operations.filter(op => op.name === input.operation)
    if (scoped.length === 0) {
      throw new CliError('USAGE', `No operation is named "${input.operation}".`, {
        field: 'operation',
        remediation: `Pass one of these operation names, or omit the argument for the full contract: ${names.join(', ')}.`,
        details: { operation: input.operation, operations: names },
      })
    }
    return {
      cli: { name: 'ecfr', version: packageJson.version },
      schema_version: schemaVersion,
      targets,
      default_target: defaultTarget,
      environment: Object.values(envVars).map(variable => ({
        name: variable.name,
        description: variable.description,
      })),
      policy,
      exit_codes: exitCodeTable,
      error_codes: errorCodes,
      global_flags: globalFlagKeys.map(key => ({
        name: `--${flags[key].name}`,
        ...('value' in flags[key] && flags[key].value ? { value: flags[key].value } : {}),
        description: flags[key].description,
      })),
      operations: scoped.map(op => ({
        name: op.name,
        kind: op.kind,
        summary: op.summary,
        description: op.description,
        positional: op.positional
          ? {
              name: op.positional.name,
              description: op.positional.description,
              optional: op.positional.optional ?? false,
            }
          : null,
        flags: op.flags.map(key => ({
          name: `--${flags[key].name}`,
          ...('value' in flags[key] && flags[key].value ? { value: flags[key].value } : {}),
          description: flags[key].description,
        })),
        network: op.network,
        untrusted: op.untrusted ?? (op.network === 'remote' ? ['data'] : []),
        title_scoped: op.titleScoped ?? false,
        raw_output: op.rawOutput ?? null,
        examples: op.examples,
        output_schema: z.toJSONSchema(op.output),
      })),
      schemas: {
        envelope: z.toJSONSchema(envelopeSchema),
        error: z.toJSONSchema(errorSchema),
      },
    }
  },
  output: outputSchema,
  render: data => JSON.stringify(data, null, 2),
  examples: [
    { command: 'ecfr capabilities', description: 'Print the complete CLI capabilities as JSON' },
    { command: 'ecfr capabilities read', description: 'Print the same document scoped to one operation' },
  ],
})
