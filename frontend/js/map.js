/* ─────────────────────────────────────────────────────────────────────────────
   map.js  —  Leaflet overview map for the Overview page.

   FILE ROLE:
     Manages the satellite map shown on the Overview page only.
     Exposes a UTMMap singleton used by app.js and overview.js.

   USED ON:  Overview page only.
             The Airspace page has its own separate map managed
             entirely within airspace.js.

   PUBLIC METHODS (called by app.js after DOMContentLoaded):
     UTMMap.init()           Creates the Leaflet map with ESRI satellite
                              tiles, IIT Bombay label, Powai Lake label.
                              Called once, subsequent calls are no-ops.
     UTMMap.initSearch()     Wires the Nominatim search box (map-search-btn,
                              map-search-box, map-search-input, search-suggestions).
     UTMMap.initFilter()     Wires the filter panel (filter-btn, filter-panel,
                              .filter-opt) to _applyFilter().
     UTMMap.plotCollisions(events)
                              Plots collision event dots from coll_log[].
                              event.lat / event.lon are WGS84 degrees from
                              the overview API response (drone_a_coord_x/y).
                              Skips events with null coordinates — no random
                              fallback.
     UTMMap.invalidate()     Calls _map.invalidateSize() — needed when the
                              map container resizes (e.g. sidebar toggle).
     UTMMap.getMap()         Returns the raw L.map instance.

   MAP CENTER:  [19.1334, 72.9133]  — IIT Bombay, Powai, Mumbai
   TILE LAYER:  ESRI World Imagery (satellite)
──────────────────────────────────────────────────────────────────────────── */
const UTMMap = (() => {
  const CENTER = [19.1334, 72.9133];
  let _map = null, _collLayers = [], _searchMarker = null;
  let _currentFilter = 'all';

  /* ── INIT ── */
  function init() {
    if (_map) return;
    const el = document.getElementById('leaflet-map');
    if (!el) return;

    _map = L.map('leaflet-map', { center:CENTER, zoom:15, zoomControl:false });
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution:'Esri World Imagery | IIT Bombay', maxZoom:19 }
    ).addTo(_map);

    L.marker(CENTER, { icon:L.divIcon({ className:'', iconAnchor:[44,8],
      html:'<div style="background:rgba(255,107,0,.92);color:#fff;padding:2px 8px;border-radius:4px;font-size:9px;font-weight:700;white-space:nowrap;font-family:JetBrains Mono,monospace;box-shadow:0 2px 6px rgba(0,0,0,.3)">IIT BOMBAY · POWAI</div>'
    })}).addTo(_map);

    L.marker([19.1210,72.9060], { icon:L.divIcon({ className:'', iconAnchor:[32,8],
      html:'<div style="background:rgba(59,130,246,.88);color:#fff;padding:2px 7px;border-radius:4px;font-size:9px;font-weight:700;white-space:nowrap;font-family:JetBrains Mono,monospace">Powai Lake</div>'
    })}).addTo(_map);

    _map.on('moveend', () => {
      const c = _map.getCenter();
      _reverseGeocode(c.lat, c.lng);
      if (typeof window.fetchWeather === 'function') window.fetchWeather(c.lat, c.lng);
    });

    setTimeout(() => { if (typeof window._drawWindCompass === 'function') window._drawWindCompass(18,112); }, 100);
    _reverseGeocode(CENTER[0], CENTER[1]);
    if (typeof window.fetchWeather === 'function') window.fetchWeather(CENTER[0], CENTER[1]);
  }

  /* ── REVERSE GEOCODE ── */
  async function _reverseGeocode(lat, lon) {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,{headers:{'Accept-Language':'en'}});
      const d = await r.json();
      const a = d.address||{};
      const name = a.neighbourhood||a.suburb||a.town||a.city_district||a.city||a.state||'Current Location';
      const el = document.getElementById('wx-location');
      if (el) el.textContent = 'Weather: '+ name + (a.city?', '+a.city:'');
    } catch(e) {}
  }

  /* ── SEARCH ── */
  function initSearch() {
    const btn=document.getElementById('map-search-btn'),
          box=document.getElementById('map-search-box'),
          input=document.getElementById('map-search-input'),
          sugg=document.getElementById('search-suggestions');
    if (!btn||!box||!input||!sugg) return;
    let _deb=null;
    btn.addEventListener('click', e => { e.stopPropagation(); box.classList.toggle('hidden'); if(!box.classList.contains('hidden')) input.focus(); });
    document.addEventListener('click', e => { if(!box.contains(e.target)&&e.target!==btn){box.classList.add('hidden');sugg.innerHTML='';sugg.classList.add('hidden');} });
    input.addEventListener('input', () => { clearTimeout(_deb); const q=input.value.trim(); if(q.length<2){sugg.innerHTML='';sugg.classList.add('hidden');return;} _deb=setTimeout(()=>_fetchSugg(q,sugg,input,box),320); });
    input.addEventListener('keydown', e => { if(e.key==='Escape'){box.classList.add('hidden');sugg.classList.add('hidden');} if(e.key==='Enter'){const f=sugg.querySelector('.suggestion-item');if(f)f.click();} });
  }

  async function _fetchSugg(query,sugg,input,box) {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=6&addressdetails=1`,{headers:{'Accept-Language':'en'}});
      const results = await r.json();
      if (!results.length) { sugg.innerHTML='<div style="padding:8px 12px;font-size:10px;color:#9ca3af;font-family:JetBrains Mono,monospace;">No results found</div>'; sugg.classList.remove('hidden'); return; }
      sugg.innerHTML = results.map(item => {
        const name = item.display_name.split(',').slice(0,3).join(', ');
        return `<div class="suggestion-item" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid #f3f4f6;font-family:JetBrains Mono,monospace;" data-lat="${item.lat}" data-lon="${item.lon}" data-name="${item.display_name}"
          onmouseover="this.style.background='#fff7ed'" onmouseout="this.style.background=''">
          <div style="font-size:11px;font-weight:600;color:#1C1410;line-height:1.4;">${name}</div>
          <div style="font-size:9px;color:#9ca3af;margin-top:2px;">${parseFloat(item.lat).toFixed(4)}, ${parseFloat(item.lon).toFixed(4)}</div>
        </div>`;
      }).join('');
      sugg.classList.remove('hidden');
      sugg.querySelectorAll('.suggestion-item').forEach(el => {
        el.addEventListener('click', () => {
          const lat=parseFloat(el.dataset.lat),lon=parseFloat(el.dataset.lon),name=el.dataset.name;
          if (_searchMarker) { _searchMarker.remove(); _searchMarker=null; }
          _searchMarker = L.marker([lat,lon],{icon:L.divIcon({className:'',iconAnchor:[12,28],
            html:'<div style="position:relative"><div style="width:24px;height:28px;background:#FF6B00;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3)"></div><div style="position:absolute;top:4px;left:4px;width:12px;height:12px;background:#fff;border-radius:50%"></div></div>'
          })}).addTo(_map);
          _map.setView([lat,lon],16,{animate:true});
          const wxLoc=document.getElementById('wx-location'); if(wxLoc) wxLoc.textContent='Weather: '+name.split(',').slice(0,2).join(', ');
          if(typeof window.fetchWeather==='function') window.fetchWeather(lat,lon);
          sugg.innerHTML=''; sugg.classList.add('hidden'); box.classList.add('hidden'); input.value='';
        });
      });
    } catch(e) { sugg.innerHTML='<div style="padding:8px 12px;font-size:10px;color:#f44336;font-family:JetBrains Mono,monospace;">Search unavailable</div>'; sugg.classList.remove('hidden'); }
  }

  /* ── FILTER — plain text buttons, no material-symbols ── */
  function initFilter() {
    const btn   = document.getElementById('map-filter-btn');
    const panel = document.getElementById('filter-panel');
    if (!btn||!panel) return;
    btn.addEventListener('click', e => { e.stopPropagation(); panel.classList.toggle('hidden'); });
    document.addEventListener('click', e => { if(!panel.contains(e.target)&&e.target!==btn) panel.classList.add('hidden'); });
    document.querySelectorAll('.filter-opt').forEach(opt => {
      opt.addEventListener('click', () => {
        document.querySelectorAll('.filter-opt').forEach(o => {
          o.style.color=''; o.style.background=''; o.style.fontWeight='';
        });
        opt.style.color='#FF6B00'; opt.style.background='#fff7ed'; opt.style.fontWeight='700';
        panel.classList.add('hidden');
        _currentFilter = opt.dataset.filter;
        _applyFilter(_currentFilter);
        // Update button label
        const labels={all:'All Events',top10:'Top 10',direct:'Direct',proximity:'Proximity'};
        btn.querySelector('span').textContent = labels[_currentFilter]||'Filter';
      });
    });
  }

  function _applyFilter(type) {
    _collLayers.forEach(l=>l.remove()); _collLayers=[];
    const stored = window._lastCollLog || [];
    let filtered = stored;
    if (type==='direct')    filtered = stored.filter(e=>e.type==='Direct');
    if (type==='proximity') filtered = stored.filter(e=>e.type==='Proximity');
    if (type==='top10')     filtered = [...stored].sort((a,b)=>(b.tick||0)-(a.tick||0)).slice(0,10);
    _plotDots(filtered);
  }

  /* ── PLOT COLLISIONS — coords remapped to IIT Bombay campus, same logic as airspace.js ── */
  function plotCollisions(events) {
    window._lastCollLog = events;
    _collLayers.forEach(l=>l.remove()); _collLayers=[];
    _applyFilter(_currentFilter);
  }

  // _plotDots(events)
  // Draws collision circles on the map.
  // Color: Direct=#f44336  Proximity=#ff9800  Near Miss=#3B82F6
  // Size:  Direct=radius 8  others=radius 5
  // Coordinates come from event.lat / event.lon (already WGS84 from API).
  // Events missing lat/lon are skipped silently — no fallback positioning.
  function _plotDots(events) {
    if (!_map) return;
    // Exact IIT Bombay campus bbox — matches airspace.js
    const IIT_SW_LAT=19.1270, IIT_SW_LON=72.9085;
    const IIT_NE_LAT=19.1430, IIT_NE_LON=72.9205;

    // Pre-compute source bounds from all events (for sim-grid remapping)
    const allLats = events.map(e=>parseFloat(e.lat)).filter(v=>!isNaN(v));
    const allLons = events.map(e=>parseFloat(e.lon)).filter(v=>!isNaN(v));
    const srcLatMin=allLats.length?Math.min(...allLats):0, srcLatMax=allLats.length?Math.max(...allLats):1;
    const srcLonMin=allLons.length?Math.min(...allLons):0, srcLonMax=allLons.length?Math.max(...allLons):1;

    let plotted = 0;
    events.forEach(e => {
      let lat = parseFloat(e.lat), lon = parseFloat(e.lon);
      if (isNaN(lat) || isNaN(lon)) return;

      // Same logic as airspace.js _toLatLon:
      // Already WGS84? (lat ~18-30, lon ~68-80) → use directly clamped to campus
      if (lat >= 18 && lat <= 30 && lon >= 68 && lon <= 80) {
        lat = Math.max(IIT_SW_LAT, Math.min(IIT_NE_LAT, lat));
        lon = Math.max(IIT_SW_LON, Math.min(IIT_NE_LON, lon));
      } else {
        // Simulation grid units → linear remap onto campus bbox
        const normLat = (srcLatMax > srcLatMin) ? (lat - srcLatMin) / (srcLatMax - srcLatMin) : 0.5;
        const normLon = (srcLonMax > srcLonMin) ? (lon - srcLonMin) / (srcLonMax - srcLonMin) : 0.5;
        lat = IIT_SW_LAT + normLat * (IIT_NE_LAT - IIT_SW_LAT);
        lon = IIT_SW_LON + normLon * (IIT_NE_LON - IIT_SW_LON);
      }

      const col = e.type==='Direct' ? '#f44336' : e.type==='Proximity' ? '#ff9800' : '#3B82F6';
      const radius = e.type==='Direct' ? 7 : 5;
      const mk = L.circleMarker([lat,lon], { radius, color:col, fillColor:col, fillOpacity:0.75, weight:1.5 });
      mk.bindTooltip(
        `<div style="background:#1E293B;color:#F8FAFC;border-radius:8px;padding:8px 12px;font-family:JetBrains Mono;font-size:10px;line-height:1.7;border:1px solid #334155;">
          <b>${e.type||'Event'}</b> · Tick ${e.tick||'?'}<br>
          ${e.veh_a||'?'} × ${e.veh_b||'?'} · Layer ${e.layer||'?'}
        </div>`, {sticky:true,className:'leaflet-tooltip-raw'}
      );
      mk.addTo(_map);
      _collLayers.push(mk);
      plotted++;
    });

    const countEl = document.getElementById('map-coll-count');
    if (countEl) countEl.textContent = plotted+' collision'+(plotted!==1?'s':'')+' shown';
  }

  function invalidate() {
    if (!_map) return;
    _map.invalidateSize({animate:false});
    setTimeout(()=>_map.invalidateSize({animate:false}),100);
    setTimeout(()=>_map.invalidateSize({animate:false}),300);
  }
  function getMap() { return _map; }
  return { init, initSearch, initFilter, plotCollisions, invalidate, getMap };
})();
window.UTMMap = UTMMap;
