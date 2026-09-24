---
description: A delivery went over the grader. Record what it packed out - class 1 trays, class 2 trays, reject weight - and the pallets build themselves into the coolstore and the right pool.
---

1. Confirm which delivery: `npm run packhouse -- deliveries` shows the floor. The grader's tally gives class 1 trays, class 2 trays and reject weight.
2. Run it:
   ```
   npm run packhouse -- grade <DEL-ref> --class1= --class2= --reject-kg= [--room="Room 1"] [--trays-per-pallet=240] [--on=]
   ```
3. The CLI refuses two things, and both refusals are correct:
   - **No spray diary on record.** Grading is blocked until `diary <ref>` records it. Residues over an export market's limit close that market for every grower in the programme.
   - **Held fruit.** The hold gets resolved and logged first (`release <ref> --note=`), never graded through.
4. Pallets are built automatically, chunked by grade, into the named room, and assigned to the open pool for that crop and variety. If the CLI says no pool matched, create one (`pool add`) before the season's money gets untidy.
5. Read back the packout: the percentage, the class 1 share, and the pallet numbers. A packout well below the grower's usual run deserves a sentence, not silence: check `packouts --grower=` for the trend.
6. The grower's packout statement drafts with `npm run docs` (packout-statement). A person sends it.
