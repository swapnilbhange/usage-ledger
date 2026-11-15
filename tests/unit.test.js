'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', 'extension');
const C = require(path.join(ROOT, 'core.js'));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const T0 = Date.UTC(2026, 10, 15, 10, 0, 0);
const H = 3600e3;
const ORG = '11111111-aaaa-bbbb-cccc-222222222222';
const CONV = 'cccccccc-1111-4222-8333-444444444444';
const CONV2 = 'dddddddd-1111-4222-8333-444444444444';
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

// ------------------------------------------------------------------- core

test('normalizeMessageLimit: fractions -> percent, epoch seconds -> ms, aliases', () => {
	const w = C.normalizeMessageLimit({ windows: { '5h': { utilization: 0.4237, resets_at: (T0 + 3 * H) / 1000 }, '7d': { utilization: 0.1, resets_at: (T0 + 3 * 24 * H) / 1000 } } });
	near(w.five_hour.u, 42.37);
	assert.equal(w.five_hour.reset, T0 + 3 * H);
	near(w.seven_day.u, 10);
	assert.deepEqual(C.normalizeMessageLimit(null), {});
	assert.deepEqual(C.normalizeMessageLimit({ windows: { '5h': { utilization: 'x' } } }), {});
});

test('normalizeUsageEndpoint: generic windows, ISO resets, clamping', () => {
	const w = C.normalizeUsageEndpoint({
		five_hour: { utilization: 12.5, resets_at: new Date(T0 + 2 * H).toISOString() },
		seven_day: { utilization: 140, resets_at: null },
		seven_day_opus: { utilization: 3, resets_at: new Date(T0).toISOString() },
		extra_usage: { is_enabled: false },
		junk: 5
	});
	assert.deepEqual(Object.keys(w).sort(), ['five_hour', 'seven_day', 'seven_day_opus']);
	assert.equal(w.seven_day.u, 100);
	assert.equal(w.seven_day.reset, null);
	assert.equal(w.five_hour.reset, T0 + 2 * H);
});

test('computeDeltas: same window, rollover, unknown', () => {
	const prev = { five_hour: { u: 10, reset: T0 + H }, seven_day: { u: 5, reset: T0 + 24 * H } };
	let d = C.computeDeltas(prev, { five_hour: { u: 13, reset: T0 + H + 1000 }, seven_day: { u: 4, reset: T0 + 24 * H } }, T0);
	near(d.five_hour, 3);
	assert.equal(d.seven_day, 0); // never negative
	d = C.computeDeltas(prev, { five_hour: { u: 2, reset: T0 + 6 * H } }, T0 + 2 * H); // old window ended
	near(d.five_hour, 2);
	d = C.computeDeltas(prev, { five_hour: { u: 2, reset: T0 + 6 * H } }, T0); // reset moved but old one not over
	assert.equal(d.five_hour, null);
	d = C.computeDeltas({}, { five_hour: { u: 2, reset: T0 } }, T0);
	assert.equal(d.five_hour, null);
});

test('currentWindows zeroes expired windows', () => {
	const w = C.currentWindows({ five_hour: { u: 80, reset: T0 - 1 }, seven_day: { u: 5, reset: T0 + H } }, T0);
	assert.equal(w.five_hour.u, 0);
	assert.equal(w.five_hour.stale, true);
	assert.equal(w.seven_day.u, 5);
});

test('pace: projection, ETA, low-confidence flag, recent rate', () => {
	// 2h into a 5h window at 40% => 20%/h => hits 100% in 3h, which is exactly the reset => willHit false (not before)
	let p = C.pace({ u: 40, reset: T0 + 3 * H }, 5, T0, null);
	near(p.avgRate, 20);
	near(p.projectedAtReset, 100);
	assert.equal(p.lowConfidence, false);
	// 3h in at 90% => 30%/h => 20 min to limit, 2h before reset
	p = C.pace({ u: 90, reset: T0 + 2 * H }, 5, T0, null);
	assert.equal(p.willHit, true);
	near(p.etaMs / 60e3, 20, 1e-6);
	// recent rate overrides average
	p = C.pace({ u: 50, reset: T0 + 2 * H }, 5, T0, [[T0 - 30 * 60e3, 40], [T0, 50]]);
	near(p.recentRate, 20);
	near(p.rate, 20);
	// early window
	p = C.pace({ u: 5, reset: T0 + 5 * H - 5 * 60e3 }, 5, T0, null);
	assert.equal(p.lowConfidence, true);
	assert.equal(C.pace({ u: 5, reset: null }, 5, T0).avgRate, undefined);
	p = C.pace({ u: 100, reset: T0 + H }, 5, T0, null);
	assert.equal(p.etaMs, 0);
});

