import os
import asyncio
from app.services.workflow_engine.engine import list_workflows, get_workflow
from app.services.mistral_workflows_compiler import compile_workflow_to_python
from app.config import settings

def main():
    workflows = list_workflows()
    print(f"Found {len(workflows)} workflows.")
    
    workflows_dir = os.path.abspath(os.path.join(os.getcwd(), settings.MISTRAL_WORKFLOWS_DIR))
    os.makedirs(workflows_dir, exist_ok=True)
    
    for wf_meta in workflows:
        wf = get_workflow(wf_meta.name)
        if not wf:
            continue
        try:
            code = compile_workflow_to_python(wf)
            file_path = os.path.join(workflows_dir, f"workflow_{wf.name}.py")
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(code)
            print(f"Recompiled {wf.name} -> {file_path}")
        except Exception as e:
            print(f"Failed to compile {wf.name}: {e}")

if __name__ == '__main__':
    main()
