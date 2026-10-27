-- =====================================================================
-- 001_schema.sql  -  Tables, constraints, RLS and RPC functions
-- Run this whole file in: Supabase Dashboard > SQL Editor
-- =====================================================================

create extension if not exists btree_gist;  -- needed for the overlap constraint

-- ---------------------------------------------------------------------
-- TABLES
-- ---------------------------------------------------------------------
create table public.vans (
  id            uuid primary key default gen_random_uuid(),
  name          text        not null,
  category      text        not null default 'Van',
  price_per_day numeric(10,2) not null check (price_per_day >= 0),
  image_url     text,
  description   text,
  is_active     boolean     not null default true
);

create table public.customers (
  id             uuid primary key default gen_random_uuid(),
  full_name      text not null,
  email          text not null,
  phone          text not null,
  license_number text not null,
  created_at     timestamptz not null default now()
);
-- One customer row per e-mail (case-insensitive); repeat customers are updated.
create unique index customers_email_unique on public.customers (lower(email));

create table public.bookings (
  id          uuid primary key default gen_random_uuid(),
  van_id      uuid not null references public.vans(id)      on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  start_date  date not null,
  end_date    date not null,
  total_price numeric(10,2) not null check (total_price >= 0),
  status      text not null default 'pending'
              check (status in ('pending', 'confirmed', 'cancelled')),
  created_at  timestamptz not null default now(),
  constraint valid_date_range check (end_date >= start_date),
  -- HARD GUARANTEE against double bookings (even under race conditions):
  -- the same van cannot have two overlapping active bookings.
  constraint no_double_booking exclude using gist (
    van_id with =,
    daterange(start_date, end_date, '[]') with &&
  ) where (status in ('pending', 'confirmed'))
);
create index bookings_van_dates_idx on public.bookings (van_id, start_date, end_date);

-- ---------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- Public visitors may ONLY read active vans. Customers and bookings are
-- fully private: no policy = no direct access for the anon key.
-- The owner manages data from the Supabase dashboard (bypasses RLS).
-- ---------------------------------------------------------------------
alter table public.vans      enable row level security;
alter table public.customers enable row level security;
alter table public.bookings  enable row level security;

create policy "Public can read active vans"
  on public.vans for select
  to anon, authenticated
  using (is_active = true);

-- ---------------------------------------------------------------------
-- RPC: get_available_vans
-- Returns active vans with NO pending/confirmed booking overlapping
--   (booking.start_date <= search_end) AND (booking.end_date >= search_start)
-- SECURITY DEFINER lets it read bookings without exposing that table.
-- ---------------------------------------------------------------------
create or replace function public.get_available_vans(
  p_start    date,
  p_end      date,
  p_category text default null
)
returns setof public.vans
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'invalid_dates';
  end if;

  return query
    select v.*
    from public.vans v
    where v.is_active
      and (p_category is null or v.category = p_category)
      and not exists (
        select 1 from public.bookings b
        where b.van_id = v.id
          and b.status in ('pending', 'confirmed')
          and b.start_date <= p_end
          and b.end_date   >= p_start
      )
    order by v.price_per_day, v.name;
end;
$$;

-- ---------------------------------------------------------------------
-- RPC: create_booking
-- Validates input, re-checks availability, upserts the customer and
-- computes the price SERVER-SIDE (the client can never set its own price).
-- Days are counted inclusively (same logic as the availability check).
-- ---------------------------------------------------------------------
create or replace function public.create_booking(
  p_van_id    uuid,
  p_start     date,
  p_end       date,
  p_full_name text,
  p_email     text,
  p_phone     text,
  p_license   text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_van         public.vans;
  v_customer_id uuid;
  v_booking_id  uuid;
  v_days        int;
begin
  if p_start is null or p_end is null or p_end < p_start or p_start < current_date then
    raise exception 'invalid_dates';
  end if;
  if length(trim(coalesce(p_full_name, ''))) < 2
     or length(trim(coalesce(p_phone, ''))) < 6
     or length(trim(coalesce(p_license, ''))) < 3
     or p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_customer';
  end if;

  -- Lock the van row so concurrent requests are serialized
  select * into v_van from public.vans where id = p_van_id and is_active for update;
  if not found then
    raise exception 'van_not_found';
  end if;

  if exists (
    select 1 from public.bookings b
    where b.van_id = p_van_id
      and b.status in ('pending', 'confirmed')
      and b.start_date <= p_end and b.end_date >= p_start
  ) then
    raise exception 'van_not_available';
  end if;

  insert into public.customers (full_name, email, phone, license_number)
  values (trim(p_full_name), trim(p_email), trim(p_phone), trim(p_license))
  on conflict (lower(email)) do update
    set full_name = excluded.full_name,
        phone = excluded.phone,
        license_number = excluded.license_number
  returning id into v_customer_id;

  v_days := (p_end - p_start) + 1;

  insert into public.bookings (van_id, customer_id, start_date, end_date, total_price)
  values (p_van_id, v_customer_id, p_start, p_end, v_van.price_per_day * v_days)
  returning id into v_booking_id;

  return v_booking_id;
exception
  when exclusion_violation then
    raise exception 'van_not_available';
end;
$$;

grant execute on function public.get_available_vans(date, date, text) to anon, authenticated;
grant execute on function public.create_booking(uuid, date, date, text, text, text, text) to anon, authenticated;