test('recentFor only returns samples of the same window instance', () => {
	const samples = [
		{ ts: T0 - 20 * 60e3, w: { five_hour: [10, T0 - H] } }, // old instance
		{ ts: T0 - 10 * 60e3, w: { five_hour: [5, T0 + 4 * H] } },
		{ ts: T0 - 1000, w: { five_hour: [7, T0 + 4 * H] } }
	];
	const r = C.recentFor(samples, 'five_hour', { reset: T0 + 4 * H }, T0, 30 * 60e3);
	assert.deepEqual(r.map((x) => x[1]), [5, 7]);
});

test('conversation trunk follows current leaf and skips thinking/images', () => {
	const conv = {
		uuid: CONV,
		name: 'Test chat',
		current_leaf_message_uuid: 'm3',
		chat_messages: [
			{ uuid: 'm1', parent_message_uuid: '00000000-0000-4000-8000-000000000000', sender: 'human', created_at: '2026-11-15T10:00:00Z', content: [{ type: 'text', text: 'hello' }] },
			{ uuid: 'm2', parent_message_uuid: 'm1', sender: 'assistant', created_at: '2026-11-15T10:00:05Z', content: [{ type: 'text', text: 'abandoned branch' }] },
			{ uuid: 'm2b', parent_message_uuid: 'm1', sender: 'assistant', created_at: '2026-11-15T10:00:09Z', content: [{ type: 'thinking', thinking: 'secret' }, { type: 'text', text: 'real answer' }, { type: 'image', source: 'x' }] },
			{ uuid: 'm3', parent_message_uuid: 'm2b', sender: 'human', created_at: '2026-11-15T10:01:00Z', content: [{ type: 'text', text: 'thanks' }], attachments: [{ extracted_content: 'FILE TEXT' }] }
		]
	};
	const ex = C.extractConversation(conv);
	assert.deepEqual(ex.msgs.map((m) => m.id), ['m1', 'm2b', 'm3']);
	assert.equal(ex.msgs[1].text, 'real answer');
	assert.equal(ex.msgs[2].text, 'thanks\nFILE TEXT');
	assert.equal(ex.name, 'Test chat');
	assert.equal(C.extractConversation(conv, { includeThinking: true }).msgs[1].text, 'secret\nreal answer');
	// cycle protection
	assert.equal(C.buildTrunk({ current_leaf_message_uuid: 'a', chat_messages: [{ uuid: 'a', parent_message_uuid: 'a' }] }).length, 1);
});

test('formatting helpers', () => {
	assert.equal(C.fmtDur(2 * H + 11 * 60e3), '2h 11m');
	assert.equal(C.fmtDur(45e3), '45s');
	assert.equal(C.fmtClock(192e3), '3:12');
	assert.equal(C.fmtTokens(48200), '48k');
	assert.equal(C.fmtTokens(1234), '1.2k');
	assert.equal(C.bucketIndex(5000), 0);
	assert.equal(C.bucketIndex(250000), 3);
	assert.equal(C.toCSV(['a', 'b'], [{ a: 'x,y', b: 'q"r' }]), 'a,b\n"x,y","q""r"');
	assert.notEqual(C.hash('abc'), C.hash('abd'));
});

test('vendored tokenizer loads and counts', () => {
	const tk = require(path.join(ROOT, 'vendor/o200k_base.js'));
	const n = tk.countTokens('Hello, world! This is a token counting test.');
	assert.ok(n > 5 && n < 20, 'tokens=' + n);
});

// -------------------------------------------------------------------- hook

