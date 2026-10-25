-- Kindred Circle (fictional) — curated matchmaking demo schema.
-- Runs on Supabase Postgres. The demo and the tests run the same file on PGlite (Postgres in WASM).

-- ---------------------------------------------------------------------------
-- Auth shim: on Supabase, the role `authenticated` and auth.uid() already exist.
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to authenticated;

-- ---------------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------------
create table members (
  id            uuid primary key,
  display_name  text not null,
  initials      text not null,
  age           int  not null check (age between 18 and 99),
  city          text not null,
  gender        text not null check (gender in ('woman','man','nonbinary')),
  seeking       text[] not null default '{}',
  age_min       int  not null default 18,
  age_max       int  not null default 99,
  status        text not null default 'waitlist' check (status in ('waitlist','approved','declined')),
  is_admin      boolean not null default false,
  onboarded     boolean not null default false,
  strategy      text check (strategy in ('comfort','balanced','growth')),
  pace          text check (pace in ('slow','steady','fast')),
  uncertainty   text check (uncertainty in ('low','medium','high')),
  values        text[] not null default '{}',
  lifestyle     text[] not null default '{}',
  intent        text check (intent in ('long_term','marriage','open')),
  created_at    timestamptz not null default now(),
  check (age_min <= age_max)
);

create table blocks (
  blocker uuid not null references members(id),
  blocked uuid not null references members(id),
  primary key (blocker, blocked)
);

-- ---------------------------------------------------------------------------
-- Matches: created by the concierge as pending_review, released into portfolios.
-- One row per unordered pair (member_a < member_b).
-- ---------------------------------------------------------------------------
create table matches (
  id           uuid primary key default gen_random_uuid(),
  member_a     uuid not null references members(id),
  member_b     uuid not null references members(id),
  status       text not null default 'pending_review'
               check (status in ('pending_review','released','declined')),
  score        int  not null,
  created_at   timestamptz not null default now(),
  released_at  timestamptz,
  check (member_a < member_b),
  unique (member_a, member_b)
);

create table messages (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null references matches(id),
  sender     uuid not null references members(id),
  body       text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default clock_timestamp()
);

-- ---------------------------------------------------------------------------
-- Coins: an append-only ledger, never a mutable balance column.
-- ---------------------------------------------------------------------------
create table products (
  id        text primary key,
  kind      text not null check (kind in ('consumable','non_consumable')),
  coins     int  not null default 0,
  price_usd numeric(8,2) not null,
  label     text not null
);

create table coin_ledger (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references members(id),
  kind          text not null check (kind in ('purchase','spend','refund','admin_grant')),
  amount        int  not null check (amount <> 0),
  product_id    text references products(id),
  store_txn_id  text,                       -- App Store transaction id (purchases)
  refunds       uuid references coin_ledger(id), -- for refunds: the purchase row reversed
  note          text,
  created_at    timestamptz not null default clock_timestamp(),
  check ((kind in ('purchase','admin_grant','refund') and amount <> 0) or (kind = 'spend' and amount < 0))
);
-- A store transaction can be credited exactly once, however many times the receipt is posted.
create unique index coin_ledger_one_credit_per_txn on coin_ledger (store_txn_id) where kind = 'purchase';
-- A purchase can be refunded exactly once.
create unique index coin_ledger_one_refund_per_purchase on coin_ledger (refunds) where kind = 'refund';

create table entitlements (
  member_id         uuid not null references members(id),
  product_id        text not null references products(id),
  original_txn_id   text not null,
  granted_at        timestamptz not null default now(),
  primary key (member_id, product_id)
);

create table intro_requests (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references members(id),
  ledger_id  uuid not null references coin_ledger(id),
  note       text,
  created_at timestamptz not null default now()
);

create table audit_log (
  id      bigserial primary key,
  actor   uuid references members(id),
  action  text not null,
  target  uuid,
  detail  jsonb not null default '{}',
  at      timestamptz not null default clock_timestamp()
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from members where id = auth.uid()), false)
$$;

-- Internal balance (no permission check). Only callable by other security-definer functions.
create or replace function ledger_balance(p_member uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0)::int from coin_ledger where member_id = p_member
$$;
revoke execute on function ledger_balance(uuid) from public;

-- Public balance: your own, or anyone's if concierge.
create or replace function coin_balance(p_member uuid) returns int
language plpgsql stable security definer set search_path = public as $$
begin
  if p_member is distinct from auth.uid() and not is_admin() then raise exception 'not allowed'; end if;
  return ledger_balance(p_member);
