const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const P = require('../extension/providers.js');
const T = require('../extension/tokenizers.js');
const G = require('../extension/gemma.js');

const o200k = require('../extension/vendor/o200k_base.js');
const cl100k = require('../extension/vendor/cl100k_base.js');
const buf = fs.readFileSync(path.join(__dirname, '../extension/vendor/gemma3.bin'));
const loadGemmaBuffer = async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

test('site detection', () => {
	assert.strictEqual(P.detect('claude.ai'), 'claude');
	assert.strictEqual(P.detect('chatgpt.com'), 'openai');
	assert.strictEqual(P.detect('chat.openai.com'), 'openai');
	assert.strictEqual(P.detect('gemini.google.com'), 'gemini');
	assert.strictEqual(P.detect('evil-claude.ai'), null);
	assert.strictEqual(P.detect('claude.ai.evil.com'), null);
});

test('OpenAI model -> encoding', () => {
	const k = (m) => P.specFor('openai', m).id;
	for (const m of ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.5-preview', 'gpt-5', 'gpt-5.2-thinking', 'o1', 'o3', 'o3-mini', 'o4-mini', 'chatgpt-4o-latest'])
		assert.strictEqual(k(m), 'openai:o200k_base', m);
	for (const m of ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo', 'gpt-4-32k']) assert.strictEqual(k(m), 'openai:cl100k_base', m);
	assert.ok(P.specFor('openai', 'gpt-5').exact);
	// UI labels / unknown models: still o200k but flagged as assumed
	const u = P.specFor('openai', 'Thinking');
	assert.strictEqual(u.id, 'openai:o200k_base');
	assert.strictEqual(u.exact, false);
	assert.strictEqual(P.specFor('openai', null).exact, false);
});

test('Gemini model -> exactness', () => {
	assert.ok(P.specFor('gemini', 'gemini-2.5-pro').exact);
	assert.ok(P.specFor('gemini', 'gemini-2.0-flash').exact);
	assert.ok(P.specFor('gemini', 'gemini-3-pro-preview').exact);
	assert.ok(!P.specFor('gemini', 'gemini-3.5-flash').exact); // Gemma 4 vocabulary: not available here
	assert.ok(!P.specFor('gemini', 'gemini-3.1-pro-preview').exact);
	assert.ok(!P.specFor('gemini', 'Fast').exact);
	assert.strictEqual(P.specFor('gemini', 'Fast').id, 'gemini:gemma3');
});

test('Claude spec follows the API switch', () => {
	assert.strictEqual(P.specFor('claude', 'claude-sonnet-5-5').id, 'claude:o200k-proxy');
	assert.strictEqual(P.specFor('claude', 'claude-sonnet-5-5').exact, false);
	assert.strictEqual(P.specFor('claude', 'x', { claudeApi: true }).id, 'claude:api');
});

test('registry counts with the right tokenizer per spec', async () => {
	const reg = T.createRegistry({ o200k, cl100k, GemmaSP: G, loadGemmaBuffer });
	const text = 'Hello, world! 日本語のテキスト 😀';
	const a = await reg.counterFor(P.specFor('openai', 'gpt-4o'));
	const b = await reg.counterFor(P.specFor('openai', 'gpt-4'));
	const c = await reg.counterFor(P.specFor('gemini', 'gemini-2.5-pro'));
	assert.strictEqual(await a.count(text), o200k.countTokens(text));
	assert.strictEqual(await b.count(text), cl100k.countTokens(text));
	const gold = require('./gemma.golden.json').find((g) => g.text.startsWith('emoji'));
	assert.strictEqual(await c.count(gold.text), gold.n);
	assert.ok(!a.fallback && !b.fallback && !c.fallback);
	// the three genuinely differ on non-English text
	assert.notStrictEqual(await a.count(text), await b.count(text));
});

test('registry falls back to chars/3.7 when a tokenizer is missing', async () => {
	const reg = T.createRegistry({ o200k: null, cl100k: null, GemmaSP: G, loadGemmaBuffer: async () => { throw new Error('nope'); } });
	for (const spec of [P.specFor('openai', 'gpt-4o'), P.specFor('gemini', 'gemini-2.5-pro')]) {
		const c = await reg.counterFor(spec);
		assert.ok(c.fallback);
		assert.strictEqual(c.count('x'.repeat(37)), 10);
	}
});

function fakeFetch(handler) {
	const calls = [];
	const f = async (url, init) => {
		const body = JSON.parse(init.body);
		calls.push({ url, init, body });
		const r = handler(body, init);
		return { ok: r.status === 200, status: r.status, json: async () => r.json };
	};
	f.calls = calls;
	return f;
}

test('Claude API counter subtracts the wrapper overhead and caches the baseline', async () => {
	const f = fakeFetch((b) => ({ status: 200, json: { input_tokens: b.messages[0].content === '.' ? 8 : 8 + b.messages[0].content.length } }));
	const api = T.createClaudeApi({ fetch: f, getKey: async () => 'sk-test', defaultModel: 'claude-sonnet-5-5' });
	// baseline '.' => 8 tokens => overhead 7; 'hello' => 8+5 = 13 => 13 - 7 = 6
	assert.strictEqual(await api.count('hello', 'claude-sonnet-5-5'), 6);
	assert.strictEqual(f.calls.length, 2); // baseline + the message
	assert.strictEqual(await api.count('hello!!', 'claude-sonnet-5-5'), 8);
	assert.strictEqual(f.calls.length, 3); // baseline is cached
});

test('Claude API counter: headers, model fallback, auth lockout', async () => {
	let n = 0;
	const f = fakeFetch((b) => {
		n++;
		if (b.model === 'claude-bogus-model') return { status: 404, json: {} };
		return { status: 200, json: { input_tokens: 10 } };
	});
	const statuses = [];
	let t = 1000;
	const api = T.createClaudeApi({ fetch: f, getKey: async () => 'sk-test', defaultModel: 'claude-sonnet-5-5', now: () => t, onStatus: (s) => statuses.push(s) });
	const v = await api.count('hi there', 'claude-bogus-model');
	assert.strictEqual(typeof v, 'number');
	assert.strictEqual(f.calls[0].init.headers['x-api-key'], 'sk-test');
	assert.strictEqual(f.calls[0].init.headers['anthropic-version'], '2023-06-01');
	assert.strictEqual(f.calls[0].url, 'https://api.anthropic.com/v1/messages/count_tokens');
	assert.ok(f.calls.some((c) => c.body.model === 'claude-sonnet-5-5'));
	// the bad model is remembered and not retried
	const before = f.calls.filter((c) => c.body.model === 'claude-bogus-model').length;
	await api.count('another one', 'claude-bogus-model');
	assert.strictEqual(f.calls.filter((c) => c.body.model === 'claude-bogus-model').length, before);

	const f2 = fakeFetch(() => ({ status: 401, json: {} }));
	const api2 = T.createClaudeApi({ fetch: f2, getKey: async () => 'bad', defaultModel: 'claude-sonnet-5-5', now: () => t, onStatus: (s) => statuses.push(s) });
	assert.strictEqual(await api2.count('x'), null);
	const calls = f2.calls.length;
	assert.strictEqual(await api2.count('y'), null); // locked out: no network
	assert.strictEqual(f2.calls.length, calls);
	t += 11 * 60e3;
	await api2.count('z');
	assert.ok(f2.calls.length > calls); // retries after the pause
	assert.ok(statuses.some((s) => s.fatal));
});

test('claude-api counter falls back to the estimate when the API gives nothing', async () => {
	const f = fakeFetch(() => ({ status: 500, json: {} }));
	const api = T.createClaudeApi({ fetch: f, getKey: async () => 'k', defaultModel: 'claude-sonnet-5-5' });
	const reg = T.createRegistry({ o200k, cl100k, GemmaSP: G, loadGemmaBuffer, claudeApi: api });
	const c = await reg.counterFor(P.specFor('claude', 'claude-sonnet-5-5', { claudeApi: true }), { model: 'claude-sonnet-5-5' });
	assert.strictEqual(await c.count('some text here'), o200k.countTokens('some text here'));
});
