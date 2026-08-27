# Backend App Package
import platform

# Python 3.14 on Windows uses WMI queries for platform info by default.
# When Windows WMI is unresponsive or blocked, WMI queries block indefinitely.
# Setting _wmi = None forces platform to use fast Win32 APIs (sys.getwindowsversion / registry).
if hasattr(platform, "_wmi"):
    platform._wmi = None
