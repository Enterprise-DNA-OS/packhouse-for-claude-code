---
description: What is in the coolstore right now - every pallet, oldest first, with grade, grower, room and allocation. The stock answer, and where aged fruit gets caught.
---

1. `npm run packhouse -- pallets` shows the store, oldest first. `--room=` filters a room, `--grower=` a grower, `--all` includes dispatched history.
2. Anything past six weeks is already on `/attention`. For each aged pallet the question is the same: sell it, move it, or make the write-off call while it is still a call.
3. Moving fruit between rooms is one command: `move <pallet> --room=`.
4. Allocating to a load-out: `consign add <pallet> --to=<CON-ref>` (see `/dispatch`).
5. A pallet's whole story: `trace <pallet>`.
