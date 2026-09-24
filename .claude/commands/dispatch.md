---
description: Fruit out the door - build a consignment, load pallets onto it, record the assurance reference, dispatch. The export gates live here and they have no force flags.
---

The pipeline, in order:

1. **Open it:** `npm run packhouse -- consign create --buyer="..." [--destination= --export --carrier=]`
2. **Load it:** `consign add <pallet> --to=<CON-ref>`, one pallet at a time. Two refusals are the system working:
   - A pallet from a block whose GAP certificate is expired (or missing) does not join an **export** consignment. Export programmes buy from certified blocks. Sell it domestic or fix the certificate.
   - A pallet already dispatched or already on another consignment stays where it is.
3. **The assurance reference** (export only): when MPI's official assurance / phyto reference is issued, `assurance <CON-ref> --ref=`. Until then the consignment simply will not dispatch, and that is deliberate: fruit that ships without it is a market-access incident for the whole programme, not a paperwork gap.
4. **Dispatch:** `dispatch <CON-ref> [--on= --carrier=]`. Pallets mark dispatched and leave the store.
5. **The manifest** drafts with `npm run docs` (consignment-manifest): every pallet with its grower, block and pick date, the trace an auditor asks for. A person sends it.
6. **The money:** when the proceeds land, `sale <pool> --trays= --value= --consignment=<CON-ref>` so the growers' pools move. A dispatched tray with no sale recorded blocks its pool from closing.

`consignments` shows what is open; a consignment loaded and going nowhere for a week surfaces on `/attention` by itself.
