# Usage Ledger v0.3.0: the usage bar moves into the message box, and the dashboard gets tabs

Created by **Swapnil Bhange** with the help of **Claude** (Anthropic).

## What's new

**Usage bar in the message box.** The floating pill is no longer the default. On claude.ai you get *Session* and *Weekly* bars right under the model row, each with a white tick showing how far through the window you are. On ChatGPT and Gemini you get this chat's token count against a context bar, with the tokenizer named. Click the bar for details; click elsewhere or press `Esc` to close. If the message box can't be found, the corner pill is used. You can choose either in *Settings → Where it appears*.

**A dashboard with tabs.** All, Claude, ChatGPT, Gemini, plus Settings. A balance bar across the top shows each app's share of the tokens counted so far. Tabs can be linked to directly, for example `dashboard.html#chatgpt`.

**A new look.** The dashboard is laid out like a ledger: titles in the margin, one red rule, dot-leader rows, double-ruled totals. It follows light and dark mode and fits the 480 px popup.

**Per-app pages.** ChatGPT and Gemini get chats counted, average and largest chat, a size histogram, a chat list and a plain note on how they are counted. Claude keeps its quota cards, charts and cost-per-message views.

## Fixed
- No more "≈-% per message" in the Claude insight line when message counts are unavailable.

## Install
Download `usage-ledger-0.3.0.zip`, unzip it, open `chrome://extensions`, enable *Developer mode*, choose *Load unpacked* and pick the unzipped folder. Upgrading from an earlier version: export your data first, then load the new folder.

## Please read
- Placement of the bar, the ChatGPT and Gemini readers, and the optional Claude API counting were tested on mock pages, not the live sites. If something is off, open an issue and attach the output of *Copy diagnostics* (page structure only, never message text).
- ChatGPT counts are labelled *assumed* because the page doesn't show the model name.
- Claude counts are estimates unless you turn on exact counting with your own API key.

## Checks
51 unit tests and 27 end-to-end checks pass.

Full details: [CHANGELOG.md](../CHANGELOG.md). Roadmap: [ROADMAP.md](../ROADMAP.md).
