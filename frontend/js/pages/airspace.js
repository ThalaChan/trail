/* pages/airspace.js  ── Airspace page for India UTM Command · IIT Bombay
   API: /api/trial/{tid}/spatial
     → { drones:[{id,x,y,layer,status,vehicle,bat_u}],
         conflicts:[{x,y,bx,by,type,layer,drone_a,drone_b,tick}] }

   ── Coordinate system ──────────────────────────────────────────────────────
   d.x = cx = coord_x = "Final Latitude"   (should be WGS84 lat ≈ 19.1xxx)
   d.y = cy = coord_y = "Final Longitude"  (should be WGS84 lon ≈ 72.9xxx)

   _toLatLon() detects whether values are already WGS84 (|x|≥18 && |y|≥70)
   and passes them through, OR linearly maps simulation-unit values onto the
   IIT Bombay campus bbox.  No Math.random() fallback ever used.

   ── Layer toggle wiring ─────────────────────────────────────────────────────
   Listeners are attached once in render() via _wireOnce().
   _refreshMarkers() is the single function that re-draws everything based on
   current checkbox + dropdown state — called immediately and on every change.

   ── Cluster logic ───────────────────────────────────────────────────────────
   When "Drone Clusters" checkbox is ON we create a fresh
   L.markerClusterGroup (if the plugin is loaded) and add it to the map.
   When it is OFF we destroy the cluster group and show individual markers.
   _grpClusters is rebuilt every _refreshMarkers() call so state is clean.
*/
const AirspacePage = (() => {

  /* ── IIT Bombay campus WGS84 bounding box ─────────────────────────────── */
  const IIT_SW  = [19.1270, 72.9085];  // south-west [lat, lon]
  const IIT_NE  = [19.1430, 72.9205];  // north-east [lat, lon]

  /* ── Coordinate transform ──────────────────────────────────────────────── */
  function _toLatLon(x, y, b) {
    // b = {minX,maxX,minY,maxY} — sim bounds, pre-computed from data
    if (x == null || y == null || isNaN(x) || isNaN(y)) return null;
    // Already WGS84 degrees?  lat in India ~18-28, lon ~70-78
    if (x >= 18 && x <= 30 && y >= 68 && y <= 80) return [x, y];
    // Simulation units → linear interpolation onto IIT Bombay bbox
    const rx = b.maxX - b.minX || 1;
    const ry = b.maxY - b.minY || 1;
    const lat = IIT_SW[0] + ((x - b.minX) / rx) * (IIT_NE[0] - IIT_SW[0]);
    const lon = IIT_SW[1] + ((y - b.minY) / ry) * (IIT_NE[1] - IIT_SW[1]);
    return [lat, lon];
  }

  function _computeBounds(drones, conflicts) {
    const xs = [
      ...drones.map(d => d.x),
      ...conflicts.map(c => c.x),
      ...conflicts.map(c => c.bx),
    ].filter(v => v != null && !isNaN(v));
    const ys = [
      ...drones.map(d => d.y),
      ...conflicts.map(c => c.y),
      ...conflicts.map(c => c.by),
    ].filter(v => v != null && !isNaN(v));
    if (!xs.length) return { minX:0, maxX:1, minY:0, maxY:1 };
    return {
      minX: Math.min(...xs), maxX: Math.max(...xs),
      minY: Math.min(...ys), maxY: Math.max(...ys),
    };
  }

  /* ── Dark tooltip presets ──────────────────────────────────────────────── */
  const TT = {
    backgroundColor:'#1E293B', borderColor:'#334155', borderWidth:1,
    padding:{top:8,right:12,bottom:8,left:12},
    titleColor:'#F8FAFC', bodyColor:'#CBD5E1',
    titleFont:{family:"'Space Grotesk',sans-serif", size:11, weight:'bold'},
    bodyFont:{family:"'JetBrains Mono',monospace", size:10},
    cornerRadius:8, displayColors:true, boxPadding:4,
  };
  const ETT = {
    backgroundColor:'#1E293B', borderColor:'#334155', borderWidth:1,
    textStyle:{ fontFamily:'JetBrains Mono', fontSize:10, color:'#F8FAFC' },
    extraCssText:'border-radius:8px;padding:8px 12px;box-shadow:0 4px 12px rgba(0,0,0,0.3);',
  };

  /* ── Module-level state ────────────────────────────────────────────────── */
  let _map           = null;
  let _mapInited     = false;
  let _bounds        = { minX:0, maxX:1, minY:0, maxY:1 };
  let _drones        = [];
  let _conflicts     = [];
  let _searchMarker  = null;
  let _searchTimer   = null;
  let _listenersSet  = false;   // wired once per page lifetime

  // LayerGroups — recreated each _refreshMarkers() except _map-level containers
  let _grpDrones     = null;   // individual markers  (added/removed from _map)
  let _grpClusters   = null;   // MarkerClusterGroup  (added/removed from _map)
  let _grpCollision  = null;
  let _grpNearMiss   = null;

  /* ── Entry point ───────────────────────────────────────────────────────── */
  function render(data) {
    _drones    = (data || {}).drones    || [];
    _conflicts = (data || {}).conflicts || [];
    _bounds    = _computeBounds(_drones, _conflicts);

    _updateKPIs();
    _initMap();          // creates map on first call; invalidates size on repeat
    _refreshMarkers();   // draw markers respecting current toggle/filter state
    _wireOnce();         // attach event listeners exactly once

    _renderStatusKPIs();
    _renderLayerBar();
    _renderVehicleTypeBar();
    _renderStatusDonut();
    _renderConflictByLayer();
    _renderDensityBar();
    _renderOccupancyGauge();
    _renderLayerOverTick();
  }

  /* ── KPI strip ─────────────────────────────────────────────────────────── */
  function _updateKPIs() {
    const N      = _drones.length;
    const crash  = _drones.filter(d => d.status && d.status.startsWith('Collision')).length;
    const layers = new Set(_drones.map(d => d.layer).filter(Boolean)).size;
    const vehs   = new Set(_drones.map(d => d.vehicle).filter(Boolean)).size;
    _set('as-kpi-vol',        N.toLocaleString());
    _set('as-kpi-zones',      layers + ' layers');
    _set('as-kpi-restricted', _conflicts.filter(c => c.type === 'Direct').length.toLocaleString());
    _set('as-kpi-reserv',     vehs + ' types');
    _set('as-kpi-util',       N > 0 ? ((N - crash) / N * 100).toFixed(1) + '%' : '—');
    _set('as-kpi-conflicts',  _conflicts.length.toLocaleString());
  }

  /* ── Map initialisation ────────────────────────────────────────────────── */
  function _initMap() {
    const el = document.getElementById('as-leaflet-map');
    if (!el) return;

    if (_mapInited) {
      // Map already exists — just fix size in case card resized
      setTimeout(() => _map && _map.invalidateSize({ animate: false }), 80);
      return;
    }
    _mapInited = true;

    _map = L.map('as-leaflet-map', {
      center: [19.1350, 72.9145],
      zoom: 15,
      zoomControl: false,
    });

    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: 'Esri', maxZoom: 19 }
    ).addTo(_map);

    // Campus label
    L.marker([19.1334, 72.9133], {
      icon: L.divIcon({
        className: '',
        iconAnchor: [44, 8],
        html: '<div style="background:rgba(255,107,0,.9);color:#fff;padding:2px 8px;border-radius:4px;font-size:9px;font-weight:700;white-space:nowrap;font-family:JetBrains Mono,monospace;box-shadow:0 2px 6px rgba(0,0,0,.3)">IIT BOMBAY · POWAI</div>',
      }),
    }).addTo(_map);

    // Powai Lake label
    L.marker([19.1210, 72.9060], {
      icon: L.divIcon({
        className: '',
        iconAnchor: [32, 8],
        html: '<div style="background:rgba(59,130,246,.88);color:#fff;padding:2px 7px;border-radius:4px;font-size:9px;font-weight:700;white-space:nowrap;font-family:JetBrains Mono,monospace">Powai Lake</div>',
      }),
    }).addTo(_map);

    // Create permanent layer containers (these stay on the map)
    _grpDrones    = L.layerGroup().addTo(_map);
    _grpCollision = L.layerGroup().addTo(_map);
    _grpNearMiss  = L.layerGroup().addTo(_map);
    // _grpClusters is built fresh in _refreshMarkers()

    // Zoom controls
    const zin = document.getElementById('as-zoom-in');
    const zout = document.getElementById('as-zoom-out');
    const fsb  = document.getElementById('as-fullscreen');
    if (zin)  zin.onclick  = () => _map.zoomIn();
    if (zout) zout.onclick = () => _map.zoomOut();
    if (fsb)  fsb.onclick  = () => {
      const w = document.getElementById('as-leaflet-wrap');
      if (w) (w.requestFullscreen || w.webkitRequestFullscreen || (() => {})).call(w);
    };

    _map.on('moveend', _updateTimestamp);
    _updateTimestamp();
  }

  function _updateTimestamp() {
    const ts = document.getElementById('as-map-timestamp');
    if (ts) ts.textContent = 'Updated: ' + new Date().toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }) + ' IST';
  }

  /* ── Wire controls once per page lifetime ─────────────────────────────── */
  function _wireOnce() {
    if (_listenersSet) return;
    _listenersSet = true;

    // Layer checkboxes — immediate effect
    ['as-lyr-drones', 'as-lyr-collisions', 'as-lyr-nearmiss', 'as-lyr-clusters'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', _refreshMarkers);
    });

    // Filter dropdowns — immediate effect
    ['as-filter-type', 'as-filter-status', 'as-filter-layer'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', _refreshMarkers);
    });

    // Search
    _initSearch();
  }

  /* ── Core: re-draw all markers with current toggle + filter state ─────── */
  function _refreshMarkers() {
    if (!_map) return;

    // Read current toggle state
    const showDrones    = (document.getElementById('as-lyr-drones')?.checked    ) !== false;
    const showCollision = (document.getElementById('as-lyr-collisions')?.checked ) !== false;
    const showNearMiss  = (document.getElementById('as-lyr-nearmiss')?.checked  ) !== false;
    const showClusters  = (document.getElementById('as-lyr-clusters')?.checked  ) === true;

    // Read current filter values
    const fVeh    = (document.getElementById('as-filter-type')?.value   || '').toLowerCase();
    const fStatus = document.getElementById('as-filter-status')?.value  || '';
    const fLayer  = document.getElementById('as-filter-layer')?.value   || '';

    /* ── 1. Clear individual layer groups ── */
    if (_grpDrones)    _grpDrones.clearLayers();
    if (_grpCollision) _grpCollision.clearLayers();
    if (_grpNearMiss)  _grpNearMiss.clearLayers();

    // Tear down old cluster group properly
    if (_grpClusters) {
      if (_map.hasLayer(_grpClusters)) _map.removeLayer(_grpClusters);
      _grpClusters = null;
    }

    /* ── 2. Show / hide layer groups based on toggles ── */
    if (!_grpDrones) _grpDrones = L.layerGroup();
    if (showDrones && !showClusters) {
      if (!_map.hasLayer(_grpDrones)) _map.addLayer(_grpDrones);
    } else {
      if (_map.hasLayer(_grpDrones)) _map.removeLayer(_grpDrones);
    }

    if (showCollision) {
      if (!_map.hasLayer(_grpCollision)) _map.addLayer(_grpCollision);
    } else {
      if (_map.hasLayer(_grpCollision)) _map.removeLayer(_grpCollision);
    }

    if (showNearMiss) {
      if (!_map.hasLayer(_grpNearMiss)) _map.addLayer(_grpNearMiss);
    } else {
      if (_map.hasLayer(_grpNearMiss)) _map.removeLayer(_grpNearMiss);
    }

    /* ── 3. Apply filters to drones ── */
    let filtered = _drones;
    if (fVeh)    filtered = filtered.filter(d => d.vehicle && d.vehicle.toLowerCase().includes(fVeh));
    if (fStatus) filtered = filtered.filter(d => d.status  && d.status.startsWith(fStatus));
    if (fLayer)  filtered = filtered.filter(d => String(d.layer) === fLayer);

    /* ── 4. Build marker objects ── */
    const VEH_COL = {
      quad: '#3B82F6', hexa: '#046A38', octa: '#FF6B00',
      vtol: '#a855f7', fixed_wing: '#f44336',
    };
    const LYR_COL = { '1':'#3B82F6', '2':'#046A38', '3':'#ff9800', '4':'#f44336' };

    // Build all Leaflet markers first (shared by both individual + cluster path)
    const markers = [];
    if (showDrones) {
      filtered.forEach(d => {
        const ll = _toLatLon(d.x, d.y, _bounds);
        if (!ll) return;
        const col = VEH_COL[d.vehicle?.toLowerCase()] || LYR_COL[String(d.layer)] || '#9ca3af';
        const popup = L.popup({ className:'as-popup', closeButton:false, maxWidth:200 })
          .setContent(`<div style="font-family:'JetBrains Mono',monospace;font-size:9px;line-height:1.7;background:#1E293B;padding:10px 12px;border-radius:8px;">
            <div style="font-weight:700;font-size:11px;color:#F8FAFC;margin-bottom:5px;">#${d.id}</div>
            <div style="color:#94A3B8;">Type: <span style="color:${col};font-weight:600;">${d.vehicle || '—'}</span></div>
            <div style="color:#94A3B8;">Layer: <span style="color:#F1F5F9;">L${d.layer || '—'}</span></div>
            <div style="color:#94A3B8;">Status: <span style="color:#F1F5F9;">${d.status || '—'}</span></div>
            <div style="color:#94A3B8;">Battery: <span style="color:#F1F5F9;">${d.bat_u != null ? d.bat_u.toFixed(1) + '% used' : '—'}</span></div>
            <div style="color:#475569;font-size:8px;margin-top:4px;">${ll[0].toFixed(5)}, ${ll[1].toFixed(5)}</div>
          </div>`);
        const mk = L.circleMarker(ll, {
          radius: 4, color: col, fillColor: col, fillOpacity: 0.82, weight: 1,
        }).bindPopup(popup);
        markers.push({ mk, ll, col });
      });
    }

    /* ── 5a. Individual markers path ── */
    if (!showClusters && showDrones) {
      markers.forEach(({ mk }) => mk.addTo(_grpDrones));
    }

    /* ── 5b. Cluster markers path ── */
    if (showDrones && showClusters) {
      if (typeof L.markerClusterGroup === 'function') {
        // Plugin available — use real clustering
        _grpClusters = L.markerClusterGroup({
          showCoverageOnHover: false,
          maxClusterRadius: 40,
          iconCreateFunction: cluster => L.divIcon({
            className: '',
            html: `<div style="background:#3B82F6;color:#fff;border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);">${cluster.getChildCount()}</div>`,
            iconSize: [30, 30], iconAnchor: [15, 15],
          }),
        });
        markers.forEach(({ mk }) => _grpClusters.addLayer(mk));
      } else {
        // No cluster plugin — grid-cell aggregation fallback
        const grid = {};
        markers.forEach(({ ll, col }) => {
          const key = `${(ll[0] * 200 | 0)},${(ll[1] * 200 | 0)}`;
          if (!grid[key]) grid[key] = { ll, col, n: 0 };
          grid[key].n++;
        });
        _grpClusters = L.layerGroup();
        Object.values(grid).forEach(({ ll, col, n }) => {
          const sz = Math.max(16, Math.min(36, n * 3 + 14));
          L.marker(ll, {
            icon: L.divIcon({
              className: '',
              html: `<div style="background:${col};color:#fff;border-radius:50%;width:${sz}px;height:${sz}px;display:flex;align-items:center;justify-content:center;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);">${n}</div>`,
              iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2],
            }),
          }).addTo(_grpClusters);
        });
      }
      _map.addLayer(_grpClusters);
    }

    /* ── 6. Collision markers ── */
    _conflicts
      .filter(c => c.type !== 'Near Miss' && c.x != null && c.y != null)
      .forEach(c => {
        const ll = _toLatLon(c.x, c.y, _bounds);
        if (!ll) return;
        const col = c.type === 'Direct' ? '#f44336' : '#FF6B00';
        const popup = L.popup({ className:'as-popup', closeButton:false, maxWidth:200 })
          .setContent(`<div style="font-family:'JetBrains Mono',monospace;font-size:9px;line-height:1.7;background:#1E293B;padding:10px 12px;border-radius:8px;">
            <div style="font-weight:700;font-size:11px;color:#EF4444;margin-bottom:5px;">${c.type} Collision</div>
            <div style="color:#94A3B8;">Drones: <span style="color:#F1F5F9;">#${c.drone_a} vs #${c.drone_b}</span></div>
            <div style="color:#94A3B8;">Tick: <span style="color:#F1F5F9;">${c.tick || '—'}</span></div>
            <div style="color:#94A3B8;">Layer: <span style="color:#F1F5F9;">L${c.layer || '—'}</span></div>
          </div>`);
        L.circleMarker(ll, { radius:7, color:col, fillColor:col, fillOpacity:0.55, weight:2 })
          .bindPopup(popup).addTo(_grpCollision);
      });

    /* ── 7. Near-miss markers ── */
    _conflicts
      .filter(c => c.type === 'Near Miss' && c.x != null && c.y != null)
      .forEach(c => {
        const ll = _toLatLon(c.x, c.y, _bounds);
        if (!ll) return;
        const popup = L.popup({ className:'as-popup', closeButton:false, maxWidth:200 })
          .setContent(`<div style="font-family:'JetBrains Mono',monospace;font-size:9px;line-height:1.7;background:#1E293B;padding:10px 12px;border-radius:8px;">
            <div style="font-weight:700;font-size:11px;color:#F59E0B;margin-bottom:5px;">Near Miss</div>
            <div style="color:#94A3B8;">Drones: <span style="color:#F1F5F9;">#${c.drone_a} vs #${c.drone_b}</span></div>
            <div style="color:#94A3B8;">Tick: <span style="color:#F1F5F9;">${c.tick || '—'}</span></div>
          </div>`);
        L.circleMarker(ll, {
          radius: 5, color:'#F59E0B', fillColor:'#F59E0B',
          fillOpacity: 0.55, weight: 1.5, dashArray:'4,2',
        }).bindPopup(popup).addTo(_grpNearMiss);
      });

    _updateTimestamp();
  }

  /* ── Search — same provider, same styling as Overview ─────────────────── */
  function _initSearch() {
    const btn  = document.getElementById('as-search-btn');
    const box  = document.getElementById('as-search-box');
    const inp  = document.getElementById('as-search-input');
    const sugg = document.getElementById('as-search-suggestions');
    if (!btn || !box || !inp || !sugg) return;

    btn.addEventListener('click', e => {
      e.stopPropagation();
      box.classList.toggle('hidden');
      if (!box.classList.contains('hidden')) inp.focus();
    });

    document.addEventListener('click', e => {
      if (!box.contains(e.target) && e.target !== btn) {
        box.classList.add('hidden');
        sugg.innerHTML = ''; sugg.classList.add('hidden');
      }
    });

    inp.addEventListener('input', () => {
      clearTimeout(_searchTimer);
      const q = inp.value.trim();
      if (q.length < 2) { sugg.innerHTML = ''; sugg.classList.add('hidden'); return; }
      _searchTimer = setTimeout(() => _doSearch(q, sugg, inp, box), 320);
    });

    inp.addEventListener('keydown', e => {
      if (e.key === 'Escape') { box.classList.add('hidden'); sugg.classList.add('hidden'); return; }
      if (e.key === 'Enter') { const first = sugg.querySelector('.as-si'); if (first) first.click(); }
    });
  }

  async function _doSearch(query, sugg, inp, box) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=6&viewbox=72.88,19.08,72.95,19.18&bounded=0&addressdetails=1`;
      const r = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      const results = await r.json();

      if (!results.length) {
        sugg.innerHTML = '<div class="px-3 py-2 text-[10px] text-gray-400 font-mono">No results found</div>';
        sugg.classList.remove('hidden'); return;
      }

      sugg.innerHTML = results.map(item => {
        const name = item.display_name.split(',').slice(0, 3).join(', ');
        const type = item.type || item.class || '';
        return `<div class="as-si px-3 py-2 hover:bg-orange-50 cursor-pointer border-b border-gray-100 last:border-0"
          data-lat="${item.lat}" data-lon="${item.lon}">
          <div class="text-[11px] font-medium text-gray-800 leading-tight">${name}</div>
          <div class="text-[9px] text-gray-400 font-mono mt-0.5">${type} · ${parseFloat(item.lat).toFixed(4)}, ${parseFloat(item.lon).toFixed(4)}</div>
        </div>`;
      }).join('');
      sugg.classList.remove('hidden');

      sugg.querySelectorAll('.as-si').forEach(el => {
        el.addEventListener('click', () => {
          const lat = parseFloat(el.dataset.lat);
          const lon = parseFloat(el.dataset.lon);
          if (_searchMarker) { _searchMarker.remove(); _searchMarker = null; }
          _searchMarker = L.marker([lat, lon], {
            icon: L.divIcon({
              className: '',
              iconAnchor: [12, 28],
              html: `<div style="position:relative">
                <div style="width:24px;height:28px;background:#FF6B00;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3)"></div>
                <div style="position:absolute;top:4px;left:4px;width:12px;height:12px;background:#fff;border-radius:50%"></div>
              </div>`,
            }),
          }).addTo(_map);
          _map.setView([lat, lon], 16, { animate: true });
          sugg.innerHTML = ''; sugg.classList.add('hidden');
          box.classList.add('hidden'); inp.value = '';
          // Preserve all existing drone/collision markers — _refreshMarkers not called
        });
      });
    } catch (_) {
      sugg.innerHTML = '<div class="px-3 py-2 text-[10px] text-red-400 font-mono">Search unavailable</div>';
      sugg.classList.remove('hidden');
    }
  }

  /* ── Chart: Drone Distribution by Altitude Layer ───────────────────────── */
  function _renderLayerBar() {
    const el = document.getElementById('as-structure');
    if (!el || typeof echarts === 'undefined') return;
    let c = echarts.getInstanceByDom(el); if (c) c.dispose(); c = echarts.init(el);
    const cnt = { 1:0, 2:0, 3:0, 4:0 };
    _drones.forEach(d => { if (d.layer && cnt[d.layer] !== undefined) cnt[d.layer]++; });
    const vals = [cnt[1], cnt[2], cnt[3], cnt[4]];
    if (!vals.some(v => v > 0)) { el.innerHTML = '<div class="text-xs text-gray-400 text-center pt-8">No layer data</div>'; return; }
    c.setOption({
      backgroundColor: 'transparent',
      tooltip: { trigger:'axis', axisPointer:{ type:'shadow' }, ...ETT },
      grid: { top:8, bottom:36, left:72, right:40 },
      xAxis: { type:'value', axisLabel:{ fontFamily:'JetBrains Mono', fontSize:8, color:'#6b7280' }, splitLine:{ lineStyle:{ color:'rgba(229,222,212,0.4)', type:'dashed' } } },
      yAxis: { type:'category', data:['L1 (0m)','L2 (50m)','L3 (100m)','L4 (150m)'], inverse:true, axisLabel:{ fontFamily:'Space Grotesk', fontSize:9, color:'#374151' }, axisLine:{ lineStyle:{ color:'#E5DED4' } } },
      series: [{ type:'bar', data: vals.map((v,i) => ({ value:v, itemStyle:{ color:['#3B82F6','#046A38','#ff9800','#f44336'][i] } })), barMaxWidth:22, borderRadius:[0,3,3,0], label:{ show:true, position:'right', formatter:'{c}', fontFamily:'JetBrains Mono', fontSize:9, color:'#374151' } }],
    });
    window.addEventListener('resize', () => c.resize());
  }

  /* ── Real KPIs for Airspace Status LEFT panel ─────────────────────────── */
  function _renderStatusKPIs() {
    const total     = _drones.length || 1;
    const complete  = _drones.filter(d => d.status && d.status.startsWith('Complete')).length;
    const collision = _drones.filter(d => d.status && d.status.startsWith('Collision')).length;
    const battery   = _drones.filter(d => d.status && d.status.startsWith('Incomplete')).length;
    const cancelled = _drones.filter(d => d.status && d.status.startsWith('Cancelled')).length;
    _set('as-stat-complete',  complete.toLocaleString());
    _set('as-stat-collision', collision.toLocaleString());
    _set('as-stat-battery',   battery.toLocaleString());
    _set('as-stat-cancelled', cancelled.toLocaleString());
  }

  /* ── Chart: Drone Count by Type — horizontal bar in right panel ─────── */
  function _renderVehicleTypeBar() {
    const el = document.getElementById('as-status-gauge');
    if (!el || typeof echarts === 'undefined') return;
    let c = echarts.getInstanceByDom(el); if (c) c.dispose(); c = echarts.init(el);
    const cnt = {};
    _drones.forEach(d => { if (d.vehicle) cnt[d.vehicle] = (cnt[d.vehicle] || 0) + 1; });
    const sorted = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
    if (!sorted.length) { el.innerHTML = '<div class="text-xs text-gray-400 text-center pt-4">No vehicle data</div>'; return; }
    const COLORS = ['#3B82F6','#046A38','#FF6B00','#f44336','#a855f7'];
    // Horizontal bars so labels are readable in the narrow right panel
    c.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis', axisPointer: { type:'shadow' }, ...ETT,
        formatter: p => `<b style="color:#F8FAFC">${p[0].name}</b><br><span style="color:#CBD5E1">${p[0].value} drones</span>`,
      },
      grid: { top:4, bottom:4, left:64, right:36, containLabel:false },
      xAxis: {
        type: 'value',
        axisLabel: { show:false },
        axisLine: { show:false }, splitLine:{ show:false },
      },
      yAxis: {
        type: 'category', data: sorted.map(([k]) => k), inverse:true,
        axisLabel: { fontFamily:'JetBrains Mono', fontSize:8, color:'#374151' },
        axisLine: { show:false }, axisTick: { show:false },
      },
      series: [{
        type: 'bar',
        data: sorted.map(([, v], i) => ({ value:v, itemStyle:{ color:COLORS[i % COLORS.length], borderRadius:[0,3,3,0] } })),
        barMaxWidth: 14,
        label: { show:true, position:'right', formatter:'{c}', fontFamily:'JetBrains Mono', fontSize:9, color:'#374151' },
      }],
    });
    window.addEventListener('resize', () => c.resize());
  }

  /* ── Chart: Flight Status — as-sector-donut ────────────────────────────────
     Pure HTML progress bars — fills the full flex-1 container, zero dead space */
  function _renderStatusDonut() {
    const el = document.getElementById('as-sector-donut');
    if (!el) return;
    // Dispose any lingering ECharts instance
    if (typeof echarts !== 'undefined') { const old = echarts.getInstanceByDom(el); if (old) old.dispose(); }

    const map = {};
    _drones.forEach(d => {
      const k = d.status
        ? d.status.startsWith('Complete') ? 'Complete'
        : d.status.startsWith('Collision') ? 'Collision'
        : d.status.startsWith('Incomplete') ? 'Battery Fail'
        : d.status.startsWith('Cancelled') ? 'Cancelled' : 'Other' : 'Other';
      map[k] = (map[k] || 0) + 1;
    });
    const COL = { Complete:'#046A38', Collision:'#f44336', 'Battery Fail':'#ff9800', Cancelled:'#9ca3af', Other:'#3B82F6' };
    const ORDER = ['Complete','Collision','Battery Fail','Cancelled','Other'];
    const items = ORDER.map(k => ({ name:k, value:map[k]||0, color:COL[k] })).filter(it => it.value > 0);
    if (!items.length) { el.innerHTML = '<div style="font-size:11px;color:#9ca3af;text-align:center;padding-top:16px;">No data</div>'; return; }
    const total = items.reduce((s,it) => s+it.value, 0);

    el.style.cssText = 'display:flex;flex-direction:column;justify-content:space-evenly;padding:4px 0;';
    el.innerHTML = items.map(it => {
      const pct = (it.value/total*100).toFixed(1);
      return `<div style="display:flex;flex-direction:column;gap:3px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;">
          <span style="font-family:'Space Grotesk',sans-serif;font-size:9px;font-weight:600;color:#374151;">${it.name}</span>
          <span style="font-family:'JetBrains Mono',monospace;font-size:9px;color:${it.color};font-weight:700;">${it.value.toLocaleString()} <span style="color:#9ca3af;font-size:8px;">${pct}%</span></span>
        </div>
        <div style="height:10px;background:#f3f4f6;border-radius:5px;overflow:hidden;">
          <div style="width:${pct}%;height:100%;background:${it.color};border-radius:5px;transition:width 0.6s ease;"></div>
        </div>
      </div>`;
    }).join('') +
    `<div style="border-top:1px solid #E5DED4;padding-top:6px;display:flex;justify-content:space-between;">
      <span style="font-family:'Space Grotesk',sans-serif;font-size:9px;font-weight:700;color:#374151;">TOTAL</span>
      <span style="font-family:'Bebas Neue',sans-serif;font-size:16px;color:#1C1410;line-height:1;">${total.toLocaleString()}</span>
    </div>`;
  }

  /* ── Chart: Collisions by altitude layer ───────────────────────────────── */
  function _renderConflictByLayer() {
    const el = document.getElementById('as-conflicts-chart');
    if (!el) return;
    el.innerHTML = '<canvas id="as-conf-c" style="width:100%;height:100%;"></canvas>';
    const cv = document.getElementById('as-conf-c'); if (!cv) return;
    const byL = { 1:{Direct:0,Proximity:0,'Near Miss':0}, 2:{Direct:0,Proximity:0,'Near Miss':0}, 3:{Direct:0,Proximity:0,'Near Miss':0}, 4:{Direct:0,Proximity:0,'Near Miss':0} };
    _conflicts.forEach(cf => {
      const l = cf.layer;
      if (l && byL[l] && cf.type && byL[l][cf.type] !== undefined) byL[l][cf.type]++;
    });
    new Chart(cv.getContext('2d'), {
      type: 'bar',
      data: {
        labels: ['L1 (0m)', 'L2 (50m)', 'L3 (100m)', 'L4 (150m)'],
        datasets: [
          { label:'Direct',    data:[1,2,3,4].map(l => byL[l].Direct),      backgroundColor:'rgba(244,67,54,0.75)',  borderRadius:3 },
          { label:'Proximity', data:[1,2,3,4].map(l => byL[l].Proximity),   backgroundColor:'rgba(255,152,0,0.75)',  borderRadius:3 },
          { label:'Near Miss', data:[1,2,3,4].map(l => byL[l]['Near Miss']), backgroundColor:'rgba(59,130,246,0.75)', borderRadius:3 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode:'index', intersect:false },
        plugins: { legend:{ display:true, position:'bottom', labels:{ boxWidth:10, font:{ size:9, family:"'JetBrains Mono',monospace" }, color:'#6b7280' } }, tooltip:{ ...TT } },
        scales: {
          x: { stacked:true, grid:{ display:false }, ticks:{ font:{ family:"'JetBrains Mono',monospace", size:9 }, color:'#374151' } },
          y: { stacked:true, grid:{ color:'rgba(229,222,212,0.5)', borderDash:[3,3] }, ticks:{ font:{ family:"'JetBrains Mono',monospace", size:8 }, color:'#9ca3af' } },
        },
        layout: { padding:{ top:8, bottom:4 } },
      },
    });
  }

  /* ── Chart: Drone Density by Grid Area — horizontal bar ─────────────────  */
  function _renderDensityBar() {
    const el = document.getElementById('as-heatmap');
    if (!el || typeof echarts === 'undefined') return;
    let c = echarts.getInstanceByDom(el); if (c) c.dispose(); c = echarts.init(el);
    const valid = _drones.filter(d => d.x != null && d.y != null);
    if (!valid.length) { el.innerHTML = '<div class="text-xs text-gray-400 text-center pt-8">No position data</div>'; return; }
    const xs = valid.map(d => d.x), ys = valid.map(d => d.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const COLS = 4, ROWS = 4, grid = {};
    valid.forEach(d => {
      const ci = Math.min(Math.floor((d.x - minX) / (maxX - minX + 1e-9) * COLS), COLS - 1);
      const ri = Math.min(Math.floor((d.y - minY) / (maxY - minY + 1e-9) * ROWS), ROWS - 1);
      const key = `${String.fromCharCode(65 + ri)}${ci + 1}`;
      grid[key] = (grid[key] || 0) + 1;
    });
    const sorted = Object.entries(grid).sort((a, b) => b[1] - a[1]);
    const maxV = sorted[0]?.[1] || 1;
    c.setOption({
      backgroundColor: 'transparent',
      tooltip: { trigger:'axis', axisPointer:{ type:'shadow' }, ...ETT, formatter: p => `<b style="color:#F8FAFC">Grid ${p[0].name}</b><br><span style="color:#CBD5E1">${p[0].value} drones</span>` },
      grid: { top:8, bottom:28, left:36, right:40 },
      xAxis: { type:'value', axisLabel:{ fontFamily:'JetBrains Mono', fontSize:8, color:'#6b7280' }, splitLine:{ lineStyle:{ color:'rgba(229,222,212,0.4)', type:'dashed' } }, name:'Drones', nameTextStyle:{ fontFamily:'JetBrains Mono', fontSize:8, color:'#9ca3af' } },
      yAxis: { type:'category', data: sorted.map(([k]) => k), inverse:true, axisLabel:{ fontFamily:'JetBrains Mono', fontSize:9, color:'#374151', fontWeight:'bold' }, axisLine:{ lineStyle:{ color:'#E5DED4' } } },
      series: [{ type:'bar', data: sorted.map(([, v]) => ({ value:v, itemStyle:{ color: v > maxV * .75 ? '#f44336' : v > maxV * .5 ? '#FF6B00' : v > maxV * .25 ? '#ff9800' : '#046A38' } })), barMaxWidth:18, borderRadius:[0,3,3,0], label:{ show:true, position:'right', formatter:'{c}', fontFamily:'JetBrains Mono', fontSize:9, color:'#374151' } }],
    });
    window.addEventListener('resize', () => c.resize());
  }

  /* ── Chart: Fleet Occupancy Gauge ─────────────────────────────────────── */
  function _renderOccupancyGauge() {
    const el = document.getElementById('as-capacity-chart');
    if (!el || typeof echarts === 'undefined') return;
    let c = echarts.getInstanceByDom(el); if (c) c.dispose(); c = echarts.init(el);
    const total     = _drones.length;
    const crashFree = _drones.filter(d => d.status && !d.status.startsWith('Collision')).length;
    const pct       = total > 0 ? +(crashFree / total * 100).toFixed(1) : 0;
    const color     = pct > 80 ? '#046A38' : pct > 60 ? '#ff9800' : '#f44336';
    _set('as-occ-active', crashFree.toLocaleString());
    _set('as-occ-total',  total.toLocaleString());
    _set('as-occ-pct',    pct + '%');
    c.setOption({
      backgroundColor: 'transparent', tooltip: { show: false },
      series: [{ type:'gauge', startAngle:200, endAngle:-20, radius:'90%', center:['50%','60%'], min:0, max:100, splitNumber:0,
        axisLine: { lineStyle:{ width:14, color:[[0.6,'#f44336'],[0.8,'#ff9800'],[1,'#046A38']] } },
        pointer: { length:'62%', width:4, itemStyle:{ color } },
        axisTick:{ show:false }, splitLine:{ show:false }, axisLabel:{ show:false },
        detail: { offsetCenter:[0,'-10%'], rich:{ pct:{ fontFamily:'Bebas Neue', fontSize:26, color:'#1C1410', lineHeight:28 }, lbl:{ fontFamily:'Space Grotesk', fontSize:9, color:'#6b7280', lineHeight:13 } }, formatter: () => `{pct|${pct}%}\n{lbl|Active / Total}` },
        data: [{ value: pct }],
      }],
    });
    window.addEventListener('resize', () => c.resize());
  }

  /* ── Chart: Layer activity / collision ticks ──────────────────────────── */
  function _renderLayerOverTick() {
    const el = document.getElementById('as-util-chart');
    if (!el) return;
    el.innerHTML = '<canvas id="as-lyr-c" style="width:100%;height:100%;"></canvas>';
    const cv = document.getElementById('as-lyr-c'); if (!cv) return;
    const ticks = [...new Set(_conflicts.map(cf => cf.tick).filter(Boolean))].sort((a,b) => a - b);

    if (!ticks.length || ticks.length < 2) {
      // No tick data — show layer count bar instead
      const cnt = { 1:0, 2:0, 3:0, 4:0 };
      _drones.forEach(d => { if (d.layer && cnt[d.layer] !== undefined) cnt[d.layer]++; });
      new Chart(cv.getContext('2d'), {
        type: 'bar',
        data: { labels:['L1 (0m)','L2 (50m)','L3 (100m)','L4 (150m)'], datasets:[{ label:'Drones', data:[cnt[1],cnt[2],cnt[3],cnt[4]], backgroundColor:['rgba(59,130,246,0.7)','rgba(4,106,56,0.7)','rgba(255,152,0,0.7)','rgba(244,67,54,0.7)'], borderRadius:3 }] },
        options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false }, tooltip:{ ...TT } }, scales:{ x:{ grid:{ display:false }, ticks:{ font:{ family:"'JetBrains Mono',monospace", size:9 }, color:'#374151' } }, y:{ grid:{ color:'rgba(229,222,212,0.5)', borderDash:[3,3] }, ticks:{ font:{ family:"'JetBrains Mono',monospace", size:8 }, color:'#9ca3af' }, title:{ display:true, text:'Drone Count', font:{ size:8 }, color:'#9ca3af' } } }, layout:{ padding:{ top:8, bottom:4 } } },
      });
      return;
    }

    const step = Math.max(1, Math.floor(ticks.length / 50));
    const xs = ticks.filter((_, i) => i % step === 0);
    const tickCnt = {};
    _conflicts.forEach(cf => { if (cf.tick) tickCnt[cf.tick] = (tickCnt[cf.tick] || 0) + 1; });
    new Chart(cv.getContext('2d'), {
      type: 'line',
      data: { labels: xs, datasets:[{ label:'Collision Events', data: xs.map(t => tickCnt[t] || 0), borderColor:'#f44336', borderWidth:2, backgroundColor:'rgba(244,67,54,0.08)', fill:true, tension:0.4, pointRadius:0 }] },
      options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false }, tooltip:{ ...TT, callbacks:{ title:([ctx]) => `Tick ${ctx.label}`, label: ctx => ` Events: ${ctx.raw}` } } }, scales:{ x:{ grid:{ display:false }, ticks:{ font:{ family:"'JetBrains Mono',monospace", size:8 }, color:'#9ca3af', maxTicksLimit:8 }, title:{ display:true, text:'Simulation Tick', font:{ size:8 }, color:'#9ca3af' } }, y:{ grid:{ color:'rgba(229,222,212,0.5)', borderDash:[3,3] }, ticks:{ font:{ family:"'JetBrains Mono',monospace", size:8 }, color:'#9ca3af' }, min:0 } }, layout:{ padding:{ top:8, bottom:4 } } },
    });
  }

  function _set(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
  return { render };
})();
