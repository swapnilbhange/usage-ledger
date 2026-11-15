const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const G = require('../extension/gemma.js');
const buf = fs.readFileSync(path.join(__dirname, '../extension/vendor/gemma3.bin'));
const tk = G.load(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'gemma.golden.json'), 'utf8'));

test('matches reference SentencePiece on golden corpus (counts)', () => {
	const bad = [];
	for (const g of golden) {
		const n = tk.count(g.text);
		if (n !== g.n) bad.push({ text: g.text.slice(0, 40), want: g.n, got: n });
	}
	assert.deepStrictEqual(bad, []);
});

test('matches reference piece-for-piece', () => {
	const bad = [];
	for (const g of golden) {
		const p = tk.encodePieces(g.text);
		if (JSON.stringify(p) !== JSON.stringify(g.pieces)) bad.push(g.text.slice(0, 40));
	}
	assert.deepStrictEqual(bad, []);
});

test('large input is fast enough', () => {
	const t = 'The quick brown fox jumps over the lazy dog. '.repeat(5000);
	const s = Date.now();
	tk.count(t);
	assert.ok(Date.now() - s < 3000);
});
