---
description: Draft the grower return statements for a pool - each grower's trays, gross share, charges and net, with their fruit listed - in the business's brand. Drafts only, never sends.
---

1. Run `npm run docs -- grower-return-statement`. One file per grower per pool lands in `docs-out/grower-return-statement/`, in the brand from `brand.json`.
2. Before anything goes near a grower, check the pool: `pool <name>`. If it shows dispatched trays unsold, the statements are provisional and must say so; the pool's proceeds are not all in.
3. For a closed pool, the statement is final: it goes with the payment run. For an open pool, mark the draft clearly as at today's numbers.
4. **Nothing sends from here.** Statements are files; the operator sends them, with the payments.
