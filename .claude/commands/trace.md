---
description: Trace any pallet one step back and one step forward in seconds - pallet to grading run to delivery to block to grower, with the spray record and GAP certificate on the same card, then forward to its consignment. The recall drill and the audit answer.
---

1. Run `npm run packhouse -- trace <pallet number>`. Partial numbers work ("4024" finds PLT-4024).
2. The card is the whole traceability story:
   - **One step back:** the grading run, the delivery, the block and its code, the grower, the spray record (diary, last spray, withholding, clear date), the GAP certificate state, the maturity clearance.
   - **One step forward:** the consignment, the buyer, the destination, the assurance reference, the dispatch date.
3. For a recall drill or an auditor: this card, plus the consignment manifest (`npm run docs`, consignment-manifest) for everything that travelled with it, is the answer. Time how long it took; that number is the point.
4. Going the other way (a grower rings about their fruit): `pallets --grower=` lists every pallet of theirs still in store, and `grower <name>` shows the season.
