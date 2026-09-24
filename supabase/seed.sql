-- Demo data for packhouse-for-claude-code.
-- Maketu Coolpack Ltd, a fictional Bay of Plenty packhouse: six growers, seven
-- orchard blocks (SunGold and Hayward kiwifruit, Hass avocados), a season in
-- full swing with deliveries in every state, five grading runs, a coolstore
-- with three rooms, four consignments and three grower pools.
--
-- Deliberately messy, so the attention list has something to say:
--   a delivery held because the fruit was picked six days inside its spray withholding period
--   a delivery that cannot be graded because the spray diary never arrived
--   twelve bins of SunGold sitting ungraded four days after they came in
--   an export consignment loaded for nine days with no assurance reference
--   one block's GAP certificate expired 20 days ago, another expiring in 18 days
--   a coolroom with no temperature check for 30 hours, another reading 8.4 C against a 4 to 7 C band
--   a class 2 pallet 49 days in store
--   300 dispatched Hayward trays with no sale proceeds recorded, so the pool cannot close
--
-- Dates are relative to current_date. Ids are derived from names with
-- seed_uuid, and every insert is ON CONFLICT DO NOTHING, so running it twice
-- changes nothing.
--
-- Growers, blocks, buyers and events are DEMO VALUES for a fictional business.
-- No real person, company, orchard or consignment is depicted.

create or replace function seed_uuid(seed text) returns uuid language sql immutable as $$
  select (substr(m, 1, 8) || '-' || substr(m, 9, 4) || '-4' || substr(m, 13, 3)
          || '-8' || substr(m, 16, 3) || '-' || substr(m, 19, 12))::uuid
  from (select md5(seed) as m) s
$$;

-- Growers ------------------------------------------------------------------------

insert into growers (id, code, name, contact_name, email, phone, gst_number, status) values
  (seed_uuid('grower:tepu'), 'TEPU', 'Te Puna Orchards Ltd',    'Angela Rope',    'angela@tepunaorchards.example.nz', '027 555 0201', '99-111-111', 'active'),
  (seed_uuid('grower:rang'), 'RANG', 'Rangiuru Fruit Co',       'Mike Stanaway',  'mike@rangiurufruit.example.nz',    '027 555 0202', '99-222-222', 'active'),
  (seed_uuid('grower:bled'), 'BLED', 'Bledisloe Avocados',      'Priya Nathan',   'priya@bledisloeavo.example.nz',    '021 555 0203', '99-333-333', 'active'),
  (seed_uuid('grower:kaur'), 'KAUR', 'Kauri Point Growers',     'Tom Hewitt',     'tom@kauripoint.example.nz',        '021 555 0204', '99-444-444', 'active'),
  (seed_uuid('grower:pong'), 'PONG', 'Pongakawa Family Trust',  'Hana Ngatai',    'hana@pongakawatrust.example.nz',   '027 555 0205', '99-555-555', 'active'),
  (seed_uuid('grower:otan'), 'OTAN', 'Otanewainuku Hort',       'Dave Silich',    'dave@otanhort.example.nz',         '021 555 0206', '99-666-666', 'active')
on conflict do nothing;

-- Orchards ---------------------------------------------------------------------------
-- GAP certification lives on the block. Kauri Point's expired 20 days ago;
-- Pongakawa's expires in 18. Both surface by themselves.

