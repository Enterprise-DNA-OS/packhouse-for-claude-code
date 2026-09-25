<h1 align="center">Packhouse for Claude Code</h1>

<p align="center">
  <strong>The open-source fresh produce and packhouse system that is just a database and Claude Code.</strong>
</p>

<p align="center">
  Created by <a href="https://www.enterprisedna.co"><strong>Enterprise DNA</strong></a>. Free and open source. Works with Claude Code, Codex, OpenCode or Cursor.
</p>

<table align="center">
  <tr>
    <td align="center"><strong>Do it yourself</strong><br/>Clone it, run it, own it. Free, MIT.<br/><a href="#quick-start">Quick start</a></td>
    <td align="center"><strong>We customise it</strong><br/>Your fields, your rules, your Radfords data brought across.<br/><a href="https://calendly.com/sam-mckay/discovery-call">Book a call</a></td>
    <td align="center"><strong>We run it for you</strong><br/>Installed, connected and operated inside Omni. Setup fee, then a retainer.<br/><a href="https://enterprisedna.co/omni/instead-of/radfords">How it works</a></td>
  </tr>
</table>

<p align="center">
  <a href="#what-is-this">What is this</a> &bull;
  <a href="#why-no-front-end">Why no front end</a> &bull;
  <a href="#quick-start">Quick start</a> &bull;
  <a href="#the-commands">Commands</a> &bull;
  <a href="#compliance-checked-against-the-data">Compliance</a> &bull;
  <a href="#ten-questions-radfords-cannot-answer">Ten questions</a> &bull;
  <a href="#instead-of-radfords">Instead of Radfords</a> &bull;
  <a href="#want-it-installed-and-run-for-you">Installed for you</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-20+-339933?style=flat-square" alt="Node 20+" />
  <img src="https://img.shields.io/badge/PostgreSQL-any-336791?style=flat-square" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/PGlite-embedded-3ecf8e?style=flat-square" alt="PGlite" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" />
</p>

---

<!-- three-doors -->
<table align="center">
  <tr>
    <td align="center"><strong>Do it yourself</strong><br/>Clone it, run it, own it. Free, MIT.<br/><a href="#quick-start">Quick start</a></td>
    <td align="center"><strong>We customise it</strong><br/>Your fields, your rules, a web front end if you want one, your Radfords data brought across.<br/><a href="https://calendly.com/sam-mckay/discovery-call">Book a call</a></td>
    <td align="center"><strong>We run it for you</strong><br/>Installed, connected and operated inside Omni. Setup fee, then a retainer.<br/><a href="https://enterprisedna.co/omni/instead-of/radfords">How it works</a></td>
  </tr>
</table>

<p align="center">Works with Claude Code, Codex, OpenCode or Cursor (see <a href="AGENTS.md">AGENTS.md</a>).</p>

## What is this

