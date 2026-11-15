'use strict';
// Builds every Chrome Web Store image from HTML templates and the real UI screenshots in docs/screenshots.
//   node store/build.js            (needs playwright + Chrome; run `node store/src/inline.js` first if the inline strip changed)
let chromium;
({ chromium } = require('playwright'));
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'docs/screenshots');
const OUT = __dirname;
const url = (p) => 'file://' + p;

const C = { paper: '#f1f4f5', ink: '#17222b', ink2: '#51606c', rule: '#cdd6db', margin: '#c2453a', claude: '#c9764f', chatgpt: '#1f9d82', gemini: '#5b7fe8', night: '#17222b' };
const SERIF = "'Bitstream Charter', Charter, 'Iowan Old Style', Georgia, serif"; // single quotes: it is also used inside style="..." attributes
const SANS = "Inter, system-ui, sans-serif";
const base = `*{box-sizing:border-box;margin:0}html,body{overflow:hidden}body{font-family:${SANS};-webkit-font-smoothing:antialiased}`;

// ---- promo tiles ---------------------------------------------------------------------------------------------
const bar = (h, gap) => `<div style="display:flex;gap:${gap}px;height:${h}px;border-radius:${h / 2}px;overflow:hidden">
<div style="flex:60;background:${C.claude}"></div><div style="flex:32;background:${C.chatgpt}"></div><div style="flex:8;background:${C.gemini}"></div></div>`;

const smallTile = `<!doctype html><meta charset=utf-8><style>${base}
body{width:440px;height:280px;background:${C.paper};color:${C.ink};position:relative}
.rule{position:absolute;left:34px;top:0;bottom:0;width:2px;background:${C.margin}}
.in{position:absolute;left:60px;right:32px;top:0;bottom:0}
.bar{position:absolute;left:60px;right:32px;top:38px}
h1{position:absolute;left:60px;top:84px;font:600 46px/1 ${SERIF};letter-spacing:-.01em}
p{position:absolute;left:60px;right:32px;top:148px;font:500 17px/1.4 ${SANS};color:${C.ink2}}
.apps{position:absolute;left:60px;bottom:30px;display:flex;gap:18px;font:600 14px ${SANS};color:${C.ink}}
.apps i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px}
</style><div class=rule></div><div class=bar>${bar(14, 3)}</div>
<h1>Usage Ledger</h1><p>Token counts and usage history for your AI chats.</p>
<div class=apps><span><i style="background:${C.claude}"></i>Claude</span><span><i style="background:${C.chatgpt}"></i>ChatGPT</span><span><i style="background:${C.gemini}"></i>Gemini</span></div>`;

const row = (dot, name, val, sub) => `<div style="display:flex;align-items:baseline;gap:12px;margin:0 0 26px"><i style="width:14px;height:14px;border-radius:50%;background:${dot};flex:none;position:relative;top:1px"></i><span style="font:500 24px ${SANS}">${name}</span>
<span style="flex:1;border-bottom:3px dotted ${C.rule};transform:translateY(-6px)"></span><span style="font:600 38px ${SERIF}">${val}</span><span style="font:500 17px ${SANS};color:${C.ink2};width:62px">${sub}</span></div>`;
const marquee = `<!doctype html><meta charset=utf-8><style>${base}
body{width:1400px;height:560px;background:${C.paper};color:${C.ink};position:relative}
.rule{position:absolute;left:74px;top:0;bottom:0;width:3px;background:${C.margin}}
.bar{position:absolute;left:112px;right:96px;top:64px}
h1{position:absolute;left:112px;top:150px;font:600 104px/1 ${SERIF};letter-spacing:-.015em}
p{position:absolute;left:112px;top:290px;width:560px;font:500 30px/1.38 ${SANS};color:${C.ink2}}
.card{position:absolute;left:770px;right:96px;top:150px}
.tot{border-top:4px double ${C.ink};padding-top:22px;display:flex;align-items:baseline;gap:12px}
</style><div class=rule></div><div class=bar>${bar(22, 4)}</div>
<h1>Usage Ledger</h1><p>See how many tokens every Claude, ChatGPT and Gemini chat uses, counted with each app's own tokenizer.</p>
<div class=card>${row(C.claude, 'Claude', '~331k', '7 chats')}${row(C.chatgpt, 'ChatGPT', '~174k', '5 chats')}${row(C.gemini, 'Gemini', '40k', '3 chats')}
<div class=tot><span style="font:600 24px ${SANS}">Counted in total</span><span style="flex:1;border-bottom:3px dotted ${C.rule};transform:translateY(-6px)"></span><span style="font:600 46px ${SERIF}">~546k</span><span style="width:62px"></span></div></div>`;

