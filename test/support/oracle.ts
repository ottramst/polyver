// Helpers for testing a scheme against its oracle output in testdata/oracle (see scripts/oracle).
import { expect } from 'vitest'
import type { Scheme } from '../../src/index.ts'
import { constraintDivergence, requirementDivergence } from './divergences.ts'
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
 * Reads testdata/oracle/<eco>-requirements.txt (`<version> satisfies|fails|error <requirement>`,
 * where `error` means the native tool rejects the requirement).
 */
export function oracleRequirements(eco: string): RequirementRow[] {
  const path = `oracle/${eco}-requirements.txt`
  return readTestdata(path)
    .split('\n')
    .flatMap((text, i) => {
      const m = /^(\S+) (satisfies|fails|error) (.+)$/.exec(text)
      if (!m) return []
      const [, version = '', verdict, requirement = ''] = m
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
