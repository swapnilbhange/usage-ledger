# Third‑Party Notices

This project vendors a small amount of third‑party code/data.

## `gpt-tokenizer` (MIT)

- Used for: the OpenAI tokenizers (`o200k_base` for GPT-4o / 4.1 / 5.x / o-series, `cl100k_base` for GPT-4 / 3.5; `o200k_base` is also the offline stand-in for Claude).
- Vendored files: `extension/vendor/o200k_base.js`, `extension/vendor/cl100k_base.js` (gpt-tokenizer 2.9.0)
- License: MIT (full text below).

### MIT License (gpt-tokenizer)

```
MIT License

Copyright (c) 2023-2024 Bazyli Brzoska

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## `claude-counter` and `Claude Token Counter OG` (both MIT)

Usage Ledger is an independent implementation, but the shapes of claude.ai's
`/usage` response, the `message_limit` SSE event and the conversation-tree payload were
learned by reading [she-llac/claude-counter](https://github.com/she-llac/claude-counter)
(MIT, "Claude Counter contributors"), which in turn credits
[Claude Usage Tracker](https://github.com/lugia19/Claude-Usage-Extension) by lugia19.
[jaggureddy11/CLAUDE-TOKEN-COUNTER-OG](https://github.com/jaggureddy11/CLAUDE-TOKEN-COUNTER-OG) (MIT) was studied for its approach
to live token counts, cache timers and usage bars. Both were read as design references; the code here was written
from scratch. No source code from either project is included apart from the vendored tokenizer above.

## Gemma 3 SentencePiece vocabulary

- Used for: Gemini token counts. `extension/vendor/gemma3.bin` is a compact re-encoding (made by `tools/build_gemma_vocab.py`) of the
  vocabulary in `tokenizer/gemma3_cleaned_262144_v2.spiece.model` from [google/gemma_pytorch](https://github.com/google/gemma_pytorch),
  the same file Google's `google-genai` SDK pins (SHA-256 `1299c11d...2e79c`) for local Gemini token counting.
- `gemma.js` is an original JavaScript port of SentencePiece's BPE encoder (no SentencePiece code is included); it is verified
  against the reference implementation in `tests/gemma.golden.json`.
- Licence: `google/gemma_pytorch` is published by Google; model files and tokenizer assets distributed with Gemma fall under the
  [Gemma Terms of Use](https://ai.google.dev/gemma/terms), which ask that a Gemma notice travels with redistributions (see `NOTICE`).
  This project's authors are not lawyers: **if you redistribute this extension commercially or publish it to a store, review those
  terms yourself.** If you would rather not ship the vocabulary at all, delete `extension/vendor/gemma3.bin`: Gemini chats then
  fall back to a rough characters-divided-by-3.7 estimate (marked as a fallback in the UI), and you can rebuild the file locally with `tools/build_gemma_vocab.py`.
