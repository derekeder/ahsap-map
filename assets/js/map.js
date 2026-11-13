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
  // parcels: [lat, lon, pin, tier, year, projIdx, twpIdx, oldPins[], note]
  const P = DATA.parcels.map(a => ({ lat: a[0], lon: a[1], pin: a[2], tier: a[3], year: a[4], proj: DATA.projects[a[5]], pi: a[5], twp: DATA.townships[a[6]], old: a[7], note: a[8], mi: a[9] }));
  const muniName = i => i >= 0 ? DATA.munis[i] : 'Unincorporated';
  const projCount = {};
  P.forEach(p => { projCount[p.pi] = (projCount[p.pi] || 0) + 1; });

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
  const canvas = L.canvas({ padding: 0.5, tolerance: 4, pane: 'points' });

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
          '<br>' + n.toLocaleString() + (n === 1 ? ' parcel' : ' parcels') + (n !== pr.parcels ? ' shown · ' + pr.parcels + ' total' : '');
      }, { sticky: true, direction: 'right', offset: [12, 0] });
      layer.on('click', () => setMuni(state.muni === pr.i ? null : pr.i, true));
    }
  }).addTo(map);
  map.getContainer().classList.add('bmode-muni');
  const parcelBounds = items => L.latLngBounds(items.map(p => [p.lat, p.lon]));
  const countyBounds = muniLayer.getBounds().extend(parcelBounds(P));
  map.fitBounds(countyBounds, { padding: [10, 10] });
  map.setMaxBounds(countyBounds.pad(0.4));
  document.getElementById('mlegend').innerHTML = '<span>Parcels:</span> ' +
    [[0, '0'], [.07, '1–4'], [.15, '5–9'], [.25, '10–24'], [.36, '25–99'], [.48, '100+']].map(([o, l]) => '<span><i style="--o:' + o + '"></i>' + l + '</span>').join(' ');

  const pointLayer = L.layerGroup().addTo(map);

  // ignoreMuni: apply every filter except the municipality one (for per-municipality counts)
  function passes(p, ignoreMuni) {
    return state.tiers.has(p.tier) && state.years.has(p.year) &&
      (ignoreMuni || state.muni === null || p.mi === state.muni);
  }
  function filtered() { return P.filter(p => passes(p, false)); }

  function projectPopup(g) {
    const t = tierOf(g.tier);
    const yrs = [...new Set(g.items.map(p => p.year))].sort();
    return '<div class="pop"><h3>' + esc(g.name) + '</h3>' +
      '<span class="badge" style="--c:var(' + t.v + ')">' + esc(t.name) + '</span>' +
      '<dl><dt>Municipality</dt><dd>' + esc(muniName(g.items[0].mi)) + '</dd>' +
      '<dt>Township</dt><dd>' + esc(g.items[0].twp) + '</dd>' +
      '<dt>First year</dt><dd>' + yrs.join(', ') + '</dd>' +
      '<dt>Parcels</dt><dd>' + g.items.length + (g.items.length < projCount[g.pi] ? ' of ' + projCount[g.pi] + ' match filters' : '') + '</dd></dl>' +
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
        renderer: canvas, radius: 4 + Math.sqrt(n) * 2.2, weight: on ? 2.5 : 1,
        color: on ? colors.hl : colors.panel, fillColor: colors[g.tier], fillOpacity: .8, opacity: 1
      }).bindPopup(() => projectPopup(g), { maxWidth: 300 });
      m.addTo(pointLayer);
      g.items.forEach(p => { markerByPin[p.pin] = m; });
    });
    renderCounts();
    renderMuniTable();
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
      (partly(i) ? ' <span class="partly">part</span>' : '') +
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
      b.setAttribute('aria-pressed', state.tiers.has(t.key)); render();
    });
    tierBox.appendChild(b);
  });

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
  DATA.munis.map((n, i) => [n, i]).sort((a, b) => a[0].localeCompare(b[0])).forEach(([n, i]) => {
    const o = document.createElement('option'); o.value = i; o.textContent = n + ' (' + (muniTotals[i] || 0) + ')'; msel.appendChild(o);
  });
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
    if (changed) { tierBox.querySelectorAll('.tier').forEach(b => b.setAttribute('aria-pressed', state.tiers.has(b.dataset.key))); syncYears(); }
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
    state.hlProj = p.pi; render();
    map.flyTo([p.lat, p.lon], 17, { duration: .7 });
    map.once('moveend', () => markerByPin[p.pin]?.openPopup());
  }
  map.on('popupopen', e => {
    e.popup.getElement().querySelectorAll('[data-proj]').forEach(b => b.addEventListener('click', () => focusProject(+b.dataset.proj)));
  });

  document.getElementById('unmappedNote').textContent = DATA.unmapped + ' listed parcels have no map location and are not shown (mostly recently divided PINs).';

  // Re-color canvas points when the theme flips
  const retheme = () => { readColors(); tiles.setUrl(tileUrl()); render(); };
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', retheme);
  new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  render();
  window.addEventListener('resize', () => map.invalidateSize());
});
