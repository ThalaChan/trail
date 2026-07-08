/* ─────────────────────────────────────────────────────────────────────────────
   pages/safety.js  —  Safety Analytics page.

   FILE ROLE:
     Renders all 7 charts on the Safety page from the /safety API response.
     No data is fetched here — app.js fetches and passes data to render().

   API DATA CONSUMED:
     /api/trial/{tid}/safety returns EXACTLY:
     kpis:            { N, n_ok, n_crash, n_batt, n_canc, n_coll, comp_pct, crash_pct, collision_free_pct, avg_bat_used, avg_da }
     severity:        { statuses:[], counts:[] }
     vehicle_hits:    [{ vehicle, hits, fleet_count, collision_rate }]
     bat_kde:         { x:[], y:[], obs:[] }
     layer_stats:     [{ layer, label, total, complete, crash, comp_pct, crash_pct, events, bat_avg }]
     vehicle_perf:    [{ vehicle, total, complete, crash, battery, cancelled, comp_pct, crash_pct, bat_avg, bat_reserve, avg_distance, collision_events, coll_rate }]
     collision_pairs: [{ pair, count, pct }]   <-- field is "pair" not "type"
     vehicle_crash_layer: [{ vehicle, layer, label, total, crash, crash_pct }]
     escalation:      { pairs:[{pair,events,n_events,escalated,final,first_tick,last_tick}], ticks:[] }
*/
const SafetyPage = (() => {

  /* Store last rendered data so filter changes can re-render without re-fetch */
  let _lastData = null;

  function render(data) {
    _lastData = data = data || {};
    const k      = data.kpis                || {};
    const sev    = data.severity            || { statuses:[], counts:[] };
    const vhits  = data.vehicle_hits        || [];
    const bkde   = data.bat_kde             || { x:[], y:[], obs:[] };
    const lstat  = data.layer_stats         || [];
    const vperf  = data.vehicle_perf        || [];
    const vcl    = data.vehicle_crash_layer || [];
    const cpairs = data.collision_pairs     || [];
    const esc    = data.escalation          || { pairs:[], ticks:[] };

    _updateKPIs(k, sev, vhits);
    _renderSeverityDonut(sev);            // s-gauge
    _renderVehicleCollisionRate(vhits);   // s-score-trend
    _renderBatKDE(bkde);                  // s-violations-donut
    _renderLayerSafety(lstat);            // s-heatmap
    _renderVehicleCrashByLayer(vcl);      // s-timeline
    _renderCollisionPairs(cpairs);        // s-breakdown
    _renderVehiclePerf(vperf);            // s-trend-30d
    _renderGeofenceBreaches(lstat);       // s-geofence
    _renderRiskDistribution(vperf);       // s-risk-dist
    _renderRecommendations(k, sev, vhits, lstat); // s-recommendations
  }

  /* ── KPIs ── */
  function _updateKPIs(k, sev, vhits) {
    const total   = (sev.counts||[]).reduce((s,v)=>s+v,0);
    const critIdx = (sev.statuses||[]).indexOf('Critical');
    const crit    = critIdx>=0 ? (sev.counts[critIdx]||0) : 0;
    const nmIdx   = (sev.statuses||[]).indexOf('Near Miss');
    const nm      = nmIdx>=0 ? (sev.counts[nmIdx]||0) : 0;
    const maxRate = vhits.length ? Math.max(...vhits.map(v=>+(v.collision_rate||0))) : 0;
    _set('s-kpi-score',      k.N ? Math.max(0, Math.round(100-(k.crash_pct||0))).toString() : '—');
    _set('s-kpi-events',     total.toLocaleString());
    _set('s-kpi-critical',   crit.toLocaleString());
    _set('s-kpi-violations', (k.n_crash||0).toLocaleString());
    _set('s-kpi-nearmiss',   nm.toLocaleString());
    _set('s-kpi-compliance', maxRate>0 ? `${maxRate.toFixed(1)}% max rate` : '—');
  }

  /* ── 1. Severity donut — s-gauge ── */
  function _renderSeverityDonut(sev) {
    const el=document.getElementById('s-gauge');
    if(!el||typeof echarts==='undefined') return;
    let c=echarts.getInstanceByDom(el); if(c) c.dispose(); c=echarts.init(el);
    const statuses=sev.statuses||[], counts=sev.counts||[];
    if(!statuses.length){el.innerHTML='<div class="text-xs text-gray-400 text-center pt-8">No severity data</div>';return;}
    const COL={'Critical':'#f44336','Major':'#FF6B00','Minor':'#ff9800','Near Miss':'#3B82F6'};
    const items=statuses.map((s,i)=>({name:s,value:counts[i]||0,itemStyle:{color:COL[s]||'#9ca3af'}})).filter(it=>it.value>0);
    const total=counts.reduce((s,v)=>s+v,0);
    c.setOption({backgroundColor:'transparent',
      tooltip:{trigger:'item',formatter:p=>`<b>${p.name}</b>: ${p.value.toLocaleString()} (${p.percent.toFixed(1)}%)`,backgroundColor:'#1E293B',borderColor:'#334155',borderWidth:1,textStyle:{fontFamily:'JetBrains Mono',fontSize:10,color:'#F8FAFC'},extraCssText:'border-radius:8px;padding:8px 12px;'},
      series:[{type:'pie',radius:['44%','70%'],center:['50%','50%'],data:items,
        label:{show:true,formatter:'{b}: {c}',fontFamily:'JetBrains Mono',fontSize:8,color:'#374151'},
        labelLine:{length:8,length2:4},
        itemStyle:{borderRadius:4,borderColor:'#FAF7F2',borderWidth:2},
        emphasis:{scale:true,scaleSize:4}}],
      graphic:[{type:'text',left:'center',top:'43%',style:{text:`${total.toLocaleString()}\nTotal`,textAlign:'center',fill:'#1C1410',font:'bold 14px Bebas Neue',lineHeight:16}}]
    });
    window.addEventListener('resize',()=>c.resize());
  }

  /* ── 2. Vehicle collision rate bar — s-score-trend ── */
  function _renderVehicleCollisionRate(vhits) {
    const el=document.getElementById('s-score-trend'); if(!el) return;
    el.innerHTML='<canvas id="s-vhit-c" style="width:100%;height:100%;"></canvas>';
    const cv=document.getElementById('s-vhit-c'); if(!cv) return;
    if(!vhits.length){el.innerHTML='<div class="text-xs text-gray-400 text-center pt-8">No vehicle data</div>';return;}
    new Chart(cv.getContext('2d'),{type:'bar',
      data:{labels:vhits.map(v=>v.vehicle),datasets:[
        {label:'Collision Rate (%)',data:vhits.map(v=>+(v.collision_rate||0).toFixed(1)),
          backgroundColor:vhits.map(v=>(v.collision_rate||0)>20?'rgba(244,67,54,0.75)':(v.collision_rate||0)>10?'rgba(255,152,0,0.75)':'rgba(4,106,56,0.75)'),
          borderRadius:3,yAxisID:'y'},
        {label:'Collisions',data:vhits.map(v=>v.hits||0),
          backgroundColor:'rgba(59,130,246,0.45)',borderRadius:3,yAxisID:'y2'},
      ]},
      options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
        plugins:{legend:{display:true,position:'bottom',labels:{boxWidth:10,font:{size:9,family:"'JetBrains Mono',monospace"}}},
          tooltip:{backgroundColor:'#1E293B',borderColor:'#334155',borderWidth:1,padding:{top:8,right:12,bottom:8,left:12},titleColor:'#F8FAFC',bodyColor:'#CBD5E1',titleFont:{family:"'Space Grotesk',sans-serif",size:11,weight:'bold'},bodyFont:{family:"'JetBrains Mono',monospace",size:10},cornerRadius:8,boxPadding:4}},
        scales:{
          x:{grid:{display:false},ticks:{font:{family:"'JetBrains Mono',monospace",size:9},color:'#374151'}},
          y:{title:{display:true,text:'Rate (%)',font:{size:8},color:'#9ca3af'},grid:{color:'rgba(229,222,212,0.5)',borderDash:[3,3]},ticks:{font:{family:"'JetBrains Mono',monospace",size:8},color:'#9ca3af',callback:v=>v+'%'},min:0},
          y2:{position:'right',title:{display:true,text:'Count',font:{size:8},color:'#3B82F6'},grid:{display:false},ticks:{font:{family:"'JetBrains Mono',monospace",size:8},color:'#3B82F6'},min:0}
        },layout:{padding:{top:8,bottom:4}}}
    });
  }

  /* ── 3. Battery at crash histogram — s-violations-donut ── */
  function _renderBatKDE(bkde) {
    const el=document.getElementById('s-violations-donut'); if(!el) return;
    el.innerHTML='<canvas id="s-bat-c" style="width:100%;height:100%;"></canvas>';
    const cv=document.getElementById('s-bat-c'); if(!cv) return;
    const obs=bkde.obs||[];
    if(!obs.length){el.innerHTML='<div class="text-xs text-gray-400 text-center pt-8">No battery crash data</div>';return;}
    const bins=Array.from({length:10},(_,i)=>i*10);
    const counts=bins.map(b=>obs.filter(v=>v>=b&&v<b+10).length);
    const datasets=[{label:'Drones at crash',data:counts,backgroundColor:'rgba(244,67,54,0.65)',borderColor:'#f44336',borderWidth:1,borderRadius:2}];
    if(bkde.x&&bkde.x.length){
      datasets.push({type:'line',label:'KDE',data:bkde.x.map((x,i)=>({x,y:bkde.y[i]*obs.length*10})),
        borderColor:'#FF6B00',borderWidth:2,pointRadius:0,fill:false,tension:0.4,parsing:{xAxisKey:'x',yAxisKey:'y'}});
    }
    new Chart(cv.getContext('2d'),{type:'bar',data:{labels:bins.map(b=>`${b}–${b+10}%`),datasets},
      options:{responsive:true,maintainAspectRatio:false,
        plugins:{legend:{display:true,position:'bottom',labels:{boxWidth:10,font:{size:9,family:"'JetBrains Mono',monospace"}}},
          tooltip:{backgroundColor:'#1E293B',borderColor:'#334155',borderWidth:1,padding:{top:8,right:12,bottom:8,left:12},titleColor:'#F8FAFC',bodyColor:'#CBD5E1',titleFont:{family:"'Space Grotesk',sans-serif",size:11,weight:'bold'},bodyFont:{family:"'JetBrains Mono',monospace",size:10},cornerRadius:8,boxPadding:4}},
        scales:{
          x:{grid:{display:false},ticks:{font:{family:"'JetBrains Mono',monospace",size:8},color:'#9ca3af'},title:{display:true,text:'Battery at Crash (%)',font:{size:8},color:'#9ca3af'}},
          y:{grid:{color:'rgba(229,222,212,0.5)',borderDash:[3,3]},ticks:{font:{family:"'JetBrains Mono',monospace",size:8},color:'#9ca3af'},title:{display:true,text:'Count',font:{size:8},color:'#9ca3af'}}
        },layout:{padding:{top:8,bottom:4}}}
    });
  }

  /* ── 4. Layer safety — complete% vs crash% — s-heatmap ── */
  function _renderLayerSafety(lstat) {
    const el=document.getElementById('s-heatmap');
    if(!el||typeof echarts==='undefined') return;
    let c=echarts.getInstanceByDom(el); if(c) c.dispose(); c=echarts.init(el);
    if(!lstat.length){el.innerHTML='<div class="text-xs text-gray-400 text-center pt-8">No layer data</div>';return;}
    const labels=lstat.map(l=>l.label||`L${l.layer}`);
    const comp =lstat.map(l=>+(l.comp_pct||0).toFixed(1));   // use precomputed comp_pct
    const crash=lstat.map(l=>+(l.crash_pct||0).toFixed(1));  // use precomputed crash_pct
    c.setOption({backgroundColor:'transparent',
      tooltip:{trigger:'axis',axisPointer:{type:'shadow'},backgroundColor:'#1E293B',borderColor:'#334155',borderWidth:1,textStyle:{fontFamily:'JetBrains Mono',fontSize:10,color:'#F8FAFC'},extraCssText:'border-radius:8px;padding:8px 12px;'},
      legend:{data:['Complete %','Crash %'],bottom:0,itemWidth:8,itemHeight:8,textStyle:{fontFamily:'JetBrains Mono',fontSize:8,color:'#6b7280'}},
      grid:{top:8,bottom:40,left:48,right:16},
      xAxis:{type:'category',data:labels,axisLabel:{fontFamily:'Space Grotesk',fontSize:9,color:'#374151'},axisLine:{lineStyle:{color:'#E5DED4'}},axisTick:{show:false}},
      yAxis:{type:'value',max:100,axisLabel:{fontFamily:'JetBrains Mono',fontSize:8,color:'#6b7280',formatter:v=>v+'%'},splitLine:{lineStyle:{color:'rgba(229,222,212,0.4)',type:'dashed'}}},
      series:[
        {name:'Complete %',type:'bar',data:comp.map(v=>({value:v,itemStyle:{color:'rgba(4,106,56,0.75)',borderRadius:[3,3,0,0]}})),barMaxWidth:22},
        {name:'Crash %',   type:'bar',data:crash.map(v=>({value:v,itemStyle:{color:'rgba(244,67,54,0.75)',borderRadius:[3,3,0,0]}})),barMaxWidth:22},
      ]
    });
    window.addEventListener('resize',()=>c.resize());
  }

  /* ── 5. Vehicle × Layer crash grouped bar — s-timeline ── */
  function _renderVehicleCrashByLayer(vcl) {
    const el=document.getElementById('s-timeline'); if(!el) return;
    el.innerHTML='<canvas id="s-vcl-c" style="width:100%;height:100%;"></canvas>';
    const cv=document.getElementById('s-vcl-c'); if(!cv) return;
    if(!vcl.length){el.innerHTML='<div class="text-xs text-gray-400 text-center pt-8">No crash-by-layer data</div>';return;}
    const vehs=[...new Set(vcl.map(r=>r.vehicle))].sort();
    const layers=[1,2,3,4];
    const COLORS=['#3B82F6','#046A38','#FF6B00','#f44336','#a855f7'];
    new Chart(cv.getContext('2d'),{type:'bar',
      data:{labels:layers.map(l=>`L${l} (${(l-1)*50}m)`),datasets:vehs.map((v,i)=>({
        label:v,
        data:layers.map(l=>{const r=vcl.find(r=>r.vehicle===v&&r.layer===l); return r?r.crash:0;}),
        backgroundColor:`${COLORS[i%COLORS.length]}cc`,borderRadius:3,borderWidth:0,
      }))},
      options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
        plugins:{legend:{display:true,position:'bottom',labels:{boxWidth:10,font:{size:9,family:"'JetBrains Mono',monospace"}}},
          tooltip:{backgroundColor:'#1E293B',borderColor:'#334155',borderWidth:1,padding:{top:8,right:12,bottom:8,left:12},titleColor:'#F8FAFC',bodyColor:'#CBD5E1',titleFont:{family:"'Space Grotesk',sans-serif",size:11,weight:'bold'},bodyFont:{family:"'JetBrains Mono',monospace",size:10},cornerRadius:8,boxPadding:4}},
        scales:{
          x:{grid:{display:false},ticks:{font:{family:"'JetBrains Mono',monospace",size:9},color:'#374151'}},
          y:{grid:{color:'rgba(229,222,212,0.5)',borderDash:[3,3]},ticks:{font:{family:"'JetBrains Mono',monospace",size:8},color:'#9ca3af'},title:{display:true,text:'Crashes',font:{size:8},color:'#9ca3af'},min:0}
        },layout:{padding:{top:8,bottom:4}}}
    });
  }

  /* ── 6. Collision pair types horizontal bar — s-breakdown ──
     API returns collision_pairs: [{ pair, count, pct }]  ← field is "pair" not "type" */
  function _renderCollisionPairs(cpairs) {
    const el=document.getElementById('s-breakdown');
    if(!el||typeof echarts==='undefined') return;
    let c=echarts.getInstanceByDom(el); if(c) c.dispose(); c=echarts.init(el);
    if(!cpairs.length){el.innerHTML='<div class="text-xs text-gray-400 text-center pt-4">No collision pair data</div>';return;}
    const sorted=[...cpairs].sort((a,b)=>b.count-a.count).slice(0,8);
    c.setOption({backgroundColor:'transparent',
      tooltip:{trigger:'axis',axisPointer:{type:'shadow'},backgroundColor:'#1E293B',borderColor:'#334155',borderWidth:1,textStyle:{fontFamily:'JetBrains Mono',fontSize:10,color:'#F8FAFC'},extraCssText:'border-radius:8px;padding:8px 12px;'},
      grid:{top:8,bottom:8,left:130,right:48},
      xAxis:{type:'value',axisLabel:{fontFamily:'JetBrains Mono',fontSize:8,color:'#6b7280'},splitLine:{lineStyle:{color:'rgba(229,222,212,0.4)',type:'dashed'}}},
      yAxis:{type:'category',data:sorted.map(p=>p.pair),inverse:true,
        axisLabel:{fontFamily:'JetBrains Mono',fontSize:8,color:'#374151',width:120,overflow:'truncate'},
        axisLine:{lineStyle:{color:'#E5DED4'}}},
      series:[{type:'bar',
        data:sorted.map(p=>({value:p.count,
          itemStyle:{color:p.pair.includes('Direct')?'rgba(244,67,54,0.75)':p.pair.includes('Proximity')?'rgba(255,152,0,0.75)':'rgba(59,130,246,0.75)',borderRadius:[0,3,3,0]}})),
        barMaxWidth:22,
        label:{show:true,position:'right',formatter:'{c}',fontFamily:'JetBrains Mono',fontSize:9,color:'#374151'}}]
    });
    window.addEventListener('resize',()=>c.resize());
  }

  /* ── 7. Vehicle performance grouped bar — s-trend-30d ──
     vehicle_perf fields: vehicle, total, complete, crash, battery, cancelled, comp_pct, crash_pct, bat_avg, bat_reserve, avg_distance, collision_events, coll_rate */
  function _renderVehiclePerf(vperf) {
    const el=document.getElementById('s-trend-30d'); if(!el) return;
    el.innerHTML='<canvas id="s-vperf-c" style="width:100%;height:100%;"></canvas>';
    const cv=document.getElementById('s-vperf-c'); if(!cv) return;
    if(!vperf.length){el.innerHTML='<div class="text-xs text-gray-400 text-center pt-8">No vehicle performance data</div>';return;}
    new Chart(cv.getContext('2d'),{type:'bar',
      data:{labels:vperf.map(v=>v.vehicle),datasets:[
        {label:'Complete %', data:vperf.map(v=>+(v.comp_pct||0).toFixed(1)),  backgroundColor:'rgba(4,106,56,0.75)',  borderRadius:3},
        {label:'Crash %',    data:vperf.map(v=>+(v.crash_pct||0).toFixed(1)), backgroundColor:'rgba(244,67,54,0.75)', borderRadius:3},
        {label:'Bat Fail %', data:vperf.map(v=>+((v.battery||0)/Math.max(v.total||1,1)*100).toFixed(1)), backgroundColor:'rgba(255,152,0,0.75)', borderRadius:3},
      ]},
      options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
        plugins:{legend:{display:true,position:'bottom',labels:{boxWidth:10,font:{size:9,family:"'JetBrains Mono',monospace"}}},
          tooltip:{backgroundColor:'#1E293B',borderColor:'#334155',borderWidth:1,padding:{top:8,right:12,bottom:8,left:12},titleColor:'#F8FAFC',bodyColor:'#CBD5E1',titleFont:{family:"'Space Grotesk',sans-serif",size:11,weight:'bold'},bodyFont:{family:"'JetBrains Mono',monospace",size:10},cornerRadius:8,boxPadding:4,
            callbacks:{label:ctx=>` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`}}},
        scales:{
          x:{grid:{display:false},ticks:{font:{family:"'JetBrains Mono',monospace",size:9},color:'#374151'}},
          y:{min:0,max:100,grid:{color:'rgba(229,222,212,0.5)',borderDash:[3,3]},ticks:{font:{family:"'JetBrains Mono',monospace",size:8},color:'#9ca3af',callback:v=>v+'%'},title:{display:true,text:'Percentage',font:{size:8},color:'#9ca3af'}}
        },layout:{padding:{top:8,bottom:4}}}
    });
  }

  /* ── 8. Geofence Breaches — crashes + events per layer — s-geofence ──
     layer_stats fields: layer, label, total, complete, crash, comp_pct, crash_pct, events, bat_avg */
  function _renderGeofenceBreaches(lstat) {
    const el=document.getElementById('s-geofence');
    if(!el||typeof echarts==='undefined') return;
    let c=echarts.getInstanceByDom(el); if(c) c.dispose(); c=echarts.init(el);
    if(!lstat.length){el.innerHTML='<div class="text-xs text-gray-400 text-center pt-8">No layer data</div>';return;}
    const labels  = lstat.map(l=>l.label||`L${l.layer}`);
    const crashes = lstat.map(l=>l.crash||0);
    const events  = lstat.map(l=>l.events||0);  // collision events in this layer
    c.setOption({backgroundColor:'transparent',
      tooltip:{trigger:'axis',axisPointer:{type:'shadow'},backgroundColor:'#1E293B',borderColor:'#334155',borderWidth:1,textStyle:{fontFamily:'JetBrains Mono',fontSize:10,color:'#F8FAFC'},extraCssText:'border-radius:8px;padding:8px 12px;'},
      legend:{data:['Drone Crashes','Collision Events'],bottom:0,itemWidth:8,itemHeight:8,textStyle:{fontFamily:'JetBrains Mono',fontSize:8,color:'#6b7280'}},
      grid:{top:8,bottom:38,left:40,right:16},
      xAxis:{type:'category',data:labels,axisLabel:{fontFamily:'Space Grotesk',fontSize:9,color:'#374151'},axisLine:{lineStyle:{color:'#E5DED4'}},axisTick:{show:false}},
      yAxis:{type:'value',axisLabel:{fontFamily:'JetBrains Mono',fontSize:8,color:'#6b7280'},splitLine:{lineStyle:{color:'rgba(229,222,212,0.4)',type:'dashed'}}},
      series:[
        {name:'Drone Crashes',    type:'bar',data:crashes.map(v=>({value:v,itemStyle:{color:'rgba(244,67,54,0.8)',borderRadius:[3,3,0,0]}})),barMaxWidth:20},
        {name:'Collision Events', type:'bar',data:events.map(v=>({value:v, itemStyle:{color:'rgba(255,152,0,0.7)',borderRadius:[3,3,0,0]}})),barMaxWidth:20},
      ]
    });
    window.addEventListener('resize',()=>c.resize());
  }

  /* ── 9. Risk Distribution — stacked % per vehicle — s-risk-dist ──
     vehicle_perf: total, crash, battery, cancelled */
  function _renderRiskDistribution(vperf) {
    const el=document.getElementById('s-risk-dist');
    if(!el||typeof echarts==='undefined') return;
    let c=echarts.getInstanceByDom(el); if(c) c.dispose(); c=echarts.init(el);
    if(!vperf.length){el.innerHTML='<div class="text-xs text-gray-400 text-center pt-8">No risk data</div>';return;}
    const vehs     = vperf.map(v=>v.vehicle);
    const crashPct = vperf.map(v=>+(v.crash_pct||0).toFixed(1));
    const battPct  = vperf.map(v=>+((v.battery||0)/Math.max(v.total||1,1)*100).toFixed(1));
    const cancPct  = vperf.map(v=>+((v.cancelled||0)/Math.max(v.total||1,1)*100).toFixed(1));
    c.setOption({backgroundColor:'transparent',
      tooltip:{trigger:'axis',axisPointer:{type:'shadow'},backgroundColor:'#1E293B',borderColor:'#334155',borderWidth:1,textStyle:{fontFamily:'JetBrains Mono',fontSize:10,color:'#F8FAFC'},extraCssText:'border-radius:8px;padding:8px 12px;'},
      legend:{data:['Crash %','Bat Fail %','Cancelled %'],bottom:0,itemWidth:8,itemHeight:8,textStyle:{fontFamily:'JetBrains Mono',fontSize:8,color:'#6b7280'}},
      grid:{top:8,bottom:42,left:40,right:16},
      xAxis:{type:'category',data:vehs,axisLabel:{fontFamily:'JetBrains Mono',fontSize:9,color:'#374151'},axisLine:{lineStyle:{color:'#E5DED4'}},axisTick:{show:false}},
      yAxis:{type:'value',axisLabel:{fontFamily:'JetBrains Mono',fontSize:8,color:'#6b7280',formatter:v=>v+'%'},splitLine:{lineStyle:{color:'rgba(229,222,212,0.4)',type:'dashed'}}},
      series:[
        {name:'Crash %',     type:'bar',stack:'risk',data:crashPct,itemStyle:{color:'rgba(244,67,54,0.85)'},               barMaxWidth:32},
        {name:'Bat Fail %',  type:'bar',stack:'risk',data:battPct, itemStyle:{color:'rgba(255,152,0,0.85)'},               barMaxWidth:32},
        {name:'Cancelled %', type:'bar',stack:'risk',data:cancPct, itemStyle:{color:'rgba(156,163,175,0.75)',borderRadius:[3,3,0,0]},barMaxWidth:32},
      ]
    });
    window.addEventListener('resize',()=>c.resize());
  }

  /* ── 10. Safety Recommendations — derived from real data — s-recommendations ── */
  function _renderRecommendations(k, sev, vhits, lstat) {
    const el=document.getElementById('s-recommendations'); if(!el) return;
    const recs=[];
    const crashPct=k.crash_pct||0;
    if(crashPct>15) recs.push({p:'CRITICAL',c:'#f44336',bg:'bg-red-50',b:'border-red-200',
      t:`Crash rate ${crashPct.toFixed(1)}% exceeds threshold. Activate L2 avoidance protocol immediately.`});
    else if(crashPct>8) recs.push({p:'HIGH',c:'#FF6B00',bg:'bg-orange-50',b:'border-orange-200',
      t:`Crash rate ${crashPct.toFixed(1)}% elevated. Review collision-prone layers and reduce density.`});

    if(vhits.length){
      const worst=vhits.reduce((a,b)=>(b.collision_rate||0)>(a.collision_rate||0)?b:a);
      if((worst.collision_rate||0)>10) recs.push({p:'HIGH',c:'#FF6B00',bg:'bg-orange-50',b:'border-orange-200',
        t:`${worst.vehicle} has highest collision rate (${(worst.collision_rate||0).toFixed(1)}%). Reassign to less congested layers.`});
    }

    if(lstat.length){
      const wl=lstat.reduce((a,b)=>(b.crash_pct||0)>(a.crash_pct||0)?b:a);
      if((wl.crash_pct||0)>5) recs.push({p:'MEDIUM',c:'#ff9800',bg:'bg-yellow-50',b:'border-yellow-200',
        t:`${wl.label||'Layer '+wl.layer} has ${(wl.crash_pct||0).toFixed(1)}% crash rate. Redistribute drone density.`});
    }

    const sevTotal=(sev.counts||[]).reduce((s,v)=>s+v,0);
    if(sevTotal>200) recs.push({p:'MEDIUM',c:'#ff9800',bg:'bg-yellow-50',b:'border-yellow-200',
      t:`${sevTotal.toLocaleString()} total safety events. Schedule post-simulation debrief and path optimization.`});

    recs.push({p:'INFO',c:'#3B82F6',bg:'bg-blue-50',b:'border-blue-200',
      t:'Enable real-time geofence monitoring for Research Zone R2 and Defense corridors.'});

    // Render as horizontal cards (grid-cols-4 in HTML)
    el.innerHTML=recs.map(r=>`
      <div class="border ${r.b} ${r.bg} rounded-xl p-3 flex flex-col gap-1.5">
        <span class="text-[7px] font-bold px-1.5 py-0.5 rounded text-white inline-block self-start" style="background:${r.c}">${r.p}</span>
        <p class="text-[9px] font-mono text-gray-600 leading-snug">${r.t}</p>
      </div>`).join('');
  }

  function _set(id,val){const el=document.getElementById(id);if(el)el.textContent=val;}
  return { render };
})();
