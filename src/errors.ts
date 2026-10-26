/**
 * Why a VERS operation failed:
 *
 * - `INVALID_SYNTAX`: the string is not a syntactically valid, canonical VERS (Clause 5.1 to 5.3).
 * - `INVALID_VERSION`: a version is not valid in the range's versioning scheme.
 * - `INVALID_CONSTRAINTS`: the constraints break a validation rule of Clause 5.4 (order, uniqueness,
 *   a single `*`, comparator sequence).
 * - `UNSUPPORTED_SCHEME`: polyver does not implement the VERS type.
 */
export type VersErrorCode =
  | 'INVALID_SYNTAX'
  | 'INVALID_VERSION'
  | 'INVALID_CONSTRAINTS'
  | 'UNSUPPORTED_SCHEME'

export class VersError extends Error {
  override readonly name = 'VersError'
  readonly code: VersErrorCode

  constructor(code: VersErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.code = code
  }
}
