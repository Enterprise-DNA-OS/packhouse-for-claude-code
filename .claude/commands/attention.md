---
description: Everything that wants a decision this morning, worst first. Held fruit, missing spray diaries, blocked export consignments, the coolstore, expired GAP certificates, ungraded bins, missing pool proceeds and aged stock.
---

1. Run `npm run packhouse -- attention`.
2. The list is already ordered by how much each item can cost. Read it in that order and do not reorder it by ease:
   - **Fruit held on a spray window breach** outranks everything. It is a legal and market-access problem losing condition on the pad. The decision is one of three: residue test, a cleared market, or the dump. Log it, then `release <ref> --note=`.
   - **A delivery with no spray diary** cannot be graded, and the grower is the only fix. Chase them today: `diary <ref>`.
   - **An export consignment missing its assurance reference** cannot leave, and the buyer is waiting. `assurance <ref> --ref=` the moment it is issued.
   - **A coolroom out of range with fruit in it** is a same-day decision: check the plant, move the fruit, record what you did.
   - **An expired GAP certificate** makes that block's fruit unsaleable to export the day it lapsed. Book the audit; the CLI already keeps the fruit out of export consignments.
   - **Ungraded bins, missing pool proceeds, aged pallets, quiet rooms** are condition and money leaking quietly.
3. For each item, say the one action: the command to run, the grower to ring, or the decision to make. Name who.
4. Anything that needs paper is drafted, never sent: `npm run docs`, a person sends.

If the operator asks "what should I do today", pick the top three and say why those three.
