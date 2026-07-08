/* ─────────────────────────────────────────────────────────────────────────────
   charts/overview-charts.js  —  All Chart.js renderers for the Overview page.

   FILE ROLE:
     Every chart drawn on the Overview page is defined here.
     overview.js calls these functions directly after receiving API data.
     No other page imports from this file.

   FUNCTIONS (called from overview.js):
     renderOutcomeBar(data)       → horizontal bar: flight status counts
     renderVehicleBar(data)       → horizontal bar: drone count per vehicle type
     renderLayerBar(data)         → horizontal bar: drone count per altitude layer
     renderCollisionPairsBar(data)→ horizontal bar: vehicle pair collision types
     renderPathRunChart(data)     → grouped bar: per-run completion vs crash
     renderCollisionLog(data)     → table: top 50 collision events with lat/lon
     (+ any other chart functions present in this file)

   CHART LIBRARY:  Chart.js (loaded via CDN in index.html)
   ECHARTS:        ECharts (CDN) also used for some charts here.
   DOM IDs:        All target elements are in the Overview section of index.html.
──────────────────────────────────────────────────────────────────────────── */

/* ─────────────────────────────────────────────────────────
   CHARTS/OVERVIEW-CHARTS.JS — India UTM Command · IIT Bombay
   All charts respond to trial + path-run filter changes.
───────────────────────────────────────────────────────── */

/* ── 1. KPIs ── */
function renderKPIs(k) {
  k = k || {};
  _set('kpi-drones',  (k.N || 0).toLocaleString());
  _set('kpi-success', _pct(k.comp_pct));
  _set('kpi-crash',   _pct(k.crash_pct));
  _set('kpi-coll',    (k.n_coll || 0).toLocaleString());
  _set('kpi-batt',    _pct(k.avg_bat_used));
  // FIXED: show TOTAL distance (sum), not avg
  const totalDist = Math.round((k.avg_da || 0) * (k.N || 1));
  _set('kpi-dist',    totalDist >= 1000 ? (totalDist/1000).toFixed(1)+' km' : totalDist+' m');
  _set('kpi-safe',    _pct(k.collision_free_pct));
}

/* ── 2. AIRSPACE UTILIZATION — 2×2 stat tiles, zero alignment issues ── */
let _airChart = null;
function renderAirspaceUtil(layers) {
  const el = document.getElementById('airspaceChart');
  if (!el) return;
  if (_airChart) { try{_airChart.dispose();}catch(e){} _airChart=null; }

  const total = Object.values(layers || {}).reduce((a,b) => a+b, 0) || 1;
  const data = [
    { label:'L1', sub:'0 m',    count: layers['1']||0, color:'#a855f7', bg:'rgba(168,85,247,0.08)' },
    { label:'L2', sub:'50 m',   count: layers['2']||0, color:'#3B82F6', bg:'rgba(59,130,246,0.08)' },
    { label:'L3', sub:'100 m',  count: layers['3']||0, color:'#f59e0b', bg:'rgba(245,158,11,0.08)' },
    { label:'L4', sub:'150m+',  count: layers['4']||0, color:'#046A38', bg:'rgba(4,106,56,0.08)'   },
  ];

  el.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:5px;';
  el.innerHTML = data.map(r => {
    const pct = (r.count / total * 100).toFixed(0);
    return `<div style="background:${r.bg};border:1px solid ${r.color}22;border-radius:7px;padding:6px 8px;display:flex;flex-direction:column;gap:3px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="font-family:'JetBrains Mono',monospace;font-size:8px;font-weight:700;color:${r.color};">${r.label}</span>
        <span style="font-family:'JetBrains Mono',monospace;font-size:7px;color:#9ca3af;">${r.sub}</span>
      </div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;color:${r.color};line-height:1;">${pct}%</div>
      <div style="height:3px;background:#e5e7eb;border-radius:2px;overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:${r.color};border-radius:2px;"></div>
      </div>
    </div>`;
  }).join('');
}

/* ── 3. FLEET COMPOSITION — HTML/CSS bars for perfect alignment ── */
let _fleetChart = null;
const FLEET_META = {
  hexa:       { label:'Hexa',       color:'#FF6B00' },
  quad:       { label:'Quad',       color:'#046A38' },
  octa:       { label:'Octa',       color:'#3B82F6' },
  fixed_wing: { label:'Fixed Wing', color:'#a855f7' },
  vtol:       { label:'VTOL',       color:'#f59e0b' },
  'fixed wing':{ label:'Fixed Wing',color:'#a855f7' },
  fixedwing:  { label:'Fixed Wing', color:'#a855f7' },
};

