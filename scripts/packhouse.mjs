#!/usr/bin/env node
// packhouse-for-claude-code: the one CLI. Claude Code slash commands call
// this; so can you.
//
//   node scripts/packhouse.mjs <command> [args] [--flags] [--json]
//
// Run with no arguments (or `help`) for the command list.
//
// This system is a New Zealand packhouse's season record: growers and their
// orchard blocks, the fruit coming in, the grading runs, the pallets in the
// coolstore, the consignments going out, and the pools that turn sale
// proceeds into grower returns. The sharp edges are deliberate: fruit picked
// inside its spray withholding period is held, not received as normal stock;
// a delivery cannot be graded without its spray diary; an export consignment
// cannot dispatch without its assurance reference (no force flag); and a pool
// cannot close while dispatched trays have no sale proceeds recorded, because
// growers are paid from the pool. Nothing here connects to MPI or any
// exporter, and nothing sends: statements draft to files and a person sends.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { parseCsv, pick } from './lib/csv.mjs';
import { table, isoDate, short, truncate, heading } from './lib/format.mjs';

// ---------------------------------------------------------------------------
// Argument parsing

const BOOL_FLAGS = new Set(['json', 'help', 'all', 'dry-run', 'export', 'diary', 'hold']);

function parseArgv(argv) {
  const args = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      flags.help = true;
      continue;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      let name;
      let value;
      if (eq > -1) {
        name = a.slice(2, eq);
        value = a.slice(eq + 1);
      } else {
        name = a.slice(2);
        const next = argv[i + 1];
        if (BOOL_FLAGS.has(name) || next === undefined || next.startsWith('--')) value = true;
        else value = argv[++i];
      }
      flags[name] = value;
    } else {
      args.push(a);
    }
  }
  return { args, flags };
}

class CliError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

