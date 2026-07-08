/* ─────────────────────────────────────────────────────────────────────────────
   pages/intel.js  —  Multi-Trial Intelligence page.

   FILE ROLE:
     Renders the Intel page from the /multitrail_intel response.
     This page is unique: it compares ACROSS trials/path-runs, not within one.
     The Leaflet map here plots trial summary circles (not individual drones).
     The trial selector in the sidebar re-loads data for the selected trial only.

   API DATA CONSUMED:
     /api/multitrail_intel returns EXACTLY:
     trials: [{ trial, fleet, complete, comp_pct, collisions, coll_rate,
                 bat_used, efficiency, high_risk_drones }]
     n_trials: int
*/
const IntelPage = (() => {
  let _mapInited = false, _inMap = null;
  let _allTrials = [];
  let _mapLayers = {};
  let _colourMode = 'collision'; // 'collision' | 'completion' | 'highrisk'

  function render(data) {
    data = data || {};
    _allTrials = data.trials || [];
    _updateKPIs(_allTrials);
    _initMap(_allTrials);
    _renderThreatDonut(_allTrials);
    _renderSIGINTDonut(_allTrials);
    _renderTimeline(_allTrials);
    _renderSourcesHealth(_allTrials);
    _renderPOLHeatmap(_allTrials);
    _renderFeed(_allTrials);
    _wireMapFilters();
  }

  /* ── KPIs ── */
  function _updateKPIs(trials) {
    if (!trials.length) return;
    const totalFleet = trials.reduce((s,t) => s+t.fleet, 0);
    const avgComp    = (trials.reduce((s,t) => s+t.comp_pct,  0)/trials.length).toFixed(1);
    const avgColl    = (trials.reduce((s,t) => s+t.coll_rate, 0)/trials.length).toFixed(1);
    const highRisk   = trials.reduce((s,t) => s+(t.high_risk_drones||0), 0);
    const score      = Math.max(0, Math.round(100 - parseFloat(avgColl)));
    const scoreCol   = score > 80 ? '#046A38' : score > 60 ? '#ff9800' : '#f44336';
    _set('in-kpi-score',      score + '/100');
    _set('in-kpi-score-d',    score > 80 ? '↑ Good' : score > 60 ? '~ Moderate' : '↓ High Risk');
    _set('in-kpi-highrisk',   highRisk.toLocaleString());
    _set('in-kpi-highrisk-d', `across ${trials.length} trial(s)`);
    _set('in-kpi-trials',     trials.length.toString());
    _set('in-kpi-trials-d',   trials.map(t=>t.trial.split('_').pop()).join(', ').substring(0,20));
    _set('in-kpi-fleet',      totalFleet.toLocaleString());
    _set('in-kpi-fleet-d',    'drones analyzed');
    _set('in-kpi-conf',       avgComp + '%');
    _set('in-kpi-conf-d',     'avg completion');
    _set('in-kpi-updated',    new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}));
    _set('in-kpi-updated-d',  new Date().toLocaleDateString('en-IN',{day:'numeric',month:'short'}));
    const scoreEl = document.getElementById('in-kpi-score');
    if (scoreEl) scoreEl.style.color = scoreCol;
  }

  /* ── Map — trial circles placed WITHIN IIT Bombay campus bounds ──
     IIT campus bbox: SW [19.1270, 72.9085]  NE [19.1430, 72.9205]
     Spread circles across the campus area — max offset ~0.006° (~600m)
     so they stay visible on the campus satellite view               */
  function _initMap(trials, vehFilter) {
    vehFilter = vehFilter || 'all';
    const el = document.getElementById('in-leaflet-map'); if (!el) return;
    if (!_mapInited) {
      _mapInited = true;
      _inMap = L.map('in-leaflet-map', { center:[19.1350, 72.9145], zoom:14, zoomControl:false });
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { attribution:'Esri', maxZoom:19 }
      ).addTo(_inMap);
      L.marker([19.1334,72.9133],{icon:L.divIcon({className:'',iconAnchor:[44,8],
        html:'<div style="background:rgba(255,107,0,.9);color:#fff;padding:2px 8px;border-radius:4px;font-size:9px;font-weight:700;white-space:nowrap;font-family:JetBrains Mono,monospace">IIT BOMBAY · POWAI</div>'
      })}).addTo(_inMap);
    } else {
      setTimeout(() => _inMap.invalidateSize(), 100);
    }

    Object.values(_mapLayers).forEach(lg => { if (_inMap.hasLayer(lg)) _inMap.removeLayer(lg); });
    _mapLayers = { high:L.layerGroup(), medium:L.layerGroup(), low:L.layerGroup() };

    const CAMPUS_SPOTS = [
      [19.1334, 72.9133], [19.1380, 72.9165], [19.1290, 72.9170],
      [19.1310, 72.9105], [19.1360, 72.9110], [19.1400, 72.9145],
    ];
    // Vehicle type → multiplier: selected vehicle = full size, others = tiny
    const VEH_ORDER = ['Quad','Hexa','Vtol','Fixed_Wing','Octa'];
    const VEH_COL   = { Quad:'#046A38', Hexa:'#FF6B00', Vtol:'#f59e0b', Fixed_Wing:'#a855f7', Octa:'#3B82F6' };

    trials.forEach((t, i) => {
      const spot = CAMPUS_SPOTS[i % CAMPUS_SPOTS.length];
      const tier = t.coll_rate > 20 ? 'high' : t.coll_rate > 10 ? 'medium' : 'low';
      let col;
      if (_colourMode === 'completion') {
        col = t.comp_pct > 80 ? '#046A38' : t.comp_pct > 60 ? '#ff9800' : '#f44336';
      } else if (_colourMode === 'highrisk') {
        const hrPct = t.fleet > 0 ? (t.high_risk_drones||0) / t.fleet * 100 : 0;
        col = hrPct > 20 ? '#f44336' : hrPct > 10 ? '#ff9800' : '#3B82F6';
      } else {
        col = tier === 'high' ? '#f44336' : tier === 'medium' ? '#ff9800' : '#046A38';
      }
      const baseRadius = Math.max(60, Math.min(Math.round(t.fleet / 20), 300));

      if (vehFilter === 'all') {
        // Show one large circle per trial
        L.circle(spot, { radius:baseRadius, color:col, fillColor:col, fillOpacity:0.28, weight:1.5 })
          .bindTooltip(`<div style="font-family:JetBrains Mono,monospace;font-size:10px;line-height:1.8;background:#1E293B;padding:8px 12px;border-radius:8px;color:#F8FAFC;"><b>${t.trial}</b><br>Fleet: ${t.fleet.toLocaleString()}<br>Complete: ${t.comp_pct}%<br>Coll Rate: <span style="color:${col};font-weight:700">${t.coll_rate}%</span><br>High Risk: ${(t.high_risk_drones||0).toLocaleString()}</div>`,{sticky:true,className:'leaflet-tooltip-raw'})
          .addTo(_mapLayers[tier]);
        L.circleMarker(spot, { radius:6, color:'#fff', fillColor:col, fillOpacity:1, weight:2 })
          .bindPopup(`<b>${t.trial}</b><br>Coll Rate: ${t.coll_rate}% · Fleet: ${t.fleet.toLocaleString()}`)
          .addTo(_mapLayers[tier]);
      } else {
        // Show multiple smaller circles per trial — one per vehicle type
        // Selected vehicle: full colour & large; others: grey & tiny
        VEH_ORDER.forEach((veh, vi) => {
          const offset = [
            spot[0] + (vi - 2) * 0.0015,
            spot[1] + (Math.sin(vi * 1.2) * 0.001)
          ];
          const isSelected = veh === vehFilter;
          const vCol   = isSelected ? (VEH_COL[veh] || col) : '#cbd5e1';
          const vRad   = isSelected ? baseRadius * 0.9 : baseRadius * 0.18;
          const vOpac  = isSelected ? 0.45 : 0.15;
          const vWeight= isSelected ? 2 : 1;
          L.circle(offset, { radius:vRad, color:vCol, fillColor:vCol, fillOpacity:vOpac, weight:vWeight })
            .bindTooltip(`<div style="font-family:JetBrains Mono,monospace;font-size:10px;background:#1E293B;padding:6px 10px;border-radius:8px;color:#F8FAFC;"><b>${veh}</b> — ${t.trial}<br>Fleet share: ~${Math.round(t.fleet/5).toLocaleString()} drones</div>`,{sticky:true,className:'leaflet-tooltip-raw'})
            .addTo(_mapLayers[tier]);
          if (isSelected) {
            L.circleMarker(offset, { radius:5, color:'#fff', fillColor:vCol, fillOpacity:1, weight:2 })
              .addTo(_mapLayers[tier]);
          }
        });
      }
    });

    Object.values(_mapLayers).forEach(lg => lg.addTo(_inMap));
    const ts = document.getElementById('in-map-ts');
    if (ts) ts.textContent = 'Updated: ' + new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'}) + ' IST';
  }

  /* ── Map filter checkboxes + colour-mode radios + search ── */
  function _wireMapFilters() {
    // Vehicle-type toggle buttons — change which trial circles are shown + resize them
    document.querySelectorAll('#in-veh-btns .in-veh-btn').forEach(btn => {
      if (btn._wired) return; btn._wired = true;
      btn.addEventListener('click', () => {
        // Update active state styling
        document.querySelectorAll('#in-veh-btns .in-veh-btn').forEach(b => {
          b.classList.remove('active','bg-brand-accent','text-white','border-brand-accent');
          b.classList.add('bg-white','text-gray-600','border-gray-300');
        });
        btn.classList.add('active','bg-brand-accent','text-white','border-brand-accent');
        btn.classList.remove('bg-white','text-gray-600','border-gray-300');

        const veh = btn.dataset.veh;
        // Re-render map circles: selected vehicle gets large circles, others shrink to tiny
        Object.entries(_mapLayers).forEach(([tier, lg]) => {
          if (!_inMap) return;
          if (_inMap.hasLayer(lg)) _inMap.removeLayer(lg);
          lg.clearLayers();
          // Re-add markers with modified sizes based on vehicle filter
          const trial = _allTrials.find(t => {
            if (tier==='high') return t.coll_rate>20;
            if (tier==='medium') return t.coll_rate>10 && t.coll_rate<=20;
            return t.coll_rate<=10;
          });
          if (!trial) return;
          const baseR = _circleRadius(trial);
          const r = (veh==='all') ? baseR : baseR * 0.4;
          // Update radius for each marker in this layer
          lg.eachLayer(layer => { if (layer.setRadius) layer.setRadius(r * 1000); });
          _inMap.addLayer(lg);
        });
        // Re-init map to rebuild with proper sizes
        _colourMode = document.querySelector('input[name="in-colour-mode"]:checked')?.value || 'collision';
        _initMap(_allTrials, veh);
      });
    });

    // Colour-mode radios
    document.querySelectorAll('input[name="in-colour-mode"]').forEach(r => {
      if (r._wired) return; r._wired = true;
      r.addEventListener('change', () => {
        if (!_allTrials.length || !_inMap) return;
        _colourMode = r.value;
        const activeVeh = document.querySelector('#in-veh-btns .in-veh-btn.active')?.dataset.veh || 'all';
        _initMap(_allTrials, activeVeh);
        _wireMapFilters();
      });
    });

    // Search button
    const btn  = document.getElementById('in-search-btn');
    const box  = document.getElementById('in-search-box');
    const inp  = document.getElementById('in-search-input');
    const sugg = document.getElementById('in-search-suggestions');
    if (btn && box && inp && sugg && !btn._wired) {
      btn._wired = true;
      let _deb = null, _marker = null;
      btn.addEventListener('click', e => { e.stopPropagation(); box.classList.toggle('hidden'); if (!box.classList.contains('hidden')) inp.focus(); });
      document.addEventListener('click', e => { if (box && !box.contains(e.target) && e.target !== btn) { box.classList.add('hidden'); sugg.innerHTML=''; sugg.classList.add('hidden'); } });
      inp.addEventListener('input', () => {
        clearTimeout(_deb);
        const q = inp.value.trim();
        if (q.length < 2) { sugg.innerHTML=''; sugg.classList.add('hidden'); return; }
        _deb = setTimeout(async () => {
          try {
            const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&addressdetails=1`,{headers:{'Accept-Language':'en'}});
            const results = await res.json();
            if (!results.length) { sugg.innerHTML='<div style="padding:8px 12px;font-size:10px;color:#9ca3af;font-family:JetBrains Mono,monospace;">No results</div>'; sugg.classList.remove('hidden'); return; }
            sugg.innerHTML = results.map(item => {
              const name = item.display_name.split(',').slice(0,3).join(', ');
              return `<div class="suggestion-item" style="padding:8px 12px;cursor:pointer;font-family:JetBrains Mono,monospace;" data-lat="${item.lat}" data-lon="${item.lon}" onmouseover="this.style.background='#fff7ed'" onmouseout="this.style.background=''">
                <div style="font-size:11px;font-weight:600;color:#1C1410;">${name}</div>
                <div style="font-size:9px;color:#9ca3af;">${parseFloat(item.lat).toFixed(4)}, ${parseFloat(item.lon).toFixed(4)}</div>
              </div>`;
            }).join('');
            sugg.classList.remove('hidden');
            sugg.querySelectorAll('.suggestion-item').forEach(el => {
              el.addEventListener('click', () => {
                const lat=parseFloat(el.dataset.lat), lon=parseFloat(el.dataset.lon);
                if (_marker) { _marker.remove(); _marker=null; }
                _marker = L.marker([lat,lon],{icon:L.divIcon({className:'',iconAnchor:[12,28],html:'<div style="position:relative"><div style="width:24px;height:28px;background:#FF6B00;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3)"></div><div style="position:absolute;top:4px;left:4px;width:12px;height:12px;background:#fff;border-radius:50%"></div></div>'})}).addTo(_inMap);
                _inMap.setView([lat,lon],16,{animate:true});
                sugg.innerHTML=''; sugg.classList.add('hidden'); box.classList.add('hidden'); inp.value='';
              });
            });
          } catch(e) { sugg.innerHTML='<div style="padding:8px 12px;font-size:10px;color:#f44336;font-family:JetBrains Mono,monospace;">Search unavailable</div>'; sugg.classList.remove('hidden'); }
        }, 320);
      });
      inp.addEventListener('keydown', e => { if(e.key==='Escape'){box.classList.add('hidden');sugg.classList.add('hidden');} if(e.key==='Enter'){const f=sugg.querySelector('.suggestion-item');if(f)f.click();} });
    }
  }

  /* ── 1. Threat Donut → Collision Rate bar chart per trial (data-driven) ── */
  function _renderThreatDonut(trials) {
    const el = document.getElementById('in-threat-donut'); if (!el) return;
    if (typeof echarts !== 'undefined') { const old=echarts.getInstanceByDom(el); if(old) old.dispose(); }
    if (!trials.length) { el.innerHTML='<div style="font-size:11px;color:#9ca3af;text-align:center;padding-top:16px;">No data</div>'; return; }

    const totalCollisions = trials.reduce((s,t) => s+t.collisions, 0);
    const col = r => r > 20 ? '#f44336' : r > 10 ? '#ff9800' : '#046A38';

    el.style.cssText = 'display:flex;flex-direction:column;justify-content:space-evenly;height:100%;gap:4px;';
    el.innerHTML = trials.map(t => {
      const pct = Math.min(100, t.coll_rate).toFixed(1);
      const c = col(t.coll_rate);
      return `<div style="display:flex;flex-direction:column;gap:3px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;">
          <span style="font-family:'Space Grotesk',sans-serif;font-size:9px;font-weight:700;color:#374151;">${t.trial.replace('trial_','Trial ')}</span>
          <span style="font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;color:${c};">${pct}% crash</span>
        </div>
        <div style="height:9px;background:#f3f4f6;border-radius:4px;overflow:hidden;">
          <div style="width:${pct}%;height:100%;background:${c};border-radius:4px;transition:width 0.6s;"></div>
        </div>
        <div style="display:flex;gap:6px;font-family:'JetBrains Mono',monospace;font-size:7.5px;color:#9ca3af;">
          <span>${t.collisions.toLocaleString()} collisions</span>
          <span>·</span>
          <span>${t.comp_pct.toFixed(1)}% complete</span>
        </div>
      </div>`;
    }).join('') +
    `<div style="border-top:1px solid #E5DED4;padding-top:5px;display:flex;justify-content:space-between;">
      <span style="font-family:'Space Grotesk',sans-serif;font-size:8px;color:#9ca3af;font-weight:700;text-transform:uppercase;">Total Collisions</span>
      <span style="font-family:'Bebas Neue',sans-serif;font-size:18px;color:#1C1410;line-height:1;">${totalCollisions.toLocaleString()}</span>
    </div>`;
  }

  /* ── 2. SIGINT Donut → Fleet breakdown per trial with crash/completion stats ── */
  /* ── 2. SIGINT → per-trial fleet/completion/high-risk bars — fills full height ── */
  function _renderSIGINTDonut(trials) {
    const el = document.getElementById('in-sigint-donut'); if (!el) return;
    if (typeof echarts !== 'undefined') { const old=echarts.getInstanceByDom(el); if(old) old.dispose(); }
    if (!trials.length) { el.innerHTML='<div style="color:#9ca3af;font-size:11px;text-align:center;padding-top:16px;">No data</div>'; return; }
    const COLORS = ['#3B82F6','#046A38','#FF6B00','#a855f7','#f44336'];
    el.style.cssText = 'display:flex;flex-direction:column;justify-content:space-evenly;height:100%;gap:4px;';
    el.innerHTML = trials.map((t,i) => {
      const col = COLORS[i % COLORS.length];
      const hrPct = t.fleet > 0 ? ((t.high_risk_drones||0)/t.fleet*100).toFixed(0) : 0;
      const compPct = Math.min(100, t.comp_pct).toFixed(0);
      return `<div style="display:flex;flex-direction:column;gap:3px;padding:6px 8px;background:${col}0f;border:1px solid ${col}22;border-radius:7px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-family:'Space Grotesk',sans-serif;font-size:8.5px;font-weight:700;color:#374151;">${t.trial.replace('trial_','T')}</span>
          <span style="font-family:'Bebas Neue',sans-serif;font-size:18px;color:${col};line-height:1;">${t.fleet.toLocaleString()}</span>
        </div>
        <div style="height:7px;background:#e5e7eb;border-radius:3px;overflow:hidden;">
          <div style="width:${compPct}%;height:100%;background:${col};border-radius:3px;transition:width 0.5s;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-family:'JetBrains Mono',monospace;font-size:7px;">
          <span style="color:#046A38;">${compPct}% complete</span><span style="color:#f44336;">${hrPct}% high-risk</span>
        </div>
      </div>`;
    }).join('');
  }

  /* ── 3. Timeline → grouped bar: crash/complete/high-risk per trial/run — ECharts ── */
  function _renderTimeline(trials) {
    const el = document.getElementById('in-timeline'); if (!el) return;
    if (typeof echarts !== 'undefined') { const old=echarts.getInstanceByDom(el); if(old) old.dispose(); }
    if (!trials.length) { el.innerHTML='<div style="color:#9ca3af;font-size:11px;text-align:center;padding-top:16px;">No data</div>'; return; }
    const c = echarts.init(el);
    const names = trials.map(t => t.trial.replace('trial_','').replace('_run_','R'));
    const TT = { backgroundColor:'#1E293B',borderColor:'#334155',borderWidth:1,textStyle:{fontFamily:'JetBrains Mono',fontSize:9,color:'#F8FAFC'},extraCssText:'border-radius:8px;padding:8px 12px;' };
    c.setOption({
      backgroundColor:'transparent',
      tooltip:{ ...TT, trigger:'axis', axisPointer:{type:'shadow'} },
      legend:{ data:['Crash %','Complete %','High-Risk %'], bottom:0, itemWidth:8, itemHeight:8, textStyle:{fontFamily:'JetBrains Mono',fontSize:7.5,color:'#6b7280'} },
      grid:{ top:6, bottom:36, left:12, right:12, containLabel:true },
      xAxis:{ type:'category', data:names, axisLabel:{fontFamily:'JetBrains Mono',fontSize:8,color:'#374151'}, axisLine:{lineStyle:{color:'#E5DED4'}}, axisTick:{show:false} },
      yAxis:{ type:'value', max:100, min:0, axisLabel:{fontFamily:'JetBrains Mono',fontSize:8,color:'#9ca3af',formatter:v=>v+'%'}, splitLine:{lineStyle:{color:'rgba(229,222,212,0.4)',type:'dashed'}} },
      series:[
        { name:'Crash %',     type:'bar', data:trials.map(t=>+t.coll_rate.toFixed(1)), itemStyle:{color:'#f44336',borderRadius:[3,3,0,0]}, barMaxWidth:28 },
        { name:'Complete %',  type:'bar', data:trials.map(t=>+t.comp_pct.toFixed(1)),  itemStyle:{color:'#046A38',borderRadius:[3,3,0,0]}, barMaxWidth:28 },
        { name:'High-Risk %', type:'bar', data:trials.map(t=>t.fleet>0?+((t.high_risk_drones||0)/t.fleet*100).toFixed(1):0), itemStyle:{color:'#ff9800',borderRadius:[3,3,0,0]}, barMaxWidth:28 },
      ]
    });
    setTimeout(()=>c.resize(),100); setTimeout(()=>c.resize(),400);
    window.addEventListener('resize',()=>c.resize());
  }

    /* ── 4. Intel Sources Health — unchanged, already data-driven ── */
  function _renderSourcesHealth(trials) {
    const el = document.getElementById('in-sources-health'); if (!el) return;
    if (!trials.length) { el.innerHTML = '<div class="text-xs text-gray-400">No data</div>'; return; }
    const sorted = [...trials].sort((a,b) => b.comp_pct - a.comp_pct);
    el.innerHTML = sorted.map(t => {
      const col = t.comp_pct > 80 ? '#046A38' : t.comp_pct > 50 ? '#ff9800' : '#f44336';
      return `<div>
        <div class="flex justify-between mb-0.5">
          <span class="text-[9px] font-mono text-gray-600 truncate" style="max-width:140px;">${t.trial}</span>
          <span class="text-[9px] font-mono font-bold" style="color:${col}">${t.comp_pct.toFixed(1)}%</span>
        </div>
        <div style="height:5px;background:#f3f4f6;border-radius:2px;overflow:hidden;">
          <div style="width:${Math.min(100,t.comp_pct)}%;height:100%;background:${col};border-radius:2px;"></div>
        </div>
      </div>`;
    }).join('');
    const avgComp = trials.reduce((s,t)=>s+t.comp_pct,0)/trials.length;
    const relNote = el.closest('.glass-panel')?.querySelector('p.text-brand-success');
    if (relNote) {
      const status = avgComp > 80 ? 'Good' : avgComp > 60 ? 'Moderate' : 'Low';
      relNote.innerHTML = `<i class="fa-solid fa-circle text-[7px]"></i> Overall Source Reliability: <b>${status}</b> (avg ${avgComp.toFixed(1)}%)`;
    }
  }

  /* ── 5. Pattern of Life Heatmap ── */
  function _renderPOLHeatmap(trials) {
    const el = document.getElementById('in-pol-heatmap');
    if (!el || typeof echarts === 'undefined') return;
    let c = echarts.getInstanceByDom(el); if (c) c.dispose(); c = echarts.init(el);
    el.style.flex = '1';
    el.style.minHeight = '0';
    if (!trials.length) { el.innerHTML = '<div class="text-xs text-gray-400 text-center pt-8">No data</div>'; return; }
    const metrics = ['Complete %','Collision Rate','Bat Used','Efficiency','High Risk %'];
    const data = [];
    trials.forEach((t,ti) => {
      [t.comp_pct, t.coll_rate, t.bat_used, +((t.efficiency||0)*100).toFixed(1),
       t.fleet>0?+((t.high_risk_drones||0)/t.fleet*100).toFixed(1):0
      ].forEach((v,mi) => data.push([ti, mi, Math.round(v||0)]));
    });
    c.setOption({
      backgroundColor:'transparent',
      tooltip:{position:'top',formatter:p=>`${trials[p.data[0]]?.trial?.split('_').pop()}<br>${metrics[p.data[1]]}: <b>${p.data[2]}</b>`,backgroundColor:'#1E293B',borderColor:'#334155',borderWidth:1,textStyle:{fontFamily:'JetBrains Mono',fontSize:10,color:'#F8FAFC'},extraCssText:'border-radius:8px;padding:8px 12px;'},
      grid:{top:8,bottom:58,left:70,right:8},
      xAxis:{type:'category',data:trials.map(t=>t.trial.split('_').pop()||t.trial),axisLabel:{fontFamily:'JetBrains Mono',fontSize:8,color:'#374151',rotate:30},axisLine:{lineStyle:{color:'#E5DED4'}}},
      yAxis:{type:'category',data:metrics,axisLabel:{fontFamily:'JetBrains Mono',fontSize:8,color:'#6b7280'},axisLine:{lineStyle:{color:'#E5DED4'}}},
      visualMap:{min:0,max:100,show:true,orient:'horizontal',bottom:4,left:'center',itemHeight:80,itemWidth:10,text:['High','Low'],textStyle:{fontFamily:'JetBrains Mono',fontSize:7.5,color:'#6b7280'},inRange:{color:['#dcfce7','#fef9c3','#fca5a5','#ef4444']}},
      series:[{type:'heatmap',data,label:{show:true,formatter:p=>p.data[2],fontFamily:'JetBrains Mono',fontSize:8,color:'#374151'},itemStyle:{borderColor:'#FAF7F2',borderWidth:1,borderRadius:2}}]
    });
    window.addEventListener('resize', () => c.resize());
  }

  /* ── 6. Intelligence Feed ── */
  function _renderFeed(trials) {
    const el = document.getElementById('in-feed'); if (!el || !trials.length) return;
    const sorted  = [...trials].sort((a,b) => b.coll_rate - a.coll_rate);
    const worst   = sorted[0], best = sorted[sorted.length-1];
    const avgComp = (trials.reduce((s,t)=>s+t.comp_pct,0)/trials.length).toFixed(1);
    const totalHR = trials.reduce((s,t)=>s+(t.high_risk_drones||0),0);
    const totalFl = trials.reduce((s,t)=>s+t.fleet,0);
    el.innerHTML = [
      {dot:'#f44336',text:`Highest collision rate: ${worst?.trial} — ${worst?.coll_rate}%`},
      {dot:'#046A38',text:`Best completion: ${best?.trial} — ${best?.comp_pct}%`},
      {dot:'#3B82F6',text:`Avg completion across ${trials.length} trials: ${avgComp}%`},
      {dot:'#ff9800',text:`Total high-risk drones: ${totalHR.toLocaleString()}`},
      {dot:'#046A38',text:`Total fleet analyzed: ${totalFl.toLocaleString()}`},
    ].map(item=>`<div class="flex items-center gap-2 text-[9px]">
      <div style="width:8px;height:8px;border-radius:50%;background:${item.dot};flex-shrink:0;"></div>
      <span class="text-gray-700 flex-1 leading-tight">${item.text}</span>
    </div>`).join('');
  }

  function _set(id,val){const el=document.getElementById(id);if(el)el.textContent=val;}
  return { render };
})();