insert into orchards (id, grower_id, name, block_code, region, crop, variety, hectares, gap_scheme, gap_cert_expires_on, status) values
  (seed_uuid('orch:tepu-home'),  seed_uuid('grower:tepu'), 'Te Puna Home Block',    'KPIN-10231', 'Te Puna',     'kiwifruit', 'SunGold', 6.2, 'NZGAP',        current_date + 200, 'active'),
  (seed_uuid('orch:tepu-creek'), seed_uuid('grower:tepu'), 'Te Puna Creek Block',   'KPIN-10232', 'Te Puna',     'kiwifruit', 'Hayward', 4.8, 'NZGAP',        current_date + 200, 'active'),
  (seed_uuid('orch:rang-a'),     seed_uuid('grower:rang'), 'Rangiuru Block A',      'KPIN-10310', 'Rangiuru',    'kiwifruit', 'Hayward', 8.5, 'NZGAP',        current_date + 320, 'active'),
  (seed_uuid('orch:bled-grove'), seed_uuid('grower:bled'), 'Bledisloe Grove',       'AV-2041',    'Katikati',    'avocado',   'Hass',    5.1, 'GLOBALG.A.P.', current_date + 150, 'active'),
  (seed_uuid('orch:kaur-2'),     seed_uuid('grower:kaur'), 'Kauri Point Block 2',   'KPIN-10455', 'Kauri Point', 'kiwifruit', 'SunGold', 3.9, 'NZGAP',        current_date - 20,  'active'),
  (seed_uuid('orch:pong-road'),  seed_uuid('grower:pong'), 'Pongakawa Road Block',  'KPIN-10502', 'Pongakawa',   'kiwifruit', 'Hayward', 7.4, 'NZGAP',        current_date + 18,  'active'),
  (seed_uuid('orch:otan-east'),  seed_uuid('grower:otan'), 'Otanewainuku East',     'AV-2087',    'Oropi',       'avocado',   'Hass',    4.4, 'GLOBALG.A.P.', current_date + 250, 'active')
on conflict do nothing;

-- Deliveries ---------------------------------------------------------------------------
-- THE LOUD ONES: DEL-505 is held (picked six days inside the copper spray
-- withholding period), DEL-504 has no spray diary so grading is blocked, and
-- DEL-503 has sat ungraded four days.

insert into deliveries (id, ref, orchard_id, received_on, picked_on, bins, kgs, last_spray_on, withholding_days, spray_diary_received, maturity_ref, status, hold_reason) values
  (seed_uuid('del:501'), 'DEL-501', seed_uuid('orch:tepu-home'),  current_date - 12, current_date - 12, 18, 5200, current_date - 52, 14, true,  'MAT-26-118', 'graded',   null),
  (seed_uuid('del:502'), 'DEL-502', seed_uuid('orch:rang-a'),     current_date - 9,  current_date - 9,  24, 6900, current_date - 60, 14, true,  'MAT-26-124', 'graded',   null),
  (seed_uuid('del:503'), 'DEL-503', seed_uuid('orch:kaur-2'),     current_date - 4,  current_date - 4,  12, 3400, current_date - 44, 14, true,  'MAT-26-131', 'received', null),
  (seed_uuid('del:504'), 'DEL-504', seed_uuid('orch:pong-road'),  current_date - 1,  current_date - 1,  20, 5800, null,              0,  false, 'MAT-26-140', 'received', null),
  (seed_uuid('del:505'), 'DEL-505', seed_uuid('orch:bled-grove'), current_date - 2,  current_date - 2,  10, 2600, current_date - 10, 14, true,  null,         'held',
   'Picked six days inside the copper spray withholding period. Grower notified; awaiting residue test before any grading decision.'),
  (seed_uuid('del:506'), 'DEL-506', seed_uuid('orch:otan-east'),  current_date - 15, current_date - 15, 14, 3800, current_date - 40, 14, true,  null,         'graded',   null),
  (seed_uuid('del:507'), 'DEL-507', seed_uuid('orch:tepu-creek'), current_date - 50, current_date - 50, 16, 4600, current_date - 90, 14, true,  'MAT-26-092', 'graded',   null),
  (seed_uuid('del:508'), 'DEL-508', seed_uuid('orch:kaur-2'),     current_date - 6,  current_date - 6,  15, 4300, current_date - 46, 14, true,  'MAT-26-136', 'graded',   null),
  (seed_uuid('del:509'), 'DEL-509', seed_uuid('orch:rang-a'),     current_date,      current_date - 1,  22, 6300, current_date - 55, 14, true,  'MAT-26-144', 'received', null)
on conflict do nothing;

-- Grading runs ---------------------------------------------------------------------------
-- Kiwifruit trays run about 3.6 kg, Hass about 5.5 kg; input roughly equals
-- trays out plus reject.

