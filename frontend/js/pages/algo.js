/* ─────────────────────────────────────────────────────────────────────────────
   pages/algo.js  —  Algorithm Diagnostics page.

   FILE ROLE:
     Renders the Algorithm Diagnostics page from the /algo_diag response.
     Focuses on route assignment fairness, avoidance algorithm failure
     rates per layer, risk quadrant distribution, and escalated drone pairs.

   API DATA CONSUMED:
     /api/trial/{tid}/algo_diag returns EXACTLY:
     route_assignment:  [{ vehicle, n, avg_da, median_da, p75_da, max_da, crash_pct, values:[] }]
     separation_events: [{ tick, type, severity, bat_a, bat_b, veh_a, veh_b, layer, pair }]
     escalated_count:   int
     failed_pairs:      [{ pair, n_events, first_tick, last_tick, outcome }]
     route_crash_dist:  { crashed:[], safe:[] }
     risk_quadrant:     { high_risk, vulnerable, overloaded, safe }
     layer_fail:        [{ layer, label, drones, crashes, near_misses, direct_hits, crash_pct, avoidance_fail_pct }]
*/
const AlgoPage = (() => {
  let _distChart = null;

  function render(data) {
    data = data || {};
    const ra  = data.route_assignment  || [];
    const se  = data.separation_events || [];
    const fp  = data.failed_pairs      || [];
    const rcd = data.route_crash_dist  || { crashed:[], safe:[] };
    const rq  = data.risk_quadrant     || {};
    const lf  = data.layer_fail        || [];

    _updateKPIs(data, ra, se, lf);
    _renderRouteAssignment(ra);      // al-accuracy-time
    _renderCrashDistComparison(rcd); // al-latency-dist
    _renderLayerFailRate(lf);        // al-acc-comparison
    _renderRiskQuadrant(rq);         // al-drift
    _renderVehiclePairHeatmap(se);   // al-usage-donut
    _renderEscalationTable(fp);      // al-features  (escalated pairs)
    _renderSeverityBars(se);         // al-resources
    _renderBiasCards(ra);            // al-bias-cards  ← FIXED layout
    _renderAlgoHealth(lf, se, rq);   // al-health-gauge + al-health-bars  ← NEW
  }

  /* ── KPIs ── */
  function _updateKPIs(data, ra, se, lf) {
    _set('al-kpi-models',  '2');
    _set('al-kpi-infer',   se.length.toLocaleString());
    // Avg inference time proxy: avg crash_pct across layers as a quality metric
    const avgCrash = lf.length ? (lf.reduce((s,l)=>s+l.crash_pct,0)/lf.length).toFixed(1) : null;
    _set('al-kpi-latency', avgCrash ? avgCrash+'% avg crash' : '—');
    // Model accuracy: 100 - avg crash_pct across layers
    _set('al-kpi-acc',     lf.length ? (100 - lf.reduce((s,l)=>s+l.crash_pct,0)/lf.length).toFixed(1)+'%' : '—');
    _set('al-kpi-drift',   (data.escalated_count||0).toLocaleString());
    _set('al-kpi-updated', new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}));
  }

  /* ── 1. Route Assignment: avg distance + crash % by vehicle — al-accuracy-time ── */
  function _renderRouteAssignment(ra) {
    const el = document.getElementById('al-accuracy-time'); if (!el) return;
    el.innerHTML = '<canvas id="al-route-c" style="position:absolute;inset:0;width:100%;height:100%;"></canvas>';
    const cv = document.getElementById('al-route-c'); if (!cv) return;
    if (!ra.length) { el.innerHTML = '<div class="text-xs text-gray-400 text-center pt-8">No route data</div>'; return; }
    const sorted = [...ra].sort((a,b) => b.avg_da - a.avg_da);
    const ch = new Chart(cv.getContext('2d'), { type:'bar',
      data:{ labels:sorted.map(v=>v.vehicle), datasets:[
        { label:'Avg Distance (m)', data:sorted.map(v=>v.avg_da), backgroundColor:'rgba(59,130,246,0.75)', borderRadius:4, borderWidth:0 },
        { label:'Crash %', data:sorted.map(v=>v.crash_pct), backgroundColor:'rgba(244,67,54,0.70)', borderRadius:4, borderWidth:0, yAxisID:'y2' },
      ]},
      options:{ responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
        plugins:{ legend:{display:true,position:'top',labels:{boxWidth:10,font:{size:9,family:"'JetBrains Mono',monospace"}}},
          tooltip:{backgroundColor:'#1E293B',borderColor:'#334155',borderWidth:1,padding:{top:8,right:12,bottom:8,left:12},titleColor:'#F8FAFC',bodyColor:'#CBD5E1',titleFont:{family:"'Space Grotesk',sans-serif",size:11,weight:'bold'},bodyFont:{family:"'JetBrains Mono',monospace",size:10},cornerRadius:8,boxPadding:4} },
        scales:{
          x:{ grid:{display:false}, ticks:{font:{family:"'JetBrains Mono',monospace",size:9},color:'#374151'} },
          y:{ grid:{color:'rgba(229,222,212,0.5)',borderDash:[3,3]}, ticks:{font:{family:"'JetBrains Mono',monospace",size:8},color:'#3B82F6'}, title:{display:true,text:'Avg Distance (m)',font:{size:8},color:'#3B82F6'}, min:0 },
          y2:{ position:'right', grid:{display:false}, ticks:{font:{family:"'JetBrains Mono',monospace",size:8},color:'#f44336',callback:v=>v+'%'}, title:{display:true,text:'Crash %',font:{size:8},color:'#f44336'}, min:0 }
        }, layout:{padding:{top:2,bottom:0}} }
    });
    setTimeout(()=>ch.resize(),60); setTimeout(()=>ch.resize(),250);
    window.addEventListener('resize',()=>ch.resize());
  }

  /* ── 2. Route Length Histogram: Crashed vs Safe — al-latency-dist ── */
  function _renderCrashDistComparison(rcd) {
    const el = document.getElementById('al-latency-dist'); if (!el) return;
    if (_distChart) { try { _distChart.destroy(); } catch(e) {} _distChart = null; }
    el.innerHTML = '<canvas id="al-dist-c" style="position:absolute;inset:0;width:100%;height:100%;"></canvas>';
    const cv = document.getElementById('al-dist-c'); if (!cv) return;
    const crashed = rcd.crashed || [], safe = rcd.safe || [];
    const allVals = [...crashed,...safe].filter(v => v > 0);
    if (!allVals.length) { el.innerHTML = '<div class="text-xs text-gray-400 text-center pt-8">No route crash data</div>'; return; }
    const mn = Math.min(...allVals), mx = Math.max(...allVals), rng = mx - mn || 1;
    const BINS = 10, bw = rng / BINS;
    const labels       = Array.from({length:BINS}, (_,i) => Math.round(mn + i*bw));
    const crashCounts  = labels.map(b => crashed.filter(v => v>=b && v<b+bw).length);
    const safeCounts   = labels.map(b => safe.filter(v => v>=b && v<b+bw).length);
    _distChart = new Chart(cv.getContext('2d'), { type:'bar',
      data:{ labels:labels.map(l=>`${(l/1000).toFixed(1)}km`), datasets:[
        { label:'Crashed', data:crashCounts, backgroundColor:'rgba(244,67,54,0.75)', borderRadius:2 },
        { label:'Safe',    data:safeCounts,  backgroundColor:'rgba(4,106,56,0.65)',  borderRadius:2 },
      ]},
      options:{ responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
        plugins:{ legend:{display:true,position:'bottom',labels:{boxWidth:10,font:{size:9,family:"'JetBrains Mono',monospace"}}},
          tooltip:{backgroundColor:'#1E293B',borderColor:'#334155',borderWidth:1,padding:{top:8,right:12,bottom:8,left:12},titleColor:'#F8FAFC',bodyColor:'#CBD5E1',titleFont:{family:"'Space Grotesk',sans-serif",size:11,weight:'bold'},bodyFont:{family:"'JetBrains Mono',monospace",size:10},cornerRadius:8,boxPadding:4} },
        scales:{
          x:{ grid:{display:false}, ticks:{font:{family:"'JetBrains Mono',monospace",size:8},color:'#9ca3af'}, title:{display:true,text:'Distance Flown',font:{size:8},color:'#9ca3af'} },
          y:{ grid:{color:'rgba(229,222,212,0.5)',borderDash:[3,3]}, ticks:{font:{family:"'JetBrains Mono',monospace",size:8},color:'#9ca3af'}, title:{display:true,text:'Count',font:{size:8},color:'#9ca3af'}, min:0 }
        }, layout:{padding:{top:2,bottom:0}} }
    });
    setTimeout(()=>_distChart.resize(),60); setTimeout(()=>_distChart.resize(),250);
    window.addEventListener('resize',()=>_distChart?.resize());
  }

  /* ── 3. Layer Crash & Avoidance Fail % — al-acc-comparison ── */
  function _renderLayerFailRate(lf) {
    const el = document.getElementById('al-acc-comparison'); if (!el) return;
    el.innerHTML = '<canvas id="al-layer-c" style="width:100%;height:100%;"></canvas>';
    const cv = document.getElementById('al-layer-c'); if (!cv) return;
    if (!lf.length) { el.innerHTML = '<div class="text-xs text-gray-400 text-center pt-8">No layer data</div>'; return; }
    new Chart(cv.getContext('2d'), { type:'bar',
      data:{ labels:lf.map(l=>l.label), datasets:[
        { label:'Crash %',          data:lf.map(l=>l.crash_pct),          backgroundColor:'rgba(244,67,54,0.80)', borderRadius:3 },
        { label:'Avoidance Fail %', data:lf.map(l=>l.avoidance_fail_pct), backgroundColor:'rgba(255,107,0,0.70)', borderRadius:3 },
      ]},
      options:{ responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
        plugins:{ legend:{display:true,position:'bottom',labels:{boxWidth:10,font:{size:9,family:"'JetBrains Mono',monospace"}}},
          tooltip:{backgroundColor:'#1E293B',borderColor:'#334155',borderWidth:1,padding:{top:8,right:12,bottom:8,left:12},titleColor:'#F8FAFC',bodyColor:'#CBD5E1',titleFont:{family:"'Space Grotesk',sans-serif",size:11,weight:'bold'},bodyFont:{family:"'JetBrains Mono',monospace",size:10},cornerRadius:8,boxPadding:4,
            callbacks:{label:ctx=>` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`}} },
        scales:{
          x:{ grid:{display:false}, ticks:{font:{family:"'JetBrains Mono',monospace",size:9},color:'#374151'} },
          y:{ min:0, max:100, grid:{color:'rgba(229,222,212,0.5)',borderDash:[3,3]}, ticks:{font:{family:"'JetBrains Mono',monospace",size:8},color:'#9ca3af',callback:v=>v+'%'}, title:{display:true,text:'Percentage',font:{size:8},color:'#9ca3af'} }
        }, layout:{padding:{top:2,bottom:0}} }
    });
  }

  /* ── 4. Risk Quadrant Donut — al-drift ── */
  function _renderRiskQuadrant(rq) {
    const el = document.getElementById('al-drift');
    if (!el || typeof echarts === 'undefined') return;
    let c = echarts.getInstanceByDom(el); if (c) c.dispose(); c = echarts.init(el);
    const items = [
      { name:'High Risk\n(long+low bat)',   value:rq.high_risk||0,  color:'#f44336' },
      { name:'Overloaded\n(long+ok bat)',   value:rq.overloaded||0, color:'#FF6B00' },
      { name:'Vulnerable\n(short+low bat)', value:rq.vulnerable||0, color:'#ff9800' },
      { name:'Safe\n(short+ok bat)',        value:rq.safe||0,       color:'#046A38' },
    ].filter(it => it.value > 0);
    const total = items.reduce((s,it) => s+it.value, 0);
    if (!total) { el.innerHTML = '<div class="text-xs text-gray-400 text-center pt-8">No risk quadrant data</div>'; return; }
    c.setOption({
      backgroundColor: 'transparent',
      tooltip:{ trigger:'item', formatter:p=>`<b>${p.name.replace('\n',' ')}</b>: ${p.value.toLocaleString()} (${p.percent.toFixed(1)}%)`, backgroundColor:'#1E293B', borderColor:'#334155', borderWidth:1, textStyle:{fontFamily:'JetBrains Mono',fontSize:10,color:'#F8FAFC'}, extraCssText:'border-radius:8px;padding:8px 12px;' },
      series:[{ type:'pie', radius:['42%','68%'], center:['50%','50%'],
        data:items.map(it=>({name:it.name,value:it.value,itemStyle:{color:it.color}})),
        label:{show:true,formatter:'{b}: {c}',fontFamily:'JetBrains Mono',fontSize:7.5,color:'#374151'},
        labelLine:{length:6,length2:4},
        itemStyle:{borderRadius:4,borderColor:'#FAF7F2',borderWidth:2},
        emphasis:{scale:true,scaleSize:4} }],
      graphic:[{type:'text',left:'center',top:'43%',style:{text:`${total.toLocaleString()}\nTotal`,textAlign:'center',fill:'#1C1410',font:'bold 12px Bebas Neue',lineHeight:14}}]
    });
    window.addEventListener('resize', () => c.resize());
  }

  /* ── 5. Vehicle Pair Collision Heatmap — al-usage-donut ── */
  function _renderVehiclePairHeatmap(se) {
    const el = document.getElementById('al-usage-donut');
    if (!el || typeof echarts === 'undefined') return;
    let c = echarts.getInstanceByDom(el); if (c) c.dispose(); c = echarts.init(el);
    if (!se.length) { el.innerHTML = '<div class="text-xs text-gray-400 text-center pt-8">No pair data</div>'; return; }
    const vehs = [...new Set([...se.map(e=>e.veh_a),...se.map(e=>e.veh_b)].filter(v=>v&&v!=='—'))].sort();
    const grid = {};
    se.forEach(e => { const k = `${e.veh_a||'?'},${e.veh_b||'?'}`; grid[k] = (grid[k]||0)+1; });
    const data = [];
    vehs.forEach((va,xi) => vehs.forEach((vb,yi) => {
      const v = (grid[`${va},${vb}`]||0) + (grid[`${vb},${va}`]||0);
      if (v > 0) data.push([xi,yi,v]);
    }));
    if (!data.length) { el.innerHTML = '<div class="text-xs text-gray-400 text-center pt-8">No collision pair data</div>'; return; }
    c.setOption({
      backgroundColor: 'transparent',
      tooltip:{ position:'top', formatter:p=>`${vehs[p.data[0]]} × ${vehs[p.data[1]]}: <b>${p.data[2]}</b> events`, backgroundColor:'#1E293B', borderColor:'#334155', borderWidth:1, textStyle:{fontFamily:'JetBrains Mono',fontSize:10,color:'#F8FAFC'}, extraCssText:'border-radius:8px;padding:8px 12px;' },
      grid:{ top:8, bottom:48, left:60, right:16 },
      xAxis:{ type:'category', data:vehs, axisLabel:{fontFamily:'Space Grotesk',fontSize:9,color:'#374151',rotate:20}, axisLine:{lineStyle:{color:'#E5DED4'}} },
      yAxis:{ type:'category', data:vehs, axisLabel:{fontFamily:'Space Grotesk',fontSize:9,color:'#374151'}, axisLine:{lineStyle:{color:'#E5DED4'}} },
      visualMap:{ min:0, max:Math.max(1,...data.map(d=>d[2])), show:true, orient:'horizontal', bottom:0, left:'center', text:['High','Low'], textStyle:{fontFamily:'JetBrains Mono',fontSize:7.5,color:'#6b7280'}, inRange:{color:['#dcfce7','#fef9c3','#fca5a5','#ef4444']} },
      series:[{ type:'heatmap', data, label:{show:true,formatter:p=>p.data[2],fontFamily:'JetBrains Mono',fontSize:9,color:'#374151'}, itemStyle:{borderColor:'#FAF7F2',borderWidth:1.5,borderRadius:2} }]
    });
    window.addEventListener('resize', () => c.resize());
  }

  /* ── 6. Escalated Pairs Table — al-features ── */
  function _renderEscalationTable(fp) {
    const el = document.getElementById('al-features'); if (!el) return;
    if (!fp.length) { el.innerHTML = '<div class="text-xs text-gray-400 text-center pt-8">No escalated pairs</div>'; return; }
    el.innerHTML = `<div style="overflow-y:auto;max-height:210px;font-size:9px;font-family:JetBrains Mono,monospace;">
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr style="border-bottom:1px solid #E5DED4;position:sticky;top:0;background:#FAF7F2;">
          <th style="text-align:left;padding:3px 4px;color:#9ca3af;font-size:8px;text-transform:uppercase;">Pair</th>
          <th style="padding:3px 4px;color:#9ca3af;font-size:8px;text-align:center;">Events</th>
          <th style="padding:3px 4px;color:#9ca3af;font-size:8px;text-align:center;">Ticks</th>
          <th style="padding:3px 4px;color:#9ca3af;font-size:8px;text-align:center;">Outcome</th>
        </tr></thead>
        <tbody>
          ${fp.slice(0,20).map(p=>`<tr style="border-bottom:1px solid rgba(229,222,212,0.3);">
            <td style="padding:3px 4px;color:#374151;font-family:Space Grotesk,sans-serif;">${p.pair}</td>
            <td style="padding:3px 4px;text-align:center;color:#374151;">${p.n_events}</td>
            <td style="padding:3px 4px;text-align:center;color:#6b7280;">${p.first_tick}–${p.last_tick}</td>
            <td style="padding:3px 4px;font-weight:700;color:#f44336;">${p.outcome}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  }

  /* ── 7. Severity Distribution Bars — al-resources ── */
  function _renderSeverityBars(se) {
    const el = document.getElementById('al-resources'); if (!el) return;
    el.innerHTML = '<canvas id="al-sev-c" style="width:100%;height:100%;"></canvas>';
    const cv = document.getElementById('al-sev-c'); if (!cv) return;
    const sevMap = {};
    se.forEach(e => { const s = e.severity||'Unknown'; sevMap[s] = (sevMap[s]||0)+1; });
    const sorted = Object.entries(sevMap).sort((a,b) => b[1]-a[1]);
    if (!sorted.length) { el.innerHTML = '<div class="text-xs text-gray-400 text-center pt-8">No severity data</div>'; return; }
    const COL = { Critical:'rgba(244,67,54,0.80)', Major:'rgba(255,107,0,0.80)', Minor:'rgba(255,152,0,0.80)', 'Near Miss':'rgba(59,130,246,0.80)' };
    new Chart(cv.getContext('2d'), { type:'bar',
      data:{ labels:sorted.map(([k])=>k), datasets:[{ label:'Events', data:sorted.map(([,v])=>v),
        backgroundColor:sorted.map(([k])=>COL[k]||'rgba(156,163,175,0.75)'), borderRadius:4, borderWidth:0 }] },
      options:{ responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false},
          tooltip:{backgroundColor:'#1E293B',borderColor:'#334155',borderWidth:1,padding:{top:8,right:12,bottom:8,left:12},titleColor:'#F8FAFC',bodyColor:'#CBD5E1',titleFont:{family:"'Space Grotesk',sans-serif",size:11,weight:'bold'},bodyFont:{family:"'JetBrains Mono',monospace",size:10},cornerRadius:8,boxPadding:4} },
        scales:{
          x:{ grid:{display:false}, ticks:{font:{family:"'JetBrains Mono',monospace",size:9},color:'#374151'} },
          y:{ grid:{color:'rgba(229,222,212,0.5)',borderDash:[3,3]}, ticks:{font:{family:"'JetBrains Mono',monospace",size:8},color:'#9ca3af'}, min:0, title:{display:true,text:'Events',font:{size:8},color:'#9ca3af'} }
        }, layout:{padding:{top:2,bottom:0}} }
    });
  }

  /* ── 8. Bias & Fairness Cards — al-bias-cards ── FIXED
     HTML expects grid-cols-3. Each card shows one vehicle's crash stats + distance bar.
     route_assignment fields: vehicle, n, avg_da, crash_pct */
  function _renderBiasCards(ra) {
    const el = document.getElementById('al-bias-cards'); if (!el) return;
    if (!ra.length) { el.innerHTML = '<div class="text-xs text-gray-400 col-span-3 text-center">No vehicle data</div>'; return; }
    const maxDa    = Math.max(...ra.map(v => v.avg_da), 1);
    const maxCrash = Math.max(...ra.map(v => v.crash_pct));
    const minCrash = Math.min(...ra.map(v => v.crash_pct));
    // Show all vehicles (up to 6, fills 2 rows of 3)
    el.innerHTML = ra.slice(0,6).map(v => {
      const pct   = Math.min(100, v.avg_da / maxDa * 100);
      const col   = v.crash_pct > 20 ? '#f44336' : v.crash_pct > 10 ? '#ff9800' : '#046A38';
      const bg    = v.crash_pct > 20 ? '#fef2f2' : v.crash_pct > 10 ? '#fff7ed' : '#f0fdf4';
      return `<div class="rounded-xl p-2.5 border border-brand-border/50" style="background:${bg};">
        <div class="flex justify-between items-center mb-1.5">
          <span class="text-[9px] font-bold text-gray-800 font-mono">${v.vehicle}</span>
          <span class="text-[9px] font-bold font-mono" style="color:${col}">${v.crash_pct.toFixed(1)}%</span>
        </div>
        <p class="text-[8px] font-mono text-gray-400 mb-1">Avg dist: ${(v.avg_da/1000).toFixed(2)}km · n=${v.n.toLocaleString()}</p>
        <div style="height:4px;background:#e5e7eb;border-radius:2px;overflow:hidden;">
          <div style="width:${pct.toFixed(0)}%;height:100%;background:${col};border-radius:2px;"></div>
        </div>
      </div>`;
    }).join('');

    // Update bias summary text
    const biasNote = el.closest('.glass-panel')?.querySelector('p.text-brand-success');
    if (biasNote) biasNote.textContent = `Crash range: ${minCrash.toFixed(1)}%–${maxCrash.toFixed(1)}% across vehicle types`;
  }

  /* ── 9. Algorithm Health Gauge + Bars — al-health-gauge + al-health-bars ── NEW
     Derived from layer_fail (crash rates) and separation_events (severity counts) */
  function _renderAlgoHealth(lf, se, rq) {
    // ── Gauge ──
    const gaugeEl = document.getElementById('al-health-gauge');
    if (gaugeEl && typeof echarts !== 'undefined') {
      let gc = echarts.getInstanceByDom(gaugeEl); if (gc) gc.dispose(); gc = echarts.init(gaugeEl);
      const avgCrash  = lf.length ? lf.reduce((s,l)=>s+l.crash_pct,0)/lf.length : 0;
      const healthPct = Math.max(0, Math.round(100 - avgCrash));
      const color     = healthPct > 80 ? '#046A38' : healthPct > 60 ? '#ff9800' : '#f44336';
      gc.setOption({
        backgroundColor: 'transparent',
        series:[{
          type:'gauge', startAngle:90, endAngle:-270,
          radius:'80%', center:['50%','50%'], min:0, max:100, splitNumber:0,
          progress:{show:true,width:9,itemStyle:{color}},
          axisLine:{lineStyle:{width:9,color:[[1,'#f3f4f6']]}},
          pointer:{show:false}, axisTick:{show:false}, splitLine:{show:false}, axisLabel:{show:false},
          detail:{valueAnimation:true, offsetCenter:[0,'-8%'],
            formatter: val=>`{v|${val}%}`,
            rich:{v:{fontFamily:'Bebas Neue',fontSize:22,color:'#1C1410',lineHeight:24}}},
          data:[{value:healthPct}]
        }]
      });
      window.addEventListener('resize', () => gc.resize());
    }

    // ── Health Bars — taller bars to fill flex space ──
    const barsEl = document.getElementById('al-health-bars');
    if (!barsEl) return;
    const critCount  = se.filter(e=>e.severity==='Critical').length;
    const majCount   = se.filter(e=>e.severity==='Major').length;
    const nmCount    = se.filter(e=>e.severity==='Near Miss').length;
    const esc        = (rq.high_risk||0) + (rq.overloaded||0);
    const total      = se.length || 1;
    const metrics    = [
      { label:'Critical Events',  value:critCount, max:total, color:'#f44336' },
      { label:'Major Events',     value:majCount,  max:total, color:'#FF6B00' },
      { label:'Near Miss',        value:nmCount,   max:total, color:'#ff9800' },
      { label:'High Risk Drones', value:esc, max:Math.max(esc,(rq.safe||0),(rq.vulnerable||0),1), color:'#3B82F6' },
    ];
    barsEl.innerHTML = metrics.map(m => {
      const pct = Math.min(100, m.max > 0 ? m.value/m.max*100 : 0);
      return `<div class="py-1">
        <div class="flex justify-between mb-1">
          <span class="text-[8px] font-mono text-gray-600">${m.label}</span>
          <span class="text-[9px] font-mono font-bold" style="color:${m.color}">${m.value.toLocaleString()}</span>
        </div>
        <div style="height:6px;background:#f3f4f6;border-radius:3px;overflow:hidden;">
          <div style="width:${pct.toFixed(0)}%;height:100%;background:${m.color};border-radius:3px;transition:width 0.4s ease;"></div>
        </div>
      </div>`;
    }).join('');

    // Update overall status
    const statusEl = gaugeEl?.closest('.glass-panel')?.querySelector('p.text-brand-success');
    const avgCrash2 = lf.length ? lf.reduce((s,l)=>s+l.crash_pct,0)/lf.length : 0;
    if (statusEl) {
      const status = avgCrash2 < 10 ? 'Good' : avgCrash2 < 20 ? 'Elevated' : 'Critical';
      const col2   = avgCrash2 < 10 ? '#046A38' : avgCrash2 < 20 ? '#ff9800' : '#f44336';
      statusEl.innerHTML = `<i class="fa-solid fa-circle text-[7px]" style="color:${col2}"></i> Overall Status: <b>${status}</b>`;
    }
  }

  function _set(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
  return { render };
})();
