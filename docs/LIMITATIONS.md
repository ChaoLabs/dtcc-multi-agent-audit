# Known limitations

- The inherited scanner is based on regex and approximate function scopes. It is not an AST, compiler, symbolic executor or formal verifier. Formatting, comments, naming and cross-contract behavior can cause false positives and false negatives.
- A `delegatecall` match does not prove an attacker controls its target. A transfer without a recognized modifier is not necessarily unauthorized. The guessing-game fixture illustrates this ambiguity.
- A callback fixture includes attack-side code. Its match does not establish a defect in a victim contract.
- The delegatecall fixture includes compiler-incompatible syntax and is intentionally preserved. No compilation success is implied. Repaired variants must be separate, attributed files.
- All severity levels are rule or model proposals. No probability, portfolio risk score, loss estimate, compliance verdict or “safe contract” label is produced.
- Historical taxonomy/confidence tags remain inside the retained legacy module for provenance; the public adapter deliberately does not publish them as validated SWC/OWASP mappings. New taxonomy mappings need versioned review.
- Binding an excerpt to source only establishes structural grounding. It does not validate the vulnerability explanation or prove an exploit.
- No Slither, compiler, multi-agent workflow, human review, dependency resolution, bytecode or on-chain state analysis runs. Bedrock single-model review is optional and requires a valid user-supplied key with access to the selected model.
- The web route uses visitor-owned keys with fixed AWS routing and per-instance bounds. It has no application accounts, distributed rate limits, durable jobs or retention service. Keep the optional Python service on loopback; it is not the public web API.
- The five inherited fixtures are regression/demo cases, not an independent evaluation set. Expected rule presence is not precision/recall, especially when a rule emits additional candidates.
- Public examples are recorded. They do not update just because the website is opened. Their displayed timestamps refer to report generation, not the visitor's current time.
- The static engine detects code-level patterns only. Model review adds hypotheses, not a verified full audit. Asset custody, upgrade governance, operational key management, adversarial economic conditions and business impact require later scope/context and qualified review.
- Browser tests cover Chromium, including a mobile viewport; native Safari/Firefox and the user's particular macOS environment are not certified by Linux test results.