Packhouse for Claude Code does the job you pay Radfords FreshPack, Prophet or a LINKFRESH-style ERP for, as a Postgres database and a set of Claude Code commands. There is no web front end. You open the folder in [Claude Code](https://claude.com/claude-code) and run the packhouse in plain language. It runs the right query, and it can answer questions the incumbent's dashboard cannot.

Packhouse management systems are quoted privately, priced as enterprise software, and installed as a project: the anchor case in this family is a business paying six figures a year for a field system that is, underneath, a handful of tables. What a packhouse actually needs to hold is ordinary: the growers and their blocks, the fruit coming in with its spray paperwork, what it graded, the pallets in the coolstore, the consignments going out, and the pool money coming back to growers. That is eleven Postgres tables, and grower payments, which the incumbent builds as a bespoke add-on, is two of them and a view.

This repo is that record over Postgres, with the asking done by the agent you already have:

```
/attention                        everything that wants a decision this morning, worst first
/receive                          a truck arrived: on the record, with the spray window gate at the door
/grade                            what it packed out: pallets build themselves into the store and the pool
/trace                            any pallet, one step back and one step forward, in seconds
/pallets                          the coolstore, oldest fruit first
/dispatch                         consignments out, with the export assurance gate built in
/coolstore                        every room, its band, its last reading; the audit record
/grower-returns                   pools, sales, and every grower's return at today's numbers
/grower                           one grower's whole season before you pick up the phone
/orchards                         the GAP register, expired certificates first
/compliance                       nine rules from the Act, the schemes and your own standards
/weekly-review                    the Monday review, written from three commands
```

The sharp edges are deliberate, because this is the domain where soft edges cost market access:

- **Fruit picked inside its spray withholding period is held, not received.** The CLI refuses it as normal stock; `--hold` with a reason is the only door, and the hold sits at the top of the attention list until someone decides: residue test, cleared market, or dump.
- **A delivery cannot be graded without its spray diary.** Residues over an importing market's limit close that market for every grower in the programme, and the diary is the only evidence the fruit was clear.
- **An export consignment cannot dispatch without its assurance reference**, and there is no force flag. Fruit from a block with an expired GAP certificate cannot join an export consignment at all.
- **A pool cannot close while dispatched trays have no sale proceeds recorded.** Growers are paid from the pool; closing it early short-pays every one of them.

**Nothing here connects to MPI or an exporter, and nothing sends.** Statements and manifests draft to files in your brand; a person sends them. Nothing here is legal advice.

## Why no front end

- The front end was only ever there because the database was hard to talk to. That is no longer true.
- Your season's record sits in plain Postgres tables you own. Any tool can read them. No export request, no access ending when a subscription does.
- No per-module pricing, no seats, no implementation project. Read [docs/why-no-front-end.md](docs/why-no-front-end.md) for the honest trade-offs too.

## Quick start

Sixty seconds, no database install (an embedded Postgres runs inside Node):

```bash
git clone https://github.com/Enterprise-DNA-OS/packhouse-for-claude-code.git
cd packhouse-for-claude-code
npm install
npm run demo
```

`npm run demo` creates the database, loads Maketu Coolpack (a demo Bay of Plenty packhouse with six growers, seven blocks, and a season going slightly wrong: avocados held on a spray window breach, a Hayward delivery blocked on a missing diary, an export consignment stuck nine days without its assurance reference, one block's GAP certificate expired, a coolroom reading out of range and 300 dispatched trays with no sale recorded), then prints the attention list, the season and the compliance check.

Then open the folder in Claude Code and type:

```
/attention
```

Try `/pallets`, `/grower-returns`, `trace PLT-4001`, `grower "Te Puna"`, `pool "SunGold 2026"`, `/weekly-review`. When you are ready for real data, delete `.data/` and start with `/import`.

Fill in the "Who this is for" block in [CLAUDE.md](CLAUDE.md), especially who signs off a hold decision, and put your name and colours in [brand.json](brand.json) so every statement and manifest carries them.

### Use it with your own Postgres or Supabase

Copy `.env.example` to `.env`, set `DATABASE_URL`, then `npm run migrate`. Same commands, shared data, no per-seat fee. A packhouse shares one database: each person clones the repo, points at the same `DATABASE_URL`, and works in their own Claude Code.

## The commands

| Command | What it does |
|---|---|
| `/attention` | Everything that wants a decision, worst first: held fruit outranks all. |
| `/receive` | A truck arrived: on the record with its spray history, and the withholding gate at the door. |
| `/grade` | What a delivery packed out; pallets build themselves into the store and the right pool. |
| `/deliveries` | The intake board: what is held, what is blocked on paperwork, what has sat too long. |
| `/trace` | Any pallet one step back (block, grower, spray record, GAP) and one step forward (consignment, assurance). |
| `/pallets` | The coolstore, oldest first. `move` shifts rooms. |
| `/dispatch` | Consignment out: create, load, assurance, dispatch. The export gates live here. |
| `/coolstore` | Every room, its band, its last reading. `temp` records a check. |
| `/grower-returns` | Pools, sales and every grower's return at today's numbers. `pool close` refuses while proceeds are missing. |
| `/grower` | One grower's season: blocks, GAP, packouts, stock, returns. Run it before the phone call. |
| `/orchards` | The GAP register, expired certificates first. |
| `/packouts` | Grading results and the trend, the numbers growers ring about. |
| `/season` | Kilograms in, trays out, in store, dispatched, and the money, on one screen. |
| `/weekly-review` | The Monday review, written from three commands. |
| `/compliance` | Nine rules from the Act, the schemes and your own standards, run against your records, sources cited. |
| `/draft-packout-statement` | The statement a grower gets after grading. Drafts only. |
| `/draft-grower-statement` | The return statement per grower per pool, with their fruit listed. Drafts only. |
| `/draft-consignment-manifest` | The load-out paperwork: every pallet with its trace and the assurance reference. Drafts only. |
| `/log` | A call, a result, a decision, onto the record the moment it happens. |
| `/import` | Bring the operation across from Radfords FreshPack or plain CSV. The import is the first audit. |
| `/customise` | Add a field, change a rule, rename things, in plain language. Writes and applies the migration. |
| `/new-view` | Add a read-only HTML dashboard from a description. |

Everything the commands do, the CLI does: `npm run packhouse -- help`. Any command takes `--json`.

### Documents and views, in your brand

```bash
npm run docs    # packout statements, grower return statements, consignment manifests, coolstore registers
npm run view    # the packhouse board and the registers, as read-only HTML dashboards
```

Both read [brand.json](brand.json), so your packhouse's name, logo and colours are one file away. Documents land in `docs-out/`, views in `views/`. Print either to PDF from the browser; the consignment manifest is the recall answer printed in advance. `/new-view` adds a view, `documents.json` adds a document.

## Compliance, checked against the data

`/compliance` runs the rules in [docs/compliance.md](docs/compliance.md) against your records and reports what is breached, each rule citing its source. The CLI enforces the sharpest ones at the gate: held fruit does not grade, diary-less fruit does not grade, an assurance-less export does not dispatch, an unreconciled pool does not close.

1. Every pallet traces one step back to a block and a pick date (Food Act 2014 traceability, every GAP scheme).
2. No fruit on the floor without its spray diary (NZGAP / GLOBALG.A.P., export MRL compliance).
3. No fruit picked inside its withholding period, unresolved (ACVM Act 1997 label directions).
4. No active block supplying fruit on an expired GAP certificate (export and retail programme requirements).
5. No export consignment moving without its assurance reference (MPI plant export requirements).
6. Every coolroom checked inside 24 hours and inside its band (export programme audit requirements; your bands).
7. No delivery ungraded past 72 hours (your own standard: condition is money).
8. No pallet in store past six weeks (your own standard; change it to your crop).
9. No pool with dispatched trays missing their sale proceeds (the grower supply agreement).

Nothing there is legal advice. It is the rule book you point the system at, and you change it to match your operation.

## Ten questions Radfords cannot answer

Every one of these is answered by the demo data today. Yours will be different, and that is the point.

1. Is there fruit on our floor right now that was picked inside its spray withholding period, and what is the plan for it?
2. Which deliveries cannot be graded because the spray diary never arrived, and which grower owes us paperwork most often?
3. Which export consignments are loaded but legally unable to leave, and how long have they sat?
4. Which blocks' GAP certificates lapse inside 30 days, and how many export trays came off each last season?
5. Which grower's packout is trending down run over run, and did the weather note on the grading run explain it?
6. What is every grower's return at today's numbers, charges shown, before the pool closes?
7. How many dispatched trays have no sale proceeds recorded, and which buyer is sitting on the money?
8. Which coolroom readings went out of range this month, with which fruit inside, and what did we do each time?
9. What is the oldest pallet in the store, whose fruit is it, and what has it cost in condition so far?
10. If this pallet number came back in a recall, how fast can we name the block, the pick date, the spray record and everything that travelled with it?

## Your first hour: ten things to ask for

Open the folder in Claude Code and say these in your own words. Each one changes the system to fit your operation.

1. "Put our growers and blocks in, with their real KPINs and GAP expiry dates."
2. "Put our logo and colours on the statements and the manifests, and change the business name to ours."
3. "Our kiwifruit pallets are 252 trays, not 240. Change the default."
4. "Add bin tracking: which bins are at which orchard, and who owes us bins."
5. "Import our Radfords exports, then show me what the old system never told us."
6. "Add a compliance rule: no avocado delivery without a dry matter clearance reference."
7. "Track our coolstore units' service dates like the GAP register tracks audits."
8. "Build a page per grower for the field rep: their blocks, deliveries, packouts and returns."
9. "When I dispatch an export consignment, render the manifest in the same breath."
10. "Write a command that drafts the end-of-season summary per grower from the pools and the packouts."

`/customise` writes the migration, applies it, updates every command that touches the change, and runs the tests.

## Instead of Radfords

Export your growers, blocks and deliveries from FreshPack (or anything that exports CSV), run one command, and the record comes with you. Step by step, with what maps and what deliberately does not carry over: [docs/replace-radfords.md](docs/replace-radfords.md).

```bash
npm run packhouse -- import radfords --growers=growers.csv --orchards=blocks.csv --deliveries=deliveries.csv --dry-run
npm run packhouse -- import radfords --growers=growers.csv --orchards=blocks.csv --deliveries=deliveries.csv
```

The import is the first audit: an imported block with an expired GAP certificate, or a delivery with no spray diary flag, is loud the moment the import finishes.

## Architecture

```
packhouse-for-claude-code/
  CLAUDE.md                 how the business wants this run (routing table + house rules)
  AGENTS.md                 the same, for Codex / OpenCode / Cursor / Gemini CLI
  brand.json                your packhouse's name, logo and colours on every statement and manifest
  views.json                the HTML dashboards npm run view renders
  documents.json            the paperwork npm run docs renders
  .claude/commands/         the slash commands
  scripts/packhouse.mjs     the CLI the commands drive
  scripts/view.mjs          read-only HTML dashboards from the SQL views
  scripts/docs.mjs          the documents, one HTML file per record
  scripts/lib/db.mjs        one adapter: DATABASE_URL (pg) or embedded PGlite
  supabase/migrations/      plain SQL schema, tables and views
  supabase/seed.sql         demo data
  docs/compliance.md        the rules /compliance checks, each with its source
  docs/replace-radfords.md  moving off the incumbent
  docs/why-no-front-end.md  the honest trade-offs
  exports/                  whole database dumps
  drafts/                   anything written for a person to send
```

## Built with Claude Code

This repository was built with Claude Code as the primary development tool, from the schema to the commands, and it is meant to be extended the same way. Ask for a new command and it writes one.

## Contributing

Issues and pull requests are welcome. Keep the shape: plain SQL, a small CLI, a slash command per recurring job, no front end, no MPI credentials, nothing that sends, and the spray, assurance and pool gates stay.

## Want it installed and run for you?

Enterprise DNA installs Packhouse for Claude Code for your operation, migrates your Radfords data, writes your crop's rituals in as commands, and runs it for you as part of **Omni**, our managed Command Center. One setup fee, then a monthly retainer.

- Book a call: https://calendly.com/sam-mckay/discovery-call
- Read more: https://enterprisedna.co/omni/instead-of/radfords

## License

MIT. Copyright (c) 2026 Enterprise DNA.
