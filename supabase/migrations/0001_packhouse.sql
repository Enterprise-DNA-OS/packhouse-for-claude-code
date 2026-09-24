-- packhouse-for-claude-code: core schema.
-- A New Zealand packhouse's season record: the growers and their orchard
-- blocks (with GAP certification), the fruit coming in (deliveries, with the
-- spray diary and the withholding period), the grading runs and what they
-- packed out, the pallets in the coolstore, the temperature record, the
-- consignments going out (with the export assurance gate), and the pools that
-- turn sale proceeds into grower returns.
--
-- Runs unchanged on PGlite (embedded) and on Postgres / Supabase.
--
-- The sharp edges are deliberate:
--   * fruit picked inside its spray withholding period does not come in as
--     normal stock: the CLI holds it, loudly, with the reason on the record
--   * a delivery cannot be graded until its spray diary is on the record
--   * an export consignment cannot be dispatched without its assurance
--     reference, and there is no force flag
--   * a pool cannot close while dispatched trays have no sale proceeds
--     recorded: growers are paid from the pool, and closing it early
--     short-pays every one of them.

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

-- Growers ------------------------------------------------------------------------
-- The people the packhouse works for. Every kilogram in and every dollar out
-- traces to one of these rows.

create table if not exists growers (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,                      -- short supply code: TEPU, RANG
  name          text not null,
  contact_name  text,
  email         text,
  phone         text,
  gst_number    text,
  status        text not null default 'active',   -- active | former
  note          text,
  external_ref  text unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists growers_name_lower_idx on growers (lower(name));

-- Orchards ---------------------------------------------------------------------------
-- The blocks fruit actually comes from. GAP certification lives here because
-- export programmes buy from certified blocks, not from companies.

create table if not exists orchards (
  id                  uuid primary key default gen_random_uuid(),
  grower_id           uuid not null references growers(id) on delete cascade,
  name                text not null,
  block_code          text unique,                -- KPIN or block reference
  region              text,
  crop                text not null default 'kiwifruit',  -- kiwifruit | avocado | apple | citrus | other
  variety             text,                       -- SunGold, Hayward, Hass ...
  hectares            numeric,
  gap_scheme          text,                       -- NZGAP | GLOBALG.A.P.
  gap_cert_expires_on date,
  status              text not null default 'active',   -- active | inactive
  note                text,
  external_ref        text unique,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists orchards_grower_idx on orchards (grower_id);

-- Deliveries ---------------------------------------------------------------------------
-- Fruit arriving at the door: bins off a truck, from one block, on one day.
-- The spray record rides with it: last spray date plus the label withholding
-- period gives the earliest legal pick date. Fruit picked inside that window
-- is held, not received as normal stock, and the CLI enforces it.

create table if not exists deliveries (
  id                    uuid primary key default gen_random_uuid(),
  ref                   text unique,               -- DEL-501
  orchard_id            uuid not null references orchards(id) on delete cascade,
  received_on           date not null default current_date,
  picked_on             date,
  bins                  int not null default 0,
  kgs                   numeric not null default 0,
  last_spray_on         date,
  withholding_days      int not null default 0,    -- from the agrichemical label
  spray_diary_received  boolean not null default false,
  maturity_ref          text,                      -- maturity clearance reference, where the crop needs one
  status                text not null default 'received',  -- received | held | graded
  hold_reason           text,
  note                  text,
  external_ref          text unique,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists deliveries_orchard_idx on deliveries (orchard_id);
create index if not exists deliveries_status_idx on deliveries (status);

-- Grading runs ---------------------------------------------------------------------------
-- One delivery over the grader: what went in, what came out as class 1 and
-- class 2 trays, what went to reject. The packout percentage growers ring
-- about is computed in the views, never stored.

create table if not exists grading_runs (
  id            uuid primary key default gen_random_uuid(),
  delivery_id   uuid not null references deliveries(id) on delete cascade,
  graded_on     date not null default current_date,
  input_kg      numeric not null,
  class1_trays  int not null default 0,
  class2_trays  int not null default 0,
  reject_kg     numeric not null default 0,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists grading_runs_delivery_idx on grading_runs (delivery_id);

-- Pallets ---------------------------------------------------------------------------
-- The unit the coolstore, the consignment and the trace all speak. A pallet
-- knows its grading run, so it knows its delivery, so it knows its block and
-- its grower: the one-step-back trace is a join, not a paper chase.

create table if not exists pallets (
  id              uuid primary key default gen_random_uuid(),
  pallet_no       text unique,                    -- PLT-4001
  grading_run_id  uuid not null references grading_runs(id) on delete cascade,
  pool_id         uuid,                           -- fk added after pools
  grade           text not null default 'class1', -- class1 | class2
  trays           int not null,
  packed_on       date not null default current_date,
  room            text,
  consignment_id  uuid,                           -- fk added after consignments
  status          text not null default 'in_store',  -- in_store | dispatched
  note            text,
  external_ref    text unique,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists pallets_status_idx on pallets (status);
create index if not exists pallets_run_idx on pallets (grading_run_id);

-- Consignments ---------------------------------------------------------------------------
-- Fruit leaving: pallets to a buyer. An export consignment carries its MPI
-- assurance / phytosanitary reference or it does not leave; the CLI refuses
-- and there is no force flag.

create table if not exists consignments (
  id             uuid primary key default gen_random_uuid(),
  ref            text unique,                     -- CON-301
  buyer          text not null,
  destination    text,
  export         boolean not null default false,
  assurance_ref  text,                            -- MPI official assurance / phyto reference
  carrier        text,
  created_on     date not null default current_date,
  dispatched_on  date,
  status         text not null default 'open',    -- open | dispatched
  note           text,
  external_ref   text unique,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from information_schema.table_constraints where constraint_name = 'pallets_consignment_fk') then
    alter table pallets add constraint pallets_consignment_fk foreign key (consignment_id) references consignments(id) on delete set null;
  end if;
end
$$;

-- The coolstore ---------------------------------------------------------------------------
-- Rooms with target bands, and the temperature record export programmes and
-- customers audit. A room quiet past a day, or a reading outside its band,
-- surfaces on the attention list by itself.

create table if not exists coolrooms (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  target_min_c  numeric not null,
  target_max_c  numeric not null,
  status        text not null default 'active',   -- active | off
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists temp_checks (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references coolrooms(id) on delete cascade,
  checked_at  timestamptz not null default now(),
  temp_c      numeric not null,
  checked_by  text,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists temp_checks_room_idx on temp_checks (room_id);

-- Pools and sales ---------------------------------------------------------------------------
-- The money side. Trays are packed into a pool per crop and variety; sale
-- proceeds land in the pool; growers are paid their pro-rata share of the
-- pool less the packing charge and levies. This is the part the incumbent
-- quotes as a bespoke add-on; here it is two tables and a view.

create table if not exists pools (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null unique,   -- 'SunGold 2026'
  season                  int not null,
  crop                    text not null,
  variety                 text,
  packing_charge_per_tray numeric not null default 0,
  levy_per_tray           numeric not null default 0,
  status                  text not null default 'open',   -- open | closed
  closed_on               date,
  note                    text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from information_schema.table_constraints where constraint_name = 'pallets_pool_fk') then
    alter table pallets add constraint pallets_pool_fk foreign key (pool_id) references pools(id) on delete set null;
  end if;
end
$$;

create table if not exists sales (
  id             uuid primary key default gen_random_uuid(),
  pool_id        uuid not null references pools(id) on delete cascade,
  consignment_id uuid references consignments(id) on delete set null,
  sold_on        date not null default current_date,
  trays          int not null,
  gross_value    numeric not null,
  buyer          text,
  note           text,
  created_at     timestamptz not null default now()
);
create index if not exists sales_pool_idx on sales (pool_id);

-- The log ---------------------------------------------------------------------------------
-- Calls, decisions and facts, against a grower, a delivery, a pallet or a
-- consignment. The season's memory.

create table if not exists notes (
  id              uuid primary key default gen_random_uuid(),
  grower_id       uuid references growers(id) on delete set null,
  delivery_id     uuid references deliveries(id) on delete set null,
  pallet_id       uuid references pallets(id) on delete set null,
  consignment_id  uuid references consignments(id) on delete set null,
  noted_on        date not null default current_date,
  note            text not null,
  created_at      timestamptz not null default now()
);
create index if not exists notes_delivery_idx on notes (delivery_id);
create index if not exists notes_grower_idx on notes (grower_id);

-- updated_at triggers ------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['growers','orchards','deliveries','grading_runs','pallets','consignments','coolrooms','pools']
  loop
    execute format('drop trigger if exists %I on %I', t || '_updated_at', t);
    execute format('create trigger %I before update on %I for each row execute function set_updated_at()', t || '_updated_at', t);
  end loop;
end
$$;

-- =====================================================================================
-- Views: the questions a packhouse manager asks every morning, as SQL anyone can read.
-- =====================================================================================

-- Orchards with the GAP certificate state loud.
create or replace view v_orchards as
select
  o.id as orchard_id,
  o.name as orchard,
  o.block_code,
  g.name as grower,
  g.id as grower_id,
  o.region,
  o.crop,
  o.variety,
  o.hectares,
  o.gap_scheme,
  o.gap_cert_expires_on,
  (o.gap_cert_expires_on - current_date) as days_to_gap_expiry,
  case
    when o.gap_cert_expires_on is null then 'NONE'
    when o.gap_cert_expires_on < current_date then 'EXPIRED'
    when o.gap_cert_expires_on <= current_date + 30 then 'expiring'
    else 'current'
  end as gap,
  o.status
from orchards o
join growers g on g.id = o.grower_id;

-- Deliveries with the spray window computed: the earliest date the block was
-- legal to pick, and whether this delivery beat it.
create or replace view v_deliveries as
select
  d.id as delivery_id,
  d.ref,
  o.name as orchard,
  o.block_code,
  g.name as grower,
  g.id as grower_id,
  o.id as orchard_id,
  o.crop,
  o.variety,
  d.received_on,
  d.picked_on,
  (current_date - d.received_on) as days_since_received,
  d.bins,
  d.kgs,
  d.last_spray_on,
  d.withholding_days,
  case when d.last_spray_on is not null then d.last_spray_on + d.withholding_days end as phi_clear_on,
  (d.last_spray_on is not null and d.picked_on is not null
   and d.picked_on < d.last_spray_on + d.withholding_days) as phi_breach,
  d.spray_diary_received,
  d.maturity_ref,
  d.status,
  d.hold_reason
from deliveries d
join orchards o on o.id = d.orchard_id
join growers g on g.id = o.grower_id;

-- Grading runs with the packout numbers growers ring about. Class 1 trays are
-- export money; the packout percentage is what left the reject belt.
create or replace view v_packouts as
select
  r.id as run_id,
  d.ref as delivery_ref,
  d.delivery_id,
  d.grower,
  d.grower_id,
  d.orchard,
  d.crop,
  d.variety,
  r.graded_on,
  r.input_kg,
  r.class1_trays,
  r.class2_trays,
  (r.class1_trays + r.class2_trays) as total_trays,
  r.reject_kg,
  round(100.0 * (r.input_kg - r.reject_kg) / nullif(r.input_kg, 0), 1) as packout_pct,
  round(100.0 * r.class1_trays / nullif(r.class1_trays + r.class2_trays, 0), 1) as class1_share_pct
from grading_runs r
join v_deliveries d on d.delivery_id = r.delivery_id;

-- Pallets with the whole trace on one line: pallet -> run -> delivery -> block -> grower.
create or replace view v_pallets as
select
  p.id as pallet_id,
  p.pallet_no,
  p.grading_run_id,
  p.grade,
  p.trays,
  p.packed_on,
  (current_date - p.packed_on) as days_in_store,
  p.room,
  pk.delivery_ref,
  pk.grower,
  pk.grower_id,
  pk.orchard,
  pk.crop,
  pk.variety,
  pl.name as pool,
  p.pool_id,
  c.ref as consignment_ref,
  p.consignment_id,
  p.status
from pallets p
join v_packouts pk on pk.run_id = p.grading_run_id
left join pools pl on pl.id = p.pool_id
left join consignments c on c.id = p.consignment_id;

-- Consignments with the assurance state loud for export.
create or replace view v_consignments as
select
  c.id as consignment_id,
  c.ref,
  c.buyer,
  c.destination,
  c.export,
  c.assurance_ref,
  case when c.export and c.assurance_ref is null then 'MISSING' when c.export then 'on record' else '' end as assurance,
  c.carrier,
  c.created_on,
  (current_date - c.created_on) as days_open,
  c.dispatched_on,
  c.status,
  (select count(*) from pallets p where p.consignment_id = c.id) as pallet_count,
  (select coalesce(sum(p.trays), 0) from pallets p where p.consignment_id = c.id) as trays,
  (select count(distinct pk.grower_id) from pallets p join v_pallets pk on pk.pallet_id = p.id where p.consignment_id = c.id) as growers
from consignments c;

-- The coolstore, one line per active room: last check, how long ago, in range or not.
create or replace view v_coolstore as
select
  r.id as room_id,
  r.name as room,
  r.target_min_c,
  r.target_max_c,
  tc.checked_at as last_check_at,
  tc.temp_c as last_temp_c,
  tc.checked_by,
  round((extract(epoch from (now() - tc.checked_at)) / 3600.0)::numeric, 1) as hours_since,
  (tc.temp_c is not null and tc.temp_c >= r.target_min_c and tc.temp_c <= r.target_max_c) as in_range,
  case
    when tc.checked_at is null then 'NEVER CHECKED'
    when tc.temp_c < r.target_min_c or tc.temp_c > r.target_max_c then 'OUT OF RANGE'
    when now() - tc.checked_at > interval '24 hours' then 'QUIET'
    else 'ok'
  end as state,
  (select count(*) from pallets p where p.room = r.name and p.status = 'in_store') as pallets_in_room
from coolrooms r
left join lateral (
  select * from temp_checks t where t.room_id = r.id order by t.checked_at desc limit 1
) tc on true
where r.status = 'active';

-- Pool position: trays packed in, trays dispatched, trays sold, the money.
create or replace view v_pools as
select
  pl.id as pool_id,
  pl.name as pool,
  pl.season,
  pl.crop,
  pl.variety,
  pl.status,
  pl.packing_charge_per_tray,
  pl.levy_per_tray,
  (select coalesce(sum(p.trays), 0) from pallets p where p.pool_id = pl.id) as trays_packed,
  (select coalesce(sum(p.trays), 0) from pallets p where p.pool_id = pl.id and p.status = 'dispatched') as trays_dispatched,
  (select coalesce(sum(s.trays), 0) from sales s where s.pool_id = pl.id) as trays_sold,
  (select coalesce(sum(s.gross_value), 0) from sales s where s.pool_id = pl.id) as gross_sales,
  (select coalesce(sum(p.trays), 0) from pallets p where p.pool_id = pl.id and p.status = 'dispatched')
    - (select coalesce(sum(s.trays), 0) from sales s where s.pool_id = pl.id) as trays_unsold
from pools pl;

-- Grower returns: each grower's pro-rata share of each pool's proceeds, less
-- the packing charge and levies on their trays. The statement growers wait
-- for, as a view anyone can read.
create or replace view v_grower_returns as
select
  pl.pool_id,
  pl.pool,
  pl.status as pool_status,
  gt.grower_id,
  gt.grower,
  gt.trays,
  round(pl.gross_sales * gt.trays / nullif(pl.trays_packed, 0), 2) as gross_share,
  round(gt.trays * pl.packing_charge_per_tray, 2) as packing_charges,
  round(gt.trays * pl.levy_per_tray, 2) as levies,
  round(pl.gross_sales * gt.trays / nullif(pl.trays_packed, 0)
        - gt.trays * pl.packing_charge_per_tray
        - gt.trays * pl.levy_per_tray, 2) as net_return,
  round((pl.gross_sales * gt.trays / nullif(pl.trays_packed, 0)
        - gt.trays * pl.packing_charge_per_tray
        - gt.trays * pl.levy_per_tray) / nullif(gt.trays, 0), 2) as net_per_tray
from v_pools pl
join (
  select p.pool_id, vp.grower_id, vp.grower, sum(p.trays) as trays
  from pallets p
  join v_pallets vp on vp.pallet_id = p.id
  where p.pool_id is not null
  group by p.pool_id, vp.grower_id, vp.grower
) gt on gt.pool_id = pl.pool_id;

-- The season, one line per crop and variety.
create or replace view v_season as
select
  d.crop,
  d.variety,
  count(distinct d.delivery_id) as deliveries,
  coalesce(sum(d.kgs), 0) as kgs_received,
  (select coalesce(sum(r.class1_trays + r.class2_trays), 0)
     from grading_runs r join v_deliveries d2 on d2.delivery_id = r.delivery_id
    where d2.crop = d.crop and coalesce(d2.variety, '') = coalesce(d.variety, '')) as trays_packed,
  (select coalesce(sum(p.trays), 0)
     from v_pallets p where p.crop = d.crop and coalesce(p.variety, '') = coalesce(d.variety, '') and p.status = 'in_store') as trays_in_store,
  (select coalesce(sum(p.trays), 0)
     from v_pallets p where p.crop = d.crop and coalesce(p.variety, '') = coalesce(d.variety, '') and p.status = 'dispatched') as trays_dispatched
from v_deliveries d
group by d.crop, d.variety;

-- Everything that wants a decision, one union, worst first. Fruit held on a
-- spray breach outranks everything: it is a legal and market-access problem
-- sitting on the floor losing condition.
create or replace view v_attention as
-- Fruit held: picked inside the spray withholding period.
select 'phi_hold' as reason, d.ref as label, d.grower, d.orchard as place,
       (current_date - d.received_on) as days,
       'HELD: picked ' || to_char(d.picked_on, 'YYYY-MM-DD') || ', spray window clear from ' ||
       to_char(d.phi_clear_on, 'YYYY-MM-DD') || '. ' || coalesce(d.hold_reason, '') as detail
from v_deliveries d
where d.status = 'held'
union all
-- A delivery that cannot be graded: no spray diary on record.
select 'spray_diary_missing', d.ref, d.grower, d.orchard,
       (current_date - d.received_on),
       d.bins || ' bins of ' || d.crop || ' received ' || to_char(d.received_on, 'YYYY-MM-DD') ||
       ' with no spray diary: grading is blocked until it is on record'
from v_deliveries d
where d.status = 'received' and not d.spray_diary_received
union all
-- Fruit sitting ungraded past three days.
select 'delivery_ungraded', d.ref, d.grower, d.orchard,
       d.days_since_received,
       d.bins || ' bins (' || d.kgs || ' kg) received ' || to_char(d.received_on, 'YYYY-MM-DD') ||
       ' and still not graded: condition is money here'
from v_deliveries d
where d.status = 'received' and d.spray_diary_received and d.days_since_received > 3
union all
-- An export consignment loaded but missing its assurance reference.
select 'assurance_missing', c.ref, c.buyer, coalesce(c.destination, ''),
       c.days_open,
       'export consignment with ' || c.pallet_count || ' pallet(s) loaded and no assurance reference: it cannot dispatch until one is recorded'
from v_consignments c
where c.status = 'open' and c.export and c.assurance_ref is null and c.pallet_count > 0
union all
-- A GAP certificate expired or expiring on an active block.
select 'gap_' || lower(o.gap), o.block_code, o.grower, o.orchard,
       case when o.gap = 'EXPIRED' then abs(o.days_to_gap_expiry) else o.days_to_gap_expiry end,
       case when o.gap = 'EXPIRED'
            then o.gap_scheme || ' certificate expired ' || to_char(o.gap_cert_expires_on, 'YYYY-MM-DD') || ': fruit from this block cannot join an export consignment'
            else o.gap_scheme || ' certificate expires ' || to_char(o.gap_cert_expires_on, 'YYYY-MM-DD') || ': book the audit now' end
from v_orchards o
where o.status = 'active' and o.gap in ('EXPIRED', 'expiring')
union all
-- A coolroom out of range or quiet.
select 'coolstore_' || case when cs.state = 'OUT OF RANGE' then 'out_of_range' else 'quiet' end,
       cs.room, '', cs.room,
       case when cs.state = 'QUIET' then round(cs.hours_since)::int end,
       case when cs.state = 'OUT OF RANGE'
            then 'last reading ' || cs.last_temp_c || ' C against a ' || cs.target_min_c || ' to ' || cs.target_max_c || ' C band, with ' || cs.pallets_in_room || ' pallet(s) in the room'
            else 'no temperature check for ' || round(cs.hours_since) || ' hours (' || cs.pallets_in_room || ' pallet(s) in the room)' end
from v_coolstore cs
where cs.state in ('OUT OF RANGE', 'QUIET', 'NEVER CHECKED')
union all
-- A pallet aged in store past six weeks.
select 'pallet_aged', p.pallet_no, p.grower, coalesce(p.room, ''),
       p.days_in_store,
       p.trays || ' trays of ' || coalesce(p.variety, p.crop) || ' ' || p.grade || ' packed ' ||
       to_char(p.packed_on, 'YYYY-MM-DD') || ': ' || p.days_in_store || ' days in store'
from v_pallets p
where p.status = 'in_store' and p.days_in_store > 42
union all
-- An open consignment going stale.
select 'consignment_stale', c.ref, c.buyer, coalesce(c.destination, ''),
       c.days_open,
       'open ' || c.days_open || ' days with ' || c.trays || ' tray(s) allocated: dispatch it or free the fruit'
from v_consignments c
where c.status = 'open' and c.days_open > 7
union all
-- A pool with dispatched trays and no matching sale proceeds.
select 'pool_unsold', pl.pool, '', pl.crop,
       null,
       pl.trays_unsold || ' dispatched tray(s) with no sale recorded: proceeds are missing and the pool cannot close'
from v_pools pl
where pl.status = 'open' and pl.trays_unsold > 0;
