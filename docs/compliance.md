# The rule book `/compliance` runs

Nine rules, each with its source, each checked against the live records by `npm run packhouse -- compliance`. The CLI enforces the sharpest ones at the gate; the rest are checks that report. Change any of them to match your operation: the rule, the threshold and the check live together (`/customise` edits both).

**None of this is legal advice.** These are the rules this business has told the system to enforce, with the sources they came from. What the law and your export programme actually require of you is between you, MPI, your certifier and your exporter; the sections below are the reading list, not the reading.

## 1. Every pallet traces one step back to a block and a pick date

**Source:** Food Act 2014 traceability duties for food businesses, and every GAP scheme (NZGAP, GLOBALG.A.P.): product must be traceable one step back (which block, picked when) and one step forward (who it went to). In a recall, the speed of this answer is the size of the recall.

**The check:** any pallet whose delivery has no pick date or whose block has no code.

**The gate:** the schema itself. A pallet belongs to a grading run, a run to a delivery, a delivery to a block, a block to a grower. `trace <pallet>` walks it in seconds.

## 2. No fruit on the floor without its spray diary

**Source:** NZGAP and GLOBALG.A.P. require the agrichemical record before fruit is packed; export MRL (maximum residue limit) compliance depends on it. A residue over an importing market's limit closes that market for every grower in the programme, not just the one who sprayed.

**The check:** any received delivery with `spray_diary_received` false.

**The gate:** `grade` refuses a diary-less delivery, with no override. `diary <ref>` unblocks it.

## 3. No fruit picked inside its spray withholding period, unresolved

**Source:** Agricultural Compounds and Veterinary Medicines Act 1997: the label is law, and the withholding period (pre-harvest interval) on each agrichemical's label sets the earliest legal pick date. Fruit picked inside it risks exceeding MRLs.

**The check:** any delivery where the pick date is before last spray plus withholding days, not yet resolved.

**The gate:** `receive` refuses such fruit as normal stock; `--hold --reason=` is the only door, and `release` requires the decision on the record (residue result, cleared market, or dump).

## 4. No active block supplying fruit on an expired GAP certificate

**Source:** export programmes and most retail programmes buy only from GLOBALG.A.P. or NZGAP certified orchards. The certificate expiring makes the block's fruit unsaleable to those programmes the day it lapses, whatever its condition.

**The check:** any active block whose certificate expiry is in the past. (The attention list starts nagging 30 days out.)

**The gate:** `consign add` refuses a pallet from an expired or uncertified block onto an export consignment.

## 5. No export consignment moving without its assurance reference

**Source:** MPI plant export requirements: export consignments of fresh produce carry official assurance (phytosanitary certification) appropriate to the destination market. Shipping without it is a market-access incident for the whole programme.

**The check:** any export consignment with pallets loaded and no assurance reference, open or dispatched.

**The gate:** `dispatch` refuses an export consignment with no reference, and there is no force flag. `assurance <ref> --ref=` records it.

## 6. Every coolroom checked inside 24 hours and inside its band

**Source:** export programme and customer audit requirements: a continuous cold chain record per room. The bands are this business's own standards for the fruit each room holds (the demo runs kiwifruit at 0 to 2 C and Hass avocados at 4 to 7 C); the record proves the fruit lived inside them.

**The check:** any active room with no check in 24 hours, no check ever, or a last reading outside its band.

**The paper:** `npm run docs` renders the per-room register (last 14 days) for the auditor.

## 7. No delivery ungraded past 72 hours

**Source:** this business's own standard. Fruit is condition and condition is money; bins sitting on the pad lose both, and the grower is watching. Change the threshold to your crop's reality.

**The check:** any received delivery with its diary on record, older than three days.

## 8. No pallet in store past six weeks

**Source:** this business's own standard. Storage life is finite, class 2 fruit does not improve, and coolstore space costs money. Six weeks is the tap on the shoulder; your crop, your coolstore and your market set the real number.

**The check:** any in-store pallet packed more than 42 days ago.

## 9. No pool with dispatched trays missing their sale proceeds

**Source:** the grower supply agreement. Growers are paid their pro-rata share of the pool less charges; dispatched trays with no sale recorded are money missing from every grower's statement.

**The check:** any open pool where dispatched trays exceed sold trays.

**The gate:** `pool close` refuses such a pool, and there is no force flag.
