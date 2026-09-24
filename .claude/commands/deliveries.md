---
description: The intake board - what is on the floor, what is held, what is waiting on paperwork, what has sat too long. One delivery's full card by reference.
---

1. `npm run packhouse -- deliveries` shows the floor: received, held, waiting on diaries. `--all` includes graded history, `--grower=` filters, `--status=held` isolates the holds.
2. One delivery: `npm run packhouse -- delivery <ref>`. The card carries the spray window (last spray + withholding = clear date), the diary state, the grading runs, the pallets and the log.
3. Read the flags out loud, in this order: HELD (a decision is waiting), diary MISSING (grading blocked), then anything older than three days (condition is money).
4. The next verb for each state:
   - `held` -> resolve and `release <ref> --note=`, or log the dump decision
   - diary missing -> chase the grower, then `diary <ref>`
   - `received` and clean -> `grade <ref> --class1= --class2= --reject-kg=`