const num = (v) => Number(v ?? 0);
const str = (v) => (v === true || v === undefined || v === null ? '' : String(v));
const money = (v) => '$' + num(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// ---------------------------------------------------------------------------
// Dates

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDate(v, what = 'date') {
  if (!v || v === true) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const lower = s.toLowerCase();
  if (lower === 'today') return today();
  if (lower === 'yesterday') return addDays(today(), -1);
  if (lower === 'tomorrow') return addDays(today(), 1);
  // New Zealand writes DD/MM/YYYY, so the first number is the day unless the
  // second one is too big to be a month.
  const slash = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const [day, month] = b > 12 ? [b, a] : [a, b];
    const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new CliError(`"${v}" is not a ${what}. Use YYYY-MM-DD.`);
  return isoDate(d);
}

// ---------------------------------------------------------------------------
// The domain's spine

const CROPS = ['kiwifruit', 'avocado', 'apple', 'citrus', 'other'];
const GRADES = ['class1', 'class2'];
const DEFAULT_TRAYS_PER_PALLET = 240;

// ---------------------------------------------------------------------------
// Lookups: full id, first 4+ characters of an id, exact ref or name, then
// contains. One hit wins. Several hits list the candidates and exit 1.

const RESOLVERS = {
  grower: {
    from: 'growers c',
    cols: 'c.*',
    exact: "lower(c.name) = lower($1) or lower(coalesce(c.code, '')) = lower($1) or lower(coalesce(c.external_ref, '')) = lower($1)",
    fuzzy: 'c.name ilike $1 or c.code ilike $1 or c.contact_name ilike $1',
    label: (r) => `${r.name} (${r.code || 'no code'}, ${r.status})`,
    order: 'c.name',
    listing: 'growers --all',
  },
  orchard: {
    from: 'orchards c join growers g on g.id = c.grower_id',
    cols: 'c.*, g.name as grower_name',
    exact: "lower(c.name) = lower($1) or lower(coalesce(c.block_code, '')) = lower($1) or lower(coalesce(c.external_ref, '')) = lower($1)",
    fuzzy: 'c.name ilike $1 or c.block_code ilike $1 or g.name ilike $1',
    label: (r) => `${r.name} (${r.block_code || 'no code'}, ${r.crop}${r.variety ? ` ${r.variety}` : ''}, ${r.grower_name})`,
    order: 'c.name',
    listing: 'orchards',
  },
  delivery: {
    from: 'deliveries c join orchards o on o.id = c.orchard_id',
    cols: 'c.*, o.name as orchard_name',
    exact: "lower(coalesce(c.ref, '')) = lower($1) or lower(coalesce(c.ref, '')) = lower('DEL-' || $1) or lower(coalesce(c.external_ref, '')) = lower($1)",
    fuzzy: 'c.ref ilike $1 or o.name ilike $1',
    label: (r) => `${r.ref}  ${r.orchard_name}, received ${isoDate(r.received_on)} (${r.status})`,
    order: 'c.received_on desc',
    listing: 'deliveries --all',
  },
  pallet: {
    from: 'pallets c',
    cols: 'c.*',
    exact: "lower(coalesce(c.pallet_no, '')) = lower($1) or lower(coalesce(c.pallet_no, '')) = lower('PLT-' || $1) or lower(coalesce(c.external_ref, '')) = lower($1)",
    fuzzy: 'c.pallet_no ilike $1',
    label: (r) => `${r.pallet_no}  ${r.grade}, ${r.trays} trays (${r.status})`,
    order: 'c.packed_on desc',
    listing: 'pallets --all',
  },
  consignment: {
    from: 'consignments c',
    cols: 'c.*',
    exact: "lower(coalesce(c.ref, '')) = lower($1) or lower(coalesce(c.ref, '')) = lower('CON-' || $1) or lower(coalesce(c.external_ref, '')) = lower($1)",
    fuzzy: 'c.ref ilike $1 or c.buyer ilike $1 or c.destination ilike $1',
    label: (r) => `${r.ref}  ${r.buyer} (${r.status})`,
    order: 'c.created_on desc',
    listing: 'consignments --all',
  },
  pool: {
    from: 'pools c',
    cols: 'c.*',
    exact: 'lower(c.name) = lower($1)',
    fuzzy: 'c.name ilike $1 or c.crop ilike $1 or c.variety ilike $1',
    label: (r) => `${r.name} (${r.crop}${r.variety ? ` ${r.variety}` : ''}, ${r.status})`,
    order: 'c.name',
    listing: 'pools',
  },
  room: {
    from: 'coolrooms c',
    cols: 'c.*',
    exact: 'lower(c.name) = lower($1)',
    fuzzy: 'c.name ilike $1',
    label: (r) => `${r.name} (${r.target_min_c} to ${r.target_max_c} C)`,
    order: 'c.name',
    listing: 'coolstore',
  },
};

const ID_RE = /^[0-9a-f]{4,8}(-[0-9a-f-]*)?$/i;

async function resolve(db, kind, q, { optional = false } = {}) {
  const spec = RESOLVERS[kind];
  q = String(q ?? '').trim();
  if (!q || q === 'true') {
    if (optional) return null;
    throw new CliError(`Give me a ${kind} name, reference or id.`);
  }
  const select = `select ${spec.cols} from ${spec.from}`;
  let rows = [];
  if (ID_RE.test(q)) {
    rows = await db.query(`${select} where c.id::text like $1 order by ${spec.order}`, [q.toLowerCase() + '%']);
    if (rows.length === 1) return rows[0];
  }
  if (!rows.length) rows = await db.query(`${select} where ${spec.exact} order by ${spec.order}`, [q]);
  if (rows.length === 1) return rows[0];
  if (!rows.length) rows = await db.query(`${select} where ${spec.fuzzy} order by ${spec.order}`, [`%${q}%`]);
  if (rows.length === 1) return rows[0];
  if (!rows.length) {
    if (optional) return null;
    throw new CliError(`No ${kind} matches "${q}". Run \`${spec.listing}\` to see what exists.`);
  }
  throw new CliError(
    `"${q}" matches ${rows.length} ${kind} records. Use a reference, an id, or a longer name:\n` +
      rows.map((r) => `  ${short(r.id)}  ${spec.label(r)}`).join('\n'),
  );
}

async function nextRef(db, prefix, tableName, column, start) {
  const [r] = await db.query(
    `select coalesce(max(substring(${column} from ${prefix.length + 2})::int), ${start}) + 1 as n from ${tableName} where ${column} ~ '^${prefix}-[0-9]+$'`,
  );
  return `${prefix}-${r.n}`;
}

// ---------------------------------------------------------------------------
// Shared column sets

const DELIVERY_COLS = [
  { key: 'ref', label: 'ref' },
  { key: 'grower', label: 'grower', width: 22 },
  { key: 'orchard', label: 'block', width: 22 },
  { key: 'variety', label: 'variety', format: (v, r) => v || r.crop },
  { key: 'received_on', label: 'received', format: (v) => isoDate(v) },
  { key: 'bins', label: 'bins', align: 'right' },
  { key: 'kgs', label: 'kg', align: 'right', format: (v) => String(num(v)) },
  { key: 'spray_diary_received', label: 'diary', format: (v) => (v ? 'yes' : 'MISSING') },
  { key: 'phi_breach', label: 'spray window', format: (v, r) => (v ? 'BREACH' : r.phi_clear_on ? 'clear' : '') },
  { key: 'status', label: 'status' },
];

const PALLET_COLS = [
  { key: 'pallet_no', label: 'pallet' },
  { key: 'grade', label: 'grade' },
  { key: 'trays', label: 'trays', align: 'right' },
  { key: 'variety', label: 'variety', format: (v, r) => v || r.crop },
  { key: 'grower', label: 'grower', width: 22 },
  { key: 'delivery_ref', label: 'from' },
  { key: 'packed_on', label: 'packed', format: (v) => isoDate(v) },
  { key: 'days_in_store', label: 'days', align: 'right', format: (v, r) => (r.status === 'in_store' ? String(v) : '') },
  { key: 'room', label: 'room', format: (v) => v || '' },
  { key: 'consignment_ref', label: 'consignment', format: (v) => v || '' },
  { key: 'status', label: 'status' },
];

// ---------------------------------------------------------------------------
// Reads

async function cmdGrowers(db, args, flags) {
  const rows = await db.query(
    `select g.code, g.name, coalesce(g.contact_name, '') as contact, coalesce(g.phone, '') as phone, g.status,
            (select count(*) from orchards o where o.grower_id = g.id) as blocks,
            (select coalesce(sum(d.kgs), 0) from deliveries d join orchards o on o.id = d.orchard_id where o.grower_id = g.id) as kgs_in,
            (select coalesce(sum(r.class1_trays + r.class2_trays), 0)
               from grading_runs r join deliveries d on d.id = r.delivery_id join orchards o on o.id = d.orchard_id
              where o.grower_id = g.id) as trays_packed
     from growers g where g.status = 'active' or $1 order by g.name`,
    [Boolean(flags.all)],
  );
  return {
    json: rows,
    text:
      heading(`Growers (${rows.length})`) +
      '\n' +
      table(rows, [
        { key: 'code', label: 'code' },
        { key: 'name', label: 'grower', width: 26 },
        { key: 'contact', label: 'contact', width: 18 },
        { key: 'phone', label: 'phone' },
        { key: 'blocks', label: 'blocks', align: 'right' },
        { key: 'kgs_in', label: 'kg in', align: 'right', format: (v) => String(num(v)) },
        { key: 'trays_packed', label: 'trays packed', align: 'right' },
        { key: 'status', label: 'status' },
      ]),
  };
}

async function cmdGrower(db, args) {
  const g = await resolve(db, 'grower', args.join(' '));
  const orchards = await db.query('select * from v_orchards where grower_id = $1 order by orchard', [g.id]);
  const deliveries = await db.query('select * from v_deliveries where grower_id = $1 order by received_on desc limit 15', [g.id]);
  const packouts = await db.query('select * from v_packouts where grower_id = $1 order by graded_on desc limit 10', [g.id]);
  const returns = await db.query('select * from v_grower_returns where grower_id = $1 order by pool', [g.id]);
  const gnotes = await db.query('select noted_on, note from notes where grower_id = $1 order by noted_on desc', [g.id]);
  const json = { grower: g, orchards, deliveries, packouts, returns, notes: gnotes };
  let text = heading(`${g.name} (${g.code || 'no code'})`) +
    `\n  ${g.contact_name || ''}${g.phone ? ` | ${g.phone}` : ''}${g.email ? ` | ${g.email}` : ''} | ${g.status}`;
  text += '\n' + heading('Blocks') + '\n' + table(orchards, [
    { key: 'orchard', label: 'block', width: 24 },
    { key: 'block_code', label: 'code' },
    { key: 'variety', label: 'variety', format: (v, r) => v || r.crop },
    { key: 'hectares', label: 'ha', align: 'right', format: (v) => (v === null ? '' : String(num(v))) },
    { key: 'gap_scheme', label: 'scheme', format: (v) => v || '' },
    { key: 'gap_cert_expires_on', label: 'cert expires', format: (v) => isoDate(v) },
    { key: 'gap', label: 'GAP' },
  ]);
  if (deliveries.length) text += '\n' + heading('Recent deliveries') + '\n' + table(deliveries, DELIVERY_COLS.filter((c) => c.key !== 'grower'));
  if (packouts.length) {
    text += '\n' + heading('Packouts') + '\n' + table(packouts, [
      { key: 'delivery_ref', label: 'delivery' },
      { key: 'orchard', label: 'block', width: 22 },
      { key: 'graded_on', label: 'graded', format: (v) => isoDate(v) },
      { key: 'input_kg', label: 'kg in', align: 'right', format: (v) => String(num(v)) },
      { key: 'class1_trays', label: 'class 1', align: 'right' },
      { key: 'class2_trays', label: 'class 2', align: 'right' },
      { key: 'reject_kg', label: 'reject kg', align: 'right', format: (v) => String(num(v)) },
      { key: 'packout_pct', label: 'packout', align: 'right', format: (v) => `${num(v)}%` },
    ]);
  }
  if (returns.length) {
    text += '\n' + heading('Season returns so far') + '\n' + table(returns, [
      { key: 'pool', label: 'pool', width: 16 },
      { key: 'trays', label: 'trays', align: 'right' },
      { key: 'gross_share', label: 'gross share', align: 'right', format: (v) => money(v) },
      { key: 'packing_charges', label: 'packing', align: 'right', format: (v) => money(v) },
      { key: 'levies', label: 'levies', align: 'right', format: (v) => money(v) },
      { key: 'net_return', label: 'net', align: 'right', format: (v) => money(v) },
      { key: 'net_per_tray', label: 'per tray', align: 'right', format: (v) => money(v) },
    ]) + '\n\n  Gross share is pro-rata on trays packed into the pool; the pool moves until it closes.';
  }
  if (gnotes.length) {
    text += '\n' + heading('The log') + '\n' + table(gnotes, [
      { key: 'noted_on', label: 'date', format: (v) => isoDate(v) },
      { key: 'note', label: 'note', width: 80 },
    ]);
  }
  return { json, text };
}

async function cmdOrchards(db, args, flags) {
  const rows = await db.query(
    `select * from v_orchards where status = 'active' or $1
     order by case gap when 'EXPIRED' then 1 when 'expiring' then 2 when 'NONE' then 3 else 4 end, grower, orchard`,
    [Boolean(flags.all)],
  );
  return {
    json: rows,
    text:
      heading(`The GAP register (${rows.length} blocks)`) +
      '\n' +
      table(rows, [
        { key: 'block_code', label: 'code' },
        { key: 'orchard', label: 'block', width: 24 },
        { key: 'grower', label: 'grower', width: 24 },
        { key: 'region', label: 'region', width: 12 },
        { key: 'variety', label: 'variety', format: (v, r) => v || r.crop },
        { key: 'hectares', label: 'ha', align: 'right', format: (v) => (v === null ? '' : String(num(v))) },
        { key: 'gap_scheme', label: 'scheme', format: (v) => v || 'NONE' },
        { key: 'gap_cert_expires_on', label: 'cert expires', format: (v) => isoDate(v) },
        { key: 'gap', label: 'GAP' },
      ]) +
      '\n\n  Export programmes buy from certified blocks. An EXPIRED block cannot join an export consignment;\n  the CLI refuses at `consign add`.',
  };
}

async function cmdDeliveries(db, args, flags) {
  const where = ["(status <> 'graded' or $1)"];
  const params = [Boolean(flags.all)];
  if (flags.grower) {
    const g = await resolve(db, 'grower', flags.grower);
    params.push(g.id);
    where.push(`grower_id = $${params.length}`);
  }
  if (flags.status) {
    params.push(str(flags.status));
    where.push(`status = $${params.length}`);
  }
  const rows = await db.query(`select * from v_deliveries where ${where.join(' and ')} order by received_on desc`, params);
  const blocked = rows.filter((r) => r.status === 'received' && !r.spray_diary_received);
  const held = rows.filter((r) => r.status === 'held');
  return {
    json: rows,
    text:
      heading(`Deliveries (${rows.length}${flags.all ? '' : ' on the floor'})`) +
      '\n' +
      table(rows, DELIVERY_COLS) +
      (held.length ? `\n\n  ${held.length} delivery(ies) HELD on a spray window breach. Decide each one: residue test, regrade to a cleared market, or dump. The record stays.` : '') +
      (blocked.length ? `\n  ${blocked.length} delivery(ies) waiting on a spray diary: grading is blocked until it lands (diary <ref>).` : ''),
  };
}

async function cmdDelivery(db, args) {
  const d = await resolve(db, 'delivery', args[0]);
  const [row] = await db.query('select * from v_deliveries where delivery_id = $1', [d.id]);
  const runs = await db.query('select * from v_packouts where delivery_id = $1 order by graded_on', [d.id]);
  const pallets = await db.query('select * from v_pallets where delivery_ref = $1 order by pallet_no', [row.ref]);
  const dnotes = await db.query('select noted_on, note from notes where delivery_id = $1 order by noted_on desc', [d.id]);
  const json = { delivery: row, grading: runs, pallets, notes: dnotes };
  let text = heading(`${row.ref}  ${row.grower}, ${row.orchard}`) +
    `\n  ${row.bins} bins, ${num(row.kgs)} kg of ${row.variety || row.crop} | picked ${isoDate(row.picked_on)} | received ${isoDate(row.received_on)} | ${row.status.toUpperCase()}`;
  if (row.hold_reason) text += `\n  HELD: ${row.hold_reason}`;
  text += `\n  spray diary: ${row.spray_diary_received ? 'on record' : 'MISSING (grading blocked)'}`;
  if (row.phi_clear_on) {
    text += ` | last spray ${isoDate(row.last_spray_on)} + ${row.withholding_days} days = clear from ${isoDate(row.phi_clear_on)}`;
    if (row.phi_breach) text += ' | PICKED INSIDE THE WINDOW';
  }
  if (row.maturity_ref) text += `\n  maturity clearance: ${row.maturity_ref}`;
  if (runs.length) {
    text += '\n' + heading('Grading') + '\n' + table(runs, [
      { key: 'graded_on', label: 'graded', format: (v) => isoDate(v) },
      { key: 'input_kg', label: 'kg in', align: 'right', format: (v) => String(num(v)) },
      { key: 'class1_trays', label: 'class 1', align: 'right' },
      { key: 'class2_trays', label: 'class 2', align: 'right' },
      { key: 'reject_kg', label: 'reject kg', align: 'right', format: (v) => String(num(v)) },
      { key: 'packout_pct', label: 'packout', align: 'right', format: (v) => `${num(v)}%` },
      { key: 'class1_share_pct', label: 'class 1 share', align: 'right', format: (v) => `${num(v)}%` },
    ]);
  }
  if (pallets.length) text += '\n' + heading('Pallets') + '\n' + table(pallets, PALLET_COLS.filter((c) => !['grower', 'delivery_ref', 'variety'].includes(c.key)));
  if (dnotes.length) {
    text += '\n' + heading('The log') + '\n' + table(dnotes, [
      { key: 'noted_on', label: 'date', format: (v) => isoDate(v) },
      { key: 'note', label: 'note', width: 84 },
    ]);
  }
  return { json, text };
}

async function cmdPackouts(db, args, flags) {
  const where = ['true'];
  const params = [];
  if (flags.grower) {
    const g = await resolve(db, 'grower', flags.grower);
    params.push(g.id);
    where.push(`grower_id = $${params.length}`);
  }
  const rows = await db.query(`select * from v_packouts where ${where.join(' and ')} order by graded_on desc`, params);
  return {
    json: rows,
    text:
      heading(`Packouts (${rows.length} grading runs)`) +
      '\n' +
      table(rows, [
        { key: 'delivery_ref', label: 'delivery' },
        { key: 'grower', label: 'grower', width: 22 },
        { key: 'variety', label: 'variety', format: (v, r) => v || r.crop },
        { key: 'graded_on', label: 'graded', format: (v) => isoDate(v) },
        { key: 'input_kg', label: 'kg in', align: 'right', format: (v) => String(num(v)) },
        { key: 'class1_trays', label: 'class 1', align: 'right' },
        { key: 'class2_trays', label: 'class 2', align: 'right' },
        { key: 'reject_kg', label: 'reject kg', align: 'right', format: (v) => String(num(v)) },
        { key: 'packout_pct', label: 'packout', align: 'right', format: (v) => `${num(v)}%` },
        { key: 'class1_share_pct', label: 'class 1 share', align: 'right', format: (v) => `${num(v)}%` },
      ]) +
      '\n\n  Packout is what survived the reject belt, by weight. Class 1 share is the export money.\n  A grower whose packout drops run over run gets a phone call before the statement goes out.',
  };
}

async function cmdPallets(db, args, flags) {
  const where = ["(status = 'in_store' or $1)"];
  const params = [Boolean(flags.all)];
  if (flags.grower) {
    const g = await resolve(db, 'grower', flags.grower);
    params.push(g.id);
    where.push(`grower_id = $${params.length}`);
  }
  if (flags.room) {
    params.push(str(flags.room));
    where.push(`lower(coalesce(room, '')) = lower($${params.length})`);
  }
  const rows = await db.query(`select * from v_pallets where ${where.join(' and ')} order by days_in_store desc, pallet_no`, params);
  const trays = rows.filter((r) => r.status === 'in_store').reduce((s, r) => s + num(r.trays), 0);
  return {
    json: rows,
    text:
      heading(`Pallets (${rows.length}${flags.all ? '' : ' in store'}, ${trays} trays in store)`) +
      '\n' +
      table(rows, PALLET_COLS) +
      '\n\n  Oldest first: fruit is condition, and condition is money. `trace <pallet>` walks one back to the block.',
  };
}

async function cmdTrace(db, args) {
  const p = await resolve(db, 'pallet', args[0]);
  const [row] = await db.query('select * from v_pallets where pallet_id = $1', [p.id]);
  const [run] = await db.query('select * from v_packouts where run_id = $1', [p.grading_run_id]);
  const [del] = await db.query('select * from v_deliveries where delivery_id = $1', [run.delivery_id]);
  const [orch] = await db.query('select * from v_orchards where orchard_id = $1', [del.orchard_id]);
  const con = row.consignment_id ? (await db.query('select * from v_consignments where consignment_id = $1', [row.consignment_id]))[0] : null;
  const json = { pallet: row, grading_run: run, delivery: del, orchard: orch, consignment: con };
  let text = heading(`${row.pallet_no}: the whole story of one pallet`) +
    `\n  ${row.trays} trays of ${row.variety || row.crop} ${row.grade}, packed ${isoDate(row.packed_on)}${row.room ? `, in ${row.room}` : ''} | ${row.status}${row.pool ? ` | pool: ${row.pool}` : ''}`;
  text += '\n\n  One step back:';
  text += `\n    graded ${isoDate(run.graded_on)} from ${del.ref} (${del.bins} bins, ${num(del.kgs)} kg received ${isoDate(del.received_on)}, picked ${isoDate(del.picked_on)})`;
  text += `\n    block: ${orch.orchard} (${orch.block_code}), ${orch.grower}`;
  text += `\n    spray record: ${del.spray_diary_received ? `diary on record, last spray ${isoDate(del.last_spray_on)} + ${del.withholding_days} days withholding, clear from ${isoDate(del.phi_clear_on)}` : 'DIARY MISSING'}`;
  text += `\n    GAP: ${orch.gap_scheme || 'NONE'}${orch.gap_cert_expires_on ? ` expires ${isoDate(orch.gap_cert_expires_on)}` : ''} (${orch.gap})`;
  if (del.maturity_ref) text += `\n    maturity clearance: ${del.maturity_ref}`;
  text += '\n\n  One step forward:';
  text += con
    ? `\n    ${con.ref} to ${con.buyer}${con.destination ? `, ${con.destination}` : ''}${con.export ? ` (export, assurance ${con.assurance_ref || 'MISSING'})` : ' (domestic)'}${con.dispatched_on ? `, dispatched ${isoDate(con.dispatched_on)}` : ', not yet dispatched'}`
    : '\n    not allocated to a consignment yet';
  text += '\n\n  That is the one-step-back, one-step-forward trace, in seconds, from the pallet number on the docket.';
  return { json, text };
}

async function cmdConsignments(db, args, flags) {
  const rows = await db.query(
    `select * from v_consignments where (status = 'open' or $1) order by status, created_on desc`,
    [Boolean(flags.all)],
  );
  const blocked = rows.filter((r) => r.status === 'open' && r.export && !r.assurance_ref && num(r.pallet_count) > 0);
  return {
    json: rows,
    text:
      heading(`Consignments (${rows.length}${flags.all ? '' : ' open'})`) +
      '\n' +
      table(rows, [
        { key: 'ref', label: 'ref' },
        { key: 'buyer', label: 'buyer', width: 26 },
        { key: 'destination', label: 'destination', width: 26, format: (v) => v || '' },
        { key: 'export', label: 'export', format: (v) => (v ? 'yes' : '') },
        { key: 'assurance', label: 'assurance' },
        { key: 'pallet_count', label: 'pallets', align: 'right' },
        { key: 'trays', label: 'trays', align: 'right' },
        { key: 'growers', label: 'growers', align: 'right' },
        { key: 'created_on', label: 'created', format: (v) => isoDate(v) },
        { key: 'dispatched_on', label: 'dispatched', format: (v) => isoDate(v) },
        { key: 'status', label: 'status' },
      ]) +
      (blocked.length ? `\n\n  ${blocked.length} export consignment(s) cannot dispatch: no assurance reference on record (assurance <ref> --ref=).` : ''),
  };
}

async function cmdConsignment(db, args) {
  const c = await resolve(db, 'consignment', args[0]);
  const [row] = await db.query('select * from v_consignments where consignment_id = $1', [c.id]);
  const pallets = await db.query('select * from v_pallets where consignment_id = $1 order by pallet_no', [c.id]);
  const cnotes = await db.query('select noted_on, note from notes where consignment_id = $1 order by noted_on desc', [c.id]);
  const json = { consignment: row, pallets, notes: cnotes };
  let text = heading(`${row.ref}  ${row.buyer}`) +
    `\n  ${row.destination || ''}${row.export ? ' | EXPORT' : ' | domestic'} | created ${isoDate(row.created_on)} | ${row.status}${row.dispatched_on ? ` ${isoDate(row.dispatched_on)}` : ''}`;
  if (row.export) text += `\n  assurance: ${row.assurance_ref || 'MISSING. It does not leave without one: assurance ' + row.ref + ' --ref='}`;
  if (row.carrier) text += `\n  carrier: ${row.carrier}`;
  text += `\n  ${row.pallet_count} pallet(s), ${row.trays} trays, ${row.growers} grower(s)`;
  if (pallets.length) text += '\n' + heading('Pallets') + '\n' + table(pallets, PALLET_COLS.filter((c2) => !['consignment_ref', 'days_in_store'].includes(c2.key)));
  if (cnotes.length) {
    text += '\n' + heading('The log') + '\n' + table(cnotes, [
      { key: 'noted_on', label: 'date', format: (v) => isoDate(v) },
      { key: 'note', label: 'note', width: 84 },
    ]);
  }
  return { json, text };
}

async function cmdCoolstore(db) {
  const rows = await db.query(`select * from v_coolstore order by case state when 'OUT OF RANGE' then 1 when 'NEVER CHECKED' then 2 when 'QUIET' then 3 else 4 end, room`);
  return {
    json: rows,
    text:
      heading('The coolstore') +
      '\n' +
      table(rows, [
        { key: 'room', label: 'room' },
        { key: 'target_min_c', label: 'band', format: (v, r) => `${num(v)} to ${num(r.target_max_c)} C` },
        { key: 'last_temp_c', label: 'last temp', align: 'right', format: (v) => (v === null || v === undefined ? '' : `${num(v)} C`) },
        { key: 'hours_since', label: 'checked', align: 'right', format: (v) => (v === null || v === undefined ? 'NEVER' : `${Math.round(num(v))}h ago`) },
        { key: 'checked_by', label: 'by', format: (v) => v || '' },
        { key: 'pallets_in_room', label: 'pallets', align: 'right' },
        { key: 'state', label: 'state' },
      ]) +
      '\n\n  The temperature record is what the export programme audits. A quiet room is a gap in it;\n  an out-of-range reading with fruit in the room is a decision, today. Record a check: temp <room> --temp=',
  };
}

async function cmdPools(db) {
  const rows = await db.query('select * from v_pools order by pool');
  return {
    json: rows,
    text:
      heading('Pools') +
      '\n' +
      table(rows, [
        { key: 'pool', label: 'pool', width: 16 },
        { key: 'variety', label: 'variety', format: (v, r) => v || r.crop },
        { key: 'trays_packed', label: 'packed', align: 'right' },
        { key: 'trays_dispatched', label: 'dispatched', align: 'right' },
        { key: 'trays_sold', label: 'sold', align: 'right' },
        { key: 'trays_unsold', label: 'unsold', align: 'right', format: (v) => (num(v) > 0 ? String(v) : '') },
        { key: 'gross_sales', label: 'gross sales', align: 'right', format: (v) => money(v) },
        { key: 'packing_charge_per_tray', label: 'pack/tray', align: 'right', format: (v) => money(v) },
        { key: 'levy_per_tray', label: 'levy/tray', align: 'right', format: (v) => money(v) },
        { key: 'status', label: 'status' },
      ]) +
      '\n\n  Growers are paid from these. Unsold means trays dispatched with no sale proceeds recorded yet:\n  a pool with unsold trays cannot close (pool close refuses), because closing it short-pays every grower in it.',
  };
}

async function cmdPool(db, args) {
  const p = await resolve(db, 'pool', args.join(' '));
  const [row] = await db.query('select * from v_pools where pool_id = $1', [p.id]);
  const returns = await db.query('select * from v_grower_returns where pool_id = $1 order by net_return desc', [p.id]);
  const poolSales = await db.query('select s.sold_on, s.trays, s.gross_value, coalesce(s.buyer, \'\') as buyer, c.ref as consignment from sales s left join consignments c on c.id = s.consignment_id where s.pool_id = $1 order by s.sold_on', [p.id]);
  const json = { pool: row, sales: poolSales, returns };
  let text = heading(`${row.pool} (${row.status})`) +
    `\n  ${row.trays_packed} trays packed, ${row.trays_dispatched} dispatched, ${row.trays_sold} sold for ${money(row.gross_sales)}` +
    `\n  charges: ${money(row.packing_charge_per_tray)}/tray packing, ${money(row.levy_per_tray)}/tray levies`;
  if (num(row.trays_unsold) > 0) text += `\n  ${row.trays_unsold} DISPATCHED TRAYS HAVE NO SALE RECORDED. The pool cannot close until the proceeds land: sale "${row.pool}" --trays= --value=`;
  if (poolSales.length) {
    text += '\n' + heading('Sales into the pool') + '\n' + table(poolSales, [
      { key: 'sold_on', label: 'date', format: (v) => isoDate(v) },
      { key: 'consignment', label: 'consignment', format: (v) => v || '' },
      { key: 'buyer', label: 'buyer', width: 26 },
      { key: 'trays', label: 'trays', align: 'right' },
      { key: 'gross_value', label: 'gross', align: 'right', format: (v) => money(v) },
    ]);
  }
  if (returns.length) {
    text += '\n' + heading('Grower returns at today\'s numbers') + '\n' + table(returns, [
      { key: 'grower', label: 'grower', width: 26 },
      { key: 'trays', label: 'trays', align: 'right' },
      { key: 'gross_share', label: 'gross share', align: 'right', format: (v) => money(v) },
      { key: 'packing_charges', label: 'packing', align: 'right', format: (v) => money(v) },
      { key: 'levies', label: 'levies', align: 'right', format: (v) => money(v) },
      { key: 'net_return', label: 'net', align: 'right', format: (v) => money(v) },
      { key: 'net_per_tray', label: 'per tray', align: 'right', format: (v) => money(v) },
    ]) + '\n\n  Pro-rata on trays packed into the pool, less packing charges and levies. The statement renders with npm run docs.';
  }
  return { json, text };
}

async function cmdReturns(db, args, flags) {
  const where = ['true'];
  const params = [];
  if (flags.pool) {
    const p = await resolve(db, 'pool', flags.pool);
    params.push(p.id);
    where.push(`pool_id = $${params.length}`);
  }
  const rows = await db.query(`select * from v_grower_returns where ${where.join(' and ')} order by pool, net_return desc`, params);
  return {
    json: rows,
    text:
      heading('Grower returns at today\'s numbers') +
      '\n' +
      table(rows, [
        { key: 'pool', label: 'pool', width: 16 },
        { key: 'pool_status', label: 'status' },
        { key: 'grower', label: 'grower', width: 26 },
        { key: 'trays', label: 'trays', align: 'right' },
        { key: 'gross_share', label: 'gross share', align: 'right', format: (v) => money(v) },
        { key: 'packing_charges', label: 'packing', align: 'right', format: (v) => money(v) },
        { key: 'levies', label: 'levies', align: 'right', format: (v) => money(v) },
        { key: 'net_return', label: 'net', align: 'right', format: (v) => money(v) },
        { key: 'net_per_tray', label: 'per tray', align: 'right', format: (v) => money(v) },
      ]) +
      '\n\n  An open pool moves with every sale. Statements draft with npm run docs; a person sends them.',
  };
}

async function cmdSeason(db) {
  const rows = await db.query('select * from v_season order by crop, variety');
  const pools = await db.query('select * from v_pools order by pool');
  return {
    json: { season: rows, pools },
    text:
      heading('The season so far') +
      '\n' +
      table(rows, [
        { key: 'crop', label: 'crop' },
        { key: 'variety', label: 'variety', format: (v) => v || '' },
        { key: 'deliveries', label: 'deliveries', align: 'right' },
        { key: 'kgs_received', label: 'kg received', align: 'right', format: (v) => String(num(v)) },
        { key: 'trays_packed', label: 'trays packed', align: 'right' },
        { key: 'trays_in_store', label: 'in store', align: 'right' },
        { key: 'trays_dispatched', label: 'dispatched', align: 'right' },
      ]) +
      '\n' + heading('The money') +
      '\n' +
      table(pools, [
        { key: 'pool', label: 'pool', width: 16 },
        { key: 'trays_sold', label: 'trays sold', align: 'right' },
        { key: 'gross_sales', label: 'gross sales', align: 'right', format: (v) => money(v) },
        { key: 'trays_unsold', label: 'unsold', align: 'right', format: (v) => (num(v) > 0 ? String(v) : '') },
        { key: 'status', label: 'status' },
      ]),
  };
}

async function cmdAttention(db) {
  const rows = await db.query(`
    select * from v_attention
    order by case reason
      when 'phi_hold' then 1
      when 'spray_diary_missing' then 2
      when 'assurance_missing' then 3
      when 'coolstore_out_of_range' then 4
      when 'gap_expired' then 5
      when 'delivery_ungraded' then 6
      when 'pool_unsold' then 7
      when 'pallet_aged' then 8
      when 'consignment_stale' then 9
      when 'coolstore_quiet' then 10
      when 'gap_expiring' then 11
      else 12 end,
      days desc nulls last
  `);
  return {
    json: rows,
    text:
      heading(`Needs a decision (${rows.length})`) +
      '\n' +
      table(rows, [
        { key: 'reason', label: 'why' },
        { key: 'label', label: 'record', width: 12 },
        { key: 'grower', label: 'grower', width: 24 },
        { key: 'place', label: 'where', width: 22 },
        { key: 'days', label: 'days', align: 'right', format: (v) => (v === null || v === undefined ? '' : String(v)) },
        { key: 'detail', label: 'detail', width: 78 },
      ]),
  };
}

async function cmdStats(db) {
  const [c] = await db.query(`
    select (select count(*) from growers where status = 'active')                                             as growers,
           (select count(*) from orchards where status = 'active')                                            as blocks,
           (select count(*) from v_orchards where status = 'active' and gap = 'EXPIRED')                      as gap_expired,
           (select count(*) from deliveries where status = 'received')                                        as awaiting_grading,
           (select count(*) from deliveries where status = 'held')                                            as held,
           (select coalesce(sum(kgs), 0) from deliveries)                                                     as kgs_received,
           (select coalesce(sum(class1_trays + class2_trays), 0) from grading_runs)                           as trays_packed,
           (select coalesce(sum(trays), 0) from pallets where status = 'in_store')                            as trays_in_store,
           (select count(*) from consignments where status = 'open')                                          as open_consignments,
           (select count(*) from v_consignments where status = 'open' and export and assurance_ref is null and pallet_count > 0) as blocked_consignments,
           (select coalesce(sum(trays_unsold), 0) from v_pools where status = 'open')                         as trays_unsold,
           (select count(*) from v_attention)                                                                 as attention_items
  `);
  const json = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Number(v)]));
  return {
    json,
    text:
      heading('The season') +
      `\n  ${json.growers} growers across ${json.blocks} blocks${json.gap_expired ? ` (${json.gap_expired} with EXPIRED GAP certificates)` : ''}` +
      `\n  ${num(json.kgs_received)} kg received, ${json.trays_packed} trays packed, ${json.trays_in_store} trays in store` +
      `\n  ${json.awaiting_grading} delivery(ies) awaiting grading, ${json.held} held` +
      `\n  ${json.open_consignments} open consignment(s)${json.blocked_consignments ? ` (${json.blocked_consignments} blocked on assurance)` : ''}, ${json.trays_unsold} dispatched trays unsold` +
      `\n  ${json.attention_items} items on the attention list`,
  };
}

