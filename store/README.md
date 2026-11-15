# Chrome Web Store images

Everything the Developer Dashboard asks for under **Store listing**. Upload these files as they are.

| File | Size | Dashboard field |
|---|---|---|
| `icon-128.png` | 128×128, transparent, 16 px padding | Store icon |
| `promo-small-440x280.png` | 440×280 | Small promo tile |
| `promo-marquee-1400x560.png` | 1400×560 | Marquee promo tile (optional) |
| `screenshots/1-all-chats.png` … `5-settings.png` | 1280×800, 24-bit PNG | Screenshots (up to 5) |

The screenshots show sample data, not a real account. The message-box shot is the extension's real usage bar on a
neutral test page, so it carries no other company's interface.

## Rebuild

```sh
npm i                          # playwright
node store/src/inline.js       # only if the usage bar changed: re-captures src/inline-strip.png
node store/build.js            # renders every image above
```

`build.js` reads the dashboard screenshots in `docs/screenshots/`, so refresh those first when the dashboard changes.
