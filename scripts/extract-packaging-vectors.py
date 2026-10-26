"""Extracts PEP 440 test vectors from pypa/packaging's tests/test_version.py as JSON.

Usage: python3 -I scripts/extract-packaging-vectors.py <test_version.py> <out.json>

The file is parsed with `ast`, never executed. Output:
- "sorted": VERSIONS, which packaging's tests treat as strictly ascending.
- "invalid": the parameters of test_invalid_versions.
- "normalized": the (version, normalized) pairs of test_normalized_versions, which compare equal.
"""

import ast
import json
import sys


def parametrize_values(tree: ast.Module, function: str) -> list:
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == function:
            for decorator in node.decorator_list:
                if isinstance(decorator, ast.Call) and getattr(decorator.func, "attr", "") == "parametrize":
                    return ast.literal_eval(decorator.args[1])
    raise SystemExit(f"{function} not found")


def main() -> None:
    source, output = sys.argv[1:3]
    tree = ast.parse(open(source, encoding="utf-8").read())
    versions = next(
        ast.literal_eval(node.value)
        for node in tree.body
        if isinstance(node, ast.Assign) and getattr(node.targets[0], "id", "") == "VERSIONS"
    )
    data = {
        "sorted": versions,
        "invalid": [v for v in parametrize_values(tree, "test_invalid_versions") if isinstance(v, str)],
        "normalized": [list(p) for p in parametrize_values(tree, "test_normalized_versions")],
    }
    with open(output, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1)
        f.write("\n")


main()
