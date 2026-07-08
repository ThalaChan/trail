/* ─────────────────────────────────────────────────────────────────────────────
   pages/fleet.js  —  Fleet Analytics page.

   FILE ROLE:
     Renders all Fleet page charts from the /fleet API response.
     Handles battery KDE curves (ECharts line), vehicle donut, status
     funnel bar, bat-reserve-per-layer bar, and distance vs bat scatter.

   API DATA CONSUMED:
     /api/trial/{tid}/fleet returns EXACTLY:
     kpis:            { N, n_ok, n_crash, n_batt, n_canc, comp_pct, crash_pct, collision_free_pct, avg_bat_used, avg_da }
     fleet_funnel:    { total, complete, coll_direct, coll_prox, batt_fail, canc_inflight, canc_preflight }
     bat_kde:         { start:{x,y}, consumed:{x,y}, end:{x,y} }
     bat_kde_by_status: [{ status, x:[], y:[] }]
     bat_drain_points:  [{ da, bat_u, vehicle, status }]
     bat_reserve_layer: [{ layer, bat_e, flight_status }]
     vehicle_perf:    [{ vehicle, total, complete, crash, battery, cancelled, comp_pct, crash_pct,
                         bat_avg, bat_reserve, avg_distance, collision_events, coll_rate }]
     vehicle_crash_layer: [{ vehicle, layer, label, total, crash, crash_pct }]
*/
const FleetPage = (() => {
  let _batChart = null, _kdeChart = null;

  function render(data) {
    data = data || {};
    const k    = data.kpis               || {};
    const ff   = data.fleet_funnel       || {};
    const vp   = data.vehicle_perf       || [];
    const bk   = data.bat_kde            || {};
    const bkbs = data.bat_kde_by_status  || [];
    const dpts = data.bat_drain_points   || [];
    const brl  = data.bat_reserve_layer  || [];

    _updateKPIs(k, ff);
    _renderStatusBar(ff, vp);     // fl-sankey
    _renderBatKDE(bk);            // fl-util-heatmap
    _renderVehicleDonut(vp);      // fl-network
    _renderVehicleDistBar(vp);    // fl-mission-donut
    _renderBatKDEByStatus(bkbs);  // fl-battery-forecast
    _renderBatReserveLayer(brl);  // fl-radar
    _renderDrainScatter(dpts);    // fl-stress-spark
    _renderAvailGauge(k, ff);     // fl-avail-gauge
    _renderMaintBars(ff);         // fl-maint-bars
  }

  /* ── KPIs ── */
  function _updateKPIs(k, ff) {
    _set('fl-kpi-total',   (k.N||0).toLocaleString());
    _set('fl-kpi-active',  (k.n_ok||0).toLocaleString());
    _set('fl-kpi-ready',   (ff.complete||0).toLocaleString());
    _set('fl-kpi-avail',   k.N ? (k.collision_free_pct||0).toFixed(1)+'%' : '—');
    _set('fl-s-reg',       (k.N||0).toLocaleString());
    _set('fl-s-cert',      (k.N||0).toLocaleString());
    _set('fl-s-ready',     (ff.complete||0).toLocaleString());
    _set('fl-s-active',    (k.n_ok||0).toLocaleString());
    _set('fl-s-return',    (ff.batt_fail||0).toLocaleString());
    _set('fl-s-charge',    ((ff.canc_inflight||0)+(ff.canc_preflight||0)).toLocaleString());
    _set('fl-s-maint',     ((ff.coll_direct||0)+(ff.coll_prox||0)).toLocaleString());
    _set('fl-avail-sub',   `${k.n_ok||0} complete / ${k.N||0} total`);
    _set('fl-maint-count', ((ff.coll_direct||0)+(ff.coll_prox||0)).toLocaleString());
  }

  /* ── 1. Fleet Outcome Scoreboard — fl-sankey ──
     Table: vehicle rows × outcome columns (Complete/Collision/Bat Fail/Cancelled).
     Each cell shows count + mini colour bar. Crystal-clear, no dead space. */
  function _renderStatusBar(ff, vp) {
    const el = document.getElementById('fl-sankey');
    if (!el) return;
    if (typeof echarts !== 'undefined') { const old = echarts.getInstanceByDom(el); if (old) old.dispose(); }

    const VCOL = { Quad:'#046A38', Hexa:'#FF6B00', Vtol:'#f59e0b', Fixed_Wing:'#a855f7', Octa:'#3B82F6' };
    const vehicles = (vp||[]).filter(v => (v.total||0) > 0);

    // Build rows — prefer vp, fall back to single ff row
    const rows = vehicles.length ? vehicles.map(v => {
      const tot = v.total || 1;
      const comp  = v.complete  || Math.max(0, tot - (v.crash||0) - (v.battery||0) - (v.cancelled||0));
      const crash = v.crash     || 0;
      const batt  = v.battery   || 0;
      const canc  = v.cancelled || 0;
      return { label: v.vehicle, color: VCOL[v.vehicle]||'#9ca3af', tot, comp, crash, batt, canc,
        compPct:(comp/tot*100).toFixed(0), crashPct:(crash/tot*100).toFixed(0) };
    }) : [{
      label:'All Vehicles', color:'#374151', tot: ff.complete||1,
      comp: ff.complete||0, crash: (ff.coll_direct||0)+(ff.coll_prox||0),
      batt: ff.batt_fail||0, canc: (ff.canc_inflight||0)+(ff.canc_preflight||0),
      compPct: 0, crashPct: 0
    }];

    const grandTotal = rows.reduce((s,r) => s+r.tot, 0);

    el.style.cssText = 'display:flex;flex-direction:column;height:100%;';
    // Header
    const hdr = `<div style="display:grid;grid-template-columns:90px 1fr 1fr 1fr 1fr;gap:4px;padding:0 2px 6px;border-bottom:1px solid #E5DED4;flex-shrink:0;">
      <span style="font-family:'JetBrains Mono',monospace;font-size:7.5px;color:#9ca3af;font-weight:700;text-transform:uppercase;">Vehicle</span>
      <span style="font-family:'JetBrains Mono',monospace;font-size:7.5px;color:#046A38;font-weight:700;text-align:center;">Complete</span>
      <span style="font-family:'JetBrains Mono',monospace;font-size:7.5px;color:#f44336;font-weight:700;text-align:center;">Collision</span>
      <span style="font-family:'JetBrains Mono',monospace;font-size:7.5px;color:#ff9800;font-weight:700;text-align:center;">Bat Fail</span>
      <span style="font-family:'JetBrains Mono',monospace;font-size:7.5px;color:#9ca3af;font-weight:700;text-align:center;">Cancelled</span>
    </div>`;

    const body = `<div style="display:flex;flex-direction:column;justify-content:space-evenly;flex:1;min-height:0;padding:4px 0;">` +
      rows.map(r => {
        const cell = (val, tot, col) => {
          const pct = tot > 0 ? (val/tot*100) : 0;
          return `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
            <span style="font-family:'Bebas Neue',sans-serif;font-size:16px;color:${col};line-height:1;">${val.toLocaleString()}</span>
            <div style="width:80%;height:3px;background:#e5e7eb;border-radius:2px;overflow:hidden;">
              <div style="width:${pct.toFixed(0)}%;height:100%;background:${col};border-radius:2px;"></div>
            </div>
          </div>`;
        };
        return `<div style="display:grid;grid-template-columns:90px 1fr 1fr 1fr 1fr;gap:4px;align-items:center;padding:2px 2px;">
          <div style="display:flex;align-items:center;gap:5px;">
            <div style="width:7px;height:7px;border-radius:2px;background:${r.color};flex-shrink:0;"></div>
            <span style="font-family:'Space Grotesk',sans-serif;font-size:9px;font-weight:700;color:#374151;">${r.label}</span>
          </div>
          ${cell(r.comp,  r.tot, '#046A38')}
          ${cell(r.crash, r.tot, '#f44336')}
          ${cell(r.batt,  r.tot, '#ff9800')}
          ${cell(r.canc,  r.tot, '#9ca3af')}
        </div>`;
      }).join('') +
    `</div>`;

    const ftr = `<div style="border-top:1px solid #E5DED4;padding-top:5px;display:flex;justify-content:flex-end;align-items:center;gap:6px;flex-shrink:0;">
      <span style="font-family:'Space Grotesk',sans-serif;font-size:8px;color:#9ca3af;font-weight:700;text-transform:uppercase;">Total Fleet</span>
      <span style="font-family:'Bebas Neue',sans-serif;font-size:18px;color:#1C1410;line-height:1;">${grandTotal.toLocaleString()}</span>
    </div>`;

    el.innerHTML = hdr + body + ftr;
  }

  /* ── 2. Battery KDE curves — fl-util-heatmap ── */
  function _renderBatKDE(bk) {
    const el = document.getElementById('fl-util-heatmap'); if (!el) return;
    if (_batChart) { try { _batChart.destroy(); } catch(e) {} _batChart = null; }
    el.innerHTML = '<canvas id="fl-bat-kde-c" style="width:100%;height:100%;"></canvas>';
    const cv = document.getElementById('fl-bat-kde-c'); if (!cv) return;
    const datasets = [];
    if (bk.start?.x?.length)    datasets.push({ label:'Battery Start',    data:bk.start.x.map((x,i)=>({x,y:bk.start.y[i]})),    borderColor:'#046A38', borderWidth:2, fill:false, pointRadius:0, tension:0.4, parsing:{xAxisKey:'x',yAxisKey:'y'} });
    if (bk.consumed?.x?.length) datasets.push({ label:'Battery Consumed', data:bk.consumed.x.map((x,i)=>({x,y:bk.consumed.y[i]})), borderColor:'#f44336', borderWidth:2, fill:false, pointRadius:0, tension:0.4, parsing:{xAxisKey:'x',yAxisKey:'y'} });
    if (bk.end?.x?.length)      datasets.push({ label:'Battery End',      data:bk.end.x.map((x,i)=>({x,y:bk.end.y[i]})),          borderColor:'#3B82F6', borderWidth:1.5, fill:false, pointRadius:0, tension:0.4, parsing:{xAxisKey:'x',yAxisKey:'y'} });
    if (!datasets.length) { el.innerHTML = '<div class="text-xs text-gray-400 text-center pt-8">No battery KDE data</div>'; return; }
    _batChart = new Chart(cv.getContext('2d'), { type:'line', data:{ datasets },
      options:{ responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
        plugins:{ legend:{display:true,position:'bottom',labels:{boxWidth:10,font:{size:9,family:"'JetBrains Mono',monospace"}}},
          tooltip:{backgroundColor:'#1E293B',borderColor:'#334155',borderWidth:1,padding:{top:8,right:12,bottom:8,left:12},titleColor:'#F8FAFC',bodyColor:'#CBD5E1',titleFont:{family:"'Space Grotesk',sans-serif",size:11,weight:'bold'},bodyFont:{family:"'JetBrains Mono',monospace",size:10},cornerRadius:8,boxPadding:4} },
        scales:{
          x:{ type:'linear', title:{display:true,text:'Battery Level (%)',font:{size:8},color:'#9ca3af'}, ticks:{font:{family:"'JetBrains Mono',monospace",size:8},color:'#9ca3af'} },
          y:{ title:{display:true,text:'Density',font:{size:8},color:'#9ca3af'}, ticks:{font:{family:"'JetBrains Mono',monospace",size:8},color:'#9ca3af'}, min:0 }
        }, layout:{padding:{top:8,bottom:4}} }
    });
  }

  /* ── 3. Vehicle type donut — fl-network ──
     Shows drone count by vehicle type. If total=0, shows crash breakdown instead. */
  function _renderVehicleDonut(vp) {
    const el = document.getElementById('fl-network');
    if (!el || typeof echarts === 'undefined') return;
    let c = echarts.getInstanceByDom(el); if (c) c.dispose(); c = echarts.init(el);
    if (!vp.length) { el.innerHTML = '<div class="text-xs text-gray-400 text-center pt-8">No vehicle data</div>'; return; }
    const COLORS = ['#3B82F6','#046A38','#FF6B00','#f44336','#a855f7'];
    const total = vp.reduce((s,v) => s + (v.total||0), 0);
    if (!total) { el.innerHTML = '<div class="text-xs text-gray-400 text-center pt-8">No drones in this trial</div>'; return; }
    c.setOption({
      backgroundColor: 'transparent',
      tooltip: { trigger:'item', formatter:p=>`<b>${p.name}</b>: ${p.value.toLocaleString()} (${p.percent.toFixed(1)}%)`, backgroundColor:'#1E293B', borderColor:'#334155', borderWidth:1, textStyle:{fontFamily:'JetBrains Mono',fontSize:10,color:'#F8FAFC'}, extraCssText:'border-radius:8px;padding:8px 12px;' },
      legend: { orient:'horizontal', bottom:0, left:'center', itemWidth:7, itemHeight:7, itemGap:4, textStyle:{fontFamily:'JetBrains Mono',fontSize:7,color:'#6b7280'},
        formatter: name => { const v = vp.find(v=>v.vehicle===name); return v ? `${name}  ${((v.total||0)/total*100).toFixed(0)}%` : name; } },
      series: [{ type:'pie', radius:['44%','70%'], center:['50%','44%'],
        data: vp.map((v,i) => ({ name:v.vehicle, value:v.total||0, itemStyle:{color:COLORS[i%COLORS.length]} })),
        label:{show:false}, labelLine:{show:false},
        itemStyle:{borderRadius:4,borderColor:'#FAF7F2',borderWidth:2}, emphasis:{scale:true,scaleSize:4} }]
    });
    // HTML overlay — pixel-perfect centre text, no ECharts graphic
    el.style.position = 'relative';
    const _oid = 'fl-network-overlay';
    let _ov = document.getElementById(_oid);
    if (!_ov) { _ov = document.createElement('div'); _ov.id = _oid; el.appendChild(_ov); }
    _ov.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:calc(100% - 28px);display:flex;align-items:center;justify-content:center;pointer-events:none;';
    _ov.innerHTML = `<div style="text-align:center;line-height:1;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;font-weight:700;color:#1C1410;">${total.toLocaleString()}</div>
      <div style="font-family:'Space Grotesk',sans-serif;font-size:8px;font-weight:700;color:#9ca3af;text-transform:uppercase;margin-top:3px;">DRONES</div>
    </div>`;
    setTimeout(()=>c.resize(),60); setTimeout(()=>c.resize(),250); setTimeout(()=>c.resize(),500);
    window.addEventListener('resize', () => c.resize());
  }

  /* ── 4. Avg distance OR crash % by vehicle — fl-mission-donut ──
     Falls back to crash % bar if no distance data */
  function _renderVehicleDistBar(vp) {
    const el = document.getElementById('fl-mission-donut');
    if (!el || typeof echarts === 'undefined') return;
    let c = echarts.getInstanceByDom(el); if (c) c.dispose(); c = echarts.init(el);
    if (!vp.length) { el.innerHTML = '<div class="text-xs text-gray-400 text-center pt-8">No vehicle data</div>'; return; }
    const COLORS = ['#3B82F6','#046A38','#FF6B00','#f44336','#a855f7'];
    const hasDistance = vp.some(v => (v.avg_distance||0) > 0);
    if (hasDistance) {
      const sorted = [...vp].filter(v => (v.avg_distance||0) > 0).sort((a,b) => b.avg_distance - a.avg_distance);
      c.setOption({
        backgroundColor: 'transparent',
        tooltip: { trigger:'axis', axisPointer:{type:'shadow'}, backgroundColor:'#1E293B', borderColor:'#334155', borderWidth:1, textStyle:{fontFamily:'JetBrains Mono',fontSize:10,color:'#F8FAFC'}, extraCssText:'border-radius:8px;padding:8px 12px;',
          formatter: p => `<b>${p[0].name}</b><br>Avg Distance: <b>${(+p[0].value).toLocaleString()} m</b>` },
        grid: { top:8, bottom:8, left:72, right:48, containLabel:false },
        xAxis: { type:'value', axisLabel:{fontFamily:'JetBrains Mono',fontSize:8,color:'#6b7280'}, splitLine:{lineStyle:{color:'rgba(229,222,212,0.4)',type:'dashed'}} },
        yAxis: { type:'category', data:sorted.map(v=>v.vehicle), inverse:true, axisLabel:{fontFamily:'Space Grotesk',fontSize:9,color:'#374151',width:64,overflow:'truncate'}, axisLine:{lineStyle:{color:'#E5DED4'}} },
        series: [{ type:'bar', data:sorted.map((v,i)=>({value:+(v.avg_distance||0).toFixed(0),itemStyle:{color:COLORS[i%COLORS.length]}})),
          barMaxWidth:28, barCategoryGap:'35%', borderRadius:[0,4,4,0],
          label:{show:true,position:'right',formatter:p=>`${(+p.value).toLocaleString()}m`,fontFamily:'JetBrains Mono',fontSize:9,color:'#374151'} }]
      });
    } else {
      // Fallback: crash % by vehicle type
      c.setOption({
        backgroundColor: 'transparent',
        tooltip: { trigger:'axis', axisPointer:{type:'shadow'}, backgroundColor:'#1E293B', borderColor:'#334155', borderWidth:1, textStyle:{fontFamily:'JetBrains Mono',fontSize:10,color:'#F8FAFC'}, extraCssText:'border-radius:8px;padding:8px 12px;' },
        grid: { top:24, bottom:36, left:16, right:16 },
        xAxis: { type:'category', data:vp.map(v=>v.vehicle), axisLabel:{fontFamily:'JetBrains Mono',fontSize:9,color:'#374151'}, axisLine:{lineStyle:{color:'#E5DED4'}}, axisTick:{show:false} },
        yAxis: { type:'value', axisLabel:{fontFamily:'JetBrains Mono',fontSize:8,color:'#6b7280',formatter:v=>v+'%'}, splitLine:{lineStyle:{color:'rgba(229,222,212,0.4)',type:'dashed'}} },
        series: [{ type:'bar', data:vp.map((v,i)=>({value:+(v.crash_pct||0).toFixed(1),itemStyle:{color:COLORS[i%COLORS.length],borderRadius:[4,4,0,0]}})),
          barMaxWidth:32,
          label:{show:true,position:'top',formatter:p=>`${p.value}%`,fontFamily:'JetBrains Mono',fontSize:9,color:'#374151',fontWeight:'bold'} }]
      });
    }
    setTimeout(()=>c.resize(),50); setTimeout(()=>c.resize(),200);
    window.addEventListener('resize', () => c.resize());
  }

  /* ── 5. Battery KDE by flight status — fl-battery-forecast ── */
  function _renderBatKDEByStatus(bkbs) {
    const el = document.getElementById('fl-battery-forecast'); if (!el) return;
    if (_kdeChart) { try { _kdeChart.destroy(); } catch(e) {} _kdeChart = null; }
    el.innerHTML = '<canvas id="fl-bkbs-c" style="width:100%;height:100%;"></canvas>';
    const cv = document.getElementById('fl-bkbs-c'); if (!cv) return;
    const valid = bkbs.filter(g => g.x && g.x.length);
    if (!valid.length) { el.innerHTML = '<div class="text-xs text-gray-400 text-center pt-8">No battery-by-status data</div>'; return; }
    const COL = s => s.startsWith('Complete')?'#046A38':s.startsWith('Collision')?'#f44336':s.startsWith('Incomplete')?'#ff9800':'#9ca3af';
    const LABEL = s => s.replace('Collision — Node to Node','⚠ Collision').replace('Collision — Proximity','⚠ Prox').replace('Incomplete — Battery','⬡ Bat Fail').replace('Cancelled — In-flight','✗ Canc In').replace('Cancelled — Pre-flight','✗ Canc Pre').replace('Complete — ','✓ ').replace('Complete','✓ Complete');
    _kdeChart = new Chart(cv.getContext('2d'), { type:'line',
      data:{ datasets: valid.map(g => ({
        label: LABEL(g.status), data: g.x.map((x,i) => ({x, y:g.y[i]})),
        borderColor: COL(g.status), borderWidth:2, fill:true, backgroundColor:COL(g.status)+'12',
        pointRadius:0, tension:0.4, parsing:{xAxisKey:'x',yAxisKey:'y'} })) },
      options:{ responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
        plugins:{ legend:{display:true,position:'bottom',labels:{boxWidth:10,font:{size:9,family:"'JetBrains Mono',monospace"}}},
          tooltip:{backgroundColor:'#1E293B',borderColor:'#334155',borderWidth:1,padding:{top:8,right:12,bottom:8,left:12},titleColor:'#F8FAFC',bodyColor:'#CBD5E1',titleFont:{family:"'Space Grotesk',sans-serif",size:11,weight:'bold'},bodyFont:{family:"'JetBrains Mono',monospace",size:10},cornerRadius:8,boxPadding:4} },
        scales:{
          x:{ type:'linear', title:{display:true,text:'Battery Consumed (%)',font:{size:8},color:'#9ca3af'}, ticks:{font:{family:"'JetBrains Mono',monospace",size:8},color:'#9ca3af'} },
          y:{ title:{display:true,text:'Density',font:{size:8},color:'#9ca3af'}, ticks:{font:{family:"'JetBrains Mono',monospace",size:8},color:'#9ca3af'}, min:0 }
        }, layout:{padding:{top:8,bottom:4}} }
    });
  }

  /* ── 6. Battery reserve per layer bar — fl-radar ──
     bat_reserve_layer: [{ layer, bat_e, flight_status }] — average bat_e per layer */
  function _renderBatReserveLayer(brl) {
    const el = document.getElementById('fl-radar');
    if (!el || typeof echarts === 'undefined') return;
    let c = echarts.getInstanceByDom(el); if (c) c.dispose(); c = echarts.init(el);
    if (!brl.length) { el.innerHTML = '<div class="text-xs text-gray-400 text-center pt-8">No reserve data</div>'; return; }
    const layerAvg = {};
    brl.forEach(r => {
      const l = String(Math.round(r.layer||0));
      if (!layerAvg[l]) layerAvg[l] = { sum:0, n:0 };
      layerAvg[l].sum += (r.bat_e||0);
      layerAvg[l].n++;
    });
    const layers = Object.keys(layerAvg).filter(l=>l!=='0').sort();
    if (!layers.length) { el.innerHTML = '<div class="text-xs text-gray-400 text-center pt-8">No layer data</div>'; return; }
    const avgs = layers.map(l => +(layerAvg[l].sum/layerAvg[l].n).toFixed(1));
    const COLORS = ['#3B82F6','#046A38','#ff9800','#f44336'];
    c.setOption({
      backgroundColor: 'transparent',
      tooltip: { trigger:'axis', axisPointer:{type:'shadow'}, backgroundColor:'#1E293B', borderColor:'#334155', borderWidth:1, textStyle:{fontFamily:'JetBrains Mono',fontSize:10,color:'#F8FAFC'}, extraCssText:'border-radius:8px;padding:8px 12px;',
        formatter: p => `Layer ${p[0].name}<br>Avg Battery End: <b>${p[0].value.toFixed(1)}%</b>` },
      grid: { top:24, bottom:36, left:48, right:16 },
      xAxis: { type:'category', data:layers.map(l=>`L${l} (${(+l-1)*50}m)`), axisLabel:{fontFamily:'JetBrains Mono',fontSize:9,color:'#374151'}, axisLine:{lineStyle:{color:'#E5DED4'}}, axisTick:{show:false} },
      yAxis: { type:'value', min:0, max:100, axisLabel:{fontFamily:'JetBrains Mono',fontSize:8,color:'#6b7280',formatter:v=>v+'%'}, splitLine:{lineStyle:{color:'rgba(229,222,212,0.4)',type:'dashed'}} },
      series: [{ type:'bar', data:avgs.map((v,i)=>({value:v,itemStyle:{color:COLORS[i%COLORS.length],borderRadius:[4,4,0,0]}})),
        barMaxWidth:40,
        label:{show:true,position:'top',formatter:p=>`${p.value}%`,fontFamily:'JetBrains Mono',fontSize:10,color:'#374151',fontWeight:'bold'} }]
    });
    window.addEventListener('resize', () => c.resize());
  }

  /* ── 7. Drain scatter sparkline — fl-stress-spark ── */
  function _renderDrainScatter(dpts) {
    const el = document.getElementById('fl-stress-spark'); if (!el) return;
    el.innerHTML = '<canvas id="fl-drain-c" style="width:100%;height:100%;"></canvas>';
    const cv = document.getElementById('fl-drain-c'); if (!cv) return;
    const valid = dpts.filter(p => p.da > 0 && p.bat_u != null).slice(0, 300);
    if (!valid.length) { el.innerHTML = ''; return; }
    new Chart(cv.getContext('2d'), { type:'scatter',
      data:{ datasets:[{ data:valid.map(p=>({x:p.da,y:p.bat_u})), backgroundColor:'rgba(255,107,0,0.35)', pointRadius:2 }] },
      options:{ responsive:true, maintainAspectRatio:false,
        plugins:{legend:{display:false},tooltip:{enabled:false}},
        scales:{x:{display:false},y:{display:false}}, layout:{padding:0} }
    });
  }

  /* ── 8. Fleet availability gauge — fl-avail-gauge ── */
  function _renderAvailGauge(k, ff) {
    const el = document.getElementById('fl-avail-gauge');
    if (!el || typeof echarts === 'undefined') return;
    let c = echarts.getInstanceByDom(el); if (c) c.dispose(); c = echarts.init(el);
    const total    = k.N || 0;
    const complete = ff.complete || 0;
    const pct      = total > 0 ? +(complete/total*100).toFixed(1) : 0;
    const color    = pct > 80 ? '#046A38' : pct > 60 ? '#ff9800' : '#f44336';
    c.setOption({
      backgroundColor: 'transparent',
      tooltip: { show:false },
      series: [{
        type:'gauge', startAngle:90, endAngle:-270,
        radius:'78%', center:['50%','50%'], min:0, max:100, splitNumber:0,
        progress:{ show:true, width:8, itemStyle:{color} },
        axisLine:{ lineStyle:{ width:8, color:[[1,'#f3f4f6']] } },
        pointer:{show:false}, axisTick:{show:false}, splitLine:{show:false}, axisLabel:{show:false},
        detail:{
          valueAnimation:true,
          // offsetCenter [x,y] — 0,0 is exact geometric centre of the gauge circle
          offsetCenter:[0,'-8%'],
          formatter: val => `{pct|${val.toFixed(1)}%}`,
          rich:{
            pct:{ fontFamily:'Bebas Neue', fontSize:16, color:'#1C1410', lineHeight:18 }
          }
        },
        data:[{ value:pct }]
      }]
    });
    window.addEventListener('resize', () => c.resize());
  }

  /* ── 9. Maintenance breakdown bars — fl-maint-bars ── */
  function _renderMaintBars(ff) {
    const el = document.getElementById('fl-maint-bars');
    if (!el || typeof echarts === 'undefined') return;
    let c = echarts.getInstanceByDom(el); if (c) c.dispose(); c = echarts.init(el);
    const items = [
      { label:'Direct', value:ff.coll_direct||0,  color:'#f44336' },
      { label:'Prox',   value:ff.coll_prox||0,    color:'#FF6B00' },
      { label:'Bat',    value:ff.batt_fail||0,     color:'#ff9800' },
    ].filter(it => it.value > 0);
    if (!items.length) { el.innerHTML = '<div class="text-[9px] font-mono text-gray-400 text-center pt-2">No maintenance items</div>'; return; }
    c.setOption({
      backgroundColor: 'transparent',
      tooltip: { trigger:'axis', axisPointer:{type:'shadow'}, backgroundColor:'#1E293B', borderColor:'#334155', borderWidth:1, textStyle:{fontFamily:'JetBrains Mono',fontSize:9,color:'#F8FAFC'}, extraCssText:'border-radius:6px;padding:6px 10px;' },
      grid: { top:2, bottom:2, left:40, right:48 },
      xAxis: { type:'value', show:false },
      yAxis: { type:'category', data:items.map(it=>it.label), axisLabel:{fontFamily:'JetBrains Mono',fontSize:8,color:'#6b7280'}, axisLine:{show:false}, axisTick:{show:false} },
      series: [{ type:'bar', data:items.map(it=>({value:it.value,itemStyle:{color:it.color}})),
        barMaxWidth:12, borderRadius:[0,3,3,0],
        label:{show:true,position:'right',formatter:p=>p.value.toLocaleString(),fontFamily:'JetBrains Mono',fontSize:8,color:'#374151'} }]
    });
    window.addEventListener('resize', () => c.resize());
  }

  function _set(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
  return { render };
})();
