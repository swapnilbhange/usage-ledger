# Roadmap

This is a direction, not a promise. Items move as real-world feedback arrives. Priorities are set by the maintainer,
Swapnil Bhange; ideas and votes are welcome in [issues](../../issues).

Status key: **Next** (being worked on or first in line), **Planned** (agreed, not started), **Idea** (worth exploring), **Not planned**.

## 0.3.x: make the live sites solid  (Next)

The biggest gap today is that the live-site behaviour was only tested on mock pages.

- [ ] Verify the usage-bar placement on live claude.ai, chatgpt.com and gemini.google.com and fix anchors that miss.
- [ ] Verify the Gemini reader on the live site; collect *Copy diagnostics* output from real chats.
- [ ] Run the optional Claude `count_tokens` mode against the live API, confirm the auth and header requirements, and record measured accuracy against the estimate.
- [ ] Confirm what the ChatGPT page exposes about the selected model and use it if available, so counts stop being "assumed".
- [ ] Compare Claude's estimate against real `count_tokens` results and publish a better default calibration factor.
- [ ] A short "known good" table in the docs: which browser versions and site layouts were last checked, and when.

## 0.4: more insight  (Planned)

- [ ] **Token history over time** for ChatGPT and Gemini (today only per-chat totals are kept), with the same 24h / 7d / 30d range as Claude.
- [ ] **Threshold alerts**: a quiet notice at 70% / 90% of Session or Weekly, and when a chat passes a size you choose.
- [ ] **CSV export of chats** (name, app, tokens, tokenizer, messages, last used), not just quota samples.
- [ ] **Options page** in its own tab instead of only a dashboard tab.
- [ ] **Search and filters** in the chat tables.
- [ ] Per-day token totals chart on the All tab.
- [ ] Keyboard navigation and screen-reader pass over the dashboard tabs.

## 0.5: distribution  (Planned)

- [ ] Publish to the **Chrome Web Store** (privacy policy page, listing copy, screenshots on live sites).
- [ ] Review the Gemma vocabulary licensing for store distribution, or make that file an optional first-run download.
- [ ] Add the **Gemma 4 vocabulary** once it is confirmed that the newer Gemini models (3.1 / 3.5) use it, so more Gemini counts become exact.
- [ ] Smoke-test on **Edge, Brave and Arc**.
- [ ] A GitHub Actions workflow that builds and attaches the zip to each tagged release.

## Later  (Idea)

- [ ] **Firefox** build (Manifest V3 differences, `browser.*` namespace, MAIN-world script injection).
- [ ] **More sites**: Perplexity, Microsoft Copilot, Mistral Le Chat, Grok, DeepSeek, behind the same provider interface.
- [ ] **Per-project and per-folder totals** where a site exposes them.
- [ ] **Per-model breakdown** inside a chat that switched models.
- [ ] Localisation of the UI text.
- [ ] A tiny public **test-fixtures repository** of anonymised page structures, so reader changes can be tested without live access.
- [ ] Optional daily or weekly summary, shown inside the extension only.
- [ ] Token-cost estimates in money for people who use the APIs, using a user-editable price table.

## Not planned

- **Any cloud service, account or analytics.** The product stays local.
- **Reading or storing chat text.** Only counts are kept.
- **Counting hidden system prompts or other people's usage.** There is no reliable way to see them and it would stretch the privacy model.
- **Bypassing rate limits** or anything that automates the chat sites.
- **Acting as a billing source of truth.** Figures are for awareness; the provider's own meter is authoritative.
