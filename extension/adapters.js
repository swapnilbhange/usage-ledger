/*
 * DOM readers for chatgpt.com and gemini.google.com (claude.ai uses its own JSON API instead).
 * They only READ the page. Selectors are best-effort: both sites change their markup without notice,
 * so every lookup has fallbacks and a miss is reported ("couldn't read this chat") instead of guessed.
 */
(function (root, factory) {
	const api = factory();
	if (typeof module === 'object' && module.exports) module.exports = api;
	else root.LedgerAdapters = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
	'use strict';

	const MAX_TEXT = 400000; // chars per message; protects the message channel
	const ID = '([A-Za-z0-9_-]{8,64})';

	function clean(s) {
		return String(s || '').replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').trim().slice(0, MAX_TEXT);
	}

	function textOf(node, dropSelectors) {
		if (!node) return '';
		if (!dropSelectors) return clean(node.innerText != null ? node.innerText : node.textContent);
		const c = node.cloneNode(true);
		for (const sel of dropSelectors) for (const x of c.querySelectorAll(sel)) x.remove();
		// A detached clone has no layout, so mark block boundaries ourselves (textContent would glue paragraphs together).
		for (const x of c.querySelectorAll('p,li,h1,h2,h3,h4,h5,h6,pre,tr,blockquote,br')) x.after('\n');
		return clean(c.textContent.replace(/\n{3,}/g, '\n\n'));
	}

	function firstText(doc, selectors) {
		for (const sel of selectors) {
			const n = doc.querySelector(sel);
			const t = n && clean(n.textContent);
			if (t) return t;
		}
		return null;
	}

	// ------------------------------------------------------------------ ChatGPT

	const chatgpt = {
		convId(pathname) {
			const m = new RegExp('/c/' + ID).exec(pathname);
			return m ? m[1] : null;
		},
		model(doc) {
			// Older layout: assistant messages carry the slug of the model that wrote them; the picker label is the fallback.
			const nodes = doc.querySelectorAll('[data-message-model-slug]');
			if (nodes.length) return nodes[nodes.length - 1].getAttribute('data-message-model-slug');
			const picked = firstText(doc, ['[data-testid="model-switcher-dropdown-button"]', 'button[aria-label^="Model selector"]']);
			if (picked) return picked;
			// Newer layout exposes no model slug. Use a menu button only if its label looks like a model name;
			// otherwise return null (the worker then assumes o200k_base, which every current ChatGPT model uses).
			for (const b of doc.querySelectorAll('button[aria-haspopup="menu"], [role="combobox"]')) {
				const t = clean(b.textContent);
				if (t.length < 30 && /^(chat)?gpt[-\s]?[\w.\- ]*$|^o[134](-[\w]+)?$/i.test(t)) return t;
			}
			return null;
		},
		read(doc, opts) {
			if (doc.querySelector('[data-message-author-role]')) return this.readLegacy(doc);
			return this.readUnits(doc);
		},
		// Current layout: every message is a unit tagged data-chatgpt-search-unit-key="<turn>:<n>:<user|assistant>".
		readUnits(doc) {
			const out = [];
			const seen = new Set();
			for (const n of doc.querySelectorAll('[data-chatgpt-search-unit-key]')) {
				const key = n.getAttribute('data-chatgpt-search-unit-key') || '';
				const kind = key.slice(key.lastIndexOf(':') + 1);
				if (kind !== 'user' && kind !== 'assistant') continue; // thinking / tool units
				const rb = n.querySelector('[data-response-body]');
				const ids = (n.getAttribute('data-chatgpt-search-message-ids') || '').split(/[\s,]+/).filter(Boolean);
				const id = String((rb && rb.getAttribute('data-response-body')) || ids[0] || key).slice(0, 80);
				if (seen.has(id + kind)) continue;
				seen.add(id + kind);
				const body = kind === 'assistant' ? rb || n : n.querySelector('[data-user-message-bubble]') || n;
				out.push({ id: id + ':' + kind, role: kind === 'assistant' ? 'assistant' : 'human', ts: null, text: textOf(body, ['.sr-only', 'button']), model: null });
			}
			return out;
		},
		readLegacy(doc) {
			const out = [];
			const nodes = doc.querySelectorAll('[data-message-author-role]');
			let i = 0;
			for (const n of nodes) {
				const role = n.getAttribute('data-message-author-role');
				if (role !== 'user' && role !== 'assistant') continue; // system / tool rows
				const body = n.querySelector('.markdown, .whitespace-pre-wrap') || n;
				const id = n.getAttribute('data-message-id') || 'm' + i;
				out.push({
					id: String(id).slice(0, 80),
					role: role === 'assistant' ? 'assistant' : 'human',
					ts: null,
					text: textOf(body),
					model: role === 'assistant' ? n.getAttribute('data-message-model-slug') || null : null
				});
				i++;
			}
			return out;
		},
		title(doc) {
			const t = clean(doc.title).replace(/\s*[|-]\s*ChatGPT\s*$/i, '');
			return t && !/^ChatGPT$/i.test(t) ? t.slice(0, 200) : '';
		}
	};

	// ------------------------------------------------------------------- Gemini

	const gemini = {
		convId(pathname) {
			const m = new RegExp('/app/' + ID).exec(pathname) || new RegExp('/gem/[^/]+/' + ID).exec(pathname);
			return m ? m[1] : null;
		},
		model(doc) {
			return firstText(doc, [
				'[data-test-id="bard-mode-menu-button"]',
				'bard-mode-switcher button',
				'[data-test-id="logo-pill-label-container"]',
				'button[aria-label*="mode picker" i]'
			]);
		},
		read(doc, opts) {
			const out = [];
			const includeThinking = !!(opts && opts.includeThinking);
			const nodes = doc.querySelectorAll('user-query, model-response');
			let u = 0;
			let a = 0;
			for (const n of nodes) {
				const isUser = n.tagName.toLowerCase() === 'user-query';
				let text;
				if (isUser) {
					text = textOf(n.querySelector('.query-text') || n, ['.cdk-visually-hidden']);
				} else {
					// With thinking included the whole response is read; otherwise only the answer body.
					const body = (!includeThinking && n.querySelector('.model-response-text, message-content .markdown, message-content')) || n;
					const drop = ['.cdk-visually-hidden', 'button', 'mat-icon'];
					if (!includeThinking) drop.push('model-thoughts', '.thoughts-container', '[data-test-id="thoughts-content"]');
					text = textOf(body, drop);
				}
				out.push({ id: (isUser ? 'u' : 'a') + (isUser ? u++ : a++), role: isUser ? 'human' : 'assistant', ts: null, text, model: null });
			}
			return out;
		},
		title(doc) {
			const t = clean(doc.title).replace(/^\s*(Google\s+)?Gemini\s*[-–—|:]?\s*/i, '').replace(/\s*[-–—|]\s*(Google\s+)?Gemini\s*$/i, '');
			return t && !/^(Google\s+)?Gemini$/i.test(t) ? t.slice(0, 200) : '';
		}
	};


	// ------------------------------------------------------- composer anchors
	// Where to put the inline usage strip. Returns {el, where:'after'|'append', kind} or null (=> floating pill).

	const isShown = (el) => {
		if (!el || !el.isConnected) return false;
		try {
			const st = el.ownerDocument.defaultView.getComputedStyle(el);
			if (st.display === 'none' || st.visibility === 'hidden') return false;
		} catch {
			/* ignore */
		}
		return !el.closest('[hidden]');
	};

	function toolbarRowOf(win, start, stopAt) {
		// the horizontal row of buttons that the model picker sits in (same idea as claude-counter)
		for (let cur = start.parentElement; cur && cur !== stopAt && cur.tagName !== 'BODY'; cur = cur.parentElement) {
			let st = null;
			try {
				st = win.getComputedStyle(cur);
			} catch {
				/* ignore */
			}
			if (st && st.display === 'flex' && st.flexDirection === 'row' && cur.querySelectorAll('button').length > 1) return cur;
		}
		return null;
	}

	function radiusPx(win, el) {
		try {
			return parseFloat(win.getComputedStyle(el).borderTopLeftRadius) || 0;
		} catch {
			return 0;
		}
	}

	/** Parts of the page that hold the conversation, never the message box. */
	const IN_THREAD = [
		'[data-testid="chatgpt-writing-block"]',
		'[data-message-author-role]',
		'[data-user-message-bubble]',
		'[data-thread-user-message-navigation-content]',
		'[data-turn-key]',
		'[data-testid^="conversation-turn"]',
		'article',
		'user-query',
		'model-response'
	].join(',');

	const EDITABLE = [
		'#prompt-textarea',
		'[data-testid="composer-text-input"]',
		'rich-textarea .ql-editor',
		'rich-textarea [contenteditable="true"]',
		'div.ProseMirror[contenteditable="true"]',
		'[contenteditable="true"][role="textbox"]',
		'form textarea',
		'textarea'
	];

	function findAnchor(provider, doc) {
		const win = doc.defaultView || globalThis;
		if (provider === 'claude') {
			const sel = doc.querySelector('[data-testid="model-selector-dropdown"]');
			if (!sel) return null;
			const area = sel.closest('[data-testid="chat-input-grid-area"]') || sel.closest('[data-testid="chat-input-grid-container"]');
			const row = toolbarRowOf(win, sel, area) || toolbarRowOf(win, sel, null) || (sel.parentElement && sel.parentElement.parentElement && sel.parentElement.parentElement.parentElement);
			return row ? { el: row, where: 'after', kind: 'claude-toolbar' } : null;
		}
		let ed = null;
		for (const q of EDITABLE) {
			for (const c of doc.querySelectorAll(q)) {
				// editors inside the conversation itself (ChatGPT's email "writing block", canvas, editable code in a reply) are not the message box
				if (isShown(c) && !c.closest(IN_THREAD)) {
					ed = c;
					break;
				}
			}
			if (ed) break;
		}
		if (!ed) return null;
		// the composer "card": the form, a known custom element, or the nearest clearly rounded ancestor
		let card = ed.closest('form, input-area-v2, input-container, [data-testid*="composer" i]');
		if (!card) {
			let cur = ed.parentElement;
			for (let i = 0; i < 8 && cur && cur.tagName !== 'BODY'; i++, cur = cur.parentElement) {
				if (radiusPx(win, cur) >= 12) {
					card = cur;
					break;
				}
			}
		}
		if (!card && ed.parentElement) card = ed.parentElement.parentElement || ed.parentElement;
		return card && card.tagName !== 'BODY' ? { el: card, where: 'after', kind: 'composer-card' } : null;
	}

	const KNOWN = {
		openai: ['[data-message-author-role]', '[data-chatgpt-search-unit-key]', '[data-response-body]', '[data-user-message-bubble]', '[data-message-model-slug]'],
		gemini: ['user-query', 'model-response', '.query-text', '.model-response-text', 'model-thoughts']
	};

	/** Structure-only outline of the page (tags, data-* attributes, text lengths - never the text) for bug reports. */
	function diagnose(provider, doc, pathname) {
		const lines = ['provider=' + provider, 'path=' + String(pathname).replace(/[A-Za-z0-9_-]{8,}/g, 'ID'), 'title.length=' + clean(doc.title).length];
		let anchor = null;
		try {
			anchor = findAnchor(provider, doc);
		} catch {
			/* ignore */
		}
		lines.push('composer anchor -> ' + (anchor ? anchor.kind + ' <' + anchor.el.tagName.toLowerCase() + '>' : 'none (floating pill is used)'));
		for (const sel of KNOWN[provider] || []) {
			let n = 0;
			try {
				n = doc.querySelectorAll(sel).length;
			} catch {
				/* ignore */
			}
			lines.push(sel + ' -> ' + n);
		}
		const root = doc.querySelector('[role="region"][aria-label="Conversation"], [data-thread-user-message-navigation-content], main') || doc.body;
		const attrsOf = (el) => [...el.attributes].filter((a) => /^(data-|role|aria-label)/.test(a.name)).map((a) => a.name + '=' + a.value.slice(0, 24).replace(/[0-9a-f]{8}-[0-9a-f-]{20,}/g, 'UUID')).join(' ');
		const len = (el) => clean(el.textContent).length;
		const kids = (el) => [...el.children].filter((c) => len(c) >= 5);
		const walk = (el, d) => {
			if (d > 12 || lines.length > 160) return;
			let node = el;
			let skipped = 0;
			while (kids(node).length === 1 && !attrsOf(node) && skipped < 40) {
				node = kids(node)[0];
				skipped++;
			}
			const ks = kids(node);
			lines.push('  '.repeat(d) + node.tagName.toLowerCase() + ' [' + len(node) + ']' + (skipped ? ' (+' + skipped + ')' : '') + (attrsOf(node) ? ' ' + attrsOf(node) : '') + ' kids=' + ks.length);
			for (const c of ks.slice(0, 4)) walk(c, d + 1);
		};
		if (root) walk(root, 0);
		return lines.join('\n');
	}

	const BY_PROVIDER = { openai: chatgpt, gemini };

	/** @returns {{id,name,model,msgs}|null}  null = not on a conversation page */
	function readConversation(provider, doc, pathname, opts) {
		const a = BY_PROVIDER[provider];
		if (!a) return null;
		const id = a.convId(pathname);
		if (!id) return null;
		return { id, name: a.title(doc), model: a.model(doc), msgs: a.read(doc, opts) };
	}

	/** Cheap change detector so we only message the worker when the chat actually changed. */
	function signature(conv) {
		let h = conv.msgs.length + '|' + (conv.model || '');
		for (const m of conv.msgs) h += '|' + m.id + ':' + m.text.length + ':' + (m.model || '');
		const last = conv.msgs[conv.msgs.length - 1];
		if (last) h += ':' + last.text.slice(-32);
		return h;
	}

	return { readConversation, signature, diagnose, findAnchor, chatgpt, gemini };
});
