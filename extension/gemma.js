/*
 * Gemma-3 SentencePiece tokenizer (BPE + byte fallback) - the tokenizer Google's SDK uses for Gemini.
 * A port of sentencepiece's BPE Encode(): user-defined pieces are matched longest-first and frozen,
 * everything else is merged greedily by piece score (ties: leftmost). Verified against the reference
 * implementation in tests/gemma.golden.json. Vocabulary: vendor/gemma3.bin (see tools/build_gemma_vocab.py).
 */
(function (root, factory) {
	const api = factory();
	if (typeof module === 'object' && module.exports) module.exports = api;
	else root.GemmaSP = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
	'use strict';

	const SPACE = '▁';

	function load(buffer) {
		const dv = new DataView(buffer);
		const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
		if (magic !== 'GSP1') throw new Error('bad Gemma vocabulary file');
		const N = dv.getUint32(4, true);
		const blobBytes = dv.getUint32(8, true);
		let off = 12;
		const scores = new Float32Array(buffer.slice(off, off + 4 * N));
		off += 4 * N;
		const flags = new Uint8Array(buffer, off, N);
		off += N;
		if (off % 2) off++;
		const lens = new Uint16Array(buffer.slice(off, off + 2 * N));
		off += 2 * N;
		const blob = new TextDecoder('utf-8').decode(new Uint8Array(buffer, off, blobBytes));

		const score = new Map();
		const trie = { next: new Map(), end: false };
		let p = 0;
		for (let i = 0; i < N; i++) {
			const s = blob.slice(p, p + lens[i]);
			p += lens[i];
			score.set(s, scores[i]);
			if (flags[i]) {
				let node = trie;
				for (let j = 0; j < s.length; j++) {
					const c = s.charCodeAt(j);
					let nx = node.next.get(c);
					if (!nx) node.next.set(c, (nx = { next: new Map(), end: false }));
					node = nx;
				}
				node.end = true;
			}
		}
		return makeTokenizer(score, trie);
	}

	function toWellFormed(s) {
		return typeof s.toWellFormed === 'function' ? s.toWellFormed() : s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�');
	}

	function utf8Len(cp) {
		return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
	}

	function makeTokenizer(score, trie) {
		// Binary max-heap of merge candidates: higher score first, then smaller left index.
		const heap = [];
		const better = (a, b) => a.score > b.score || (a.score === b.score && a.left < b.left);
		function push(x) {
			let i = heap.length;
			heap.push(x);
			while (i > 0) {
				const par = (i - 1) >> 1;
				if (!better(heap[i], heap[par])) break;
				[heap[i], heap[par]] = [heap[par], heap[i]];
				i = par;
			}
		}
		function pop() {
			const top = heap[0];
			const last = heap.pop();
			if (heap.length) {
				heap[0] = last;
				let i = 0;
				for (;;) {
					const l = 2 * i + 1;
					const r = l + 1;
					let m = i;
					if (l < heap.length && better(heap[l], heap[m])) m = l;
					if (r < heap.length && better(heap[r], heap[m])) m = r;
					if (m === i) break;
					[heap[i], heap[m]] = [heap[m], heap[i]];
					i = m;
				}
			}
			return top;
		}

		function userMatch(text, i) {
			let node = trie;
			let best = 0;
			for (let j = i; j < text.length; j++) {
				node = node.next.get(text.charCodeAt(j));
				if (!node) break;
				if (node.end) best = j - i + 1;
			}
			return best;
		}

		/** Core encoder. If `out` is an array, pieces are pushed to it; always returns the token count. */
		function encode(text, out) {
			if (!text) return 0;
			const norm = toWellFormed(text).replace(/ /g, SPACE);
			const L = norm.length;
			const start = [];
			const end = [];
			const prev = [];
			const next = [];
			const freeze = [];
			let n = 0;
			for (let i = 0; i < L; ) {
				let len = userMatch(norm, i);
				let fz = 1;
				if (!len) {
					fz = 0;
					const c = norm.charCodeAt(i);
					len = c >= 0xd800 && c <= 0xdbff && i + 1 < L ? 2 : 1;
				}
				start.push(i);
				end.push(i + len);
				freeze.push(fz);
				prev.push(n - 1);
				next.push(-1);
				if (n > 0) next[n - 1] = n;
				n++;
				i += len;
			}
			heap.length = 0;
			const tryPair = (l, r) => {
				if (l < 0 || r < 0 || freeze[l] || freeze[r]) return;
				const piece = norm.slice(start[l], end[r]);
				const sc = score.get(piece);
				if (sc === undefined) return;
				push({ left: l, right: r, score: sc, size: piece.length });
			};
			for (let i = 1; i < n; i++) tryPair(i - 1, i);
			while (heap.length) {
				const t = pop();
				const ll = end[t.left] - start[t.left];
				const rl = end[t.right] - start[t.right];
				if (ll === 0 || rl === 0 || ll + rl !== t.size) continue;
				end[t.left] = end[t.right];
				next[t.left] = next[t.right];
				if (next[t.right] >= 0) prev[next[t.right]] = t.left;
				end[t.right] = start[t.right];
				tryPair(prev[t.left], t.left);
				tryPair(t.left, next[t.left]);
			}
			let count = 0;
			for (let i = 0; i !== -1; i = next[i]) {
				const piece = norm.slice(start[i], end[i]);
				if (score.has(piece)) {
					count++;
					if (out) out.push(piece);
				} else {
					// Byte fallback: one <0xNN> token per UTF-8 byte of the unknown character.
					for (const ch of piece) {
						const cp = ch.codePointAt(0);
						const nb = utf8Len(cp);
						count += nb;
						if (out) {
							const bytes = new TextEncoder().encode(ch);
							for (const b of bytes) out.push('<0x' + b.toString(16).toUpperCase().padStart(2, '0') + '>');
						}
					}
				}
			}
			return count;
		}

		return {
			count: (text) => encode(text, null),
			encodePieces: (text) => {
				const out = [];
				encode(text, out);
				return out;
			}
		};
	}

	return { load };
});
