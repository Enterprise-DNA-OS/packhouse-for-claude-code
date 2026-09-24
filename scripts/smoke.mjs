#!/usr/bin/env node
// End-to-end smoke test on a throwaway embedded database.
// Runs migrate, seed, then every CLI command that matters, and asserts on the JSON.
// Passes on Windows and Linux. No network, no Postgres install.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(path.join(tmpdir(), 'packhouse-smoke-'));
const env = { ...process.env, DATA_DIR: dataDir };
delete env.DATABASE_URL; // the smoke test always runs embedded

let step = 0;
function run(label, args, { json = true, expectFail = false } = {}) {
  step++;
  const argv = [path.join(root, 'scripts', args[0]), ...args.slice(1), ...(json ? ['--json'] : [])];
  const res = spawnSync(process.execPath, argv, { cwd: root, env, encoding: 'utf8' });
  const ok = expectFail ? res.status !== 0 : res.status === 0;
  if (!ok) {
    console.error(`\nFAIL step ${step} (${label}): exit ${res.status}\n--- stdout\n${res.stdout}\n--- stderr\n${res.stderr}`);
    process.exit(1);
  }
  console.log(`  ok  ${String(step).padStart(2)}  ${label}`);
  if (!json || expectFail) return { stdout: res.stdout, stderr: res.stderr };
  try {
    return JSON.parse(res.stdout);
  } catch {
    console.error(`\nFAIL step ${step} (${label}): output is not JSON\n${res.stdout}\n${res.stderr}`);
    process.exit(1);
  }
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`\nFAIL assertion: ${msg}`);
    process.exit(1);
  }
}

const n = (v) => Number(v ?? 0);

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
// Local date, the same way the CLI computes "today". Never UTC: New Zealand is
// twelve hours ahead of it.
const todayIso = (() => {
  const d = new Date();
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
})();