insert into grading_runs (id, delivery_id, graded_on, input_kg, class1_trays, class2_trays, reject_kg, note) values
  (seed_uuid('run:501'), seed_uuid('del:501'), current_date - 11, 5200, 1090, 180, 630,  null),
  (seed_uuid('run:502'), seed_uuid('del:502'), current_date - 8,  6900, 1380, 260, 1000, 'Wet weather fruit, more side rot than usual on the belt.'),
  (seed_uuid('run:506'), seed_uuid('del:506'), current_date - 14, 3800, 520,  90,  450,  null),
  (seed_uuid('run:507'), seed_uuid('del:507'), current_date - 49, 4600, 900,  220, 570,  null),
  (seed_uuid('run:508'), seed_uuid('del:508'), current_date - 5,  4300, 920,  130, 520,  null)
on conflict do nothing;

-- Pools ---------------------------------------------------------------------------
-- Growers are paid from these. Charges per tray are this packhouse's own.

insert into pools (id, name, season, crop, variety, packing_charge_per_tray, levy_per_tray, status) values
  (seed_uuid('pool:sungold'), 'SunGold 2026', 2026, 'kiwifruit', 'SunGold', 3.10, 0.45, 'open'),
  (seed_uuid('pool:hayward'), 'Hayward 2026', 2026, 'kiwifruit', 'Hayward', 2.90, 0.40, 'open'),
  (seed_uuid('pool:hass'),    'Hass 2026',    2026, 'avocado',   'Hass',    2.60, 0.35, 'open')
on conflict do nothing;

-- Consignments ---------------------------------------------------------------------------
-- CON-302 is the loud one: an export consignment loaded nine days ago,
-- still open, and no assurance reference on record. It cannot dispatch.

insert into consignments (id, ref, buyer, destination, export, assurance_ref, carrier, created_on, dispatched_on, status) values
  (seed_uuid('con:300'), 'CON-300', 'Pacific Crown Exporters', 'Tauranga port, Japan programme',  true,  'OAP-2026-0941', 'Priority Logistics', current_date - 42, current_date - 40, 'dispatched'),
  (seed_uuid('con:301'), 'CON-301', 'Zeal Fresh Trading',      'Tauranga port, EU programme',     true,  'OAP-2026-1188', 'Priority Logistics', current_date - 5,  current_date - 3,  'dispatched'),
  (seed_uuid('con:302'), 'CON-302', 'Golden Coast Produce',    'Singapore',                       true,  null,            null,                 current_date - 9,  null,              'open'),
  (seed_uuid('con:303'), 'CON-303', 'Mount Maunganui Wholesale', 'Local market',                  false, null,            null,                 current_date - 2,  null,              'open')
on conflict do nothing;

-- Pallets ---------------------------------------------------------------------------
-- PLT-4024 has sat in Room 1 for 49 days. PLT-4010 and PLT-4011 are loaded on
-- the assurance-less CON-302 and still physically in store.

