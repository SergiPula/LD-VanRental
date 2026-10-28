-- 005_rental_quote.sql
-- Duration discount on the 1-day rate. Pickup and return days both count.
-- 1 day: 100% · 2–3: 90% · 4–6: 85% · 7–13: 80% · 14+: 75%
-- Run in the Supabase SQL editor. The argument list matches the website.

create or replace function public.rental_quote(p_daily numeric, p_days integer)
returns numeric
language sql
immutable
as $$
  select round(
    p_daily * p_days * case
      when p_days <= 1 then 1.00
      when p_days <= 3 then 0.90
      when p_days <= 6 then 0.85
      when p_days <= 13 then 0.80
      else 0.75
    end,
    2
  );
$$;

-- The checked-in 7-argument draft (with p_license) is not what the form sends.
drop function if exists public.create_booking(uuid, date, date, text, text, text, text);

create or replace function public.create_booking(
  p_van_id          uuid,
  p_start           date,
  p_end             date,
  p_full_name       text,
  p_email           text,
  p_phone           text,
  p_pickup_address  text,
  p_return_address  text
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
     or p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_customer';
  end if;
  if length(trim(coalesce(p_pickup_address, ''))) < 5
     or length(trim(coalesce(p_return_address, ''))) < 5 then
    raise exception 'invalid_address';
  end if;

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

  insert into public.customers (full_name, email, phone)
  values (trim(p_full_name), trim(p_email), trim(p_phone))
  on conflict (lower(email)) do update
    set full_name = excluded.full_name,
        phone = excluded.phone
  returning id into v_customer_id;

  v_days := (p_end - p_start) + 1;

  insert into public.bookings (
    van_id, customer_id, start_date, end_date, total_price, pickup_address, return_address
  )
  values (
    p_van_id, v_customer_id, p_start, p_end,
    public.rental_quote(v_van.price_per_day, v_days),
    trim(p_pickup_address), trim(p_return_address)
  )
  returning id into v_booking_id;

  return v_booking_id;
exception
  when exclusion_violation then
    raise exception 'van_not_available';
end;
$$;

grant execute on function public.create_booking(uuid, date, date, text, text, text, text, text) to anon, authenticated;
