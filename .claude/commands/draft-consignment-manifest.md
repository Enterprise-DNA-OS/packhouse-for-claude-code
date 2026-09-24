---
description: Draft the consignment manifest - every pallet with its grower, block, pick date and the assurance reference - the trace an auditor or a buyer asks for, in the business's brand. Drafts only, never sends.
---

1. Run `npm run docs -- consignment-manifest`. One file per consignment with pallets lands in `docs-out/consignment-manifest/`.
2. For an export consignment, check the assurance line before the manifest goes anywhere: NOT YET ON RECORD on a manifest is a stop, not a footnote. Record it first: `assurance <ref> --ref=`.
3. The pallet table is the one-step-back trace for everything on the truck: pallet, grade, trays, grower, block, pick date. This is the recall answer, printed in advance.
4. **Nothing sends from here.** The manifest is a file; the operator sends it with the load-out paperwork.
