/* Ενοικίαση Βαν – frontend logic (vanilla JS, no build step).
 * Flow: Step 1 search -> Step 2 details + map -> Step 3 confirmation.
 * Supabase calls (get_available_vans, create_booking, vans select) are unchanged.
 * Needs: supabase-js, Leaflet (loaded in index.html) and js/config.js. */
(() => {
  "use strict";

  const cfg = window.APP_CONFIG;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const $ = (id) => document.getElementById(id);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const state = { start: null, end: null, van: null, days: 0, step: 1 };

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */
  const money = (n) => new Intl.NumberFormat("el-GR", { style: "currency", currency: "EUR" }).format(Number(n));
  const fmtDate = (iso) =>
    new Date(iso + "T00:00:00").toLocaleDateString("el-GR", { day: "numeric", month: "long", year: "numeric" });
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  // Inclusive day count, identical to the DB logic (start and end day both count).
  const countDays = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000) + 1;
  const todayISO = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  };
  const FALLBACK_IMG =
    "data:image/svg+xml;utf8," +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="100%" height="100%" fill="#e6ebf0"/><text x="50%" y="50%" text-anchor="middle" fill="#5c6770" font-family="sans-serif" font-size="32">Χωρίς φωτογραφία</text></svg>');

  // Known English category values (from the sample data) get Greek labels; the raw value is still used for filtering.
  const CATEGORY_LABELS = { Camper: "Κάμπερ", Cargo: "Μεταφορικό", Passenger: "Επιβατικό", Van: "Βαν" };
  const catLabel = (c) => CATEGORY_LABELS[c] || c;

  const showError = (el, msg) => { el.textContent = msg; el.hidden = !msg; };

  function friendlyError(err) {
    const m = (err && err.message) || "";
    if (m.includes("van_not_available")) return "Λυπούμαστε, το βαν μόλις κρατήθηκε για αυτές τις ημερομηνίες. Επιλέξτε άλλο βαν ή άλλες ημερομηνίες.";
    if (m.includes("invalid_dates")) return "Επιλέξτε έγκυρες ημερομηνίες (από σήμερα και μετά, με επιστροφή μετά την παραλαβή).";
    if (m.includes("invalid_customer")) return "Ελέγξτε το όνομα, το email και το τηλέφωνό σας και δοκιμάστε ξανά.";
    if (m.includes("invalid_address")) return "Συμπληρώστε διεύθυνση παραλαβής και επιστροφής.";
    return "Κάτι πήγε στραβά. Δοκιμάστε ξανά σε λίγο.";
  }

  /* ------------------------------------------------------------------ */
  /* Wizard step navigation (direction-aware slide animation)            */
  /* ------------------------------------------------------------------ */
  function goToStep(n) {
    const forward = n >= state.step;
    state.step = n;
    [1, 2, 3].forEach((i) => {
      const el = $("step" + i);
      el.hidden = i !== n;
      el.classList.remove("enter-fwd", "enter-back");
      if (i === n) { void el.offsetWidth; el.classList.add(forward ? "enter-fwd" : "enter-back"); }
    });
    document.querySelectorAll(".stepper li").forEach((li) => {
      const s = Number(li.dataset.step);
      li.classList.toggle("active", s === n);
      li.classList.toggle("done", s < n);
    });
    $("progressFill").style.width = `${(n / 3) * 100}%`;
    $("book").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    if (n === 2) initMap(); // Leaflet needs a visible container
  }

  /* ------------------------------------------------------------------ */
  /* Header (solid on scroll), mobile menu, scroll-reveal                */
  /* ------------------------------------------------------------------ */
  const header = $("siteHeader");
  const scrollBar = $("scrollProgress");
  const toTop = $("toTop");
  const navLinks = [...document.querySelectorAll("#mainNav a")];
  const spySections = [...document.querySelectorAll("main section[id]")];

  const syncToTop = (show) => {
    if (!toTop) return;
    toTop.classList.toggle("is-visible", show);
    toTop.setAttribute("aria-hidden", String(!show));
    toTop.tabIndex = show ? 0 : -1;
  };

  const markNav = (y) => {
    const line = y + 110;
    let current = "";
    spySections.forEach((sec) => {
      if (sec.offsetTop <= line) current = sec.id;
    });
    navLinks.forEach((a) => a.classList.toggle("is-current", a.getAttribute("href") === "#" + current));
  };

  const onScroll = () => {
    const y = window.scrollY;
    header.classList.toggle("scrolled", y > 8);
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (scrollBar) scrollBar.style.transform = `scaleX(${max > 0 ? Math.min(1, y / max) : 0})`;
    syncToTop(y > 520);
    markNav(y);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  if (toTop) {
    toTop.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    });
  }

  const menuBtn = $("menuBtn");
  const setMenu = (open) => {
    header.classList.toggle("open", open);
    menuBtn.setAttribute("aria-expanded", String(open));
    menuBtn.setAttribute("aria-label", open ? "Κλείσιμο μενού" : "Άνοιγμα μενού");
  };
  menuBtn.addEventListener("click", () => setMenu(!header.classList.contains("open")));
  $("mainNav").addEventListener("click", (e) => { if (e.target.closest("a")) setMenu(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setMenu(false); });

  // Fade-up on scroll. After the animation the attribute is removed so hover transitions work normally.
  const io = "IntersectionObserver" in window && !reduceMotion
    ? new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          const el = en.target;
          io.unobserve(el);
          el.classList.add("in");
          const delay = parseFloat(getComputedStyle(el).getPropertyValue("--i") || 0) * 90;
          setTimeout(() => { el.removeAttribute("data-reveal"); el.classList.remove("in"); }, 900 + delay);
        });
      }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" })
    : null;
  function observeReveals(root = document) {
    root.querySelectorAll("[data-reveal]").forEach((el) => (io ? io.observe(el) : el.removeAttribute("data-reveal")));
  }
  observeReveals();

  /* ------------------------------------------------------------------ */
  /* Photos: if one fails to load, hide it so the gradient behind shows  */
  /* ------------------------------------------------------------------ */
  document.querySelectorAll("img[data-photo]").forEach((img) => {
    img.addEventListener("error", () => img.classList.add("failed"));
    if (img.loading !== "lazy" && img.complete && img.naturalWidth === 0) img.classList.add("failed");
  });

  // Gentle parallax on the photo band (skipped when the user prefers reduced motion)
  const parallaxEls = [...document.querySelectorAll("[data-parallax]")];
  if (parallaxEls.length && !reduceMotion) {
    let ticking = false;
    const update = () => {
      const vh = window.innerHeight;
      parallaxEls.forEach((img) => {
        const r = img.parentElement.getBoundingClientRect();
        if (r.bottom < 0 || r.top > vh) return;
        const p = (r.top + r.height / 2 - vh / 2) / vh; // roughly -1..1
        img.style.transform = `translate3d(0, ${(p * -36).toFixed(1)}px, 0) scale(1.15)`;
      });
      ticking = false;
    };
    window.addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    window.addEventListener("resize", update);
    update();
  }

  /* ------------------------------------------------------------------ */
  /* Contact links (WhatsApp / Email) – values come from config.js       */
  /* ------------------------------------------------------------------ */
  const waNumber = String(cfg.WHATSAPP_NUMBER || "").replace(/\D/g, "");
  const waText = encodeURIComponent("Γεια σας! Θα ήθελα πληροφορίες για ενοικίαση βαν.");
  document.querySelectorAll(".js-wa").forEach((a) => {
    if (waNumber) a.href = `https://wa.me/${waNumber}?text=${waText}`;
    else a.hidden = true; // no number configured -> hide instead of a dead link
  });
  document.querySelectorAll(".js-mail").forEach((a) => {
    if (cfg.CONTACT_EMAIL) a.href = `mailto:${cfg.CONTACT_EMAIL}?subject=${encodeURIComponent("Ερώτηση για ενοικίαση βαν")}`;
    else a.hidden = true;
  });
  document.querySelectorAll(".js-email-label").forEach((el) => {
    if (cfg.PUBLIC_EMAIL) el.textContent = cfg.PUBLIC_EMAIL;
  });
  const tel = String(cfg.PHONE_NUMBER || "").replace(/[^\d+]/g, "");
  document.querySelectorAll(".js-tel").forEach((a) => {
    if (tel) a.href = `tel:${tel}`;
    else a.hidden = true;
  });

  /* ------------------------------------------------------------------ */
  /* Init                                                                */
  /* ------------------------------------------------------------------ */
  $("year").textContent = new Date().getFullYear();
  $("startDate").min = $("endDate").min = todayISO();

  $("startDate").addEventListener("change", () => {
    $("endDate").min = $("startDate").value || todayISO();
    if ($("endDate").value && $("endDate").value < $("startDate").value) $("endDate").value = $("startDate").value;
  });

  /* ------------------------------------------------------------------ */
  /* Van cards (used by search results and by the fleet section)         */
  /* ------------------------------------------------------------------ */
  function buildCard(van, { actionLabel, onAction, index = 0, reveal = false }) {
    const card = document.createElement("article");
    card.className = "card";
    if (reveal) { card.setAttribute("data-reveal", ""); card.style.setProperty("--i", index % 4); }

    const media = document.createElement("div"); media.className = "media";
    const img = document.createElement("img");
    img.src = van.image_url || FALLBACK_IMG;
    img.alt = van.name; img.loading = "lazy";
    img.onerror = () => { img.onerror = null; img.src = FALLBACK_IMG; };
    const badge = document.createElement("span"); badge.className = "badge"; badge.textContent = catLabel(van.category);
    media.append(img, badge);

    const body = document.createElement("div");
    body.className = "card-body";
    // textContent everywhere: never inject DB text as HTML
    const h3 = document.createElement("h3"); h3.textContent = van.name;
    const specs = document.createElement("p"); specs.className = "specs"; specs.textContent = van.description || "";
    const foot = document.createElement("div"); foot.className = "card-foot";
    const price = document.createElement("div"); price.className = "price";
    price.append(money(van.price_per_day) + " ");
    const small = document.createElement("small"); small.textContent = "/ ημέρα"; price.appendChild(small);
    const btn = document.createElement("button");
    btn.className = "btn btn-primary"; btn.type = "button"; btn.textContent = actionLabel;
    btn.addEventListener("click", () => onAction(van));
    foot.append(price, btn);

    body.append(h3, specs, foot);
    card.append(media, body);
    return card;
  }

  function skeletons(box, n = 3) {
    box.innerHTML = "";
    for (let i = 0; i < n; i++) {
      const c = document.createElement("article");
      c.className = "card skel";
      c.innerHTML = '<div class="media"></div><div class="card-body"><i></i><i></i><i></i></div>';
      box.appendChild(c);
    }
  }

  // Categories + fleet section (both read the public, RLS-protected `vans` table)
  (async function loadFleet() {
    const grid = $("fleetGrid");
    skeletons(grid);
    const { data, error } = await sb.from("vans").select("*").order("price_per_day");
    grid.innerHTML = "";
    const vans = error ? [] : data || [];
    if (!vans.length) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = error ? "Δεν ήταν δυνατή η φόρτωση των βαν. Δοκιμάστε ξανά αργότερα." : "Δεν υπάρχουν διαθέσιμα βαν αυτή τη στιγμή.";
      grid.appendChild(p);
      return;
    }
    [...new Set(vans.map((v) => v.category))].sort().forEach((c) => {
      const o = document.createElement("option");
      o.value = c; o.textContent = catLabel(c);
      $("categoryFilter").appendChild(o);
    });
    vans.forEach((van, i) =>
      grid.appendChild(buildCard(van, {
        actionLabel: "Έλεγχος ημερομηνιών", index: i, reveal: true,
        onAction: () => {
          $("book").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
          setTimeout(() => $("startDate").focus({ preventScroll: true }), 500);
        },
      })));
    observeReveals(grid);
  })();

  /* ------------------------------------------------------------------ */
  /* Step 1: search availability                                         */
  /* ------------------------------------------------------------------ */
  $("searchForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const start = $("startDate").value, end = $("endDate").value;
    showError($("searchError"), "");
    if (!start || !end) return showError($("searchError"), "Επιλέξτε ημερομηνία παραλαβής και επιστροφής.");
    if (end < start) return showError($("searchError"), "Η ημερομηνία επιστροφής πρέπει να είναι ίδια ή μετά την παραλαβή.");
    if (start < todayISO()) return showError($("searchError"), "Η ημερομηνία παραλαβής δεν μπορεί να είναι στο παρελθόν.");

    $("resultsInfo").textContent = "Έλεγχος διαθεσιμότητας…";
    skeletons($("results"));

    // Server-side availability: excludes vans with pending/confirmed overlapping bookings
    const { data, error } = await sb.rpc("get_available_vans", {
      p_start: start, p_end: end, p_category: $("categoryFilter").value || null,
    });
    if (error) {
      $("results").innerHTML = ""; $("resultsInfo").textContent = "";
      return showError($("searchError"), friendlyError(error));
    }

    state.start = start; state.end = end; state.days = countDays(start, end);
    renderVans(data || []);
  });

  function renderVans(vans) {
    const box = $("results");
    box.innerHTML = "";
    if (!vans.length) {
      $("resultsInfo").textContent = "Δεν υπάρχουν ελεύθερα βαν για αυτές τις ημερομηνίες. Δοκιμάστε άλλες ημερομηνίες ή άλλο τύπο βαν.";
      return;
    }
    $("resultsInfo").textContent =
      `${plural(vans.length, "διαθέσιμο βαν", "διαθέσιμα βαν")} · ${plural(state.days, "ημέρα", "ημέρες")}`;
    vans.forEach((van, i) =>
      box.appendChild(buildCard(van, { actionLabel: "Κράτηση", onAction: selectVan, index: i, reveal: true })));
    observeReveals(box);
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
  /* Validation with instant visual feedback                             */
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
      v.trim().length >= 2 && /\p{L}/u.test(v) ? "" : "Συμπληρώστε το ονοματεπώνυμό σας.",
    email: (v) =>
      EMAIL_RE.test(v.trim()) ? "" : "Εισάγετε έγκυρο email, π.χ. onoma@example.com.",
    phone: (v) => {
      const p = normalizePhone(v);
      if (!p) return "Συμπληρώστε το τηλέφωνό σας.";
      if (!/^\+?\d+$/.test(p)) return "Χρησιμοποιήστε μόνο ψηφία (μπορείτε να ξεκινήσετε με +). Κενά και παύλες δεν πειράζουν.";
      const digits = p.replace("+", "");
      if (digits.length < 8 || digits.length > 15) return "Οι αριθμοί τηλεφώνου έχουν 8 έως 15 ψηφία. Ελέγξτε τον αριθμό σας.";
      if (p.startsWith("+30") && digits.length !== 12) return "Οι ελληνικοί αριθμοί έχουν 10 ψηφία μετά το +30.";
      return "";
    },
    pickupAddress: (v) => (v.trim().length >= 5 ? "" : "Συμπληρώστε διεύθυνση παραλαβής στην Αθήνα."),
    returnAddress: (v) => (v.trim().length >= 5 ? "" : "Συμπληρώστε διεύθυνση επιστροφής στην Αθήνα."),
  };

  // Paint a field as valid / invalid / neutral.
  function paintField(id, msg, valid) {
    const input = $(id), field = input.closest(".field");
    field.classList.toggle("is-invalid", !!msg);
    field.classList.toggle("is-valid", valid);
    input.setAttribute("aria-invalid", msg ? "true" : "false");
    showError($(id + "-error"), msg);
  }

  function validateField(id, show = true) {
    const value = $(id).value, msg = validators[id](value);
    if (show) paintField(id, msg, !msg && value.trim() !== "");
    return !msg;
  }

  Object.keys(validators).forEach((id) => {
    const input = $(id);
    input.addEventListener("blur", () => {
      input.dataset.touched = "1";
      if (id === "phone" && !validators.phone(input.value)) input.value = normalizePhone(input.value);
      validateField(id);
    });
    // Instant feedback: turns green the moment the value is valid;
    // errors only appear after the field was left once (or was already flagged), so typing is never nagged.
    input.addEventListener("input", () => {
      const msg = validators[id](input.value);
      if (!msg) paintField(id, "", true);
      else if (input.dataset.touched || input.closest(".field").classList.contains("is-invalid")) paintField(id, msg, false);
      else paintField(id, "", false);
    });
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
    const res = await fetch(`${NOMINATIM}${path}&accept-language=el,en`, { signal });
    if (!res.ok) throw new Error("geocoder");
    return res.json();
  }

  const shortName = (displayName) => displayName.split(",").slice(0, 4).map((s) => s.trim()).join(", ");

  function initMap() {
    if (map) { setTimeout(() => map.invalidateSize(), 60); return; }
    map = L.map("map", {
      center: ATHENS.center, zoom: ATHENS.zoom, minZoom: 9, zoomSnap: 0.5,
      maxBounds: [[ATHENS.south - 0.3, ATHENS.west - 0.3], [ATHENS.north + 0.3, ATHENS.east + 0.3]],
    });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">Συνεισφέροντες OpenStreetMap</a>',
    }).addTo(map);
    map.on("click", (e) => setPoint(mode(), e.latlng));
    setTimeout(() => map.invalidateSize(), 60);
  }

  function placePin(kind, latlng) {
    if (pins[kind]) { pins[kind].setLatLng(latlng); return; }
    const icon = L.divIcon({
      className: `pin pin-${kind}`, html: `<span>${kind === "pickup" ? "Π" : "Ε"}</span>`,
      iconSize: [32, 32], iconAnchor: [16, 16],
    });
    pins[kind] = L.marker(latlng, { icon, draggable: true, title: kind === "pickup" ? "Παραλαβή" : "Επιστροφή" }).addTo(map);
    pins[kind].on("dragend", () => setPoint(kind, pins[kind].getLatLng()));
  }

  // Smoothly frame the pins: both -> fit them, one -> fly to it.
  function frame(latlng) {
    if (reduceMotion) { map.setView(latlng, Math.max(map.getZoom(), 14)); return; }
    if (pins.pickup && pins.return) {
      const b = L.latLngBounds([pins.pickup.getLatLng(), pins.return.getLatLng()]);
      if (b.getSouthWest().equals(b.getNorthEast())) map.flyTo(latlng, 15, { duration: 0.8 });
      else map.flyToBounds(b, { padding: [60, 60], maxZoom: 15, duration: 0.9 });
    } else {
      map.flyTo(latlng, Math.max(map.getZoom(), 14.5), { duration: 0.8 });
    }
  }

  // Put a pin on the map and (unless a label is given) look up its address name.
  async function setPoint(kind, latlng, label) {
    if (!inAthens(latlng)) { mapMsg("Επιλέξτε σημείο εντός της περιοχής της Αθήνας."); return; }
    initMap();
    mapMsg("");
    placePin(kind, latlng);
    frame(latlng);
    const input = $(KINDS[kind]);
    if (label) setAddress(kind, label);
    else {
      mapMsg("Αναζήτηση διεύθυνσης…");
      try {
        const r = await nominatim(`/reverse?format=jsonv2&zoom=18&lat=${latlng.lat}&lon=${latlng.lng}`);
        setAddress(kind, r && r.display_name ? shortName(r.display_name) : "");
      } catch {
        // Geocoder unreachable: keep the pin and use coordinates as a readable fallback
        setAddress(kind, `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`);
      }
      mapMsg("");
    }
    input.dataset.touched = "1";
    validateField(input.id);
  }

  function setAddress(kind, text) {
    $(KINDS[kind]).value = text;
    if (kind === "pickup") syncReturn();
  }

  // "Επιστροφή στο ίδιο σημείο" mirrors the pickup address and pin.
  function syncReturn() {
    if (!$("sameAsPickup").checked) return;
    $("returnAddress").value = $("pickupAddress").value;
    if (pins.pickup) placePin("return", pins.pickup.getLatLng());
    if ($("returnAddress").value.trim()) { $("returnAddress").dataset.touched = "1"; validateField("returnAddress"); }
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
        const li = document.createElement("li"); li.className = "none"; li.textContent = "Δεν βρέθηκε αποτέλεσμα στην Αθήνα. Μπορείτε να πατήσετε στον χάρτη.";
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
            `/search?format=jsonv2&limit=5&countrycodes=gr&viewbox=${VIEWBOX}&bounded=1&q=${encodeURIComponent(q + " Αθήνα")}`,
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
    submit.disabled = true; submit.textContent = "Αποστολή…";

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

    submit.disabled = false; submit.textContent = "Αποστολή αιτήματος κράτησης";
    if (error) return showError($("bookingError"), friendlyError(error));

    $("confirmRef").textContent = `Κωδικός κράτησης: ${String(data).slice(0, 8).toUpperCase()}`;
    goToStep(3);
  });

  /* ------------------------------------------------------------------ */
  /* Step 3: start over                                                  */
  /* ------------------------------------------------------------------ */
  $("newBookingBtn").addEventListener("click", () => {
    $("bookingForm").reset();
    $("returnAddress").disabled = false;
    Object.keys(validators).forEach((id) => { delete $(id).dataset.touched; paintField(id, "", false); });
    Object.keys(pins).forEach((k) => { if (pins[k]) { pins[k].remove(); pins[k] = null; } });
    $("results").innerHTML = ""; $("resultsInfo").textContent = "";
    state.van = null;
    goToStep(1);
  });
})();
