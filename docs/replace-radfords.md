# Moving off Radfords

Radfords FreshPack (and the Prophet / LINKFRESH-style systems in the same family) holds three things you need back before anything else: your growers, their orchard blocks with certification, and the delivery history. All of them export, and one command brings them across.

## 1. Export from FreshPack

Pull the reports you already run, saved as CSV (XLSX saves as CSV from Excel):

- **Growers / suppliers** with name, code and contact columns.
- **Orchards / blocks** with the block or KPIN code, grower, crop, variety, and the GAP scheme and certificate expiry if your setup records them.
- **Deliveries / intake** with the block, received date, pick date, bins, weight, and any spray diary flag or status column.

If a register only prints, print it to CSV. The mapping below matches column names generously; the raw export is enough.

## 2. Dry run, then import

```bash
npm run packhouse -- import radfords --growers=growers.csv --orchards=blocks.csv --deliveries=deliveries.csv --dry-run
npm run packhouse -- import radfords --growers=growers.csv --orchards=blocks.csv --deliveries=deliveries.csv
```

The dry run prints exactly what the real run will create, update and skip; nothing is skipped silently. Then prove it landed:

```bash
npm run packhouse -- stats
npm run packhouse -- attention
npm run packhouse -- compliance
```

**The import is the first audit.** An imported block with an expired GAP certificate, or an imported delivery with no spray diary flag, is loud the moment the import finishes. If the paperwork exists, record it (`diary <ref>`, update the block); if it does not, you just learned the most important thing the old system never told you.

## What maps

| FreshPack | Here |
|---|---|
| Growers / suppliers | `growers`, with code and contact |
| Orchards / blocks / KPINs | `orchards`, with crop, variety and GAP certificate expiry |
| Deliveries / intake dockets | `deliveries`, with bins, weight, pick date and the diary flag |
| Graded / packed status | delivery status, so history does not reappear as work |
| Grower payment settings | `pools` (you create these fresh: `pool add` with your season's charges) |

Grading history, pallet history and old consignments generally stay in the old system as archive: this system's traceability guarantees start from the day you switch, and mixing half-imported pallet history into them weakens both. Keep the final FreshPack export (`export` here does the same job going forward) as the archive of record.

## What deliberately does not carry over

- **Screen layouts, custom forms and label designs.** The facts the forms collected live on in the rows; the form builder does not. New recurring questions become columns (`/customise`) or commands.
- **The workflow engine.** Approval chains and status flows are the incumbent's product, not your data. Here the pipeline is the gates: held fruit does not grade, diary-less fruit does not grade, assurance-less exports do not leave, unreconciled pools do not close.
- **Device integrations (graders, scales, label printers).** Those talk to whatever they talked to before; the counts they produce are typed or imported here. A direct feed is a customisation Enterprise DNA builds when it earns its keep.

## The first season cutover, in order

1. Import growers and blocks. Check the GAP register: `orchards`.
2. Create the season's pools with your real charges: `pool add "SunGold 2027" --crop=kiwifruit --variety=SunGold --packing-charge= --levy=`.
3. Add the coolrooms with your real bands: `add room "Room 1" --min=0 --max=2`.
4. Run the intake live from day one: `/receive` at the door, `/grade` off the belt.
5. Keep FreshPack read-only for one season as the archive, then archive the export.
