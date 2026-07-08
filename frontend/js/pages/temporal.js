/* ─────────────────────────────────────────────────────────────────────────────
   pages/temporal.js  —  Temporal Analytics page.

   FILE ROLE:
     Renders all Temporal page charts from the /temporal API response.
     All charts use ECharts (not Chart.js) to avoid canvas sizing issues.

   API DATA CONSUMED:
     /api/trial/{tid}/temporal returns:
       { rolling_rate:{ticks,raw,rolling}, fleet_density:{ticks,airborne,collision_counts},
         dur_by_status:[{status,values:[seconds]}],
         coll_by_tick:[{gtn,type,severity,drone_a_id,drone_b_id,drone_a_vehicle,drone_b_vehicle,drone_a_layer}] }

   CHARTS  (all ECharts — no canvas/Chart.js sizing bugs
   API: /api/trial/{tid}/temporal →
     { rolling_rate:{ticks,raw,rolling}, fleet_density:{ticks,airborne,collision_counts},
       dur_by_status:[{status,values:[seconds]}],
       coll_by_tick:[{gtn,type,severity,drone_a_id,drone_b_id,drone_a_vehicle,drone_b_vehicle,drone_a_layer}] }
*/
const TemporalPage = (() => {
  const EC = () => typeof echarts !== 'undefined' ? echarts : null;
  const ec = id => { const el=document.getElementById(id); if(!el||!EC()) return null; const old=EC().getInstanceByDom(el); if(old)old.dispose(); return EC().init(el); };
  const _set = (id,val) => { const el=document.getElementById(id); if(el) el.textContent=val; };

  // Shared tooltip style
  const TT = { backgroundColor:'#1E293B',borderColor:'#334155',borderWidth:1,
    textStyle:{fontFamily:'JetBrains Mono',fontSize:10,color:'#F8FAFC'},
    extraCssText:'border-radius:8px;padding:8px 12px;box-shadow:0 4px 12px rgba(0,0,0,.3);' };
  const AX = (col='#9ca3af') => ({ axisLabel:{fontFamily:'JetBrains Mono',fontSize:8,color:col}, axisLine:{lineStyle:{color:'#E5DED4'}}, axisTick:{show:false} });
  const SL = () => ({ lineStyle:{color:'rgba(229,222,212,0.5)',type:'dashed'} });

  function render(data) {
    data = data || {};
    const fd  = data.fleet_density  || {ticks:[],airborne:[],collision_counts:[]};
    const rr  = data.rolling_rate   || {ticks:[],raw:[],rolling:[]};
    const dur = data.dur_by_status  || [];
    const cbt = data.coll_by_tick   || [];
    _updateKPIs(fd, dur, rr, cbt);
    _renderAirborne(fd);
    _renderHeatmap(cbt);
    _renderDuration(dur);
    _renderVehicle(cbt);
    _renderRolling(rr);
    _renderSeverity(cbt, rr);
    _renderCollVsAirborne(fd);
    // Resize all after 300ms to guarantee real dimensions
    setTimeout(() => {
      document.querySelectorAll('[id^="t-"]').forEach(el => {
        const inst = EC()?.getInstanceByDom(el);
        if (inst) inst.resize();
      });
    }, 300);
  }

  function _updateKPIs(fd, dur, rr, cbt) {
    const ab = fd.airborne || [];
    const totalDrones = dur.reduce((s,g)=>s+(g.values||[]).length,0) || ab.reduce((s,v)=>s+v,0);
    const totalColls  = (fd.collision_counts||[]).reduce((s,v)=>s+v,0);
    const peakConc    = ab.length ? Math.max(...ab) : 0;
    const allSecs     = dur.flatMap(g=>g.values||[]);
    const totalHrs    = allSecs.length ? (allSecs.reduce((s,v)=>s+v,0)/3600).toFixed(1) : '—';
    _set('t-kpi-missions',    totalDrones ? totalDrones.toLocaleString() : '—');
    _set('t-kpi-hours',       totalHrs !== '—' ? totalHrs + ' hrs' : '—');
    _set('t-kpi-concurrency', peakConc ? peakConc.toLocaleString() : '—');
    _set('t-kpi-utilization', totalDrones>0 ? (100 - totalColls/totalDrones*100).toFixed(1)+'%' : '—');
  }

  // 1. Mission Activity — airborne + collisions dual-axis
  function _renderAirborne(fd) {
    const c = ec('t-activity-chart'); if(!c) return;
    const {ticks,airborne,collision_counts} = fd;
    if (!ticks.length) { document.getElementById('t-activity-chart').innerHTML='<div style="color:#9ca3af;font-size:11px;text-align:center;padding-top:40px;">No fleet density data</div>'; return; }
    const step = Math.max(1, Math.floor(ticks.length/200));
    const xs = ticks.filter((_,i)=>i%step===0);
    const ab = airborne.filter((_,i)=>i%step===0);
    const cc = collision_counts.filter((_,i)=>i%step===0);
    c.setOption({
      backgroundColor:'transparent', tooltip:{...TT,trigger:'axis',axisPointer:{type:'cross'}},
      legend:{data:['Airborne Drones','Collision Events'],top:2,right:8,itemWidth:10,itemHeight:10,textStyle:{fontFamily:'JetBrains Mono',fontSize:8,color:'#6b7280'}},
      grid:{top:32,bottom:28,left:52,right:52},
      xAxis:{type:'category',data:xs,...AX(),boundaryGap:false},
      yAxis:[
        {type:'value',name:'Airborne',nameTextStyle:{fontFamily:'JetBrains Mono',fontSize:8,color:'#3B82F6'},splitLine:SL(),axisLabel:{fontFamily:'JetBrains Mono',fontSize:8,color:'#3B82F6'},min:0},
        {type:'value',name:'Collisions',nameTextStyle:{fontFamily:'JetBrains Mono',fontSize:8,color:'#f44336'},position:'right',splitLine:{show:false},axisLabel:{fontFamily:'JetBrains Mono',fontSize:8,color:'#f44336'},min:0}
      ],
      series:[
        {name:'Airborne Drones',type:'line',data:ab,yAxisIndex:0,smooth:true,symbol:'none',lineStyle:{color:'#3B82F6',width:2},areaStyle:{color:{type:'linear',x:0,y:0,x2:0,y2:1,colorStops:[{offset:0,color:'rgba(59,130,246,0.25)'},{offset:1,color:'rgba(59,130,246,0.02)'}]}}},
        {name:'Collision Events',type:'line',data:cc,yAxisIndex:1,smooth:true,symbol:'none',lineStyle:{color:'#f44336',width:1.5},areaStyle:{color:'rgba(244,67,54,0.06)'}},
      ]
    });
    window.addEventListener('resize',()=>c.resize());
  }

  // 2. Collision type × layer heatmap
  function _renderHeatmap(cbt) {
    const c = ec('t-heatmap'); if(!c) return;
    const types=['Direct','Proximity','Near Miss'], layers=[1,2,3,4];
    const grid={};
    cbt.forEach(e=>{if(e.type&&e.drone_a_layer){const k=`${e.type},${e.drone_a_layer}`;grid[k]=(grid[k]||0)+1;}});
    const data=[];
    types.forEach((t,ti)=>layers.forEach((l,li)=>{data.push([li,ti,grid[`${t},${l}`]||0]);}));
    if(!cbt.length){document.getElementById('t-heatmap').innerHTML='<div style="color:#9ca3af;font-size:11px;text-align:center;padding-top:40px;">No collision data</div>';return;}
    const maxVal=Math.max(1,...data.map(d=>d[2]));
    c.setOption({
      backgroundColor:'transparent', tooltip:{...TT,position:'top',formatter:p=>`${types[p.data[1]]} / Layer ${layers[p.data[0]]}: <b>${p.data[2]}</b>`},
      grid:{top:6,bottom:48,left:80,right:16},
      xAxis:{type:'category',data:layers.map(l=>`L${l}`),...AX()},
      yAxis:{type:'category',data:types,...AX()},
      visualMap:{min:0,max:maxVal,orient:'horizontal',bottom:2,left:'center',itemHeight:60,itemWidth:8,text:['High','Low'],textGap:4,textStyle:{fontFamily:'JetBrains Mono',fontSize:7,color:'#6b7280'},inRange:{color:['#dcfce7','#fef9c3','#fca5a5','#ef4444']}},
      series:[{type:'heatmap',data,label:{show:true,formatter:p=>p.data[2]>0?p.data[2]:'',fontFamily:'JetBrains Mono',fontSize:11,fontWeight:'bold',color:'#374151'},itemStyle:{borderColor:'#FAF7F2',borderWidth:1.5,borderRadius:2}}]
    });
    setTimeout(()=>c.resize(),100); window.addEventListener('resize',()=>c.resize());
  }

  // 3. Duration / status 2×2 cards — pure HTML
  function _renderDuration(dur) {
    const el=document.getElementById('t-duration-donut'); if(!el) return;
    if(typeof echarts!=='undefined'){const old=echarts.getInstanceByDom(el);if(old)old.dispose();}
    if(!dur.length){el.innerHTML='<div style="color:#9ca3af;font-size:11px;text-align:center;padding-top:40px;">No status data</div>';return;}
    const COL=s=>s.startsWith('Complete')?'#046A38':s.startsWith('Collision')?'#f44336':s.startsWith('Incomplete')?'#ff9800':'#9ca3af';
    const BG =s=>s.startsWith('Complete')?'rgba(4,106,56,0.08)':s.startsWith('Collision')?'rgba(244,67,54,0.08)':s.startsWith('Incomplete')?'rgba(255,152,0,0.08)':'rgba(156,163,175,0.08)';
    const LBL=s=>s.startsWith('Complete')?'Complete':s.startsWith('Collision')?'Collision':s.startsWith('Incomplete')?'Bat Fail':'Cancelled';
    const items=dur.map(g=>{const sv=[...g.values].sort((a,b)=>a-b);return{name:LBL(g.status),val:g.values.length,col:COL(g.status),bg:BG(g.status),med:sv.length?(sv[Math.floor(sv.length/2)]/60).toFixed(1):'0'};}).sort((a,b)=>b.val-a.val);
    const total=items.reduce((s,it)=>s+it.val,0)||1;
    const allSecs=dur.flatMap(g=>g.values).sort((a,b)=>a-b);
    const med=allSecs.length?(allSecs[Math.floor(allSecs.length/2)]/60).toFixed(1):'—';
    _set('t-median-duration',`Median: ${med} min`);
    el.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:6px;height:100%;';
    el.innerHTML=items.slice(0,4).map(it=>{
      const pct=(it.val/total*100).toFixed(1);
      return `<div style="background:${it.bg};border:1px solid ${it.col}33;border-radius:8px;padding:10px;display:flex;flex-direction:column;justify-content:space-between;min-height:0;">
        <div><div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;"><span style="width:6px;height:6px;border-radius:2px;background:${it.col};display:inline-block;flex-shrink:0;"></span><span style="font-family:'Space Grotesk',sans-serif;font-size:8px;font-weight:700;color:#6b7280;text-transform:uppercase;">${it.name}</span></div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:30px;color:${it.col};line-height:1;">${it.val.toLocaleString()}</div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:7.5px;color:#9ca3af;">${pct}% · med ${it.med}m</div></div>
        <div style="height:4px;background:#e5e7eb;border-radius:2px;overflow:hidden;margin-top:6px;"><div style="width:${pct}%;height:100%;background:${it.col};border-radius:2px;"></div></div>
      </div>`;
    }).join('');
  }

  // 4. Vehicle collision breakdown — pure HTML rows
  function _renderVehicle(cbt) {
    const el=document.getElementById('t-daypart'); if(!el) return;
    if(typeof echarts!=='undefined'){const old=echarts.getInstanceByDom(el);if(old)old.dispose();}
    const cnt={};
    cbt.forEach(e=>{[e.drone_a_vehicle,e.drone_b_vehicle].forEach(v=>{if(v&&v!=='—')cnt[v]=(cnt[v]||0)+1;});});
    const items=Object.entries(cnt).sort((a,b)=>b[1]-a[1]);
    if(!cbt.length||!items.length){el.innerHTML='<div style="color:#9ca3af;font-size:11px;text-align:center;padding-top:40px;">No collision data</div>';return;}
    const COLS=['#f44336','#FF6B00','#ff9800','#3B82F6','#a855f7'];
    const total=items.reduce((s,[,v])=>s+v,0)||1;
    el.style.cssText='display:flex;flex-direction:column;justify-content:space-evenly;height:100%;gap:4px;';
    el.innerHTML=items.map(([name,val],i)=>{
      const pct=(val/total*100).toFixed(0); const col=COLS[i%COLS.length];
      return `<div style="display:flex;align-items:center;gap:6px;">
        <div style="width:7px;height:7px;border-radius:2px;background:${col};flex-shrink:0;"></div>
        <span style="font-family:'Space Grotesk',sans-serif;font-size:9px;font-weight:600;color:#374151;width:60px;flex-shrink:0;">${name}</span>
        <div style="flex:1;background:#f3f4f6;border-radius:4px;height:10px;overflow:hidden;"><div style="width:${pct}%;height:100%;background:${col};border-radius:4px;"></div></div>
        <span style="font-family:'Bebas Neue',sans-serif;font-size:15px;color:${col};line-height:1;width:30px;text-align:right;flex-shrink:0;">${val}</span>
      </div>`;
    }).join('')+
    `<div style="border-top:1px solid #E5DED4;padding-top:5px;display:flex;justify-content:space-between;align-items:center;">
      <span style="font-family:'Space Grotesk',sans-serif;font-size:8px;color:#9ca3af;font-weight:700;text-transform:uppercase;">Total Events</span>
      <span style="font-family:'Bebas Neue',sans-serif;font-size:18px;color:#1C1410;line-height:1;">${total.toLocaleString()}</span>
    </div>`;
  }

  // 5. Rolling collision rate — ECharts bar+line
  function _renderRolling(rr) {
    const c = ec('t-utilization'); if(!c) return;
    const {ticks,raw,rolling}=rr;
    if(!ticks.length){document.getElementById('t-utilization').innerHTML='<div style="color:#9ca3af;font-size:11px;text-align:center;padding-top:40px;">No data</div>';return;}
    const step=Math.max(1,Math.floor(ticks.length/80));
    const xs=ticks.filter((_,i)=>i%step===0);
    const rawD=raw.filter((_,i)=>i%step===0);
    const rollD=rolling.filter((_,i)=>i%step===0);
    c.setOption({
      backgroundColor:'transparent', tooltip:{...TT,trigger:'axis',axisPointer:{type:'shadow'}},
      legend:{data:['Raw Events','Rolling Avg'],bottom:0,itemWidth:8,itemHeight:8,textStyle:{fontFamily:'JetBrains Mono',fontSize:8,color:'#6b7280'}},
      grid:{top:8,bottom:32,left:36,right:16},
      xAxis:{type:'category',data:xs,...AX(),name:'Tick',nameTextStyle:{fontFamily:'JetBrains Mono',fontSize:7,color:'#9ca3af'}},
      yAxis:{type:'value',splitLine:SL(),axisLabel:{fontFamily:'JetBrains Mono',fontSize:8,color:'#9ca3af'},min:0,name:'Events',nameTextStyle:{fontFamily:'JetBrains Mono',fontSize:7,color:'#9ca3af'}},
      series:[
        {name:'Raw Events',type:'bar',data:rawD,itemStyle:{color:'rgba(255,107,0,0.55)',borderRadius:[2,2,0,0]},barMaxWidth:6},
        {name:'Rolling Avg',type:'line',data:rollD,smooth:true,symbol:'none',lineStyle:{color:'#f44336',width:2}},
      ]
    });
    setTimeout(()=>c.resize(),100); window.addEventListener('resize',()=>c.resize());
  }

  // 6. Severity by tick window — ECharts stacked bar
  function _renderSeverity(cbt, rr) {
    const c = ec('t-delay'); if(!c) return;
    const ticks=rr.ticks||[];
    if(!ticks.length||!cbt.length){document.getElementById('t-delay').innerHTML='<div style="color:#9ca3af;font-size:11px;text-align:center;padding-top:40px;">No collision data</div>';return;}
    const BINS=12, tMin=ticks[0], tMax=ticks[ticks.length-1], range=tMax-tMin||1, bs=range/BINS;
    const labels=Array.from({length:BINS},(_,i)=>Math.round(tMin+i*bs));
    const crit=new Array(BINS).fill(0), maj=new Array(BINS).fill(0), nm=new Array(BINS).fill(0);
    cbt.forEach(e=>{if(e.gtn==null)return;const bi=Math.min(Math.floor((e.gtn-tMin)/bs),BINS-1);
      if(e.severity==='Critical')crit[bi]++;else if(e.severity==='Major')maj[bi]++;else nm[bi]++;});
    c.setOption({
      backgroundColor:'transparent', tooltip:{...TT,trigger:'axis',axisPointer:{type:'shadow'},formatter:p=>`Tick ~${p[0].name}<br>${p.map(s=>`${s.seriesName}: <b>${s.value}</b>`).join('<br>')}`},
      legend:{data:['Critical','Major','Near Miss'],bottom:0,itemWidth:8,itemHeight:8,textStyle:{fontFamily:'JetBrains Mono',fontSize:8,color:'#6b7280'}},
      grid:{top:8,bottom:36,left:32,right:8},
      xAxis:{type:'category',data:labels,...AX()},
      yAxis:{type:'value',splitLine:SL(),axisLabel:{fontFamily:'JetBrains Mono',fontSize:8,color:'#9ca3af'},min:0},
      series:[
        {name:'Critical',type:'bar',stack:'s',data:crit,itemStyle:{color:'rgba(244,67,54,0.8)',borderRadius:[0,0,0,0]}},
        {name:'Major',type:'bar',stack:'s',data:maj,itemStyle:{color:'rgba(255,107,0,0.8)'}},
        {name:'Near Miss',type:'bar',stack:'s',data:nm,itemStyle:{color:'rgba(59,130,246,0.6)',borderRadius:[2,2,0,0]}},
      ]
    });
    setTimeout(()=>c.resize(),100); window.addEventListener('resize',()=>c.resize());
  }

  // 7. Collision rate vs airborne — ECharts
  function _renderCollVsAirborne(fd) {
    const c = ec('t-cancellations'); if(!c) return;
    const {ticks,airborne,collision_counts}=fd;
    if(!ticks.length){document.getElementById('t-cancellations').innerHTML='<div style="color:#9ca3af;font-size:11px;text-align:center;padding-top:40px;">No data</div>';return;}
    const BINS=15, step=Math.max(1,Math.floor(ticks.length/BINS));
    const xs=[],ab=[],cc=[];
    for(let i=0;i<BINS&&i*step<ticks.length;i++){
      const sl_ab=airborne.slice(i*step,(i+1)*step), sl_cc=collision_counts.slice(i*step,(i+1)*step);
      ab.push(Math.round(sl_ab.reduce((s,v)=>s+v,0)/(sl_ab.length||1)));
      cc.push(sl_cc.reduce((s,v)=>s+v,0));
      xs.push(`T${ticks[i*step]}`);
    }
    c.setOption({
      backgroundColor:'transparent', tooltip:{...TT,trigger:'axis',axisPointer:{type:'shadow'}},
      legend:{data:['Avg Airborne','Collisions'],bottom:0,itemWidth:8,itemHeight:8,textStyle:{fontFamily:'JetBrains Mono',fontSize:8,color:'#6b7280'}},
      grid:{top:8,bottom:36,left:44,right:44},
      xAxis:{type:'category',data:xs,...AX()},
      yAxis:[
        {type:'value',name:'Airborne',nameTextStyle:{fontFamily:'JetBrains Mono',fontSize:7,color:'#3B82F6'},splitLine:SL(),axisLabel:{fontFamily:'JetBrains Mono',fontSize:8,color:'#3B82F6'},min:0},
        {type:'value',name:'Collisions',nameTextStyle:{fontFamily:'JetBrains Mono',fontSize:7,color:'#f44336'},position:'right',splitLine:{show:false},axisLabel:{fontFamily:'JetBrains Mono',fontSize:8,color:'#f44336'},min:0}
      ],
      series:[
        {name:'Avg Airborne',type:'bar',data:ab,yAxisIndex:0,itemStyle:{color:'rgba(59,130,246,0.6)',borderRadius:[2,2,0,0]},barMaxWidth:24},
        {name:'Collisions',type:'line',data:cc,yAxisIndex:1,smooth:true,symbol:'circle',symbolSize:4,lineStyle:{color:'#f44336',width:2},itemStyle:{color:'#f44336'}},
      ]
    });
    setTimeout(()=>c.resize(),100); window.addEventListener('resize',()=>c.resize());
  }

  return { render };
})();
