-- 004_fleet_ford_transit.sql
-- Four identical Ford Transit vans for construction work.
-- Existing rows stay (bookings reference them) but are no longer bookable.
-- Safe to run more than once.

update public.vans
set is_active = false
where name not in ('Ford Transit 1', 'Ford Transit 2', 'Ford Transit 3', 'Ford Transit 4');

insert into public.vans (name, category, price_per_day, image_url, description)
select v.name, v.category, v.price_per_day, v.image_url, v.description
from (
  values
    ('Ford Transit 1'::text, 'Cargo'::text, 90.00::numeric, 'https://placehold.co/800x500/172026/F6B73C?text=Ford+Transit+1'::text, '3 θέσεις · Χώρος φόρτωσης για υλικά, εργαλεία και εξοπλισμό εργοταξίου · Πετρέλαιο · Χειροκίνητο'::text),
    ('Ford Transit 2'::text, 'Cargo'::text, 90.00::numeric, 'https://placehold.co/800x500/172026/F6B73C?text=Ford+Transit+2'::text, '3 θέσεις · Χώρος φόρτωσης για υλικά, εργαλεία και εξοπλισμό εργοταξίου · Πετρέλαιο · Χειροκίνητο'::text),
    ('Ford Transit 3'::text, 'Cargo'::text, 90.00::numeric, 'https://placehold.co/800x500/172026/F6B73C?text=Ford+Transit+3'::text, '3 θέσεις · Χώρος φόρτωσης για υλικά, εργαλεία και εξοπλισμό εργοταξίου · Πετρέλαιο · Χειροκίνητο'::text),
    ('Ford Transit 4'::text, 'Cargo'::text, 90.00::numeric, 'https://placehold.co/800x500/172026/F6B73C?text=Ford+Transit+4'::text, '3 θέσεις · Χώρος φόρτωσης για υλικά, εργαλεία και εξοπλισμό εργοταξίου · Πετρέλαιο · Χειροκίνητο'::text)
) as v(name, category, price_per_day, image_url, description)
where not exists (
  select 1 from public.vans existing where existing.name = v.name
);

update public.vans
set is_active = true,
    category = 'Cargo',
    price_per_day = 90.00,
    image_url = 'https://placehold.co/800x500/172026/F6B73C?text=Ford+Transit+' || right(name, 1),
    description = '3 θέσεις · Χώρος φόρτωσης για υλικά, εργαλεία και εξοπλισμό εργοταξίου · Πετρέλαιο · Χειροκίνητο'
where name in ('Ford Transit 1', 'Ford Transit 2', 'Ford Transit 3', 'Ford Transit 4');
