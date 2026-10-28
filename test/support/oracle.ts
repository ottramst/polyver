// Helpers for testing a scheme against its oracle output in testdata/oracle (see scripts/oracle).
import { expect } from 'vitest'
import type { Scheme } from '../../src/index.ts'
import { constraintDivergence, rangeDivergence, requirementDivergence } from './divergences.ts'
import { readTestdata } from './vectors.ts'

export const SIGN = { '<': -1, '=': 0, '>': 1 } as const

/** Reads testdata/oracle/<eco>-validity.txt as [version, valid] pairs. */
export function oracleValidity(eco: string): [string, boolean][] {
  return readTestdata(`oracle/${eco}-validity.txt`)
    .split('\n')
    .filter((l) => l.startsWith('valid ') || l.startsWith('invalid '))
    .map((l) => {
      const [status, version] = l.split(' ') as [string, string]
      return [version, status === 'valid']
    })
}

export interface RequirementRow {
  readonly version: string
  readonly requirement: string
  /** The native tool's verdict, or polyver's where it deliberately differs (see divergences.ts). */
  readonly satisfied: boolean
  /**
   * Set when the requirement cannot be converted: the native tool rejects it, or polyver throws on
   * it for the reason in `divergence`.
   */
  readonly rejected?: true
  /** 1-based line number in the source file. */
  readonly line: number
  readonly divergence?: string
}

/**
 * Reads testdata/oracle/<eco>-<file>.txt (`<version> satisfies|fails <requirement>`): `requirements`
 * for gem and composer, `ranges` for nuget. A composer row `<version> error <requirement>` means that
 * Composer rejects the requirement.
 */
export function oracleRequirements(
  eco: string,
  file: 'requirements' | 'ranges' = 'requirements',
): RequirementRow[] {
  const path = `oracle/${eco}-${file}.txt`
  return readTestdata(path)
    .split('\n')
    .flatMap((text, i) => {
      const m = /^(\S+) (satisfies|fails|error) (.+)$/.exec(text)
      if (!m) return []
      const [, version = '', verdict, encoded = ''] = m
      const requirement = decode(encoded)
      const line = i + 1
      const thrown = constraintDivergence(path, requirement)
      if (verdict === 'error' || thrown) {
        return [
          {
            version,
            requirement,
            satisfied: false,
            rejected: true as const,
            line,
            ...(thrown && { divergence: thrown }),
          },
        ]
      }
      const divergence = requirementDivergence(path, version, requirement)
      const satisfied = (verdict === 'satisfies') !== (divergence !== undefined)
      return [{ version, requirement, satisfied, line, ...(divergence && { divergence }) }]
    })
}

/** Reads the `rejects <requirement>` rows of testdata/oracle/<eco>-requirements.txt. */
export function oracleRejectedRequirements(eco: string): string[] {
  return readTestdata(`oracle/${eco}-requirements.txt`)
    .split('\n')
    .flatMap((text) => (text.startsWith('rejects ') ? [decode(text.slice('rejects '.length))] : []))
}

export interface RangeValidity {
  readonly range: string
  /** The native tool's verdict, or polyver's where it deliberately differs (see divergences.ts). */
  readonly valid: boolean
  readonly divergence?: string
}

/** Reads the `valid-range <range>` and `invalid-range <range>` lines of testdata/oracle/<eco>-ranges.txt. */
export function oracleRangeValidity(eco: string): RangeValidity[] {
  const path = `oracle/${eco}-ranges.txt`
  return readTestdata(path)
    .split('\n')
    .flatMap((line) => {
      const m = /^(valid|invalid)-range (.+)$/.exec(line)
      if (!m) return []
      const range = decode(m[2] as string)
      const divergence = rangeDivergence(path, range)
      const valid = (m[1] === 'valid') !== (divergence !== undefined)
      return [{ range, valid, ...(divergence && { divergence }) }]
    })
}

/**
 * An oracle input written as a JSON string, so that it can keep surrounding or invisible whitespace
 * that a plain line would lose (see scripts/oracle/cases/nuget-ranges.txt, and `quote` in
 * scripts/oracle/generate.ts for cargo).
 */
function decode(text: string): string {
  return text.startsWith('"') ? (JSON.parse(text) as string) : text
}

/**
 * Sorts a sample of valid versions and checks every pair against the resulting ranks. Pairwise
 * vectors cannot show that `compare` is a total order (transitive and consistent), which VERS
 * validation and containment rely on.
 */
export function expectTotalOrder(s: Scheme, versions: string[]): void {
  const sorted = [...versions].sort((a, b) => s.compare(a, b))
  const rank = [0]
  for (let k = 1; k < sorted.length; k++) {
    const step = s.compare(sorted[k - 1] as string, sorted[k] as string) < 0 ? 1 : 0
    rank.push((rank[k - 1] as number) + step)
  }
  for (let i = 0; i < sorted.length; i++) {
    for (let j = 0; j < sorted.length; j++) {
      const got = Math.sign(s.compare(sorted[i] as string, sorted[j] as string))
      if (got !== Math.sign((rank[i] as number) - (rank[j] as number))) {
        expect.fail(`${sorted[i]} vs ${sorted[j]}: not a total order`)
      }
    }
  }
}
