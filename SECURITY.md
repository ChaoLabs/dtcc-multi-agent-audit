# Security scope

This is an academic prototype, not a service for confidential or production-critical audits.

- Do not commit AWS keys, session tokens, sensitive contracts, private reports or `.env` files. The ignore list helps but is not a secret scanner.
- The website accepts visitor-owned Bedrock keys only for explicit API analysis. Keys are held in tab/request memory, never in browser storage, cookies, report exports or application logs. No deployment AWS key or `NEXT_PUBLIC_*` secret is needed. The web route never falls back to a shared environment key.
- For an exposed short-term Bedrock token, follow your issuer's incident process. AWS documents invalidating the associated session or restricting token usage; generating another token does not by itself establish revocation. See [AWS key management](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html).
- Do not deploy the loopback API as a public multi-user service. CORS and Host checks are not authentication or quota enforcement.
- Treat contracts, comments and future model output as untrusted data. The current application does not execute Solidity, resolve imports or obey instructions inside source.
- Report non-sensitive reproducible issues through the repository. Do not put a credential, private source or exploitable private-system detail in a public issue; request a private reporting channel first.
- Review dependency advisories regularly. A clean advisory scan is time-specific and does not prove absence of vulnerabilities.

- The public Next.js route accepts same-origin JSON, enforces body/source/output limits and a fixed AWS destination, and sanitizes upstream errors. Never add request-body or credential logging. Hosting dashboards, log drains and browser extensions are outside application control.
- Per-instance request guards are not distributed abuse prevention. Configure hosting firewall/rate limits and monitor Vercel compute; visitor-owned AWS keys do not pay for Vercel hosting.
