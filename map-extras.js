/* OCNJ map add-on: price-vs-market colours, booked homes, week-aware Rates link.
 *
 * Load after the map's own <script>:   <script src="map-extras.js"></script>
 * Needs map-extras.json (from build_map_extras.py). If that file is missing,
 * the map works exactly as before.
 *
 * Relies on these globals from the map page: map, markers, filters,
 * properties, renderMarkers, applyFilters.
 */
(function () {
  const X = { data: null, showBooked: false, bookedMarkers: [] };
  let legendEl = null;

  // ---------- styles ----------
  const css = `
  .price-marker.pm-under{border-color:#1f8a4c;color:#1f8a4c}
  .price-marker.pm-over{border-color:#d1432b;color:#d1432b}
  .price-marker.pm-booked{background:#eef1f4;border-color:#9aa7b2;color:#5f6e7a;
    box-shadow:none;opacity:.9;font-weight:600}
  .price-marker.pm-booked::after{border-top-color:#eef1f4}
  .pm-legend{background:white;border-radius:12px;padding:8px 10px;
    box-shadow:0 3px 12px rgba(30,58,95,.2);font:12px 'DM Sans',sans-serif;color:#1e3a5f;line-height:1.7}
  .pm-legend .sw{display:inline-block;width:10px;height:10px;border-radius:50%;
    border:2.5px solid;margin-right:6px;vertical-align:-1px;background:white}
  .pm-legend label{display:block;margin-top:4px;border-top:1px solid #e5e7eb;padding-top:5px;cursor:pointer}
  .pm-legend .muted{color:#7a8c99}
  .popup-vs{font-size:.8rem;margin-top:4px;font-weight:600}
  .popup-vs.under{color:#1f8a4c}.popup-vs.over{color:#d1432b}.popup-vs.near{color:#1e3a5f}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  // ---------- helpers ----------
  const money = v => '$' + Math.round(v).toLocaleString();
  const short = v => '$' + (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function marketRate(p, week) {
    if (!X.data) return null;
    const h = X.data.homes[p.listId]; const i = X.data.weeks.indexOf(week);
    return h && i >= 0 && h.m[i] ? h.m[i] : null;
  }
  // 'under' = below quick-book, 'over' = above stretch, 'near' = in between
  function band(price, mkt) {
    if (!price || !mkt) return null;
    const t = X.data.tier;
    if (price < mkt * (1 - t)) return 'under';
    if (price > mkt * (1 + t)) return 'over';
    return 'near';
  }
  function vsText(price, mkt) {
    const d = Math.round((price / mkt - 1) * 100);
    return d === 0 ? 'At market rate' : (d > 0 ? '+' : '') + d + '% vs market rate (' + money(mkt) + ')';
  }
  // Same filters as the map, but taking the price we pass in (used for booked homes).
  function matches(p, price) {
    const f = filters, zones = (typeof ZONE_IDS !== 'undefined' ? ZONE_IDS : []).filter(z => f.zones && f.zones[z]);
    if (price < f.priceMin || price > f.priceMax) return false;
    if (f.bedsMin > 0 && p.beds && p.beds < f.bedsMin) return false;
    if (f.bedsMax > 0 && p.beds && p.beds > f.bedsMax) return false;
    if (f.bathsMin > 0 && p.baths && p.baths < f.bathsMin) return false;
    if (f.bathsMax > 0 && p.baths && p.baths > f.bathsMax) return false;
    if (f.guestsMin > 0 && p.guests && p.guests < f.guestsMin) return false;
    if (f.guestsMax > 0 && p.guests && p.guests > f.guestsMax) return false;
    if (zones.length && !zones.includes(p.zone)) return false;
    return true;
  }

  function popupHtml(p, price, mkt, booked) {
    const b = band(price, mkt);
    return `
      <div class="popup-card">
        <img src="${esc(p.imageUrl)}" class="popup-img" onerror="this.style.display='none'" loading="lazy"/>
        <div class="popup-body">
          <div class="popup-address">${esc(p.address)}</div>
          <div class="popup-specs">${p.beds || '?'} BR · ${p.baths || '?'} BA · ${p.guests || '?'} guests</div>
          <div class="popup-price">${price ? money(price) + ' / week' : 'Unavailable'}${booked ? ' · booked' : ''}</div>
          ${b ? `<div class="popup-vs ${b}">${vsText(price, mkt)}</div>` : ''}
          <div style="display:flex;gap:8px;margin-top:12px;">
            <a href="ocnj-rate-tool.html?id=${encodeURIComponent(p.listId)}&week=${encodeURIComponent(filters.week)}" target="_blank" class="popup-link popup-link-secondary">💲 Rates</a>
            <a href="${esc(p.listingUrl)}" target="_blank" class="popup-link">View on Berger →</a>
          </div>
        </div>
      </div>`;
  }

  function addMarker(p, price, booked, list) {
    const mkt = marketRate(p, filters.week);
    const b = booked ? 'booked' : band(price, mkt);
    const label = price ? short(price) : '?';
    const icon = L.divIcon({
      className: '',
      html: `<div class="price-marker${b ? ' pm-' + b : ''}">${label}</div>`,
      iconAnchor: [26, 34], popupAnchor: [0, -38]
    });
    const m = L.marker([p.lat, p.lng], { icon, zIndexOffset: booked ? -1000 : 0 })
      .addTo(map).bindPopup(popupHtml(p, price, mkt, booked), { maxWidth: 280 });
    list.push(m);
    return m;
  }

  // ---------- replace the map's renderMarkers ----------
  renderMarkers = function (data) {
    markers.forEach(m => map.removeLayer(m)); markers = [];
    X.bookedMarkers.forEach(m => map.removeLayer(m)); X.bookedMarkers = [];

    const count = data.length;
    document.getElementById('result-count').textContent = count + ' Available';

    const bounds = [];
    data.forEach(p => {
      if (!p.lat || !p.lng) return;
      addMarker(p, p._weekPrice, false, markers);
      bounds.push([p.lat, p.lng]);
    });

    let nBooked = 0;
    if (X.showBooked && X.data) {
      properties.forEach(p => {
        const h = X.data.homes[p.listId]; const price = h && h.bk[filters.week];
        if (!price || !p.lat || !p.lng || !matches(p, price)) return;
        addMarker(p, price, true, X.bookedMarkers); nBooked++;
      });
    }
    document.getElementById('avail-count').textContent =
      count + ' shown' + (nBooked ? ' · ' + nBooked + ' booked' : '');
    updateLegend(data, nBooked);

    if (bounds.length && firstRender) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [40, 40], maxZoom: 15 });
      firstRender = false;
    }
  };

  // ---------- legend ----------
  function updateLegend(data, nBooked) {
    if (!legendEl || !X.data) return;
    const c = { under: 0, near: 0, over: 0 };
    data.forEach(p => { const b = band(p._weekPrice, marketRate(p, filters.week)); if (b) c[b]++; });
    const hasModel = X.data.weeks.includes(filters.week);
    legendEl.innerHTML = hasModel ? `
      <div><span class="sw" style="border-color:#1f8a4c"></span>Below market · ${c.under}</div>
      <div><span class="sw" style="border-color:#1e3a5f"></span>Near market · ${c.near}</div>
      <div><span class="sw" style="border-color:#d1432b"></span>Above market · ${c.over}</div>
      <label><input type="checkbox" id="pm-booked" ${X.showBooked ? 'checked' : ''}> Show booked${X.showBooked ? ' · ' + nBooked : ''}</label>`
      : `<div class="muted">Market rates cover<br>May – mid-Oct weeks only</div>`;
    const cb = legendEl.querySelector('#pm-booked');
    if (cb) cb.onchange = () => { X.showBooked = cb.checked; try { localStorage.setItem('pmBooked', cb.checked ? '1' : ''); } catch (e) {} applyFilters(); };
  }

  function addLegend() {
    const Legend = L.Control.extend({
      options: { position: 'bottomright' },
      onAdd() { legendEl = L.DomUtil.create('div', 'pm-legend'); L.DomEvent.disableClickPropagation(legendEl); return legendEl; }
    });
    new Legend().addTo(map);
  }

  // ---------- start ----------
  try { X.showBooked = localStorage.getItem('pmBooked') === '1'; } catch (e) {}
  window.addEventListener('DOMContentLoaded', () => {
    fetch('map-extras.json')
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(d => { X.data = d; if (map) { addLegend(); applyFilters(); } })
      .catch(err => console.warn('map-extras.json not loaded; map runs without market colours.', err));
  });
})();
