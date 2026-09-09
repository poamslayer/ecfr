import { z } from 'zod'
import packageJson from '../../../package.json'
import { flags, globalFlagKeys } from '../flags.js'
import { envVars } from '../env.js'
import { defaultTarget, policy, targets } from '../policy.js'
import {
  defineOperation,
  envelopeSchema,
  errorCodes,
  errorSchema,
  exitCodeTable,
} from '../types.js'

const outputSchema = z.looseObject({
  cli: z.looseObject({ name: z.string(), version: z.string() }),
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
  description: 'Returns the machine-readable contract for operations, flags, policy, error codes, exit codes, and envelope schemas without using the network.',
  flags: [],
  input: z.object({}),
  network: 'none',
  rawOutput: 'json',
  compute: async () => {
    const { operations } = await import('../index.js')
    return {
      cli: { name: 'ecfr', version: packageJson.version },
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
      operations: operations.map(op => ({
        name: op.name,
        kind: op.kind,
        summary: op.summary,
        description: op.description,
        positional: op.positional
          ? { name: op.positional.name, description: op.positional.description }
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
  examples: [{ command: 'ecfr capabilities', description: 'Print the complete CLI capabilities as JSON' }],
})
