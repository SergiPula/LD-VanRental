-- =====================================================================
-- 003_telegram_trigger.sql
-- Calls the `notify-telegram` Edge Function on every new booking.
-- Before running: deploy the function (see README) and replace
--   <PROJECT_REF>    -> your project ref (Settings > General)
--   <WEBHOOK_SECRET> -> the same random string you set as a function secret
-- The call is asynchronous (pg_net), so a Telegram outage never blocks
-- or breaks the customer's booking.
-- =====================================================================
create trigger on_booking_created
  after insert on public.bookings
  for each row
  execute function supabase_functions.http_request(
    'https://<PROJECT_REF>.supabase.co/functions/v1/notify-telegram',
    'POST',
    '{"Content-Type":"application/json","x-webhook-secret":"<WEBHOOK_SECRET>"}',
    '{}',
    '5000'
  );
