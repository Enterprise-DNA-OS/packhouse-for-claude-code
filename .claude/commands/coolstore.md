---
description: The coolstore on one screen - every room, its band, the last reading and how long ago. Record a temperature check. Out-of-range or quiet rooms are already on the attention list.
---

1. `npm run packhouse -- coolstore` shows every active room: the target band, the last reading, hours since, who checked, how many pallets are inside, and the state (ok, QUIET, OUT OF RANGE, NEVER CHECKED).
2. Record a check the moment it is taken: `temp "<room>" --temp= [--by= --note=]`.
3. **An out-of-range reading with fruit in the room is a same-day decision**, and the CLI says so when you record one: check the plant, move the fruit if it needs moving (`move <pallet> --room=`), and put what you did in the record (`--note=`, or `log` against the affected pallets).
4. A room quiet past 24 hours is a gap in the record the export programme audits. The fix is a walk and a thermometer, now.
5. The audit-ready register per room renders with `npm run docs` (coolstore-register): the last fortnight of checks, in your brand, printable.
6. A new room is `add room "<name>" --min= --max=`. Set the band for the fruit that room actually holds; the demo runs kiwifruit at 0 to 2 C and Hass at 4 to 7 C, and yours may differ.
