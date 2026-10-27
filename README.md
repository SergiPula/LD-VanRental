# 🚐 Van Rentals – Σύστημα κρατήσεων

Static frontend (HTML/CSS/Vanilla JS, χωρίς build) + Supabase (PostgreSQL + Edge Function) + ειδοποιήσεις Telegram.
Δωρεάν hosting: GitHub Pages + Supabase Free tier.

## Δομή project

```
van-rental/
├── index.html                      # Wizard 3 βημάτων
├── css/styles.css                  # Responsive UI
├── js/
│   ├── config.js                   # Supabase URL + anon key (δημόσια)
│   └── app.js                      # Λογική: αναζήτηση, φόρμα, κράτηση
├── supabase/
│   ├── migrations/
│   │   ├── 001_schema.sql          # Πίνακες, constraints, RLS, RPC functions
│   │   ├── 002_seed.sql            # Δείγμα βαν
│   │   └── 003_telegram_trigger.sql# Trigger → Edge Function
│   └── functions/notify-telegram/index.ts
└── .gitignore
```

## 1. Telegram Bot

1. Στο Telegram ψάξε το **@BotFather** → `/newbot` → διάλεξε όνομα και username (τελειώνει σε `bot`).
2. Ο BotFather σου δίνει το **Bot Token** (π.χ. `123456:ABC-DEF...`). Κράτα το μυστικό.
3. Ο ιδιοκτήτης ανοίγει το bot που δημιούργησες και πατάει **Start** (αλλιώς το bot δεν μπορεί να του στείλει μήνυμα).
4. Για το **Chat ID**: στείλε οποιοδήποτε μήνυμα στο bot και άνοιξε στον browser  
   `https://api.telegram.org/bot<BOT_TOKEN>/getUpdates` → βρες `"chat":{"id":123456789,...}`. Αυτός ο αριθμός είναι το Chat ID.  
   (Για group: πρόσθεσε το bot στο group και το id είναι αρνητικό, π.χ. `-100123...`.)

## 2. Supabase

1. Φτιάξε project στο https://supabase.com (Free).
2. **SQL Editor** → τρέξε με τη σειρά `001_schema.sql`, μετά `002_seed.sql` (προαιρετικό).
3. **Settings → API**: αντέγραψε το **Project URL** και το **anon public key** και βάλ' τα στο `js/config.js`:
   ```js
   SUPABASE_URL: "https://xxxx.supabase.co",
   SUPABASE_ANON_KEY: "eyJ...",
   ```
   > Το anon key είναι *σχεδιασμένο* να είναι δημόσιο. Η ασφάλεια προέρχεται από το RLS: οι επισκέπτες δεν μπορούν να διαβάσουν πελάτες ή κρατήσεις.
   > **Ποτέ** μην βάλεις στο frontend το `service_role` key ή το Telegram token.
4. Κανονικές αλλαγές στα βαν (τιμές, φωτογραφίες, `is_active`) και έγκριση κρατήσεων (`status` → `confirmed`/`cancelled`) γίνονται από **Table Editor**.

## 3. Edge Function + Trigger για Telegram

Χρειάζεσαι το [Supabase CLI](https://supabase.com/docs/guides/cli) (`npm i -g supabase` ή `brew install supabase/tap/supabase`).

```bash
supabase login
supabase link --project-ref <PROJECT_REF>

# Μυστικά (αποθηκεύονται στο Supabase, ΟΧΙ στο GitHub)
supabase secrets set TELEGRAM_BOT_TOKEN=123456:ABC-DEF \
                     TELEGRAM_CHAT_ID=123456789 \
                     WEBHOOK_SECRET=$(openssl rand -hex 24)   # σημείωσε την τιμή!

# Deploy (το function προστατεύεται με δικό του secret header, όχι JWT)
supabase functions deploy notify-telegram --no-verify-jwt
```

Μετά άνοιξε το `003_telegram_trigger.sql`, αντικατέστησε `<PROJECT_REF>` και `<WEBHOOK_SECRET>` (την τιμή που όρισες παραπάνω) και τρέξ' το στο SQL Editor.

**Τεστ:** κάνε μια δοκιμαστική κράτηση από το site. Θα πρέπει να έρθει μήνυμα στο Telegram.
Αν δεν έρθει: Dashboard → Edge Functions → `notify-telegram` → Logs, και Database → Webhooks/`net._http_response` για σφάλματα.

## 4. GitHub + Deploy στο GitHub Pages

```bash
cd van-rental
git init
git add .
git commit -m "Initial commit: van rental booking app"
git branch -M main
git remote add origin https://github.com/<USERNAME>/<REPO>.git
git push -u origin main
```

Στο GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `(root)` → Save**.
Σε ~1 λεπτό το site είναι live στο `https://<USERNAME>.github.io/<REPO>/`.

> Το repo μπορεί να είναι public: δεν περιέχει κανένα μυστικό (μόνο το δημόσιο anon key).

## Σημειώσεις

- **Μέρες ενοικίασης:** μετράνε inclusive (π.χ. 10→12 = 3 ημέρες), σύμφωνα με τη λογική διαθεσιμότητας `start_date <= end AND end_date >= start`.
- **Double booking:** προστατεύεται σε 3 επίπεδα: φίλτρο διαθεσιμότητας, έλεγχος μέσα στο `create_booking` (με row lock) και `EXCLUDE` constraint στη βάση.
- **Τιμή:** υπολογίζεται server-side· ο πελάτης δεν μπορεί να την αλλοιώσει.
- **Ακύρωση κράτησης:** άλλαξε το `status` σε `cancelled` και τα ραντεβού ξεκλειδώνουν αυτόματα.
- **Spam:** υπάρχει honeypot. Για περισσότερη προστασία πρόσθεσε Cloudflare Turnstile στο μέλλον.
