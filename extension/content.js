/*
 * Usage Ledger - content script (isolated world), one script for claude.ai, chatgpt.com and gemini.google.com.
 *  claude.ai : relays the page hook's events, fetches the conversation / usage with the user's own session
 *  chatgpt / gemini : reads the visible conversation from the DOM (the tokenizer is picked by the worker from the model)
 *  all       : draws a self-contained shadow-DOM pill (no dependence on the site's markup)
 */
(() => {
	'use strict';
	if (window.__clLedgerContent) return;
	window.__clLedgerContent = true;

	const C = self.LedgerCore;
	const PV = self.LedgerProviders;
	const AD = self.LedgerAdapters;
	const PROV = PV.detect(location.hostname);
	if (!PROV) return;
	const IS_CLAUDE = PROV === 'claude';
	const EVT = 'cl-ledger:evt';
	const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

	let S = { ...C.DEFAULT_SETTINGS };
	let live = null;
	let convs = {};
	let samples = [];
	let orgId = null;
	let convId = null;
	let lastPoll = 0;
	let polling = false;
	let gotLimit = false;
	const lastConvFetch = {};

	// --------------------------------------------------------------- messaging

	function send(evt) {
		try {
			return chrome.runtime.sendMessage({ type: 'evt', evt }).catch(() => null);
		} catch {
			return Promise.resolve(null); // extension reloaded: context invalidated
		}
	}

	async function getJson(path) {
		const r = await fetch(path, { credentials: 'include' });
		if (!r.ok) throw new Error('HTTP ' + r.status);
		return r.json();
	}

	function cookieOrg() {
		try {
			const row = document.cookie.split('; ').find((r) => r.startsWith('lastActiveOrg='));
			const v = row ? decodeURIComponent(row.split('=')[1]) : null;
			return v && ID_RE.test(v) ? v : null;
		} catch {
			return null;
		}
	}

	const getOrg = () => orgId || cookieOrg();

	async function refreshConversation(id, force) {
		const org = getOrg();
		if (!org || !id) return;
		const now = Date.now();
		if (!force && now - (lastConvFetch[id] || 0) < 4000) return;
		lastConvFetch[id] = now;
		try {
			const conv = await getJson(
				`/api/organizations/${org}/chat_conversations/${id}?tree=true&rendering_mode=messages&render_all_tools=true`
			);
			const ex = C.extractConversation(conv, { includeThinking: S.includeThinking });
			await send({ t: 'conv', provider: 'claude', id, org, ts: Date.now(), name: ex.name, model: ex.model, msgs: ex.msgs });
		} catch {
			/* best effort */
		}
	}

	async function pollUsage() {
		if (polling) return;
		const org = getOrg();
		if (!org) return;
		polling = true;
		lastPoll = Date.now(); // also acts as back-off when the request fails
		try {
			const raw = await getJson(`/api/organizations/${org}/usage`);
			const pick = {};
			for (const k of Object.keys(raw || {})) {
				const v = raw[k];
				if (v && typeof v === 'object' && typeof v.utilization === 'number') {
					pick[k] = { utilization: v.utilization, resets_at: v.resets_at };
				}
			}
			await send({ t: 'poll', org, ts: Date.now(), raw: pick });
		} catch {
			/* best effort */
		} finally {
			polling = false;
		}
	}

	// -------------------------------------------------------- hook -> worker

	document.addEventListener(
		EVT,
		(e) => {
			let d;
			try {
				d = JSON.parse(e.detail);
			} catch {
				return;
			}
			if (!d || typeof d.t !== 'string' || !ID_RE.test(String(d.conv)) || !ID_RE.test(String(d.org))) return;
			orgId = d.org;
			const ts = Date.now();
			if (d.t === 'gen_start') {
				gotLimit = false;
				send({ t: 'gen_start', org: d.org, conv: d.conv, ts });
			} else if (d.t === 'limit') {
				if (!d.ml || JSON.stringify(d.ml).length > 4000) return;
				gotLimit = true;
				send({ t: 'limit', org: d.org, conv: d.conv, ts, early: d.early === true, ml: d.ml });
			} else if (d.t === 'gen_end') {
				send({ t: 'gen_end', org: d.org, conv: d.conv, ts });
				if (d.ok) {
					setTimeout(() => refreshConversation(d.conv, true), 2000);
					// Accounts without SSE limit info still get usage via the endpoint.
					if (!gotLimit) setTimeout(pollUsage, 3000);
				}
			}
		},
		true
	);

	// ------------------------------------------------- chatgpt / gemini (DOM)

	let scanTimer = null;
	let lastSig = null;
	let emptySince = 0;
	let readMiss = false;

	function scan() {
		let conv = null;
		try {
			conv = AD.readConversation(PROV, document, location.pathname, { includeThinking: S.includeThinking });
		} catch {
			conv = null;
		}
		if (!conv) {
			convId = null;
			emptySince = 0;
			readMiss = false;
			return;
		}
		convId = conv.id;
		if (!conv.msgs.length) {
			if (!emptySince) emptySince = Date.now();
			readMiss = Date.now() - emptySince > 8000; // long enough for the page to have rendered its messages
			return;
		}
		emptySince = 0;
		readMiss = false;
		const sig = AD.signature(conv) + '#' + conv.id;
		if (sig === lastSig) return;
		lastSig = sig;
		send({ t: 'conv', provider: PROV, id: conv.id, ts: Date.now(), name: conv.name, model: conv.model, msgs: conv.msgs });
	}

	function scheduleScan(delay) {
		if (scanTimer) return;
		scanTimer = setTimeout(() => {
			scanTimer = null;
			scan();
		}, delay);
	}

	function startScanning() {
		new MutationObserver(() => scheduleScan(1500)).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
		scheduleScan(500);
	}

	// --------------------------------------------------------------- storage

	async function loadAll() {
		try {
			const st = await chrome.storage.local.get(['settings', 'live', 'convs', 'samples']);
			S = { ...C.DEFAULT_SETTINGS, ...(st.settings || {}) };
			live = st.live || null;
			convs = st.convs || {};
			samples = (st.samples || []).slice(-200);
		} catch {
			/* ignore */
		}
	}

	try {
		chrome.storage.onChanged.addListener((ch, area) => {
			if (area !== 'local') return;
			if (ch.settings) S = { ...C.DEFAULT_SETTINGS, ...(ch.settings.newValue || {}) };
			if (ch.live) live = ch.live.newValue || null;
			if (ch.convs) convs = ch.convs.newValue || {};
			if (ch.samples) samples = (ch.samples.newValue || []).slice(-200);
			render();
		});
	} catch {
		/* ignore */
	}

	// -------------------------------------------------------------------- UI
	// Two presentations of the same data, both in one shadow-DOM host so the site's CSS can't touch them:
	//  - inline: a thin strip attached to the message box (claude.ai: inside the box under the model row,
	//    chatgpt / gemini: directly under the box). Click it for the details popover.
	//  - floating: the original corner pill, used when the message box can't be found or by choice.

	const ACCENT = { claude: '#d97757', openai: '#10a37f', gemini: '#6c8cff' };

	const CSS = `
:host{all:initial;display:block}
.wrap{font:12px/1.4 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--fg);position:relative;
 --fg:#1f1e1d;--bg:#faf9f5;--bd:rgba(31,30,29,.18);--mut:#6b6a68;--track:rgba(31,30,29,.12);--ok:#2f9e6b;--warn:#d4912a;--bad:#d1433a;--acc:#d97757;--tick:rgba(31,30,29,.75)}
.wrap.dark{--fg:#f0eee6;--bg:#262624;--bd:rgba(240,238,230,.2);--mut:#a8a69e;--track:rgba(240,238,230,.16);--tick:rgba(255,255,255,.85)}
.floating{position:fixed;z-index:2147483000;display:flex;gap:6px}
.floating.br{bottom:14px;right:14px;flex-direction:column-reverse;align-items:flex-end}
.floating.bl{bottom:14px;left:14px;flex-direction:column-reverse;align-items:flex-start}
.floating.tr{top:14px;right:14px;flex-direction:column;align-items:flex-end}
.floating.tl{top:14px;left:14px;flex-direction:column;align-items:flex-start}
.inline .pill{display:none}
.floating .strip{display:none}

.strip{all:unset;box-sizing:border-box;display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;width:100%;padding:5px 12px 7px;cursor:pointer;
 color:var(--mut);font-variant-numeric:tabular-nums}
.strip:hover .lab b{color:var(--acc)}
.seg{display:flex;align-items:center;gap:8px;min-width:0}
.seg.grow{flex:1 1 150px}
.lab{white-space:nowrap}
.lab b{font-weight:600;color:var(--fg)}
.sbar{position:relative;flex:1 1 60px;min-width:48px;height:6px;border-radius:3px;background:var(--track);overflow:visible}
.sfill{position:absolute;left:0;top:0;bottom:0;width:0;border-radius:3px;background:var(--acc);transition:width .4s}
.sfill.warn{background:var(--warn)}.sfill.bad{background:var(--bad)}
.tick{position:absolute;top:-3px;bottom:-3px;width:2px;margin-left:-1px;border-radius:1px;background:var(--tick);display:none}
.note{color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:46%}

.pill{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:7px;padding:5px 11px;border-radius:999px;background:var(--bg);border:1px solid var(--bd);
 box-shadow:0 2px 10px rgba(0,0,0,.12);cursor:pointer;font-variant-numeric:tabular-nums;white-space:nowrap}
.pill:hover{border-color:var(--acc)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--ok)}
.dot.warn{background:var(--warn)}.dot.bad{background:var(--bad)}

.panel{display:none;box-sizing:border-box;width:292px;max-height:calc(100vh - 16px);overflow:auto;padding:10px 12px 8px;border-radius:12px;background:var(--bg);color:var(--fg);border:1px solid var(--bd);box-shadow:0 8px 28px rgba(0,0,0,.2);
 position:fixed;inset:auto;margin:0;z-index:2147483000}
.open .panel{display:block}
.title{font-weight:600;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center}
.row{margin:7px 0}
.head{display:flex;justify-content:space-between;gap:8px}
.t{color:var(--mut)}.v{font-weight:600;font-variant-numeric:tabular-nums}
.bar{height:6px;border-radius:3px;background:var(--track);margin:3px 0 2px;overflow:hidden}
.fill{height:100%;width:0;background:var(--acc);border-radius:3px;transition:width .4s}
.fill.warn{background:var(--warn)}.fill.bad{background:var(--bad)}
.sub{color:var(--mut);font-size:11px;min-height:14px}
.sep{height:1px;background:var(--bd);margin:8px 0}
.acts{display:flex;gap:6px;margin-top:8px}
.btn{all:unset;box-sizing:border-box;cursor:pointer;padding:3px 9px;border-radius:7px;border:1px solid var(--bd);font-size:11px}
.btn:hover{border-color:var(--acc);color:var(--acc)}
`;

	let host = null;
	let wrap = null;
	let panel = null; // the details popover
	let mode = null; // 'inline' | 'floating' (where the host currently lives)
	const els = { rows: {} };

	function el(tag, cls, text) {
		const n = document.createElement(tag);
		if (cls) n.className = cls;
		if (text != null) n.textContent = text;
		return n;
	}

	function makeRow(title) {
		const root = el('div', 'row');
		const head = el('div', 'head');
		const t = el('span', 't', title);
		const v = el('span', 'v', '-');
		head.append(t, v);
		const bar = el('div', 'bar');
		const fill = el('div', 'fill');
		bar.append(fill);
		const sub = el('div', 'sub');
		root.append(head, bar, sub);
		return { root, t, v, fill, sub };
	}

	function ensureWindowRow(name) {
		if (!els.rows[name]) {
			els.rows[name] = makeRow(C.windowLabel(name));
			els.windows.append(els.rows[name].root);
		}
		return els.rows[name];
	}

	// one "label + bar" group of the strip
	function makeSeg(grow) {
		const root = el('div', 'seg' + (grow ? ' grow' : ''));
		const lab = el('span', 'lab');
		const bar = el('div', 'sbar');
		const fill = el('div', 'sfill');
		const tick = el('div', 'tick');
		bar.append(fill, tick);
		return { root, lab, bar, fill, tick };
	}

	// The details panel is a popover in the browser's top layer, so no stacking context on the page (the message box
	// of claude.ai has one) can paint over it. It is positioned with fixed coordinates next to the strip or pill.
	let tracking = false;
	const isPopoverOpen = () => {
		try {
			return panel.matches(':popover-open');
		} catch {
			return false;
		}
	};

	function positionPanel() {
		const ref = mode === 'floating' ? wrap.querySelector('.pill') : wrap.querySelector('.strip');
		if (!ref) return;
		const r = ref.getBoundingClientRect();
		const w = panel.offsetWidth || 292;
		const h = panel.offsetHeight || 0;
		const vw = document.documentElement.clientWidth;
		const vh = document.documentElement.clientHeight;
		let left = mode === 'floating' && /r$/.test(S.pillCorner || '') ? r.right - w : r.left + 8;
		left = Math.max(8, Math.min(left, vw - w - 8));
		const above = r.top - 4;
		const openUp = above >= h + 8 || above > vh - r.bottom - 4;
		panel.style.left = left + 'px';
		if (openUp) {
			panel.style.top = 'auto';
			panel.style.bottom = Math.max(8, vh - r.top + 4) + 'px';
		} else {
			panel.style.bottom = 'auto';
			panel.style.top = Math.max(8, r.bottom + 4) + 'px';
		}
	}

	function trackPanel() {
		if (tracking) return;
		tracking = true;
		const tick = () => {
			if (!wrap || !wrap.classList.contains('open')) {
				tracking = false;
				return;
			}
			positionPanel(); // follows the strip while the message box grows or the page scrolls
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	}

	function syncPanel() {
		if (!wrap) return;
		const open = wrap.classList.contains('open');
		if (typeof panel.showPopover === 'function') {
			try {
				if (open && !isPopoverOpen()) panel.showPopover();
				else if (!open && isPopoverOpen()) panel.hidePopover();
			} catch {
				/* the panel still shows, just without the top layer */
			}
		}
		if (open) {
			positionPanel();
			trackPanel();
		}
	}

	function setOpen(open) {
		wrap.classList.toggle('open', open);
		try {
			sessionStorage.setItem('clLedgerOpen', open ? '1' : '');
		} catch {
			/* ignore */
		}
		syncPanel();
	}

	function toggleOpen() {
		setOpen(!wrap.classList.contains('open'));
	}

	function closeOpen() {
		if (!wrap || !wrap.classList.contains('open')) return;
		setOpen(false);
	}

	function buildUI() {
		host = document.createElement('div');
		host.id = 'cl-ledger-host';
		const shadow = host.attachShadow({ mode: 'open' });
		try {
			const sheet = new CSSStyleSheet();
			sheet.replaceSync(CSS);
			shadow.adoptedStyleSheets = [sheet];
		} catch {
			const st = document.createElement('style');
			st.textContent = CSS;
			shadow.append(st);
		}
		wrap = el('div', 'wrap');

		// ---- inline strip
		const strip = el('div', 'strip');
		strip.setAttribute('role', 'button');
		strip.tabIndex = 0;
		strip.title = 'Usage Ledger - click for details';
		els.strip = strip;
		if (IS_CLAUDE) {
			// Session: 22.8% · resets in 4h 43m  [bar][bar]  Weekly: 78.5% · resets in 1d 21h
			els.sSession = makeSeg(true);
			els.sWeek = makeSeg(true);
			els.sSession.root.append(els.sSession.lab, els.sSession.bar);
			els.sWeek.root.append(els.sWeek.bar, els.sWeek.lab);
			els.sChat = el('span', 'lab');
			strip.append(els.sSession.root, els.sWeek.root, els.sChat);
		} else {
			// This chat: ~2.9k / 128k  [bar]  tokenizer
			els.sChatSeg = makeSeg(true);
			els.sChatSeg.root.append(els.sChatSeg.lab, els.sChatSeg.bar);
			els.sNote = el('span', 'note');
			strip.append(els.sChatSeg.root, els.sNote);
		}
		strip.addEventListener('click', toggleOpen);
		strip.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				toggleOpen();
			}
		});

		// ---- floating pill
		const pill = el('button', 'pill');
		pill.title = 'Usage Ledger - click for details';
		els.dot = el('span', 'dot');
		els.pillText = el('span', null, IS_CLAUDE ? 'S - · W -' : PV.NAMES[PROV] + ' · -');
		pill.append(els.dot, els.pillText);
		pill.addEventListener('click', toggleOpen);

		// ---- details popover
		panel = el('div', 'panel');
		panel.setAttribute('popover', 'manual'); // top layer; opened and closed by syncPanel()
		const title = el('div', 'title');
		title.append(el('span', null, IS_CLAUDE ? 'Usage Ledger' : `Usage Ledger · ${PV.NAMES[PROV]}`));
		panel.append(title);
		els.windows = el('div');
		els.sep = el('div', 'sep');
		if (IS_CLAUDE) {
			panel.append(els.windows);
			ensureWindowRow('five_hour');
			ensureWindowRow('seven_day');
			panel.append(els.sep);
		}

		els.chat = makeRow('This chat');
		els.chat.t.textContent = 'This chat (est.)';
		els.chatCost = el('div', 'sub');
		els.cache = el('div', 'sub');
		els.chat.root.append(els.chatCost, els.cache);
		panel.append(els.chat.root);

		const acts = el('div', 'acts');
		const dash = el('button', 'btn', 'Dashboard');
		dash.addEventListener('click', () => {
			try {
				chrome.runtime.sendMessage({ type: 'open', tab: IS_CLAUDE ? 'claude' : PROV === 'openai' ? 'chatgpt' : 'gemini' });
			} catch {
				/* ignore */
			}
		});
		els.diag = el('button', 'btn', 'Copy diagnostics');
		els.diag.style.display = 'none';
		els.diag.title = 'Copies the page structure (tags and attribute names, no message text) so the reader can be fixed';
		els.diag.addEventListener('click', async () => {
			let txt = '';
			try {
				txt = AD.diagnose(PROV, document, location.pathname);
				await navigator.clipboard.writeText(txt);
				els.diag.textContent = 'Copied';
			} catch {
				els.diag.textContent = 'Copy failed';
			}
			setTimeout(() => (els.diag.textContent = 'Copy diagnostics'), 2500);
		});
		const refresh = el('button', 'btn', 'Refresh');
		refresh.addEventListener('click', () => {
			if (IS_CLAUDE) {
				pollUsage();
				if (convId) refreshConversation(convId, true);
			} else {
				lastSig = null;
				scan();
			}
		});
		acts.append(dash, refresh, els.diag);
		panel.append(acts);

		wrap.append(strip, pill, panel);
		shadow.append(wrap);
		wrap.style.setProperty('--acc', ACCENT[PROV] || ACCENT.claude);
		// the details panel closes when you click anywhere else on the page, or press Escape
		document.addEventListener('pointerdown', (e) => {
			if (!e.composedPath().includes(host)) closeOpen();
		}, true);
		document.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') closeOpen();
		}, true);
		try {
			if (sessionStorage.getItem('clLedgerOpen')) wrap.classList.add('open'); // shown by syncPanel() once the host is in the page
		} catch {
			/* ignore */
		}
	}

	/** Put the host where it belongs: under the message box if we can find it, otherwise floating in a corner. */
	function place() {
		let anchor = null;
		if (S.uiMode !== 'floating') {
			try {
				anchor = AD.findAnchor(PROV, document);
			} catch {
				anchor = null;
			}
		}
		if (anchor && anchor.el && anchor.el.parentNode) {
			if (mode !== 'inline' || !host.isConnected || anchor.el.nextElementSibling !== host) anchor.el.after(host);
			mode = 'inline';
		} else {
			if (!document.body) return false;
			if (mode !== 'floating' || !host.isConnected) document.body.append(host);
			mode = 'floating';
		}
		wrap.classList.toggle('inline', mode === 'inline');
		wrap.classList.toggle('floating', mode === 'floating');
		syncPanel(); // re-open after the host was moved or restored from the last page
		return true;
	}

	function ensureUI() {
		if (!document.body) return false;
		if (!host) buildUI();
		return place();
	}

	function isDark() {
		const r = document.documentElement;
		const m = r.dataset && r.dataset.mode;
		if (m === 'dark') return true;
		if (m === 'light') return false;
		if (r.classList.contains('dark')) return true;
		if (r.classList.contains('light')) return false;
		const b = document.body;
		if (b && b.classList.contains('dark-theme')) return true; // gemini
		if (b && b.classList.contains('light-theme')) return false;
		return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
	}

	const level = (u) => (u >= 90 ? 'bad' : u >= 70 ? 'warn' : '');

	function setBar(fill, u) {
		fill.style.width = Math.max(0, Math.min(100, u)) + '%';
		fill.className = (fill.classList.contains('sfill') ? 'sfill ' : 'fill ') + level(u);
	}

	function setSeg(seg, labelParts, u, tickFrac) {
		seg.lab.replaceChildren();
		for (const part of labelParts) seg.lab.append(part.b ? el('b', null, part.t) : document.createTextNode(part.t));
		setBar(seg.fill, u);
		if (tickFrac == null) seg.tick.style.display = 'none';
		else {
			seg.tick.style.display = 'block';
			seg.tick.style.left = Math.max(0, Math.min(100, tickFrac * 100)) + '%';
		}
	}

	function paceText(p) {
		if (!p || p.resetInMs == null) return '';
		if (p.u >= 100) return 'Limit reached';
		const early = p.lowConfidence ? ' (early estimate)' : '';
		if (p.willHit) return `At this pace: limit in ~${C.fmtDur(p.etaMs)}, before reset${early}`;
		if (p.projectedAtReset >= 1) return `On pace for ~${Math.round(p.projectedAtReset)}% by reset${early}`;
		return '';
	}

	function render() {
		if (!S.showPill) {
			if (host) host.style.display = 'none';
			return;
		}
		if (!ensureUI()) return;
		host.style.display = '';
		const now = Date.now();
		wrap.className = 'wrap ' + mode + ' ' + S.pillCorner + (wrap.classList.contains('open') ? ' open' : '') + (isDark() ? ' dark' : '');
		wrap.style.setProperty('--acc', ACCENT[PROV] || ACCENT.claude);

		if (IS_CLAUDE) {
			const wins = C.currentWindows(live && live.windows, now);
			const five = wins.five_hour;
			const seven = wins.seven_day;
			els.pillText.textContent = `S ${five ? C.fmtPct(five.u) : '-'} · W ${seven ? C.fmtPct(seven.u) : '-'}`;
			const worst = Math.max(five ? five.u : 0, seven ? seven.u : 0);
			els.dot.className = 'dot ' + level(worst);

			const segFor = (seg, name, label, w) => {
				if (!w) {
					setSeg(seg, [{ t: label + ': ' }, { t: '-', b: true }], 0, null);
					return;
				}
				const hours = C.windowHours(name);
				const frac = w.reset != null && hours ? 1 - (w.reset - now) / (hours * 3600e3) : null;
				const parts = [{ t: label + ': ' }, { t: C.fmtPct(w.u), b: true }];
				if (w.reset != null) parts.push({ t: ' · resets in ' + C.fmtDur(w.reset - now) });
				setSeg(seg, parts, w.u, frac);
			};
			segFor(els.sSession, 'five_hour', 'Session', five);
			segFor(els.sWeek, 'seven_day', 'Weekly', seven);

			for (const name of C.orderedNames(wins)) ensureWindowRow(name);
			for (const name of Object.keys(els.rows)) {
				const row = els.rows[name];
				const w = wins[name];
				if (!w) {
					row.v.textContent = '-';
					row.sub.textContent = 'No data yet - send a message';
					setBar(row.fill, 0);
					continue;
				}
				row.v.textContent = C.fmtPct(w.u);
				setBar(row.fill, w.u);
				const hours = C.windowHours(name);
				const p = hours ? C.pace(w, hours, now, C.recentFor(samples, name, w, now)) : null;
				const reset = w.reset != null ? `resets in ${C.fmtDur(w.reset - now)}` : w.stale ? 'window reset - refreshing' : '';
				const extra = paceText(p);
				row.sub.textContent = [reset, extra].filter(Boolean).join(' · ');
			}
		}

		if (els.diag) els.diag.style.display = !IS_CLAUDE && readMiss ? '' : 'none';
		const c = convId ? convs[convId] : null;
		const limit = IS_CLAUDE ? S.contextLimit : PROV === 'openai' ? S.contextLimitOpenAI : S.contextLimitGemini;
		if (c && c.tokens && (c.provider || 'claude') === PROV) {
			const tk = c.tokenizer || null;
			// The calibration factor only makes sense for the o200k stand-in used for Claude, never for exact counts.
			const scaled = IS_CLAUDE && tk && tk.id === 'claude:o200k-proxy' ? S.calibration : 1;
			const est = c.tokens * scaled;
			const pct = (est / limit) * 100;
			const approx = !tk || !tk.exact || c.approx;
			els.chat.t.textContent = approx ? 'This chat (est.)' : 'This chat';
			const tokText = `${approx ? '~' : ''}${C.fmtTokens(est)}`;
			els.chat.v.textContent = `${tokText} / ${C.fmtTokens(limit)}`;
			if (!IS_CLAUDE) els.pillText.textContent = `${PV.NAMES[PROV]} · ${tokText}`;
			setBar(els.chat.fill, pct);
			const how = c.approx ? 'chars/3.7 fallback (tokenizer failed to load)' : tk ? tk.label : 'counting';
			els.chat.sub.textContent = `${how}${approx && !c.approx && !/estimate|approx|assumed/.test(how) ? ' · estimate' : ''} · excludes system prompt & files`;
			if (IS_CLAUDE) {
				els.sChat.replaceChildren(document.createTextNode('Chat: '), el('b', null, tokText));
				const s5 = (c.spent && c.spent.five_hour) || 0;
				const s7 = (c.spent && c.spent.seven_day) || 0;
				els.chatCost.textContent = c.gens ? `Tracked here: ${C.fmtPct(s5, 1)} of session · ${C.fmtPct(s7, 1)} of week · ${c.gens} msg` : '';
				if (c.lastAssistantTs) {
					const left = c.lastAssistantTs + S.cacheMinutes * 60e3 - now;
					els.cache.textContent = left > 0 ? `Prompt cache ≈ ${C.fmtClock(left)} left (assumed ${S.cacheMinutes} min)` : 'Prompt cache likely expired';
				} else els.cache.textContent = '';
			} else {
				setSeg(els.sChatSeg, [{ t: 'This chat: ' }, { t: `${tokText} / ${C.fmtTokens(limit)}`, b: true }], pct, null);
				els.sNote.textContent = c.approx ? 'fallback estimate' : tk ? tk.label : '';
				els.sNote.title = els.sNote.textContent;
				els.chatCost.textContent = `${c.msgs} messages${c.model ? ' · ' + c.model : ''}`;
				els.cache.textContent = 'This site does not expose a usage quota to read.';
			}
		} else {
			els.chat.v.textContent = convId ? '...' : '-';
			setBar(els.chat.fill, 0);
			const msg = !convId
				? 'Open a chat to see its size'
				: readMiss
					? "Couldn't read this chat's messages - the site layout may have changed"
					: 'Counting...';
			els.chat.sub.textContent = msg;
			els.chatCost.textContent = '';
			els.cache.textContent = '';
			if (IS_CLAUDE) els.sChat.textContent = '';
			else {
				els.pillText.textContent = `${PV.NAMES[PROV]} · -`;
				setSeg(els.sChatSeg, [{ t: 'This chat: ' }, { t: convId ? '…' : '-', b: true }], 0, null);
				els.sNote.textContent = convId && readMiss ? "couldn't read this chat" : convId ? 'counting…' : 'open a chat';
				els.sNote.title = msg;
			}
		}
	}

	// ------------------------------------------------------------------ loop

	let lastPath = null;
	function onNav() {
		if (!IS_CLAUDE) {
			lastSig = null;
			emptySince = 0;
			scheduleScan(800);
			return;
		}
		const m = /\/chat\/([A-Za-z0-9_-]{8,64})/.exec(location.pathname);
		convId = m ? m[1] : null;
		if (convId) refreshConversation(convId, false);
		if (Date.now() - lastPoll >= 60e3) pollUsage();
	}

	function tick() {
		if (location.pathname !== lastPath) {
			lastPath = location.pathname;
			onNav();
		}
		const now = Date.now();
		if (!document.hidden) {
			if (!IS_CLAUDE) {
				scheduleScan(0);
				render();
				return;
			}
			if (now - lastPoll >= S.pollMinutes * 60e3) pollUsage();
			// A window just rolled over: fetch the fresh numbers.
			const ws = live && live.windows;
			if (ws) {
				for (const name of Object.keys(ws)) {
					const r = ws[name] && ws[name].reset;
					if (r && r <= now && lastPoll < r) {
						pollUsage();
						break;
					}
				}
			}
			render();
		}
	}

	loadAll().then(() => {
		if (!IS_CLAUDE) startScanning();
		setInterval(tick, 1000);
		tick();
	});
})();
