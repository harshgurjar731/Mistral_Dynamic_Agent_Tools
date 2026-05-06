"""
Sandbox — runs generated tool code in an isolated subprocess within the container.
"""

import subprocess
import tempfile
import json
import os
import logging

logger = logging.getLogger(__name__)


def run_in_sandbox(code: str, test_inputs: list[dict]) -> tuple[bool, str]:
    """
    Execute generated code in a subprocess with minimal environment.
    Returns (success, output_or_error).
    """
    with tempfile.NamedTemporaryFile(suffix=".py", mode="w", delete=False, dir="/tmp") as f:
        f.write(code)
        f.write(f"\n\nif __name__ == '__main__':\n")
        f.write(f"    import json, sys\n")
        f.write(f"    inputs = {json.dumps(test_inputs)}\n")
        f.write(f"    for inp in inputs:\n")
        f.write(f"        result = run(**inp)\n")
        f.write(f"        print(json.dumps(result))\n")
        tmp_path = f.name

    try:
        result = subprocess.run(
            ["python", tmp_path],
            capture_output=True,
            timeout=10,
            env={"PATH": "/usr/bin:/usr/local/bin"},  # minimal env — no secrets
            cwd="/tmp",
        )
    except subprocess.TimeoutExpired:
        return False, "Sandbox timeout: execution exceeded 10 seconds"
    except Exception as e:
        return False, f"Sandbox error: {str(e)}"
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    if result.returncode != 0:
        return False, result.stderr.decode(errors="replace")

    return True, result.stdout.decode(errors="replace")


def generate_test_inputs(parameters: dict, required: list[str]) -> list[dict]:
    """
    Auto-generate type-valid test inputs from the tool's parameter schema.
    """
    test_input = {}
    properties = parameters.get("properties", {})

    for param_name, param_def in properties.items():
        if not isinstance(param_def, dict):
            param_def = {"type": "string", "description": str(param_def)}

        param_type = param_def.get("type", "string")
        if param_type == "string":
            test_input[param_name] = param_def.get("default", f"test_{param_name}")
        elif param_type == "integer":
            test_input[param_name] = param_def.get("default", 1)
        elif param_type == "number":
            test_input[param_name] = param_def.get("default", 1.0)
        elif param_type == "boolean":
            test_input[param_name] = param_def.get("default", True)
        elif param_type == "array":
            test_input[param_name] = param_def.get("default", [])
        elif param_type == "object":
            test_input[param_name] = param_def.get("default", {})
        else:
            test_input[param_name] = f"test_{param_name}"

    return [test_input]
