"""Inherited regex baseline. See docs/PROVENANCE.md; not an AST or compiler.
Historical SWC/OWASP/confidence fields are not part of the public report.
"""
import hashlib
import re

SEVERITY_ORDER = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}

# ----------------------------------------------------------- helpers --------

def _functions(source: str):
    """Yield (name, start_line, end_line) for each function/constructor/fallback/
    receive, using brace matching. 1-based, inclusive. Approximate but good
    enough to give each check a FUNCTION SCOPE instead of the whole file — this
    is what lets us cut reentrancy false positives across unrelated functions."""
    lines = source.splitlines()
    decl = re.compile(r"\b(function\s+(\w+)|constructor|fallback|receive)\b")
    out, i, n = [], 0, len(lines)
    while i < n:
        m = decl.search(lines[i])
        if not m:
            i += 1
            continue
        name = m.group(2) or m.group(1)
        depth, started, j = 0, False, i
        while j < n:
            depth += lines[j].count("{") - lines[j].count("}")
            if "{" in lines[j]:
                started = True
            if started and depth <= 0:
                break
            j += 1
        out.append((name, i + 1, min(j + 1, n)))  # clamp: braces may never close
        i = j + 1
    return out


def _finding(line, severity, swc, owasp, title, message, recommendation, *, confidence="high", evidence="static-rule", detector="legacy-static-rules"):
    finding_id = hashlib.sha256(f"{line}|{severity}|{swc}|{owasp}|{title}|{message}".encode()).hexdigest()[:16]
    return {
        "id": finding_id,
        "line": line,
        "severity": severity,          # HIGH | MEDIUM | LOW
        "swc": swc,                    # e.g. "SWC-107" or ""
        "owasp": owasp,                # e.g. "SC05" or ""
        "title": title,
        "message": message,            # one-line summary (kept stable for tests)
        "recommendation": recommendation,
        "confidence": confidence,
        "evidence": evidence,
        "detector": detector,
    }


# --------------------------------------------------------------- scan -------

