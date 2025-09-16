HTX Pi Monitor — Notes (Compact)
================================

This project shows HTX (Huobi) balances with a simple web UI on a Raspberry Pi. For setup and usage, see README.md.

Highlights
----------

- Polls private balances and public prices; JSON UI.
 - Simple JSON storage; no DB.
- Runtime flags: `DRY_RUN`, `NO_LISTEN`, `DEBUG`.

Pi kiosk hint
-------------

```
chromium-browser --kiosk --incognito http://localhost:$PORT
xset s off; xset -dpms; xset s noblank
```
