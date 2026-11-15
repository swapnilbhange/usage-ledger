/*
 * Usage Ledger - service worker.
 *
 * Owns all persistent state (chrome.storage.local) and serialises every write
 * through one queue, so concurrent tabs can't clobber each other.
 * Heavy work (tokenising) happens here, once, instead of in every claude.ai tab.
 */
'use strict';
// Service workers may only importScripts() during their initial evaluation (a lazy call later
// throws NetworkError), so the tokenizer is loaded up front. Chrome code-caches it after the first run.
const tokenizerErrors = [];
const tokenizerT0 = Date.now();
importScripts('core.js', 'providers.js', 'tokenizers.js', 'gemma.js');
for (const f of ['vendor/o200k_base.js', 'vendor/cl100k_base.js']) {
	try {
		importScripts(f);
	} catch (e) {
		tokenizerErrors.push(f + ': ' + e);
	}
}
const TOKENIZER_LOAD_MS = Date.now() - tokenizerT0;

const C = self.LedgerCore;
const P = self.LedgerProviders;
const T = self.LedgerTokenizers;
const CAP = { samples: 4000, gens: 3000, convs: 300, daily: 400 };
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const EVENTS = new Set(['gen_start', 'limit', 'gen_end', 'poll', 'conv']);

// ------------------------------------------------------------------ plumbing

let chain = Promise.resolve();
function enqueue(fn) {
	const p = chain.then(fn);
	chain = p.catch((e) => console.error('[ledger]', e));
	return p;
}

const store = {
	get: (k) => chrome.storage.local.get(k),
	set: (o) => chrome.storage.local.set(o),
	remove: (k) => chrome.storage.local.remove(k)
};

async function getSettings() {
	const { settings } = await store.get('settings');
	return { ...C.DEFAULT_SETTINGS, ...(settings || {}) };
}

const round4 = (x) => Math.round(x * 10000) / 10000;
function addTo(obj, key, v) {
	obj[key] = round4((obj[key] || 0) + v);
}

function newConv(id, org, ts) {
	return { id, provider: 'claude', org: org || null, name: '', model: null, tokens: 0, msgs: 0, spent: {}, gens: 0, firstTs: ts, lastTs: ts, lastAssistantTs: null };
}

function findGen(gens, convId, ts) {
	for (let i = gens.length - 1; i >= 0; i--) {
		const g = gens[i];
		if (ts - g.ts > 30 * 60e3) return -1;
		if (g.conv === convId && !g.done) return i;
	}
	return -1;
}

function trim(st) {
	if (st.samples && st.samples.length > CAP.samples) st.samples.splice(0, st.samples.length - CAP.samples);
	if (st.gens && st.gens.length > CAP.gens) st.gens.splice(0, st.gens.length - CAP.gens);
	if (st.daily) {
		const keys = Object.keys(st.daily).sort();
		for (const k of keys.slice(0, Math.max(0, keys.length - CAP.daily))) delete st.daily[k];
	}
}

async function pruneConvs(convs) {
	const ids = Object.keys(convs);
	if (ids.length <= CAP.convs) return;
	ids.sort((a, b) => (convs[a].lastTs || 0) - (convs[b].lastTs || 0));
	const drop = ids.slice(0, ids.length - CAP.convs);
	for (const id of drop) delete convs[id];
	await store.remove(drop.map((id) => 'tok:' + id));
}

// ---------------------------------------------------------------- tokenizer

const API_ORIGIN = 'https://api.anthropic.com/*';
const DEFAULT_CLAUDE_API_MODEL = 'claude-sonnet-5-5';

let lastApiStatusKey = '';
let lastApiStatusTs = 0;
const claudeApi = T.createClaudeApi({
	fetch: (url, init) => fetch(url, init),
	getKey: async () => (await store.get('anthropicKey')).anthropicKey || null,
	defaultModel: DEFAULT_CLAUDE_API_MODEL,
	onStatus: (st) => {
		// only persist changes (or a refresh every 10 min), not every call
		const k = st.ok ? 'ok:' + st.model : 'err:' + st.error;
		if (k === lastApiStatusKey && st.ts - lastApiStatusTs < 10 * 60e3) return;
		lastApiStatusKey = k;
		lastApiStatusTs = st.ts;
		store.set({ claudeApiStatus: st }).catch(() => {});
	}
});

const registry = T.createRegistry({
	o200k: self.GPTTokenizer_o200k_base,
	cl100k: self.GPTTokenizer_cl100k_base,
	GemmaSP: self.GemmaSP,
	loadGemmaBuffer: async () => (await fetch(chrome.runtime.getURL('vendor/gemma3.bin'))).arrayBuffer(),
	claudeApi
});

async function claudeApiEnabled(S) {
	if (S.claudeCounting !== 'api') return false;
	try {
		const { anthropicKey } = await store.get('anthropicKey');
		return !!anthropicKey && (await chrome.permissions.contains({ origins: [API_ORIGIN] }));
	} catch {
		return false;
	}
}

// ------------------------------------------------------------------ handlers

