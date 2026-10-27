#!/usr/bin/env python3
"""Collect all available Docker logs and warning/error lines with secrets redacted."""

import argparse
import json
import re
import subprocess
from datetime import UTC, datetime
from pathlib import Path


def redact(text, secrets=()):
    for secret in secrets:
        if len(secret) > 3:
            text = text.replace(secret, "[REDACTED]")
    text = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", text)
    text = re.sub(
        r"(?i)([?&](?:access_token|api_key|token)=)[^&\s\"]+", r"\1[REDACTED]", text
    )
    text = re.sub(r"(?i)(Bearer\s+)[A-Za-z0-9._-]+", r"\1[REDACTED]", text)
    text = re.sub(r"([a-z]+://)[^@\s/]+@", r"\1[REDACTED]@", text)
    prefix, separator, payload = text.partition(" ")
    candidate = payload if re.match(r"^\d{4}-\d\d-\d\dT", prefix) else text
    try:
        document = json.loads(candidate)
    except (ValueError, TypeError):
        return re.sub(
            r"""(?i)((?:password|token|secret|api[_-]?key)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|\S+)""",
            r"\1[REDACTED]",
            text,
        )

    def clean(value):
        if isinstance(value, dict):
            return {
                key: "[REDACTED]"
                if any(
                    word in key.lower()
                    for word in (
                        "password",
                        "token",
                        "secret",
                        "authorization",
                        "cookie",
                        "api-key",
                        "apikey",
                        "api_key",
                    )
                )
                else clean(item)
                for key, item in value.items()
            }
        if isinstance(value, list):
            return [clean(item) for item in value]
        return value

    encoded = json.dumps(clean(document), ensure_ascii=False)
    return prefix + separator + encoded if candidate is payload else encoded


def severity(text):
    structured = re.search(r'"level"\s*:\s*"([^"]+)"', text)
    if structured:
        level = structured[1].lower()
        return (
            "error"
            if level in ("error", "fatal", "panic")
            else "warning"
            if level in ("warn", "warning")
            else None
        )
    console = re.search(r"\b(WRN|ERR|FTL|INF|DBG|VRB)\b", text)
    if console:
        return (
            "warning"
            if console[1] == "WRN"
            else "error"
            if console[1] in ("ERR", "FTL")
            else None
        )
    if re.search(r"\b(error|fatal|exception|traceback)\b", text, re.IGNORECASE):
        return "error"
    return "warning" if re.search(r"\b(warn|warning)\b", text, re.IGNORECASE) else None


def known_secrets(paths):
    values = []
    for path in paths:
        if not path.is_file():
            continue
        content = path.read_text()
        values += re.findall(r"dns\s+duckdns\s+(\S+)", content)
        for line in content.splitlines():
            if re.search(r"password|token|secret|api.?key", line, re.IGNORECASE):
                match = re.match(r"\s*[\w.-]+\s*[:=]\s*(.+)", line)
                if match:
                    values.append(match[1].strip().strip("\"'"))
    return values


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--container", action="append", required=True)
    parser.add_argument("--secret-file", type=Path, action="append", default=[])
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, mode=0o700, exist_ok=True)
    args.output.chmod(0o700)
    secrets = known_secrets(args.secret_file)
    summary = {"collectedAt": datetime.now(UTC).isoformat(), "containers": {}}
    for container in args.container:
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", container):
            raise ValueError("Invalid container name")
        full = args.output / (container + ".log")
        findings = args.output / (container + ".warnings-errors.log")
        counts = {"warning": 0, "error": 0}
        with full.open("w") as logs, findings.open("w") as issues:
            full.chmod(0o600)
            findings.chmod(0o600)
            process = subprocess.Popen(
                ["docker", "logs", "--timestamps", container],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
            for line in process.stdout:
                line = redact(line.rstrip("\n"), secrets)
                logs.write(line + "\n")
                level = severity(line)
                if level:
                    counts[level] += 1
                    issues.write(line + "\n")
            counts["collectorExitCode"] = process.wait()
        summary["containers"][container] = counts
    path = args.output / "summary.json"
    path.write_text(json.dumps(summary, indent=2) + "\n")
    path.chmod(0o600)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
