#!/usr/bin/env python3
"""Privacy gate: stop private data from being committed, pushed or published.

Scans file contents for:

  * credentials - private keys, GitHub/OpenAI/AWS/Slack/Google tokens, JWTs,
    SAS signatures and hard-coded credential assignments
  * personal data - non-example email addresses, Australian mobile numbers and
    absolute home-directory paths
  * local terms - names, school codes and class codes listed in
    scripts/sensitive-terms.local, which is gitignored and never committed

Usage:
  python3 scripts/sensitive_gate.py --staged       # staged content (pre-commit)
  python3 scripts/sensitive_gate.py --all          # tracked worktree files
  python3 scripts/sensitive_gate.py --all-history  # every reachable commit

Exits 1 when anything is found. The CI workflow runs the same scan with
--all-history on every push, so a local bypass of the hooks still fails there.
"""

import argparse
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(
    subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        check=True,
        stdout=subprocess.PIPE,
        text=True,
    ).stdout.strip()
)
DEFAULT_TERMS = REPO / "scripts" / "sensitive-terms.local"
MAX_FINDINGS_SHOWN = 60

# Patterns are split where needed so this file never matches its own rules.
SECRET_RULES = [
    ("private key", re.compile("-----BEGIN " + r"(?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----")),
    ("GitHub token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}")),
    ("GitHub fine-grained token", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{22,}")),
    ("API key", re.compile(r"\bsk-[A-Za-z0-9]{32,}")),
    ("AWS access key", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("Slack token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}")),
    ("Google API key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
    ("JWT", re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")),
    ("SAS signature", re.compile(r"[?&](?:sv|sig)=[^&\s\"']{10,}", re.IGNORECASE)),
    (
        "credential assignment",
        re.compile(
            r"(?i)\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|"
            r"auth[_-]?token|client[_-]?secret)\b\s*[:=]\s*[\"'][^\"'\s]{8,}[\"']"
        ),
    ),
    ("absolute home path", re.compile(r"/Us" + r"ers/[A-Za-z0-9._-]+/")),
]

EMAIL = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
EMAIL_ALLOWED = re.compile(
    r"@(?:example\.(?:com|net|org)|school\.example|users\.noreply\.github\.com)$",
    re.IGNORECASE,
)
PHONE = re.compile(r"(?<![0-9A-Za-z])(?:\+?61|0)4\d{2}\s?\d{3}\s?\d{3}(?![0-9A-Za-z])")
# Icon and asset filenames like "128x128@2x.png" look like addresses to a naive scan.
FILE_LIKE = re.compile(
    r"\.(?:png|jpe?g|gif|svg|ico|icns|webp|bmp|tiff?|json|js|ts|tsx|jsx|rs|md|lock|toml|"
    r"yaml|yml|html?|css|woff2?)$",
    re.IGNORECASE,
)


def git(*args, binary=False):
    result = subprocess.run(
        ["git", *args], cwd=REPO, stdout=subprocess.PIPE, stderr=subprocess.PIPE
    )
    if result.returncode != 0:
        message = result.stderr.decode("utf-8", "replace").strip()
        raise SystemExit("git {} failed: {}".format(" ".join(args), message))
    return result.stdout if binary else result.stdout.decode("utf-8", "replace")


def load_terms(path):
    if not path.exists():
        return []
    terms = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        term = line.strip()
        if term and not term.startswith("#"):
            terms.append(term)
    return terms


def term_pattern(term):
    pattern = re.escape(term)
    if term[0].isalnum():
        pattern = r"(?<![A-Za-z0-9])" + pattern
    if term[-1].isalnum():
        pattern = pattern + r"(?![A-Za-z0-9])"
    return re.compile(pattern, re.IGNORECASE)


def compile_terms(terms):
    patterns = [(term, term_pattern(term)) for term in terms]
    if not patterns:
        return None, patterns
    combined = re.compile("|".join(p.pattern for _, p in patterns), re.IGNORECASE)
    return combined, patterns


def staged_files():
    names = git("diff", "--cached", "--name-only", "--diff-filter=ACMR").splitlines()
    for name in names:
        yield name, git("show", ":" + name, binary=True)


def worktree_files():
    names = git("ls-files", "-z").split("\0")
    for name in names:
        if not name:
            continue
        path = REPO / name
        if not path.is_file():
            continue
        yield name, path.read_bytes()


def history_blobs():
    seen = set()
    for line in git("rev-list", "--objects", "--all").splitlines():
        sha = line.split(" ", 1)[0]
        if sha in seen:
            continue
        seen.add(sha)
        if git("cat-file", "-t", sha).strip() != "blob":
            continue
        yield "blob " + sha, git("cat-file", "blob", sha, binary=True)


def redact(value):
    value = value.strip()
    if len(value) <= 6:
        return value[:1] + "\u2026"
    return value[:3] + "\u2026" + value[-1]


def scan(name, blob, combined_terms, term_patterns):
    if b"\0" in blob[:4096]:
        return []
    text = blob.decode("utf-8", "replace")
    findings = []
    for number, line in enumerate(text.splitlines(), 1):
        line = line[:2000]
        for label, rule in SECRET_RULES:
            match = rule.search(line)
            if match:
                findings.append((name, number, label, redact(match.group(0))))
        for match in EMAIL.finditer(line):
            address = match.group(0)
            domain = address.split("@", 1)[1]
            if not EMAIL_ALLOWED.search(address) and not FILE_LIKE.search(domain):
                findings.append((name, number, "non-example email", "***@" + domain))
        phone = PHONE.search(line)
        if phone:
            findings.append((name, number, "phone number", redact(phone.group(0))))
        if combined_terms and combined_terms.search(line):
            for term, pattern in term_patterns:
                if pattern.search(line):
                    findings.append(
                        (name, number, "private term", "{} \u2026 ({} chars)".format(term[0], len(term)))
                    )
                    break
    return findings


def main():
    parser = argparse.ArgumentParser(description="Scan for sensitive data before it is committed or pushed.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--staged", action="store_true", help="scan staged content (default)")
    mode.add_argument("--all", action="store_true", help="scan tracked worktree files")
    mode.add_argument("--all-history", action="store_true", help="scan every reachable commit")
    parser.add_argument("--terms", default=str(DEFAULT_TERMS), help="path to the local term list")
    args = parser.parse_args()

    terms = load_terms(Path(args.terms))
    combined_terms, term_patterns = compile_terms(terms)

    if args.all_history:
        source = history_blobs()
        label = "history"
    elif args.all:
        source = worktree_files()
        label = "worktree"
    else:
        source = staged_files()
        label = "staged files"

    findings = []
    for name, blob in source:
        findings.extend(scan(name, blob, combined_terms, term_patterns))

    if not findings:
        print("Privacy gate: clean ({}).".format(label))
        return 0

    print("Privacy gate: {} finding(s) in {}.".format(len(findings), label), file=sys.stderr)
    for name, number, rule, detail in findings[:MAX_FINDINGS_SHOWN]:
        print("  {}:{}  {}  {}".format(name, number, rule, detail), file=sys.stderr)
    if len(findings) > MAX_FINDINGS_SHOWN:
        print("  \u2026 {} more".format(len(findings) - MAX_FINDINGS_SHOWN), file=sys.stderr)
    print("Blocked. Remove the data (or replace it with invented sample data) and try again.", file=sys.stderr)
    if not terms:
        print(
            "Note: {} was not found, so named people and school codes were not checked.".format(args.terms),
            file=sys.stderr,
        )
    return 1


if __name__ == "__main__":
    sys.exit(main())