async function handleGenStart(evt) {
	const st = await store.get(['gens', 'convs', 'daily']);
	const gens = st.gens || [];
	const convs = st.convs || {};
	const daily = st.daily || {};
	const ts = evt.ts;
	const conv = convs[evt.conv] || (convs[evt.conv] = newConv(evt.conv, evt.org, ts));
	conv.gens += 1;
	conv.lastTs = ts;
	gens.push({ id: ts + ':' + evt.conv.slice(0, 8), ts, conv: evt.conv, ctx: conv.tokens || 0, d: {}, done: false, seen: false });
	const day = daily[C.dayKey(ts)] || (daily[C.dayKey(ts)] = { spent: {}, other: {}, gens: 0 });
	day.gens += 1;
	const out = { gens, convs, daily };
	trim(out);
	await pruneConvs(convs);
	await store.set(out);
}

async function applyUsage(wins, ts, src, convId, org, S, early) {
	if (!Object.keys(wins).length) return;
	const st = await store.get(['live', 'samples', 'convs', 'daily', 'gens']);
	const live = st.live || { windows: {}, ts: 0 };
	live.windows = live.windows || {};
	const samples = st.samples || [];
	const convs = st.convs || {};
	const daily = st.daily || {};
	const gens = st.gens || [];

	const prev = live.windows;
	const delta = C.computeDeltas(prev, wins, ts);
	const next = { ...prev };
	for (const name of Object.keys(wins)) {
		const p = prev[name];
		const n = wins[name];
		// /usage may be rounded; don't let it overwrite a more precise SSE value for the same window.
		if (src === 'poll' && p && p.src === 'sse' && C.sameInstance(p, n) && Math.abs(n.u - p.u) < 1) {
			delta[name] = 0;
			continue;
		}
		next[name] = { u: n.u, reset: n.reset, ts, src };
	}
	live.windows = next;
	live.ts = ts;
	if (org) live.org = org;

	// Who gets the spend?
	const day = daily[C.dayKey(ts)] || (daily[C.dayKey(ts)] = { spent: {}, other: {}, gens: 0 });
	let target = null;
	if (src === 'sse' && convId) {
		let gi = findGen(gens, convId, ts);
		if (gi < 0) {
			const c = convs[convId] || (convs[convId] = newConv(convId, org, ts));
			gens.push({ id: ts + ':' + convId.slice(0, 8), ts, conv: convId, ctx: c.tokens || 0, d: {}, done: false, seen: false });
			gi = gens.length - 1;
		}
		// An SSE sample that arrived before the answer text can't contain that answer's cost:
		// it is the state *after the previous message*, so credit the previous message.
		const lag = S.attributionLag === 'auto' || S.attributionLag == null ? (early ? 1 : 0) : Number(S.attributionLag);
		const ti = lag === 1 ? gi - 1 : gi;
		target = ti >= 0 ? gens[ti] : null; // nothing earlier to credit => counts as unattributed
		if (target) target.seen = true;
		live.lastConv = convId;
	}
	for (const name of Object.keys(delta)) {
		const d = delta[name];
		if (!(d > 1e-9)) continue;
		if (target) {
			addTo(target.d, name, d);
			const c = convs[target.conv] || (convs[target.conv] = newConv(target.conv, org, ts));
			addTo(c.spent, name, d);
			c.lastTs = ts;
			addTo(day.spent, name, d);
		} else {
			addTo(day.other, name, d);
		}
	}

	// History sample (only when something changed, or every 5 min as a heartbeat).
	const w = {};
	for (const name of Object.keys(next)) w[name] = [Math.round(next[name].u * 1000) / 1000, next[name].reset];
	const last = samples[samples.length - 1];
	if (!last || ts - last.ts >= 5 * 60e3 || JSON.stringify(last.w) !== JSON.stringify(w)) {
		samples.push({ ts, src, conv: convId || null, w });
	}

	const out = { live, samples, convs, daily, gens };
	trim(out);
	await pruneConvs(convs);
	await store.set(out);
}

async function handleGenEnd(evt) {
	const { gens = [] } = await store.get('gens');
	const gi = findGen(gens, evt.conv, evt.ts);
	if (gi >= 0) {
		gens[gi].done = true;
		await store.set({ gens });
	}
}

const API_CALLS_PER_SYNC = 30; // messages sent to count_tokens in one sync; the rest use the estimate until the next one

