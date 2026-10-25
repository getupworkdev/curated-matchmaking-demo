-- Fictional seed data for the demo. No real people.
insert into products (id, kind, coins, price_usd, label) values
  ('coins_3', 'consumable', 3, 120.00, '3 introduction coins'),
  ('coins_6', 'consumable', 6, 220.00, '6 introduction coins'),
  ('coins_9', 'consumable', 9, 300.00, '9 introduction coins'),
  ('advanced_filters', 'non_consumable', 0, 180.00, 'Advanced filters');

-- id pattern: 00000000-0000-4000-8000-0000000000NN
insert into members (id, display_name, initials, age, city, gender, seeking, age_min, age_max, status, is_admin, onboarded,
                     strategy, pace, uncertainty, values, lifestyle, intent) values
  ('00000000-0000-4000-8000-000000000001','Concierge (Rhea)','RC',34,'New York','woman','{}',18,99,'approved',true,true,
     null,null,null,'{}','{}',null),
  ('00000000-0000-4000-8000-000000000010','Alex M.','AM',34,'New York','man','{woman}',28,38,'approved',false,true,
     'balanced','steady','medium','{family,growth,honesty,ambition}','{early_riser,fitness,travel}','long_term'),
  ('00000000-0000-4000-8000-000000000011','Priya K.','PK',31,'New York','woman','{man}',30,40,'approved',false,true,
     'balanced','steady','low','{family,honesty,ambition,kindness}','{early_riser,cooking,travel}','long_term'),
  ('00000000-0000-4000-8000-000000000012','Dana W.','DW',29,'Brooklyn','woman','{man}',30,38,'approved',false,true,
     'growth','fast','high','{ambition,adventure,curiosity}','{night_owl,travel,nightlife}','open'),
  ('00000000-0000-4000-8000-000000000013','Sofia L.','SL',36,'New York','woman','{man}',33,42,'approved',false,true,
     'comfort','slow','low','{family,faith,kindness,honesty}','{homebody,cooking,early_riser}','marriage'),
  ('00000000-0000-4000-8000-000000000014','Mei T.','MT',33,'Jersey City','woman','{man}',32,39,'approved',false,true,
     'balanced','steady','medium','{growth,honesty,curiosity,ambition}','{fitness,early_riser,reading}','long_term'),
  ('00000000-0000-4000-8000-000000000015','Hannah B.','HB',27,'New York','woman','{man}',25,32,'approved',false,true,
     'growth','fast','high','{adventure,ambition}','{nightlife,travel}','open'),
  ('00000000-0000-4000-8000-000000000016','Lena R.','LR',35,'Hoboken','woman','{man}',33,40,'approved',false,true,
     'balanced','steady','medium','{family,honesty,ambition}','{travel,fitness,cooking}','long_term'),
  ('00000000-0000-4000-8000-000000000017','Omar F.','OF',37,'New York','man','{woman}',29,36,'approved',false,true,
     'comfort','steady','low','{family,faith,honesty}','{early_riser,cooking}','marriage'),
  ('00000000-0000-4000-8000-000000000018','Jules P.','JP',32,'Brooklyn','nonbinary','{woman,nonbinary}',27,36,'approved',false,true,
     'growth','steady','medium','{curiosity,creativity,kindness}','{night_owl,reading,travel}','long_term'),
  ('00000000-0000-4000-8000-000000000020','Nadia S.','NS',30,'New York','woman','{man}',29,37,'waitlist',false,false,
     null,null,null,'{}','{}',null),
  ('00000000-0000-4000-8000-000000000021','Ben C.','BC',38,'Queens','man','{woman}',30,38,'waitlist',false,false,
     null,null,null,'{}','{}',null);

-- Alex blocked Hannah (she must never be suggested to him, or him to her).
insert into blocks (blocker, blocked) values
  ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000015');

-- Alex <-> Priya: released, with a short conversation.
insert into matches (id, member_a, member_b, status, score, released_at) values
  ('00000000-0000-4000-9000-000000000001','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000011','released',72, now() - interval '2 days'),
-- Alex <-> Mei: proposed by the concierge, waiting for review (invisible to both members).
  ('00000000-0000-4000-9000-000000000002','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000014','pending_review',76, null);

insert into messages (match_id, sender, body, created_at) values
  ('00000000-0000-4000-9000-000000000001','00000000-0000-4000-8000-000000000011','Hi Alex, the concierge said we both get up before 6. Coffee somewhere quiet this weekend?', now() - interval '1 day 3 hours'),
  ('00000000-0000-4000-9000-000000000001','00000000-0000-4000-8000-000000000010','Hi Priya! Yes, I''d like that. Saturday 9am works for me.', now() - interval '1 day 2 hours');

-- Priya bought a 3-coin pack last week.
insert into coin_ledger (member_id, kind, amount, product_id, store_txn_id, note, created_at) values
  ('00000000-0000-4000-8000-000000000011','purchase',3,'coins_3','2000000812345601','3 introduction coins', now() - interval '6 days');

insert into audit_log (actor, action, target, detail, at) values
  ('00000000-0000-4000-8000-000000000001','propose_match','00000000-0000-4000-9000-000000000001','{"score":72}', now() - interval '3 days'),
  ('00000000-0000-4000-8000-000000000001','release_match','00000000-0000-4000-9000-000000000001','{}', now() - interval '2 days'),
  ('00000000-0000-4000-8000-000000000001','propose_match','00000000-0000-4000-9000-000000000002','{"score":76}', now() - interval '3 hours');
