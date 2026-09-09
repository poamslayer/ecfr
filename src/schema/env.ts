import { z } from 'zod'

export interface EnvVarDef {
  name: string
  description: string
  schema: z.ZodType
}

export const envVars = {
  output: {
    name: 'ECFR_OUTPUT',
    description: 'Default output format when neither --output nor --json is passed.',
    schema: z.enum(['json', 'text']),
  },
  agent: {
    name: 'ECFR_AGENT',
    description: 'Self-reported agent name, sent as X-Agent-Name on upstream calls and echoed in the envelope. For tracing only; nothing is authorized on it.',
    schema: z.string().min(1, 'Pass a non-empty agent name.'),
  },
} as const satisfies Record<string, EnvVarDef>

export interface EnvValues {
  output?: 'json' | 'text'
  agent?: string
}

type EnvSource = Record<string, string | undefined>
type DiagnosticWriter = (diagnostic: string) => void

const defaultDiagnosticWriter: DiagnosticWriter = diagnostic => process.stderr.write(`${diagnostic}\n`)

/** Parse registered environment variables without allowing a bad value to stop the CLI. */
export function readEnv(
  source: EnvSource = process.env,
  writeDiagnostic: DiagnosticWriter = defaultDiagnosticWriter,
): EnvValues {
  const values: EnvValues = {}
  for (const [key, definition] of Object.entries(envVars) as [keyof typeof envVars, EnvVarDef][]) {
    const raw = source[definition.name]
    if (raw === undefined) continue
    const parsed = definition.schema.safeParse(raw)
    if (!parsed.success) {
      writeDiagnostic(`warning: ${definition.name} was ignored because its value is invalid.`)
      continue
    }
    if (key === 'output') values.output = parsed.data as EnvValues['output']
    if (key === 'agent') values.agent = parsed.data as string
  }
  return values
}