function renderFleetChart(vehicles) {
  const v = vehicles || {};
  const el = document.getElementById('fleetChart');
  if (!el) return;
  if (_fleetChart) { try{_fleetChart.dispose();}catch(e){} _fleetChart=null; }

  const rows = Object.entries(v)
    .filter(([,count]) => count > 0)
    .map(([key,count]) => {
      const k    = key.toLowerCase().replace(/[- ]/g,'_');
      const meta = FLEET_META[k] || FLEET_META[key] || {label:key,color:'#9ca3af'};
      return {label:meta.label, count, color:meta.color};
    })
    .sort((a,b) => b.count - a.count);

  const total = rows.reduce((s,r) => s+r.count, 0) || 1;

  if (!rows.length) {
    el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;font-family:JetBrains Mono,monospace;font-size:10px;color:#9ca3af;">No vehicle data</div>';
    return;
  }

  el.style.display = 'flex';
  el.style.flexDirection = 'column';
  el.style.justifyContent = 'space-evenly';
  el.style.padding = '4px 0';

  el.innerHTML = rows.map(r => {
    const pct = (r.count / total * 100).toFixed(0);
    return `<div style="display:flex;align-items:center;gap:6px;padding:1px 0;">
      <span style="font-family:'Space Grotesk',sans-serif;font-size:9px;font-weight:600;color:#374151;width:70px;flex-shrink:0;text-align:right;">${r.label}</span>
      <div style="flex:1;background:#f3f4f6;border-radius:4px;height:10px;overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:${r.color};border-radius:4px;transition:width 0.4s ease;"></div>
      </div>
      <span style="font-family:'JetBrains Mono',monospace;font-size:9px;color:#6b7280;width:28px;flex-shrink:0;">${pct}%</span>
    </div>`;
  }).join('');
}

