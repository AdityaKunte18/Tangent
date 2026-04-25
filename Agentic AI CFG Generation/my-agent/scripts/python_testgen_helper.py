import ast
import json
import os
import subprocess
import sys
from pathlib import Path


DISALLOWED_CALL_NAMES = {"open", "eval", "exec", "compile", "input", "__import__"}
DISALLOWED_ROOT_NAMES = {"os", "pathlib", "subprocess", "socket", "requests", "shutil"}
ALLOWED_FIXTURES = {"capsys"}


def read_payload():
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    return json.loads(raw)


def emit(payload):
    sys.stdout.write(json.dumps(payload))


def node_to_text(node):
    return ast.dump(node, annotate_fields=False, include_attributes=False)


def get_attribute_root(node):
    current = node
    while isinstance(current, ast.Attribute):
        current = current.value
    if isinstance(current, ast.Name):
        return current.id
    return None


class CandidateValidator(ast.NodeVisitor):
    def __init__(self, target_method):
        self.target_method = target_method
        self.errors = []
        self.called_targets = []
        self.assertions = []

    def visit_Import(self, node):
        self.errors.append("Imports are not allowed inside generated test functions.")

    def visit_ImportFrom(self, node):
        self.errors.append("Imports are not allowed inside generated test functions.")

    def visit_Call(self, node):
        if isinstance(node.func, ast.Name) and node.func.id in DISALLOWED_CALL_NAMES:
            self.errors.append(f"Disallowed call '{node.func.id}' is not allowed.")

        root_name = get_attribute_root(node.func)
        if root_name in DISALLOWED_ROOT_NAMES:
            self.errors.append(f"Disallowed module '{root_name}' is not allowed.")

        if isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name) and node.func.value.id == "module":
            self.called_targets.append(node.func.attr)

        self.generic_visit(node)

    def visit_With(self, node):
        self.generic_visit(node)

    def visit_Assert(self, node):
        self.assertions.append(node_to_text(node.test))
        self.generic_visit(node)


def command_check_environment():
    errors = []
    coverage_available = True
    pytest_available = True

    try:
        import coverage  # noqa: F401
    except Exception as exc:  # pragma: no cover - helper path
        coverage_available = False
        errors.append(f"coverage import failed: {exc}")

    try:
        import pytest  # noqa: F401
    except Exception as exc:  # pragma: no cover - helper path
        pytest_available = False
        errors.append(f"pytest import failed: {exc}")

    emit({
        "python": sys.executable,
        "pythonVersion": sys.version,
        "coverageAvailable": coverage_available,
        "pytestAvailable": pytest_available,
        "errors": errors,
    })


def command_validate_candidate():
    payload = read_payload()
    code = payload.get("code", "")
    target_method = payload.get("target_method", "")

    try:
        module = ast.parse(code)
    except SyntaxError as exc:
        emit({
            "valid": False,
            "errors": [f"Syntax error: {exc}"],
            "functionName": None,
            "fingerprint": None,
            "calledTargets": [],
            "assertionCount": 0,
            "usesCapsys": False,
        })
        return

    body = [node for node in module.body if not isinstance(node, ast.Expr) or not isinstance(node.value, ast.Constant)]
    if len(body) != 1 or not isinstance(body[0], (ast.FunctionDef, ast.AsyncFunctionDef)):
        emit({
            "valid": False,
            "errors": ["Candidate must contain exactly one pytest test function and no top-level statements."],
            "functionName": None,
            "fingerprint": None,
            "calledTargets": [],
            "assertionCount": 0,
            "usesCapsys": False,
        })
        return

    function = body[0]
    fixture_names = [arg.arg for arg in function.args.args]
    invalid_fixtures = [fixture for fixture in fixture_names if fixture not in ALLOWED_FIXTURES]

    validator = CandidateValidator(target_method)
    validator.visit(function)

    if not function.name.startswith("test_"):
        validator.errors.append("Generated function name must start with 'test_'.")

    if invalid_fixtures:
        validator.errors.append(f"Only pytest fixtures {sorted(ALLOWED_FIXTURES)} are allowed; found {invalid_fixtures}.")

    if target_method and target_method not in validator.called_targets:
        validator.errors.append(f"Candidate must call module.{target_method}(...) at least once.")

    call_shape = sorted(node_to_text(node) for node in ast.walk(function) if isinstance(node, ast.Call))
    assertion_shape = sorted(validator.assertions)
    fingerprint = json.dumps({
        "calls": call_shape,
        "assertions": assertion_shape,
        "fixtures": sorted(fixture_names),
    }, sort_keys=True)

    emit({
        "valid": len(validator.errors) == 0,
        "errors": validator.errors,
        "functionName": function.name,
        "fingerprint": fingerprint,
        "calledTargets": sorted(set(validator.called_targets)),
        "assertionCount": len(validator.assertions),
        "usesCapsys": "capsys" in fixture_names,
    })


def command_run_suite():
    payload = read_payload()
    test_file_path = Path(payload["test_file_path"]).resolve()
    coverage_json_path = Path(payload["coverage_json_path"]).resolve()
    working_dir = Path(payload.get("working_dir", test_file_path.parent)).resolve()
    working_dir.mkdir(parents=True, exist_ok=True)
    coverage_data_path = working_dir / ".coverage.generated"

    env = os.environ.copy()
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env["COVERAGE_FILE"] = str(coverage_data_path)

    run_command = [
        sys.executable,
        "-m",
        "coverage",
        "run",
        "--branch",
        "-m",
        "pytest",
        "-q",
        str(test_file_path),
    ]
    run_process = subprocess.run(
        run_command,
        cwd=str(working_dir),
        env=env,
        capture_output=True,
        text=True,
    )

    json_command = [
        sys.executable,
        "-m",
        "coverage",
        "json",
        "-o",
        str(coverage_json_path),
    ]
    json_process = subprocess.run(
        json_command,
        cwd=str(working_dir),
        env=env,
        capture_output=True,
        text=True,
    )

    raw_coverage = None
    if coverage_json_path.exists():
        raw_coverage = json.loads(coverage_json_path.read_text())

    emit({
        "ok": run_process.returncode == 0 and json_process.returncode == 0,
        "exitCode": run_process.returncode,
        "stdout": run_process.stdout,
        "stderr": run_process.stderr,
        "coverageStdout": json_process.stdout,
        "coverageStderr": json_process.stderr,
        "coverageJsonPath": str(coverage_json_path),
        "rawCoverage": raw_coverage,
    })


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Expected a helper command.")

    command = sys.argv[1]

    if command == "check_environment":
        command_check_environment()
        return
    if command == "validate_candidate":
        command_validate_candidate()
        return
    if command == "run_suite":
        command_run_suite()
        return

    raise SystemExit(f"Unknown helper command: {command}")


if __name__ == "__main__":
    main()
