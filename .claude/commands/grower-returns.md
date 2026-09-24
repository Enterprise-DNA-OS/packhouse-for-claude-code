---
description: The money side - pools, sales and grower returns. Record proceeds, read every grower's position at today's numbers, close a pool when it is whole. The part the incumbent quotes as a bespoke add-on.
---

1. **The position:** `npm run packhouse -- pools` shows every pool: trays packed, dispatched, sold, gross, and any dispatched trays with no sale recorded. `pool <name>` adds the per-grower returns; `returns` shows every grower across every pool.
2. **Recording proceeds:** when sale money lands, `sale <pool> --trays= --value= --consignment=<CON-ref>`. Do it the day the remittance arrives; every grower's statement moves with it.
3. **Reading returns to a grower:** gross share is pro-rata on trays packed into the pool, less the packing charge and levies per tray. Say plainly whether the pool is open (numbers move) or closed (final).
4. **Closing a pool:** `pool close <name>`. The CLI refuses while dispatched trays have no sale recorded, and there is no force flag: growers are paid from the pool, and closing it early short-pays every one of them. That refusal names the missing trays; chase the proceeds, record them, close it.
5. **The statements:** `npm run docs` renders a grower-return-statement per grower per pool, in the business's brand, with their fruit listed. Drafts only; a person sends them with the payment run.
6. A new season's pool: `pool add "<name>" --crop= --variety= --season= --packing-charge= --levy=`. Grading runs pack into the open pool for their crop and variety automatically.