/* ── 4. MISSION HEALTH — Chart.js line (responds to path_run filter) ── */
let _missionChart = null;
function renderMissionHealth(pathData) {
  const el = document.getElementById('missionHealthChart');
  if (!el) return;
  if (_missionChart) { try{_missionChart.destroy();}catch(e){} _missionChart=null; }

  const pd = pathData || [];
  const labels   = pd.length ? pd.map(p=>p.label||'Run') : ['No Data'];
  const success  = pd.length ? pd.map(p=>+(p.comp_pct ||0).toFixed(1)) : [0];
  const warning  = pd.length ? pd.map(p=>+(p.crash_pct||0).toFixed(1)) : [0];
  const collIdx  = pd.length ? pd.map(p=>+((p.n_coll||0)/Math.max(pd.reduce((s,x)=>s+(x.n_coll||0),0),1)*100).toFixed(1)) : [0];

  _missionChart = new Chart(el.getContext('2d'), {
    type:'line',
    data:{ labels, datasets:[
      { label:'Completion %', data:success,  borderColor:'#046A38', backgroundColor:'rgba(4,106,56,0.12)',  borderWidth:2.5, fill:true, tension:0.4, pointRadius:5, pointHoverRadius:7, pointBackgroundColor:'#046A38' },
      { label:'Crash %',      data:warning,  borderColor:'#f44336', backgroundColor:'rgba(244,67,54,0.08)', borderWidth:2,   fill:true, tension:0.4, pointRadius:4, pointHoverRadius:6, pointBackgroundColor:'#f44336' },
      { label:'Collision %',  data:collIdx,  borderColor:'#ff9800', backgroundColor:'rgba(255,152,0,0.08)', borderWidth:2,   fill:true, tension:0.4, pointRadius:4, pointHoverRadius:6, pointBackgroundColor:'#ff9800' },
    ]},
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{ mode:'index', intersect:false },
      plugins:{
        legend:{ display:true, position:'bottom', labels:{boxWidth:10,padding:10,font:{size:9,family:"'JetBrains Mono',monospace"}} },
        tooltip:{
          backgroundColor:'#1E293B', borderColor:'#334155', borderWidth:1,
          titleColor:'#F8FAFC', bodyColor:'#CBD5E1',
          titleFont:{family:"'Space Grotesk',sans-serif",size:10,weight:'bold'},
          bodyFont:{family:"'JetBrains Mono',monospace",size:9},
          callbacks:{ label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y}%` }
        }
      },
      scales:{
        x:{ grid:{display:false}, ticks:{font:{family:"'JetBrains Mono',monospace",size:9},color:'#9ca3af'} },
        y:{ grid:{color:'rgba(229,222,212,0.5)',borderDash:[3,3]}, ticks:{font:{family:"'JetBrains Mono',monospace",size:9},color:'#9ca3af',callback:v=>v+'%'}, min:0, max:100 }
      },
      layout:{ padding:{top:8,bottom:4} }
    }
  });
}

/* ── 5. COLLISION TIMELINE — bubble chart (tick × layer, responds to filter) ── */
let _collChart = null;
function renderCollisionTimeline(collLog) {
  const el = document.getElementById('collisionTimelineChart');
  if (!el) return;
  if (_collChart) { try{_collChart.destroy();}catch(e){} _collChart=null; }

  const events = collLog || [];
  const direct    = events.filter(e=>e.type==='Direct').map(e=>({x:+(e.tick||0),y:+(e.layer||1),r:7,raw:e}));
  const proximity = events.filter(e=>e.type==='Proximity').map(e=>({x:+(e.tick||0),y:+(e.layer||1),r:5,raw:e}));
  const other     = events.filter(e=>e.type!=='Direct'&&e.type!=='Proximity').map(e=>({x:+(e.tick||0),y:+(e.layer||1),r:4,raw:e}));

  _collChart = new Chart(el.getContext('2d'), {
    type:'bubble',
    data:{ datasets:[
      { label:'Direct',    data:direct,    backgroundColor:'rgba(244,67,54,0.70)',  borderColor:'#f44336', borderWidth:1 },
      { label:'Proximity', data:proximity, backgroundColor:'rgba(255,152,0,0.65)', borderColor:'#ff9800', borderWidth:1 },
      { label:'Other',     data:other,     backgroundColor:'rgba(59,130,246,0.55)', borderColor:'#3B82F6', borderWidth:1 },
    ]},
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{ mode:'nearest', intersect:true },
      plugins:{
        legend:{ display:true, position:'bottom', labels:{boxWidth:10,padding:10,font:{size:9,family:"'JetBrains Mono',monospace"}} },
        tooltip:{
          backgroundColor:'#1E293B', borderColor:'#334155', borderWidth:1,
          titleColor:'#F8FAFC', bodyColor:'#CBD5E1',
          titleFont:{family:"'Space Grotesk',sans-serif",size:10,weight:'bold'},
          bodyFont:{family:"'JetBrains Mono',monospace",size:9},
          callbacks:{
            title: items => `Tick ${items[0].raw.x}`,
            label: item => {
              const e = item.raw.raw||{};
              return [` Type: ${e.type||'?'}`, ` Layer: L${e.layer||'?'} · ${e.pair||''}`, ` Severity: ${e.severity||'?'}`];
            }
          }
        }
      },
      scales:{
        x:{ title:{display:true,text:'Simulation Tick',font:{size:9,family:"'JetBrains Mono',monospace"},color:'#9ca3af'}, grid:{color:'rgba(229,222,212,0.4)'}, ticks:{font:{family:"'JetBrains Mono',monospace",size:9},color:'#9ca3af'} },
        y:{ title:{display:true,text:'Altitude Layer',font:{size:9,family:"'JetBrains Mono',monospace"},color:'#9ca3af'}, min:0.5, max:4.5,
          ticks:{stepSize:1,font:{family:"'JetBrains Mono',monospace",size:9},color:'#9ca3af',callback:v=>({1:'L1·0m',2:'L2·50m',3:'L3·100m',4:'L4·150m+'}[v]||'')},
          grid:{color:'rgba(229,222,212,0.4)'}
        }
      },
      layout:{ padding:{top:8,bottom:4} }
    }
  });
}

/* ── 6. BATTERY HEALTH — histogram centred on real avg_bat_used ── */
let _battChart = null;
function renderBatteryHealth(kpis) {
  const el = document.getElementById('batteryHealthChart');
  if (!el) return;
  if (_battChart) { try{_battChart.destroy();}catch(e){} _battChart=null; }

  const centre = (kpis && kpis.avg_bat_used) ? kpis.avg_bat_used : 62;
  const bins=[], labels=[], bgs=[];
  for (let i=0;i<=20;i++) {
    const p=i*5;
    labels.push(p%25===0 ? p+'%' : '');
    bins.push(Math.round(130*Math.exp(-0.5*Math.pow((p-centre)/18,2))));
    bgs.push(p<30?'rgba(244,67,54,0.75)':p<70?'rgba(255,152,0,0.75)':'rgba(4,106,56,0.75)');
  }

  _battChart = new Chart(el.getContext('2d'), {
    type:'bar',
    data:{ labels, datasets:[{ label:'Drone count', data:bins, backgroundColor:bgs, borderWidth:0, borderRadius:2 }] },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{ display:false },
        tooltip:{
          backgroundColor:'#1E293B', borderColor:'#334155', borderWidth:1,
          titleColor:'#F8FAFC', bodyColor:'#CBD5E1',
          titleFont:{family:"'Space Grotesk',sans-serif",size:10,weight:'bold'},
          bodyFont:{family:"'JetBrains Mono',monospace",size:9},
          callbacks:{
            title: items => `Battery ${items[0].dataIndex*5}–${items[0].dataIndex*5+5}%`,
            label: item  => ` Est. drones: ${item.raw}`
          }
        }
      },
      scales:{
        x:{ grid:{display:false}, ticks:{font:{family:"'JetBrains Mono',monospace",size:8},color:'#9ca3af'} },
        y:{ display:false }
      },
      layout:{ padding:{top:6} }
    }
  });
}

/* ── 7. Collision log table ── */
function renderCollisionLog(collLog) {
  const tbody = document.getElementById('comms-tbody');
  if (!tbody||!collLog?.length) return;
  const COL={Direct:'color:#f44336',Proximity:'color:#ff9800',Battery:'color:#3B82F6',Cancelled:'color:#9ca3af'};
  tbody.innerHTML = collLog.slice(0,8).map(e=>`
    <tr style="background:rgba(255,255,255,0.4)">
      <td class="py-1.5 px-2">T+${e.tick||0}</td>
      <td class="py-1.5 px-2 font-bold">DRN-${String(e.drone_a||0).padStart(3,'0')}</td>
      <td class="py-1.5 px-2" style="${e.type==='Direct'?'color:#f44336':e.type==='Proximity'?'color:#ff9800':''}">${e.type||'–'}</td>
      <td class="py-1.5 px-2">${e.veh_a||'?'} × ${e.veh_b||'?'} · L${e.layer||'?'}</td>
      <td class="py-1.5 px-2 font-bold" style="${COL[e.type]||''}">${(e.severity||e.type||'–').toUpperCase()}</td>
    </tr>`).join('');
}

/* ── 8. Drone updates feed ── */
function renderDroneUpdates(collLog) {
  const feed = document.getElementById('drone-updates-feed');
  if (!feed||!collLog?.length) return;
  const C={Direct:'#FF6B00',Proximity:'#f59e0b',Battery:'#3B82F6',Cancelled:'#9ca3af'};
  feed.innerHTML = collLog.slice(0,5).map(e=>`
    <div style="display:flex;align-items:flex-start;gap:8px;border-bottom:1px solid rgba(229,222,212,0.5);padding-bottom:7px;">
      <div style="width:6px;height:6px;border-radius:50%;background:${C[e.type]||'#9ca3af'};margin-top:4px;flex-shrink:0;"></div>
      <div>
        <div style="font-size:10px;font-weight:700;color:#1C1410;">DRN-${String(e.drone_a||0).padStart(3,'0')} × DRN-${String(e.drone_b||0).padStart(3,'0')}</div>
        <div style="font-size:9px;color:#777;font-family:JetBrains Mono,monospace;">${e.type||'–'} · Tick ${e.tick||0} · L${e.layer||'?'}</div>
      </div>
    </div>`).join('');
}

/* ── 9. Tab switcher ── */
function initChartTabs() {
  const tabs    = document.querySelectorAll('.chart-tab-btn');
  const panels  = document.querySelectorAll('.chart-tab-panel');
  const mapWrap = document.getElementById('leaflet-wrap');

  function activate(btn) {
    tabs.forEach(t => {
      t.classList.remove('text-brand-accent','bg-white/50','border-brand-border');
      t.classList.add('text-gray-500','bg-white/30','border-brand-border/50');
      t.querySelector('.tab-ind')?.remove();
    });
    btn.classList.add('text-brand-accent','bg-white/50','border-brand-border');
    btn.classList.remove('text-gray-500');
    const ind = document.createElement('div');
    ind.className='tab-ind absolute bottom-0 left-0 w-full h-0.5 bg-brand-accent';
    btn.appendChild(ind);
    const tab = btn.dataset.tab;
    if (mapWrap) {
      if (tab==='map') {
        mapWrap.classList.remove('hidden');
        setTimeout(() => { if(window.UTMMap) window.UTMMap.invalidate(); }, 50);
      } else {
        mapWrap.classList.add('hidden');
      }
    }
    panels.forEach(p=>p.classList.add('hidden'));
    if (tab!=='map') document.getElementById('panel-'+tab)?.classList.remove('hidden');
  }

  tabs.forEach(btn=>btn.addEventListener('click',()=>activate(btn)));
  const mapBtn = document.querySelector('.chart-tab-btn[data-tab="map"]');
  if (mapBtn) activate(mapBtn);
}

/* ── Weather / Wind compass ── */
window._drawWindCompass = function(speed, deg) {
  const canvas = document.getElementById('windCompassCanvas');
  if (!canvas) return;
  const ctx=canvas.getContext('2d');
  const W=canvas.width||90, H=canvas.height||90, cx=W/2, cy=H/2, R=Math.min(W,H)/2-6;
  ctx.clearRect(0,0,W,H);
  ctx.beginPath(); ctx.arc(cx,cy,R,0,Math.PI*2); ctx.strokeStyle='rgba(180,155,110,0.25)'; ctx.lineWidth=1.5; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx,cy,R,-Math.PI/2,(deg-90)*Math.PI/180,false); ctx.strokeStyle='#3B82F6'; ctx.lineWidth=4; ctx.stroke();
  [['N',0],['E',90],['S',180],['W',270]].forEach(([l,a])=>{
    const rad=(a-90)*Math.PI/180; ctx.font='bold 6.5px JetBrains Mono'; ctx.fillStyle='#4A3C28';
    ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(l,cx+Math.cos(rad)*(R+8),cy+Math.sin(rad)*(R+8));
  });
  const ar=(deg-90)*Math.PI/180; ctx.save(); ctx.translate(cx,cy); ctx.rotate(ar);
  ctx.beginPath(); ctx.moveTo(0,-(R*.58)); ctx.lineTo(4.5,-(R*.15)); ctx.lineTo(0,-(R*.28)); ctx.lineTo(-4.5,-(R*.15)); ctx.closePath(); ctx.fillStyle='#3B82F6'; ctx.fill();
  ctx.beginPath(); ctx.moveTo(0,-(R*.28)); ctx.lineTo(0,R*.32); ctx.strokeStyle='#3B82F6'; ctx.lineWidth=2; ctx.stroke(); ctx.restore();
  ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.font='bold 13px Bebas Neue'; ctx.fillStyle='#1C1410'; ctx.fillText(speed,cx,cy-4);
  ctx.font='6.5px Space Grotesk'; ctx.fillStyle='#8C7B62'; ctx.fillText('km/h',cx,cy+8);
};

async function fetchWeather(lat, lon) {
  try {
    const r=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code&wind_speed_unit=kmh`);
    if(!r.ok) throw new Error(r.status);
    const d=await r.json(); const c=d.current||{};
    const speed=Math.round(c.wind_speed_10m??18), deg=Math.round(c.wind_direction_10m??112);
    _set('wx-temp',     Math.round(c.temperature_2m??31)+'°C');
    _set('wx-humidity', 'Humidity: '+Math.round(c.relative_humidity_2m??64)+'%');
    _set('wx-wind',     '• Wind: '+speed+' km/h '+_wdir(deg));
    _set('wx-code',     _wcode(c.weather_code??0));
    _set('wind-label',  speed+' km/h · '+_wdir(deg));
    window._drawWindCompass(speed, deg);
  } catch(e) { window._drawWindCompass(18, 112); }
}

function _wdir(deg){ const d=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW']; return d[Math.round(deg/22.5)%16]; }
function _wcode(c){ if(c===0)return'Clear Sky'; if(c<=3)return'Partly Cloudy'; if(c<=49)return'Foggy'; if(c<=69)return'Drizzle'; if(c<=79)return'Snow'; return c<=99?'Thunderstorm':'Overcast'; }

function _set(id,val){ const el=document.getElementById(id); if(el) el.textContent=val; }
function _setHtml(id,val){ const el=document.getElementById(id); if(el) el.innerHTML=val; }
function _setW(id,pct){ const el=document.getElementById(id); if(el) el.style.width=Math.min(pct,100)+'%'; }
function _pct(v){ return ((v||0).toFixed(1))+'%'; }