function runHook({ origFetch }) {
	const events = [];
	const sandbox = {
		URL, Response, Request, TextDecoder, JSON, Promise, CustomEvent,
		location: { origin: 'https://claude.ai' },
		document: { dispatchEvent: (e) => events.push(JSON.parse(e.detail)) },
		fetch: origFetch
	};
	sandbox.window = sandbox;
	vm.createContext(sandbox);
	vm.runInContext(read('hook.js'), sandbox);
	return { sandbox, events };
}

function sseResponse(chunks, ct = 'text/event-stream; charset=utf-8') {
	const enc = new TextEncoder();
	const stream = new ReadableStream({
		async start(ctl) {
			for (const c of chunks) {
				ctl.enqueue(enc.encode(c));
				await new Promise((r) => setTimeout(r, 5));
			}
			ctl.close();
		}
	});
	return new Response(stream, { status: 200, headers: { 'content-type': ct } });
}

const compPath = `/api/organizations/${ORG}/chat_conversations/${CONV}/completion`;

test('hook: emits gen_start, limit (split across chunks), gen_end and leaves the response readable', async () => {
	const limit = { type: 'message_limit', message_limit: { type: 'within_limit', windows: { '5h': { utilization: 0.25, resets_at: 1800000000 }, '7d': { utilization: 0.1, resets_at: 1800500000 } } } };
	const body = `event: message_start\ndata: {"type":"message_start"}\n\nevent: message_limit\ndata: ${JSON.stringify(limit)}\n\ndata: {"type":"content_block_delta"}\n\n`;
	const mid = Math.floor(body.length / 2);
	const { sandbox, events } = runHook({ origFetch: async () => sseResponse([body.slice(0, mid), body.slice(mid)]) });
	const res = await sandbox.fetch(compPath, { method: 'POST', body: '{}' });
	const text = await res.text(); // the page must still be able to read the stream
	assert.ok(text.includes('content_block_delta'));
	await new Promise((r) => setTimeout(r, 60));
	assert.deepEqual(events.map((e) => e.t), ['gen_start', 'limit', 'gen_end']);
	assert.equal(events[1].conv, CONV);
	assert.equal(events[1].org, ORG);
	assert.equal(events[1].ml.windows['5h'].utilization, 0.25);
	assert.equal(events[1].early, true); // arrived before any answer content
	assert.equal(events[2].ok, true);
});

test('hook: limit event after answer content is flagged late', async () => {
	const limit = { type: 'message_limit', message_limit: { windows: { '5h': { utilization: 0.25, resets_at: 1800000000 } } } };
	const body = `data: {"type":"content_block_delta","delta":{"text":"hi"}}\n\ndata: ${JSON.stringify(limit)}\n\n`;
	const { sandbox, events } = runHook({ origFetch: async () => sseResponse([body]) });
	await (await sandbox.fetch(compPath, { method: 'POST' })).text();
	await new Promise((r) => setTimeout(r, 40));
	assert.equal(events.find((e) => e.t === 'limit').early, false);
});

test('hook: detects POST via Request object and relative URLs; ignores GET, other endpoints, cross-origin', async () => {
	const { sandbox, events } = runHook({ origFetch: async () => sseResponse(['data: {"type":"x"}\n\n']) });
	await sandbox.fetch(new Request('https://claude.ai' + compPath, { method: 'POST', body: '{}' }));
	await new Promise((r) => setTimeout(r, 40));
	assert.equal(events.filter((e) => e.t === 'gen_start').length, 1);
	events.length = 0;
	await sandbox.fetch(compPath, { method: 'GET' });
	await sandbox.fetch(`/api/organizations/${ORG}/usage`, { method: 'POST' });
	await sandbox.fetch('https://example.com' + compPath, { method: 'POST' });
	await sandbox.fetch(compPath.replace('/completion', '/completion/extra'), { method: 'POST' });
	await new Promise((r) => setTimeout(r, 40));
	assert.deepEqual(events, []);
});