// ---------------------------------------------------------------------------
// The intake pipeline: receive -> diary -> grade, with the spray window gate
// at the door and the diary gate at the grader.

async function cmdReceive(db, args, flags) {
  const orchard = await resolve(db, 'orchard', args.join(' ') || str(flags.orchard));
  const bins = Number(flags.bins);
  const kgs = Number(flags.kgs);
  if (!(bins > 0) || !(kgs > 0)) throw new CliError('How much fruit? receive <block> --bins= --kgs= [--picked= --last-spray= --withholding= --diary]');
  const receivedOn = parseDate(flags.on) || today();
  const pickedOn = parseDate(flags.picked) || receivedOn;
  const lastSpray = parseDate(flags['last-spray']);
  const withholding = Number(flags.withholding || 0);
  if (lastSpray && withholding > 0) {
    const clearFrom = addDays(lastSpray, withholding);
    if (pickedOn < clearFrom) {
      if (!flags.hold) {
        throw new CliError(
          `This fruit was picked ${pickedOn}, inside the spray withholding period: last spray ${lastSpray} plus ${withholding} days ` +
            `on the label means the block was not clear until ${clearFrom}.\n` +
            `It does not come in as normal stock. Receive it held, with the decision trail started:\n` +
            `  receive "${orchard.name}" --bins=${bins} --kgs=${kgs} --picked=${pickedOn} --last-spray=${lastSpray} --withholding=${withholding} --hold --reason="what happens next"\n` +
            `Held fruit sits at the top of the attention list until someone decides: residue test, a cleared market, or the dump.`,
        );
      }
      if (!str(flags.reason)) throw new CliError('--hold needs the reason and the next step in --reason=. A hold with no plan is fruit rotting quietly.');
    }
  }
  const held = Boolean(flags.hold);
  const ref = await nextRef(db, 'DEL', 'deliveries', 'ref', 500);
  const [row] = await db.query(
    `insert into deliveries (ref, orchard_id, received_on, picked_on, bins, kgs, last_spray_on, withholding_days, spray_diary_received, maturity_ref, status, hold_reason)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning *`,
    [ref, orchard.id, receivedOn, pickedOn, bins, kgs, lastSpray, withholding, Boolean(flags.diary), str(flags.maturity) || null,
     held ? 'held' : 'received', held ? str(flags.reason) : null],
  );
  let text = `${ref} on the intake record: ${bins} bins (${kgs} kg) of ${orchard.variety || orchard.crop} from ${orchard.name}, ${orchard.grower_name}.`;
  if (held) text += `\nHELD: ${str(flags.reason)}\nIt stays on the attention list until the decision is made and logged.`;
  else if (!flags.diary) text += `\nNo spray diary yet: grading is blocked until it lands. Record it: diary ${ref}`;
  else text += `\nNext: grade ${ref} --class1= --class2= --reject-kg=`;
  return { json: row, text };
}