end $$;

-- ---------------------------------------------------------------------------
-- Coin operations (the only way to write the ledger)
-- ---------------------------------------------------------------------------

-- Idempotent: posting the same receipt N times credits once and returns the same balance.
create or replace function credit_purchase(p_product text, p_store_txn_id text) returns int
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_p products;
begin
  if v_me is null then raise exception 'not signed in'; end if;
  select * into v_p from products where id = p_product;
  if not found or v_p.kind <> 'consumable' then raise exception 'unknown coin pack %', p_product; end if;
  if p_store_txn_id is null or length(p_store_txn_id) < 6 then raise exception 'invalid transaction id'; end if;
  -- Serialise per member so balance reads stay consistent with concurrent spends.
  perform 1 from members where id = v_me for update;
  insert into coin_ledger (member_id, kind, amount, product_id, store_txn_id, note)
  values (v_me, 'purchase', v_p.coins, v_p.id, p_store_txn_id, v_p.label)
  on conflict (store_txn_id) where kind = 'purchase' do nothing;
  return ledger_balance(v_me);
end $$;

-- Atomic: lock the member row, check the balance, append the spend. Never goes negative.
create or replace function spend_coin(p_note text default 'Extra curated introduction') returns int
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_bal int; v_id uuid;
begin
  if v_me is null then raise exception 'not signed in'; end if;
  perform 1 from members where id = v_me for update;
  v_bal := ledger_balance(v_me);
  if v_bal < 1 then raise exception 'insufficient coins'; end if;
  insert into coin_ledger (member_id, kind, amount, note) values (v_me, 'spend', -1, p_note) returning id into v_id;
  insert into intro_requests (member_id, ledger_id, note) values (v_me, v_id, p_note);
  return v_bal - 1;
end $$;

