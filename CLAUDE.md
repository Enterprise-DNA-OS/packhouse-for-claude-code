# Packhouse for Claude Code: operating instructions

This file is the brain. Claude Code reads it at the start of every session. It says who this is for, how work gets done, and the one right way to do each recurring job.

## Who this is for

- **Business:** [YOUR PACKHOUSE], a [kiwifruit / avocado / apple / mixed crop] packhouse in [region, New Zealand]
- **Operator:** [YOUR NAME], [owner / packhouse manager / office manager]
- **The growers:** [roughly who: how many supply you, which are the big ones, who rings about packouts]
- **The markets:** [where fruit goes: which exporters or programmes, what stays domestic]
- **Who signs off a hold decision:** [name them now: when fruit is held on a spray breach, whose call is the residue test, the regrade or the dump]
- **What matters most:** [for example: no fruit ever packed without its diary, no export consignment ever late on assurance, every grower statement right first time]

Fill this in once. A worker with context knows. A worker without it guesses.

## How to work

1. **Take a brief, not a script.** The operator describes the outcome. You run the right command and present the answer.
2. **Read before you write.** Before drafting anything about a delivery, a consignment or a grower, read the whole card first: `delivery <ref>`, `consignment <ref>`, `grower <name>`.
3. **Plain language.** Short sentences. No filler. Numbers in tables. The industry's words, not software words: a bin, a delivery, a packout, a tray, a pallet, a consignment, a pool, a grower return, a spray diary, a withholding period, a GAP audit.
4. **Silent success, loud problems.** No play-by-play. Say what broke and what you did about it.
5. **Stop at the line.** Anything that sends, deletes, or goes to a grower, a buyer or MPI waits for a yes in this session.
6. **Never invent a fact.** Spray dates, withholding periods, weights, pick dates and money come from the docket, the diary, the label or the remittance. If a fact is missing, ask for that one fact.
7. **Never rule on residues or market access.** This system records the dates and enforces the gates; whether held fruit is saleable is a lab result and the operator's call, never yours.

## Routing table: one right way for each recurring job

| When the operator asks for... | Use this |
|---|---|
| What needs a decision today | `/attention` |
| A truck just arrived | `/receive` |
| The spray diary landed | `diary <ref>` |
| Fruit went over the grader | `/grade` |
| The intake board, one delivery | `/deliveries`, `delivery <ref>` |
| Held fruit: what do we do | resolve, `log`, then `release <ref> --note=` |
| What is in the coolstore | `/pallets`; move with `move <pallet> --room=` |
| Where did this pallet come from / go | `/trace` |
| Room temps, a check to record | `/coolstore`, `temp <room> --temp=` |
| Build a load-out, dispatch it | `/dispatch` |
| The assurance reference arrived | `assurance <CON-ref> --ref=` |
| Sale money landed | `sale <pool> --trays= --value= --consignment=` |
| Pools, grower money, close a pool | `/grower-returns` |
| A grower is on the phone | `/grower` first, then talk |
| Packout questions, the trend | `/packouts` |
| GAP certificates, audits due | `/orchards` |
| The season position | `/season` |
| The Monday review | `/weekly-review` |
| Are we compliant, what would an auditor find | `/compliance` |
| The grower's statement | `/draft-packout-statement`, `/draft-grower-statement` |
| The load-out paperwork | `/draft-consignment-manifest` |
| I spoke to them, note the file | `/log` |
| Bring us over from Radfords | `/import` |
| Change how this system works | `/customise` |
| A new page to look at | `/new-view` |

If an ask fits nothing here, run the CLI directly (`npm run packhouse -- help`) and then propose a new command for it.

## Hard rules

- **Fruit picked inside its spray withholding period is held, never received as normal stock.** The CLI refuses; `--hold --reason=` is the only door, and the hold sits on the attention list until the decision (residue test, cleared market, dump) is made and logged. Releasing a hold requires the reason on the record.
- **No delivery is graded without its spray diary.** The gate at `grade` has no override. Residues over an importing market's limit close that market for every grower in the programme.
- **No export consignment dispatches without its assurance reference, and there is no force flag.** `dispatch` refuses. Fruit from a block with an expired GAP certificate never joins an export consignment; `consign add` refuses that too.
- **No pool closes while dispatched trays have no sale proceeds recorded.** Growers are paid from the pool; closing it early short-pays every one of them. `pool close` refuses, and there is no force flag.
- **Nothing here connects to MPI, an exporter or a grower, and nothing sends.** Statements and manifests render to `docs-out/`, drafts to `drafts/`; a person sends.
- **Never delete records.** Growers become `former`, pallets dispatch, pools close with their history intact. The traceability record is the business's memory and, in a recall, its defence.
- **Never invent a record.** If a name or a reference is ambiguous, list the candidates and ask. The CLI already does this.
- The database is the source of truth. If the answer is not in it, say so.

## Words this business uses

- A **delivery** is one block's fruit arriving on one day: bins on a truck with a docket. It is `received`, `held` or `graded`.
- The **spray diary** is the grower's agrichemical record. The **withholding period** on each chemical's label sets the earliest legal pick date; picking inside it risks exceeding **MRLs** (maximum residue limits) in the destination market.
- A **packout** is what a delivery graded: class 1 trays (export money), class 2 trays, reject weight. The percentage is what survived the belt.
- A **pallet** is the unit the coolstore, the consignment and the trace all speak. **One step back, one step forward** is the traceability standard: pallet to block, pallet to buyer.
- A **consignment** is pallets leaving to one buyer. An export consignment carries its **assurance reference** (MPI official assurance / phytosanitary certification) or it does not leave.
- **GAP** (NZGAP or GLOBALG.A.P.) certification lives on the block. Export programmes buy from certified blocks; an expired certificate makes the fruit unsaleable to them.
- A **pool** collects sale proceeds per crop and variety. A **grower return** is that grower's pro-rata share of the pool, less the **packing charge** and **levies** per tray. Open pools move; closed pools are final.
- Paperwork rides with fruit: the docket, the diary, the **maturity clearance** where the crop needs one. Missing paperwork is loud here, on purpose.

## Where things live

- `scripts/packhouse.mjs` the CLI. `scripts/lib/db.mjs` picks `DATABASE_URL` (Postgres, Supabase) or the embedded database in `.data/`.
- `supabase/migrations/` the schema, plain SQL. `npm run migrate` applies it. Never edit an applied migration; add the next one.
- `.claude/commands/` the slash commands. Add one every time the same ask comes twice.
- `brand.json`, `views.json`, `documents.json` the HTML output: whose name is on it, what pages, what paperwork.
- `docs/compliance.md` the rules `/compliance` checks, each with its source. `docs/replace-radfords.md` moving off the incumbent. `docs/why-no-front-end.md` the honest trade-offs.
- `exports/` whole database dumps. `drafts/` and `docs-out/` anything written for a person to send.

Built by Enterprise DNA. Installed and run for you as part of Omni: https://enterprisedna.co/omni/instead-of/radfords