async function cmdDiary(db, args, flags) {
  const d = await resolve(db, 'delivery', args[0]);
  const [row] = await db.query(`update deliveries set spray_diary_received = true, last_spray_on = coalesce($1, last_spray_on), withholding_days = coalesce($2, withholding_days) where id = $3 returning *`,
    [parseDate(flags['last-spray']), flags.withholding !== undefined ? Number(flags.withholding) : null, d.id]);
  return { json: row, text: `${d.ref}: spray diary on record. Grading is unblocked: grade ${d.ref} --class1= --class2= --reject-kg=` };
}

async function cmdGrade(db, args, flags) {
  const d = await resolve(db, 'delivery', args[0]);
  if (d.status === 'graded') throw new CliError(`${d.ref} is already graded. \`delivery ${d.ref}\` shows the runs and pallets.`);
  if (d.status === 'held') {
    throw new CliError(
      `${d.ref} is HELD: ${d.hold_reason || 'no reason recorded'}\n` +
        `Held fruit does not go over the grader until the hold is resolved and logged. If the residue test cleared it\n` +
        `or the fruit is going to a cleared market, log the decision first (log ${d.ref} "...") and release it:\n` +
        `  release ${d.ref} --note="why it is now safe to pack"`,
    );
  }
  if (!d.spray_diary_received) {
    throw new CliError(
      `${d.ref} has no spray diary on record, and fruit does not go over the grader without one.\n` +
        `Residues over an export market's limit close that market for everyone, and the diary is the only\n` +
        `evidence the fruit was clear. Chase the grower, then: diary ${d.ref} [--last-spray= --withholding=]`,
    );
  }
  const class1 = Number(flags.class1 || 0);
  const class2 = Number(flags.class2 || 0);
  const rejectKg = Number(flags['reject-kg'] || 0);
  if (!(class1 > 0) && !(class2 > 0)) throw new CliError(`What came off the grader? grade ${d.ref} --class1=<trays> --class2=<trays> --reject-kg=<kg>`);
  const inputKg = Number(flags['input-kg'] || num(d.kgs));
  const gradedOn = parseDate(flags.on) || today();
  const [run] = await db.query(
    `insert into grading_runs (delivery_id, graded_on, input_kg, class1_trays, class2_trays, reject_kg, note) values ($1, $2, $3, $4, $5, $6, $7) returning *`,
    [d.id, gradedOn, inputKg, class1, class2, rejectKg, str(flags.note) || null],
  );
  await db.query(`update deliveries set status = 'graded' where id = $1`, [d.id]);

  // Pallets: chunked by grade, auto-assigned to the open pool for this crop
  // and variety, into the named room.
  const [orch] = await db.query('select * from orchards where id = $1', [d.orchard_id]);
  const [pool] = await db.query(
    `select * from pools where status = 'open' and crop = $1 and (coalesce(variety, '') = coalesce($2, '') or variety is null) order by variety nulls last limit 1`,
    [orch.crop, orch.variety],
  );
  const room = str(flags.room) || 'Room 1';
  const perPallet = Number(flags['trays-per-pallet'] || DEFAULT_TRAYS_PER_PALLET);
  const pallets = [];
  for (const [grade, total] of [['class1', class1], ['class2', class2]]) {
    let left = total;
    while (left > 0) {
      const trays = Math.min(left, perPallet);
      left -= trays;
      const palletNo = await nextRef(db, 'PLT', 'pallets', 'pallet_no', 4000);
      const [p] = await db.query(
        `insert into pallets (pallet_no, grading_run_id, pool_id, grade, trays, packed_on, room) values ($1, $2, $3, $4, $5, $6, $7) returning *`,
        [palletNo, run.id, pool?.id || null, grade, trays, gradedOn, room],
      );
      pallets.push(p);
    }
  }
  const [pk] = await db.query('select * from v_packouts where run_id = $1', [run.id]);
  let text = `${d.ref} graded: ${class1} class 1, ${class2} class 2, ${rejectKg} kg reject. Packout ${num(pk.packout_pct)}%, class 1 share ${num(pk.class1_share_pct)}%.` +
    `\n${pallets.length} pallet(s) built into ${room}: ${pallets.map((p) => `${p.pallet_no} (${p.grade}, ${p.trays})`).join(', ')}.`;
  text += pool ? `\nPool: ${pool.name}.` : `\nNO OPEN POOL matches ${orch.crop}${orch.variety ? ` ${orch.variety}` : ''}: these trays are outside the money until one exists (pool add).`;
  text += `\nThe grower's packout statement drafts with npm run docs.`;
  return { json: { run, pallets }, text };
}