-- Admin: reverse exactly one purchase, once. Refuses if those coins were already spent.
create or replace function admin_refund_purchase(p_purchase uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_row coin_ledger; v_bal int;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  select * into v_row from coin_ledger where id = p_purchase and kind = 'purchase';
  if not found then raise exception 'purchase not found'; end if;
  perform 1 from members where id = v_row.member_id for update;
  if exists (select 1 from coin_ledger where refunds = p_purchase) then raise exception 'already refunded'; end if;
  v_bal := ledger_balance(v_row.member_id);
  if v_bal < v_row.amount then raise exception 'coins from this purchase were already spent'; end if;
  insert into coin_ledger (member_id, kind, amount, refunds, note)
  values (v_row.member_id, 'refund', -v_row.amount, p_purchase, 'Refund of ' || coalesce(v_row.note, 'purchase'));
  insert into audit_log (actor, action, target, detail)
  values (auth.uid(), 'refund_purchase', v_row.member_id, jsonb_build_object('purchase', p_purchase, 'coins', v_row.amount));
  return ledger_balance(v_row.member_id);
end $$;

-- Non-consumable: grant or restore once per member, keyed by the original transaction.
create or replace function restore_entitlement(p_product text, p_original_txn_id text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_me uuid := auth.uid(); v_p products;
begin
  if v_me is null then raise exception 'not signed in'; end if;
  select * into v_p from products where id = p_product;
  if not found or v_p.kind <> 'non_consumable' then raise exception 'unknown unlock %', p_product; end if;
  insert into entitlements (member_id, product_id, original_txn_id)
  values (v_me, p_product, p_original_txn_id)
  on conflict (member_id, product_id) do nothing;
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- Concierge (admin) operations, all audited
-- ---------------------------------------------------------------------------
create or replace function admin_set_waitlist(p_member uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admin only'; end if;
  if p_status not in ('approved','declined') then raise exception 'bad status'; end if;
  update members set status = p_status where id = p_member and status = 'waitlist';
  if not found then raise exception 'member is not on the waitlist'; end if;
  insert into audit_log (actor, action, target, detail) values (auth.uid(), 'waitlist_' || p_status, p_member, '{}');
end $$;

create or replace function admin_propose_match(p_a uuid, p_b uuid, p_score int) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_lo uuid := least(p_a, p_b); v_hi uuid := greatest(p_a, p_b); v_id uuid;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  if p_a = p_b then raise exception 'cannot match a member with themselves'; end if;
  if exists (select 1 from blocks where (blocker = p_a and blocked = p_b) or (blocker = p_b and blocked = p_a)) then
    raise exception 'members have blocked each other';
  end if;
  insert into matches (member_a, member_b, score) values (v_lo, v_hi, p_score) returning id into v_id;
  insert into audit_log (actor, action, target, detail)
  values (auth.uid(), 'propose_match', v_id, jsonb_build_object('a', v_lo, 'b', v_hi, 'score', p_score));
  return v_id;
end $$;

create or replace function admin_release_match(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admin only'; end if;
  update matches set status = 'released', released_at = now() where id = p_match and status = 'pending_review';
  if not found then raise exception 'match is not pending review'; end if;
  insert into audit_log (actor, action, target, detail) values (auth.uid(), 'release_match', p_match, '{}');
end $$;

-- Member saves onboarding answers (validated).
create or replace function save_onboarding(
  p_strategy text, p_pace text, p_uncertainty text, p_values text[], p_lifestyle text[], p_intent text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_strategy not in ('comfort','balanced','growth') then raise exception 'choose a matching strategy'; end if;
  if p_pace not in ('slow','steady','fast') then raise exception 'choose a pace'; end if;
  if p_uncertainty not in ('low','medium','high') then raise exception 'choose an uncertainty tolerance'; end if;
  if coalesce(array_length(p_values,1),0) < 2 then raise exception 'pick at least 2 values'; end if;
  if coalesce(array_length(p_lifestyle,1),0) < 1 then raise exception 'pick at least 1 lifestyle rhythm'; end if;
  if p_intent not in ('long_term','marriage','open') then raise exception 'choose an intent'; end if;
  update members set strategy = p_strategy, pace = p_pace, uncertainty = p_uncertainty,
    values = p_values, lifestyle = p_lifestyle, intent = p_intent, onboarded = true
  where id = auth.uid() and status = 'approved';
  if not found then raise exception 'only approved members can onboard'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table members        enable row level security;
alter table blocks         enable row level security;
alter table matches        enable row level security;
alter table messages       enable row level security;
alter table products       enable row level security;
alter table coin_ledger    enable row level security;
alter table entitlements   enable row level security;
alter table intro_requests enable row level security;
alter table audit_log      enable row level security;

-- Members: yourself, people in a RELEASED match with you, or everyone if concierge.
create policy members_read on members for select to authenticated using (
  id = auth.uid() or is_admin() or exists (
    select 1 from matches m where m.status = 'released'
      and ((m.member_a = auth.uid() and m.member_b = members.id) or (m.member_b = auth.uid() and m.member_a = members.id))
  )
);
-- Matches: only released ones you are part of (pending_review is invisible to members).
create policy matches_read on matches for select to authenticated using (
  is_admin() or (status = 'released' and auth.uid() in (member_a, member_b))
);
-- Messages: only inside a released match you are part of.
create policy messages_read on messages for select to authenticated using (
  exists (select 1 from matches m where m.id = messages.match_id and m.status = 'released'
          and auth.uid() in (m.member_a, m.member_b))
);
create policy messages_write on messages for insert to authenticated with check (
  sender = auth.uid() and exists (
    select 1 from matches m where m.id = messages.match_id and m.status = 'released'
      and auth.uid() in (m.member_a, m.member_b))
);
create policy blocks_own on blocks for select to authenticated using (blocker = auth.uid() or is_admin());
create policy products_read on products for select to authenticated using (true);
create policy ledger_read on coin_ledger for select to authenticated using (member_id = auth.uid() or is_admin());
create policy entitlements_read on entitlements for select to authenticated using (member_id = auth.uid() or is_admin());
create policy intros_read on intro_requests for select to authenticated using (member_id = auth.uid() or is_admin());
create policy audit_read on audit_log for select to authenticated using (is_admin());

grant select on members, blocks, matches, messages, products, coin_ledger, entitlements, intro_requests, audit_log to authenticated;
grant insert on messages to authenticated;
-- No direct insert/update/delete on the ledger, matches or members: only through the functions above.
grant execute on function credit_purchase(text,text), spend_coin(text), admin_refund_purchase(uuid),
  restore_entitlement(text,text), admin_set_waitlist(uuid,text), admin_propose_match(uuid,uuid,int),
  admin_release_match(uuid), save_onboarding(text,text,text,text[],text[],text), coin_balance(uuid), is_admin()
  to authenticated;
