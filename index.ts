// Supabase Edge Function: notify-telegram
// Triggered by a DB trigger on INSERT into `bookings`; messages the owner on Telegram.
// Secrets required: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, WEBHOOK_SECRET
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// Escape user-provided text for Telegram's HTML parse mode.
const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

Deno.serve(async (req) => {
  // Only our own DB trigger knows this secret.
  if (req.headers.get("x-webhook-secret") !== Deno.env.get("WEBHOOK_SECRET")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = await req.json();
  if (payload.type !== "INSERT" || payload.table !== "bookings") {
    return new Response("Ignored", { status: 200 });
  }
  const booking = payload.record;

  // Service-role client: bypasses RLS to read the related van and customer.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const [{ data: van }, { data: customer }] = await Promise.all([
    supabase.from("vans").select("name").eq("id", booking.van_id).single(),
    supabase.from("customers").select("full_name, phone, email").eq("id", booking.customer_id).single(),
  ]);

  const text = [
    "🚨 <b>New Van Booking Request!</b>",
    `🚐 <b>Van:</b> ${esc(van?.name)}`,
    `📅 <b>Dates:</b> ${esc(booking.start_date)} to ${esc(booking.end_date)}`,
    `💰 <b>Total Price:</b> €${esc(Number(booking.total_price).toFixed(2))}`,
    `👤 <b>Customer:</b> ${esc(customer?.full_name)}`,
    `📞 <b>Phone:</b> ${esc(customer?.phone)}`,
    `📧 <b>Email:</b> ${esc(customer?.email)}`,
    "🆔 <b>Status:</b> Pending Approval",
  ].join("\n");

  const res = await fetch(
    `https://api.telegram.org/bot${Deno.env.get("TELEGRAM_BOT_TOKEN")}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: Deno.env.get("TELEGRAM_CHAT_ID"),
        text,
        parse_mode: "HTML",
      }),
    },
  );

  if (!res.ok) {
    console.error("Telegram error:", await res.text());
    return new Response("Telegram error", { status: 502 });
  }
  return new Response("OK", { status: 200 });
});