insert into pallets (id, pallet_no, grading_run_id, pool_id, grade, trays, packed_on, room, consignment_id, status) values
  -- DEL-501 SunGold: four pallets out the door on CON-301, one and the class 2 still here.
  (seed_uuid('plt:4001'), 'PLT-4001', seed_uuid('run:501'), seed_uuid('pool:sungold'), 'class1', 240, current_date - 11, null,     seed_uuid('con:301'), 'dispatched'),
  (seed_uuid('plt:4002'), 'PLT-4002', seed_uuid('run:501'), seed_uuid('pool:sungold'), 'class1', 240, current_date - 11, null,     seed_uuid('con:301'), 'dispatched'),
  (seed_uuid('plt:4003'), 'PLT-4003', seed_uuid('run:501'), seed_uuid('pool:sungold'), 'class1', 240, current_date - 11, null,     seed_uuid('con:301'), 'dispatched'),
  (seed_uuid('plt:4004'), 'PLT-4004', seed_uuid('run:501'), seed_uuid('pool:sungold'), 'class1', 240, current_date - 11, null,     seed_uuid('con:301'), 'dispatched'),
  (seed_uuid('plt:4005'), 'PLT-4005', seed_uuid('run:501'), seed_uuid('pool:sungold'), 'class1', 130, current_date - 11, 'Room 1', null,                 'in_store'),
  (seed_uuid('plt:4006'), 'PLT-4006', seed_uuid('run:501'), seed_uuid('pool:sungold'), 'class2', 180, current_date - 11, 'Room 1', seed_uuid('con:303'), 'in_store'),
  -- DEL-502 Hayward: still in Room 2; two pallets allocated to CON-302.
  (seed_uuid('plt:4007'), 'PLT-4007', seed_uuid('run:502'), seed_uuid('pool:hayward'), 'class1', 240, current_date - 8, 'Room 2', null,                 'in_store'),
  (seed_uuid('plt:4008'), 'PLT-4008', seed_uuid('run:502'), seed_uuid('pool:hayward'), 'class1', 240, current_date - 8, 'Room 2', null,                 'in_store'),
  (seed_uuid('plt:4009'), 'PLT-4009', seed_uuid('run:502'), seed_uuid('pool:hayward'), 'class1', 240, current_date - 8, 'Room 2', null,                 'in_store'),
  (seed_uuid('plt:4010'), 'PLT-4010', seed_uuid('run:502'), seed_uuid('pool:hayward'), 'class1', 240, current_date - 8, 'Room 2', seed_uuid('con:302'), 'in_store'),
  (seed_uuid('plt:4011'), 'PLT-4011', seed_uuid('run:502'), seed_uuid('pool:hayward'), 'class1', 240, current_date - 8, 'Room 2', seed_uuid('con:302'), 'in_store'),
  (seed_uuid('plt:4012'), 'PLT-4012', seed_uuid('run:502'), seed_uuid('pool:hayward'), 'class1', 180, current_date - 8, 'Room 2', null,                 'in_store'),
  (seed_uuid('plt:4013'), 'PLT-4013', seed_uuid('run:502'), seed_uuid('pool:hayward'), 'class2', 260, current_date - 8, 'Room 2', null,                 'in_store'),
  -- DEL-506 Hass: in Room 3.
  (seed_uuid('plt:4014'), 'PLT-4014', seed_uuid('run:506'), seed_uuid('pool:hass'),    'class1', 260, current_date - 14, 'Room 3', null,                'in_store'),
  (seed_uuid('plt:4015'), 'PLT-4015', seed_uuid('run:506'), seed_uuid('pool:hass'),    'class1', 260, current_date - 14, 'Room 3', null,                'in_store'),
  (seed_uuid('plt:4016'), 'PLT-4016', seed_uuid('run:506'), seed_uuid('pool:hass'),    'class2', 90,  current_date - 14, 'Room 3', null,                'in_store'),
  -- DEL-507 Hayward: class 1 went to Japan on CON-300; the class 2 pallet is still here, 49 days on.
  (seed_uuid('plt:4020'), 'PLT-4020', seed_uuid('run:507'), seed_uuid('pool:hayward'), 'class1', 240, current_date - 49, null,     seed_uuid('con:300'), 'dispatched'),
  (seed_uuid('plt:4021'), 'PLT-4021', seed_uuid('run:507'), seed_uuid('pool:hayward'), 'class1', 240, current_date - 49, null,     seed_uuid('con:300'), 'dispatched'),
  (seed_uuid('plt:4022'), 'PLT-4022', seed_uuid('run:507'), seed_uuid('pool:hayward'), 'class1', 240, current_date - 49, null,     seed_uuid('con:300'), 'dispatched'),
  (seed_uuid('plt:4023'), 'PLT-4023', seed_uuid('run:507'), seed_uuid('pool:hayward'), 'class1', 180, current_date - 49, null,     seed_uuid('con:300'), 'dispatched'),
  (seed_uuid('plt:4024'), 'PLT-4024', seed_uuid('run:507'), seed_uuid('pool:hayward'), 'class2', 220, current_date - 49, 'Room 1', null,                 'in_store'),
  -- DEL-508 SunGold: fresh stock in Room 1.
  (seed_uuid('plt:4017'), 'PLT-4017', seed_uuid('run:508'), seed_uuid('pool:sungold'), 'class1', 240, current_date - 5, 'Room 1', null,                 'in_store'),
  (seed_uuid('plt:4018'), 'PLT-4018', seed_uuid('run:508'), seed_uuid('pool:sungold'), 'class1', 240, current_date - 5, 'Room 1', null,                 'in_store'),
  (seed_uuid('plt:4019'), 'PLT-4019', seed_uuid('run:508'), seed_uuid('pool:sungold'), 'class1', 240, current_date - 5, 'Room 1', null,                 'in_store'),
  (seed_uuid('plt:4025'), 'PLT-4025', seed_uuid('run:508'), seed_uuid('pool:sungold'), 'class1', 200, current_date - 5, 'Room 1', null,                 'in_store'),
  (seed_uuid('plt:4026'), 'PLT-4026', seed_uuid('run:508'), seed_uuid('pool:sungold'), 'class2', 130, current_date - 5, 'Room 1', null,                 'in_store')
