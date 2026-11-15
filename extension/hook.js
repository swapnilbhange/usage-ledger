/*
 * Usage Ledger - page hook (runs in the page's MAIN world at document_start).
 *
 * Wraps window.fetch to observe completion requests and their SSE streams, and
 * emits tiny JSON events on `document` for the isolated content script.
 * It reads nothing else, stores nothing, and never sends anything over the network.
 */
(() => {
	'use strict';
	if (window.__clLedgerHooked) return;
	window.__clLedgerHooked = true;

	const EVT = 'cl-ledger:evt';
	const origFetch = window.fetch;
	if (typeof origFetch !== 'function') return;

	const COMPLETION = /^\/api\/organizations\/([^/]+)\/chat_conversations\/([^/]+)\/(completion|retry_completion)\/?$/;

	function emit(obj) {
		try {
			document.dispatchEvent(new CustomEvent(EVT, { detail: JSON.stringify(obj) }));
		} catch {
			/* never break the page */
		}
	}

	function describe(input, init) {
		try {
			let url = '';
			let method = 'GET';
			if (typeof input === 'string') url = input;
			else if (input instanceof URL) url = input.href;
			else if (input && typeof input.url === 'string') {
				url = input.url;
				if (input.method) method = input.method; // Request object
			}
			if (init && init.method) method = init.method;
			const u = new URL(url, location.origin);
			if (u.origin !== location.origin) return null;
			return { path: u.pathname, method: String(method).toUpperCase() };
		} catch {
			return null;
		}
	}

	function onLine(line, ctx, st) {
		if (line.charCodeAt(0) !== 100 /* d */ || !line.startsWith('data:')) return;
		// Has any answer content streamed yet? A limit event that arrives before it cannot include this message's cost.
		if (!st.sawContent && (line.indexOf('content_block') !== -1 || line.indexOf('"completion"') !== -1)) st.sawContent = true;
		// Cheap pre-filter so we only JSON.parse the one event type we care about.
		if (line.indexOf('message_limit') === -1) return;
		try {
			const j = JSON.parse(line.slice(5).trim());
			const ml = j && j.type === 'message_limit' ? j.message_limit : null;
			if (!ml || typeof ml !== 'object') return;
			emit({
				t: 'limit',
				org: ctx.org,
				conv: ctx.conv,
				early: !st.sawContent,
				ml: {
					type: typeof ml.type === 'string' ? ml.type : null,
					windows: ml.windows && typeof ml.windows === 'object' ? ml.windows : null
				}
			});
		} catch {
			/* ignore */
		}
	}

	async function watch(res, ctx) {
		const ct = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
		if (!/event-stream/i.test(ct) || !res.body) {
			emit({ t: 'gen_end', org: ctx.org, conv: ctx.conv, ok: !!res.ok });
			return;
		}
		try {
			const reader = res.body.getReader();
			const dec = new TextDecoder();
			let buf = '';
			const st = { sawContent: false };
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				buf += dec.decode(value, { stream: true });
				const lines = buf.split(/\r\n|\r|\n/);
				buf = lines.pop() || '';
				for (const line of lines) onLine(line, ctx, st);
			}
			if (buf) onLine(buf, ctx, st);
			emit({ t: 'gen_end', org: ctx.org, conv: ctx.conv, ok: true });
		} catch {
			emit({ t: 'gen_end', org: ctx.org, conv: ctx.conv, ok: false });
		}
	}

	window.fetch = function (...args) {
		const d = describe(args[0], args[1]);
		const m = d && d.method === 'POST' ? COMPLETION.exec(d.path) : null;
		const p = origFetch.apply(this, args);
		if (!m) return p;
		const ctx = { org: m[1], conv: m[2] };
		emit({ t: 'gen_start', org: ctx.org, conv: ctx.conv });
		return p.then(
			(res) => {
				try {
					watch(res.clone(), ctx);
				} catch {
					/* ignore */
				}
				return res;
			},
			(err) => {
				emit({ t: 'gen_end', org: ctx.org, conv: ctx.conv, ok: false });
				throw err;
			}
		);
	};
})();
