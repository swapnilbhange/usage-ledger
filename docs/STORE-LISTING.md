# Chrome Web Store listing

Copy these into the Developer Dashboard. Check each answer against the code before you submit; the review looks at
whether the listing, the privacy answers and the behaviour agree. Items marked **check** depend on things only you can
confirm (your GitHub URL, your contact email, what you tested).

## Store listing tab

**Name:** Usage Ledger

**Summary** (from the manifest, 120 characters):
Token counter and usage history for Claude, ChatGPT & Gemini. Right tokenizer per model. Your data stays on your device.

**Category:** Productivity

**Language:** English

**Description:**

```
Usage Ledger shows how many tokens your chats use, right where you type.

It works on claude.ai, chatgpt.com and gemini.google.com and counts each chat with the tokenizer that fits the app and the model you picked.

What you get
- A usage bar under the message box: how large the chat is against the model's window.
- On claude.ai, your Session and Weekly limits with reset times, plus a history so you can see where they went.
- One dashboard with tabs for All, Claude, ChatGPT and Gemini: totals, the largest chats and a share-of-tokens bar.
- A tokenizer chosen per message. ChatGPT chats use OpenAI's o200k_base or cl100k_base. Gemini chats use the Gemma 3 tokenizer. Claude chats use an estimate, or exact counts from Anthropic's API if you add your own key.
- Honest labels. A "~" means an estimate and the dashboard says which tokenizer was used.
- Export your history as CSV or JSON, or clear it, from Settings.

Your data stays in your browser
- No account, server, analytics or tracking.
- The text of your messages is read only to count it and is not stored. What is saved is the token count, the chat title and a few settings, in your browser's local storage.
- By default nothing leaves your browser. If you turn on exact Claude counts, each message is sent once to api.anthropic.com with your own key. This is off by default and asks for an extra permission.

Good to know
- Counts for Claude and ChatGPT are estimates unless marked exact. Claude's current models may tokenize differently from the stand-in used without an API key.
- ChatGPT and Gemini do not show a usage limit that an extension can read, so only token counts are shown for them.
- Counts leave out the system prompt, memory, files and hidden reasoning.

Usage Ledger is an independent project. It is not affiliated with, endorsed by or sponsored by Anthropic, OpenAI or Google. Claude, ChatGPT and Gemini are trademarks of their owners.

Open source (MIT): https://github.com/swapnilbhange/usage-ledger
```

**Images:** upload the files in `store/` (see `store/README.md`): icon, small tile, marquee, five screenshots.

**Official URL / Homepage:** your GitHub repository (**check** the username and repo name).
**Support URL:** the repository's Issues page.
**Contact email** (Account tab): **check**; it is shown publicly.

## Privacy practices tab

**Single purpose:**
Count the tokens used by the user's chats on claude.ai, ChatGPT and Gemini and show that usage, and the user's Claude usage limits, to the user.

**Permission justifications**

| Permission | Justification to paste |
|---|---|
| `storage` | Saves the user's settings, per-chat token counts and, on claude.ai, usage readings in the browser's local storage so the dashboard can show history. Nothing is synced or sent anywhere. |
| Host access: `claude.ai`, `chatgpt.com`, `gemini.google.com` (content scripts) | The extension reads the open conversation on these three sites to count its tokens and adds the usage bar next to the message box. It does nothing on any other site. |
| Optional host access: `api.anthropic.com` | Used only if the user turns on "exact Claude counts". Each message is then sent once to Anthropic's token-counting endpoint with the user's own API key. The permission is requested at that moment and can be removed in the dashboard. |

**Remote code:** No. All scripts, tokenizer tables and the Gemma vocabulary file are bundled in the package. Nothing is loaded or evaluated from the network.

**Data usage** (**check** the current wording of each box in the dashboard; when unsure, disclose):
- Website content: yes. The extension reads chat text on the three sites to count tokens. Text is not stored and is not sent anywhere by default.
- Personal communications: yes, for the same reason (chat messages).
- Authentication information: yes, only if the user enters an Anthropic API key for exact counts. It is stored locally and sent only to api.anthropic.com.
- Leave the other boxes unticked: location, health, financial, web history, user activity, personally identifiable information.

**Certifications** (all three are true for this extension):
- I do not sell or transfer user data to third parties outside the approved use cases.
- I do not use or transfer user data for purposes unrelated to the item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending.

**Privacy policy URL:** `https://github.com/swapnilbhange/usage-ledger/blob/main/PRIVACY.md` (**check**; the repository must be public).

## Test instructions for the reviewer

Paste into the "Test instructions" box on the Distribution tab. The sites need a login, so say so plainly.

```
Usage Ledger adds a token-usage bar under the message box on claude.ai, chatgpt.com and gemini.google.com, and a dashboard (toolbar icon).

To test: open a chat on any of the three sites while signed in. The bar appears under the message box after the chat loads. Click the toolbar icon to open the dashboard; tabs are All, Claude, ChatGPT, Gemini and Settings. Settings has Export and Clear.

No account or key for this extension is needed. The optional "exact Claude counts" feature needs an Anthropic API key and is off by default.

Notes on the code:
- hook.js runs in the page's own context on claude.ai only. It wraps window.fetch to notice the app's completion requests and posts a small event to the content script. It does not read other requests, does not store anything and makes no network calls.
- vendor/o200k_base.js and vendor/cl100k_base.js are the gpt-tokenizer package (MIT). vendor/gemma3.bin is the Gemma 3 tokenizer vocabulary (data, not code), used under the Gemma Terms of Use; see NOTICE and THIRD_PARTY_NOTICES.md.
- Source: https://github.com/swapnilbhange/usage-ledger
```

## Before you submit

1. Test on your own accounts on all three live sites. Inline placement and the Gemini reader have only been tested on mock pages.
2. Run `npm run pack` and upload `dist/usage-ledger-<version>.zip`.
3. Make the GitHub repository public so the privacy policy URL works.
4. Set Distribution to **Unlisted** first, check the listing, then switch to Public.
5. Have someone qualified read the Gemma Terms of Use against how the vocabulary file is shipped.