async function cmdRelease(db, args, flags) {
  const d = await resolve(db, 'delivery', args[0]);
  if (d.status !== 'held') throw new CliError(`${d.ref} is not held (${d.status}).`);
  if (!str(flags.note)) throw new CliError(`Releasing held fruit is a decision, and decisions get recorded: release ${d.ref} --note="residue result / cleared market / why"`);
  await db.query(`insert into notes (delivery_id, note) values ($1, $2)`, [d.id, `RELEASED FROM HOLD: ${str(flags.note)}`]);
  const [row] = await db.query(`update deliveries set status = 'received', hold_reason = null where id = $1 returning *`, [d.id]);
  return { json: row, text: `${d.ref} released from hold, with the reason on the record. Next: grade ${d.ref}.` };
}

// ---------------------------------------------------------------------------
// The coolstore and dispatch

async function cmdMove(db, args, flags) {
  const p = await resolve(db, 'pallet', args[0]);
  if (p.status === 'dispatched') throw new CliError(`${p.pallet_no} has been dispatched. Dispatched pallets do not move rooms.`);
  const room = await resolve(db, 'room', str(flags.room) || args[1]);
  const [row] = await db.query(`update pallets set room = $1 where id = $2 returning *`, [room.name, p.id]);
  return { json: row, text: `${p.pallet_no} moved to ${room.name}.` };
}

async function cmdTemp(db, args, flags) {
  const room = await resolve(db, 'room', args.join(' '));
  if (flags.temp === undefined || flags.temp === true || Number.isNaN(Number(flags.temp))) throw new CliError(`What did it read? temp "${room.name}" --temp=1.4 [--by=]`);
  const temp = Number(flags.temp);
  const [row] = await db.query(
    `insert into temp_checks (room_id, temp_c, checked_by, note) values ($1, $2, $3, $4) returning *`,
    [room.id, temp, str(flags.by) || null, str(flags.note) || null],
  );
  const inRange = temp >= num(room.target_min_c) && temp <= num(room.target_max_c);
  let text = `${room.name}: ${temp} C on the record${str(flags.by) ? ` (${str(flags.by)})` : ''}.`;
  if (!inRange) {
    const [cs] = await db.query('select * from v_coolstore where room_id = $1', [room.id]);
    text += `\nOUT OF RANGE: the band is ${num(room.target_min_c)} to ${num(room.target_max_c)} C and there are ${cs.pallets_in_room} pallet(s) in the room.` +
      `\nThat is a decision, now: check the plant, move the fruit, and log what you did (log ${room.name} is not a target; log the affected pallets or note the room fix here with --note=).`;
  }
  return { json: row, text };
}

async function cmdConsign(db, args, flags) {
  const sub = args[0];
  if (sub === 'create') {
    const buyer = str(flags.buyer);
    if (!buyer) throw new CliError('consign create --buyer="..." [--destination= --export --carrier=]');
    const ref = await nextRef(db, 'CON', 'consignments', 'ref', 300);
    const [row] = await db.query(
      `insert into consignments (ref, buyer, destination, export, carrier) values ($1, $2, $3, $4, $5) returning *`,
      [ref, buyer, str(flags.destination) || null, Boolean(flags.export), str(flags.carrier) || null],
    );
    let text = `${ref} open: ${buyer}${row.destination ? `, ${row.destination}` : ''}${row.export ? ' (EXPORT)' : ''}.`;
    text += `\nLoad it: consign add <pallet> --to=${ref}.`;
    if (row.export) text += ` It will not dispatch until the assurance reference is recorded: assurance ${ref} --ref=`;
    return { json: row, text };
  }
  if (sub === 'add') {
    const p = await resolve(db, 'pallet', args[1]);
    const c = await resolve(db, 'consignment', str(flags.to));
    if (c.status !== 'open') throw new CliError(`${c.ref} is ${c.status}. Pallets load onto open consignments.`);
    if (p.status === 'dispatched') throw new CliError(`${p.pallet_no} has already been dispatched.`);
    if (p.consignment_id && p.consignment_id !== c.id) {
      const [other] = await db.query('select ref from consignments where id = $1', [p.consignment_id]);
      throw new CliError(`${p.pallet_no} is already allocated to ${other?.ref}. Take it off first if that has changed.`);
    }
    if (c.export) {
      const [vp] = await db.query('select * from v_pallets where pallet_id = $1', [p.id]);
      const [orch] = await db.query(
        `select o.* from orchards o join deliveries d on d.orchard_id = o.id join grading_runs r on r.delivery_id = d.id where r.id = $1`,
        [p.grading_run_id],
      );
      const [vo] = await db.query('select * from v_orchards where orchard_id = $1', [orch.id]);
      if (vo.gap === 'EXPIRED' || vo.gap === 'NONE') {
        throw new CliError(
          `${p.pallet_no} is from ${vo.orchard} (${vo.block_code}) and that block's ${vo.gap_scheme || 'GAP'} certificate is ${vo.gap === 'NONE' ? 'not on record' : `expired (${isoDate(vo.gap_cert_expires_on)})`}.\n` +
            `Export programmes buy from certified blocks; this pallet does not join an export consignment.\n` +
            `Sell it domestic, or record the renewed certificate on the block first (customise or update the orchard).`,
        );
      }
      void vp;
    }
    const [row] = await db.query(`update pallets set consignment_id = $1 where id = $2 returning *`, [c.id, p.id]);
    const [vc] = await db.query('select * from v_consignments where consignment_id = $1', [c.id]);
    return { json: row, text: `${p.pallet_no} (${p.trays} trays) onto ${c.ref}: now ${vc.pallet_count} pallet(s), ${vc.trays} trays.` };
  }
  throw new CliError('consign create --buyer= [--destination= --export], or consign add <pallet> --to=<CON-ref>');
}

