import { datetime } from './datetime.ts'
import { intdot } from './intdot.ts'
import { lexicographic } from './lexicographic.ts'
import { npm } from './npm.ts'
import { semver } from './semver.ts'
import { all, none } from './star-only.ts'
import type { Scheme } from './types.ts'

export type { Scheme } from './types.ts'

const schemes = new Map<string, Scheme>(
  [all, datetime, intdot, lexicographic, none, npm, semver].map((s) => [s.type, s]),
)

/** Returns the scheme for a VERS type, or `undefined` if it is not supported. */
export function getScheme(type: string): Scheme | undefined {
  return schemes.get(type.toLowerCase())
}

/** Lists the supported VERS types. */
export function supportedSchemes(): string[] {
  return [...schemes.keys()].sort()
}
