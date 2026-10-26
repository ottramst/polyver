/**
 * VERS ("version range specifier") parsing and containment.
 *
 * Spec: https://github.com/package-url/vers-spec (Clause 5). The core spec defines only the syntax,
 * the comparators, validation and the containment algorithm; how versions compare is delegated to
 * each versioning scheme (see ./schemes).
 */

export type Comparator = '=' | '!=' | '<' | '<=' | '>' | '>='

export type Constraint =
  | { readonly comparator: Comparator; readonly version: string }
  | { readonly comparator: '*' }

export interface VersRange {
  /** Versioning scheme, e.g. `npm`, `pypi`, `deb`. Lowercase. */
  readonly scheme: string
  /** Constraints in canonical order (sorted by version, per the scheme's comparison). */
  readonly constraints: readonly Constraint[]
}

export class VersError extends Error {
  override readonly name = 'VersError'
}

/** Parses a `vers:<scheme>/<constraints>` string. Throws {@link VersError} on invalid input. */
export function parseVers(_input: string): VersRange {
  throw new VersError('parseVers: not implemented')
}

/** Serializes a range to its canonical `vers:` string. */
export function stringifyVers(_range: VersRange): string {
  throw new VersError('stringifyVers: not implemented')
}

/** Reports whether `version` is contained in `range`, using the range's versioning scheme. */
export function contains(_range: VersRange | string, _version: string): boolean {
  throw new VersError('contains: not implemented')
}
