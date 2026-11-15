/* Usage Ledger - dashboard (popup and full-tab). DOM is built with createElement only. */
(() => {
	'use strict';
	const C = self.LedgerCore;
	const PV = self.LedgerProviders;
	const SVGNS = 'http://www.w3.org/2000/svg';
	const $ = (s) => document.querySelector(s);

	function h(tag, attrs, ...kids) {
		const n = document.createElement(tag);
		for (const [k, v] of Object.entries(attrs || {})) {
			if (k === 'class') n.className = v;
			else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
			else if (v !== false && v != null) n.setAttribute(k, v);
		}
		for (const kid of kids.flat()) {
			if (kid == null) continue;
			n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
		}
		return n;
	}

	function s(tag, attrs, ...kids) {
		const n = document.createElementNS(SVGNS, tag);
		for (const [k, v] of Object.entries(attrs || {})) if (v != null) n.setAttribute(k, v);
		for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
		return n;
	}

	const isTab = /[?&]tab=1/.test(location.search);
	document.body.classList.toggle('wide', isTab);

	let data = {};
	let range = '7d';
	const RANGES = { '24h': 24 * 3600e3, '7d': 7 * 24 * 3600e3, '30d': 30 * 24 * 3600e3 };

	const level = (u) => (u >= 90 ? 'bad' : u >= 70 ? 'warn' : '');

	// ------------------------------------------------------------------ cards

	function renderCards() {
		const now = Date.now();
		const wins = C.currentWindows(data.live && data.live.windows, now);
		const box = $('#cards');
		box.replaceChildren();
		const names = C.orderedNames(wins);
		if (!names.length) {
			box.append(h('p', { class: 'muted' }, 'No quota data yet. Open claude.ai and send a message, or just load a chat, and the numbers will appear here.'));
			return;
		}
		for (const name of names) {
			const w = wins[name];
			const hours = C.windowHours(name);
			const p = hours ? C.pace(w, hours, now, C.recentFor(data.samples, name, w, now, 30 * 60e3)) : null;
			const lines = [];
			if (w.reset != null) lines.push('Resets in ' + C.fmtDur(w.reset - now));
			else if (w.stale) lines.push('Window reset - waiting for fresh data');
			if (p && p.avgRate != null) {
				let l = 'Burn: ' + p.avgRate.toFixed(1) + '%/h avg';
				if (p.recentRate != null) l += ' · ' + p.recentRate.toFixed(1) + '%/h last 30 min';
				lines.push(l);
				if (p.u >= 100) lines.push('Limit reached');
				else if (p.willHit) lines.push('Limit in ~' + C.fmtDur(p.etaMs) + ' - before the reset');
				else if (p.projectedAtReset >= 1) lines.push('Projected ~' + Math.round(p.projectedAtReset) + '% at reset');
				if (p.lowConfidence) lines.push('(early in the window - rough estimate)');
			}
			box.append(
				h('div', { class: 'card' },
					h('div', { class: 'ctitle' }, C.windowLabel(name)),
					h('div', { class: 'big' }, C.fmtPct(w.u)),
					h('div', { class: 'bar' }, h('div', { class: 'fill ' + level(w.u), style: 'width:' + Math.min(100, w.u) + '%' })),
					lines.map((t) => h('div', { class: 'muted' }, t))
				)
			);
		}
	}

	function renderInsight() {
		const now = Date.now();
		const p = $('#insight');
		let gens = 0;
		let spent = 0;
		let other = 0;
		for (let i = 0; i < 7; i++) {
			const d = (data.daily || {})[C.dayKey(now - i * 86400e3)];
			if (!d) continue;
			gens += d.gens || 0;
			spent += (d.spent && d.spent.seven_day) || 0;
			other += (d.other && d.other.seven_day) || 0;
		}
		if (!gens && !spent && !other) {
			p.style.display = 'none';
			return;
		}
		p.style.display = '';
		const lead = gens ? `Last 7 days: ${gens} messages tracked used ${spent.toFixed(1)}% of your weekly quota (about ${(spent / gens).toFixed(2)}% per message)` : `Last 7 days: ${spent.toFixed(1)}% of your weekly quota used by chats seen here`;
		p.textContent = lead +
			(other > 0.05 ? `, plus ${other.toFixed(1)}% not tied to a chat seen here.` : '.');
	}

	// -------------------------------------------------------------- line chart

	function seriesFor(name, from, now) {
		const segs = [];
		for (const smp of data.samples || []) {
			if (smp.ts < from) continue;
			const e = smp.w && smp.w[name];
			if (!e) continue;
			const pt = { t: smp.ts, u: e[0] };
			const last = segs[segs.length - 1];
			if (last && C.sameInstance({ reset: last.r }, { reset: e[1] })) last.pts.push(pt);
			else segs.push({ r: e[1], pts: [pt] });
		}
		for (const sg of segs) {
			const lp = sg.pts[sg.pts.length - 1];
			const end = Math.min(now, sg.r != null ? sg.r : now);
			if (end > lp.t) sg.pts.push({ t: end, u: lp.u });
		}
		return segs;
	}

	function fmtTick(t, span) {
		const d = new Date(t);
		const p = (n) => String(n).padStart(2, '0');
		return span <= 48 * 3600e3 ? p(d.getHours()) + ':' + p(d.getMinutes()) : p(d.getMonth() + 1) + '/' + p(d.getDate());
	}

	function renderLine() {
		const box = $('#chartLine');
		box.replaceChildren();
		const now = Date.now();
		const span = RANGES[range];
		const from = now - span;
		const W = 600;
		const H = 190;
		const m = { l: 32, r: 8, t: 8, b: 20 };
		const x = (t) => m.l + ((t - from) / span) * (W - m.l - m.r);
		const y = (u) => H - m.b - (u / 100) * (H - m.t - m.b);
		const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart' });
		for (const g of [0, 25, 50, 75, 100]) {
			svg.append(s('line', { class: 'grid', x1: m.l, x2: W - m.r, y1: y(g), y2: y(g) }));
			svg.append(s('text', { x: m.l - 5, y: y(g) + 3, 'text-anchor': 'end' }, g + '%'));
		}
		for (let i = 0; i <= 4; i++) {
			const t = from + (span * i) / 4;
			svg.append(s('text', { x: x(t), y: H - 5, 'text-anchor': i === 0 ? 'start' : i === 4 ? 'end' : 'middle' }, fmtTick(t, span)));
		}
		let any = false;
		for (const name of ['seven_day', 'five_hour']) {
			for (const sg of seriesFor(name, from, now)) {
				any = true;
				if (sg.pts.length === 1) {
					svg.append(s('circle', { class: 'dotp l-' + name, cx: x(sg.pts[0].t), cy: y(sg.pts[0].u), r: 2.5 }));
				} else {
					const d = sg.pts.map((p, i) => (i ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(p.u).toFixed(1)).join(' ');
					svg.append(s('path', { class: 'line l-' + name, d }));
				}
			}
		}
		if (!any) svg.append(s('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle' }, 'No samples in this range yet'));
		box.append(svg);
	}

	// ------------------------------------------------------------- daily chart

	function renderDaily() {
		const box = $('#chartDaily');
		box.replaceChildren();
		const now = Date.now();
		const N = 14;
		const days = [];
		for (let i = N - 1; i >= 0; i--) days.push(C.dayKey(now - i * 86400e3));
		const rows = days.map((k) => {
			const d = (data.daily || {})[k] || {};
			return { k, a: (d.spent && d.spent.seven_day) || 0, o: (d.other && d.other.seven_day) || 0 };
		});
		const max = Math.max(1, ...rows.map((r) => r.a + r.o));
		const W = 600;
		const H = 170;
		const m = { l: 8, r: 8, t: 14, b: 20 };
		const bw = (W - m.l - m.r) / N;
		const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart' });
		const y = (v) => H - m.b - (v / max) * (H - m.t - m.b);
		svg.append(s('line', { class: 'grid', x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b }));
		rows.forEach((r, i) => {
			const x0 = m.l + i * bw + bw * 0.18;
			const w = bw * 0.64;
			if (r.a > 0) svg.append(s('rect', { class: 'b-acc', x: x0, y: y(r.a), width: w, height: H - m.b - y(r.a), rx: 2 }));
			if (r.o > 0) svg.append(s('rect', { class: 'b-gray', x: x0, y: y(r.a + r.o), width: w, height: y(r.a) - y(r.a + r.o), rx: 2 }));
			const tot = r.a + r.o;
			if (tot > 0) svg.append(s('text', { x: x0 + w / 2, y: y(tot) - 3, 'text-anchor': 'middle' }, tot < 10 ? tot.toFixed(1) : Math.round(tot)));
			if (i % 2 === (N - 1) % 2) svg.append(s('text', { x: x0 + w / 2, y: H - 6, 'text-anchor': 'middle' }, r.k.slice(5).replace('-', '/')));
		});
		box.append(svg);
	}

	// ----------------------------------------------------------- bucket chart

	function renderBuckets() {
		const box = $('#chartBuckets');
		box.replaceChildren();
		const cal = data.S.calibration;
		const agg = C.BUCKETS.map(() => ({ n: 0, five: 0, seven: 0 }));
		for (const g of data.gens || []) {
			if (!g.seen) continue;
			const b = agg[C.bucketIndex((g.ctx || 0) * cal)];
			b.n++;
			b.five += (g.d && g.d.five_hour) || 0;
			b.seven += (g.d && g.d.seven_day) || 0;
		}
		if (!agg.some((b) => b.n)) {
			box.append(h('p', { class: 'muted' }, 'Not enough data yet - this fills in as you send messages.'));
			return;
		}
		const means = agg.map((b) => (b.n ? b.five / b.n : 0));
		const max = Math.max(0.01, ...means);
		const grid = h('div', { class: 'bk' });
		C.BUCKETS.forEach((bk, i) => {
			const b = agg[i];
			grid.append(h('div', { class: 'lab' }, bk.label));
			const text = b.n ? `${means[i].toFixed(2)}% of session · ${(b.seven / b.n).toFixed(2)}% of week per msg (n=${b.n})` : 'no data';
			grid.append(h('div', { class: 'barwrap' }, h('div', { class: 'barfill', style: 'width:' + (b.n ? (means[i] / max) * 100 : 0) + '%' }), h('span', { class: 'txt' }, text)));
		});
		box.append(grid);
	}

	// ------------------------------------------------------------------ table

	const SITE_URL = { claude: (id) => 'https://claude.ai/chat/' + id, openai: (id) => 'https://chatgpt.com/c/' + id, gemini: (id) => 'https://gemini.google.com/app/' + id };
	const APPS = [['claude', 'Claude'], ['openai', 'ChatGPT'], ['gemini', 'Gemini']];
	const TABS = [['all', 'All'], ['claude', 'Claude'], ['chatgpt', 'ChatGPT'], ['gemini', 'Gemini'], ['settings', 'Settings']];
	const TAB_PROV = { claude: 'claude', chatgpt: 'openai', gemini: 'gemini' };
	const APP_COLOR = { claude: 'var(--claude)', openai: 'var(--chatgpt)', gemini: 'var(--gemini)' };
	const sortKeys = {};
	let tab = 'all';

	function tokensOf(c) {
		const tk = c.tokenizer;
		const cal = (c.provider || 'claude') === 'claude' && (!tk || tk.id === 'claude:o200k-proxy') ? data.S.calibration : 1;
		return (c.tokens || 0) * cal;
	}

	const provOf = (c) => c.provider || 'claude';
	const isApprox = (c) => !c.tokenizer || !c.tokenizer.exact || c.approx;

	/** per-app totals over the chats this browser has seen */
	function aggregate() {
		const out = {};
		for (const [k] of APPS) out[k] = { n: 0, tokens: 0, last: 0, max: null, approx: false };
		for (const c of Object.values(data.convs || {})) {
			if (!c.tokens) continue;
			const a = out[provOf(c)];
			if (!a) continue;
			const t = tokensOf(c);
			a.n++;
			a.tokens += t;
			a.last = Math.max(a.last, c.lastTs || 0);
			if (!a.max || t > a.max.t) a.max = { t, c };
			if (isApprox(c)) a.approx = true;
		}
		return out;
	}

	const tokText = (n, approx) => (approx ? '~' : '') + C.fmtTokens(n);

	/** one ledger line: label ........ value */
	function leader(label, value, o = {}) {
		return h('div', { class: 'ldr' + (o.total ? ' total' : '') + (o.empty ? ' empty' : '') },
			h('span', { class: 'l' }, o.color ? h('i', { style: 'background:' + o.color }) : null, label),
			h('span', { class: 'dots' }),
			h('span', { class: 'v' }, value, o.small ? h('small', null, o.small) : null));
	}

	// ------------------------------------------------------------ balance + tabs

	function renderBalance() {
		const box = $('#balance');
		box.replaceChildren();
		const agg = aggregate();
		const total = APPS.reduce((n, [k]) => n + agg[k].tokens, 0);
		box.classList.toggle('empty', !total);
		if (!total) return;
		for (const [k, name] of APPS) {
			if (!agg[k].tokens) continue;
			box.append(h('div', { class: 'seg ' + k, style: `flex:${agg[k].tokens} 1 0`, title: `${name}: ${tokText(agg[k].tokens, agg[k].approx)} tokens in ${agg[k].n} chats (${Math.round((agg[k].tokens / total) * 100)}%)` }));
		}
	}

	function renderTabs() {
		const box = $('#tabs');
		box.replaceChildren();
		const agg = aggregate();
		const total = APPS.reduce((n, [k]) => n + agg[k].tokens, 0);
		for (const [id, name] of TABS) {
			let sub = '';
			if (id === 'all') sub = total ? tokText(total, true) + ' tokens' : 'no chats yet';
			else if (TAB_PROV[id]) {
				const a = agg[TAB_PROV[id]];
				sub = a.n ? tokText(a.tokens, a.approx) + ' tokens' : 'no chats yet';
			}
			const b = h('button', { class: 'tab', role: 'tab', 'data-tab': id, 'aria-selected': String(id === tab), id: 'tab-' + id, 'aria-controls': 'panel-' + id, onclick: () => selectTab(id) },
				h('span', { class: 'sw2' }), h('span', { class: 'nm' }, name), sub ? h('span', { class: 'tot' }, sub) : null);
			box.append(b);
		}
	}

	function selectTab(id) {
		tab = id;
		try {
			history.replaceState(null, '', '#' + id);
		} catch {
			location.hash = id;
		}
		renderAll();
	}

	// ------------------------------------------------------------------ tables

	function renderChatTable(sel, prov, limit) {
		const t = $(sel);
		t.replaceChildren();
		const claude = prov === 'claude';
		const key = sortKeys[sel] || (claude ? 'seven_day' : 'tokens');
		const rows = Object.values(data.convs || {}).filter((c) => (!prov || provOf(c) === prov) && (c.tokens > 0 || c.gens > 0 || (c.spent && (c.spent.five_hour || c.spent.seven_day))));
		const val = (c) => (key === 'tokens' ? tokensOf(c) : key === 'lastTs' ? c.lastTs || 0 : key === 'gens' ? c.gens || c.msgs || 0 : (c.spent && c.spent[key]) || 0);
		rows.sort((a, b) => val(b) - val(a));
		const cols = [['name', 'Chat']];
		if (!prov) cols.push(['app', 'App']);
		cols.push(['tokens', 'Tokens'], ['tokenizer', 'Tokenizer'], ['gens', 'Messages']);
		if (claude) cols.push(['five_hour', 'Session %'], ['seven_day', 'Weekly %']);
		cols.push(['lastTs', 'Last used']);
		const sortable = new Set(['tokens', 'gens', 'five_hour', 'seven_day', 'lastTs']);
		t.append(h('thead', null, h('tr', null, cols.map(([k, label]) => h('th', { onclick: () => { if (sortable.has(k)) { sortKeys[sel] = k; renderChatTable(sel, prov, limit); } }, title: sortable.has(k) ? 'Sort' : '' }, label + (key === k ? ' ▾' : ''))))));
		const body = h('tbody');
		if (!rows.length) body.append(h('tr', null, h('td', { colspan: cols.length, class: 'muted' }, 'No chats counted yet. Open a chat and it will appear here.')));
		for (const c of rows.slice(0, limit || 25)) {
			const pv = provOf(c);
			const label = c.name || c.id.slice(0, 8);
			const tk = c.tokenizer;
			const cells = [h('td', { title: label }, h('a', { href: (SITE_URL[pv] || SITE_URL.claude)(c.id), target: '_blank', rel: 'noreferrer' }, label))];
			if (!prov) cells.push(h('td', null, h('i', { class: 'app', style: 'background:' + APP_COLOR[pv] }), PV.NAMES[pv] || pv));
			cells.push(
				h('td', null, c.tokens ? tokText(tokensOf(c), isApprox(c)) : '-'),
				h('td', { title: tk ? tk.label : '' }, c.approx ? 'fallback (chars/3.7)' : tk ? tk.label.replace(/ \(.*\)$/, '') + (tk.exact ? '' : ' ≈') : '-'),
				h('td', null, c.gens || c.msgs || 0)
			);
			if (claude) cells.push(h('td', null, ((c.spent && c.spent.five_hour) || 0).toFixed(1)), h('td', null, ((c.spent && c.spent.seven_day) || 0).toFixed(1)));
			cells.push(h('td', null, c.lastTs ? C.fmtDur(Date.now() - c.lastTs) + ' ago' : '-'));
			body.append(h('tr', null, cells));
		}
		t.append(body);
	}

	// Which tokenizer is picked for which model: generated from the same function the worker uses.
	function renderTokenizerMap() {
		const t = $('#tokMap');
		t.replaceChildren();
		const rows = [
			['claude', 'any Claude model', {}],
			['claude', 'any Claude model, API key enabled', { claudeApi: true }],
			['openai', 'gpt-4o, gpt-4.1, gpt-5.x, o1 / o3 / o4', null, 'gpt-5'],
			['openai', 'gpt-4, gpt-4-turbo, gpt-3.5', null, 'gpt-4-turbo'],
			['openai', 'name not recognised (e.g. "Auto")', null, 'Auto'],
			['gemini', 'gemini-2.x, gemini-3-pro / flash', null, 'gemini-2.5-pro'],
			['gemini', 'gemini-3.1 / 3.5, "Fast", "Pro", …', null, 'gemini-3.5-flash']
		];
		t.append(h('thead', null, h('tr', null, ['Site', 'Model selected', 'Tokenizer used', 'Accuracy'].map((x) => h('th', null, x)))));
		const body = h('tbody');
		for (const [prov, model, opts, slug] of rows) {
			const sp = PV.specFor(prov, slug || 'claude-sonnet-5-5', opts || {});
			body.append(h('tr', null, h('td', null, PV.NAMES[prov]), h('td', null, model), h('td', null, sp.label.replace(/ \(.*\)$/, '')), h('td', null, sp.kind === 'claude-api' ? 'near-exact' : sp.exact ? 'exact' : 'estimate')));
		}
		t.append(body);
	}

	// ------------------------------------------------------------------ panels

	function renderAllPanel() {
		const agg = aggregate();
		const total = APPS.reduce((n, [k]) => n + agg[k].tokens, 0);
		const box = $('#allLedger');
		box.replaceChildren();
		if (!total) {
			box.append(leader('No chats counted yet', '0', { empty: true }));
			box.append(h('p', { class: 'note' }, 'Open a chat on claude.ai, chatgpt.com or gemini.google.com and it will be counted here.'));
		} else {
			for (const [k, name] of APPS) box.append(leader(name, tokText(agg[k].tokens, agg[k].approx), { color: APP_COLOR[k], small: `${agg[k].n} ${agg[k].n === 1 ? 'chat' : 'chats'}`, empty: !agg[k].n }));
			box.append(leader('Counted in total', tokText(total, true), { total: true }));
		}

		const q = $('#allQuota');
		q.replaceChildren();
		const now = Date.now();
		const wins = C.currentWindows(data.live && data.live.windows, now);
		const names = C.orderedNames(wins);
		if (names.length) {
			for (const name of names) {
				const w = wins[name];
				q.append(leader('Claude ' + C.windowLabel(name).toLowerCase(), C.fmtPct(w.u), { color: APP_COLOR.claude, small: w.reset != null ? 'resets in ' + C.fmtDur(w.reset - now) : '' }));
			}
		} else q.append(leader('Claude usage meter', 'no data yet', { empty: true }));
		q.append(h('p', { class: 'note' }, 'Only claude.ai shows a usage limit that can be read. ChatGPT and Gemini chats are counted in tokens only.'));

		renderChatTable('#convTableAll', null, 12);
		renderTokenizerMap();
	}

	function renderProviderPanel(tabId) {
		const prov = TAB_PROV[tabId];
		const a = aggregate()[prov];
		const cap = tabId.charAt(0).toUpperCase() + tabId.slice(1);
		const box = $('#ledger' + (tabId === 'chatgpt' ? 'Chatgpt' : 'Gemini'));
		box.replaceChildren();
		if (!a.n) {
			box.append(leader('No chats counted yet', '0', { empty: true }));
			box.append(h('p', { class: 'note' }, `Open a chat on ${prov === 'openai' ? 'chatgpt.com' : 'gemini.google.com'} and it will be counted here.`));
		} else {
			box.append(leader('Chats counted', String(a.n), { color: APP_COLOR[prov] }));
			box.append(leader('Average chat', tokText(a.tokens / a.n, a.approx)));
			box.append(leader('Largest chat', tokText(a.max.t, isApprox(a.max.c)), { small: (a.max.c.name || '').slice(0, 28) }));
			box.append(leader('Counted in total', tokText(a.tokens, a.approx), { total: true }));
		}

		// chat-size histogram
		const hist = $('#sizes' + (tabId === 'chatgpt' ? 'Chatgpt' : 'Gemini'));
		hist.replaceChildren();
		const counts = C.BUCKETS.map(() => 0);
		for (const c of Object.values(data.convs || {})) if (c.tokens && provOf(c) === prov) counts[C.bucketIndex(tokensOf(c))]++;
		if (!counts.some(Boolean)) hist.append(h('p', { class: 'note' }, 'Fills in as chats are counted.'));
		else {
			const max = Math.max(...counts);
			const grid = h('div', { class: 'size bk' });
			C.BUCKETS.forEach((bk, i) => {
				grid.append(h('div', { class: 'lab' }, bk.label));
				grid.append(h('div', { class: 'barwrap' }, h('div', { class: 'barfill', style: `width:${(counts[i] / max) * 100}%;--bc:${APP_COLOR[prov]}` }), h('span', { class: 'txt' }, counts[i] ? `${counts[i]} ${counts[i] === 1 ? 'chat' : 'chats'}` : '')));
			});
			hist.append(grid);
		}

		renderChatTable('#convTable' + (tabId === 'chatgpt' ? 'Chatgpt' : 'Gemini'), prov, 25);

		const how = $('#how' + (tabId === 'chatgpt' ? 'Chatgpt' : 'Gemini'));
		how.replaceChildren();
		const lim = prov === 'openai' ? data.S.contextLimitOpenAI : data.S.contextLimitGemini;
		const lines = prov === 'openai'
			? [
				'Messages from gpt-4o, gpt-4.1, GPT-5 and the o-series use OpenAI\'s o200k_base. gpt-4 and gpt-3.5 use cl100k_base. The tokenizer is picked per message from the model that wrote it.',
				'ChatGPT\'s current page does not show the model name, so most chats are counted as o200k_base and marked "assumed". That is the encoding every current ChatGPT model uses.'
			]
			: [
				'Counted with the Gemma 3 SentencePiece vocabulary, which Google\'s SDK uses for gemini-2.x and gemini-3-pro / flash.',
				'The Gemini app usually shows names like Fast or Pro instead of a model id, and the newer 3.1 and 3.5 models use a vocabulary that is not bundled here, so counts are marked as estimates.'
			];
		for (const l of lines) how.append(h('p', { class: 'note' }, l));
		how.append(h('p', { class: 'note' }, `${cap === 'Chatgpt' ? 'ChatGPT' : 'Gemini'} does not show a usage limit that this extension can read, so there is no quota here. The bar in the message box is scaled to ${C.fmtTokens(lim)} tokens; change that in Settings. Counts leave out the system prompt, memory, files and hidden reasoning.`));
	}

	function renderUpdated() {
		let last = (data.live && data.live.ts) || 0;
		for (const c of Object.values(data.convs || {})) last = Math.max(last, c.tokTs || 0, c.lastTs || 0);
		$('#updated').textContent = last ? 'updated ' + C.fmtDur(Date.now() - last) + ' ago' : '';
	}

	let settingsBuilt = false;
	function renderAll() {
		renderBalance();
		renderTabs();
		renderUpdated();
		for (const [id] of TABS) {
			const p = $('#panel-' + id);
			p.hidden = id !== tab;
			p.setAttribute('aria-labelledby', 'tab-' + id);
		}
		if (tab === 'all') renderAllPanel();
		else if (tab === 'claude') {
			renderCards();
			renderInsight();
			renderLine();
			renderDaily();
			renderBuckets();
			renderChatTable('#convTableClaude', 'claude', 25);
			renderApiBox();
		} else if (tab === 'settings') {
			if (!settingsBuilt) {
				buildSettings();
				settingsBuilt = true;
			}
		} else renderProviderPanel(tab);
	}

	// --------------------------------------------------------------- settings

	const FIELDS = [
		['showPill', 'Show the usage display on claude.ai, ChatGPT and Gemini', 'checkbox'],
		['uiMode', 'Where it appears', 'select', [['inline', 'Under the message box'], ['floating', 'Floating pill in a corner']], 'If the message box cannot be found on a page, the floating pill is used instead.'],
		['pillCorner', 'Corner for the floating pill', 'select', [['br', 'Bottom right'], ['bl', 'Bottom left'], ['tr', 'Top right'], ['tl', 'Top left']]],
		['contextLimit', 'Claude: context size for the chat meter (tokens)', 'number', { min: 1000, max: 5e6, step: 1000 }],
		['contextLimitOpenAI', 'ChatGPT: context size for the chat meter (tokens)', 'number', { min: 1000, max: 5e6, step: 1000 }, 'Varies by plan and model; this only scales the bar.'],
		['contextLimitGemini', 'Gemini: context size for the chat meter (tokens)', 'number', { min: 1000, max: 5e7, step: 1000 }],
		['calibration', 'Claude estimate calibration factor', 'number', { min: 0.5, max: 3, step: 0.05 }, 'Without the API key, Claude chats are counted with OpenAI\'s o200k as a stand-in. Anthropic says Claude 4.7 and later (including the Fable / Mythos 5.x models) tokenize the same text into about 30% more tokens than earlier Claude models, so the stand-in may undercount for them. Scale it here if you know your counts run low or high. Not applied to API counts.'],
		['cacheMinutes', 'Assumed prompt-cache lifetime (min)', 'number', { min: 1, max: 120, step: 1 }],
		['pollMinutes', 'Usage refresh interval (min)', 'number', { min: 1, max: 120, step: 1 }],
		['includeThinking', 'Count thinking blocks in chat size (Claude, Gemini)', 'checkbox'],
		['attributionLag', 'Usage sample timing', 'select', [['auto', 'Auto-detect (recommended)'], [0, 'Includes the message just sent'], [1, 'From before the message']], 'Auto checks whether the usage event arrives before or after the answer text. If it arrives first, a message\'s cost is credited when the next message is sent.']
	];

	function buildSettings() {
		const f = $('#settings');
		f.replaceChildren();
		for (const [key, label, type, opt, hint] of FIELDS) {
			let input;
			const cur = data.S[key];
			if (type === 'checkbox') input = h('input', { type: 'checkbox', id: 's-' + key, checked: cur ? 'checked' : false });
			else if (type === 'select') input = h('select', { id: 's-' + key }, opt.map(([v, l]) => h('option', { value: v, selected: String(cur) === String(v) ? 'selected' : false }, l)));
			else input = h('input', { type: 'number', id: 's-' + key, value: cur, ...opt });
			input.addEventListener('change', () => saveSetting(key, type, input, opt));
			f.append(h('label', { for: 's-' + key }, label), input);
			if (hint) f.append(h('div', { class: 'hint' }, hint));
		}
	}

	async function saveSetting(key, type, input, opt) {
		let v;
		if (type === 'checkbox') v = input.checked;
		else if (type === 'select') v = key === 'attributionLag' && input.value !== 'auto' ? Number(input.value) : input.value;
		else {
			v = Number(input.value);
			if (!Number.isFinite(v)) return;
			v = Math.min(opt.max, Math.max(opt.min, v));
			input.value = v;
		}
		const { settings } = await chrome.storage.local.get('settings');
		await chrome.storage.local.set({ settings: { ...C.DEFAULT_SETTINGS, ...(settings || {}), [key]: v } });
	}

	// ---------------------------------------------------- Claude exact counting

	const API_ORIGIN = 'https://api.anthropic.com/*';

	function renderApiBox() {
		const box = $('#apiBox');
		box.replaceChildren();
		const on = data.S.claudeCounting === 'api' && data.hasKey && data.hasPerm;
		const st = data.claudeApiStatus;
		let status = 'Off - Claude chats use the o200k estimate.';
		if (on) {
			status = st && !st.ok ? 'On, but the last call failed: ' + st.error + (st.fatal ? ' (check the key)' : ' (will retry)') : 'On - Claude chats are counted by Anthropic\'s count_tokens API.';
		} else if (data.S.claudeCounting === 'api') status = 'Selected, but ' + (!data.hasKey ? 'no key is saved.' : 'the permission was not granted.');
		box.append(h('p', { class: 'small' }, status));
		if (!isTab) {
			box.append(h('p', { class: 'muted small' }, 'Open the dashboard in a tab to change this (the permission prompt closes the popup).'));
			return;
		}
		const key = h('input', { type: 'password', id: 'apiKey', placeholder: data.hasKey ? 'Key saved - paste a new one to replace' : 'sk-ant-...', autocomplete: 'off', spellcheck: 'false' });
		const enable = h('button', { class: 'btn', type: 'button' }, on ? 'Update key' : 'Enable exact counting');
		enable.addEventListener('click', () => {
			// The permission prompt needs the click's user gesture, so request it before any await.
			const typed = key.value.trim();
			chrome.permissions.request({ origins: [API_ORIGIN] }).then(async (granted) => {
				if (!granted) return renderApiBox();
				if (typed) await chrome.storage.local.set({ anthropicKey: typed });
				const { settings, anthropicKey } = await chrome.storage.local.get(['settings', 'anthropicKey']);
				if (!anthropicKey) return load();
				await chrome.storage.local.set({ settings: { ...C.DEFAULT_SETTINGS, ...(settings || {}), claudeCounting: 'api' } });
				key.value = '';
				await load();
			});
		});
		const row = h('div', { class: 'row' }, enable);
		if (data.S.claudeCounting === 'api' || data.hasKey) {
			const off = h('button', { class: 'btn', type: 'button' }, 'Turn off & remove key');
			off.addEventListener('click', async () => {
				const { settings } = await chrome.storage.local.get('settings');
				await chrome.storage.local.set({ settings: { ...C.DEFAULT_SETTINGS, ...(settings || {}), claudeCounting: 'estimate' } });
				await chrome.storage.local.remove(['anthropicKey', 'claudeApiStatus']);
				try {
					await chrome.permissions.remove({ origins: [API_ORIGIN] });
				} catch {
					/* ignore */
				}
				await load();
			});
			row.append(off);
		}
		box.append(key, row);
	}

	// ------------------------------------------------------------------- data

	function download(name, text, mime) {
		const url = URL.createObjectURL(new Blob([text], { type: mime }));
		const a = h('a', { href: url, download: name });
		document.body.append(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	function csvRows() {
		const rows = [];
		for (const smp of data.samples || []) {
			for (const name of Object.keys(smp.w || {})) {
				const [u, reset] = smp.w[name];
				rows.push({
					time: new Date(smp.ts).toISOString(),
					window: name,
					utilization_pct: u,
					resets_at: reset ? new Date(reset).toISOString() : '',
					source: smp.src,
					conversation: smp.conv || ''
				});
			}
		}
		return rows;
	}

	let clearArmed = false;
	function wireButtons() {
		$('#openTab').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html?tab=1#' + tab) }));
		$('#expCsv').addEventListener('click', () =>
			download('usage-ledger-samples.csv', C.toCSV(['time', 'window', 'utilization_pct', 'resets_at', 'source', 'conversation'], csvRows()), 'text/csv'));
		$('#expJson').addEventListener('click', async () => {
			const all = await chrome.storage.local.get(null);
			for (const k of Object.keys(all)) if (k.startsWith('tok:')) delete all[k];
			delete all.anthropicKey; // never export the API key
			download('usage-ledger.json', JSON.stringify(all, null, 1), 'application/json');
		});
		const clear = $('#clear');
		clear.addEventListener('click', async () => {
			if (!clearArmed) {
				clearArmed = true;
				clear.textContent = 'Click again to confirm';
				setTimeout(() => {
					clearArmed = false;
					clear.textContent = 'Clear all data';
				}, 4000);
				return;
			}
			clearArmed = false;
			clear.textContent = 'Clear all data';
			await chrome.runtime.sendMessage({ type: 'clear' });
			await load();
		});
		const seg = $('#rangeBtns');
		for (const r of Object.keys(RANGES)) {
			seg.append(h('button', { class: 'btn' + (r === range ? ' on' : ''), 'data-r': r, onclick: () => {
				range = r;
				for (const b of seg.children) b.classList.toggle('on', b.dataset.r === r);
				renderLine();
			} }, r));
		}
	}

	async function load() {
		data = await chrome.storage.local.get(['settings', 'live', 'samples', 'convs', 'daily', 'gens', 'claudeApiStatus']);
		data.hasKey = !!(await chrome.storage.local.get('anthropicKey')).anthropicKey;
		try {
			data.hasPerm = await chrome.permissions.contains({ origins: [API_ORIGIN] });
		} catch {
			data.hasPerm = false;
		}
		data.S = { ...C.DEFAULT_SETTINGS, ...(data.settings || {}) };
		renderAll();
	}

	const fromHash = () => {
		const id = location.hash.slice(1);
		tab = TABS.some(([t]) => t === id) ? id : 'all';
	};
	fromHash();
	window.addEventListener('hashchange', () => {
		fromHash();
		renderAll();
	});
	wireButtons();
	load();
	let t = null;
	chrome.storage.onChanged.addListener((ch, area) => {
		if (area !== 'local') return;
		clearTimeout(t);
		t = setTimeout(() => load(), 250);
	});
	setInterval(() => {
		if (tab === 'claude') renderCards();
		renderUpdated();
	}, 15000);
})();
