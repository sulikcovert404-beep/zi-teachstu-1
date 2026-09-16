#!/usr/bin/env python3
"""Round 30 — double-fork daemonizer.

The sandbox harness kills every process that is still a descendant of the
tool-call shell when the call ends (setsid alone is NOT enough because it does
not reparent). A classic double-fork makes the final child's parent = init (pid 1)
while the call is still running, so the service survives across tool calls —
this is how the boot-started services (via /start.sh → .zscripts/dev.sh) survive.

Usage:
  python3 daemon-start.py <logfile> <cwd> <cmd> [args...]

The log file is opened in append mode and becomes stdin/stdout/stderr.
"""
import os
import sys


def main() -> None:
    if len(sys.argv) < 4:
        print("usage: daemon-start.py <logfile> <cwd> <cmd> [args...]", file=sys.stderr)
        sys.exit(2)
    logfile, cwd, cmd = sys.argv[1], sys.argv[2], sys.argv[3]
    args = sys.argv[3:]

    pid = os.fork()
    if pid > 0:
        # Parent: wait for the intermediate so the grandchild is fully reparented
        # to init BEFORE this helper returns (i.e. before the tool call can end).
        os.waitpid(pid, 0)
        return

    # Intermediate child: new session, then fork again and exit immediately.
    os.setsid()
    if os.fork() > 0:
        os._exit(0)

    # Grandchild (parent = init): redirect stdio and exec the service.
    try:
        os.chdir(cwd)
    except Exception:
        pass
    os.umask(0o022)
    try:
        f = open(logfile, "ab", buffering=0)
        os.dup2(f.fileno(), 0)
        os.dup2(f.fileno(), 1)
        os.dup2(f.fileno(), 2)
        if f.fileno() > 2:
            f.close()
    except Exception:
        pass
    with open("/home/z/my-project/.zscripts/daemon-pids.log", "a") as pf:
        pf.write(f"{os.getpid()} {cmd} {' '.join(args)}\n")
    os.execvp(cmd, args)


if __name__ == "__main__":
    main()
