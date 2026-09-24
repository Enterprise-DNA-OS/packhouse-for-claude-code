---
description: Draft the packout statement a grower gets after their fruit is graded - the delivery, what it graded, the pallets - in the business's brand. Drafts only, never sends.
---

1. Run `npm run docs -- packout-statement` (every graded delivery) or with an id prefix for one. Files land in `docs-out/packout-statement/`, one per grading run, in the brand from `brand.json`.
2. Open the one you need and check it reads like the phone call it replaces: the block, the pick date, the packout percentage, the class 1 share, the pallets and where they went.
3. If the grower's packout dropped against their trend (`packouts --grower=`), draft the covering sentence for the operator: what the belt saw, in plain words, in `drafts/`.
4. **Nothing sends from here.** The statement is a file; the operator emails or prints it.
