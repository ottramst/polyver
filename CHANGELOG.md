## Unreleased

FEATURES:

- VERS core following vers-spec Clause 5: `parseVers` (strict), `normalizeVers` (repairs non-canonical
  input), `stringifyVers` and `contains`, with typed `VersError` codes. Containment includes the fix
  for single-bound ranges ([vers-spec#54](https://github.com/package-url/vers-spec/issues/54)).
- Schemes `semver`, `npm` (versions), `intdot`, `lexicographic`, `datetime`, `all` and `none`.

NOTES:

- Initial project setup