def scan(source: str):
    """Deterministic, function-scoped vulnerability scan. Returns a list of
    structured finding dicts (see `_finding`)."""
    findings = []
    lines = source.splitlines()
    funcs = _functions(source)
    weak_randomness_reported = False
    game_parity_reported = False

    # --- file-level: compiler pragma ---
    if not re.search(r"\bpragma\s+solidity\b", source):
        findings.append(_finding(
            1, "LOW", "SWC-103", "SC03",
            "Missing compiler pragma",
            "missing Solidity compiler pragma -> compiler version is not pinned",
            "Add a pinned pragma, e.g. `pragma solidity 0.8.24;`, so the contract "
            "cannot be compiled with an unexpected/older compiler.",
        ))

    # lines that write to a balances mapping (used for reentrancy ordering)
    balance_writes = [
        i for i, l in enumerate(lines, 1)
        if re.search(r"balances\[.*\]\s*(=|-=|\+=)", l)
    ]

    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith("//") or stripped.startswith("*"):
            continue

        # --- reentrancy: value call before a LATER balance write IN THE SAME FUNCTION ---
        if re.search(r"\.call\{value:", line):
            fn = next((f for f in funcs if f[1] <= i <= f[2]), None)
            same_fn_writes = [w for w in balance_writes if fn and fn[1] <= w <= fn[2]]
            if any(w > i for w in same_fn_writes):
                findings.append(_finding(
                    i, "HIGH", "SWC-107", "SC05",
                    "Reentrancy",
                    "external call before state update -> possible REENTRANCY (SWC-107)",
                    "Apply checks-effects-interactions: update state BEFORE the external "
                    "call, or use OpenZeppelin ReentrancyGuard.",
                ))
            # unchecked low-level call return value
            if "=" not in line.split(".call")[0] and not re.search(r"\brequire\s*\(", line):
                findings.append(_finding(
                    i, "MEDIUM", "SWC-104", "SC06",
                    "Unchecked low-level call",
                    "low-level call return value UNCHECKED (SWC-104)",
                    "Capture and check the boolean: (bool ok, ) = ...; require(ok);.",
                ))

        # --- unchecked .send() (returns bool, does not revert) ---
        if re.search(r"\.send\s*\(", line) and "=" not in line.split(".send")[0] \
                and not re.search(r"\brequire\s*\(", line):
            findings.append(_finding(
                i, "MEDIUM", "SWC-104", "SC06",
                "Unchecked send",
                "return value of .send() ignored -> silent failure (SWC-104)",
                "Check the return value of .send() or prefer .call with a require, "
                "using checks-effects-interactions.",
            ))

        # --- arbitrary delegatecall ---
        if re.search(r"\.delegatecall\s*\(", line):
            findings.append(_finding(
                i, "HIGH", "SWC-112", "SC01",
                "Arbitrary delegatecall",
                "delegatecall to caller-controlled code/data -> possible arbitrary DELEGATECALL (SWC-112)",
                "Never delegatecall to a caller-supplied address. Use a fixed, trusted "
                "implementation and a known upgrade pattern (e.g. UUPS).",
            ))

        # --- tx.origin authorization ---
        if "tx.origin" in line and re.search(r"require|==|if", line):
            findings.append(_finding(
                i, "HIGH", "SWC-115", "SC01",
                "tx.origin authorization",
                "tx.origin used for authorization (SWC-115)",
                "Use msg.sender for authorization; tx.origin is phishable.",
            ))

        # --- selfdestruct ---
        if re.search(r"selfdestruct\s*\(", line):
            findings.append(_finding(
                i, "MEDIUM", "SWC-106", "SC01",
                "selfdestruct present",
                "selfdestruct present -> contract can be destroyed (SWC-106)",
                "Guard selfdestruct behind strong access control, or remove it.",
            ))

        # --- outdated / floating pragma ---
        if re.search(r"pragma solidity\s*\^?0\.[4-7]\.", line):
            findings.append(_finding(
                i, "LOW", "SWC-103", "SC03",
                "Outdated compiler",
                "outdated compiler pragma (SWC-103)",
                "Upgrade to a current 0.8.x compiler (built-in overflow checks).",
            ))

        # --- weak randomness ---
        if (not weak_randomness_reported
                and re.search(r"\b(blockhash|block\.timestamp|block\.difficulty|block\.prevrandao|block\.number)\b", line)
                and re.search(r"\b(random|guess|answer|keccak256|winner|lottery)\b", source, re.IGNORECASE)):
            findings.append(_finding(
                i, "HIGH", "SWC-120", "SC09",
                "Insecure randomness",
                "predictable block data used as randomness -> weak randomness (SWC-120)",
                "Use a verifiable randomness source such as Chainlink VRF; on-chain "
                "block data is predictable/miner-influenceable.",
            ))
            weak_randomness_reported = True

        # --- phishing / drain: method calling a msg.sender-controlled contract ---
        if re.search(r"\w+\s*\(\s*msg\.sender\s*\)\s*\.\w+\s*\(", line):
            findings.append(_finding(
                i, "HIGH", "", "SC01",
                "Phishing / drain pattern",
                "external call to msg.sender-controlled contract -> phishing/drain pattern",
                "Do not call back into the caller as a trusted interface; treat external "
                "callers as untrusted.",
            ))

        # --- predictable two-player parity game ---
        if (not game_parity_reported
                and re.search(r"players\s*\[\s*\w+\s*%\s*2\s*\]", line)
                and re.search(r"players\s*\[\s*0\s*\]\.number\s*\+\s*players\s*\[\s*1\s*\]\.number", source)):
            findings.append(_finding(
                i, "HIGH", "SWC-120", "SC09",
                "Predictable game outcome",
                "winner is derived from player-supplied parity -> predictable game outcome",
                "The second player can read the first player's number on-chain and pick a "
                "winning parity. Use commit-reveal so choices are hidden until locked in.",
            ))
            game_parity_reported = True

    # --- access control: public/external function that changes ownership WITHOUT a guard (SC01) ---
    for name, start, end in funcs:
        if name in ("constructor", "receive", "fallback"):
            continue
        header = lines[start - 1]
        if not re.search(r"\b(public|external)\b", header):
            continue
        has_guard = re.search(r"\bonly\w*\b", header) is not None
        body = "\n".join(lines[start - 1:end])
        owner_write_line = None
        for k in range(start, min(end, len(lines)) + 1):
            if re.search(r"\bowner\s*=", lines[k - 1]) and "==" not in lines[k - 1]:
                owner_write_line = k
                break
        if owner_write_line and not has_guard and not re.search(r"\brequire\s*\(", body):
            findings.append(_finding(
                owner_write_line, "HIGH", "SWC-105", "SC01",
                "Missing access control",
                "function '" + name + "' changes ownership with no access control (SWC-105)",
                "Restrict state-changing/ownership functions with an access-control "
                "modifier (e.g. OpenZeppelin onlyOwner/RBAC).",
            ))

    # --- timestamp dependence in financial or authorization logic ---
    for i, line in enumerate(lines, 1):
        if re.search(r"\b(block\.timestamp|now)\b", line) and re.search(r"require|if|transfer|call|winner|release|unlock", line, re.IGNORECASE):
            findings.append(_finding(
                i, "MEDIUM", "SWC-116", "SC03",
                "Timestamp dependence",
                "block timestamp influences security-sensitive logic (SWC-116)",
                "Avoid exact timestamp assumptions; use safe time windows and do not use timestamps as randomness.",
                confidence="medium",
            ))

        # public/external ether transfer with no obvious caller guard
        if re.search(r"\.(transfer|send)\s*\(|\.call\s*\{\s*value", line):
            fn = next(((n, a, b) for n, a, b in funcs if a <= i <= b), None)
            if fn:
                name, start, end = fn
                header = lines[start - 1]
                body = "\n".join(lines[start - 1:end])
                guarded = bool(re.search(r"\bonly\w*\b", header) or re.search(r"require\s*\(\s*(?:msg\.sender|tx\.origin)\s*==", body))
                if re.search(r"\b(public|external)\b", header) and not guarded and name not in {"withdraw"}:
                    findings.append(_finding(
                        i, "HIGH", "SWC-105", "SC01",
                        "Unrestricted asset transfer",
                        f"function '{name}' can transfer Ether without an obvious caller authorization guard",
                        "Add explicit role-based access control and validate the recipient and amount.",
                        confidence="medium",
                    ))

    # --- loops over dynamic arrays can become gas-exhaustion / DoS risks ---
    for name, start, end in funcs:
        body = "\n".join(lines[start - 1:end])
        if re.search(r"for\s*\([^;]*;[^;]*\.length", body) or re.search(r"while\s*\(", body):
            loop_line = next((k for k in range(start, end + 1) if re.search(r"\b(for|while)\s*\(", lines[k - 1])), start)
            findings.append(_finding(
                loop_line, "MEDIUM", "SWC-128", "SC10",
                "Potential gas-exhaustion loop",
                f"function '{name}' contains a potentially unbounded loop",
                "Bound iteration counts, paginate work, or use pull-based processing.",
                confidence="medium",
            ))

    # De-duplicate exact detector outputs while preserving severity ordering.
    unique = {f["id"]: f for f in findings}
    findings = list(unique.values())
    findings.sort(key=lambda f: (SEVERITY_ORDER.get(f["severity"], 3), f["line"]))
    return findings
