---
description: The GAP register - every block with its certificate scheme, expiry and state, expired first. The list that keeps export fruit saleable.
---

1. Run `npm run packhouse -- orchards`. Expired certificates sort first, then expiring inside 30 days.
2. For every EXPIRED or expiring block, the action is the same: book the audit, and say out loud that the block's fruit stays out of export consignments until the certificate is current (the CLI enforces it at `consign add`).
3. A renewed certificate is recorded on the block; ask the operator for the new expiry date and update it through `/customise` or a direct update, then prove it: `orchards` again.
4. The printable register is in `npm run view` (registers page), in the business's brand, for the wall or the auditor.
