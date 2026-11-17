const test = require('node:test');
const assert = require('node:assert');
const A = require('../extension/adapters.js');

let JSDOM;
try {
	({ JSDOM } = require(require.resolve('jsdom', { paths: [process.cwd(), __dirname + '/..'] })));
} catch {
	/* jsdom is a dev-only dependency */
}
const skip = !JSDOM && 'jsdom not installed (npm i jsdom)';
const dom = (html, title) => new JSDOM(`<!doctype html><title>${title || ''}</title><body>${html}</body>`).window.document;

test('ChatGPT: reads messages, skips non-chat roles, takes model from the message slug', { skip }, () => {
	const d = dom(`
	  <button data-testid="model-switcher-dropdown-button">ChatGPT 5</button>
	  <article><div data-message-author-role="user" data-message-id="u-1"><div class="whitespace-pre-wrap">What is 2+2?</div></div></article>
	  <article><div data-message-author-role="tool" data-message-id="t-1">internal</div></article>
	  <article><div data-message-author-role="assistant" data-message-id="a-1" data-message-model-slug="gpt-5"><div class="markdown"><p>It is <b>4</b>.</p></div></div></article>
	`, 'Arithmetic | ChatGPT');
	const c = A.readConversation('openai', d, '/c/68f0c0de-1234-4abc-9def-0123456789ab');
	assert.strictEqual(c.id, '68f0c0de-1234-4abc-9def-0123456789ab');
	assert.strictEqual(c.model, 'gpt-5');
	assert.strictEqual(c.name, 'Arithmetic');
	assert.deepStrictEqual(c.msgs.map((m) => [m.id, m.role, m.text, m.model]), [
		['u-1', 'human', 'What is 2+2?', null],
		['a-1', 'assistant', 'It is 4.', 'gpt-5']
	]);
});

test('ChatGPT: falls back to the picker label; per-message model survives a mid-chat switch', { skip }, () => {
	const d = dom(`<button data-testid="model-switcher-dropdown-button">GPT-4o</button>
	  <div data-message-author-role="assistant" data-message-id="a-1" data-message-model-slug="gpt-4"><div class="markdown">old</div></div>
	  <div data-message-author-role="assistant" data-message-id="a-2" data-message-model-slug="gpt-5"><div class="markdown">new</div></div>`);
	const c = A.readConversation('openai', d, '/c/abcdefgh12345');
	assert.deepStrictEqual(c.msgs.map((m) => m.model), ['gpt-4', 'gpt-5']);
	assert.strictEqual(c.model, 'gpt-5');
	const d2 = dom(`<button data-testid="model-switcher-dropdown-button">GPT-4o</button><div data-message-author-role="user">hi</div>`);
	assert.strictEqual(A.readConversation('openai', d2, '/c/abcdefgh12345').model, 'GPT-4o');
});

test('ChatGPT / Gemini: conversation ids from URLs', () => {
	assert.strictEqual(A.chatgpt.convId('/c/abcdefgh-1234'), 'abcdefgh-1234');
	assert.strictEqual(A.chatgpt.convId('/g/g-abc123/c/abcdefgh-1234'), 'abcdefgh-1234');
	assert.strictEqual(A.chatgpt.convId('/'), null);
	assert.strictEqual(A.chatgpt.convId('/c/short'), null);
	assert.strictEqual(A.gemini.convId('/app/4f2a9c1e7b3d5a60'), '4f2a9c1e7b3d5a60');
	assert.strictEqual(A.gemini.convId('/u/1/app/4f2a9c1e7b3d5a60'), '4f2a9c1e7b3d5a60');
	assert.strictEqual(A.gemini.convId('/app'), null);
	assert.strictEqual(A.readConversation('openai', null, '/'), null);
});

