## Unreleased

FEATURES:

- VERS core following vers-spec Clause 5: `parseVers` (strict), `normalizeVers` (repairs non-canonical
  input), `stringifyVers` and `contains`, with typed `VersError` codes. Containment includes the fix
  for single-bound ranges ([vers-spec#54](https://github.com/package-url/vers-spec/issues/54)).
- Schemes `semver`, `npm`, `pypi` (PEP 440), `intdot`, `lexicographic`, `datetime`, `all` and `none`.
- `fromNative` converts npm ranges and PEP 440 specifiers to canonical VERS, merging overlapping
  alternatives.

NOTES:

- Initial project setup
