#!/usr/bin/env node
// Loads supabase/seed.sql: Maketu Coolpack Ltd, a fictional Bay of Plenty
// packhouse with six growers, seven orchard blocks, a season of deliveries in
// every state, five grading runs, a three-room coolstore, four consignments
// and three grower pools. Every row has a derived id and inserts with
// ON CONFLICT DO NOTHING, so re-running it is harmless.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDb, REPO_ROOT } from './lib/db.mjs';

export async function seed(db) {
  const sql = readFileSync(path.join(REPO_ROOT, 'supabase', 'seed.sql'), 'utf8');
  await db.exec(sql);
  const [c] = await db.query(`
    select (select count(*) from growers)       as growers,
           (select count(*) from orchards)      as orchards,
           (select count(*) from deliveries)    as deliveries,
           (select count(*) from grading_runs)  as grading_runs,
           (select count(*) from pallets)       as pallets,
           (select count(*) from consignments)  as consignments,
           (select count(*) from coolrooms)     as coolrooms,
           (select count(*) from temp_checks)   as temp_checks,
           (select count(*) from pools)         as pools,
           (select count(*) from sales)         as sales
  `);
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Number(v)]));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const db = await getDb();
  try {
    const counts = await seed(db);
    console.log('seeded:', Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' '));
  } finally {
    await db.close();
  }
}
