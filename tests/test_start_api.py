"""Credential-entry regression tests; synthetic values only, no system clipboard or AWS."""

import importlib.util
import os
import subprocess
import warnings
from pathlib import Path

import pytest


@pytest.fixture
def launcher(monkeypatch):
    path = Path(__file__).resolve().parents[1] / "scripts" / "start_api.py"
    spec = importlib.util.spec_from_file_location("dtcc_start_api", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    for name in (
        "AWS_REGION",
        "BEDROCK_PROTOCOL",
        "BEDROCK_MODEL_ID",
        "AWS_BEARER_TOKEN_BEDROCK",
        "BEDROCK_API_KEY",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("BEDROCK_MODEL_ID", "us.openai.gpt-6-astra")
    monkeypatch.setattr(module.sys, "argv", ["start_api.py", "--bedrock-clipboard"])
    monkeypatch.setattr(module.sys, "platform", "darwin")
    monkeypatch.setattr(module.sys.stdin, "isatty", lambda: True)
    monkeypatch.setattr("builtins.input", lambda prompt: "")
    monkeypatch.setattr(module.uvicorn, "run", lambda *args, **kwargs: None)
    return module


def clip(monkeypatch, launcher, data):
    def read(args, **kwargs):
        assert args == ["/usr/bin/pbpaste"]
        assert kwargs["stdin"] == subprocess.DEVNULL
        assert kwargs["stderr"] == subprocess.DEVNULL
        assert kwargs["timeout"] == 5
        assert "shell" not in kwargs
        return subprocess.CompletedProcess(args, 0, stdout=data)

    monkeypatch.setattr(launcher.subprocess, "run", read)


def test_long_key_reaches_api_intact_without_terminal_output(launcher, monkeypatch, capsys):
    key = "bedrock-api-key-" + "FAKE_NOT_A_CREDENTIAL_" * 400
    clip(monkeypatch, launcher, (key + "\n").encode())
    seen = []

    def start(*args, **kwargs):
        seen.append(os.environ["AWS_BEARER_TOKEN_BEDROCK"])
        assert args == ("audit_api.main:app",)
        assert kwargs == {"host": "127.0.0.1", "port": 8000}

    monkeypatch.setattr(launcher.uvicorn, "run", start)
    launcher.main()
    assert seen == [key]
    output = capsys.readouterr()
    assert key not in output.out + output.err
    assert "FAKE_NOT_A_CREDENTIAL" not in output.out + output.err
    assert "Key loaded from clipboard" in output.out


@pytest.mark.parametrize(
    "data",
    [
        b"",
        b"bedrock-api-key-",
        b"export AWS_BEARER_TOKEN_BEDROCK=bedrock-api-key-private",
        b"'bedrock-api-key-private'",
        b"bedrock-api-key-private\nsecond-line",
        b"bedrock-api-key-private\tmore",
        b"bedrock-api-key-\x00private",
        b"bedrock-api-key-\xffprivate",
        b"bedrock-api-key-`private`",
        b"bedrock-api-key-" + b"x" * 16_384,
    ],
)
def test_invalid_clipboard_never_starts_or_discloses(launcher, monkeypatch, capsys, data):
    clip(monkeypatch, launcher, data)
    monkeypatch.setenv("AWS_BEARER_TOKEN_BEDROCK", "existing-test-key")
    seen = []
    monkeypatch.setattr(launcher.uvicorn, "run", lambda *a, **kw: seen.append(True))
    with pytest.raises(SystemExit) as exc:
        launcher.main()
    assert exc.value.code == 2
    assert seen == []
    assert os.environ["AWS_BEARER_TOKEN_BEDROCK"] == "existing-test-key"
    output = capsys.readouterr()
    assert "private" not in output.out + output.err
    assert "existing-test-key" not in output.out + output.err


@pytest.mark.parametrize(
    "error",
    [
        OSError("private-clipboard-detail"),
        subprocess.TimeoutExpired(["pbpaste"], 5, output=b"private-clipboard-detail"),
        subprocess.CalledProcessError(1, ["pbpaste"], output=b"private-clipboard-detail"),
    ],
)
def test_clipboard_failure_is_sanitized(launcher, monkeypatch, capsys, error):
    def fail(*args, **kwargs):
        raise error

    monkeypatch.setattr(launcher.subprocess, "run", fail)
    with pytest.raises(SystemExit):
        launcher.main()
    output = capsys.readouterr()
    assert "Could not read" in output.err
    assert "private-clipboard-detail" not in output.out + output.err


@pytest.mark.parametrize("condition", ["cancel", "no-model", "not-macos", "not-tty"])
def test_does_not_read_clipboard_before_ready(launcher, monkeypatch, condition):
    def forbidden(*args, **kwargs):
        pytest.fail("Clipboard must not be read")

    monkeypatch.setattr(launcher.subprocess, "run", forbidden)
    expected = SystemExit
    if condition == "no-model":
        monkeypatch.delenv("BEDROCK_MODEL_ID")
    elif condition == "not-macos":
        monkeypatch.setattr(launcher.sys, "platform", "linux")
    elif condition == "not-tty":
        monkeypatch.setattr(launcher.sys.stdin, "isatty", lambda: False)
    else:

        def cancel(prompt):
            if "read the clipboard" in prompt:
                raise KeyboardInterrupt
            return ""

        monkeypatch.setattr("builtins.input", cancel)
        expected = KeyboardInterrupt
    with pytest.raises(expected):
        launcher.main()


def test_hidden_input_keeps_existing_key(launcher, monkeypatch):
    monkeypatch.setattr(launcher.sys, "argv", ["start_api.py", "--bedrock"])
    monkeypatch.setenv("AWS_BEARER_TOKEN_BEDROCK", "existing-test-key")
    monkeypatch.setattr(launcher.getpass, "getpass", lambda prompt: "")
    launcher.main()
    assert os.environ["AWS_BEARER_TOKEN_BEDROCK"] == "existing-test-key"


def test_hidden_input_never_falls_back_to_echo(launcher, monkeypatch, capsys):
    monkeypatch.setattr(launcher.sys, "argv", ["start_api.py", "--bedrock"])

    def unavailable(prompt):
        warnings.warn("Cannot control echo on the terminal.", launcher.getpass.GetPassWarning)
        pytest.fail("Must stop before fallback input")

    monkeypatch.setattr(launcher.getpass, "getpass", unavailable)
    with pytest.raises(SystemExit):
        launcher.main()
    assert "Hidden input is unavailable" in capsys.readouterr().err