async function handleConv(evt) {
	const key = 'tok:' + evt.id;
	const st = await store.get(['convs', key]);
	const convs = st.convs || {};
	const old = st[key] || {};
	const S = await getSettings();
	const apiOn = evt.provider === 'claude' && (await claudeApiEnabled(S));
	const counters = new Map();
	let apiBudget = API_CALLS_PER_SYNC;
	const next = {};
	let total = 0;
	let lastAsst = null;
	let exact = true;
	let fallback = false;
	let lastSpec = null;
	for (const m of evt.msgs) {
		// Each message is counted with the tokenizer of the model that wrote it (falls back to the chat's model).
		let spec = P.specFor(evt.provider, m.model || evt.model, { claudeApi: apiOn });
		const h = C.hash(m.text);
		const o = old[m.id];
		let n;
		if (o && o[0] === h && o[2] === spec.id) {
			n = o[1];
		} else if (!m.text) {
			n = 0;
		} else {
			if (spec.kind === 'claude-api' && apiBudget <= 0) spec = P.specFor('claude', m.model || evt.model, { claudeApi: false });
			let c = counters.get(spec.id);
			if (!c) counters.set(spec.id, (c = await registry.counterFor(spec, { model: evt.model })));
			if (spec.kind === 'claude-api') apiBudget--;
			n = await c.count(m.text);
			if (c.fallback) fallback = true;
		}
		next[m.id] = [h, n, spec.id];
		total += n;
		if (!spec.exact) exact = false;
		lastSpec = spec;
		if (m.role === 'assistant' && m.ts && (!lastAsst || m.ts > lastAsst)) lastAsst = m.ts;
	}
	if (!lastSpec) lastSpec = P.specFor(evt.provider, evt.model, { claudeApi: apiOn });
	const ts = evt.ts;
	const conv = convs[evt.id] || (convs[evt.id] = newConv(evt.id, evt.org, ts));
	conv.provider = evt.provider;
	conv.tokens = total;
	conv.msgs = evt.msgs.length;
	conv.lastAssistantTs = lastAsst;
	conv.tokTs = ts;
	conv.tokenizer = { id: lastSpec.id, label: lastSpec.label, exact: exact && !fallback };
	if (evt.name) conv.name = evt.name;
	if (evt.model) conv.model = evt.model;
	if (evt.org) conv.org = evt.org;
	if (fallback) conv.approx = true;
	else delete conv.approx;
	await pruneConvs(convs);
	await store.set({ [key]: next, convs });
	return { tokens: total, tokenizer: conv.tokenizer };
}

function sanitize(evt) {
	if (!evt || typeof evt !== 'object' || !EVENTS.has(evt.t)) return null;
	const ts = Number.isFinite(evt.ts) ? evt.ts : Date.now();
	const out = { t: evt.t, ts };
	if (evt.org != null) {
		if (!ID_RE.test(String(evt.org))) return null;
		out.org = String(evt.org);
	}
	if (evt.t === 'conv') {
		if (!ID_RE.test(String(evt.id)) || !Array.isArray(evt.msgs)) return null;
		out.provider = P.PROVIDERS.includes(evt.provider) ? evt.provider : 'claude';
		out.id = String(evt.id);
		out.name = typeof evt.name === 'string' ? evt.name.slice(0, 200) : '';
		out.model = typeof evt.model === 'string' ? evt.model.slice(0, 80) : null;
		out.msgs = evt.msgs.map((m) => ({
			id: String(m.id).slice(0, 80),
			role: m.role === 'assistant' ? 'assistant' : 'human',
			ts: Number.isFinite(m.ts) ? m.ts : null,
			model: typeof m.model === 'string' ? m.model.slice(0, 80) : null,
			text: typeof m.text === 'string' ? m.text : ''
		}));
		return out;
	}
	if (evt.t === 'poll') {
		out.raw = evt.raw && typeof evt.raw === 'object' ? evt.raw : {};
		return out;
	}
	if (!ID_RE.test(String(evt.conv))) return null;
	out.conv = String(evt.conv);
	if (evt.t === 'limit') {
		out.ml = evt.ml && typeof evt.ml === 'object' ? evt.ml : null;
		out.early = evt.early === true;
	}
	return out;
}

async function handleEvent(raw) {
	const evt = sanitize(raw);
	if (!evt) return { ignored: true };
	switch (evt.t) {
		case 'gen_start':
			await handleGenStart(evt);
			return {};
		case 'limit':
			await applyUsage(C.normalizeMessageLimit(evt.ml), evt.ts, 'sse', evt.conv, evt.org, await getSettings(), evt.early === true);
			return {};
		case 'poll':
			await applyUsage(C.normalizeUsageEndpoint(evt.raw), evt.ts, 'poll', null, evt.org, await getSettings());
			return {};
		case 'gen_end':
			await handleGenEnd(evt);
			return {};
		case 'conv':
			return handleConv(evt);
	}
	return {};
}

async function clearAll() {
	const { settings } = await store.get('settings');
	await chrome.storage.local.clear();
	if (settings) await store.set({ settings });
}

// ---------------------------------------------------------------- listeners

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
	if (!msg || typeof msg.type !== 'string' || sender.id !== chrome.runtime.id) return false;
	if (msg.type === 'evt') {
		enqueue(() => handleEvent(msg.evt)).then(
			(r) => sendResponse({ ok: true, ...r }),
			(e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) })
		);
		return true;
	}
	if (msg.type === 'open') {
		const t = ['claude', 'chatgpt', 'gemini'].includes(msg.tab) ? '#' + msg.tab : '';
		chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html?tab=1' + t) });
		sendResponse({ ok: true });
		return false;
	}
	if (msg.type === 'clear') {
		enqueue(clearAll).then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: String(e) }));
		return true;
	}
	return false;
});

chrome.runtime.onInstalled.addListener(async () => {
	const { settings } = await store.get('settings');
	if (!settings) await store.set({ settings: { ...C.DEFAULT_SETTINGS } });
});
