import { describe, it } from 'vitest'

// Conformance tests come from package-url/vers-spec tests/ (vers-test schema), vendored under testdata/.
describe('parseVers', () => {
  it.todo('parses and canonicalizes vers_canonical_parse_test vectors')
  it.todo(
    'rejects ranges that break the validation rules (order, uniqueness, single *, alternation)',
  )
})

describe('contains', () => {
  it.todo('passes npm_range_containment vectors')
  it.todo('passes pypi_range_containment vectors')
})

describe('schemes', () => {
  it.todo('deb: matches dpkg --compare-versions oracle vectors')
  it.todo('rpm: matches rpmvercmp oracle vectors, including ~ and ^')
  it.todo('apk: matches apk version -t oracle vectors')
})