// ---- screenshots (1280x800) ---------------------------------------------------------------------------------
// A caption on a dark ground and the real UI below it, cropped by the bottom edge.
const framed = (title, sub, img, { w = 1000, dark = false } = {}) => `<!doctype html><meta charset=utf-8><style>${base}
body{width:1280px;height:800px;background:${C.night};position:relative;color:#f1f4f5}
h1{position:absolute;left:140px;top:46px;right:140px;font:600 42px/1.1 ${SERIF};letter-spacing:-.01em}
p{position:absolute;left:140px;top:106px;right:140px;font:400 20px/1.4 ${SANS};color:#a9b7c1}
.fr{position:absolute;left:${(1280 - w) / 2}px;top:176px;width:${w}px;height:700px;border-radius:12px 12px 0 0;overflow:hidden;box-shadow:0 0 0 1px rgba(255,255,255,.08),0 24px 60px rgba(0,0,0,.45)}
.fr img{display:block;width:${w}px}
</style><h1>${title}</h1><p>${sub}</p><div class=fr><img src="${url(img)}"></div>`;

const inlineShot = `<!doctype html><meta charset=utf-8><style>${base}
body{width:1280px;height:800px;background:${C.night};position:relative;color:#f1f4f5}
h1{position:absolute;left:140px;top:46px;right:140px;font:600 42px/1.1 ${SERIF};letter-spacing:-.01em}
p{position:absolute;left:140px;top:106px;right:140px;font:400 20px/1.4 ${SANS};color:#a9b7c1}
.fr{position:absolute;left:140px;top:250px;width:1000px;height:212px;border-radius:18px;overflow:hidden;background:#212121;box-shadow:0 0 0 1px rgba(255,255,255,.08),0 24px 60px rgba(0,0,0,.45)}
.fr img{display:block;width:1000px;margin-top:-16px}
.n{position:absolute;left:140px;top:530px;width:1000px;display:flex;gap:56px;font:400 18px/1.5 ${SANS};color:#a9b7c1}
.n b{display:block;color:#f1f4f5;font:600 20px ${SERIF};margin-bottom:4px}
</style><h1>A running count in the message box</h1><p>The bar sits under the box where you type, so you see how large the chat is before you send.</p>
<div class=fr><img src="${url(path.join(OUT, 'src/inline-strip.png'))}"></div>
<div class=n><div><b>Tokens so far</b>How big this chat is, against the model's window.</div><div><b>Right tokenizer</b>Chosen from the app and model you are using.</div><div><b>On Claude</b>Session and weekly limits show in the same place.</div></div>`;

const jobs = [
	['icon', null],
	['promo-small-440x280.png', smallTile, 440, 280],
	['promo-marquee-1400x560.png', marquee, 1400, 560],
	['screenshots/1-all-chats.png', framed('Every chat, one ledger', 'Claude, ChatGPT and Gemini together, with the largest chats listed first.', path.join(SHOTS, 'dashboard-all-light.png')), 1280, 800],
	['screenshots/2-message-box.png', inlineShot, 1280, 800],
	['screenshots/3-claude-limits.png', framed('Claude limits at a glance', 'Session and weekly usage with reset times, burn rate and a usage-over-time chart.', path.join(SHOTS, 'dashboard-claude-dark.png')), 1280, 800],
	['screenshots/4-tokenizers.png', framed('Counted the way each app counts', 'OpenAI encodings for ChatGPT and Gemma 3 for Gemini, picked per message from the model.', path.join(SHOTS, 'dashboard-chatgpt-light.png')), 1280, 800],
	['screenshots/5-settings.png', framed('Stays in your browser', 'History is stored locally. Export it as CSV or JSON, or clear it, from Settings.', path.join(SHOTS, 'dashboard-settings-light.png')), 1280, 800]
];

(async () => {
	const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--allow-file-access-from-files'] });
	const tmp = path.join(OUT, 'src/_tmp.html');
	for (const [name, html, w, h] of jobs) {
		if (!html) continue;
		fs.writeFileSync(tmp, html);
		const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
		await p.goto(url(tmp));
		await p.evaluate(() => document.fonts.ready);
		await p.waitForTimeout(200);
		await p.screenshot({ path: path.join(OUT, name), omitBackground: false });
		await p.close();
		console.log('wrote', name);
	}
	// store icon: the extension icon at 96px centred on a transparent 128px canvas (the store asks for 16px of padding)
	const ic = path.join(ROOT, 'extension/icons/icon128.png');
	fs.writeFileSync(tmp, `<!doctype html><meta charset=utf-8><style>*{margin:0}html,body{background:transparent}img{position:absolute;left:16px;top:16px;width:96px;height:96px}</style><img src="${url(ic)}">`);
	const p = await b.newPage({ viewport: { width: 128, height: 128 } });
	await p.goto(url(tmp));
	await p.screenshot({ path: path.join(OUT, 'icon-128.png'), omitBackground: true });
	console.log('wrote icon-128.png');
	fs.unlinkSync(tmp);
	await b.close();
})();
