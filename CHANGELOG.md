# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/) (while below 1.0, minor versions may change behaviour).

Versions 0.1.0 to 0.3.0 were developed in a single continuous working session, so earlier entries carry no separate release dates.

## [0.3.1] - 2026-11-15

### Fixed
- **Details panel hidden behind the message box on claude.ai.** Clicking the usage bar opened the panel upward, but the message box painted over it. The panel is now a popover in the browser's top layer, so nothing on the page can cover it. It is placed next to the bar with fixed coordinates, opens upward or downward depending on the room, stays inside the window, and follows the bar if the box grows or the page scrolls.
- End-to-end check that the panel overlaps the message box yet is the topmost element, using a mock box with its own stacking context like the live page.

### Changed
- Minimum Chrome version is now 114 (the popover API).

### Distribution
- Accepted by the Chrome Web Store and published: <https://chromewebstore.google.com/detail/usage-ledger/dfgnanojcdndnjcllgjaijdlkmapldan>.

## [0.3.0] - 2026-11-15

### Added
- **Inline usage bar** attached to the message box, replacing the floating pill as the default.
  - claude.ai: *Session* and *Weekly* bars under the model-picker row. A white tick on each bar shows how far through the 5-hour / 7-day window you are.
  - ChatGPT and Gemini: this chat's tokens against a context-size bar, with the tokenizer named.
  - Anchor detection for each site (`findAnchor` in `adapters.js`), with a fallback to the floating pill when the box is not found.
- **Setting "Where it appears"**: under the message box, or the floating corner pill.
- **Dashboard tabs**: All, Claude, ChatGPT, Gemini, plus Settings. Tabs deep-link through the URL hash (`dashboard.html#gemini`), and "Open in a tab" from the popup opens the same tab.
- **Balance bar** across the top of the dashboard showing each app's share of counted tokens.
- **ChatGPT and Gemini tabs**: chats counted, average and largest chat, chat-size histogram, chat list, and a plain-language note on how that app is counted.
- Details panel closes on an outside click or `Esc`.
- Guard tests: dashboard script and page agree on element ids; every settings field has a default.
- Chrome Web Store kit: `store/` builds the icon, promo tiles and five 1280x800 screenshots (`npm run store`); `docs/STORE-LISTING.md` holds the listing text, permission justifications and reviewer notes.
- Documentation and repository files: README, roadmap, privacy and security notes, contributing guide, architecture and tokenizer docs, issue templates, CI.

### Changed
- **Listing-ready name and metadata**: the manifest name is now just "Usage Ledger" and the description fits the Chrome Web Store's 132-character limit. The README states the project is unaffiliated with Anthropic, OpenAI and Google.
- **Dashboard redesigned** as a ledger: section titles in a left margin with one red rule, dot-leader rows, totals with a double rule, a serif face for figures. Follows light and dark mode and fits the 480 px popup.
- The Claude dashboard content moved under the Claude tab; the cross-site chat table moved to the All tab.
- Dashboard wording: "Show the usage display" replaces "Show the floating pill".

### Fixed
- Insight line no longer prints "≈-% per message" when no message counts are available.

### Tests
- 51 unit tests and 27 end-to-end checks (real Chrome with the extension loaded, against mock claude.ai / chatgpt.com / gemini.google.com pages) pass.

## [0.2.2]

### Added
- Support for the **current chatgpt.com layout**, modelled on a structure outline from a real chat (`data-chatgpt-search-unit-key`, `data-user-message-bubble`, `data-response-body`). Hidden "thinking" units and screen-reader headings are skipped.
- "Couldn't read this chat's messages" state instead of a made-up number, with a **Copy diagnostics** button that copies page structure only (tags, attributes, text lengths, never text).
- ChatGPT chats without a visible model are counted as `o200k_base` and flagged *assumed*.

### Fixed
- ChatGPT chats showed an error and no count on the live site.

## [0.2.1]

Updated after reading Anthropic's token-counting documentation.

### Added
- **Optional exact Claude counts** through Anthropic's `count_tokens` endpoint, using the user's own API key and an *optional* `api.anthropic.com` permission. Per-message counting with measured wrapper overhead subtracted, cache by message hash, back-off after failures, and remembered bad model ids.
- Calibration setting and wording about Claude 4.7+ and Fable / Mythos 5.x models producing roughly 30% more tokens than earlier models.

### Changed
- Claude figures are labelled as estimates unless the API option is on; the docs describe the API count itself as an estimate.
- The JSON export never includes the API key.

## [0.2.0]

### Added
- **Multi-site support**: claude.ai, chatgpt.com, gemini.google.com.
- **Automatic tokenizer selection per message** from the site and the model that wrote it (see `providers.js`).
- OpenAI tokenizers (`o200k_base`, `cl100k_base`) via vendored `gpt-tokenizer` 2.9.0.
- **Gemma 3 SentencePiece tokenizer** for Gemini, as an original JavaScript port, verified piece-for-piece against the Python `sentencepiece` reference on 98 test strings.
- DOM readers for ChatGPT and Gemini (`adapters.js`).
- Dashboard chat table across all sites with a tokenizer column and a model → tokenizer map.

## [0.1.0]

First version: a Claude-only usage ledger combining ideas from claude-counter and Claude Token Counter OG.

### Added
- Session (5h) and Weekly (7d) usage with reset countdowns, read from claude.ai's own responses.
- Burn-rate projection and prompt-cache countdown.
- Per-chat attribution of quota usage, cost per message by chat length.
- Local history, charts, CSV and JSON export, clear-all.
- Floating pill UI. Everything stored locally.

[0.3.1]: ../../releases/tag/v0.3.1
[0.3.0]: ../../releases/tag/v0.3.0
[0.2.2]: ../../releases/tag/v0.2.2
[0.2.1]: ../../releases/tag/v0.2.1
[0.2.0]: ../../releases/tag/v0.2.0
[0.1.0]: ../../releases/tag/v0.1.0
