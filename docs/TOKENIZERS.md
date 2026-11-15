# Tokenizers: what is used, and how sure we are

The mapping lives in one small, unit-tested file: [`extension/providers.js`](../extension/providers.js).
`specFor(provider, model, opts)` returns the tokenizer, a label, and whether it is **exact**.

The tokenizer is chosen **per message**, from the model that wrote that message (falling back to the chat's current model). A chat that
moves from one model to another is therefore counted with the right tokenizer on each side of the switch, and the cache key records which one was used.

## OpenAI (chatgpt.com)

| Model name starts with | Tokenizer | Accuracy |
|---|---|---|
| `gpt-4o`, `gpt-4.1`, `gpt-4.5`, `gpt-5`, `chatgpt-4o`, `codex`, `o1`, `o3`, `o4` | `o200k_base` | exact |
| `gpt-4` (not 4o / 4.1 / 4.5), `gpt-3.5` | `cl100k_base` | exact |
| anything else, or no name | `o200k_base` | assumed (flagged) |

Bundles: `gpt-tokenizer` 2.9.0, vendored in `extension/vendor/`. The current ChatGPT page does not expose the model name, so most chats show as *assumed*. That encoding is the one current ChatGPT models use.

## Gemini (gemini.google.com)

Counted with the **Gemma 3 SentencePiece** vocabulary, which Google's own SDK uses for local Gemini token counting.

| Model name matches | Accuracy |
|---|---|
| `gemini-2`, `gemini-2.x`, `gemini-3` followed by `-` or end of string | exact |
| Anything else: UI labels such as "Fast" / "Pro", and `gemini-3.1` / `3.5` (which use a newer vocabulary) | estimate |

`extension/gemma.js` is an original JavaScript port of SentencePiece's BPE encoder. It reads a compact binary (`extension/vendor/gemma3.bin`, built by `tools/build_gemma_vocab.py` from Google's published tokenizer, SHA-256 pinned in the script) and was verified piece-for-piece against the Python `sentencepiece` reference on 98 strings, stored in `tests/gemma.golden.json`. If the file cannot be loaded the count falls back to characters ÷ 3.7 and is labelled a fallback.

## Claude (claude.ai)

Anthropic does not publish an offline tokenizer for current Claude models.

| Mode | Method | Accuracy |
|---|---|---|
| Default | `o200k_base` stand-in × a calibration factor (default 1.0) | estimate |
| Opt-in | Anthropic `POST /v1/messages/count_tokens` with your own key and the chat's own model | near-exact |

Notes from Anthropic's token-counting documentation, as understood when this was written:
- The endpoint's count is itself described as an estimate that may differ slightly from billed usage.
- Claude 4.7 and later, including the Fable and Mythos 5.x models, use a tokenizer that produces roughly 30% more tokens for the same text than earlier Claude models. The stand-in can therefore undercount for those models; use the calibration factor if your numbers run low.
- The extension counts one message at a time and subtracts the measured per-request wrapper overhead (a baseline of a single "." minus one token). Results are cached by message hash, failures back off, and model ids the API rejects are remembered.

**Status:** the API mode has been tested against a mock of the endpoint only. See the roadmap.

## What counts, and what does not

Counted: the visible text of user and assistant messages, plus (Claude, Gemini) thinking blocks if you enable them.
Not counted: system prompts, memory, project knowledge, uploaded files and images, tool-call scaffolding, each provider's per-message framing tokens. Numbers are best read as "the size of the conversation text", not as a bill.

## Adding or changing a mapping

1. Edit the regular expressions in `extension/providers.js`.
2. Add cases to `tests/tokenizers.test.js`.
3. Update the table in `README.md` and the dashboard's tokenizer map (it is generated from `specFor`, so it updates itself).
