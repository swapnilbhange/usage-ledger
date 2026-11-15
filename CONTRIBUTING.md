# Contributing

Thanks for helping. This started as a personal tool by Swapnil Bhange, built with Claude, and it gets better with real-world reports.

## The most useful thing you can do
Try it on the live sites and tell us what happens. Because most live-site behaviour was only tested on mock pages, reports like these matter most:
- "The bar is floating instead of under the message box" on site X.
- "It says it couldn't read this chat" on site X.
- The output of **Copy diagnostics** (page structure only, no message text) from the bar's panel.
- A comparison of a count against the provider's own number, if you have one.

## Setup
```bash
git clone https://github.com/swapnilbhange/usage-ledger.git
cd usage-ledger
npm install
npm test            # unit tests
npm run e2e         # needs Chrome or Chromium: CHROME_PATH=/path/to/chrome npm run e2e
```
Load `extension/` as an unpacked extension to try changes. Reload it on `chrome://extensions` after editing.

## Making a change
1. Open an issue first for anything bigger than a bug fix, so we agree on direction.
2. Keep the no-build, no-runtime-dependency approach. New runtime code should be plain JavaScript in `extension/`.
3. No `innerHTML`; build DOM with `createElement` and `textContent`.
4. Add or update tests. A new site reader needs a mock page in `e2e/server.js` and a test in `tests/adapters.test.js`.
5. Keep claims honest: if something is estimated or untested, the UI and docs must say so.
6. Run `npm run check` (version consistency and unit tests) before opening a pull request.

Style: tabs for indentation, single quotes, no trailing spaces. Dashboard copy uses sentence case and plain words; avoid ALL-CAPS labels.

## Fixing a site reader
Sites change their markup. If a reader breaks:
1. Ask the reporter for *Copy diagnostics* output.
2. Update the selectors in `extension/adapters.js`, keeping the old ones as fallbacks where they still match some layouts.
3. Add the new structure as a fixture in `tests/adapters.test.js` and a mock in `e2e/server.js`.

## Releasing (maintainer)
1. Update `version` in `extension/manifest.json` and `package.json`, and add a section at the top of `CHANGELOG.md`.
2. `npm run check && npm run e2e && npm run pack`.
3. Tag and publish:
   ```bash
   git tag v0.3.1 && git push --tags
   gh release create v0.3.1 dist/usage-ledger-0.3.1.zip --title "v0.3.1" --notes-file docs/RELEASE-v0.3.1.md
   ```

## Conduct
Be kind and specific. Assume good faith. Harassment is not welcome.

## Licence
By contributing you agree that your contribution is released under the [MIT licence](LICENSE).
