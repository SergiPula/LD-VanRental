/* Van Rentals – frontend logic (vanilla JS, no build step).
 * Flow: Step 1 search -> Step 2 details + map -> Step 3 confirmation.
 * Needs: supabase-js, Leaflet (loaded in index.html) and js/config.js. */
(() => {
  "use strict";

  const cfg = window.APP_CONFIG;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const $ = (id) => document.getElementById(id);

  const state = { start: null, end: null, van: null, days: 0 };

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */
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

  const showError = (el, msg) => { el.textContent = msg; el.hidden = !msg; };

  function friendlyError(err) {
    const m = (err && err.message) || "";
    if (m.includes("van_not_available")) return "Sorry, this van was just booked for those dates. Please choose another van or dates.";
    if (m.includes("invalid_dates")) return "Please choose valid dates (today or later, return after pickup).";
    if (m.includes("invalid_customer")) return "Please check your name, email and phone number and try again.";
    if (m.includes("invalid_address")) return "Please enter both a pickup and a return address.";
    return "Something went wrong. Please try again in a moment.";
  }

  function goToStep(n) {
    [1, 2, 3].forEach((i) => ($("step" + i).hidden = i !== n));
    document.querySelectorAll(".stepper li").forEach((li) => {
      const s = Number(li.dataset.step);
      li.classList.toggle("active", s === n);
      li.classList.toggle("done", s < n);
    });
    $("book").scrollIntoView({ behavior: "smooth", block: "start" });
    if (n === 2) initMap(); // Leaflet needs the container to be visible
  }

  /* ------------------------------------------------------------------ */
  /* Contact links (WhatsApp / Email) – values come from config.js       */
  /* ------------------------------------------------------------------ */
  const waNumber = String(cfg.WHATSAPP_NUMBER || "").replace(/\D/g, "");
  const waText = encodeURIComponent("Hello! I have a question about renting a van.");
  document.querySelectorAll(".js-wa").forEach((a) => {
    if (waNumber) a.href = `https://wa.me/${waNumber}?text=${waText}`;
    else a.hidden = true; // no number configured -> hide instead of a dead link
  });
  document.querySelectorAll(".js-mail").forEach((a) => {
    if (cfg.CONTACT_EMAIL) a.href = `mailto:${cfg.CONTACT_EMAIL}?subject=${encodeURIComponent("Van rental question")}`;
    else a.hidden = true;
  });

  /* ------------------------------------------------------------------ */
  /* Init                                                                */
  /* ------------------------------------------------------------------ */
  if (cfg.BUSINESS_NAME) $("brandName").textContent = cfg.BUSINESS_NAME;
  $("year").textContent = new Date().getFullYear();
  $("startDate").min = $("endDate").min = todayISO();

  $("startDate").addEventListener("change", () => {
    $("endDate").min = $("startDate").value || todayISO();
    if ($("endDate").value && $("endDate").value < $("startDate").value) $("endDate").value = $("startDate").value;
  });

  /* ------------------------------------------------------------------ */
  /* Van cards (used by search results and by the fleet section)         */
  /* ------------------------------------------------------------------ */
  function buildCard(van, { priceLabel = "/ day", actionLabel, onAction }) {
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
    const small = document.createElement("small"); small.textContent = priceLabel; price.appendChild(small);
    const btn = document.createElement("button");
    btn.className = "btn btn-primary"; btn.type = "button"; btn.textContent = actionLabel;
    btn.addEventListener("click", () => onAction(van));
    foot.append(price, btn);

    body.append(tag, h3, specs, foot);
    card.append(img, body);
    return card;
  }

  // Categories + fleet section (both read the public, RLS-protected `vans` table)
  (async function loadFleet() {
    const { data } = await sb.from("vans").select("*").order("price_per_day");
    const vans = data || [];
    [...new Set(vans.map((v) => v.category))].sort().forEach((c) => {
      const o = document.createElement("option");
      o.value = c; o.textContent = c;
      $("categoryFilter").appendChild(o);
    });
    const grid = $("fleetGrid");
    vans.forEach((van) =>
      grid.appendChild(buildCard(van, {
        priceLabel: "/ day",
        actionLabel: "Check dates",
        onAction: () => {
          $("book").scrollIntoView({ behavior: "smooth" });
          setTimeout(() => $("startDate").focus({ preventScroll: true }), 500);
        },
      })));
  })();

  /* ------------------------------------------------------------------ */
  /* Step 1: search availability                                         */
  /* ------------------------------------------------------------------ */
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
    vans.forEach((van) => box.appendChild(buildCard(van, { actionLabel: "Book this van", onAction: selectVan })));
  }

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

  /* ------------------------------------------------------------------ */
  /* Validation (email, phone, name, addresses)                          */
  /* ------------------------------------------------------------------ */
  const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

  // Strip spaces, dashes, dots, parentheses; convert a leading 00 to +.
  function normalizePhone(raw) {
    let p = String(raw || "").replace(/[\s\-.()]/g, "");
    if (p.startsWith("00")) p = "+" + p.slice(2);
    return p;
  }

  const validators = {
    fullName: (v) =>
      v.trim().length >= 2 && /\p{L}/u.test(v) ? "" : "Please enter your full name.",
    email: (v) =>
      EMAIL_RE.test(v.trim()) ? "" : "Enter a valid email, like name@example.com.",
    phone: (v) => {
      const p = normalizePhone(v);
      if (!p) return "Please enter your phone number.";
      if (!/^\+?\d+$/.test(p)) return "Use digits only. You can start with + and spaces or dashes are fine.";
      const digits = p.replace("+", "");
      if (digits.length < 8 || digits.length > 15) return "Phone numbers have 8 to 15 digits. Please check yours.";
      if (p.startsWith("+30") && digits.length !== 12) return "Greek numbers have 10 digits after +30.";
      return "";
    },
    pickupAddress: (v) => (v.trim().length >= 5 ? "" : "Please enter a pickup address in Athens."),
    returnAddress: (v) => (v.trim().length >= 5 ? "" : "Please enter a return address in Athens."),
  };

  function validateField(id, show = true) {
    const input = $(id), msg = validators[id](input.value);
    if (show) {
      input.classList.toggle("invalid", !!msg);
      input.setAttribute("aria-invalid", msg ? "true" : "false");
      showError($(id + "-error"), msg);
    }
    return !msg;
  }

  Object.keys(validators).forEach((id) => {
    const input = $(id);
    input.addEventListener("blur", () => {
      if (id === "phone" && !validators.phone(input.value)) input.value = normalizePhone(input.value);
      validateField(id);
    });
    // Once a field is flagged, re-check on every keystroke so the error clears as soon as it's fixed
    input.addEventListener("input", () => { if (input.classList.contains("invalid")) validateField(id); });
  });

  /* ------------------------------------------------------------------ */
  /* Map + address autocomplete (Leaflet + OpenStreetMap / Nominatim)    */
  /* ------------------------------------------------------------------ */
  const ATHENS = { center: [37.9838, 23.7275], zoom: 11, south: 37.70, north: 38.20, west: 23.45, east: 24.10 };
  const VIEWBOX = `${ATHENS.west},${ATHENS.north},${ATHENS.east},${ATHENS.south}`; // left,top,right,bottom
  const NOMINATIM = "https://nominatim.openstreetmap.org";
  const KINDS = { pickup: "pickupAddress", return: "returnAddress" };

  let map = null;
  const pins = { pickup: null, return: null };
  const mode = () => document.querySelector('input[name="mapMode"]:checked').value;
  const setMode = (k) => { document.querySelector(`input[name="mapMode"][value="${k}"]`).checked = true; };
  const inAthens = (ll) => ll.lat >= ATHENS.south && ll.lat <= ATHENS.north && ll.lng >= ATHENS.west && ll.lng <= ATHENS.east;
  const mapMsg = (t) => { $("mapMsg").textContent = t; };

  // Nominatim usage policy: max 1 request/second, so every call waits its turn.
  let lastCall = 0;
  async function nominatim(path, signal) {
    const wait = Math.max(0, lastCall + 1100 - Date.now());
    lastCall = Date.now() + wait;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const res = await fetch(`${NOMINATIM}${path}&accept-language=en,el`, { signal });
    if (!res.ok) throw new Error("geocoder");
    return res.json();
  }

  const shortName = (displayName) => displayName.split(",").slice(0, 4).map((s) => s.trim()).join(", ");

  function initMap() {
    if (map) { setTimeout(() => map.invalidateSize(), 50); return; }
    map = L.map("map", {
      center: ATHENS.center, zoom: ATHENS.zoom, minZoom: 9,
      maxBounds: [[ATHENS.south - 0.3, ATHENS.west - 0.3], [ATHENS.north + 0.3, ATHENS.east + 0.3]],
    });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    map.on("click", (e) => setPoint(mode(), e.latlng));
    setTimeout(() => map.invalidateSize(), 50);
  }

  function placePin(kind, latlng) {
    if (pins[kind]) { pins[kind].setLatLng(latlng); return; }
    const icon = L.divIcon({
      className: `pin pin-${kind}`, html: `<span>${kind === "pickup" ? "P" : "R"}</span>`,
      iconSize: [30, 30], iconAnchor: [15, 15],
    });
    pins[kind] = L.marker(latlng, { icon, draggable: true, title: kind === "pickup" ? "Pickup" : "Return" }).addTo(map);
    pins[kind].on("dragend", () => setPoint(kind, pins[kind].getLatLng()));
  }

  // Put a pin on the map and (unless a label is given) look up its address name.
  async function setPoint(kind, latlng, label) {
    if (!inAthens(latlng)) { mapMsg("Please choose a point inside the Athens area."); return; }
    initMap();
    placePin(kind, latlng);
    map.panTo(latlng);
    const input = $(KINDS[kind]);
    if (label) setAddress(kind, label);
    else {
      mapMsg("Finding the address…");
      try {
        const r = await nominatim(`/reverse?format=jsonv2&zoom=18&lat=${latlng.lat}&lon=${latlng.lng}`);
        setAddress(kind, r && r.display_name ? shortName(r.display_name) : "");
      } catch {
        // Geocoder unreachable: keep the pin and use coordinates as a readable fallback
        setAddress(kind, `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`);
      }
      mapMsg("");
    }
    validateField(input.id);
  }

  function setAddress(kind, text) {
    $(KINDS[kind]).value = text;
    if (kind === "pickup") syncReturn();
  }

  // "Return to the same place" mirrors the pickup address and pin.
  function syncReturn() {
    if (!$("sameAsPickup").checked) return;
    $("returnAddress").value = $("pickupAddress").value;
    if (pins.pickup) placePin("return", pins.pickup.getLatLng());
    validateField("returnAddress", $("returnAddress").classList.contains("invalid"));
  }
  $("sameAsPickup").addEventListener("change", (e) => {
    $("returnAddress").disabled = e.target.checked;
    if (e.target.checked) syncReturn();
  });
  $("pickupAddress").addEventListener("input", syncReturn);

  // Choosing which field you're typing in also switches the map mode.
  Object.entries(KINDS).forEach(([kind, id]) => $(id).addEventListener("focus", () => setMode(kind)));

  // ---- Autocomplete ----
  function setupAutocomplete(kind) {
    const input = $(KINDS[kind]), list = $(KINDS[kind] + "-list");
    let timer = null, ctrl = null, active = -1;

    const close = () => { list.hidden = true; list.innerHTML = ""; input.setAttribute("aria-expanded", "false"); active = -1; };
    const highlight = (i) => {
      [...list.children].forEach((li, n) => li.setAttribute("aria-selected", n === i ? "true" : "false"));
      active = i;
    };
    const choose = (item) => {
      close();
      setPoint(kind, L.latLng(parseFloat(item.lat), parseFloat(item.lon)), shortName(item.display_name));
    };
    const render = (items) => {
      list.innerHTML = "";
      if (!items.length) {
        const li = document.createElement("li"); li.className = "none"; li.textContent = "No matches in Athens. You can still tap the map.";
        list.appendChild(li);
      }
      items.forEach((item) => {
        const li = document.createElement("li");
        li.setAttribute("role", "option"); li.textContent = shortName(item.display_name);
        li.addEventListener("mousedown", (e) => { e.preventDefault(); choose(item); }); // before input blur
        list.appendChild(li);
      });
      list._items = items;
      list.hidden = false; input.setAttribute("aria-expanded", "true"); active = -1;
    };

    input.addEventListener("input", () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 3) return close();
      timer = setTimeout(async () => {
        if (ctrl) ctrl.abort();
        ctrl = new AbortController();
        try {
          const items = await nominatim(
            `/search?format=jsonv2&limit=5&countrycodes=gr&viewbox=${VIEWBOX}&bounded=1&q=${encodeURIComponent(q + " Athens")}`,
            ctrl.signal
          );
          render(items);
        } catch (err) { if (err.name !== "AbortError") close(); }
      }, 700);
    });

    input.addEventListener("keydown", (e) => {
      if (list.hidden) return;
      const n = list.children.length;
      if (e.key === "ArrowDown") { e.preventDefault(); highlight((active + 1) % n); }
      else if (e.key === "ArrowUp") { e.preventDefault(); highlight((active - 1 + n) % n); }
      else if (e.key === "Enter" && active >= 0 && list._items && list._items[active]) { e.preventDefault(); choose(list._items[active]); }
      else if (e.key === "Escape") close();
    });
    input.addEventListener("blur", () => setTimeout(close, 150));
  }
  setupAutocomplete("pickup");
  setupAutocomplete("return");

  /* ------------------------------------------------------------------ */
  /* Step 2: submit                                                      */
  /* ------------------------------------------------------------------ */
  $("bookingForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if ($("website").value) return; // honeypot triggered: silently drop bots
    showError($("bookingError"), "");

    // Validate everything, show all errors, focus the first problem. Nothing is sent until all pass.
    const results = Object.keys(validators).map((id) => [id, validateField(id)]);
    const firstBad = results.find(([, ok]) => !ok);
    if (firstBad) { $(firstBad[0]).focus(); return; }

    const submit = $("submitBtn");
    submit.disabled = true; submit.textContent = "Sending…";

    // The server re-validates, re-checks availability and computes the final price itself.
    const { data, error } = await sb.rpc("create_booking", {
      p_van_id: state.van.id,
      p_start: state.start,
      p_end: state.end,
      p_full_name: $("fullName").value.trim(),
      p_email: $("email").value.trim(),
      p_phone: normalizePhone($("phone").value),
      p_pickup_address: $("pickupAddress").value.trim(),
      p_return_address: $("returnAddress").value.trim(),
    });

    submit.disabled = false; submit.textContent = "Send booking request";
    if (error) return showError($("bookingError"), friendlyError(error));

    $("confirmRef").textContent = `Reference: ${String(data).slice(0, 8).toUpperCase()}`;
    goToStep(3);
  });

  /* ------------------------------------------------------------------ */
  /* Step 3: start over                                                  */
  /* ------------------------------------------------------------------ */
  $("newBookingBtn").addEventListener("click", () => {
    $("bookingForm").reset();
    $("returnAddress").disabled = false;
    Object.keys(validators).forEach((id) => { $(id).classList.remove("invalid"); showError($(id + "-error"), ""); });
    Object.keys(pins).forEach((k) => { if (pins[k]) { pins[k].remove(); pins[k] = null; } });
    $("results").innerHTML = ""; $("resultsInfo").textContent = "";
    state.van = null;
    goToStep(1);
  });
})();
