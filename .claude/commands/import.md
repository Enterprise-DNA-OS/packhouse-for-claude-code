---
description: Bring the operation across from Radfords FreshPack or plain CSV - growers, blocks, deliveries - dry run first, and the import is the first audit - expired certificates and missing spray diaries surface immediately.
---

1. Read [docs/replace-radfords.md](../../docs/replace-radfords.md) with the operator: which exports to pull from the incumbent, what maps, what deliberately does not carry over.
2. Dry run first, always:
   ```
   npm run packhouse -- import radfords --growers=growers.csv --orchards=blocks.csv --deliveries=deliveries.csv --dry-run
   ```
   Read the counts and the skips back to the operator. A skipped row is named, never silent.
3. Run it for real (drop `--dry-run`), then prove it landed: `stats`, `attention`, `compliance`.
4. **The import is the first audit.** An imported block with an expired GAP certificate, or an imported delivery with no spray diary flag, is loud the moment the import finishes. If the paperwork exists, record it; if it does not, the operator just learned the most important thing the old system never told them.
5. Column names are matched generously (Name/Grower/Supplier, Orchard/Block/KPIN, Kg/Weight, and so on). If a file's headers match nothing, show the operator the first row and map it together, then use `csv` as the source.
