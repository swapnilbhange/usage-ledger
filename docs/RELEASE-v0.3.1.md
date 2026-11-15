# Usage Ledger v0.3.1: the details panel opens on top

Created by **Swapnil Bhange** with the help of **Claude** (Anthropic).

## Fixed
On claude.ai, clicking the usage bar under the message box opened the details panel behind the box, so most of it was hidden. The panel now appears on top of the page, next to the bar. It opens upward or downward depending on the room, stays inside the window and follows the bar if the box grows.

## Changed
Requires Chrome 114 or newer (the panel uses the browser's popover feature).

## Install
Download `usage-ledger-0.3.1.zip`, unzip it, open `chrome://extensions`, enable *Developer mode*, choose *Load unpacked* and pick the unzipped folder. If you already loaded 0.3.0, remove it first or load this folder over it and press the reload icon.

## Please read
Placement of the bar and the panel was tested on mock pages that copy the live page's layout, not on the live sites. If the panel is still misplaced, open an issue and attach the output of *Copy diagnostics* (page structure only, never message text).

## Checks
51 unit tests and 27 end-to-end checks pass.

Full details: [CHANGELOG.md](../CHANGELOG.md).
