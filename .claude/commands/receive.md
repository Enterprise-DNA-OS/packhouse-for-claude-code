---
description: Fruit arrived at the door. Put the delivery on the intake record with its spray history, and let the gates do their job - fruit picked inside its withholding period is held, not received.
---

1. Get the facts from the docket and the grower's paperwork: which block, how many bins, the weight, the pick date, the last spray date and the label withholding period, and whether the spray diary came with it.
2. Run it:
   ```
   npm run packhouse -- receive "<block name or code>" --bins= --kgs= --picked= --last-spray= --withholding= [--diary] [--maturity=]
   ```
3. **If the CLI refuses because the fruit was picked inside the withholding period, that refusal is the system working.** Do not work around it. Tell the operator plainly, then receive it held with the next step recorded:
   ```
   npm run packhouse -- receive "<block>" ... --hold --reason="residue sample to the lab; grower notified"
   ```
   Held fruit sits at the top of `/attention` until someone decides: residue test, a cleared market, or the dump.
4. If the spray diary did not come with the truck, the delivery lands blocked from grading. Say so, and say who is chasing it. When it arrives: `diary <ref> --last-spray= --withholding=`.
5. Read back the minted reference and the next step the CLI printed.

Never invent a spray date or a withholding period. They come from the diary and the label, or they are missing, loudly.
