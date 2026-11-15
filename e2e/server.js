'use strict';
// Minimal mock of the claude.ai surface the extension touches. Strict CSP + Trusted Types
// to mimic a hardened page.
const https = require('https');
const fs = require('fs');
const path = require('path');

const ORG = '11111111-aaaa-bbbb-cccc-222222222222';
const CONV = 'cccccccc-1111-4222-8333-444444444444';
const CONV_B = 'eeeeeeee-1111-4222-8333-444444444444';

function start(port = 8443) {
	const startedAt = Date.now();
	const R5 = Math.floor((startedAt + 3 * 3600e3) / 1000);
	const R7 = Math.floor((startedAt + 3 * 24 * 3600e3) / 1000);
	const state = { sends: { [CONV]: 0, [CONV_B]: 0 }, total: 0, log: [] };
	const u5 = () => 0.1 + 0.03 * state.total;
	const u7 = () => 0.04 + 0.005 * state.total;
	const para = (n) => ('The quick brown fox jumps over the lazy dog. ').repeat(n);

	const html = (conv) => `<!doctype html><html data-mode="dark"><head><meta charset="utf-8"><title>mock claude</title></head><body>
<h1>Mock claude.ai</h1><button id="send">send</button><div id="out"></div>
<script>
(() => {
  document.body.style.background = '#262624'; document.body.style.color = '#e8e6df'; document.body.style.fontFamily = 'system-ui, sans-serif';
  const mk = (tag, attrs, text) => { const e = document.createElement(tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; return e; };
  const area = mk('div', {'data-testid':'chat-input-grid-area','id':'mock-composer'});
  // like the live page: the box is its own stacking context (z-index) and the toolbar row sits below it
  area.style.cssText = 'max-width:680px;margin:24px auto 0;border:1px solid #4a4944;border-radius:18px;padding:14px 16px;background:#30302e;position:relative;z-index:5';
  const ed = mk('div', {contenteditable:'true', role:'textbox'}, 'Reply to Claude'); ed.style.minHeight = '40px';
  const row = mk('div', {id:'mock-toolbar'}); row.style.cssText = 'display:flex;flex-direction:row;gap:8px;max-width:680px;margin:0 auto;padding:6px 16px';
  const wrap = mk('div'); wrap.append(mk('button', {'data-testid':'model-selector-dropdown'}, 'Sonnet 4.5'));
  row.append(mk('button', {}, '+'), wrap, mk('button', {}, 'Send'));
  const col = mk('div', {id:'mock-col'}); col.append(area, row); document.body.append(col);
})();
const CONV=${JSON.stringify(conv)}, ORG=${JSON.stringify(ORG)};
document.getElementById('send').onclick = async () => {
  const res = await fetch('/api/organizations/'+ORG+'/chat_conversations/'+CONV+'/completion', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({prompt:'hi'})});
  const text = await res.text();
  document.getElementById('out').textContent = 'got ' + text.length + ' bytes';
};
</script></body></html>`;


	// ---- mock chatgpt.com / gemini.google.com: only the DOM the adapters read ----
	const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'; require-trusted-types-for 'script'";
	const TXT = {
		q1: 'Explain how a hash map handles collisions, with an example in Python. Naïve café 東京.',
		a1: 'A hash map stores key/value pairs in buckets. When two keys land in the same bucket it chains or probes. ' + 'The quick brown fox jumps over the lazy dog. '.repeat(12),
		q2: 'And what about resizing?',
		a2: 'Resizing re-hashes every key into a larger table once the load factor passes a threshold. ' + 'Pack my box with five dozen liquor jugs. '.repeat(10)
	};
	const chatgptHtml = () => `<!doctype html><html class="dark"><head><meta charset="utf-8"><title>Hash maps | ChatGPT</title></head><body>
<button data-testid="model-switcher-dropdown-button">ChatGPT 5</button>
<main id="thread">
<article><div data-message-author-role="user" data-message-id="u-1"><div class="whitespace-pre-wrap">${TXT.q1}</div></div></article>
<article><div data-message-author-role="assistant" data-message-id="a-1" data-message-model-slug="gpt-4"><div class="markdown"><p>${TXT.a1}</p></div></div></article>
</main>
<form id="mock-composer"><div id="prompt-textarea" contenteditable="true" role="textbox">Ask anything</div><button type="button">Send</button></form>
<button id="more">more</button>
<script>
document.body.style.background = '#212121'; document.body.style.color = '#ececec'; document.body.style.fontFamily = 'system-ui, sans-serif';
(() => { const f = document.getElementById('mock-composer'); f.style.cssText = 'max-width:680px;margin:20px auto;border-radius:26px;padding:14px 18px;background:#303030'; })();
document.getElementById('more').onclick = () => {
  const t = document.getElementById('thread');
  const mk = (tag, attrs, text) => { const e = document.createElement(tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; return e; };
  const u = mk('article'); const ub = mk('div', {'data-message-author-role':'user','data-message-id':'u-2'}); ub.append(mk('div', {class:'whitespace-pre-wrap'}, ${JSON.stringify(TXT.q2)})); u.append(ub); t.append(u);
  const a = mk('article'); const ab = mk('div', {'data-message-author-role':'assistant','data-message-id':'a-2','data-message-model-slug':'gpt-5'});
  const md = mk('div', {class:'markdown'}); const p = mk('p'); md.append(p); ab.append(md); a.append(ab); t.append(a);
  const full = ${JSON.stringify(TXT.a2)}; let i = 0;
  const iv = setInterval(() => { i += 40; p.textContent = full.slice(0, i); if (i >= full.length) clearInterval(iv); }, 60);
};
</script></body></html>`;
	// current chatgpt.com layout (structure taken from a real chat), built with createElement for Trusted Types
	const newLayoutHtml = () => `<!doctype html><html class="dark"><head><meta charset="utf-8"><title>Analyse job posting</title></head><body>
<main><div data-app-shell-focus-area="main"><div role="region" aria-label="Conversation" id="conv"></div></div></main>
<form id="mock-composer"><div id="prompt-textarea" contenteditable="true" role="textbox">Ask anything</div></form>
<script>
const mk = (tag, attrs, text) => { const e = document.createElement(tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; return e; };
const root = mk('div', {'data-thread-user-message-navigation-content':'true'});
const user = mk('div', {'data-chatgpt-search-unit-key':'fallback-turn-0:0:user','data-chatgpt-search-message-ids':'8f0d8c2b-b2eb-4e3e-9830-ce8343369f8d'});
user.append(mk('h4', {class:'sr-only','data-conversation-role':'user'}, 'You said:'), mk('div', {'data-user-message-bubble':'true'}, ${JSON.stringify(TXT.q1)}));
const think = mk('div', {'data-chatgpt-search-unit-key':'fallback-turn-0:1:thinking'}, 'private reasoning that must not be counted');
const asst = mk('div', {'data-chatgpt-search-unit-key':'fallback-turn-0:2:assistant','data-chatgpt-search-message-ids':'288c2d0a-1b04-4621-ad1a-22f5dda043ef'});
const body = mk('div', {'data-response-body':'288c2d0a-1b04-4621-ad1a-22f5dda043ef'}); const md = mk('div', {class:'MarkdownRoot'}); const p = mk('p', {}, ${JSON.stringify(TXT.a1)});
md.append(p, mk('button', {}, 'Copy')); body.append(md); asst.append(mk('h4', {class:'sr-only','data-conversation-role':'assistant'}, 'ChatGPT said:'), body);
root.append(user, think, asst); document.getElementById('conv').append(root);
</script></body></html>`;
	const geminiHtml = () => `<!doctype html><html><head><meta charset="utf-8"><title>Hash maps - Gemini</title></head><body class="dark-theme">
<bard-mode-switcher><button>2.5 Pro</button></bard-mode-switcher>
<script>document.body.style.background = '#131314'; document.body.style.color = '#e3e3e3'; document.body.style.fontFamily = 'system-ui, sans-serif';</script>
<div id="thread">
<input-area-v2 id="mock-composer"><rich-textarea><div class="ql-editor" contenteditable="true" role="textbox">Ask Gemini</div></rich-textarea></input-area-v2>
<user-query><div class="query-text">${TXT.q1}</div></user-query>
<model-response><model-thoughts>hidden planning that must not be counted</model-thoughts><div class="model-response-text"><div class="markdown"><p>${TXT.a1}</p></div></div></model-response>
</div></body></html>`;
	const brokenHtml = () => `<!doctype html><html><head><title>x</title></head><body><div>layout nobody expected</div></body></html>`;
	function other(host, url, res) {
		const hdr = { 'content-type': 'text/html', 'content-security-policy': CSP };
		if (url.pathname === '/favicon.ico') return res.writeHead(204).end();
		state.log.push(host + url.pathname);
		if (host === 'chatgpt.com' && /^\/c\/[\w-]{8,}$/.test(url.pathname)) return res.writeHead(200, hdr).end(url.pathname.includes('broken') ? brokenHtml() : url.pathname.includes('newdom') ? newLayoutHtml() : chatgptHtml());
		if (host === 'gemini.google.com' && /^\/app\/[\w-]{8,}$/.test(url.pathname)) return res.writeHead(200, hdr).end(url.pathname.includes('broken') ? brokenHtml() : geminiHtml());
		return res.writeHead(404).end('nope');
	}

	const server = https.createServer({ key: fs.readFileSync(path.join(__dirname, 'key.pem')), cert: fs.readFileSync(path.join(__dirname, 'cert.pem')) }, async (req, res) => {
		const host = String(req.headers.host || '').split(':')[0];
		const url = new URL(req.url, 'https://' + host);
		if (host === 'chatgpt.com' || host === 'gemini.google.com') return other(host, url, res);
		state.log.push(req.method + ' ' + url.pathname);
		const common = {
			'set-cookie': `lastActiveOrg=${ORG}; Path=/`,
			'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'; require-trusted-types-for 'script'"
		};
		let m;
		if ((m = /^\/chat\/([\w-]+)$/.exec(url.pathname))) {
			res.writeHead(200, { ...common, 'content-type': 'text/html' });
			return res.end(html(m[1]));
		}
		if (url.pathname === '/favicon.ico') return res.writeHead(204).end();
		if ((m = /^\/api\/organizations\/[^/]+\/chat_conversations\/([\w-]+)\/completion$/.exec(url.pathname)) && req.method === 'POST') {
			state.sends[m[1]] = (state.sends[m[1]] || 0) + 1;
			state.total += 1;
			res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' });
			const ml = { type: 'message_limit', message_limit: { type: 'within_limit', windows: { '5h': { utilization: u5(), resets_at: R5 }, '7d': { utilization: u7(), resets_at: R7 } } } };
			const body = `event: message_start\ndata: {"type":"message_start"}\n\nevent: message_limit\ndata: ${JSON.stringify(ml)}\n\n`;
			res.write(body.slice(0, 60));
			await new Promise((r) => setTimeout(r, 30));
			res.write(body.slice(60));
			await new Promise((r) => setTimeout(r, 60));
			res.write('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"hello"}}\n\n');
			res.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
			return res.end();
		}
		if (/^\/api\/organizations\/[^/]+\/usage$/.test(url.pathname)) {
			res.writeHead(200, { 'content-type': 'application/json' });
			return res.end(JSON.stringify({
				five_hour: { utilization: Math.round(u5() * 100), resets_at: new Date(R5 * 1000).toISOString() },
				seven_day: { utilization: Math.round(u7() * 100), resets_at: new Date(R7 * 1000).toISOString() },
				seven_day_opus: null
			}));
		}
		if ((m = /^\/api\/organizations\/[^/]+\/chat_conversations\/([\w-]+)$/.exec(url.pathname)) && url.searchParams.get('tree') === 'true') {
			const n = (state.sends[m[1]] || 0) + 1;
			const msgs = [];
			let parent = '00000000-0000-4000-8000-000000000000';
			const t0 = Date.now() - n * 20000;
			for (let i = 0; i < n; i++) {
				const hu = `h${i}`, au = `a${i}`;
				msgs.push({ uuid: hu, parent_message_uuid: parent, sender: 'human', created_at: new Date(t0 + i * 20000).toISOString(), content: [{ type: 'text', text: 'Question ' + i + ' ' + para(5) }] });
				msgs.push({ uuid: au, parent_message_uuid: hu, sender: 'assistant', created_at: new Date(t0 + i * 20000 + 8000).toISOString(), content: [{ type: 'thinking', thinking: para(30) }, { type: 'text', text: para(80) }] });
				parent = au;
			}
			res.writeHead(200, { 'content-type': 'application/json' });
			return res.end(JSON.stringify({ uuid: m[1], name: m[1] === CONV ? 'Quarterly report analysis' : 'Side project brainstorm', model: 'claude-test', current_leaf_message_uuid: parent, chat_messages: msgs }));
		}
		res.writeHead(404).end('nope');
	});
	return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, state, ORG, CONV, CONV_B, TXT })));
}

module.exports = { start, ORG, CONV, CONV_B };
