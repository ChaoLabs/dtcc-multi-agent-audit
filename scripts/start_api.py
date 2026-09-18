"""Start the loopback API; optionally collect a session-only Bedrock credential."""

import argparse
import getpass
import os
import subprocess
import sys
import warnings

import uvicorn


def clipboard_key():
    """Read only after the user explicitly requests the macOS clipboard flow."""
    try:
        result = subprocess.run(
            ["/usr/bin/pbpaste"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        raise ValueError("Could not read the macOS clipboard. Copy the key and retry.") from None
    if len(result.stdout) > 16_384:
        raise ValueError("Clipboard content is too long. Copy only the Bedrock API key.")
    try:
        key = result.stdout.decode("ascii").strip()
    except UnicodeDecodeError:
        raise ValueError("Copy only the Bedrock API key, without commands or quotes.") from None
    if not key.startswith("bedrock-api-key-") or len(key) <= len("bedrock-api-key-"):
        raise ValueError("Copy only the complete key beginning with bedrock-api-key-.")
    if any(ord(char) < 33 or ord(char) > 126 or char in "\"'`" for char in key):
        raise ValueError("Copy only the Bedrock API key, without commands or quotes.")
    return key


def checked_settings(parser):
    from audit_api.review import ReviewError, public_settings

    try:
        return public_settings()
    except ReviewError as exc:
        parser.error(str(exc))


def main():
    parser = argparse.ArgumentParser(description="DTCC local analysis API")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--bedrock",
        action="store_true",
        help="Prompt for Bedrock settings and a hidden session key",
    )
    mode.add_argument(
        "--bedrock-clipboard",
        action="store_true",
        help="macOS: read a long Bedrock key from the clipboard after confirmation",
    )
    args = parser.parse_args()
    if args.bedrock or args.bedrock_clipboard:
        if not sys.stdin.isatty():
            parser.error("Run Bedrock setup in an interactive terminal.")
        if args.bedrock_clipboard and sys.platform != "darwin":
            parser.error("--bedrock-clipboard is available on macOS only.")
        if args.bedrock and sys.platform == "darwin":
            print("For long macOS session keys, use --bedrock-clipboard to avoid paste limits.")
        print("Bedrock settings apply to this API process only; nothing is saved to disk.")
        region = input(f"AWS region [{os.getenv('AWS_REGION', 'us-east-1')}]: ").strip()
        protocol = input(
            f"Protocol: converse or mantle [{os.getenv('BEDROCK_PROTOCOL', 'converse')}]: "
        ).strip()
        model = input(f"Approved model ID [{os.getenv('BEDROCK_MODEL_ID', '')}]: ").strip()
        os.environ["AWS_REGION"] = region or os.getenv("AWS_REGION", "us-east-1")
        os.environ["BEDROCK_PROTOCOL"] = protocol or os.getenv("BEDROCK_PROTOCOL", "converse")
        os.environ["BEDROCK_MODEL_ID"] = model or os.getenv("BEDROCK_MODEL_ID", "")
        config = checked_settings(parser)
        if not config["model_id"]:
            parser.error("A Bedrock model ID is required. Restart and enter it before the key.")
        if args.bedrock_clipboard:
            print("Copy ONLY the Bedrock API key now. Do not paste it into this terminal.")
            input("Return here and press Enter to read the clipboard; Ctrl+C cancels: ")
            try:
                key = clipboard_key()
            except ValueError as exc:
                parser.error(str(exc))
            print("Key loaded from clipboard; it will not be printed or saved to a file.")
        else:
            with warnings.catch_warnings():
                warnings.simplefilter("error", getpass.GetPassWarning)
                try:
                    key = getpass.getpass(
                        "Bedrock API key (hidden; Enter keeps an existing environment key): "
                    ).strip()
                except getpass.GetPassWarning:
                    parser.error("Hidden input is unavailable. Use a local interactive terminal.")
        if key:
            os.environ["AWS_BEARER_TOKEN_BEDROCK"] = key
        config = checked_settings(parser)
        if not config["configured"]:
            parser.error("A model ID and a Bedrock API key are required.")
        print("Local Bedrock settings are ready. AWS access is checked when you run API analysis.")
    uvicorn.run("audit_api.main:app", host="127.0.0.1", port=8000)


if __name__ == "__main__":
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        print("\nSetup cancelled.", file=sys.stderr)
        sys.exit(130)
