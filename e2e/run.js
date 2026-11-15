'use strict';
// Playwright is a dev dependency (`npm i`); the second path is only for the original build sandbox.
let chromium;
({ chromium } = require('playwright'));
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('node:assert/strict');
const { start } = require('./server');

const EXT = process.env.EXT || path.resolve(__dirname, '../extension');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const ok = (name) => { results.push(name); console.log('  PASS', name); };

(async () => {
	const { server, state, ORG, CONV, CONV_B, TXT: RAW } = await start(8443);
	const TXT = Object.fromEntries(Object.entries(RAW).map(([k, v]) => [k, v.trim()])); // the adapter trims message text
	const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-e2e-'));
	const ctx = await chromium.launchPersistentContext(userDir, {
		executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
		headless: false,
		viewport: { width: 1280, height: 800 },
		args: [
			'--headless=new', '--no-sandbox',
			'--disable-features=DisableLoadExtensionCommandLineSwitch',
			`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
			'--host-resolver-rules=MAP claude.ai 127.0.0.1:8443, MAP chatgpt.com 127.0.0.1:8443, MAP gemini.google.com 127.0.0.1:8443',
			'--ignore-certificate-errors', '--no-proxy-server'
		]
	});
	const errors = [];
	ctx.on('weberror', (e) => errors.push('weberror: ' + e.error().message));
	try {
		let [sw] = ctx.serviceWorkers();
		if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
		const extId = new URL(sw.url()).host;
		console.log('extension id', extId);
		const store = () => sw.evaluate(() => chrome.storage.local.get(null));

		const page = await ctx.newPage();
		page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
		page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
		await page.goto(`https://claude.ai/chat/${CONV}`);

		// 1. content script + pill under strict CSP / Trusted Types
		await page.waitForFunction(() => !!document.getElementById('cl-ledger-host'), null, { timeout: 10000 });
		const pillText = () => page.evaluate(() => document.getElementById('cl-ledger-host').shadowRoot.querySelector('.pill').textContent.trim());
		assert.match(await pillText(), /^S .* W /);
		ok('pill rendered under strict CSP + Trusted Types');

		// 1b. the usage display sits inside the message box, right under the toolbar row (like claude-counter)
		const place = (pg) => pg.evaluate(() => {
			const h = document.getElementById('cl-ledger-host');
			const w = h.shadowRoot.querySelector('.wrap');
			const prev = h.previousElementSibling;
			const strip = h.shadowRoot.querySelector('.strip');
			return { inline: w.classList.contains('inline'), floating: w.classList.contains('floating'), prevId: prev && (prev.id || prev.tagName.toLowerCase()), parent: h.parentElement.tagName.toLowerCase(), stripShown: getComputedStyle(strip).display !== 'none', pillShown: getComputedStyle(h.shadowRoot.querySelector('.pill')).display !== 'none', stripText: strip.innerText };
		});
		const pl = await place(page);
		assert.equal(pl.inline, true, 'inline mode on claude.ai');
		assert.equal(pl.prevId, 'mock-toolbar', 'strip is inserted right after the model-picker toolbar row');
		assert.equal(pl.stripShown, true);
		assert.equal(pl.pillShown, false, 'floating pill hidden while inline');
		await page.waitForFunction(() => /Session/.test(document.getElementById('cl-ledger-host').shadowRoot.querySelector('.strip').innerText), null, { timeout: 10000 });
		const st = (await place(page)).stripText;
		assert.match(st, /Session/);
		assert.match(st, /Weekly/);
		await page.waitForFunction(() => /Session:\s*\d/.test(document.getElementById('cl-ledger-host').shadowRoot.querySelector('.strip').innerText), null, { timeout: 10000 });
		await page.screenshot({ path: path.join(OUT, 'inline-claude.png'), clip: { x: 0, y: 0, width: 900, height: 330 } });
		ok('claude.ai: usage bar attached under the message box toolbar (Session / Weekly), pill hidden');

		// 2. initial load: usage poll + conversation token count
		await page.waitForFunction(() => /S [\d.]+%/.test(document.getElementById('cl-ledger-host').shadowRoot.querySelector('.pill').textContent), null, { timeout: 10000 });
		let s = await store();
		assert.ok(s.live && s.live.windows.five_hour, 'live window from /usage poll');
		assert.equal(s.live.windows.five_hour.src, 'poll');
		await page.waitForFunction(() => document.getElementById('cl-ledger-host').shadowRoot.textContent.includes('o200k'), null, { timeout: 10000 });
		s = await store();
		assert.ok(s.convs[CONV].tokens > 500, 'conversation tokens counted: ' + s.convs[CONV].tokens);
		assert.equal(s.convs[CONV].name, 'Quarterly report analysis');
		ok('initial /usage poll and conversation token count (' + s.convs[CONV].tokens + ' tokens)');

		// 3. MAIN-world hook sees real page fetches; cross-world event bridge; attribution
		for (let i = 0; i < 3; i++) {
			await page.click('#send');
			await page.waitForFunction((n) => document.getElementById('out').textContent.startsWith('got'), i, { timeout: 8000 });
			await sleep(700);
		}
		await sleep(2800); // post-generation conversation refresh
		s = await store();
		assert.equal(s.gens.length, 3, 'three generations tracked');
		// the mock sends the usage event before answer text => 'auto' credits the previous message
		assert.ok(s.gens.every((g) => g.done), 'gens done');
		assert.ok(s.gens.slice(0, 2).every((g) => g.seen), 'first two gens credited');
		assert.equal(s.convs[CONV].gens, 3);
		const sse = s.samples.filter((x) => x.src === 'sse');
		assert.ok(sse.length >= 3, 'sse samples ' + sse.length);
		// utilisation moved 0.10->...: each send adds exactly +3pp session, +0.5pp weekly
		const spent5 = s.convs[CONV].spent.five_hour;
		const spent7 = s.convs[CONV].spent.seven_day;
		console.log('  conv spent: session', spent5, 'weekly', spent7);
		assert.ok(spent5 > 5.9 && spent5 < 6.1, 'session spend credited to prior messages (expect 6pp): ' + spent5);
		assert.ok(spent7 > 0.9 && spent7 < 1.1, 'weekly spend (expect 1pp): ' + spent7);
		near_other: {
			const other5 = s.daily[Object.keys(s.daily)[0]].other.five_hour;
			assert.ok(other5 > 2.9 && other5 < 3.1, 'first sample after install is unattributed: ' + other5);
		}
		ok('hook -> content -> service worker pipeline, SSE parsing, per-chat attribution');

		// 4. page's own fetch result is intact (hook is transparent)
		assert.match(await page.textContent('#out'), /^got \d+ bytes$/);
		ok('page still receives the full SSE response');

		// 5. pill content, panel, screenshot
		await page.evaluate(() => document.getElementById('cl-ledger-host').shadowRoot.querySelector('.pill').click());
		await sleep(400);
		const panelText = await page.evaluate(() => document.getElementById('cl-ledger-host').shadowRoot.querySelector('.panel').innerText);
		console.log('  --- panel ---\n' + panelText.split('\n').map((l) => '  | ' + l).join('\n'));
		assert.match(panelText, /Session \(5h\)/);
		assert.match(panelText, /Weekly \(7d\)/);
		assert.match(panelText, /resets in/);
		assert.match(panelText, /Tracked here: [\d.]+% of session/);
		assert.match(panelText, /Prompt cache/);
		// the panel opens upward over the message box; it must be in the top layer and actually visible, not painted over by the box
		const topmost = await page.evaluate(() => {
			const h = document.getElementById('cl-ledger-host'); const p = h.shadowRoot.querySelector('.panel'); const r = p.getBoundingClientRect();
			const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(24, r.height / 2));
			return { popover: p.matches(':popover-open'), hitIsHost: hit === h, overlapsBox: r.bottom > document.getElementById('mock-composer').getBoundingClientRect().top, onScreen: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth };
		});
		assert.equal(topmost.popover, true, 'panel is a top-layer popover');
		assert.equal(topmost.hitIsHost, true, 'panel is not covered by the message box');
		assert.equal(topmost.overlapsBox, true, 'test setup: the panel does overlap the message box');
		assert.equal(topmost.onScreen, true, 'panel stays inside the viewport');
		await page.screenshot({ path: path.join(OUT, 'panel-claude.png') });
		await page.screenshot({ path: path.join(OUT, 'pill.png') });
		ok('panel shows windows, resets, tracked cost, cache timer');
		await page.click('h1'); // clicking elsewhere on the page closes the panel
		await sleep(200);
		assert.equal(await page.evaluate(() => document.getElementById('cl-ledger-host').shadowRoot.querySelector('.wrap').classList.contains('open')), false, 'panel closes on outside click');
		await page.evaluate(() => document.getElementById('cl-ledger-host').shadowRoot.querySelector('.strip').click());
		await sleep(150);
		await page.keyboard.press('Escape');
		await sleep(150);
		assert.equal(await page.evaluate(() => document.getElementById('cl-ledger-host').shadowRoot.querySelector('.wrap').classList.contains('open')), false, 'panel closes on Escape');
		ok('details panel closes on outside click and Escape');

		// 6. second chat: attribution is per-conversation; usage jump from "another client" is unattributed
		await page.goto(`https://claude.ai/chat/${CONV_B}`);
		await page.waitForFunction(() => !!document.getElementById('cl-ledger-host'));
		await page.click('#send');
		await page.waitForFunction(() => document.getElementById('out').textContent.startsWith('got'));
		await sleep(3000);
		state.total += 4; // usage consumed elsewhere (e.g. Claude Code) -> +12pp session
		await page.click('#send');
		await page.waitForFunction(() => document.getElementById('out').textContent.startsWith('got'));
		await sleep(1500);
		s = await store();
		assert.ok(s.convs[CONV_B], 'second conversation tracked');
		assert.ok(s.convs[CONV].spent.five_hour < 10 && s.convs[CONV].spent.five_hour > 8.9, 'third message of first chat credited by the next sample: ' + s.convs[CONV].spent.five_hour);
		ok('second conversation tracked separately');

		// 7. dashboard (popup page rendered as tab) with real data
		const dash = await ctx.newPage();
		dash.on('pageerror', (e) => errors.push('dash pageerror: ' + e.message));
		dash.on('console', (m) => { if (m.type() === 'error') errors.push('dash console: ' + m.text()); });
		await dash.setViewportSize({ width: 1100, height: 1500 });
		await dash.goto(`chrome-extension://${extId}/dashboard.html?tab=1#claude`);
		await dash.waitForSelector('.card');
		const cards = await dash.locator('.card').count();
		assert.ok(cards >= 2, 'cards ' + cards);
		assert.ok((await dash.locator('#convTableClaude tbody tr').count()) >= 2, 'conversation rows');
		assert.ok((await dash.locator('#chartLine path.line').count()) >= 1, 'line chart has paths');
		assert.ok((await dash.locator('#chartDaily rect').count()) >= 1, 'daily bars');
		assert.ok((await dash.locator('#chartBuckets .barwrap').count()) >= 1, 'bucket bars');
		const insight = await dash.textContent('#insight');
		console.log('  insight:', insight);
		assert.match(insight, /messages tracked/);
		await dash.screenshot({ path: path.join(OUT, 'dashboard.png'), fullPage: true });
		ok('dashboard Claude tab renders cards, charts, table, insight from real stored data');

		// 8. settings round-trip drives the pill
		await dash.click('#tab-settings');
		await dash.waitForSelector('#s-pillCorner');
		await dash.selectOption('#s-pillCorner', 'tl');
		await dash.uncheck('#s-showPill');
		await sleep(600);
		const hidden = await page.evaluate(() => document.getElementById('cl-ledger-host').style.display);
		assert.equal(hidden, 'none');
		await dash.check('#s-showPill');
		await sleep(600);
		const cls = await page.evaluate(() => document.getElementById('cl-ledger-host').shadowRoot.querySelector('.wrap').className);
		assert.match(cls, /\btl\b/);
		ok('settings changes propagate live to the pill');

		// 8b. "Where it appears": floating pill instead of the inline bar, and back
		await dash.selectOption('#s-uiMode', 'floating');
		await page.waitForFunction(() => document.getElementById('cl-ledger-host').shadowRoot.querySelector('.wrap').classList.contains('floating'), null, { timeout: 10000 });
		let pl2 = await place(page);
		assert.equal(pl2.parent, 'body');
		assert.equal(pl2.pillShown, true);
		assert.equal(pl2.stripShown, false);
		await page.screenshot({ path: path.join(OUT, 'floating-claude.png') });
		await dash.selectOption('#s-uiMode', 'inline');
		await page.waitForFunction(() => document.getElementById('cl-ledger-host').shadowRoot.querySelector('.wrap').classList.contains('inline'), null, { timeout: 10000 });
		pl2 = await place(page);
		assert.equal(pl2.prevId, 'mock-toolbar');
		ok('setting switches between the inline bar and the floating pill live');

		// 9. CSV export content + clear
		const csv = await dash.evaluate(async () => { const d = await chrome.storage.local.get('samples'); return d.samples.length; });
		assert.ok(csv > 3);
		await dash.click('#clear');
		await dash.click('#clear');
		await sleep(600);
		s = await store();
		assert.deepEqual(Object.keys(s).sort(), ['settings']);
		ok('clear removes history but keeps settings');

		// 10. popup-sized render
		await dash.setViewportSize({ width: 480, height: 700 });
		await dash.goto(`chrome-extension://${extId}/dashboard.html`);
		await dash.waitForSelector('#tabs .tab');
		assert.equal(await dash.locator('#balance.empty').count(), 1, 'balance bar shows the empty state');
		await dash.screenshot({ path: path.join(OUT, 'popup-empty.png') });
		ok('empty-state popup renders');


		// 11. ChatGPT: DOM adapter + per-message tokenizer switching (gpt-4 -> cl100k, gpt-5 -> o200k), live streaming
		const tokDir = path.resolve(EXT, 'vendor');
		const o200k = require(path.join(tokDir, 'o200k_base.js'));
		const cl100k = require(path.join(tokDir, 'cl100k_base.js'));
		const GemmaSP = require(path.join(EXT, 'gemma.js'));
		const gbuf = fs.readFileSync(path.join(tokDir, 'gemma3.bin'));
		const gemma = GemmaSP.load(gbuf.buffer.slice(gbuf.byteOffset, gbuf.byteOffset + gbuf.byteLength));
		const GPT_ID = 'abcdef12-3456-4789-abcd-ef0123456789';
		const gpt = await ctx.newPage();
		gpt.on('pageerror', (e) => errors.push('gpt pageerror: ' + e.message));
		gpt.on('console', (m) => { if (m.type() === 'error') errors.push('gpt console: ' + m.text()); });
		await gpt.goto(`https://chatgpt.com/c/${GPT_ID}`);
		await gpt.waitForFunction(() => !!document.getElementById('cl-ledger-host'), null, { timeout: 10000 });
		await gpt.waitForFunction((id) => true, GPT_ID);
		const waitConv = async (id, pred, label) => {
			for (let i = 0; i < 60; i++) {
				const c = (await store()).convs;
				if (c && c[id] && pred(c[id])) return c[id];
				await sleep(250);
			}
			throw new Error('timeout waiting for ' + label + ': ' + JSON.stringify(((await store()).convs || {})[id]));
		};
		let c1 = await waitConv(GPT_ID, (c) => c.tokens > 0, 'chatgpt conversation');
		// chat model = gpt-4 (slug of the newest assistant message) => the user message is cl100k too
		const expect1 = cl100k.countTokens(TXT.q1) + cl100k.countTokens(TXT.a1);
		assert.notEqual(cl100k.countTokens(TXT.q1) + cl100k.countTokens(TXT.a1), o200k.countTokens(TXT.q1) + o200k.countTokens(TXT.a1), 'test text must distinguish the two encodings');
		assert.equal(c1.provider, 'openai');
		assert.equal(c1.tokens, expect1);
		assert.equal(c1.tokenizer.id, 'openai:cl100k_base');
		assert.equal(c1.tokenizer.exact, true);
		assert.equal(c1.name, 'Hash maps');
		ok('ChatGPT: chat read from the DOM and counted with cl100k for a gpt-4 model (' + c1.tokens + ' tokens)');

		await gpt.click('#more'); // user message + streamed answer written by gpt-5
		const c2 = await waitConv(GPT_ID, (c) => c.msgs === 4 && c.tokenizer.id === 'openai:o200k_base' && c.tokens > c1.tokens + 100, 'streamed gpt-5 answer');
		await sleep(2200); // let the stream finish and the last scan land
		const c2f = await waitConv(GPT_ID, (c) => c.msgs === 4, 'final');
		const tk = (await store())['tok:' + GPT_ID];
		assert.equal(tk['a-1'][2], 'openai:cl100k_base', 'old gpt-4 answer keeps cl100k');
		assert.equal(tk['a-2'][2], 'openai:o200k_base', 'new gpt-5 answer uses o200k');
		assert.equal(tk['a-2'][1], o200k.countTokens(TXT.a2), 'streamed answer fully counted with o200k');
		assert.equal(tk['a-1'][1], cl100k.countTokens(TXT.a1));
		ok('ChatGPT: model switch mid-chat re-picks the tokenizer per message; streaming answer counted in full');

		const gpl = await place(gpt);
		assert.equal(gpl.inline, true, 'chatgpt: inline');
		assert.equal(gpl.prevId, 'mock-composer', 'chatgpt: strip sits right after the composer form');
		assert.match(gpl.stripText, /This chat/);
		await gpt.waitForFunction(() => /This chat:\s*[\d~]/.test(document.getElementById('cl-ledger-host').shadowRoot.querySelector('.strip').innerText), null, { timeout: 10000 });
		await gpt.screenshot({ path: path.join(OUT, 'inline-chatgpt.png') });
		ok('ChatGPT: usage bar attached under the composer');
		const gptPanel = async () => gpt.evaluate(() => { const r = document.getElementById('cl-ledger-host').shadowRoot; r.querySelector('.pill').click(); return r.querySelector('.pill').textContent.trim() + '||' + r.querySelector('.panel').innerText; });
		await gpt.evaluate(() => { const r = document.getElementById('cl-ledger-host').shadowRoot; if (!r.querySelector('.wrap').classList.contains('open')) r.querySelector('.pill').click(); });
		await sleep(500);
		const gptText = await gpt.evaluate(() => { const r = document.getElementById('cl-ledger-host').shadowRoot; return r.querySelector('.pill').textContent.trim() + '||' + r.querySelector('.panel').innerText; });
		console.log('  chatgpt pill/panel:', gptText.replace(/\n/g, ' / '));
		assert.match(gptText, /^ChatGPT · /);
		assert.match(gptText, /o200k_base/);
		assert.doesNotMatch(gptText, /Session \(5h\)/, 'no Claude quota rows on ChatGPT');
		await gpt.screenshot({ path: path.join(OUT, 'pill-chatgpt.png') });
		ok('ChatGPT pill shows provider, tokens and the active tokenizer; no fake quota rows');

		// 12. Gemini: DOM adapter + Gemma 3 tokenizer; thinking excluded
		const GEM_ID = '4f2a9c1e7b3d5a60';
		const gem = await ctx.newPage();
		gem.on('pageerror', (e) => errors.push('gemini pageerror: ' + e.message));
		gem.on('console', (m) => { if (m.type() === 'error') errors.push('gemini console: ' + m.text()); });
		await gem.goto(`https://gemini.google.com/app/${GEM_ID}`);
		await gem.waitForFunction(() => !!document.getElementById('cl-ledger-host'), null, { timeout: 10000 });
		const g1 = await waitConv(GEM_ID, (c) => c.tokens > 0, 'gemini conversation');
		assert.equal(g1.provider, 'gemini');
		assert.equal(g1.tokens, gemma.count(TXT.q1) + gemma.count(TXT.a1), 'Gemma 3 count of the visible text only (thoughts excluded)');
		assert.equal(g1.tokenizer.id, 'gemini:gemma3');
		assert.equal(g1.tokenizer.exact, false, 'UI label "2.5 Pro" is not a model id => flagged approximate');
		assert.equal(g1.model, '2.5 Pro');
		const gemText = await gem.evaluate(() => { const r = document.getElementById('cl-ledger-host').shadowRoot; r.querySelector('.pill').click(); return r.querySelector('.pill').textContent.trim() + '||' + r.querySelector('.panel').innerText; });
		assert.match(gemText, /^Gemini · ~/);
		assert.match(gemText, /Gemma 3/);
		await gem.screenshot({ path: path.join(OUT, 'pill-gemini.png') });
		const gmp = await place(gem);
		assert.equal(gmp.inline, true, 'gemini: inline');
		assert.equal(gmp.prevId, 'mock-composer', 'gemini: strip sits right after input-area-v2');
		ok('Gemini: usage bar attached under the input area');
		ok('Gemini: chat read from the DOM and counted with the Gemma 3 SentencePiece port (' + g1.tokens + ' tokens)');

		// 13. layout the adapter does not recognise is reported, not guessed
		const bad = await ctx.newPage();
		bad.on('pageerror', (e) => errors.push('bad pageerror: ' + e.message));
		await bad.goto('https://chatgpt.com/c/broken-layout-0001');
		await bad.waitForFunction(() => !!document.getElementById('cl-ledger-host'), null, { timeout: 10000 });
		await bad.waitForFunction(() => document.getElementById('cl-ledger-host').shadowRoot.textContent.includes("Couldn't read"), null, { timeout: 15000 });
		ok('unreadable layout is reported instead of showing a made-up number');
		const bpl = await place(bad);
		assert.equal(bpl.floating, true, 'no composer found => floating pill fallback');
		assert.equal(bpl.parent, 'body');
		ok('no message box on the page: falls back to the floating pill');


		// 13b. the CURRENT chatgpt.com layout (no data-message-author-role / model slug): reads units, ignores thinking
		const NEW_ID = 'newdom-layout-0001';
		const nd = await ctx.newPage();
		nd.on('pageerror', (e) => errors.push('newdom pageerror: ' + e.message));
		nd.on('console', (m) => { if (m.type() === 'error') errors.push('newdom console: ' + m.text()); });
		await nd.goto(`https://chatgpt.com/c/${NEW_ID}`);
		await nd.waitForFunction(() => !!document.getElementById('cl-ledger-host'), null, { timeout: 10000 });
		const n1 = await waitConv(NEW_ID, (c) => c.tokens > 0, 'new-layout chatgpt conversation');
		assert.equal(n1.msgs, 2, 'user + assistant only (thinking unit and sr-only headings skipped)');
		assert.equal(n1.tokens, o200k.countTokens(TXT.q1) + o200k.countTokens(TXT.a1), 'counted text is exactly the visible message text');
		assert.equal(n1.tokenizer.id, 'openai:o200k_base');
		assert.equal(n1.tokenizer.exact, false, 'no model marker in this layout => assumed encoding, flagged');
		assert.equal(n1.name, 'Analyse job posting');
		ok('ChatGPT current layout: messages read, thinking/headings excluded, o200k assumed and flagged (' + n1.tokens + ' tokens)');

		// the diagnostics button appears only when reading fails, and copies structure without text
		await bad.evaluate(() => document.getElementById('cl-ledger-host').shadowRoot.querySelector('.pill').click());
		const diagVisible = await bad.evaluate(() => { const b = [...document.getElementById('cl-ledger-host').shadowRoot.querySelectorAll('.btn')].find((x) => x.textContent === 'Copy diagnostics'); return !!b && b.style.display !== 'none'; });
		assert.ok(diagVisible, 'diagnostics button shown for an unreadable chat');
		const diagHidden = await nd.evaluate(() => { const b = [...document.getElementById('cl-ledger-host').shadowRoot.querySelectorAll('.btn')].find((x) => x.textContent === 'Copy diagnostics'); return b.style.display === 'none'; });
		assert.ok(diagHidden, 'diagnostics button hidden for a readable chat');
		ok('"Copy diagnostics" shows only when a chat cannot be read');

		// 14. dashboard: balance bar, four tabs, per-app tables
		await dash.setViewportSize({ width: 1100, height: 1700 });
		await dash.goto(`chrome-extension://${extId}/dashboard.html?tab=1#all`);
		await dash.waitForSelector('#convTableAll tbody tr');
		assert.deepEqual(await dash.locator('#tabs .tab').evaluateAll((n) => n.map((x) => x.dataset.tab)), ['all', 'claude', 'chatgpt', 'gemini', 'settings']);
		const segs = await dash.locator('#balance .seg').evaluateAll((n) => n.map((x) => x.className));
		assert.ok(segs.some((c) => /openai/.test(c)) && segs.some((c) => /gemini/.test(c)), 'balance bar has ChatGPT and Gemini segments: ' + segs.join(','));
		const tableText = await dash.textContent('#convTableAll');
		assert.match(tableText, /ChatGPT/);
		assert.match(tableText, /Gemini/);
		assert.match(tableText, /o200k_base/);
		assert.match(tableText, /Gemma 3/);
		const mapText = await dash.textContent('#tokMap');
		assert.match(mapText, /cl100k_base/);
		assert.match(mapText, /Anthropic count_tokens API/);
		assert.match(await dash.textContent('#allLedger'), /Counted in total/);
		await dash.screenshot({ path: path.join(OUT, 'dashboard-all.png'), fullPage: true });
		ok('All tab: balance bar, per-app ledger, every chat with its tokenizer, tokenizer map');

		for (const [id, re, none] of [['chatgpt', /Hash maps|Analyse job posting/, /Gemma 3/], ['gemini', /Hash maps/, /cl100k|o200k/]]) {
			await dash.click('#tab-' + id);
			const sel = '#convTable' + (id === 'chatgpt' ? 'Chatgpt' : 'Gemini');
			await dash.waitForSelector(sel + ' tbody tr');
			const t = await dash.textContent(sel);
			assert.match(t, re);
			assert.doesNotMatch(t, none, id + ' tab must only list its own chats');
			assert.ok((await dash.locator('#panel-' + id + ' .ldr').count()) >= 3, id + ' ledger lines');
			assert.equal(await dash.locator('#panel-' + id).isVisible(), true);
			assert.equal(await dash.locator('#panel-all').isVisible(), false);
			assert.match(page.url() && (await dash.evaluate(() => location.hash)), new RegExp('#' + id));
			await dash.screenshot({ path: path.join(OUT, 'dashboard-' + id + '.png'), fullPage: true });
		}
		await dash.click('#tab-claude');
		await dash.waitForSelector('#convTableClaude tbody tr');
		assert.doesNotMatch(await dash.textContent('#convTableClaude'), /Gemma|OpenAI/);
		assert.match(await dash.textContent('#apiBox'), /Off - Claude chats use the o200k estimate/);
		await dash.screenshot({ path: path.join(OUT, 'dashboard-claude.png'), fullPage: true });
		ok('ChatGPT / Gemini / Claude tabs each show only their own chats; deep links via #hash; API-key box on the Claude tab');

		// 15. API key is never included in the JSON export
		await dash.evaluate(() => chrome.storage.local.set({ anthropicKey: 'sk-ant-SECRET' }));
		const exported = await dash.evaluate(async () => {
			const all = await chrome.storage.local.get(null);
			return Object.keys(all);
		});
		assert.ok(exported.includes('anthropicKey')); // sanity: it is in storage
		await dash.click('#tab-settings');
		const [dl] = await Promise.all([dash.waitForEvent('download'), dash.click('#expJson')]);
		const exp = fs.readFileSync(await dl.path(), 'utf8');
		assert.ok(!exp.includes('SECRET') && !exp.includes('anthropicKey'), 'API key leaked into export');
		await dash.evaluate(() => chrome.storage.local.remove('anthropicKey'));
		ok('exported JSON never contains the API key');

		console.log('\nrequests seen by mock server:', [...new Set(state.log)].join(' | '));
		assert.deepEqual(errors, [], 'console/page errors: ' + errors.join('\n'));
		ok('no page or console errors');
		console.log(`\n${results.length} checks passed`);
	} catch (e) {
		console.error('\nFAILED:', e.message);
		if (errors.length) console.error('errors:', errors);
		process.exitCode = 1;
	} finally {
		await ctx.close();
		server.close();
	}
})();
