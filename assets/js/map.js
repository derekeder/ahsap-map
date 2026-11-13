fetch(window.AHSAP_DATA_URL).then(r => r.json()).then(function (DATA) {
  // Definitions from the Cook County Assessor's AHSAP program description
  const TIERS = [
    { key: '15', name: 'Tier 15', full: 'Tier 15', v: '--t15', cut: '25% AV reduction',
      req: '15% to 34% of dwelling units rent at or below 60% of AMI.',
      term: '10-year commitment, with two 10-year renewals available (30 years total).' },
    { key: '35', name: 'Tier 35', full: 'Tier 35', v: '--t35', cut: '35% AV reduction',
      req: '35% or more of dwelling units rent at or below 60% of AMI.',
      term: '10-year commitment, with two 10-year renewals available (30 years total).' },
    { key: 'LAC', name: 'LAC', full: 'Low Affordability Community (LAC)', v: '--tlac', cut: 'Graduated benefit',
      req: 'New housing developments in designated Low Affordability Communities. At least 20% of dwelling units kept affordable, with incomes and rents at or below 60% of AMI.',
      term: '30-year commitment.' },
  ];
  const YEARS = [...new Set(DATA.parcels.map(a => a[4]))].sort();
  // parcels: [lat, lon, pin, tier, year, projIdx, twpIdx, oldPins[], note, areaIdx, chars]
  // chars: [class, yearBuilt, bldgSf, landSf, sourceId] from Cook County Assessor open data (see build/characteristics.py)
  const P = DATA.parcels.map(a => ({ lat: a[0], lon: a[1], pin: a[2], tier: a[3], year: a[4], proj: DATA.projects[a[5]], pi: a[5], twp: DATA.townships[a[6]], old: a[7], note: a[8], mi: a[9], ch: a[10] }));
  const muniName = i => i >= 0 ? DATA.munis[i] : 'Unincorporated';
  // Chicago is split into its 77 community areas; those areas carry properties.ca in muniGeo
  const isCA = i => i >= 0 && !!DATA.muniGeo.features[i].properties.ca;
  const projFirstPin = {};
  P.forEach(p => { if (!(p.pi in projFirstPin)) projFirstPin[p.pi] = p.pin; });

  const state = { tiers: new Set(TIERS.map(t => t.key)), years: new Set(YEARS), muni: null, hlProj: null };
  const fmtPin = s => s.replace(/^(\d{2})(\d{2})(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3-$4-$5');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const tierOf = k => TIERS.find(t => t.key === k);
  let colors = {};
  const readColors = () => { colors = { '35': css('--t35'), '15': css('--t15'), 'LAC': css('--tlac'), hl: css('--hl'), panel: css('--panel') }; };
  readColors();

  // Map
  const map = L.map('map', { zoomSnap: 0.25, minZoom: 8, maxZoom: 18, preferCanvas: false, attributionControl: true });
  map.attributionControl.setPrefix(false).addAttribution('Boundaries: U.S. Census Bureau');
  // CARTO basemap: Positron in light theme, Dark Matter in dark. Lock this key to your domains in CARTO's dashboard.
  const CARTO_KEY = 'cb1_3nq3_5_bbfe1829675cfa977123f376';
  const isDark = () => css('--bg').toLowerCase() === '#111715';
  const tileUrl = () => 'https://basemaps.cartocdn.com/rastertiles/' + (isDark() ? 'dark_all' : 'light_all') + '/{z}/{x}/{y}{r}.png?key=' + CARTO_KEY;
  const tiles = L.tileLayer(tileUrl(), {
    maxNativeZoom: 18, maxZoom: 20,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>'
  }).addTo(map);
  tiles.once('tileload', () => map.getContainer().classList.add('has-tiles'));
  const svg = L.svg({ padding: 0.5 });
  map.createPane('points').style.zIndex = 450;
  // SVG (not canvas) so clicks on empty map space fall through to the municipality shapes below
  const pointRenderer = L.svg({ padding: 0.5, pane: 'points' });

  // Municipalities: shaded by total AHSAP parcels (quantile-ish fixed breaks)
  const BREAKS = [1, 5, 10, 25, 100];
  const qClass = n => 'q' + BREAKS.filter(b => n >= b).length;
  const muniLayers = {};
  const muniLayer = L.geoJSON(DATA.muniGeo, {
    renderer: svg,
    style: f => ({ className: 'muni ' + qClass(f.properties.parcels) }),
    onEachFeature: (f, layer) => {
      const pr = f.properties; muniLayers[pr.i] = layer;
      layer.bindTooltip(() => {
        const n = P.filter(p => p.mi === pr.i && passes(p, true)).length;
        return '<b>' + esc(pr.name) + '</b>' + (pr.partly ? ' <span style="color:var(--muted)">(part in Cook)</span>' : '') +
          (pr.ca ? ' <span style="color:var(--muted)">(Chicago)</span>' : '') +
          '<br>' + n.toLocaleString() + (n === 1 ? ' parcel' : ' parcels') + (n !== pr.parcels ? ' shown · ' + pr.parcels + ' total' : '');
      }, { sticky: true, direction: 'right', offset: [12, 0] });
      layer.on('click', () => setMuni(state.muni === pr.i ? null : pr.i, true));
    }
  }).addTo(map);
  if (DATA.chicagoOutline) L.geoJSON(DATA.chicagoOutline, { renderer: svg, interactive: false, style: { className: 'city-outline' } }).addTo(map);
  map.getContainer().classList.add('bmode-muni');
  const parcelBounds = items => L.latLngBounds(items.map(p => [p.lat, p.lon]));
  const countyBounds = muniLayer.getBounds().extend(parcelBounds(P));
  map.fitBounds(countyBounds, { padding: [10, 10] });
  map.setMaxBounds(countyBounds.pad(0.4));
  document.getElementById('mlegend').innerHTML =
    [[0, '0'], [.07, '1–4'], [.15, '5–9'], [.25, '10–24'], [.36, '25–99'], [.48, '100+']].map(([o, l]) => '<span><i style="--o:' + o + '"></i>' + l + '</span>').join('');

  const pointLayer = L.layerGroup().addTo(map);

  // ignoreMuni: apply every filter except the municipality one (for per-municipality counts)
  function passes(p, ignoreMuni) {
    return state.tiers.has(p.tier) && state.years.has(p.year) &&
      (ignoreMuni || state.muni === null || p.mi === state.muni);
  }
  function filtered() { return P.filter(p => passes(p, false)); }

  // Assessor parcel photo, loaded from the Assessor's site by a fixed URL pattern per PIN. Not every PIN has one, so the
  // popup falls back through the project's next few PINs, then removes the image. Space for the image is reserved up
  // front so the popup never needs popup.update(), which would rebuild its content.
  const photoUrl = pin => 'https://prodassets.cookcountyassessoril.gov/s3fs-public/pin_detail/' + pin.slice(0, 3) + '-' + pin.slice(3, 5) + '/' + pin.slice(5, 8) + '/' + pin + '_AA.jpg';
  const fmtNum = n => Math.round(n).toLocaleString();
  const shortDesc = d => { d = d.split(' (')[0]; return d.length > 120 ? d.slice(0, 117).replace(/[ ,]+\S*$/, '') + '…' : d; };
  const THIS_YEAR = new Date().getFullYear();
  function charsHtml(items, extra) {
    const withCh = items.filter(p => p.ch);
    if (!withCh.length) return '<dl>' + extra + '</dl>';
    // a commercial record can cover several PINs: count each record's numbers once
    const recs = [...new Map(withCh.filter(p => p.ch[4]).map(p => [p.ch[4], p.ch])).values()];
    const counts = {}; withCh.forEach(p => { if (p.ch[0]) counts[p.ch[0]] = (counts[p.ch[0]] || 0) + 1; });
    const codes = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    const desc = codes.length ? esc(shortDesc(DATA.classes[codes[0]] || 'Class ' + codes[0])) + ' <span class="muted">(class ' + codes[0] + ')</span>' +
      (codes.length > 1 ? ' <span class="muted">+ ' + (codes.length - 1) + ' other class' + (codes.length > 2 ? 'es' : '') + '</span>' : '') : '';
    const yrs = recs.map(c => c[1]).filter(Boolean), lo = Math.min(...yrs), hi = Math.max(...yrs);
    const age = !yrs.length ? '' : lo === hi ? (THIS_YEAR - lo) + ' years <span class="muted">(built ' + lo + ')</span>'
      : (THIS_YEAR - hi) + '–' + (THIS_YEAR - lo) + ' years <span class="muted">(built ' + lo + '–' + hi + ')</span>';
    const sum = k => { const v = recs.map(c => c[k]).filter(Boolean); return v.length ? fmtNum(v.reduce((a, b) => a + b, 0)) : ''; };
    const bsf = sum(2), lsf = sum(3);
    const row = (k, v) => v ? '<dt>' + k + '</dt><dd>' + v + '</dd>' : '';
    return '<h4>Characteristics' + (items.length > 1 ? ' <span class="muted">· totals for ' + items.length + ' parcels</span>' : '') + '</h4>' +
      '<dl>' + row('Description', desc) + row('Age', age) + row('Building sq ft', bsf) + row('Land sq ft', lsf) + extra + '</dl>';
  }

  function projectPopup(g) {
    const t = tierOf(g.tier);
    const yrs = [...new Set(g.items.map(p => p.year))].sort();
    const photoPins = g.items.slice(0, 4).map(p => p.pin);
    const ca = isCA(g.items[0].mi);
    return '<div class="pop"><img class="photo" alt="" referrerpolicy="no-referrer" src="' + photoUrl(photoPins[0]) + '" data-next="' + photoPins.slice(1).join(',') + '"><h3>' + esc(g.name) + ', ' + (ca ? 'Chicago' : esc(muniName(g.items[0].mi))) + '</h3>' +
      (ca ? '<div class="city">' + esc(muniName(g.items[0].mi)) + '</div>' : '') +
      '<span class="badge" style="--c:var(' + t.v + ')">' + esc(t.name) + '</span>' +
      charsHtml(g.items, '<dt>Started AHSAP</dt><dd>' + yrs.join(', ') + '</dd>') +
      '<div class="pins">' + g.items.map(p => '<div><a href="https://www.cookcountyassessoril.gov/pin/' + p.pin + '" target="_blank" rel="noopener">' + fmtPin(p.pin) + '</a></div>').join('') + '</div>' +
      (g.items.length > 1 ? '<button class="linkbtn" data-proj="' + g.pi + '">Zoom to project</button>' : '<a href="https://www.cookcountyassessoril.gov/pin/' + g.items[0].pin + '" target="_blank" rel="noopener">Assessor property page ↗</a>') + '</div>';
  }

  let markerByPin = {};
  function render() {
    const rows = filtered();
    pointLayer.clearLayers(); markerByPin = {};
    const hl = state.hlProj;
    const groups = new Map();
    rows.forEach(p => {
      let g = groups.get(p.pi);
      if (!g) { g = { pi: p.pi, name: p.proj, items: [], lat: 0, lon: 0, tiers: {} }; groups.set(p.pi, g); }
      g.items.push(p); g.lat += p.lat; g.lon += p.lon; g.tiers[p.tier] = (g.tiers[p.tier] || 0) + 1;
    });
    [...groups.values()].sort((a, b) => b.items.length - a.items.length).forEach(g => {
      g.tier = Object.entries(g.tiers).sort((a, b) => b[1] - a[1])[0][0];
      const n = g.items.length, on = g.pi === hl;
      const m = L.circleMarker([g.lat / n, g.lon / n], {
        renderer: pointRenderer, radius: 4 + Math.sqrt(n) * 2.2, weight: on ? 2.5 : 1,
        color: on ? colors.hl : colors.panel, fillColor: colors[g.tier], fillOpacity: .8, opacity: 1
      }).bindPopup(() => projectPopup(g), { maxWidth: 300 });
      // the open popup's project goes in the URL as ?pin= (the searched PIN, else the project's first PIN)
      m.on('popupopen', () => { selPin = pendingPin && g.items.some(p => p.pin === pendingPin) ? pendingPin : projFirstPin[g.pi]; pendingPin = null; writeUrl(); });
      m.on('popupclose', () => { selPin = null; writeUrl(); });
      m.addTo(pointLayer);
      g.items.forEach(p => { markerByPin[p.pin] = m; });
    });
    renderCounts();
    renderMuniTable();
    writeUrl();
  }

  // URL state for deep links, e.g. ?tiers=15,35&years=2024&muni=evanston&pin=10-13-412-001-0000&map=13/42.04/-87.69
  // Defaults are omitted; history.replaceState keeps the URL current without adding back-button entries.
  const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const muniSlug = i => i === -1 ? 'unincorporated' : (isCA(i) ? 'chicago-' : '') + slug(DATA.munis[i]);
  let urlReady = false, viewMoved = false, selPin = null, pendingPin = null;
  function writeUrl() {
    if (!urlReady) return;
    const u = new URLSearchParams();
    if (state.tiers.size !== TIERS.length) u.set('tiers', TIERS.filter(t => state.tiers.has(t.key)).map(t => t.key).join(','));
    if (state.years.size !== YEARS.length) u.set('years', YEARS.filter(y => state.years.has(y)).join(','));
    if (state.muni !== null) u.set('muni', muniSlug(state.muni));
    if (selPin) u.set('pin', fmtPin(selPin));
    if (viewMoved) { const c = map.getCenter(); u.set('map', +map.getZoom().toFixed(2) + '/' + c.lat.toFixed(5) + '/' + c.lng.toFixed(5)); }
    const qs = u.toString().replace(/%2C/g, ',').replace(/%2F/g, '/');
    const next = location.pathname + (qs ? '?' + qs : '') + location.hash;
    if (next !== location.pathname + location.search + location.hash) history.replaceState(null, '', next);
  }

  // Per-municipality table: respects tier/year filters, not the municipality filter itself
  const mbody = document.getElementById('mbody');
  function renderMuniTable() {
    const agg = new Map();
    P.forEach(p => {
      if (!passes(p, true)) return;
      let a = agg.get(p.mi); if (!a) { a = { n: 0, proj: new Set() }; agg.set(p.mi, a); }
      a.n++; a.proj.add(p.pi);
    });
    const rows = [...agg.entries()].sort((a, b) => b[1].n - a[1].n || muniName(a[0]).localeCompare(muniName(b[0])));
    const max = rows.length ? rows[0][1].n : 1;
    const partly = i => i >= 0 && DATA.muniGeo.features[i].properties.partly;
    mbody.innerHTML = rows.length ? rows.map(([i, a]) =>
      '<tr data-mi="' + i + '"' + (state.muni === i ? ' class="sel"' : '') + ' tabindex="0"><td>' + esc(muniName(i)) +
      (partly(i) ? ' <span class="partly">part</span>' : '') + (isCA(i) ? ' <span class="partly">Chicago</span>' : '') +
      '<span class="bar" style="width:' + Math.max(2, a.n / max * 100) + '%"></span></td><td class="num">' + a.n.toLocaleString() +
      '</td><td class="num">' + a.proj.size.toLocaleString() + '</td></tr>').join('')
      : '<tr><td colspan="3" style="color:var(--muted)">No parcels match these filters.</td></tr>';
  }
  const pickRow = e => { const tr = e.target.closest('tr[data-mi]'); if (tr) { const i = +tr.dataset.mi; setMuni(state.muni === i ? null : i, true); } };
  mbody.addEventListener('click', pickRow);
  mbody.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickRow(e); } });

  // Tier buttons
  const tierBox = document.getElementById('tiers');
  TIERS.forEach(t => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'tier'; b.dataset.key = t.key; b.setAttribute('aria-pressed', 'true');
    b.style.setProperty('--c', 'var(' + t.v + ')');
    b.innerHTML = '<span class="sw"></span><span class="nm">' + t.full + '</span><span class="ct" data-ct></span>' +
      '<span class="ds"><b>' + t.cut + '.</b> ' + t.req + '</span><span class="ds term">' + t.term + '</span>';
    b.addEventListener('click', () => {
      state.tiers.has(t.key) ? state.tiers.delete(t.key) : state.tiers.add(t.key);
      syncTiers(); render();
    });
    tierBox.appendChild(b);
  });

  function syncTiers() { tierBox.querySelectorAll('.tier').forEach(b => b.setAttribute('aria-pressed', state.tiers.has(b.dataset.key))); }

  // Year bars
  const yrBox = document.getElementById('years');
  YEARS.forEach(y => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'yr'; b.dataset.year = y; b.setAttribute('aria-pressed', 'true');
    b.innerHTML = '<span class="bar"><i></i></span><span class="lb">' + y + '</span><span class="n" data-n></span>';
    b.addEventListener('click', () => {
      // first click on a full set isolates that year; later clicks toggle
      if (state.years.size === YEARS.length) { state.years = new Set([y]); }
      else if (state.years.has(y)) { state.years.delete(y); if (!state.years.size) state.years = new Set(YEARS); }
      else state.years.add(y);
      syncYears(); render();
    });
    yrBox.appendChild(b);
  });
  document.getElementById('yrAll').addEventListener('click', () => { state.years = new Set(YEARS); syncYears(); render(); });
  function syncYears() { yrBox.querySelectorAll('.yr').forEach(b => b.setAttribute('aria-pressed', state.years.has(+b.dataset.year))); }

  function renderCounts() {
    // tier counts (distinct projects) respect year + municipality filters; year counts respect tier + municipality filters
    const base = P.filter(p => state.muni === null || p.mi === state.muni);
    tierBox.querySelectorAll('.tier').forEach(b => {
      const n = new Set(base.filter(p => p.tier === b.dataset.key && state.years.has(p.year)).map(p => p.pi)).size;
      b.querySelector('[data-ct]').textContent = n.toLocaleString() + (n === 1 ? ' project' : ' projects');
    });
    const yc = YEARS.map(y => base.filter(p => p.year === y && state.tiers.has(p.tier)).length);
    const max = Math.max(1, ...yc);
    yrBox.querySelectorAll('.yr').forEach((b, i) => {
      b.querySelector('i').style.height = (yc[i] / max * 100) + '%';
      b.querySelector('[data-n]').textContent = yc[i].toLocaleString();
      b.setAttribute('aria-label', YEARS[i] + ': ' + yc[i] + ' parcels');
    });
  }

  // Municipality select
  const msel = document.getElementById('muni');
  const muniProj = {}; P.forEach(p => { (muniProj[p.mi] = muniProj[p.mi] || new Set()).add(p.pi); });
  const muniTotals = {}; Object.keys(muniProj).forEach(k => { muniTotals[k] = muniProj[k].size; });
  const addGroup = (label, test) => {
    const grp = document.createElement('optgroup'); grp.label = label;
    DATA.munis.map((n, i) => [n, i]).filter(([, i]) => test(i)).sort((a, b) => a[0].localeCompare(b[0])).forEach(([n, i]) => {
      const o = document.createElement('option'); o.value = i; o.textContent = n + ' (' + (muniTotals[i] || 0) + ')'; grp.appendChild(o);
    });
    if (grp.children.length) msel.appendChild(grp);
  };
  addGroup('Chicago community areas', i => isCA(i));
  addGroup('Suburban Cook municipalities', i => !isCA(i));
  if (muniTotals[-1]) { const o = document.createElement('option'); o.value = -1; o.textContent = 'Unincorporated (' + muniTotals[-1] + ')'; msel.appendChild(o); }
  msel.addEventListener('change', () => setMuni(msel.value === '' ? null : +msel.value, true));
  function setMuni(i, zoom) {
    if (state.muni !== null && muniLayers[state.muni]) muniLayers[state.muni].getElement()?.classList.remove('sel');
    state.muni = i; msel.value = i === null ? '' : String(i);
    const lyr = i !== null && i >= 0 ? muniLayers[i] : null;
    if (lyr) {
      lyr.getElement()?.classList.add('sel'); lyr.bringToFront();
      if (zoom) map.flyToBounds(lyr.getBounds(), { padding: [20, 20], duration: .6 });
    } else if (zoom && i === null) map.flyToBounds(countyBounds, { padding: [10, 10], duration: .6 });
    render();
  }

  // Search
  const q = document.getElementById('q'), results = document.getElementById('results');
  const projIndex = DATA.projects.map((name, pi) => ({ name, pi, lc: name.toLowerCase(), items: P.filter(p => p.pi === pi) }));
  q.addEventListener('input', () => {
    const v = q.value.trim().toLowerCase(), digits = v.replace(/\D/g, '');
    results.innerHTML = '';
    if (v.length < 2) return;
    let hits;
    if (digits.length >= 6 && /^[\d\s-]+$/.test(v)) {
      hits = P.filter(p => p.pin.startsWith(digits) || p.old.some(o => o.startsWith(digits))).slice(0, 8)
        .map(p => ({ label: fmtPin(p.pin), sub: p.proj, go: () => focusPin(p) }));
    } else {
      hits = projIndex.filter(x => x.lc.includes(v)).slice(0, 8)
        .map(x => ({ label: x.name, sub: x.items.length + (x.items.length === 1 ? ' PIN' : ' PINs'), go: () => focusProject(x.pi) }));
    }
    if (!hits.length) { results.innerHTML = '<li><button type="button" disabled>No matches</button></li>'; return; }
    hits.forEach(h => {
      const li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button'; b.innerHTML = '<span>' + esc(h.label) + '</span><small>' + esc(h.sub) + '</small>';
      b.addEventListener('click', () => { h.go(); results.innerHTML = ''; });
      li.appendChild(b); results.appendChild(li);
    });
  });

  function clearFiltersFor(items) {
    // make sure the target is visible under current filters
    let changed = false;
    items.forEach(p => {
      if (!state.tiers.has(p.tier)) { state.tiers.add(p.tier); changed = true; }
      if (!state.years.has(p.year)) { state.years.add(p.year); changed = true; }
    });
    if (state.muni !== null && items.some(p => p.mi !== state.muni)) { setMuni(null, false); }
    if (changed) { syncTiers(); syncYears(); }
  }
  function focusProject(pi) {
    const items = P.filter(p => p.pi === pi);
    clearFiltersFor(items);
    state.hlProj = pi; render();
    const b = L.latLngBounds(items.map(p => [p.lat, p.lon]));
    map.flyToBounds(b, { maxZoom: 17, padding: [60, 60], duration: .7 });
    map.once('moveend', () => markerByPin[items[0].pin]?.openPopup());
  }
  function focusPin(p) {
    clearFiltersFor([p]);
    pendingPin = p.pin;
    state.hlProj = p.pi; render();
    map.flyTo([p.lat, p.lon], 17, { duration: .7 });
    map.once('moveend', () => markerByPin[p.pin]?.openPopup());
  }
  map.on('popupopen', e => {
    const img = e.popup.getElement().querySelector('img.photo');
    if (img) {
      img.addEventListener('error', () => {
        const next = img.dataset.next ? img.dataset.next.split(',') : [];
        if (next.length) { img.dataset.next = next.slice(1).join(','); img.src = photoUrl(next[0]); } else img.remove();
      });
    }
    e.popup.getElement().querySelectorAll('[data-proj]').forEach(b => b.addEventListener('click', () => focusProject(+b.dataset.proj)));
  });


  // Re-color points when the theme flips
  const retheme = () => { readColors(); tiles.setUrl(tileUrl()); render(); };
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', retheme);
  new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // Apply state from the URL, then start keeping the URL in sync
  const u = new URLSearchParams(location.search);
  const list = k => u.get(k).split(',').map(x => x.trim()).filter(Boolean);
  if (u.has('tiers')) { state.tiers = new Set(list('tiers').map(k => k.toUpperCase()).filter(k => tierOf(k))); syncTiers(); }
  if (u.has('years')) { const ys = list('years').map(Number).filter(y => YEARS.includes(y)); state.years = new Set(ys.length ? ys : YEARS); syncYears(); }
  let startMuni = null;
  if (u.get('muni')) {
    const m = slug(u.get('muni')), found = DATA.munis.findIndex((n, i) => muniSlug(i) === m);
    startMuni = m === 'unincorporated' ? -1 : found >= 0 ? found : null;
  }
  if (startMuni !== null) setMuni(startMuni, false);
  const mv = (u.get('map') || '').split('/').map(Number);
  const hasView = mv.length === 3 && mv.every(Number.isFinite);
  if (hasView) map.setView([mv[1], mv[2]], mv[0], { animate: false });
  else if (startMuni !== null && muniLayers[startMuni]) map.fitBounds(muniLayers[startMuni].getBounds(), { padding: [20, 20] });
  render();
  const pinArg = (u.get('pin') || '').replace(/\D/g, '');
  const target = pinArg && (P.find(p => p.pin === pinArg) || P.find(p => p.old.includes(pinArg)));
  if (target) {
    clearFiltersFor([target]);
    state.hlProj = target.pi; render();
    if (!hasView) map.setView([target.lat, target.lon], 17, { animate: false });
    pendingPin = target.pin;
    markerByPin[target.pin]?.openPopup();
  }
  viewMoved = hasView;
  urlReady = true; writeUrl();
  map.on('moveend', () => { viewMoved = true; writeUrl(); });

  window.addEventListener('resize', () => map.invalidateSize());
});
