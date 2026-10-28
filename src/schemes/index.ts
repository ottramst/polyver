import { apk } from './apk.ts'
import { cargo } from './cargo.ts'
import { composer } from './composer.ts'
import { datetime } from './datetime.ts'
import { deb } from './deb.ts'
import { gem } from './gem.ts'
import { golang } from './golang.ts'
import { intdot } from './intdot.ts'
import { lexicographic } from './lexicographic.ts'
import { maven } from './maven.ts'
import { npm } from './npm.ts'
import { nuget } from './nuget.ts'
import { pypi } from './pypi.ts'
import { rpm } from './rpm.ts'
import { semver } from './semver.ts'
import { all, none } from './star-only.ts'
import type { Scheme } from './types.ts'

export type { Scheme } from './types.ts'

const schemes = new Map<string, Scheme>(
  [
    all,
    apk,
    cargo,
    composer,
    datetime,
    deb,
    gem,
    golang,
    intdot,
    lexicographic,
    maven,
    none,
    npm,
    nuget,
    pypi,
    rpm,
    semver,
  ].map((s) => [s.type, s]),
)

/** Returns the scheme for a VERS type, or `undefined` if it is not supported. */
export function getScheme(type: string): Scheme | undefined {
  return schemes.get(type.toLowerCase())
}

/** Lists the supported VERS types. */
export function supportedSchemes(): string[] {
  return [...schemes.keys()].sort()
}
