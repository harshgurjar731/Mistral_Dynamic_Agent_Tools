"""
Purpose profiles — the tool and activity strategies behind one interface.
"""

from app.synthesis.profiles.activity import ActivityProfile
from app.synthesis.profiles.base import CodeProfile, ReviewDecision, RuntimePolicy
from app.synthesis.profiles.tool import ToolProfile

_PROFILES: dict[str, CodeProfile] = {"tool": ToolProfile(), "activity": ActivityProfile()}


def get_profile(purpose: str | None) -> CodeProfile:
    return _PROFILES.get(purpose or "tool", _PROFILES["tool"])


__all__ = ["CodeProfile", "ToolProfile", "ActivityProfile", "ReviewDecision",
           "RuntimePolicy", "get_profile"]
