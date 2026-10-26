import { readFileSync } from 'node:fs'
import { divergence } from './divergences.ts'

const TESTDATA = new URL('../../testdata/', import.meta.url)

export function readTestdata(path: string): string {
  return readFileSync(new URL(path, TESTDATA), 'utf8')
}

interface Base {
  readonly description: string
  readonly test_group: 'required' | 'recommended'
  readonly expected_failure?: boolean
  readonly expected_message?: string
  /** Set when polyver deliberately differs from the upstream expectation; see divergences.ts. */
  readonly divergence?: string
}

interface VersionsInput {
  readonly input_type?: string
  readonly input_scheme?: string
  readonly versions: readonly string[]
}

/** A test case of the vers-test schema 0.2 (vers-spec schemas/vers-test.schema-0.2.json). */
export type VersTest = Base &
  (
    | {
        readonly test_type: 'parse'
        readonly input: string
        readonly expected_output?: {
          readonly type: string
          readonly constraints: readonly (readonly [string, string?])[]
        } | null
      }
    | {
        readonly test_type: 'validate'
        readonly input: string
        readonly expected_output?: string | null
      }
    | {
        readonly test_type: 'containment'
        readonly input: { readonly vers: string; readonly version: string }
        readonly expected_output: boolean
      }
    | {
        readonly test_type: 'comparison'
        readonly input: VersionsInput
        readonly expected_output: readonly string[]
      }
    | {
        readonly test_type: 'equality'
        readonly input: VersionsInput
        readonly expected_output: boolean
      }
    | {
        readonly test_type: 'from_native'
        readonly input: { readonly native_range: string; readonly scheme: string }
        readonly expected_output?: string | null
      }
  )

/**
 * Loads a vers-test file (path relative to testdata/), with polyver's documented divergences from the
 * upstream expectations applied.
 */
export function loadVersTests(path: string): VersTest[] {
  const { tests } = JSON.parse(readTestdata(path)) as { tests: VersTest[] }
  return tests.map((t) => {
    const d = divergence(path, t.input)
    return d ? ({ ...t, ...d.override, divergence: d.reason } as VersTest) : t
  })
}

export interface ComparisonPair {
  readonly a: string
  readonly op: '<' | '=' | '>'
  readonly b: string
  /** 1-based line number in the source file. */
  readonly line: number
}

/**
 * Loads a file of `a <op> b` lines, the format of osv-scalibr semantic/testdata and of our oracle
 * output. Blank lines and lines starting with `#` or `//` are ignored, as is anything after a `#`.
 */
export function loadComparisonPairs(path: string): ComparisonPair[] {
  const pairs: ComparisonPair[] = []
  readTestdata(path)
    .split('\n')
    .forEach((text, i) => {
      const line = text.replace(/\s#.*$/, '').trim()
      if (line === '' || line.startsWith('#') || line.startsWith('//')) return
      const [a, op, b, ...rest] = line.split(/\s+/)
      if (!a || !b || (op !== '<' && op !== '=' && op !== '>') || rest.length > 0) {
        throw new Error(`${path}:${i + 1}: cannot parse ${JSON.stringify(text)}`)
      }
      pairs.push({ a, op, b, line: i + 1 })
    })
  return pairs
}
