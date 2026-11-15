/*
 * Usage Ledger - pure logic shared by the content script, the service
 * worker and the dashboard. No DOM, no chrome.* calls, so it is unit-testable
 * in Node.
 */
(function (root, factory) {
	const api = factory();
	if (typeof module === 'object' && module.exports) module.exports = api;
	else root.LedgerCore = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
	'use strict';

	const HOUR = 3600e3;
	const ROOT_MESSAGE_ID = '00000000-0000-4000-8000-000000000000';

	const DEFAULT_SETTINGS = Object.freeze({
		contextLimit: 200000, // tokens; bar scale for the "this chat" meter
		calibration: 1, // multiply the o200k estimate for Claude chats (Claude's tokenizer differs)
		contextLimitOpenAI: 128000, // bar scale for ChatGPT chats (varies by plan / model)
		contextLimitGemini: 1000000, // bar scale for Gemini chats
		claudeCounting: 'estimate', // 'estimate' (offline o200k proxy) | 'api' (exact, uses your Anthropic API key)
		cacheMinutes: 5, // assumed prompt-cache lifetime
		pollMinutes: 10, // how often to poll /usage while a claude.ai tab is visible
		includeThinking: false,
		showPill: true,
		uiMode: 'inline', // 'inline' (attached to the message box) | 'floating' (corner pill)
		pillCorner: 'br', // br | bl | tr | tl
		attributionLag: 'auto' // 'auto' | 0 (sample includes the message just sent) | 1 (sample is from before it)
	});

	// ---------------------------------------------------------------- windows

	const ALIASES = { '5h': 'five_hour', '7d': 'seven_day' };

	function windowKey(k) {
		const s = String(k);
		return ALIASES[s] || s.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
	}

	function windowHours(name) {
		if (name === 'five_hour') return 5;
		if (/^seven_day/.test(name)) return 168;
		return null;
	}

	const LABELS = {
		five_hour: 'Session (5h)',
		seven_day: 'Weekly (7d)',
		seven_day_opus: 'Weekly - Opus',
		seven_day_sonnet: 'Weekly - Sonnet'
	};

	function windowLabel(name) {
		return LABELS[name] || name.replace(/_/g, ' ');
	}

	function orderedNames(obj) {
		const names = Object.keys(obj || {});
		const rank = (n) => (n === 'five_hour' ? 0 : n === 'seven_day' ? 1 : 2);
		return names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
	}

	function toMs(v) {
		if (typeof v === 'number' && Number.isFinite(v)) return v > 1e11 ? v : v * 1000;
		if (typeof v === 'string') {
			const t = Date.parse(v);
			return Number.isFinite(t) ? t : null;
		}
		return null;
	}

	const clampPct = (u) => Math.max(0, Math.min(100, u));

	// /usage endpoint: { five_hour: {utilization: 0-100, resets_at: ISO}, seven_day: {...}, ... }
	// Generic: any key whose value has a numeric `utilization` is treated as a window.
	function normalizeUsageEndpoint(raw) {
		const out = {};
		if (!raw || typeof raw !== 'object') return out;
		for (const k of Object.keys(raw)) {
			const v = raw[k];
			if (!v || typeof v !== 'object') continue;
			if (typeof v.utilization !== 'number' || !Number.isFinite(v.utilization)) continue;
			out[windowKey(k)] = { u: clampPct(v.utilization), reset: toMs(v.resets_at) };
		}
		return out;
	}

	// SSE message_limit: { windows: { '5h': {utilization: 0-1, resets_at: epoch s}, '7d': {...} } }
	function normalizeMessageLimit(ml) {
		const out = {};
		const wins = ml && typeof ml === 'object' ? ml.windows : null;
		if (!wins || typeof wins !== 'object') return out;
		for (const k of Object.keys(wins)) {
			const v = wins[k];
			if (!v || typeof v !== 'object') continue;
			if (typeof v.utilization !== 'number' || !Number.isFinite(v.utilization)) continue;
			const u = v.utilization > 1.5 ? v.utilization : v.utilization * 100; // fraction, tolerate percent
			out[windowKey(k)] = { u: clampPct(u), reset: toMs(v.resets_at) };
		}
		return out;
	}

	function sameInstance(a, b) {
		if (!a || !b) return false;
		if (a.reset != null && b.reset != null) return Math.abs(a.reset - b.reset) <= 120000;
		return a.reset == b.reset; // both null
	}

	/**
	 * Percentage-point change per window between two snapshots.
	 *  - same window instance: next.u - prev.u (never negative)
	 *  - window rolled over since prev: next.u (it started again from 0)
	 *  - unknown (no prev, or can't tell): null (becomes the new baseline, nothing attributed)
	 */
	function computeDeltas(prev, next, now) {
		const delta = {};
		for (const name of Object.keys(next || {})) {
			const n = next[name];
			const p = prev ? prev[name] : null;
			if (!p) {
				delta[name] = null;
			} else if (sameInstance(p, n)) {
				delta[name] = Math.max(0, n.u - p.u);
			} else if (p.reset != null && p.reset <= now + 60000) {
				delta[name] = n.u;
			} else {
				delta[name] = null;
			}
		}
		return delta;
	}

	// Treat a stored window whose reset time has passed as "0%, awaiting refresh".
	function currentWindows(winMap, now) {
		const out = {};
		if (!winMap) return out;
		for (const k of Object.keys(winMap)) {
			const w = winMap[k];
			if (!w) continue;
			if (w.reset != null && w.reset <= now) out[k] = { u: 0, reset: null, stale: true };
			else out[k] = { u: w.u, reset: w.reset, stale: false };
		}
		return out;
	}

	// samples: [{ts, w:{name:[u, reset]}}] -> [[ts,u]] for the current instance of one window
	function recentFor(samples, name, win, now, spanMs) {
		const out = [];
		if (!samples || !win) return out;
		const since = now - (spanMs || 30 * 60e3);
		for (let i = samples.length - 1; i >= 0; i--) {
			const s = samples[i];
			if (s.ts < since) break;
			const e = s.w && s.w[name];
			if (!e) continue;
			if (!sameInstance({ reset: e[1] }, win)) continue;
			out.push([s.ts, e[0]]);
		}
		return out.reverse();
	}

	/** Burn-rate projection for one window. Rates are percentage points per hour. */
	function pace(w, hours, now, recent) {
		if (!w || !hours) return null;
		const out = { u: w.u, remaining: Math.max(0, 100 - w.u) };
		if (w.reset == null) return out;
		out.resetInMs = Math.max(0, w.reset - now);
		const start = w.reset - hours * HOUR;
		const sinceStart = now - start;
		const elapsed = Math.max(sinceStart, 10 * 60e3);
		out.avgRate = w.u / (elapsed / HOUR);
		out.projectedAtReset = out.avgRate * hours;
		out.lowConfidence = sinceStart < 20 * 60e3;
		if (recent && recent.length >= 2) {
			const a = recent[0];
			const b = recent[recent.length - 1];
			const dt = b[0] - a[0];
			if (dt >= 5 * 60e3) out.recentRate = Math.max(0, (b[1] - a[1]) / (dt / HOUR));
		}
		const rate = out.recentRate > 0 ? out.recentRate : out.avgRate;
		out.rate = rate;
		if (w.u >= 100) {
			out.etaMs = 0;
			out.willHit = true;
		} else if (rate > 0) {
			out.etaMs = ((100 - w.u) / rate) * HOUR;
			out.willHit = out.etaMs < out.resetInMs;
		} else {
			out.etaMs = null;
			out.willHit = false;
		}
		return out;
	}

	// ----------------------------------------------------------- conversation

	function safeJson(v) {
		try {
			return JSON.stringify(v);
		} catch {
			return '';
		}
	}

	function buildTrunk(conv) {
		const msgs = Array.isArray(conv && conv.chat_messages) ? conv.chat_messages : [];
		const byId = new Map();
		for (const m of msgs) if (m && m.uuid) byId.set(m.uuid, m);
		let cur = conv && conv.current_leaf_message_uuid;
		const trunk = [];
		const seen = new Set();
		while (cur && cur !== ROOT_MESSAGE_ID && !seen.has(cur)) {
			seen.add(cur);
			const m = byId.get(cur);
			if (!m) break;
			trunk.push(m);
			cur = m.parent_message_uuid;
		}
		return trunk.reverse();
	}

	function itemText(item, opts) {
		if (!item || typeof item !== 'object' || typeof item.type !== 'string') return '';
		const t = item.type;
		if (t === 'thinking' || t === 'redacted_thinking') {
			return opts && opts.includeThinking ? String(item.thinking || item.text || '') : '';
		}
		if (t === 'image' || t === 'document') return '';
		if (t === 'text') return typeof item.text === 'string' ? item.text : '';
		if (t === 'tool_use') return safeJson({ id: item.id, name: item.name, input: item.input });
		if (t === 'tool_result') {
			return safeJson({ tool_use_id: item.tool_use_id, is_error: item.is_error, content: item.content });
		}
		const m = {};
		if (typeof item.text === 'string') m.text = item.text;
		if (typeof item.title === 'string') m.title = item.title;
		if (typeof item.url === 'string') m.url = item.url;
		if (typeof item.content === 'string' || Array.isArray(item.content)) m.content = item.content;
		return Object.keys(m).length ? safeJson(m) : '';
	}

	function messageText(msg, opts) {
		const parts = [];
		const content = Array.isArray(msg && msg.content) ? msg.content : [];
		for (const it of content) {
			const s = itemText(it, opts);
			if (s) parts.push(s);
		}
		const atts = Array.isArray(msg && msg.attachments) ? msg.attachments : [];
		for (const a of atts) {
			if (a && typeof a.extracted_content === 'string' && a.extracted_content) parts.push(a.extracted_content);
		}
		return parts.join('\n');
	}

	/** Trim a raw conversation payload down to what the worker needs to count tokens. */
	function extractConversation(conv, opts) {
		const trunk = buildTrunk(conv);
		return {
			id: conv && typeof conv.uuid === 'string' ? conv.uuid : null,
			name: conv && typeof conv.name === 'string' ? conv.name : '',
			model: conv && typeof conv.model === 'string' ? conv.model : null,
			msgs: trunk.map((m) => ({
				id: String(m.uuid),
				role: m.sender,
				ts: Date.parse(m.created_at) || null,
				text: messageText(m, opts)
			}))
		};
	}

	// FNV-1a over UTF-16 code units + length: cheap cache key for "has this message text changed?"
	function hash(str) {
		let h = 0x811c9dc5;
		for (let i = 0; i < str.length; i++) {
			h ^= str.charCodeAt(i);
			h = Math.imul(h, 0x01000193);
		}
		return (h >>> 0).toString(36) + ':' + str.length;
	}

	// ------------------------------------------------------------- formatting

	const BUCKETS = [
		{ label: '< 10k', max: 10000 },
		{ label: '10-50k', max: 50000 },
		{ label: '50-100k', max: 100000 },
		{ label: '100k+', max: Infinity }
	];

	function bucketIndex(tokens) {
		for (let i = 0; i < BUCKETS.length; i++) if (tokens < BUCKETS[i].max) return i;
		return BUCKETS.length - 1;
	}

	function dayKey(ts) {
		const d = new Date(ts);
		const p = (n) => String(n).padStart(2, '0');
		return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
	}

	function fmtDur(ms) {
		if (ms == null || !Number.isFinite(ms)) return '-';
		const s = Math.max(0, Math.round(ms / 1000));
		const d = Math.floor(s / 86400);
		const h = Math.floor((s % 86400) / 3600);
		const m = Math.floor((s % 3600) / 60);
		if (d > 0) return d + 'd ' + h + 'h';
		if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'm';
		if (m > 0) return m + 'm';
		return s + 's';
	}

	function fmtClock(ms) {
		const s = Math.max(0, Math.floor(ms / 1000));
		return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
	}

	function fmtTokens(n) {
		if (!Number.isFinite(n)) return '-';
		if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
		if (n >= 1e4) return Math.round(n / 1e3) + 'k';
		if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
		return String(Math.round(n));
	}

	function fmtPct(u, digits) {
		if (!Number.isFinite(u)) return '-';
		const d = digits == null ? (u < 10 ? 1 : 0) : digits;
		return u.toFixed(d) + '%';
	}

	function csvCell(v) {
		const s = v == null ? '' : String(v);
		return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
	}

	function toCSV(cols, rows) {
		return [cols.join(',')].concat(rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))).join('\n');
	}

	return {
		HOUR,
		DEFAULT_SETTINGS,
		BUCKETS,
		windowKey,
		windowHours,
		windowLabel,
		orderedNames,
		normalizeUsageEndpoint,
		normalizeMessageLimit,
		sameInstance,
		computeDeltas,
		currentWindows,
		recentFor,
		pace,
		buildTrunk,
		messageText,
		extractConversation,
		hash,
		bucketIndex,
		dayKey,
		fmtDur,
		fmtClock,
		fmtTokens,
		fmtPct,
		toCSV
	};
});