test('Gemini: pairs user-query / model-response in order and drops thoughts', { skip }, () => {
	const d = dom(`
	  <bard-mode-switcher><button>2.5 Pro</button></bard-mode-switcher>
	  <user-query><div class="query-text">Explain DNS</div></user-query>
	  <model-response><model-thoughts>secret reasoning here</model-thoughts>
	    <div class="model-response-text"><div class="markdown"><p>DNS maps names to IPs.</p></div><button>copy</button></div></model-response>
	  <user-query><div class="query-text">Thanks</div></user-query>
	  <model-response><div class="model-response-text">You're welcome.</div></model-response>`, 'Explain DNS - Gemini');
	const c = A.readConversation('gemini', d, '/app/4f2a9c1e7b3d5a60');
	assert.strictEqual(c.model, '2.5 Pro');
	assert.strictEqual(c.name, 'Explain DNS');
	assert.deepStrictEqual(c.msgs.map((m) => [m.id, m.role, m.text]), [
		['u0', 'human', 'Explain DNS'],
		['a0', 'assistant', 'DNS maps names to IPs.'],
		['u1', 'human', 'Thanks'],
		['a1', 'assistant', "You're welcome."]
	]);
	const t = A.readConversation('gemini', d, '/app/4f2a9c1e7b3d5a60', { includeThinking: true });
	assert.ok(t.msgs[1].text.includes('secret reasoning'));
});

test('empty / changed layout yields zero messages instead of throwing', { skip }, () => {
	const d = dom('<div>totally different markup</div>');
	assert.deepStrictEqual(A.readConversation('openai', d, '/c/abcdefgh1234').msgs, []);
	assert.deepStrictEqual(A.readConversation('gemini', d, '/app/abcdefgh1234').msgs, []);
});

test('signature changes when the streamed answer grows, not otherwise', { skip }, () => {
	const mk = (txt) => A.readConversation('openai', dom(`<div data-message-author-role="assistant" data-message-id="a1"><div class="markdown">${txt}</div></div>`), '/c/abcdefgh1234');
	assert.strictEqual(A.signature(mk('hello')), A.signature(mk('hello')));
	assert.notStrictEqual(A.signature(mk('hello')), A.signature(mk('hello world')));
});

// Structure copied from a real chatgpt.com chat (outline supplied by the user, text replaced).
const NEW_LAYOUT = `
<main><div data-app-shell-focus-area="main"><div role="region" aria-label="Conversation">
 <div data-thread-user-message-navigation-content="true"><div data-rail-chat-transcript="true">
  <div data-turn-key="t1"><div data-content-search-turn-key="fallback-turn-0"><div class="group" data-talvt-turn-state="complete"><div>
    <div class="block-x"><h4 class="sr-only" data-conversation-role="user"><span>You said:</span></h4>
      <div data-chatgpt-search-unit-key="fallback-turn-0:0:user" data-chatgpt-search-message-ids="8f0d8c2b-b2eb-4e3e-9830-ce8343369f8d"><div data-content-search-unit-key="fallback-turn-0:0:user"><div class="bubble" data-user-message-bubble="true">Analyse this job posting</div></div></div></div>
    <div data-content-search-unit-key="fallback-turn-0:1:thinking" data-chatgpt-search-unit-key="fallback-turn-0:1:thinking">internal thinking text that must be ignored</div>
    <div data-content-search-unit-key="fallback-turn-0:2:assistant" data-chatgpt-search-unit-key="fallback-turn-0:2:assistant" data-chatgpt-search-message-ids="288c2d0a-1b04-4621-ad1a-22f5dda043ef">
      <h4 class="sr-only" data-conversation-role="assistant"><span>ChatGPT said:</span><span class="hidden">hidden</span></h4>
      <div data-response-body="288c2d0a-1b04-4621-ad1a-22f5dda043ef"><div class="group"><div class="MarkdownRoot" data-markdown-text-style="assistant-message"><p>The role needs <b>Python</b>.</p><ul><li>SQL</li><li>BigQuery</li></ul><button>Copy</button></div></div></div>
    </div>
  </div></div></div></div>
 </div></div></div></div></main>`;

test('ChatGPT (current layout): reads user/assistant units, ignores thinking units and screen-reader headings', { skip }, () => {
	const d = dom(NEW_LAYOUT, 'Analyse job posting');
	const c = A.readConversation('openai', d, '/c/6af9ba44-4b4c-83e8-b65a-79d9ca145e20');
	assert.deepStrictEqual(c.msgs.map((m) => [m.id, m.role]), [
		['8f0d8c2b-b2eb-4e3e-9830-ce8343369f8d:user', 'human'],
		['288c2d0a-1b04-4621-ad1a-22f5dda043ef:assistant', 'assistant']
	]);
	assert.strictEqual(c.msgs[0].text, 'Analyse this job posting');
	assert.ok(!/said|hidden|Copy|internal thinking/.test(c.msgs[1].text), c.msgs[1].text);
	assert.match(c.msgs[1].text, /The role needs Python\.\s*SQL\s*BigQuery/); // block boundaries preserved
	assert.strictEqual(c.model, null); // no model marker in this layout
	assert.strictEqual(c.name, 'Analyse job posting');
});

