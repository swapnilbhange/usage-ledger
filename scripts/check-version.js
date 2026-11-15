'use strict';
// Fails if manifest.json, package.json and the top CHANGELOG entry disagree about the version.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8')).version;
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const m = /^## \[(\d+\.\d+\.\d+)\]/m.exec(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'));
const log = m && m[1];
if (manifest !== pkg || manifest !== log) {
	console.error(`version mismatch: manifest=${manifest} package.json=${pkg} CHANGELOG=${log}`);
	process.exit(1);
}
console.log('version', manifest, 'consistent');
