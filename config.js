// Public configuration. The anon key is SAFE to commit: it is designed to be public,
// and all data access is restricted by Row Level Security + RPC functions.
// NEVER put the service_role key or the Telegram token in this file.
window.APP_CONFIG = {
  SUPABASE_URL: "https://YOUR_PROJECT_REF.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_ANON_KEY",
  BUSINESS_NAME: "Van Rentals",
  CURRENCY: "€",
};
