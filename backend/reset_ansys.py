# Ends every leftover Ansys process, so the Student license is free again.
#
# Ansys Student allows one session at a time. After a crash, a dead session can keep holding
# the license, and the next Ansys start quietly falls back to a product that cannot solve
# (it dies at SOLVE). Ending the old processes fixes that.
#
# The backend calls reset_ansys() on its own when it notices the problem. You can also run it
# by hand from the backend folder:  python reset_ansys.py

from __future__ import annotations

import subprocess
import sys
import time

# Process names that belong to Ansys (matched anywhere in the name, ignoring case).
PATTERN = "ansys|mapdl|mpiexec|hydra|ansyscl|ansysli|AnsysFWW|Workbench"


def reset_ansys() -> list[str]:
    """Ends all Ansys processes. Returns the names it ended. Does nothing off Windows."""
    if sys.platform != "win32":
        return []
    script = (
        f"$p = Get-Process | Where-Object {{ $_.ProcessName -match '{PATTERN}' }}; "
        "$p | ForEach-Object { $_.ProcessName + ' ' + $_.Id }; "
        "$p | Stop-Process -Force -ErrorAction SilentlyContinue"
    )
    result = subprocess.run(
        ["powershell", "-NoProfile", "-Command", script],
        capture_output=True,
        text=True,
        timeout=60,
    )
    ended = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    if ended:
        # Give Windows a moment to release the license and the network port.
        time.sleep(3)
    return ended


if __name__ == "__main__":
    ended = reset_ansys()
    if ended:
        print("Ended:")
        for line in ended:
            print("  " + line)
    else:
        print("No Ansys processes were running.")