test('ChatGPT (current layout): model label is used only if it looks like a model name', { skip }, () => {
	const withBtn = (label) => dom(NEW_LAYOUT + `<button aria-haspopup="menu">${label}</button>`);
	assert.strictEqual(A.readConversation('openai', withBtn('GPT-5.1'), '/c/abcdefgh1234').model, 'GPT-5.1');
	assert.strictEqual(A.readConversation('openai', withBtn('Open profile menu'), '/c/abcdefgh1234').model, null);
	assert.strictEqual(A.readConversation('openai', withBtn('Projects'), '/c/abcdefgh1234').model, null);
});

test('diagnose(): structure only, never message text, ids masked', { skip }, () => {
	const d = dom(NEW_LAYOUT, 'Analyse job posting');
	const out = A.diagnose('openai', d, '/c/6af9ba44-4b4c-83e8-b65a-79d9ca145e20');
	assert.match(out, /data-chatgpt-search-unit-key\] -> 3/);
	assert.match(out, /path=\/c\/ID/);
	assert.ok(!/Analyse this job|Python|BigQuery/.test(out), 'leaks message text');
	assert.ok(!out.includes('6af9ba44'), 'leaks conversation id');
	assert.ok(out.split('\n').length > 6);
});

// ------------------------------------------------------------ composer anchors

test('anchor (claude.ai): after the toolbar row that holds the model selector, inside the composer', { skip }, () => {
	const d = dom(`<div data-testid="chat-input-grid-container"><div data-testid="chat-input-grid-area">
	  <div id="editor" contenteditable="true"></div>
	  <div id="row" style="display:flex;flex-direction:row"><button>+</button><div style="display:flex"><button data-testid="model-selector-dropdown">Opus</button></div><button>send</button></div>
	</div></div>`);
	const a = A.findAnchor('claude', d);
	assert.strictEqual(a.el.id, 'row');
	assert.strictEqual(a.where, 'after');
	assert.strictEqual(A.findAnchor('claude', dom('<div>nothing</div>')), null);
});

test('anchor (chatgpt / gemini): under the composer card, found from the editable; null when there is none', { skip }, () => {
	const gpt = dom(`<main><form id="card"><div id="prompt-textarea" contenteditable="true"></div><button data-testid="send-button">go</button></form></main>`);
	assert.strictEqual(A.findAnchor('openai', gpt).el.id, 'card');
	const gem = dom(`<input-area-v2 id="card"><div class="x"><rich-textarea><div class="ql-editor" contenteditable="true"></div></rich-textarea></div></input-area-v2>`);
	assert.strictEqual(A.findAnchor('gemini', gem).el.id, 'card');
	// no form: nearest clearly rounded ancestor
	const rounded = dom(`<div id="outer"><div id="card" style="border-radius:24px"><div><textarea></textarea></div></div></div>`);
	assert.strictEqual(A.findAnchor('openai', rounded).el.id, 'card');
	assert.strictEqual(A.findAnchor('openai', dom('<div>no composer</div>')), null);
	// an editable inside the conversation (ChatGPT's email writing block) is not the message box, even when it comes first
	const wb = dom(`<main><div data-thread-user-message-navigation-content="true"><div data-testid="chatgpt-writing-block"><div id="wbcard" style="border-radius:16px"><div class="ProseMirror" contenteditable="true" role="textbox" aria-label="Start writing"></div></div></div></div><form id="card"><div class="x" contenteditable="true" role="textbox"></div></form></main>`);
	assert.strictEqual(A.findAnchor('openai', wb).el.id, 'card');
	// only an in-conversation editor on the page: no anchor, so the floating pill is used instead of a strip inside the chat
	const onlyWb = dom(`<main><div data-testid="chatgpt-writing-block"><div style="border-radius:16px"><div class="ProseMirror" contenteditable="true"></div></div></div></main>`);
	assert.strictEqual(A.findAnchor('openai', onlyWb), null);
	// hidden editables are ignored
	const hidden = dom(`<form id="f"><textarea style="display:none"></textarea></form>`);
	assert.strictEqual(A.findAnchor('openai', hidden), null);
});