test('hook: non-stream completion response (e.g. 429) -> gen_end ok=false; network error rethrown', async () => {
	let mode = 'json';
	const { sandbox, events } = runHook({
		origFetch: async () => {
			if (mode === 'throw') throw new TypeError('network');
			return new Response('{"type":"error"}', { status: 429, headers: { 'content-type': 'application/json' } });
		}
	});
	await sandbox.fetch(compPath, { method: 'POST' });
	await new Promise((r) => setTimeout(r, 20));
	assert.deepEqual(events.map((e) => [e.t, e.ok]), [['gen_start', undefined], ['gen_end', false]]);
	mode = 'throw';
	events.length = 0;
	await assert.rejects(() => sandbox.fetch(compPath, { method: 'POST' }), /network/);
	assert.deepEqual(events.map((e) => e.t), ['gen_start', 'gen_end']);
});

test('hook: installing twice does not double-wrap', () => {
	const { sandbox, events } = runHook({ origFetch: async () => new Response('') });
	const wrapped = sandbox.fetch;
	vm.runInContext(read('hook.js'), sandbox);
	assert.equal(sandbox.fetch, wrapped);
	assert.equal(events.length, 0);
});

// ------------------------------------------------------------- background

function makeWorld(opts = {}) {
	const world = { perm: !!opts.perm };
	const mem = new Map();
	const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
	const listeners = [];
	const created = [];
	const sandbox = {
		console, Date, Math, JSON, Promise, Map, Set, Object, Array, String, Number, Infinity, setTimeout, clearTimeout, TextEncoder, TextDecoder,
		fetch: opts.fetch || (async (url) => {
			if (String(url).endsWith('vendor/gemma3.bin')) {
				const b = fs.readFileSync(path.join(ROOT, 'vendor/gemma3.bin'));
				return { arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
			}
			throw new Error('unexpected fetch ' + url);
		}),
		chrome: {
			runtime: {
				id: 'EXT',
				getURL: (p) => 'chrome-extension://EXT/' + p,
				onMessage: { addListener: (fn) => listeners.push(fn) },
				onInstalled: { addListener: () => {} }
			},
			permissions: { contains: async () => world.perm },
			tabs: { create: (o) => created.push(o) },
			storage: {
				local: {
					get: async (k) => {
						const keys = k == null ? [...mem.keys()] : Array.isArray(k) ? k : [k];
						const out = {};
						for (const key of keys) if (mem.has(key)) out[key] = clone(mem.get(key));
						return out;
					},
					set: async (o) => { for (const [k, v] of Object.entries(o)) mem.set(k, clone(v)); },
					remove: async (k) => { for (const key of [].concat(k)) mem.delete(key); },
					clear: async () => mem.clear()
				}
			}
		}
	};
	sandbox.self = sandbox;
	sandbox.globalThis = sandbox;
	vm.createContext(sandbox);
	sandbox.importScripts = (...fs_) => { for (const f of fs_) vm.runInContext(read(f), sandbox, { filename: f }); };
	vm.runInContext(read('background.js'), sandbox, { filename: 'background.js' });
	const call = (msg, id = 'EXT') => new Promise((resolve) => {
		const keep = listeners[0](msg, { id }, resolve);
		if (keep !== true) resolve({ sync: true });
	});
	const evt = (e) => call({ type: 'evt', evt: e });
	return { mem, call, evt, created, world, sandbox };
}

const win = (u5, u7, r5 = T0 + 4 * H, r7 = T0 + 3 * 24 * H) => ({
	type: 'message_limit',
	windows: { '5h': { utilization: u5, resets_at: r5 / 1000 }, '7d': { utilization: u7, resets_at: r7 / 1000 } }
});

test('background: attributes SSE deltas to the right conversation, gen and day (late events / lag 0)', async () => {
	const w = makeWorld();
	await w.mem.set('settings', { attributionLag: 0 });
	let ts = T0;
	const gen = async (conv, ml, dt = 60e3) => {
		ts += dt;
		await w.evt({ t: 'gen_start', org: ORG, conv, ts });
		await w.evt({ t: 'limit', org: ORG, conv, ts: ts + 500, ml });
		await w.evt({ t: 'gen_end', org: ORG, conv, ts: ts + 5000 });
	};
	await gen(CONV, win(0.10, 0.040)); // baseline, nothing attributed
	await gen(CONV, win(0.13, 0.045)); // +3 / +0.5
	await gen(CONV2, win(0.20, 0.050)); // +7 / +0.5
	const s = Object.fromEntries([...w.mem]);
	near(s.convs[CONV].spent.five_hour, 3);
	near(s.convs[CONV].spent.seven_day, 0.5);
	near(s.convs[CONV2].spent.five_hour, 7);
	assert.equal(s.convs[CONV].gens, 2);
	assert.equal(s.gens.length, 3);
	assert.ok(s.gens.every((g) => g.done && g.seen));
	near(s.gens[1].d.five_hour, 3);
	const day = s.daily[C.dayKey(T0)];
	near(day.spent.five_hour, 10);
	assert.equal(day.gens, 3);
	assert.equal(s.samples.length, 3);
	near(s.live.windows.five_hour.u, 20);
});

test('background: poll rounding does not overwrite precise SSE value; real jumps count as unattributed', async () => {
	const w = makeWorld();
	await w.mem.set('settings', { attributionLag: 0 });
	await w.evt({ t: 'gen_start', org: ORG, conv: CONV, ts: T0 });
	await w.evt({ t: 'limit', org: ORG, conv: CONV, ts: T0 + 1, ml: win(0.1237, 0.05) });
	const iso = (ms) => new Date(ms).toISOString();
	await w.evt({ t: 'poll', org: ORG, ts: T0 + 60e3, raw: { five_hour: { utilization: 12, resets_at: iso(T0 + 4 * H) }, seven_day: { utilization: 5, resets_at: iso(T0 + 72 * H) } } });
	let s = Object.fromEntries([...w.mem]);
	near(s.live.windows.five_hour.u, 12.37); // kept precise
	assert.equal(s.live.windows.five_hour.src, 'sse');
	assert.equal(s.daily[C.dayKey(T0)].other.five_hour, undefined);
	await w.evt({ t: 'poll', org: ORG, ts: T0 + 120e3, raw: { five_hour: { utilization: 20, resets_at: iso(T0 + 4 * H) } } });
	s = Object.fromEntries([...w.mem]);
	near(s.live.windows.five_hour.u, 20);
	near(s.daily[C.dayKey(T0)].other.five_hour, 20 - 12.37);
	assert.equal(s.convs[CONV].spent.five_hour, undefined);
});

test('background: window rollover attributes the new window utilisation', async () => {
	const w = makeWorld();
	await w.mem.set('settings', { attributionLag: 0 });
	await w.evt({ t: 'gen_start', org: ORG, conv: CONV, ts: T0 });
	await w.evt({ t: 'limit', org: ORG, conv: CONV, ts: T0 + 1, ml: win(0.9, 0.3) });
	const later = T0 + 5 * H;
	await w.evt({ t: 'gen_start', org: ORG, conv: CONV, ts: later });
	await w.evt({ t: 'limit', org: ORG, conv: CONV, ts: later + 1, ml: win(0.02, 0.31, T0 + 9 * H) });
	const s = Object.fromEntries([...w.mem]);
	near(s.convs[CONV].spent.five_hour, 2);
	near(s.convs[CONV].spent.seven_day, 1);
});

test('background: attributionLag=1 credits the previous message', async () => {
	const w = makeWorld();
	await w.mem.set('settings', { attributionLag: 1 });
	let ts = T0;
	const gen = async (conv, ml) => {
		ts += 60e3;
		await w.evt({ t: 'gen_start', org: ORG, conv, ts });
		await w.evt({ t: 'limit', org: ORG, conv, ts: ts + 1, ml });
		await w.evt({ t: 'gen_end', org: ORG, conv, ts: ts + 2 });
	};
	await gen(CONV, win(0.10, 0.04));
	await gen(CONV2, win(0.15, 0.05)); // the +5 is really the cost of the CONV message
	const s = Object.fromEntries([...w.mem]);
	near(s.convs[CONV].spent.five_hour, 5);
	assert.equal(s.convs[CONV2].spent.five_hour, undefined);
});

test('background: auto lag follows the early flag of each event', async () => {
	const w = makeWorld(); // default settings => 'auto'
	let ts = T0;
	const gen = async (conv, ml, early) => {
		ts += 60e3;
		await w.evt({ t: 'gen_start', org: ORG, conv, ts });
		await w.evt({ t: 'limit', org: ORG, conv, ts: ts + 1, early, ml });
		await w.evt({ t: 'gen_end', org: ORG, conv, ts: ts + 2 });
	};
	// early events: sample N is the state before message N, so the delta belongs to message N-1
	await gen(CONV, win(0.10, 0.04), true);
	await gen(CONV2, win(0.15, 0.05), true);
	let s = Object.fromEntries([...w.mem]);
	near(s.convs[CONV].spent.five_hour, 5);
	assert.equal(s.convs[CONV2].spent.five_hour, undefined);
	// a late event credits the message that just finished
	await gen(CONV2, win(0.19, 0.06), false);
	s = Object.fromEntries([...w.mem]);
	near(s.convs[CONV2].spent.five_hour, 4);
});

test('background: token counting is cached per message and tracks edits', async () => {
	const w = makeWorld();
	const msgs = [
		{ id: 'm1', role: 'human', ts: T0, text: 'Hello there, how are you doing today?' },
		{ id: 'm2', role: 'assistant', ts: T0 + 5000, text: 'I am fine. '.repeat(50) }
	];
	const r1 = await w.evt({ t: 'conv', id: CONV, org: ORG, ts: T0 + 6000, name: 'My chat', model: 'x', msgs });
	assert.ok(r1.tokens > 100, 'tokens ' + r1.tokens);
	let s = Object.fromEntries([...w.mem]);
	assert.equal(s.convs[CONV].name, 'My chat');
	assert.equal(s.convs[CONV].lastAssistantTs, T0 + 5000);
	assert.equal(Object.keys(s['tok:' + CONV]).length, 2);
	const r2 = await w.evt({ t: 'conv', id: CONV, org: ORG, ts: T0 + 7000, name: 'My chat', msgs });
	assert.equal(r2.tokens, r1.tokens);
	msgs[0].text += ' And one more sentence appended.';
	const r3 = await w.evt({ t: 'conv', id: CONV, org: ORG, ts: T0 + 8000, name: 'My chat', msgs });
	assert.ok(r3.tokens > r1.tokens);
});

test('background: rejects malformed events and foreign senders; clear keeps settings; open creates a tab', async () => {
	const w = makeWorld();
	assert.equal((await w.evt({ t: 'limit', org: 'bad id!', conv: CONV, ml: win(0.1, 0.1) })).ignored, true);
	assert.equal((await w.evt({ t: 'nope', org: ORG, conv: CONV })).ignored, true);
	assert.equal((await w.evt({ t: 'gen_start', org: ORG, conv: '../../etc' })).ignored, true);
	const foreign = await w.call({ type: 'evt', evt: { t: 'gen_start', org: ORG, conv: CONV } }, 'OTHER');
	assert.equal(foreign.sync, true);
	assert.equal(w.mem.has('gens'), false);
	await w.mem.set('settings', { calibration: 1.2 });
	await w.evt({ t: 'gen_start', org: ORG, conv: CONV, ts: T0 });
	assert.ok(w.mem.has('gens'));
	await w.call({ type: 'clear' });
	assert.deepEqual([...w.mem.keys()], ['settings']);
	await w.call({ type: 'open' });
	assert.match(w.created[0].url, /dashboard\.html\?tab=1$/);
});

// ------------------------------------------------------- multi-provider worker

const o200kT = require('../extension/vendor/o200k_base.js');
const cl100kT = require('../extension/vendor/cl100k_base.js');
const goldenG = require('./gemma.golden.json');
const GCONV = 'abcdef0123456789';
const OCONV = '68f0c0de-1234-4abc-9def-0123456789ab';
const sampleText = 'Naïve café: 東京タワー is 333m tall. 😀 ' + 'The quick brown fox. '.repeat(30);

test('background: ChatGPT chats use the tokenizer of the model that wrote each message', async () => {
	const w = makeWorld();
	const msgs = [
		{ id: 'u1', role: 'human', ts: null, model: null, text: sampleText },
		{ id: 'a1', role: 'assistant', ts: null, model: 'gpt-4', text: sampleText },
		{ id: 'a2', role: 'assistant', ts: null, model: 'gpt-5', text: sampleText }
	];
	const r = await w.evt({ t: 'conv', provider: 'openai', id: OCONV, ts: T0, name: 'x', model: 'gpt-5', msgs });
	const want = o200kT.countTokens(sampleText) * 2 + cl100kT.countTokens(sampleText);
	assert.equal(r.tokens, want);
	assert.notEqual(o200kT.countTokens(sampleText), cl100kT.countTokens(sampleText));
	const s = Object.fromEntries([...w.mem]);
	assert.equal(s.convs[OCONV].provider, 'openai');
	assert.equal(s.convs[OCONV].tokenizer.id, 'openai:o200k_base');
	assert.equal(s.convs[OCONV].tokenizer.exact, true); // user message inherits the chat's model (gpt-5)
	assert.equal(s['tok:' + OCONV].a1[2], 'openai:cl100k_base');
	// switching the chat's model re-counts the messages that depended on it
	msgs[0].model = null;
	const r2 = await w.evt({ t: 'conv', provider: 'openai', id: OCONV, ts: T0 + 1, name: 'x', model: 'gpt-4', msgs });
	assert.equal(r2.tokens, cl100kT.countTokens(sampleText) * 2 + o200kT.countTokens(sampleText));
});

test('background: Gemini chats are counted with the Gemma 3 vocabulary (matches the reference)', async () => {
	const w = makeWorld();
	const g = goldenG.find((x) => x.text.startsWith('emoji'));
	const r = await w.evt({ t: 'conv', provider: 'gemini', id: GCONV, ts: T0, name: 'g', model: 'gemini-2.5-pro', msgs: [{ id: 'u0', role: 'human', ts: null, text: g.text }] });
	assert.equal(r.tokens, g.n);
	const s = Object.fromEntries([...w.mem]);
	assert.equal(s.convs[GCONV].provider, 'gemini');
	assert.equal(s.convs[GCONV].tokenizer.exact, true);
	// UI label instead of a model id => still counted, flagged approximate
	const r2 = await w.evt({ t: 'conv', provider: 'gemini', id: GCONV, ts: T0 + 1, name: 'g', model: 'Fast', msgs: [{ id: 'u0', role: 'human', ts: null, text: g.text }] });
	assert.equal(r2.tokens, g.n);
	assert.equal(Object.fromEntries([...w.mem]).convs[GCONV].tokenizer.exact, false);
});

test('background: old v0.1 token caches (no tokenizer id) are recounted, unknown providers become claude', async () => {
	const w = makeWorld();
	w.mem.set('tok:' + CONV, { m1: [require('../extension/core.js').hash('hello'), 999] });
	const r = await w.evt({ t: 'conv', id: CONV, org: ORG, ts: T0, name: 'c', model: 'claude-x', msgs: [{ id: 'm1', role: 'human', ts: null, text: 'hello' }] });
	assert.equal(r.tokens, o200kT.countTokens('hello'));
	const r2 = await w.evt({ t: 'conv', provider: 'bogus', id: CONV, org: ORG, ts: T0, msgs: [{ id: 'm1', role: 'human', ts: null, text: 'hello' }] });
	assert.equal(Object.fromEntries([...w.mem]).convs[CONV].provider, 'claude');
	assert.equal(r2.tokenizer.id, 'claude:o200k-proxy');
	assert.equal(r2.tokenizer.exact, false);
});

test('background: Claude exact mode uses count_tokens, falls back to the estimate, never without key + permission', async () => {
	const calls = [];
	const fetchStub = async (url, init) => {
		const b = JSON.parse(init.body);
		calls.push({ url, key: init.headers['x-api-key'], text: b.messages[0].content });
		return { ok: true, status: 200, json: async () => ({ input_tokens: b.messages[0].content === '.' ? 9 : 100 + b.messages[0].content.length }) };
	};
	const msgs = [{ id: 'm1', role: 'human', ts: null, text: 'abcde' }, { id: 'm2', role: 'assistant', ts: null, text: 'fghij' }];
	const run = async (opts, settings, key) => {
		const w = makeWorld({ fetch: fetchStub, ...opts });
		w.mem.set('settings', settings);
		if (key) w.mem.set('anthropicKey', key);
		const r = await w.evt({ t: 'conv', id: CONV, org: ORG, ts: T0, name: 'c', model: 'claude-sonnet-5-5', msgs });
		return { r, w };
	};
	// api selected but no permission / no key: estimate, no network
	let x = await run({ perm: false }, { claudeCounting: 'api' }, 'sk-x');
	assert.equal(x.r.tokenizer.id, 'claude:o200k-proxy');
	x = await run({ perm: true }, { claudeCounting: 'api' }, null);
	assert.equal(x.r.tokenizer.id, 'claude:o200k-proxy');
	assert.equal(calls.length, 0);
	// enabled: wrapper overhead (9 - 1 = 8) is subtracted from each message
	x = await run({ perm: true }, { claudeCounting: 'api' }, 'sk-x');
	assert.equal(x.r.tokenizer.id, 'claude:api');
	assert.equal(x.r.tokenizer.exact, true);
	assert.equal(x.r.tokens, (100 + 5 - 8) * 2);
	assert.ok(calls.every((c) => c.url === 'https://api.anthropic.com/v1/messages/count_tokens' && c.key === 'sk-x'));
	// cached: a second sync makes no further calls
	const n = calls.length;
	await x.w.evt({ t: 'conv', id: CONV, org: ORG, ts: T0 + 1, name: 'c', model: 'claude-sonnet-5-5', msgs });
	assert.equal(calls.length, n);
	// ChatGPT / Gemini never touch the Anthropic API even when it is enabled
	await x.w.evt({ t: 'conv', provider: 'openai', id: OCONV, ts: T0, model: 'gpt-5', msgs });
	assert.equal(calls.length, n);
});

test('background: Claude exact mode survives API errors (estimate used, status recorded)', async () => {
	const w = makeWorld({ perm: true, fetch: async () => ({ ok: false, status: 401, json: async () => ({}) }) });
	w.mem.set('settings', { claudeCounting: 'api' });
	w.mem.set('anthropicKey', 'bad');
	const r = await w.evt({ t: 'conv', id: CONV, org: ORG, ts: T0, name: 'c', model: 'claude-sonnet-5-5', msgs: [{ id: 'm1', role: 'human', ts: null, text: 'hello world' }] });
	assert.equal(r.tokens, o200kT.countTokens('hello world'));
	const st = Object.fromEntries([...w.mem]).claudeApiStatus;
	assert.equal(st.ok, false);
	assert.equal(st.fatal, true);
});

test('v0.3 UI: inline is the default placement and every dashboard setting field has a default', () => {
	assert.equal(C.DEFAULT_SETTINGS.uiMode, 'inline');
	assert.equal(C.DEFAULT_SETTINGS.showPill, true);
	const src = read('dashboard.js');
	const fields = [...src.matchAll(/^\t\t\['(\w+)', '/gm)].map((m) => m[1]);
	assert.ok(fields.includes('uiMode'));
	for (const f of fields) assert.ok(f in C.DEFAULT_SETTINGS, 'no default for setting ' + f);
});

test('v0.3 UI: dashboard.js only touches element ids that dashboard.html defines', () => {
	const html = read('dashboard.html');
	const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
	const src = read('dashboard.js');
	for (const m of src.matchAll(/\$\('#([A-Za-z-]+)'\)/g)) assert.ok(ids.has(m[1]), 'missing #' + m[1] + ' in dashboard.html');
	for (const base of ['convTable', 'ledger', 'sizes', 'how']) for (const app of ['Chatgpt', 'Gemini']) assert.ok(ids.has(base + app), 'missing #' + base + app);
	for (const id of ['convTableAll', 'convTableClaude']) assert.ok(ids.has(id), 'missing #' + id);
	for (const t of ['all', 'claude', 'chatgpt', 'gemini', 'settings']) assert.ok(ids.has('panel-' + t), 'no panel for ' + t);
});
