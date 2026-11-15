"""Signing in and saving the AI's credentials from the Settings page (decision 51)."""

import os
from pathlib import Path

import pytest
from api import ai_signin, env_file
from api.ai_signin import SignIn
from api.trading import Refused

KEY = "sk-ant-api03-" + "k" * 40  # made up, the shape only
TOKEN = "sk-ant-oat01-" + "t" * 40
LINK = "https://claude.com/cai/oauth/authorize?code=true&client_id=made-up&state=x"


@pytest.fixture
def dotenv(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    file = tmp_path / ".env"
    file.write_text("DEMO=0\nANTHROPIC_API_KEY=\nDESK_QUOTE=USDC\n", encoding="utf-8")
    monkeypatch.setenv("DESK_ENV_FILE", str(file))
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("CLAUDE_CODE_OAUTH_TOKEN", raising=False)
    return file


def test_a_key_replaces_its_line_and_a_token_is_added(dotenv: Path) -> None:
    env_file.save("ANTHROPIC_API_KEY", f"  {KEY}\n")
    env_file.save("CLAUDE_CODE_OAUTH_TOKEN", TOKEN)
    lines = dotenv.read_text(encoding="utf-8").splitlines()
    assert lines == [
        "DEMO=0",
        f"ANTHROPIC_API_KEY={KEY}",
        "DESK_QUOTE=USDC",
        f"CLAUDE_CODE_OAUTH_TOKEN={TOKEN}",
    ]
    assert os.environ["ANTHROPIC_API_KEY"] == KEY  # used at once, no restart


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("ANTHROPIC_API_KEY", "not-a-key"),
        ("ANTHROPIC_API_KEY", KEY + "\nBINANCE_API_KEY=evil"),  # no extra lines
        ("CLAUDE_CODE_OAUTH_TOKEN", KEY),  # a key isn't a token
        ("BINANCE_API_KEY", KEY),  # only the two AI names may be written
    ],
)
def test_only_the_ai_credentials_in_their_own_shape_are_saved(
    dotenv: Path, name: str, value: str
) -> None:
    before = dotenv.read_text(encoding="utf-8")
    with pytest.raises(Refused) as caught:
        env_file.save(name, value)
    assert dotenv.read_text(encoding="utf-8") == before
    assert value not in str(caught.value)


def test_without_the_mount_it_says_how_to_fix_it(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DESK_ENV_FILE", raising=False)
    with pytest.raises(Refused, match="docker compose up"):
        env_file.save("ANTHROPIC_API_KEY", KEY)


class FakeTerminal:
    """Plays `claude setup-token`: a welcome, the link, then the token once a code is typed."""

    def __init__(self, link: str = LINK, token: str | None = TOKEN) -> None:
        self.screens = [
            "\x1b[1mWelcome to Claude Code\x1b[0m\r\n",
            f"Use the url below\r\n{link}\r\n",
        ]
        self.token = token
        self.typed: list[str] = []
        self.closed = False

    def read(self, seconds: float) -> str:
        del seconds
        return self.screens.pop(0) if self.screens else ""

    def write(self, text: str) -> None:
        self.typed.append(text)
        if self.token and text == "\r":
            self.screens += ["Your token:\r\n\x1b[32m", self.token, "\x1b[0m\r\n"]

    def close(self) -> None:
        self.closed = True


def test_the_sign_in_hands_over_the_link_types_the_code_and_returns_the_token() -> None:
    terminal = FakeTerminal()
    signin = SignIn(spawn=lambda: terminal)
    assert signin.start() == LINK
    assert signin.finish("  abc123#state-xyz ") == TOKEN
    assert terminal.typed == ["abc123#state-xyz", "\r"]
    assert terminal.closed


def test_a_sign_in_without_a_link_or_a_token_says_so(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ai_signin, "START_SECONDS", 0.05)
    monkeypatch.setattr(ai_signin, "FINISH_SECONDS", 0.05)
    monkeypatch.setattr(ai_signin, "PAUSE_SECONDS", 0)
    with pytest.raises(Refused, match="sign-in link"):
        SignIn(spawn=lambda: FakeTerminal(link="no link here")).start()
    signin = SignIn(spawn=lambda: FakeTerminal(token=None))
    signin.start()
    with pytest.raises(Refused, match="didn't accept"):
        signin.finish("abc123#state")


def test_a_code_needs_a_started_and_fresh_sign_in() -> None:
    clock = [0.0]
    signin = SignIn(spawn=FakeTerminal, clock=lambda: clock[0])
    with pytest.raises(Refused, match="expired"):
        signin.finish("abc123#state")
    signin.start()
    with pytest.raises(Refused, match="whole code"):
        signin.finish("a b")
    clock[0] = 601
    with pytest.raises(Refused, match="expired"):
        signin.finish("abc123#state")
