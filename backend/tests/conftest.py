"""Backend tests. No test here calls a model or the tool service."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("MISTRAL_API_KEY", "test-key")
# Never read or write the developer's saved Settings-page values or model catalog.
import tempfile  # noqa: E402

_SETTINGS_TMP = tempfile.mkdtemp(prefix="backend_settings_")
os.environ["RUNTIME_SETTINGS_PATH"] = os.path.join(_SETTINGS_TMP, "runtime_settings.json")
os.environ["MODEL_CATALOG_PATH"] = os.path.join(_SETTINGS_TMP, "model_catalog.json")
