#!/usr/bin/env python3
"""Export Google's Gemma 3 SentencePiece vocabulary (the tokenizer Gemini's SDK uses) to a compact binary.

Source model: github.com/google/gemma_pytorch @ 014acb7a / tokenizer/gemma3_cleaned_262144_v2.spiece.model
SHA-256 must be 1299c11d7cf632ef3b4e11937501358ada021bbdf7c47638d13c0ee982f2e79c (same pin as google-genai).

usage: build_gemma_vocab.py gemma3.model extension/vendor/gemma3.bin     (needs: pip install sentencepiece protobuf)
Layout (little-endian): 'GSP1' | u32 N | u32 blobBytes | f32 score[N] | u8 isUserDefined[N] | pad to even | u16 utf16len[N] | utf8 blob
Only NORMAL and USER_DEFINED pieces are stored: byte-fallback and control pieces are implicit.
"""
import hashlib, struct, sys
from sentencepiece import sentencepiece_model_pb2 as pb

EXPECTED = "1299c11d7cf632ef3b4e11937501358ada021bbdf7c47638d13c0ee982f2e79c"
src, dst = sys.argv[1], sys.argv[2]
raw = open(src, "rb").read()
assert hashlib.sha256(raw).hexdigest() == EXPECTED, "unexpected model file"
m = pb.ModelProto(); m.ParseFromString(raw)
t, n = m.trainer_spec, m.normalizer_spec
assert t.model_type == 2 and t.byte_fallback and n.name == "identity" and not n.add_dummy_prefix and not n.remove_extra_whitespaces and n.escape_whitespaces

pieces = [(p.piece, p.score, p.type == 4) for p in m.pieces if p.type in (1, 4)]
N = len(pieces)
blob = "".join(p for p, _, _ in pieces).encode("utf-8")
lens = [len(p.encode("utf-16-le")) // 2 for p, _, _ in pieces]
assert max(lens) < 65536
out = bytearray(b"GSP1" + struct.pack("<II", N, len(blob)))
out += struct.pack(f"<{N}f", *[s for _, s, _ in pieces])
out += bytes(1 if u else 0 for _, _, u in pieces)
if len(out) % 2: out += b"\0"
out += struct.pack(f"<{N}H", *lens)
out += blob
open(dst, "wb").write(out)
print(f"wrote {dst}: {len(out)} bytes, {N} pieces ({sum(u for _,_,u in pieces)} user-defined)")
