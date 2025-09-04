HTX Pi Monitor — Notes (Compact)
================================

This project shows HTX (Huobi) balances with a simple web UI on a Raspberry Pi. For setup and usage, see README.md.

Highlights
----------

- Polls private balances and public prices; JSON UI.
- Manual cost basis in `data/cost_basis_lots.json` (sequential IDs).
- Runtime flags: `DRY_RUN`, `NO_LISTEN`, `DEBUG`.

Pi kiosk hint
-------------

```
chromium-browser --kiosk --incognito http://localhost:8080
xset s off; xset -dpms; xset s noblank
```