async function cmdAssurance(db, args, flags) {
  const c = await resolve(db, 'consignment', args[0]);
  if (!c.export) throw new CliError(`${c.ref} is a domestic consignment; assurance references belong to export ones.`);
  const ref = str(flags.ref);
  if (!ref) throw new CliError(`assurance ${c.ref} --ref="<the MPI assurance / phyto reference>"`);
  const [row] = await db.query(`update consignments set assurance_ref = $1 where id = $2 returning *`, [ref, c.id]);
  return { json: row, text: `${c.ref}: assurance ${ref} on record. It can dispatch: dispatch ${c.ref}` };
}

async function cmdDispatch(db, args, flags) {
  const c = await resolve(db, 'consignment', args[0]);
  if (c.status === 'dispatched') throw new CliError(`${c.ref} was dispatched ${isoDate(c.dispatched_on)}.`);
  const [vc] = await db.query('select * from v_consignments where consignment_id = $1', [c.id]);
  if (!num(vc.pallet_count)) throw new CliError(`${c.ref} has no pallets on it. Load it first: consign add <pallet> --to=${c.ref}`);
  if (c.export && !c.assurance_ref) {
    throw new CliError(
      `${c.ref} is an export consignment and there is no assurance reference on record. It does not leave,\n` +
        `and there is no force flag: fruit that ships without its phytosanitary assurance is a market-access\n` +
        `incident for the whole programme, not a paperwork gap. Record it, then dispatch:\n` +
        `  assurance ${c.ref} --ref="<the MPI assurance / phyto reference>"`,
    );
  }
  const on = parseDate(flags.on) || today();
  const [row] = await db.query(`update consignments set status = 'dispatched', dispatched_on = $1, carrier = coalesce($2, carrier) where id = $3 returning *`, [on, str(flags.carrier) || null, c.id]);
  await db.query(`update pallets set status = 'dispatched', room = null where consignment_id = $1`, [c.id]);
  let text = `${c.ref} dispatched ${on}: ${vc.pallet_count} pallet(s), ${vc.trays} trays to ${c.buyer}.`;
  text += `\nWhen the proceeds land, record the sale so the growers' pools move: sale <pool> --trays= --value= --consignment=${c.ref}`;
  return { json: row, text };
}

// ---------------------------------------------------------------------------
// Pools, sales, returns

async function cmdPoolWrite(db, args, flags) {
  const sub = args[0];
  if (sub === 'add') {
    const name = args.slice(1).join(' ');
    if (!name) throw new CliError('pool add "<name>" --crop= [--variety= --season= --packing-charge= --levy=]');
    const crop = str(flags.crop);
    if (!CROPS.includes(crop)) throw new CliError(`--crop= is one of: ${CROPS.join(', ')}`);
    const [row] = await db.query(
      `insert into pools (name, season, crop, variety, packing_charge_per_tray, levy_per_tray) values ($1, $2, $3, $4, $5, $6) returning *`,
      [name, Number(flags.season || new Date().getFullYear()), crop, str(flags.variety) || null, Number(flags['packing-charge'] || 0), Number(flags.levy || 0)],
    );
    return { json: row, text: `${name} open: ${crop}${row.variety ? ` ${row.variety}` : ''}, ${money(row.packing_charge_per_tray)}/tray packing, ${money(row.levy_per_tray)}/tray levies. Grading runs for this crop now pack into it.` };
  }
  if (sub === 'close') {
    const p = await resolve(db, 'pool', args.slice(1).join(' '));
    if (p.status === 'closed') throw new CliError(`${p.name} is already closed.`);
    const [v] = await db.query('select * from v_pools where pool_id = $1', [p.id]);
    if (num(v.trays_unsold) > 0) {
      throw new CliError(
        `${p.name} has ${v.trays_unsold} dispatched tray(s) with no sale proceeds recorded. It does not close,\n` +
          `and there is no force flag: growers are paid their share of this pool, and closing it now\n` +
          `short-pays every one of them. Record the missing sale first:\n` +
          `  sale "${p.name}" --trays=${v.trays_unsold} --value=<gross> [--consignment=]`,
      );
    }
    const [row] = await db.query(`update pools set status = 'closed', closed_on = $1 where id = $2 returning *`, [parseDate(flags.on) || today(), p.id]);
    return { json: row, text: `${p.name} closed with ${v.trays_sold} trays sold for ${money(v.gross_sales)}. Final statements: npm run docs. A person sends them, with the payment run.` };
  }
  throw new CliError('pool add "<name>" --crop= [--variety= --packing-charge= --levy=], or pool close <name>');
}

async function cmdSale(db, args, flags) {
  const p = await resolve(db, 'pool', args.join(' '));
  if (p.status === 'closed') throw new CliError(`${p.name} is closed. Proceeds for a closed pool are a reopening conversation, not a quiet insert.`);
  const trays = Number(flags.trays);
  const value = Number(flags.value);
  if (!(trays > 0) || !(value > 0)) throw new CliError(`sale "${p.name}" --trays= --value=<gross NZD> [--on= --buyer= --consignment=]`);
  const con = flags.consignment ? await resolve(db, 'consignment', flags.consignment) : null;
  const [row] = await db.query(
    `insert into sales (pool_id, consignment_id, sold_on, trays, gross_value, buyer) values ($1, $2, $3, $4, $5, $6) returning *`,
    [p.id, con?.id || null, parseDate(flags.on) || today(), trays, value, str(flags.buyer) || con?.buyer || null],
  );
  const [v] = await db.query('select * from v_pools where pool_id = $1', [p.id]);
  let text = `${p.name}: ${trays} trays sold for ${money(value)}${con ? ` (${con.ref})` : ''}. Pool now ${v.trays_sold} sold of ${v.trays_dispatched} dispatched, ${money(v.gross_sales)} gross.`;
  if (num(v.trays_unsold) > 0) text += `\n${v.trays_unsold} dispatched tray(s) still without proceeds.`;
  return { json: row, text };
}

// ---------------------------------------------------------------------------
// The log, add

async function cmdLog(db, args, flags) {
  const first = str(args[0]);
  let delivery = null;
  let pallet = null;
  let consignment = null;
  let grower = null;
  if (/^del/i.test(first)) delivery = await resolve(db, 'delivery', first, { optional: true });
  if (!delivery && /^plt/i.test(first)) pallet = await resolve(db, 'pallet', first, { optional: true });
  if (!delivery && !pallet && /^con/i.test(first)) consignment = await resolve(db, 'consignment', first, { optional: true });
  if (!delivery && !pallet && !consignment) {
    grower = await resolve(db, 'grower', first, { optional: true });
    if (!grower) delivery = await resolve(db, 'delivery', first, { optional: true });
  }
  if (!delivery && !pallet && !consignment && !grower) {
    throw new CliError(`"${first}" matches no delivery, pallet, consignment or grower. log <DEL-ref | PLT-no | CON-ref | grower> "what happened"`);
  }
  const note = args.slice(1).join(' ');
  if (!note) throw new CliError('What happened? log <target> "what was said or decided"');
  const [row] = await db.query(
    `insert into notes (grower_id, delivery_id, pallet_id, consignment_id, noted_on, note) values ($1, $2, $3, $4, $5, $6) returning *`,
    [grower?.id || null, delivery?.id || null, pallet?.id || null, consignment?.id || null, parseDate(flags.on) || today(), note],
  );
  const target = delivery?.ref || pallet?.pallet_no || consignment?.ref || grower?.name;
  return { json: row, text: `Logged against ${target}.` };
}