console.log(`smoke: data dir ${dataDir}`);
try {
  run('migrate', ['migrate.mjs'], { json: false });
  run('migrate again (idempotent)', ['migrate.mjs'], { json: false });
  run('seed', ['seed.mjs'], { json: false });
  run('seed again (idempotent)', ['seed.mjs'], { json: false });

  // ---- the business ---------------------------------------------------------

  const growers = run('growers', ['packhouse.mjs', 'growers']);
  assert(growers.length === 6, `six growers (${growers.length})`);
  assert(growers.every((g) => n(g.blocks) >= 1), 'every grower has at least one block');

  const grower = run('grower card', ['packhouse.mjs', 'grower', 'Te Puna']);
  assert(grower.grower.code === 'TEPU', 'resolved by partial name');
  assert(grower.orchards.length === 2, 'with both blocks');
  assert(grower.returns.some((r) => r.pool === 'SunGold 2026' && n(r.net_return) > 0), 'and a live SunGold return');

  const noSuch = run('an unknown grower exits 1', ['packhouse.mjs', 'grower', 'nobody at all'], { json: false, expectFail: true });
  assert(/No grower matches/.test(noSuch.stderr), 'and says so plainly');

  const ambiguous = run('an ambiguous name exits 1 and lists candidates', ['packhouse.mjs', 'grower', 'a'], { json: false, expectFail: true });
  assert(/matches \d+ grower records/.test(ambiguous.stderr), 'with the candidates listed');

  const orchards = run('the GAP register', ['packhouse.mjs', 'orchards']);
  assert(orchards.length === 7, `seven blocks (${orchards.length})`);
  assert(orchards[0].gap === 'EXPIRED' && orchards[0].block_code === 'KPIN-10455', 'the expired certificate sorts first');
  assert(orchards.some((o) => o.gap === 'expiring'), 'and the expiring one is flagged');

  // ---- intake ---------------------------------------------------------------

  const deliveries = run('deliveries on the floor', ['packhouse.mjs', 'deliveries']);
  assert(deliveries.length === 4, `four on the floor (${deliveries.length})`);
  const all = run('deliveries --all', ['packhouse.mjs', 'deliveries', '--all']);
  assert(all.length === 9, `nine on the record (${all.length})`);

  const del505 = run('the held delivery card', ['packhouse.mjs', 'delivery', 'DEL-505']);
  assert(del505.delivery.status === 'held' && del505.delivery.phi_breach === true, 'DEL-505 is held on a spray window breach');
  assert(del505.notes.length === 1, 'with the decision trail started');

  const del504 = run('a delivery by bare number', ['packhouse.mjs', 'delivery', '504']);
  assert(del504.delivery.ref === 'DEL-504', 'DEL-504 resolves from "504"');
  assert(del504.delivery.spray_diary_received === false, 'and its spray diary is missing');

  const byGrower = run('deliveries filtered by grower', ['packhouse.mjs', 'deliveries', '--grower=Rangiuru', '--all']);
  assert(byGrower.length === 2 && byGrower.every((d) => d.grower === 'Rangiuru Fruit Co'), 'grower filter holds');

  // ---- packouts, pallets, the trace -----------------------------------------

  const packouts = run('packouts', ['packhouse.mjs', 'packouts']);
  assert(packouts.length === 5, `five grading runs (${packouts.length})`);
  const run502 = packouts.find((p) => p.delivery_ref === 'DEL-502');
  assert(n(run502.packout_pct) === 85.5 && n(run502.total_trays) === 1640, 'DEL-502 packs out at 85.5%');

  const pallets = run('pallets in store', ['packhouse.mjs', 'pallets']);
  assert(pallets.length === 18, `eighteen pallets in store (${pallets.length})`);
  assert(pallets[0].pallet_no === 'PLT-4024' && n(pallets[0].days_in_store) === 49, 'the aged class 2 pallet sorts first');

  const byRoom = run('pallets filtered by room', ['packhouse.mjs', 'pallets', '--room=Room 3']);
  assert(byRoom.length === 3 && byRoom.every((p) => p.room === 'Room 3'), 'room filter holds');

  const trace = run('trace a pallet back to the block', ['packhouse.mjs', 'trace', 'PLT-4001']);
  assert(trace.orchard.block_code === 'KPIN-10231' && trace.delivery.ref === 'DEL-501', 'one step back: block and delivery');
  assert(trace.consignment.ref === 'CON-301' && trace.consignment.assurance_ref === 'OAP-2026-1188', 'one step forward: consignment and assurance');

  // ---- consignments and the coolstore ---------------------------------------

  const cons = run('open consignments', ['packhouse.mjs', 'consignments']);
  assert(cons.length === 2, `two open (${cons.length})`);
  const con302 = cons.find((c) => c.ref === 'CON-302');
  assert(con302.assurance === 'MISSING' && n(con302.pallet_count) === 2, 'CON-302 is loaded and missing its assurance');

  const conCard = run('consignment card', ['packhouse.mjs', 'consignment', 'CON-300']);
  assert(n(conCard.consignment.trays) === 900 && conCard.pallets.length === 4, 'CON-300 carried 900 trays on four pallets');

  const coolstore = run('coolstore', ['packhouse.mjs', 'coolstore']);
  assert(coolstore.length === 3, 'three rooms');
  assert(coolstore.find((r) => r.room === 'Room 3').state === 'OUT OF RANGE', 'Room 3 is out of range');
  assert(coolstore.find((r) => r.room === 'Room 2').state === 'QUIET', 'Room 2 has gone quiet');

  // ---- pools and grower returns ----------------------------------------------

  const pools = run('pools', ['packhouse.mjs', 'pools']);
  assert(pools.length === 3, 'three pools');
  const hayward = pools.find((p) => p.pool === 'Hayward 2026');
  assert(n(hayward.trays_dispatched) === 900 && n(hayward.trays_sold) === 600 && n(hayward.trays_unsold) === 300,
    'the Hayward pool is missing proceeds for 300 dispatched trays');

  const sungold = run('pool card', ['packhouse.mjs', 'pool', 'SunGold 2026']);
  assert(n(sungold.pool.gross_sales) === 84480, 'the SunGold pool holds its sales');
  assert(sungold.returns.length === 2, 'two growers in the SunGold pool: pooling shares proceeds even though only one grower\'s fruit shipped');
  const tepu = sungold.returns.find((r) => r.grower === 'Te Puna Orchards Ltd');
  // TEPU has 1270 of the 2320 SunGold trays packed: gross share
  // 84480 * 1270/2320 = 46245.52, less packing 1270 * 3.10 and levies 1270 * 0.45.
  assert(n(tepu.trays) === 1270, `TEPU packed 1270 SunGold trays (${tepu.trays})`);
  assert(Math.abs(n(tepu.gross_share) - 46245.52) < 0.02, `pro-rata gross share (${tepu.gross_share})`);
  assert(Math.abs(n(tepu.net_return) - (46245.52 - 1270 * 3.55)) < 0.02, `net after charges (${tepu.net_return})`);

  const returns = run('returns across pools', ['packhouse.mjs', 'returns']);
  assert(returns.length >= 5, 'every grower with trays in a pool has a line');

  run('season', ['packhouse.mjs', 'season']);

  // ---- attention and compliance -----------------------------------------------

  const attention = run('attention', ['packhouse.mjs', 'attention']);
  assert(attention.length >= 11, `the attention list is loud (${attention.length})`);
  assert(attention[0].reason === 'phi_hold', 'the spray window hold outranks everything');
  for (const reason of ['phi_hold', 'spray_diary_missing', 'assurance_missing', 'coolstore_out_of_range', 'gap_expired', 'delivery_ungraded', 'pool_unsold', 'pallet_aged', 'consignment_stale', 'coolstore_quiet', 'gap_expiring']) {
    assert(attention.some((a) => a.reason === reason), `attention carries ${reason}`);
  }

  const compliance = run('compliance', ['packhouse.mjs', 'compliance']);
  assert(compliance.length === 9, 'nine rules in the book');
  const failed = compliance.filter((r) => r.breaches.length);
  assert(failed.map((r) => r.key).sort().join(',') === 'aged_stock,assurance,coolchain,gap,grading,phi,pool_integrity,spray_diary',
    `the seeded breaches are exactly the story (${failed.map((r) => r.key).join(',')})`);
  assert(!failed.some((r) => r.key === 'traceability'), 'every pallet traces: the schema makes that hard to break');

  const oneRule = run('one compliance rule', ['packhouse.mjs', 'compliance', 'assurance']);
  assert(oneRule.length === 1 && oneRule[0].breaches.length === 1, 'run one rule on its own');

  run('stats', ['packhouse.mjs', 'stats']);

  // ---- the spray gates, end to end ----------------------------------------------

  const phiRefused = run('receiving fruit picked inside the withholding period is refused', ['packhouse.mjs', 'receive', 'Bledisloe Grove',
    '--bins=8', '--kgs=2100', `--picked=${todayIso}`, `--last-spray=${addDays(todayIso, -5)}`, '--withholding=14'], { json: false, expectFail: true });
  assert(/withholding period/.test(phiRefused.stderr) && /--hold/.test(phiRefused.stderr), 'and the refusal explains the hold path');

  const holdNoReason = run('--hold without the reason is refused', ['packhouse.mjs', 'receive', 'Bledisloe Grove',
    '--bins=8', '--kgs=2100', `--picked=${todayIso}`, `--last-spray=${addDays(todayIso, -5)}`, '--withholding=14', '--hold'], { json: false, expectFail: true });
  assert(/--reason/.test(holdNoReason.stderr), 'a hold with no plan is fruit rotting quietly');

  const held = run('with --hold and a reason it lands held', ['packhouse.mjs', 'receive', 'Bledisloe Grove',
    '--bins=8', '--kgs=2100', `--picked=${todayIso}`, `--last-spray=${addDays(todayIso, -5)}`, '--withholding=14',
    '--hold', '--reason=Residue sample to the lab this afternoon.', '--diary']);
  assert(/^DEL-\d+$/.test(held.ref) && held.status === 'held', `the ref is minted and held (${held.ref})`);

  const gradeHeld = run('grading held fruit is refused', ['packhouse.mjs', 'grade', held.ref, '--class1=100'], { json: false, expectFail: true });
  assert(/HELD/.test(gradeHeld.stderr), 'held fruit does not go over the grader');

  const releaseNoNote = run('release without the reason is refused', ['packhouse.mjs', 'release', held.ref], { json: false, expectFail: true });
  assert(/decision/.test(releaseNoNote.stderr), 'decisions get recorded');

  run('release with the result on the record', ['packhouse.mjs', 'release', held.ref, '--note=Lab result 0.9 ppm, under the market limit. Cleared to pack.']);

  const gradeNoDiary = run('grading without a spray diary is refused', ['packhouse.mjs', 'grade', 'DEL-504', '--class1=100'], { json: false, expectFail: true });
  assert(/spray diary/.test(gradeNoDiary.stderr), 'and the refusal says why it matters');

  run('the diary lands', ['packhouse.mjs', 'diary', 'DEL-504', `--last-spray=${addDays(todayIso, -60)}`, '--withholding=14']);

  const graded = run('now it grades, and pallets build themselves', ['packhouse.mjs', 'grade', 'DEL-504',
    '--class1=1120', '--class2=210', '--reject-kg=1010', '--room=Room 2']);
  assert(graded.pallets.length === 6, `six pallets built (${graded.pallets.length})`);
  assert(graded.pallets.filter((p) => p.grade === 'class1').reduce((s, p) => s + n(p.trays), 0) === 1120, 'class 1 trays chunk correctly');
  assert(graded.pallets.every((p) => p.pool_id), 'and every pallet lands in the Hayward pool');

  const sprayRule = run('the spray diary breach clears', ['packhouse.mjs', 'compliance', 'spray_diary']);
  assert(sprayRule[0].breaches.length === 0, 'no diary-less fruit on the floor');

  // ---- the dispatch gates ------------------------------------------------------------

  run('a pallet from a certified block loads onto CON-302', ['packhouse.mjs', 'consign', 'add', 'PLT-4005', '--to=CON-302']);
  const con302After = run('CON-302 took the certified pallet', ['packhouse.mjs', 'consignment', 'CON-302']);
  assert(n(con302After.consignment.pallet_count) === 3, 'three pallets loaded now');

  run('grade the expired-GAP SunGold so there is a pallet to refuse', ['packhouse.mjs', 'grade', 'DEL-503', '--class1=700', '--class2=130', '--reject-kg=412', '--room=Room 1']);
  const kaurPallets = run('find the Kauri Point pallets', ['packhouse.mjs', 'pallets', '--grower=Kauri Point']);
  const kaurPallet = kaurPallets[0];
  const expiredRefused = run('an expired GAP block cannot join an export consignment', ['packhouse.mjs', 'consign', 'add', kaurPallet.pallet_no, '--to=CON-302'], { json: false, expectFail: true });
  assert(/certificate is expired/.test(expiredRefused.stderr), 'and the refusal names the block and the date');

  const dispatchRefused = run('dispatching an export consignment with no assurance is refused', ['packhouse.mjs', 'dispatch', 'CON-302'], { json: false, expectFail: true });
  assert(/assurance/.test(dispatchRefused.stderr) && /no force flag/.test(dispatchRefused.stderr), 'and there is no force flag');

  const wrongAssurance = run('assurance on a domestic consignment is refused', ['packhouse.mjs', 'assurance', 'CON-303', '--ref=OAP-X'], { json: false, expectFail: true });
  assert(/domestic/.test(wrongAssurance.stderr), 'assurance belongs to export consignments');

  run('record the assurance', ['packhouse.mjs', 'assurance', 'CON-302', '--ref=OAP-2026-1421']);
  const dispatched = run('now it dispatches', ['packhouse.mjs', 'dispatch', 'CON-302']);
  assert(dispatched.status === 'dispatched', 'CON-302 is away');

  const afterDispatch = run('its pallets are out of the store', ['packhouse.mjs', 'pallets', '--all']);
  assert(afterDispatch.filter((p) => p.consignment_ref === 'CON-302').every((p) => p.status === 'dispatched'), 'all three marked dispatched');

  // ---- the pool gate ------------------------------------------------------------------

  const closeRefused = run('closing the Hayward pool with proceeds missing is refused', ['packhouse.mjs', 'pool', 'close', 'Hayward 2026'], { json: false, expectFail: true });
  assert(/short-pays/.test(closeRefused.stderr), 'closing early short-pays every grower');

  run('record the missing CON-300 proceeds', ['packhouse.mjs', 'sale', 'Hayward 2026', '--trays=300', '--value=24300', '--consignment=CON-300']);
  // CON-302 also dispatched 480 Hayward trays (PLT-4010 and PLT-4011); PLT-4005 on it was SunGold.
  const hay2 = run('the pool position after the CON-300 proceeds land', ['packhouse.mjs', 'pool', 'Hayward 2026']);
  assert(n(hay2.pool.trays_sold) === 900, `900 Hayward trays now sold (${hay2.pool.trays_sold})`);

  run('sell the CON-302 Hayward trays', ['packhouse.mjs', 'sale', 'Hayward 2026', '--trays=480', '--value=38400', '--consignment=CON-302']);
  const sungoldOnCon302 = run('sell the CON-302 SunGold trays', ['packhouse.mjs', 'sale', 'SunGold 2026', '--trays=130', '--value=11440', '--consignment=CON-302']);
  void sungoldOnCon302;
  const closed = run('now the Hayward pool closes', ['packhouse.mjs', 'pool', 'close', 'Hayward 2026']);
  assert(closed.status === 'closed', 'closed with every dispatched tray sold');

  const saleOnClosed = run('a sale into a closed pool is refused', ['packhouse.mjs', 'sale', 'Hayward 2026', '--trays=1', '--value=80'], { json: false, expectFail: true });
  assert(/closed/.test(saleOnClosed.stderr), 'closed pools do not move quietly');

  // ---- the coolstore moves ------------------------------------------------------------

  const outOfRange = run('an out-of-range reading is loud', ['packhouse.mjs', 'temp', 'Room 3', '--temp=8.1', '--by=Josh'], { json: false });
  assert(/OUT OF RANGE/.test(outOfRange.stdout), 'and says how many pallets are in the room');
  run('a good reading', ['packhouse.mjs', 'temp', 'Room 3', '--temp=5.8', '--by=Josh']);
  run('a reading for the quiet room', ['packhouse.mjs', 'temp', 'Room 2', '--temp=1.1', '--by=Mel']);
  const coolAfter = run('the coolchain rule clears', ['packhouse.mjs', 'compliance', 'coolchain']);
  assert(coolAfter[0].breaches.length === 0, 'every room checked and in range');

  run('move a pallet', ['packhouse.mjs', 'move', 'PLT-4024', '--room=Room 2']);

  // ---- growers, orchards, the log ---------------------------------------------

  run('add grower', ['packhouse.mjs', 'add', 'grower', 'Waihi Beach Orchards', '--code=WAIH', '--contact=Sue Parker', '--phone=021 555 0299']);
  const newOrchard = run('add orchard', ['packhouse.mjs', 'add', 'orchard', 'Waihi Beach Block 1', '--grower=WAIH', '--crop=kiwifruit', '--variety=Hayward', '--block=KPIN-10990', '--gap-scheme=NZGAP', `--gap-expires=${addDays(todayIso, 400)}`]);
  assert(newOrchard.block_code === 'KPIN-10990', 'the block lands with its certificate');

  const received = run('receive a clean delivery', ['packhouse.mjs', 'receive', 'Waihi Beach Block 1',
    '--bins=10', '--kgs=2900', `--picked=${addDays(todayIso, -1)}`, `--last-spray=${addDays(todayIso, -40)}`, '--withholding=14', '--diary', '--maturity=MAT-26-150']);
  assert(/^DEL-\d+$/.test(received.ref) && received.status === 'received', `on the intake record (${received.ref})`);

  run('log a call', ['packhouse.mjs', 'log', 'DEL-505', 'Lab confirmed the residue sample arrived. Result Thursday.']);
  run('log against a grower', ['packhouse.mjs', 'log', 'Kauri Point', 'Audit confirmed for the 14th. Fruit stays domestic until the cert is back.']);

  // ---- import ------------------------------------------------------------------

  const growersCsv = path.join(dataDir, 'growers.csv');
  const orchardsCsv = path.join(dataDir, 'orchards.csv');
  const deliveriesCsv = path.join(dataDir, 'deliveries.csv');
  writeFileSync(growersCsv, [
    'Name,Code,Contact,Phone',
    '"Athenree Orchard Partnership",ATHE,"Bill Nairn",021 555 0301',
    '"Te Puna Orchards Ltd",TEPU,"Angela Rope",027 555 0201',
  ].join('\n'));
  writeFileSync(orchardsCsv, [
    'Orchard,Grower,KPIN,Crop,Variety,GAP Scheme,GAP Expiry,ID',
    '"Athenree Home Block","Athenree Orchard Partnership",KPIN-11201,Kiwifruit,Hayward,NZGAP,' + addDays(todayIso, -90) + ',FP-O-901',
    '"Athenree Hill Block","Athenree Orchard Partnership",KPIN-11202,Kiwifruit,SunGold,NZGAP,' + addDays(todayIso, 300) + ',FP-O-902',
  ].join('\n'));
  writeFileSync(deliveriesCsv, [
    'Orchard,Received,Picked,Bins,Kg,Spray Diary,Status,ID',
    '"Athenree Hill Block",' + addDays(todayIso, -3) + ',' + addDays(todayIso, -3) + ',14,4000,Yes,Packed,FP-D-801',
    '"Athenree Home Block",' + addDays(todayIso, -1) + ',' + addDays(todayIso, -1) + ',9,2500,,Received,FP-D-802',
  ].join('\n'));

  const dry = run('import dry run writes nothing', ['packhouse.mjs', 'import', 'radfords', `--growers=${growersCsv}`, `--orchards=${orchardsCsv}`, `--deliveries=${deliveriesCsv}`, '--dry-run']);
  assert(n(dry.growers) === 1 && n(dry.growers_updated) === 1, 'the dry run counts what it would do');
  assert(n(dry.gap_expired) === 1, 'and flags the imported block with an expired certificate');
  assert(n(dry.diary_missing) === 1, 'and the imported delivery with no spray diary');

  const imported = run('import for real', ['packhouse.mjs', 'import', 'radfords', `--growers=${growersCsv}`, `--orchards=${orchardsCsv}`, `--deliveries=${deliveriesCsv}`]);
  assert(n(imported.growers) === 1 && n(imported.orchards) === 2 && n(imported.deliveries) === 2, 'and the real run does it');

  const athenree = run('the imported grower reads back', ['packhouse.mjs', 'grower', 'Athenree']);
  assert(athenree.orchards.length === 2, 'with both blocks');
  assert(athenree.orchards.some((o) => o.gap === 'EXPIRED'), 'the import is the first audit: the expired cert is already loud');

  const missingFile = run('a missing import file fails loudly', ['packhouse.mjs', 'import', 'csv', `--growers=${path.join(dataDir, 'not-there.csv')}`], { json: false, expectFail: true });
  assert(/No growers file/.test(missingFile.stderr), 'it exits non zero rather than importing nothing quietly');

  // ---- export --------------------------------------------------------------------

  const outFile = path.join(dataDir, 'dump.json');
  const dump = run('export', ['packhouse.mjs', 'export', `--out=${outFile}`]);
  assert(existsSync(outFile), 'the export file is on disk');
  const parsed = JSON.parse(readFileSync(outFile, 'utf8'));
  assert(parsed.pallets.length === n(dump.counts.pallets), 'the counts match the file');

  // ---- the branded HTML -----------------------------------------------------------

  const views = run('npm run view', ['view.mjs'], { json: false });
  assert(/views[\\/]packhouse-board\.html/.test(views.stdout) && /views[\\/]registers\.html/.test(views.stdout), 'both views rendered');
  const boardHtml = readFileSync(path.join(root, 'views', 'packhouse-board.html'), 'utf8');
  assert(boardHtml.includes('Needs a decision') && boardHtml.includes('coolstore'), 'the board has its sections');
  const registersHtml = readFileSync(path.join(root, 'views', 'registers.html'), 'utf8');
  assert(registersHtml.includes('GAP register') && registersHtml.includes('Grower returns'), 'the registers page has its sections');

  const docsOut = run('npm run docs', ['docs.mjs'], { json: false });
  assert(/packout-statement/.test(docsOut.stdout), 'the packout statements rendered');
  assert(/grower-return-statement/.test(docsOut.stdout), 'the grower return statements rendered');
  assert(/consignment-manifest/.test(docsOut.stdout), 'the consignment manifests rendered');
  assert(/coolstore-register/.test(docsOut.stdout), 'the coolstore registers rendered');

  // ---- the human readable side ------------------------------------------------------

  run('growers (text)', ['packhouse.mjs', 'growers'], { json: false });
  run('grower (text)', ['packhouse.mjs', 'grower', 'Bledisloe'], { json: false });
  run('orchards (text)', ['packhouse.mjs', 'orchards'], { json: false });
  run('deliveries (text)', ['packhouse.mjs', 'deliveries', '--all'], { json: false });
  run('delivery (text)', ['packhouse.mjs', 'delivery', 'DEL-505'], { json: false });
  run('packouts (text)', ['packhouse.mjs', 'packouts'], { json: false });
  run('pallets (text)', ['packhouse.mjs', 'pallets'], { json: false });
  run('trace (text)', ['packhouse.mjs', 'trace', 'PLT-4024'], { json: false });
  run('consignments (text)', ['packhouse.mjs', 'consignments', '--all'], { json: false });
  run('consignment (text)', ['packhouse.mjs', 'consignment', 'CON-301'], { json: false });
  run('coolstore (text)', ['packhouse.mjs', 'coolstore'], { json: false });
  run('pools (text)', ['packhouse.mjs', 'pools'], { json: false });
  run('pool (text)', ['packhouse.mjs', 'pool', 'SunGold 2026'], { json: false });
  run('returns (text)', ['packhouse.mjs', 'returns'], { json: false });
  run('season (text)', ['packhouse.mjs', 'season'], { json: false });
  run('attention (text)', ['packhouse.mjs', 'attention'], { json: false });
  run('compliance (text)', ['packhouse.mjs', 'compliance'], { json: false });
  run('stats (text)', ['packhouse.mjs', 'stats'], { json: false });
  run('help', ['packhouse.mjs', 'help'], { json: false });
  run('an unknown command exits 1', ['packhouse.mjs', 'nonsense'], { json: false, expectFail: true });

  console.log(`\n${step} checks, PASS`);
} finally {
  if (existsSync(dataDir)) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // Windows can hold the handle briefly; a leftover temp dir is harmless.
    }
  }
}
