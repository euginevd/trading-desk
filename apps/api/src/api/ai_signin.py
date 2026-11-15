"""Signing in to the owner's Claude subscription from the Settings page (decision 51), the way
Claude Code does it: the api runs Claude Code's own `claude setup-token` in a pseudo-terminal,
hands the desk its sign-in link, types back the code the owner pastes from claude.ai, and takes
the long-lived token it prints. The token goes to `.env` (api.env_file) and nowhere else.
"""

import contextlib
import os
import re
import sys
import tempfile
import threading
import time
from collections.abc import Callable
from typing import Protocol

from api.trading import Refused

URL = re.compile(r"https://\S+/oauth/authorize\?\S+")
TOKEN = re.compile(r"sk-ant-oat\d{2}-[A-Za-z0-9_-]{20,300}")
CODE = re.compile(r"[A-Za-z0-9#_.~-]{8,500}")
ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[=>()][0-9A-B]?")
START_SECONDS = 30
FINISH_SECONDS = 60
PAUSE_SECONDS = 0.5
KEEP_SECONDS = 600  # an unfinished sign-in is dropped after ten minutes
CLI = "claude_agent_sdk/_bundled/claude"


class Terminal(Protocol):
    def read(self, seconds: float) -> str: ...
    def write(self, text: str) -> None: ...
    def close(self) -> None: ...


class SignIn:
    """One sign-in at a time, held between the desk's two requests."""

    def __init__(
        self,
        spawn: Callable[[], Terminal] | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._spawn = spawn or _setup_token
        self._clock = clock
        self._lock = threading.Lock()
        self._terminal: Terminal | None = None
        self._started = 0.0

    def start(self) -> str:
        """Starts `claude setup-token` and returns the claude.ai link to sign in at."""
        with self._lock:
            self._close()
            terminal = self._spawn()
            seen, _ = _until(terminal, URL, START_SECONDS)
            if seen is None:
                terminal.close()
                raise Refused("Claude Code didn't offer a sign-in link. Try again.")
            self._terminal, self._started = terminal, self._clock()
            return seen

    def finish(self, code: str) -> str:
        """Types the owner's code into Claude Code and returns the token it prints."""
        code = code.strip()
        if not CODE.fullmatch(code):
            raise Refused("Paste the whole code claude.ai showed after you approved.")
        with self._lock:
            terminal = self._terminal
            if terminal is None or self._clock() - self._started > KEEP_SECONDS:
                self._close()
                raise Refused("That sign-in has expired. Start it again.")
            try:
                terminal.write(code)
                time.sleep(PAUSE_SECONDS)  # Enter on its own, not inside the pasted code
                terminal.write("\r")
                token, screen = _until(terminal, TOKEN, FINISH_SECONDS)
            finally:
                self._close()
            if token is None:
                # What Claude Code said instead, for the api's log, with anything secret blanked.
                print(f"Claude sign-in: no token. Claude Code showed: {_redacted(screen)}")  # noqa: T201
                raise Refused("Claude didn't accept that code. Start the sign-in again.")
            return token

    def _close(self) -> None:
        if self._terminal is not None:
            self._terminal.close()
            self._terminal = None


def _until(terminal: Terminal, pattern: re.Pattern[str], seconds: float) -> tuple[str | None, str]:
    """Reads the terminal until the pattern shows, on the screen's text without its colours;
    returns the match, if any, and the text seen."""
    seen = ""
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        chunk = terminal.read(min(1.0, max(end - time.monotonic(), 0.01)))
        if chunk:
            seen += chunk
            found = pattern.search(ANSI.sub("", seen))
            if found:
                return found.group(0), ""
    return None, ANSI.sub("", seen)


def _redacted(screen: str) -> str:
    """The end of the screen's text, with tokens, codes and links blanked, on one line."""
    text = re.sub(r"sk-ant-\S+|https?://\S+|[A-Za-z0-9#_.~-]{24,}", "[blanked]", screen)
    return " ".join(text.split())[-600:]


def _setup_token() -> Terminal:  # pragma: no cover - needs Linux and the real CLI
    return PtyTerminal()


class PtyTerminal:  # pragma: no cover - runs only in the api container
    """`claude setup-token` in a wide pseudo-terminal, so its link and token don't wrap, with a
    throwaway home and no secret in its environment."""

    _pid: int
    _fd: int

    def __init__(self) -> None:
        if sys.platform == "win32":
            raise Refused("Signing in runs in the api container, on Linux.")
        import fcntl  # noqa: PLC0415 - Linux only
        import pty  # noqa: PLC0415
        import struct  # noqa: PLC0415
        import termios  # noqa: PLC0415

        cli = next(
            (os.path.join(p, CLI) for p in sys.path if os.path.isfile(os.path.join(p, CLI))),
            None,
        )
        if cli is None:
            raise Refused("Claude Code isn't installed in the api image.")
        self._home = tempfile.TemporaryDirectory(prefix="desk-signin-", ignore_cleanup_errors=True)
        env = {
            "PATH": os.environ.get("PATH", ""),
            "HOME": self._home.name,
            "CLAUDE_CONFIG_DIR": self._home.name,
            "TERM": "xterm-256color",
            "COLUMNS": "1000",
            "DISABLE_AUTOUPDATER": "1",
            "DISABLE_TELEMETRY": "1",
            "DISABLE_ERROR_REPORTING": "1",
        }
        self._pid, self._fd = pty.fork()
        if self._pid == 0:
            os.execve(cli, [cli, "setup-token"], env)  # noqa: S606 - a fixed path, no shell
        fcntl.ioctl(self._fd, termios.TIOCSWINSZ, struct.pack("HHHH", 50, 1000, 0, 0))

    def read(self, seconds: float) -> str:
        if sys.platform == "win32":
            return ""
        import select  # noqa: PLC0415

        ready, _, _ = select.select([self._fd], [], [], seconds)
        if not ready:
            return ""
        try:
            return os.read(self._fd, 65536).decode("utf-8", "replace")
        except OSError:
            return ""

    def write(self, text: str) -> None:
        if sys.platform == "win32":
            return
        os.write(self._fd, text.encode())

    def close(self) -> None:
        if sys.platform == "win32":
            return
        import signal  # noqa: PLC0415

        with contextlib.suppress(OSError):
            os.kill(self._pid, signal.SIGKILL)
            os.waitpid(self._pid, 0)
        with contextlib.suppress(OSError):
            os.close(self._fd)
        self._home.cleanup()
