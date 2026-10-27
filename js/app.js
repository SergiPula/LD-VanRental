/* Van Rentals – frontend logic (vanilla JS, no build step).
 * Flow: Step 1 search -> Step 2 booking form -> Step 3 confirmation. */
(() => {
  "use strict";

  const cfg = window.APP_CONFIG;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const $ = (id) => document.getElementById(id);

  // ---- State ----
  const state = { start: null, end: null, van: null, days: 0 };

  // ---- Helpers ----
  const money = (n) => `${cfg.CURRENCY}${Number(n).toFixed(2)}`;
  const fmtDate = (iso) =>
    new Date(iso + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  // Inclusive day count, identical to the DB logic (start and end day both count).
  const countDays = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000) + 1;
  const todayISO = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  };
  const FALLBACK_IMG =
    "data:image/svg+xml;utf8," +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="100%" height="100%" fill="#e8eeec"/><text x="50%" y="50%" text-anchor="middle" fill="#5d6b73" font-family="sans-serif" font-size="32">No photo</text></svg>');

  function showError(el, msg) { el.textContent = msg; el.hidden = !msg; }

  function friendlyError(err) {
    const m = (err && err.message) || "";
    if (m.includes("van_not_available")) return "Sorry, this van was just booked for those dates. Please choose another van or dates.";
    if (m.includes("invalid_dates")) return "Please choose valid dates (today or later, return after pickup).";
    if (m.includes("invalid_customer")) return "Please check your details and try again.";
    return "Something went wrong. Please try again in a moment.";
  }

  function goToStep(n) {
    [1, 2, 3].forEach((i) => ($("step" + i).hidden = i !== n));
    document.querySelectorAll(".stepper li").forEach((li) => {
      const s = Number(li.dataset.step);
      li.classList.toggle("active", s === n);
      li.classList.toggle("done", s < n);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ---- Init ----
  $("brandName").textContent = cfg.BUSINESS_NAME;
  $("year").textContent = new Date().getFullYear();
  $("startDate").min = todayISO();
  $("endDate").min = todayISO();

  $("startDate").addEventListener("change", () => {
    $("endDate").min = $("startDate").value || todayISO();
    if ($("endDate").value && $("endDate").value < $("startDate").value) $("endDate").value = $("startDate").value;
  });

  // Fill the category filter from active vans
  (async function loadCategories() {
    const { data } = await sb.from("vans").select("category");
    const cats = [...new Set((data || []).map((v) => v.category))].sort();
    cats.forEach((c) => {
      const o = document.createElement("option");
      o.value = c; o.textContent = c;
      $("categoryFilter").appendChild(o);
    });
  })();

  // ---- Step 1: search availability ----
  $("searchForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const start = $("startDate").value, end = $("endDate").value;
    showError($("searchError"), "");
    if (!start || !end) return showError($("searchError"), "Please select both a pickup and a return date.");
    if (end < start) return showError($("searchError"), "The return date must be on or after the pickup date.");
    if (start < todayISO()) return showError($("searchError"), "The pickup date cannot be in the past.");

    $("resultsInfo").textContent = "Checking availability…";
    $("results").innerHTML = "";

    // Server-side availability: excludes vans with pending/confirmed overlapping bookings
    const { data, error } = await sb.rpc("get_available_vans", {
      p_start: start, p_end: end, p_category: $("categoryFilter").value || null,
    });
    if (error) { $("resultsInfo").textContent = ""; return showError($("searchError"), friendlyError(error)); }

    state.start = start; state.end = end; state.days = countDays(start, end);
    renderVans(data || []);
  });

  function renderVans(vans) {
    const box = $("results");
    box.innerHTML = "";
    if (!vans.length) {
      $("resultsInfo").textContent = "No vans are free on those dates. Try different dates or another van type.";
      return;
    }
    $("resultsInfo").textContent =
      `${vans.length} van${vans.length > 1 ? "s" : ""} available · ${state.days} day${state.days > 1 ? "s" : ""}`;

    vans.forEach((van) => {
      const card = document.createElement("article");
      card.className = "card";

      const img = document.createElement("img");
      img.src = van.image_url || FALLBACK_IMG;
      img.alt = van.name; img.loading = "lazy";
      img.onerror = () => { img.onerror = null; img.src = FALLBACK_IMG; };

      const body = document.createElement("div");
      body.className = "card-body";
      // textContent everywhere: never inject DB text as HTML
      const tag = document.createElement("span"); tag.className = "tag"; tag.textContent = van.category;
      const h3 = document.createElement("h3"); h3.textContent = van.name;
      const specs = document.createElement("p"); specs.className = "specs"; specs.textContent = van.description || "";
      const foot = document.createElement("div"); foot.className = "card-foot";
      const price = document.createElement("div"); price.className = "price";
      price.append(money(van.price_per_day) + " ");
      const small = document.createElement("small"); small.textContent = "/ day"; price.appendChild(small);
      const btn = document.createElement("button");
      btn.className = "btn btn-primary"; btn.type = "button"; btn.textContent = "Book this van";
      btn.addEventListener("click", () => selectVan(van));
      foot.append(price, btn);

      body.append(tag, h3, specs, foot);
      card.append(img, body);
      box.appendChild(card);
    });
  }

  // ---- Step 2: booking form ----
  function selectVan(van) {
    state.van = van;
    $("sumImg").src = van.image_url || FALLBACK_IMG;
    $("sumName").textContent = van.name;
    $("sumStart").textContent = fmtDate(state.start);
    $("sumEnd").textContent = fmtDate(state.end);
    $("sumDays").textContent = state.days;
    $("sumRate").textContent = money(van.price_per_day);
    $("sumTotal").textContent = money(van.price_per_day * state.days); // price_per_day * number_of_days
    showError($("bookingError"), "");
    goToStep(2);
  }

  $("backBtn").addEventListener("click", () => goToStep(1));

  $("bookingForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if ($("website").value) return; // honeypot triggered: silently drop bots
    showError($("bookingError"), "");

    if (!e.target.checkValidity()) { e.target.reportValidity(); return; }

    const submit = $("submitBtn");
    submit.disabled = true; submit.textContent = "Sending…";

    // The server re-checks availability and computes the final price itself.
    const { data, error } = await sb.rpc("create_booking", {
      p_van_id: state.van.id,
      p_start: state.start,
      p_end: state.end,
      p_full_name: $("fullName").value,
      p_email: $("email").value,
      p_phone: $("phone").value,
      p_license: $("license").value,
    });

    submit.disabled = false; submit.textContent = "Send booking request";
    if (error) return showError($("bookingError"), friendlyError(error));

    $("confirmRef").textContent = `Reference: ${String(data).slice(0, 8).toUpperCase()}`;
    goToStep(3);
  });

  // ---- Step 3: start over ----
  $("newBookingBtn").addEventListener("click", () => {
    $("bookingForm").reset();
    $("results").innerHTML = ""; $("resultsInfo").textContent = "";
    state.van = null;
    goToStep(1);
  });
})();
