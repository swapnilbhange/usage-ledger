/*
 * Tokenizer registry. Given a spec from providers.js, returns an async counter.
 * Dependencies are injected so it runs the same in the service worker and in unit tests.
 *
 *   deps.o200k / deps.cl100k  - gpt-tokenizer bundles ({countTokens})
 *   deps.GemmaSP, deps.loadGemmaBuffer - gemma.js + async () => ArrayBuffer of vendor/gemma3.bin
 *   deps.claudeApi            - optional {count(text, model) => Promise<number>}
 */
(function (root, factory) {
	const api = factory();
	if (typeof module === 'object' && module.exports) module.exports = api;
	else root.LedgerTokenizers = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
	'use strict';

	const FALLBACK_CHARS_PER_TOKEN = 3.7;

	function createRegistry(deps) {
		let gemma = null;
		let gemmaTried = false;

		async function getGemma() {
			if (gemma || gemmaTried) return gemma;
			gemmaTried = true;
			try {
				gemma = deps.GemmaSP.load(await deps.loadGemmaBuffer());
			} catch (e) {
				console.warn('[ledger] Gemma tokenizer failed to load', e);
			}
			return gemma;
		}

		const chars = (s) => Math.ceil(s.length / FALLBACK_CHARS_PER_TOKEN);
		const bundle = (b) => (b && typeof b.countTokens === 'function' ? (s) => b.countTokens(s) : null);

		/**
		 * @returns {Promise<{count:(text:string)=>Promise<number>|number, fallback:boolean}>}
		 * `fallback` is true when the real tokenizer was unavailable and chars/3.7 was used instead.
		 */
		async function counterFor(spec, ctx) {
			let fn = null;
			if (spec.kind === 'o200k') fn = bundle(deps.o200k);
			else if (spec.kind === 'cl100k') fn = bundle(deps.cl100k);
			else if (spec.kind === 'gemma3') {
				const g = await getGemma();
				if (g) fn = (s) => g.count(s);
			} else if (spec.kind === 'claude-api' && deps.claudeApi) {
				const o200 = bundle(deps.o200k);
				return {
					fallback: false,
					count: async (s) => {
						const n = await deps.claudeApi.count(s, ctx && ctx.model);
						if (n != null) return n;
						return o200 ? o200(s) : chars(s); // API unavailable for this one: estimate
					},
					viaApi: true
				};
			}
			if (!fn) return { count: chars, fallback: true };
			return { count: fn, fallback: false };
		}

		return { counterFor };
	}

	/**
	 * Client for POST /v1/messages/count_tokens. Counts one message at a time (cached by the caller),
	 * subtracting the fixed per-request overhead measured with a one-character message.
	 * Stops calling after an auth/permission failure, and backs off after other failures.
	 */
	function createClaudeApi({ fetch, getKey, defaultModel, now, onStatus }) {
		const clock = now || Date.now;
		const overhead = new Map(); // model -> tokens added by the message wrapper
		const badModels = new Set();
		let blockedUntil = 0;
		const URL = 'https://api.anthropic.com/v1/messages/count_tokens';

		async function call(model, text) {
			const key = await getKey();
			if (!key) throw Object.assign(new Error('no key'), { fatal: true });
			const r = await fetch(URL, {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
				body: JSON.stringify({ model, messages: [{ role: 'user', content: text }] })
			});
			if (r.status === 401 || r.status === 403) throw Object.assign(new Error('auth ' + r.status), { fatal: true });
			if (r.status === 400 || r.status === 404) throw Object.assign(new Error('model ' + r.status), { badModel: true });
			if (!r.ok) throw new Error('HTTP ' + r.status);
			const j = await r.json();
			if (!j || !Number.isFinite(j.input_tokens)) throw new Error('bad response');
			return j.input_tokens;
		}

		async function countFor(model, text) {
			if (!overhead.has(model)) overhead.set(model, Math.max(0, (await call(model, '.')) - 1));
			return Math.max(0, (await call(model, text)) - overhead.get(model));
		}

		return {
			async count(text, convModel) {
				if (!text) return 0;
				if (clock() < blockedUntil) return null;
				const candidates = [];
				if (convModel && /^claude-[a-z0-9.-]{3,60}$/.test(convModel) && !badModels.has(convModel)) candidates.push(convModel);
				if (!badModels.has(defaultModel)) candidates.push(defaultModel);
				for (const model of candidates) {
					try {
						const n = await countFor(model, text);
						onStatus && onStatus({ ok: true, model, ts: clock() });
						return n;
					} catch (e) {
						if (e.badModel) {
							badModels.add(model);
							continue;
						}
						// fatal (bad key) => long pause; transient => short pause
						blockedUntil = clock() + (e.fatal ? 10 * 60e3 : 30e3);
						onStatus && onStatus({ ok: false, error: String(e.message), fatal: !!e.fatal, ts: clock() });
						return null;
					}
				}
				return null;
			}
		};
	}

	return { createRegistry, createClaudeApi, FALLBACK_CHARS_PER_TOKEN };
});
