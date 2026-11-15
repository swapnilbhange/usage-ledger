'use strict';
// Captures the real inline usage strip from the extension (loaded into Chrome) on a neutral mock composer,
// so the store screenshot shows the actual UI without any third-party site chrome.
let chromium;
({ chromium } = require('playwright'));
const path = require('path');
const fs = require('fs');
const os = require('os');
const { start } = require('../../e2e/server');
const EXT = path.resolve(__dirname, '../../extension');
const OUT = path.resolve(__dirname, 'inline-strip.png');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
	const { server, CONV } = await start(8443);
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-store-'));
	const ctx = await chromium.launchPersistentContext(dir, {
		executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: false, viewport: { width: 760, height: 300 }, deviceScaleFactor: 2,
		args: ['--headless=new', '--no-sandbox', '--disable-features=DisableLoadExtensionCommandLineSwitch', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
			'--host-resolver-rules=MAP claude.ai 127.0.0.1:8443, MAP chatgpt.com 127.0.0.1:8443, MAP gemini.google.com 127.0.0.1:8443', '--ignore-certificate-errors', '--no-proxy-server']
	});
	try {
		let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
		const p = await ctx.newPage();
		await p.goto('https://chatgpt.com/c/abcdef12-3456-4789-abcd-ef0123456789');
		await p.waitForFunction(() => !!document.getElementById('cl-ledger-host'), null, { timeout: 10000 });
		await p.click('#more');
		await p.waitForFunction(() => document.querySelectorAll('[data-message-author-role]').length >= 4, null, { timeout: 15000 });
		await sleep(5000); // let the streamed answer finish and the count settle
		await p.evaluate(() => { const m = document.querySelector('[data-message-author-role="assistant"] .markdown p'); m.textContent += ' ' + 'The quick brown fox jumps over the lazy dog while the committee reviews the quarterly budget. '.repeat(2600); });
		await sleep(4000);
		console.log('convs:', JSON.stringify(Object.values((await sw.evaluate(() => chrome.storage.local.get('convs'))).convs || {}).map((c) => [c.name, c.msgs, c.tokens])));
		console.log('settings:', JSON.stringify(await sw.evaluate(async () => (await chrome.storage.local.get('settings')).settings)));
		await p.waitForFunction(() => /This chat:\s*[\d~]/.test(document.getElementById('cl-ledger-host').shadowRoot.querySelector('.strip').innerText), null, { timeout: 10000 });
		await p.evaluate(() => {
			// neutral page: no third-party branding, just a message box with the extension's strip under it
			document.title = 'Chat';
			document.getElementById('thread').style.display = 'none';
			document.querySelector('[data-testid="model-switcher-dropdown-button"]').style.display = 'none';
			document.getElementById('more').style.display = 'none';
			document.querySelector('#mock-composer button').style.display = 'none';
			document.getElementById('prompt-textarea').textContent = 'Message';
			document.getElementById('prompt-textarea').style.color = '#9a9a9a';
			document.body.style.cssText += ';margin:0;padding:34px 20px;max-width:720px;margin:0 auto;';
			const f = document.getElementById('mock-composer'); f.style.margin = '0'; f.style.minHeight = '56px'; f.style.maxWidth = 'none';
		});
		await sleep(400);
		const txt = await p.evaluate(() => document.getElementById('cl-ledger-host').shadowRoot.querySelector('.strip').innerText);
		console.log('strip text:', txt.replace(/\n/g, ' | '));
		await p.screenshot({ path: OUT, clip: { x: 0, y: 0, width: 760, height: 190 } });
	} finally { await ctx.close(); server.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
