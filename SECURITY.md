# Security policy

## Supported versions
Only the latest release receives fixes.

## Reporting a vulnerability
Please **do not open a public issue** for a security problem. Use GitHub's private reporting instead:
**Security → Report a vulnerability** on this repository. Include what you found, the steps to reproduce it and the extension version
(`chrome://extensions`). You should get a first reply within about a week; this is a volunteer project, so please be patient.

## Things worth reporting
- A way for a web page to read data this extension stores, or to trigger its API-key flow.
- Any path where chat text or the API key could be sent somewhere other than `api.anthropic.com` (and only with exact counting on).
- Content-script behaviour that could be abused on the three supported sites.

## Design choices that matter for security
- No remote code: all scripts are bundled; the manifest asks for the minimum (`storage`, three sites, one optional host).
- DOM is built with `createElement` and `textContent`, never `innerHTML`, so it runs under Trusted Types.
- The API key is stored in `chrome.storage.local`, excluded from exports, and only sent to `api.anthropic.com`.
- Diagnostics contain page structure only.

Note: `chrome.storage.local` is not encrypted, so anyone with access to your browser profile could read a stored key. Use a key with a spending limit, and remove it when you no longer need exact counts.