on conflict do nothing;

-- Sales ---------------------------------------------------------------------------
-- The SunGold consignment is fully sold. CON-300 dispatched 900 Hayward trays
-- but only 600 have proceeds recorded: the pool cannot close until the last
-- 300 do.

insert into sales (id, pool_id, consignment_id, sold_on, trays, gross_value, buyer) values
  (seed_uuid('sale:sungold-1'), seed_uuid('pool:sungold'), seed_uuid('con:301'), current_date - 2,  960, 84480, 'Zeal Fresh Trading'),
  (seed_uuid('sale:hayward-1'), seed_uuid('pool:hayward'), seed_uuid('con:300'), current_date - 35, 600, 48000, 'Pacific Crown Exporters')
on conflict do nothing;

-- The coolstore ---------------------------------------------------------------------------
-- Room 2 has been quiet 30 hours. Room 3's last reading is 8.4 C against a
-- 4 to 7 C avocado band.

insert into coolrooms (id, name, target_min_c, target_max_c, status) values
  (seed_uuid('room:1'), 'Room 1', 0, 2, 'active'),
  (seed_uuid('room:2'), 'Room 2', 0, 2, 'active'),
  (seed_uuid('room:3'), 'Room 3', 4, 7, 'active')
on conflict do nothing;

insert into temp_checks (id, room_id, checked_at, temp_c, checked_by) values
  (seed_uuid('temp:r1-now'),  seed_uuid('room:1'), now() - interval '3 hours',  1.2, 'Josh'),
  (seed_uuid('temp:r1-y1'),   seed_uuid('room:1'), now() - interval '15 hours', 1.4, 'Josh'),
  (seed_uuid('temp:r1-y2'),   seed_uuid('room:1'), now() - interval '27 hours', 1.1, 'Mel'),
  (seed_uuid('temp:r2-old'),  seed_uuid('room:2'), now() - interval '30 hours', 1.0, 'Mel'),
  (seed_uuid('temp:r2-old2'), seed_uuid('room:2'), now() - interval '42 hours', 0.8, 'Mel'),
  (seed_uuid('temp:r3-now'),  seed_uuid('room:3'), now() - interval '5 hours',  8.4, 'Josh'),
  (seed_uuid('temp:r3-y1'),   seed_uuid('room:3'), now() - interval '17 hours', 6.9, 'Mel'),
  (seed_uuid('temp:r3-y2'),   seed_uuid('room:3'), now() - interval '29 hours', 6.2, 'Josh')
on conflict do nothing;

-- The log ---------------------------------------------------------------------------------------

insert into notes (id, delivery_id, noted_on, note) values
  (seed_uuid('note:505-1'), seed_uuid('del:505'), current_date - 2, 'Priya called: sprayer contractor used copper a week later than the diary showed. Residue sample couriered to the lab, results due in three days. Fruit stays in the bin on the intake pad.'),
  (seed_uuid('note:504-1'), seed_uuid('del:504'), current_date - 1, 'Hana emailing the spray diary tonight. Bins are in the ambient shed, not the coolstore, until it lands.')
on conflict do nothing;

insert into notes (id, consignment_id, noted_on, note) values
  (seed_uuid('note:302-1'), seed_uuid('con:302'), current_date - 3, 'Assurance application lodged. Golden Coast asking for a load-out date; nothing moves until the reference is on record.')
on conflict do nothing;

insert into notes (id, grower_id, noted_on, note) values
  (seed_uuid('note:kaur-1'), seed_uuid('grower:kaur'), current_date - 6, 'Tom knows the NZGAP cert has lapsed. Audit booked for next month; his SunGold stays out of export consignments until it passes.')
on conflict do nothing;