async function cmdAdd(db, args, flags) {
  const kind = args[0];
  const name = args.slice(1).join(' ');
  if (!name) throw new CliError(`add ${kind || 'grower|orchard|room'} "<name>" [--flags]`);
  if (kind === 'grower') {
    const [row] = await db.query(
      `insert into growers (name, code, contact_name, email, phone, gst_number) values ($1, $2, $3, $4, $5, $6) returning *`,
      [name, str(flags.code) || null, str(flags.contact) || null, str(flags.email) || null, str(flags.phone) || null, str(flags.gst) || null],
    );
    return { json: row, text: `${name} on the books${row.code ? ` (${row.code})` : ''}.\nAdd their blocks next: add orchard "<block name>" --grower="${name}" --crop= --variety= --block= --gap-scheme= --gap-expires=` };
  }
  if (kind === 'orchard') {
    const g = await resolve(db, 'grower', str(flags.grower));
    const crop = str(flags.crop) || 'kiwifruit';
    if (!CROPS.includes(crop)) throw new CliError(`--crop= is one of: ${CROPS.join(', ')}`);
    const [row] = await db.query(
      `insert into orchards (grower_id, name, block_code, region, crop, variety, hectares, gap_scheme, gap_cert_expires_on)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
      [g.id, name, str(flags.block) || null, str(flags.region) || null, crop, str(flags.variety) || null,
       flags.hectares ? Number(flags.hectares) : null, str(flags['gap-scheme']) || null, parseDate(flags['gap-expires'])],
    );
    let text = `${name} added for ${g.name} (${crop}${row.variety ? ` ${row.variety}` : ''}).`;
    if (!row.gap_cert_expires_on) text += `\nNo GAP certificate on record: fruit from this block cannot join an export consignment until one is (the CLI refuses at consign add).`;
    return { json: row, text };
  }
  if (kind === 'room') {
    const min = Number(flags.min);
    const max = Number(flags.max);
    if (Number.isNaN(min) || Number.isNaN(max)) throw new CliError('add room "<name>" --min=<C> --max=<C>');
    const [row] = await db.query(`insert into coolrooms (name, target_min_c, target_max_c) values ($1, $2, $3) returning *`, [name, min, max]);
    return { json: row, text: `${name} added (${min} to ${max} C). It shows NEVER CHECKED until the first reading: temp "${name}" --temp=` };
  }
  throw new CliError('add grower "<name>" [--code= --contact= --phone=], add orchard "<name>" --grower= --crop=, or add room "<name>" --min= --max=');
}

// ---------------------------------------------------------------------------
// Compliance: the rule book, run against the records. docs/compliance.md
// carries each rule's source; this is the executable half.

const RULES = [
  {
    key: 'traceability',
    title: 'Every pallet traces one step back to a block and a pick date',
    source: 'Food Act 2014 traceability duties and every GAP scheme: product must trace one step back (the block and the day it was picked) and one step forward (who it went to). The pallet number on the docket is the thread',
    sql: `select p.pallet_no as label, 'cannot trace: ' || case when d.picked_on is null then 'no pick date on ' || p.delivery_ref else 'no block code on ' || p.orchard end as detail
          from v_pallets p join v_deliveries d on d.ref = p.delivery_ref
          where d.picked_on is null or d.block_code is null`,
    fix: 'Put the missing pick date or block code on the record. Imported history is the usual culprit; fix it while the paper still exists.',
  },
  {
    key: 'spray_diary',
    title: 'No fruit on the floor without its spray diary',
    source: 'NZGAP and GLOBALG.A.P. require the spray record before fruit is packed; export MRL compliance depends on it. A residue over an importing market\'s limit closes that market for every grower in the programme',
    sql: `select ref || ' ' || grower as label, bins || ' bins received ' || to_char(received_on, 'YYYY-MM-DD') || ' with no spray diary; grading is blocked' as detail
          from v_deliveries where status = 'received' and not spray_diary_received`,
    fix: 'Chase the grower today, then: diary <ref> --last-spray= --withholding=. The gate at grade enforces this.',
  },
  {
    key: 'phi',
    title: 'No fruit picked inside its spray withholding period, unresolved',
    source: 'ACVM Act 1997 label directions: the withholding period on the agrichemical label is law, and fruit picked inside it risks exceeding maximum residue limits. Held fruit is a decision waiting, not stock',
    sql: `select ref || ' ' || grower as label, 'picked ' || to_char(picked_on, 'YYYY-MM-DD') || ', clear from ' || to_char(phi_clear_on, 'YYYY-MM-DD') || case when status = 'held' then ' (held: decide residue test, cleared market, or dump)' else ' AND NOT HELD' end as detail
          from v_deliveries where phi_breach and status <> 'graded'`,
    fix: 'Resolve each hold: residue test result, a cleared market, or the dump, then log the decision and release <ref> --note=.',
  },
  {
    key: 'gap',
    title: 'No active block supplying fruit on an expired GAP certificate',
    source: 'Export programmes and most retail programmes buy only from GLOBALG.A.P. or NZGAP certified orchards. An expired certificate makes the block\'s fruit unsaleable to them the day it lapses',
    sql: `select block_code || ' ' || grower as label, gap_scheme || ' certificate expired ' || to_char(gap_cert_expires_on, 'YYYY-MM-DD') || ' (' || abs(days_to_gap_expiry) || ' days ago)' as detail
          from v_orchards where status = 'active' and gap = 'EXPIRED'`,
    fix: 'Book the audit, and until it passes keep the block\'s fruit out of export consignments (the CLI already refuses at consign add).',
  },
  {
    key: 'assurance',
    title: 'No export consignment moving without its assurance reference',
    source: 'MPI plant export requirements: export consignments carry official assurance (phytosanitary certification) for the destination market. Fruit that ships without it is a market-access incident, not a paperwork gap',
    sql: `select ref || ' ' || buyer as label, case when status = 'dispatched' then 'DISPATCHED without an assurance reference' else pallet_count || ' pallet(s) loaded, open ' || days_open || ' days, no assurance reference yet' end as detail
          from v_consignments where export and assurance_ref is null and pallet_count > 0`,
    fix: 'Record the reference the moment it is issued: assurance <ref> --ref=. dispatch refuses without it, and there is no force flag.',
  },
  {
    key: 'coolchain',
    title: 'Every active coolroom checked inside 24 hours and reading inside its band',
    source: 'Export programme and customer audit requirements: a continuous temperature record per room. The business sets the bands (kiwifruit holds near 0 to 2 C, Hass avocados 4 to 7 C); the record proves the fruit lived inside them',
    sql: `select room as label, case when state = 'OUT OF RANGE' then 'last reading ' || last_temp_c || ' C against ' || target_min_c || ' to ' || target_max_c || ' C, ' || pallets_in_room || ' pallet(s) in the room' when state = 'NEVER CHECKED' then 'no temperature check on record' else 'no check for ' || round(hours_since) || ' hours' end as detail
          from v_coolstore where state <> 'ok'`,
    fix: 'Walk the store now: temp <room> --temp= --by=. An out-of-range room with fruit in it is a same-day decision, and the log wants what you did.',
  },
  {
    key: 'grading',
    title: 'No delivery sitting ungraded past 72 hours',
    source: 'This business\'s own standard: fruit is condition and condition is money. Bins on the intake pad lose both, and the grower is watching',
    sql: `select ref || ' ' || grower as label, bins || ' bins (' || kgs || ' kg) received ' || to_char(received_on, 'YYYY-MM-DD') || ', ' || days_since_received || ' days ago' as detail
          from v_deliveries where status = 'received' and spray_diary_received and days_since_received > 3`,
    fix: 'Grade it today: grade <ref> --class1= --class2= --reject-kg=. If the grader is the bottleneck, that is the real finding.',
  },
  {
    key: 'aged_stock',
    title: 'No pallet in store past six weeks',
    source: 'This business\'s own standard: storage life is finite and class 2 fruit does not improve. Six weeks is the tap on the shoulder; your crop and market set the real number, so change it',
    sql: `select pallet_no || ' ' || grower as label, trays || ' trays of ' || coalesce(variety, crop) || ' ' || grade || ' packed ' || to_char(packed_on, 'YYYY-MM-DD') || ' (' || days_in_store || ' days in store)' as detail
          from v_pallets where status = 'in_store' and days_in_store > 42`,
    fix: 'Sell it, move it, or make the write-off decision while it is still a decision: consign add, or log the call.',
  },
  {
    key: 'pool_integrity',
    title: 'No pool with dispatched trays missing their sale proceeds',
    source: 'The grower supply agreement: growers are paid their pro-rata share of the pool. Dispatched trays with no sale recorded are money missing from every statement, and a pool cannot close over the top of them',
    sql: `select pool as label, trays_unsold || ' dispatched tray(s) with no sale recorded (' || trays_sold || ' of ' || trays_dispatched || ' sold)' as detail
          from v_pools where status = 'open' and trays_unsold > 0`,
    fix: 'Chase the proceeds and record them: sale <pool> --trays= --value= --consignment=. pool close refuses until this is clean.',
  },
];

async function cmdCompliance(db, args) {
  const only = args[0];
  const rules = only ? RULES.filter((r) => r.key === only) : RULES;
  if (!rules.length) throw new CliError(`No rule "${only}". Rules: ${RULES.map((r) => r.key).join(', ')}`);
  const results = [];
  for (const rule of rules) {
    const breaches = await db.query(rule.sql);
    results.push({ key: rule.key, title: rule.title, source: rule.source, fix: rule.fix, breaches });
  }
  let text = heading('The rule book, run against the records');
  for (const r of results) {
    text += `\n\n${r.breaches.length ? 'FAIL' : ' ok '} ${r.key}: ${r.title}`;
    text += `\n      ${r.source}`;
    for (const b of r.breaches) text += `\n      - ${b.label}: ${b.detail}`;
    if (r.breaches.length) text += `\n      fix: ${r.fix}`;
  }
  const failed = results.filter((r) => r.breaches.length).length;
  text += `\n\n${results.length - failed} of ${results.length} rules pass. Sources and the fuller reading: docs/compliance.md. None of this is legal advice.`;
  return { json: results, text };
}

// ---------------------------------------------------------------------------
// Import and export

function truthy(v) {
  return /^(y|yes|true|1|received|on record)/i.test(String(v || '').trim());
}

async function cmdImport(db, args, flags) {
  const source = args[0];
  if (!['radfords', 'freshpack', 'csv'].includes(source || '')) {
    throw new CliError('import radfords|freshpack|csv --growers=file.csv [--orchards=file.csv] [--deliveries=file.csv] [--dry-run]');
  }
  const dryRun = Boolean(flags['dry-run']);
  const readCsvFile = (flag) => {
    const file = str(flags[flag]);
    if (!file) return null;
    if (!existsSync(file)) throw new CliError(`No ${flag} file at ${file}.`);
    return parseCsv(readFileSync(file, 'utf8'));
  };
  const growerRows = readCsvFile('growers');
  const orchardRows = readCsvFile('orchards');
  const deliveryRows = readCsvFile('deliveries');
  if (!growerRows && !orchardRows && !deliveryRows) {
    throw new CliError('Nothing to import. Pass at least one of --growers= --orchards= --deliveries=.');
  }

  const counts = { growers: 0, growers_updated: 0, orchards: 0, deliveries: 0, skipped: 0, diary_missing: 0, gap_expired: 0 };
  const skips = [];
  const pendingGrowers = new Map();
  const pendingOrchards = new Map();

  const findGrower = async (name) => {
    if (!name) return null;
    const rows = await db.query('select * from growers where lower(name) = lower($1) or lower(coalesce(code, \'\')) = lower($1)', [name]);
    if (rows.length === 1) return rows[0];
    return pendingGrowers.get(name.toLowerCase()) || null;
  };
  const findOrchard = async (q) => {
    if (!q) return null;
    const rows = await db.query('select * from orchards where lower(name) = lower($1) or lower(coalesce(block_code, \'\')) = lower($1)', [q]);
    if (rows.length === 1) return rows[0];
    return pendingOrchards.get(q.toLowerCase()) || null;
  };

  if (growerRows) {
    for (const row of growerRows) {
      const name = pick(row, 'Name', 'Grower', 'Grower Name', 'Company', 'Supplier');
      if (!name) {
        counts.skipped++;
        skips.push('grower row with no name column value');
        continue;
      }
      const existing = await findGrower(name);
      if (existing) {
        counts.growers_updated++;
        if (!dryRun) {
          await db.query(
            `update growers set code = coalesce($1, code), contact_name = coalesce($2, contact_name), email = coalesce($3, email), phone = coalesce($4, phone) where id = $5`,
            [pick(row, 'Code', 'Grower Code', 'Supplier Code') || null, pick(row, 'Contact', 'Contact Name') || null, pick(row, 'Email') || null, pick(row, 'Phone', 'Mobile') || null, existing.id],
          );
        }
      } else {
        counts.growers++;
        if (dryRun) {
          pendingGrowers.set(name.toLowerCase(), { id: null, name, __pending: true });
        } else {
          const [created] = await db.query(
            `insert into growers (name, code, contact_name, email, phone) values ($1, $2, $3, $4, $5) returning *`,
            [name, pick(row, 'Code', 'Grower Code', 'Supplier Code') || null, pick(row, 'Contact', 'Contact Name') || null, pick(row, 'Email') || null, pick(row, 'Phone', 'Mobile') || null],
          );
          pendingGrowers.set(name.toLowerCase(), created);
        }
      }
    }
  }

  if (orchardRows) {
    for (const row of orchardRows) {
      const name = pick(row, 'Orchard', 'Block', 'Name', 'Orchard Name', 'Block Name');
      const growerName = pick(row, 'Grower', 'Grower Name', 'Supplier', 'Owner');
      const grower = await findGrower(growerName);
      if (!name || !grower) {
        counts.skipped++;
        skips.push(`orchard "${name || '(no name)'}" ${!grower ? `for grower "${growerName || '(none)'}" who matches nobody on file` : 'with no name'}`);
        continue;
      }
      const cropRaw = String(pick(row, 'Crop', 'Product', 'Commodity') || 'kiwifruit').toLowerCase();
      const crop = CROPS.find((c) => cropRaw.includes(c)) || 'other';
      const gapExpiry = pick(row, 'GAP Expiry', 'Cert Expiry', 'Certificate Expiry', 'GAP Certificate Expiry');
      counts.orchards++;
      if (gapExpiry && parseDate(gapExpiry) < today()) counts.gap_expired++;
      if (!dryRun && !grower.__pending) {
        const [created] = await db.query(
          `insert into orchards (grower_id, name, block_code, region, crop, variety, hectares, gap_scheme, gap_cert_expires_on, external_ref)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) on conflict (external_ref) do nothing returning *`,
          [grower.id, name, pick(row, 'Block Code', 'KPIN', 'Code', 'Reference') || null, pick(row, 'Region', 'District') || null, crop,
           pick(row, 'Variety', 'Cultivar') || null, pick(row, 'Hectares', 'Ha', 'Area') ? Number(pick(row, 'Hectares', 'Ha', 'Area')) : null,
           pick(row, 'GAP Scheme', 'Scheme', 'Certification') || null, gapExpiry ? parseDate(gapExpiry) : null,
           pick(row, 'ID', 'Ref') || null],
        );
        if (created) pendingOrchards.set(name.toLowerCase(), created);
      } else if (dryRun) {
        pendingOrchards.set(name.toLowerCase(), { id: null, name, __pending: true });
      }
    }
  }

  if (deliveryRows) {
    for (const row of deliveryRows) {
      const orchardName = pick(row, 'Orchard', 'Block', 'Block Code', 'KPIN');
      const orchard = await findOrchard(orchardName);
      if (!orchard) {
        counts.skipped++;
        skips.push(`delivery from "${orchardName || '(no block)'}" which matches no block on file`);
        continue;
      }
      const diary = truthy(pick(row, 'Spray Diary', 'Diary', 'Spray Record'));
      counts.deliveries++;
      if (!diary) counts.diary_missing++;
      if (!dryRun && !orchard.__pending) {
        const ref = await nextRef(db, 'DEL', 'deliveries', 'ref', 500);
        const statusRaw = String(pick(row, 'Status') || '').toLowerCase();
        await db.query(
          `insert into deliveries (ref, orchard_id, received_on, picked_on, bins, kgs, spray_diary_received, status, external_ref)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (external_ref) do nothing`,
          [ref, orchard.id,
           pick(row, 'Received', 'Date', 'Delivery Date') ? parseDate(pick(row, 'Received', 'Date', 'Delivery Date')) : today(),
           pick(row, 'Picked', 'Harvest Date', 'Pick Date') ? parseDate(pick(row, 'Picked', 'Harvest Date', 'Pick Date')) : null,
           Number(String(pick(row, 'Bins', 'Bin Count') || '0').replace(/[^\d]/g, '') || 0),
           Number(String(pick(row, 'Kg', 'Kgs', 'Weight', 'Weight Kg') || '0').replace(/[^\d.]/g, '') || 0),
           diary, statusRaw.includes('grad') || statusRaw.includes('pack') ? 'graded' : 'received',
           pick(row, 'ID', 'Ref', 'Reference', 'Delivery ID') || null],
        );
      }
    }
  }

  const json = { ...counts, dry_run: dryRun, skips };
  let text = `${dryRun ? 'DRY RUN, nothing written. Would import' : 'Imported'}: ` +
    `${counts.growers} new growers (${counts.growers_updated} updated), ${counts.orchards} blocks, ${counts.deliveries} deliveries.`;
  if (counts.diary_missing) text += `\n${counts.diary_missing} imported delivery(ies) carry no spray diary flag: they land blocked from grading, at the top of the attention list. If the diaries exist, record them (diary <ref>); if they do not, that is worth knowing today.`;
  if (counts.gap_expired) text += `\n${counts.gap_expired} imported block(s) have an expired GAP certificate on the export's own numbers.`;
  if (skips.length) text += `\nSkipped ${counts.skipped}:\n` + skips.map((x) => `  - ${x}`).join('\n');
  text += dryRun ? '\nRun again without --dry-run to write it.' : '\nCheck it: stats, attention, compliance.';
  return { json, text };
}

async function cmdExport(db, args, flags) {
  const tables = ['growers', 'orchards', 'deliveries', 'grading_runs', 'pallets', 'consignments', 'coolrooms', 'temp_checks', 'pools', 'sales', 'notes'];
  const out = {};
  for (const t of tables) out[t] = await db.query(`select * from ${t} order by created_at`);
  const counts = Object.fromEntries(tables.map((t) => [t, out[t].length]));
  const file = str(flags.out) || path.join(REPO_ROOT, 'exports', `packhouse-export-${today()}.json`);
  const dir = path.dirname(file);
  const { mkdirSync } = await import('node:fs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(out, null, 2));
  return {
    json: { file, counts },
    text: `Exported the whole database to ${file}.\n  ` + Object.entries(counts).map(([t, n]) => `${t}: ${n}`).join(', ') +
      '\nPlain JSON of plain tables. The traceability record is part of your audit trail; keep the exports.',
  };
}

// ---------------------------------------------------------------------------
// Help and dispatch

const HELP = `
Packhouse for Claude Code: the CLI behind the slash commands.

  node scripts/packhouse.mjs <command> [args] [--flags]     (or: npm run packhouse -- <command>)

The intake pipeline (fruit in, graded, palletised, with the spray gates):
  receive <block> --bins= --kgs= [--picked= --last-spray= --withholding= --diary --maturity=]
  diary <ref> [--last-spray= --withholding=]     the spray diary landed; grading unblocks
  grade <ref> --class1= --class2= --reject-kg= [--room= --trays-per-pallet=]
  release <ref> --note=                          held fruit released, decision on the record

Dispatch (pallets out, with the export gates):
  consign create --buyer= [--destination= --export --carrier=]
  consign add <pallet> --to=<CON-ref>            refuses export fruit from an uncertified block
  assurance <CON-ref> --ref=                     the MPI assurance / phyto reference
  dispatch <CON-ref> [--on=]                     refuses an export consignment with no assurance, no force flag

The money:
  pool add "<name>" --crop= [--variety= --packing-charge= --levy=]
  sale <pool> --trays= --value= [--consignment=]
  pool close <name>                              refuses while dispatched trays have no sale recorded

Reads:
  attention                 everything that wants a decision, worst first
  season | stats            the season and the money on one screen
  deliveries [--grower= --status= --all]         delivery <ref>       the full card
  packouts [--grower=]      grading results, the numbers growers ring about
  pallets [--grower= --room= --all]              trace <pallet>       the one-step-back, one-step-forward card
  consignments [--all]      consignment <ref>  |  coolstore  |  temp <room> --temp=
  pools  |  pool <name>  |  returns [--pool=]    grower returns at today's numbers
  growers [--all]  |  grower <name>  |  orchards (the GAP register)
  compliance [rule]         nine rules from the Act, the schemes and your own standards, sources cited

Housekeeping:
  add grower "<name>" | add orchard "<name>" --grower= --crop= | add room "<name>" --min= --max=
  move <pallet> --room=  |  log <target> "what was said"
  import radfords|freshpack|csv --growers= [--orchards= --deliveries=] [--dry-run]
  export [--out=file.json]

Any command takes --json. Names and refs match case-insensitively ("503" finds DEL-503); an ambiguous
one lists the candidates rather than guessing.
Fruit picked inside its spray withholding period is held, not received. A delivery does not grade
without its spray diary. An export consignment does not dispatch without its assurance reference.
A pool does not close while dispatched trays have no sale proceeds recorded.
Nothing here connects to MPI or an exporter, and nothing sends: statements draft to files, a person sends.
`;

const COMMANDS = {
  growers: cmdGrowers,
  grower: cmdGrower,
  orchards: cmdOrchards,
  deliveries: cmdDeliveries,
  delivery: cmdDelivery,
  receive: cmdReceive,
  diary: cmdDiary,
  grade: cmdGrade,
  release: cmdRelease,
  packouts: cmdPackouts,
  pallets: cmdPallets,
  pallet: cmdTrace,
  trace: cmdTrace,
  move: cmdMove,
  consignments: cmdConsignments,
  consignment: cmdConsignment,
  consign: cmdConsign,
  assurance: cmdAssurance,
  dispatch: cmdDispatch,
  coolstore: cmdCoolstore,
  temp: cmdTemp,
  pools: cmdPools,
  pool: async (db, args, flags) => (['add', 'close'].includes(args[0]) ? cmdPoolWrite(db, args, flags) : cmdPool(db, args, flags)),
  sale: cmdSale,
  returns: cmdReturns,
  season: cmdSeason,
  attention: cmdAttention,
  stats: cmdStats,
  compliance: cmdCompliance,
  log: cmdLog,
  add: cmdAdd,
  import: cmdImport,
  export: cmdExport,
};

async function main() {
  const { args, flags } = parseArgv(process.argv.slice(2));
  const [command, ...rest] = args;
  if (!command || command === 'help' || flags.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const fn = COMMANDS[command];
  if (!fn) {
    process.stderr.write(`Unknown command "${command}".\n\n${HELP}`);
    return 1;
  }
  const db = await getDb();
  try {
    const result = await fn(db, rest, flags);
    if (flags.json) process.stdout.write(JSON.stringify(result.json, null, 2) + '\n');
    else process.stdout.write(result.text.replace(/^\n/, '') + '\n');
    return 0;
  } catch (e) {
    if (e instanceof CliError) {
      process.stderr.write(`${e.message}\n`);
      return e.code;
    }
    if (/relation "?\w+"? does not exist/.test(e.message)) {
      process.stderr.write('The database has no tables yet. Run: npm run migrate\n');
      return 1;
    }
    throw e;
  } finally {
    await db.close();
  }
}

process.exitCode = await main();
