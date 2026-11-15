# Privacy

Usage Ledger is built so that **your data stays in your browser**. There is no server, account, analytics or telemetry.

## What the extension can see
It runs on three sites only: `claude.ai`, `chatgpt.com` and `gemini.google.com`. On those pages it can see what you can see, because it reads the conversation that is already on screen (ChatGPT, Gemini) or the conversation and usage data your own logged-in session can request (claude.ai).

## What it stores
Everything is kept in `chrome.storage.local` on your computer:

| Stored | Not stored |
|---|---|
| Token count per message, chat id and title, which tokenizer was used | **The text of your messages and replies** |
| Usage readings (Session / Weekly percentages, reset times) and per-day totals | Passwords, cookies, session tokens |
| Your settings | Anything about other websites |
| If you enable exact Claude counts: your Anthropic API key | |

Message text is held in memory only long enough to count it. A hash of each message is kept so unchanged messages are not counted twice.

## What leaves your browser
- **By default: nothing.** The only network requests are same-origin requests to claude.ai that your own session is already allowed to make (the conversation and usage endpoints the claude.ai app itself uses).
- **If you turn on exact Claude counts:** each message's text is sent once to `https://api.anthropic.com/v1/messages/count_tokens`, with your own API key, to get a token count. The result is cached. This is off by default and needs you to paste a key and grant an optional browser permission. Turn it off in the dashboard (*Claude* tab) to remove the key and the permission. Anthropic's handling of that text is governed by their terms and privacy policy.
- **Diagnostics:** the *Copy diagnostics* button puts page structure (tag names, attribute names, text lengths) on your clipboard. It never includes message text. Nothing is sent anywhere unless you paste it into an issue yourself.

## Your controls
- *Settings → Export* downloads your data as CSV or JSON. The JSON never includes the API key.
- *Settings → Clear all data* deletes history, chat counts and caches (it keeps your settings).
- Removing the extension deletes all of its storage.

## Permissions
- `storage`: keep the data above locally.
- Host access to the three sites, through content scripts.
- Optional `https://api.anthropic.com/*`: only if you enable exact Claude counts.

## Independence
This is an unofficial extension, not affiliated with Anthropic, OpenAI or Google. Check each service's own terms before use.

*Last updated for v0.3.1.*
