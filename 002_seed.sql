-- 002_seed.sql  -  Sample vans (replace image URLs / data with real ones)
insert into public.vans (name, category, price_per_day, image_url, description) values
('Ford Transit Camper', 'Camper', 95.00, 'https://placehold.co/800x500/0F4C5C/FFFFFF?text=Ford+Transit+Camper',
 '4 seats · 2 beds · Kitchenette · Diesel · Manual'),
('Fiat Ducato Cargo', 'Cargo', 65.00, 'https://placehold.co/800x500/172026/FFFFFF?text=Fiat+Ducato+Cargo',
 '3 seats · 11 m³ load space · Diesel · Manual'),
('Mercedes Vito 9-Seater', 'Passenger', 85.00, 'https://placehold.co/800x500/FFC93C/172026?text=Mercedes+Vito',
 '9 seats · Air conditioning · Diesel · Automatic'),
('VW California', 'Camper', 130.00, 'https://placehold.co/800x500/0F4C5C/FFFFFF?text=VW+California',
 '4 seats · Pop-up roof · Fridge · Diesel · Automatic');
