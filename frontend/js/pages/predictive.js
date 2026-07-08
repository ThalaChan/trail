/* ─────────────────────────────────────────────────────────────────────────────
   pages/predictive.js  —  Predictive (ML Risk) page.

   FILE ROLE:
     Renders the ML risk page from the /ml_risk API response.
     If scikit-learn is not installed on the server, ml.error is set
     and _showError() renders an error state in every chart panel.
     The vehicle_radar and conflict_escalation sections still render
     if the ML section fails.

   API DATA CONSUMED:
     /api/trial/{tid}/ml_risk returns EXACTLY:
     ml: { drones:[{id,x,y,layer,risk_score,risk_tier,anomaly,status,bat_s,da,crashed}],
           feature_importance:{Battery at Launch:float, Altitude Layer:float, Distance Flown:float},
           risk_tiers:{ High:int, Medium:int, Low:int },
           total_analyzed:int,
           confusion:{ tp,fp,tn,fn },
           n_anomalies:int }
     vehicle_radar: { vehicles:[{vehicle,completion,bat_endurance,energy_eff,reserve,reliability}],
                      axes:[...] }
     conflict_escalation: { pairs:[{pair,n_events,escalated,final,first_tick,last_tick}], ticks:[] }
*/
const PredictivePage = (() => {
  let _tierChart = null;

  function render(data) {
    data = data || {};
    const ml = data.ml || {};
    const vr = data.vehicle_radar || {};
    const ce = data.conflict_escalation || {};

    if (ml.error) {
      ['p-risk-forecast','p-demand-forecast','p-congestion-heatmap',
       'p-event-table','p-resource-chart','p-model-table'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = `<div class="text-xs text-gray-400 text-center pt-8 px-4">${ml.error}</div>`;
      });
      return;
    }

    _updateKPIs(ml);
    _renderRiskTierBars(ml);       // p-risk-forecast
    _renderFeatureImportance(ml);  // p-demand-forecast
    _renderCongestionChart(ml);    // p-congestion-heatmap  ← FIXED
    _renderConfusionMetrics(ml);   // p-event-table
    _renderVehicleRadar(vr);       // p-resource-chart
    _renderEscalationList(ce);     // p-model-table
    _renderSimOutcomes(ml);        // sim-gauge + sim-* IDs  ← FIXED (no more innerHTML wipe)
    _wireSimulator(ml);            // Run Simulation button
  }

  /* ── KPIs ── */
  function _updateKPIs(ml) {
    const conf  = ml.confusion || {};
    const denom = (conf.tp||0)+(conf.tn||0)+(conf.fp||0)+(conf.fn||0) || 1;
    _set('p-kpi-accuracy',    denom>1 ? ((conf.tp+conf.tn)/denom*100).toFixed(1)+'%' : '—');
    _set('p-kpi-events',      (ml.total_analyzed||0).toLocaleString());
    _set('p-kpi-alerts',      (ml.risk_tiers?.High||0).toLocaleString());
    _set('p-kpi-models',      '2');
    _set('p-kpi-datapoints',  (ml.total_analyzed||0).toLocaleString());
    _set('p-kpi-updated',     new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}));
    _set('p-kpi-updated-date',new Date().toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}));
  }

  /* ── 1. Risk Tier Bars — p-risk-forecast ── */
  function _renderRiskTierBars(ml) {
    const el = document.getElementById('p-risk-forecast'); if (!el) return;
    if (_tierChart) { try { _tierChart.destroy(); } catch(e) {} _tierChart = null; }
    el.innerHTML = '<canvas id="p-tier-c" style="width:100%;height:100%;"></canvas>';
    const cv = document.getElementById('p-tier-c'); if (!cv) return;
    const tiers = ml.risk_tiers || {};
    const total = ml.total_analyzed || 1;
    const ORDER = ['High','Medium','Low'];
    const COLS  = { High:'rgba(244,67,54,0.8)', Medium:'rgba(255,152,0,0.8)', Low:'rgba(4,106,56,0.8)' };
    _tierChart = new Chart(cv.getContext('2d'), { type:'bar',
      data:{ labels:ORDER, datasets:[
        { label:'Drone Count', data:ORDER.map(t=>tiers[t]||0), backgroundColor:ORDER.map(t=>COLS[t]), borderRadius:5, borderWidth:0 },
        { type:'line', label:'Proportion (%)', data:ORDER.map(t=>+((tiers[t]||0)/total*100).toFixed(1)),
          borderColor:'#3B82F6', borderWidth:2, pointRadius:5, pointBackgroundColor:'#3B82F6', fill:false, yAxisID:'y2' },
      ]},
      options:{ responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
        plugins:{ legend:{display:true,position:'top',labels:{boxWidth:10,font:{size:9,family:"'JetBrains Mono',monospace"}}},
          tooltip:{backgroundColor:'#1E293B',borderColor:'#334155',borderWidth:1,padding:{top:8,right:12,bottom:8,left:12},titleColor:'#F8FAFC',bodyColor:'#CBD5E1',titleFont:{family:"'Space Grotesk',sans-serif",size:11,weight:'bold'},bodyFont:{family:"'JetBrains Mono',monospace",size:10},cornerRadius:8,boxPadding:4,
            callbacks:{label:ctx=>` ${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString()}`}} },
        scales:{
          x:{ grid:{display:false}, ticks:{font:{family:"'JetBrains Mono',monospace",size:10},color:'#374151'} },
          y:{ grid:{color:'rgba(229,222,212,0.5)',borderDash:[3,3]}, ticks:{font:{family:"'JetBrains Mono',monospace",size:8},color:'#9ca3af'}, min:0,
              title:{display:true,text:'Drone Count',font:{size:8},color:'#9ca3af'} },
          y2:{ position:'right', grid:{display:false}, ticks:{font:{family:"'JetBrains Mono',monospace",size:8},color:'#3B82F6',callback:v=>v+'%'}, min:0 }
        }, layout:{padding:{top:8,bottom:4}} }
    });
  }

  /* ── 2. Feature Importance — p-demand-forecast ── */
  function _renderFeatureImportance(ml) {
    const el = document.getElementById('p-demand-forecast'); if (!el) return;
    el.innerHTML = '<canvas id="p-feat-c" style="width:100%;height:100%;"></canvas>';
    const cv = document.getElementById('p-feat-c'); if (!cv) return;
    const fi = ml.feature_importance || {};
    if (!Object.keys(fi).length) { el.innerHTML = '<div class="text-xs text-gray-400 text-center pt-8">No feature data</div>'; return; }
    const sorted = Object.entries(fi).sort((a,b) => b[1]-a[1]);
    new Chart(cv.getContext('2d'), { type:'bar',
      data:{ labels:sorted.map(([k])=>k), datasets:[{ label:'Importance',
        data:sorted.map(([,v])=>+(v*100).toFixed(1)),
        backgroundColor:sorted.map((_,i)=>i===0?'rgba(59,130,246,0.85)':i<2?'rgba(59,130,246,0.65)':'rgba(59,130,246,0.40)'),
        borderRadius:3, borderWidth:0 }] },
      options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false},
          tooltip:{backgroundColor:'#1E293B',borderColor:'#334155',borderWidth:1,padding:{top:8,right:12,bottom:8,left:12},titleColor:'#F8FAFC',bodyColor:'#CBD5E1',titleFont:{family:"'Space Grotesk',sans-serif",size:11,weight:'bold'},bodyFont:{family:"'JetBrains Mono',monospace",size:10},cornerRadius:8,boxPadding:4,
            callbacks:{label:ctx=>` ${ctx.raw}%`}} },
        scales:{
          x:{ title:{display:true,text:'Importance (%)',font:{size:8},color:'#9ca3af'}, grid:{color:'rgba(229,222,212,0.5)',borderDash:[3,3]}, ticks:{font:{family:"'JetBrains Mono',monospace",size:8},color:'#9ca3af',callback:v=>v+'%'} },
          y:{ grid:{display:false}, ticks:{font:{family:'Space Grotesk,sans-serif',size:9},color:'#374151'} }
        }, layout:{padding:{top:4,right:40,bottom:4}} }
    });
  }

  /* ── 3. Congestion Probability Chart — p-congestion-heatmap ── FIXED
     Problem: drones have no x/y in this dataset, single dot shows.
     Fix: Show a meaningful risk-score distribution histogram using drone risk_scores.
     If drones have risk_score data → histogram of score distribution coloured by tier.
     Always has data since ml.drones is populated by ML model. */
  function _renderCongestionChart(ml) {
    const el = document.getElementById('p-congestion-heatmap');
    if (!el || typeof echarts === 'undefined') return;
    let c = echarts.getInstanceByDom(el); if (c) c.dispose(); c = echarts.init(el);

    const drones = ml.drones || [];
    const tiers  = ml.risk_tiers || {};
    const total  = ml.total_analyzed || 1;

    // Try histogram of risk_score (0–1) across all drones
    const scores = drones.map(d => d.risk_score).filter(s => s != null && !isNaN(s));

    if (scores.length > 10) {
      // Build 10-bin histogram
      const BINS = 10;
      const binCounts = Array(BINS).fill(0);
      const binColors = [];
      scores.forEach(s => {
        const i = Math.min(Math.floor(s * BINS), BINS-1);
        binCounts[i]++;
      });
      binColors.push(...binCounts.map((_,i) => {
        const mid = (i + 0.5) / BINS;
        return mid >= 0.6 ? 'rgba(244,67,54,0.82)'
             : mid >= 0.3 ? 'rgba(255,152,0,0.82)'
             :               'rgba(4,106,56,0.82)';
      }));
      const labels = Array.from({length:BINS}, (_,i) => `${(i*10).toFixed(0)}–${((i+1)*10).toFixed(0)}%`);
      c.setOption({
        backgroundColor: 'transparent',
        tooltip: { trigger:'axis', axisPointer:{type:'shadow'}, backgroundColor:'#1E293B', borderColor:'#334155', borderWidth:1, textStyle:{fontFamily:'JetBrains Mono',fontSize:10,color:'#F8FAFC'}, extraCssText:'border-radius:8px;padding:8px 12px;',
          formatter: p => `Risk Score ${p[0].name}<br><b>${p[0].value.toLocaleString()}</b> drones` },
        grid: { top:12, bottom:48, left:44, right:12 },
        xAxis: { type:'category', data:labels, axisLabel:{fontFamily:'JetBrains Mono',fontSize:7.5,color:'#9ca3af',rotate:30}, axisLine:{lineStyle:{color:'#E5DED4'}}, axisTick:{show:false} },
        yAxis: { type:'value', axisLabel:{fontFamily:'JetBrains Mono',fontSize:8,color:'#6b7280'}, splitLine:{lineStyle:{color:'rgba(229,222,212,0.4)',type:'dashed'}}, name:'Drones', nameTextStyle:{fontFamily:'JetBrains Mono',fontSize:7,color:'#9ca3af'} },
        series:[{ type:'bar', data:binCounts.map((v,i)=>({value:v,itemStyle:{color:binColors[i],borderRadius:[3,3,0,0]}})),
          barMaxWidth:28,
          label:{show:true,position:'top',formatter:p=>p.value>0?p.value:'',fontFamily:'JetBrains Mono',fontSize:8,color:'#374151'} }]
      });
    } else {
      // Fallback: tier bar chart
      c.setOption({
        backgroundColor: 'transparent',
        tooltip: { trigger:'axis', axisPointer:{type:'shadow'}, backgroundColor:'#1E293B', borderColor:'#334155', borderWidth:1, textStyle:{fontFamily:'JetBrains Mono',fontSize:10,color:'#F8FAFC'}, extraCssText:'border-radius:8px;padding:8px 12px;' },
        grid: { top:12, bottom:36, left:52, right:12 },
        xAxis: { type:'category', data:['High','Medium','Low'], axisLabel:{fontFamily:'Space Grotesk',fontSize:10,color:'#374151'}, axisLine:{lineStyle:{color:'#E5DED4'}}, axisTick:{show:false} },
        yAxis: { type:'value', axisLabel:{fontFamily:'JetBrains Mono',fontSize:8,color:'#6b7280'}, splitLine:{lineStyle:{color:'rgba(229,222,212,0.4)',type:'dashed'}} },
        series:[{ type:'bar', data:[
          {value:tiers.High||0,   itemStyle:{color:'rgba(244,67,54,0.82)',  borderRadius:[4,4,0,0]}},
          {value:tiers.Medium||0, itemStyle:{color:'rgba(255,152,0,0.82)',  borderRadius:[4,4,0,0]}},
          {value:tiers.Low||0,    itemStyle:{color:'rgba(4,106,56,0.82)',   borderRadius:[4,4,0,0]}},
        ], barMaxWidth:44,
          label:{show:true,position:'top',formatter:p=>p.value.toLocaleString(),fontFamily:'JetBrains Mono',fontSize:11,color:'#374151',fontWeight:'bold'} }]
      });
    }
    window.addEventListener('resize', () => c.resize());
  }

  /* ── 4. Confusion Matrix Metrics table — p-event-table ── */
  function _renderConfusionMetrics(ml) {
    const el = document.getElementById('p-event-table'); if (!el) return;
    const conf  = ml.confusion || {};
    const denom = (conf.tp||0)+(conf.tn||0)+(conf.fp||0)+(conf.fn||0) || 1;
    const acc   = ((conf.tp+conf.tn)/denom*100).toFixed(1);
    const prec  = (conf.tp+conf.fp)>0 ? (conf.tp/(conf.tp+conf.fp)*100).toFixed(1) : '—';
    const rec   = (conf.tp+conf.fn)>0 ? (conf.tp/(conf.tp+conf.fn)*100).toFixed(1) : '—';
    const rows  = [
      ['Accuracy',      acc+'%',                       '#046A38'],
      ['Precision',     prec+(prec!=='—'?'%':''),       '#3B82F6'],
      ['Recall',        rec+(rec!=='—'?'%':''),          '#ff9800'],
      ['True Positive', (conf.tp||0).toLocaleString(),  '#046A38'],
      ['True Negative', (conf.tn||0).toLocaleString(),  '#9ca3af'],
      ['False Positive',(conf.fp||0).toLocaleString(),  '#f44336'],
      ['False Negative',(conf.fn||0).toLocaleString(),  '#f44336'],
      ['Anomalies',     (ml.n_anomalies||0).toLocaleString(), '#a855f7'],
    ];
    el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:9px;font-family:JetBrains Mono,monospace;">
      <thead><tr style="border-bottom:1px solid #E5DED4;">
        <th style="text-align:left;padding:5px 4px;color:#9ca3af;font-size:8px;text-transform:uppercase;">Metric</th>
        <th style="text-align:right;padding:5px 4px;color:#9ca3af;font-size:8px;">Value</th>
      </tr></thead>
      <tbody>
        ${rows.map(([l,v,col])=>`<tr style="border-bottom:1px solid rgba(229,222,212,0.3);">
          <td style="padding:5px 4px;color:#374151;font-family:Space Grotesk,sans-serif;font-weight:500;">${l}</td>
          <td style="padding:5px 4px;text-align:right;font-weight:700;color:${col};">${v}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  }

  /* ── 5. Vehicle Performance Radar — p-resource-chart ── */
  function _renderVehicleRadar(vr) {
    const el = document.getElementById('p-resource-chart');
    if (!el || typeof echarts === 'undefined') return;
    let c = echarts.getInstanceByDom(el); if (c) c.dispose(); c = echarts.init(el);
    const vehicles = vr.vehicles || [];
    const axes     = vr.axes || ['Completion','Bat Endurance','Energy Efficiency','Reserve at Landing','Launch Reliability'];
    if (!vehicles.length) { el.innerHTML = '<div class="text-xs text-gray-400 text-center pt-8">No vehicle data</div>'; return; }
    const COLORS = ['#046A38','#3B82F6','#FF6B00','#f44336','#a855f7'];
    c.setOption({
      backgroundColor: 'transparent',
      tooltip:{ backgroundColor:'#1E293B',borderColor:'#334155',borderWidth:1,textStyle:{fontFamily:'JetBrains Mono',fontSize:10,color:'#F8FAFC'},extraCssText:'border-radius:8px;padding:8px 12px;' },
      legend:{ data:vehicles.map(v=>v.vehicle), bottom:0, itemWidth:8, itemHeight:8, textStyle:{fontFamily:'JetBrains Mono',fontSize:8,color:'#6b7280'} },
      radar:{ indicator:axes.map(a=>({name:a,max:100})), center:['50%','46%'], radius:'56%',
        splitLine:{lineStyle:{color:'rgba(229,222,212,0.5)'}},
        axisLine:{lineStyle:{color:'#E5DED4'}},
        axisName:{fontFamily:'Space Grotesk',fontSize:7.5,color:'#6b7280'} },
      series:[{ type:'radar',
        data:vehicles.map((v,i)=>({
          name:v.vehicle,
          value:[v.completion,v.bat_endurance,v.energy_eff,v.reserve,v.reliability],
          areaStyle:{color:COLORS[i%COLORS.length]+'28'},
          lineStyle:{color:COLORS[i%COLORS.length],width:2},
          symbol:'circle', symbolSize:4
        })) }]
    });
    window.addEventListener('resize', () => c.resize());
  }

  /* ── 6. Escalation Table — p-model-table ── */
  function _renderEscalationList(ce) {
    const el = document.getElementById('p-model-table'); if (!el) return;
    const pairs = (ce.pairs||[]).slice(0,15);
    if (!pairs.length) { el.innerHTML = '<div class="text-xs text-gray-400 text-center pt-4">No escalation data</div>'; return; }
    el.innerHTML = `<div style="overflow-y:auto;max-height:240px;">
      <table style="width:100%;border-collapse:collapse;font-size:9px;font-family:JetBrains Mono,monospace;">
        <thead><tr style="border-bottom:1px solid #E5DED4;position:sticky;top:0;background:#FAF7F2;">
          <th style="text-align:left;padding:3px 4px;color:#9ca3af;font-size:8px;text-transform:uppercase;">Pair</th>
          <th style="padding:3px 4px;color:#9ca3af;font-size:8px;text-align:center;">Events</th>
          <th style="padding:3px 4px;color:#9ca3af;font-size:8px;text-align:center;">Final</th>
          <th style="padding:3px 4px;color:#9ca3af;font-size:8px;text-align:center;">Escalated</th>
        </tr></thead>
        <tbody>
          ${pairs.map(p => {
            const col = p.escalated ? '#f44336' : p.final==='Critical' ? '#FF6B00' : '#9ca3af';
            return `<tr style="border-bottom:1px solid rgba(229,222,212,0.3);">
              <td style="padding:3px 4px;color:#374151;font-family:Space Grotesk,sans-serif;">${p.pair}</td>
              <td style="padding:3px 4px;text-align:center;color:#374151;">${p.n_events}</td>
              <td style="padding:3px 4px;text-align:center;font-weight:700;color:${col};">${p.final}</td>
              <td style="padding:3px 4px;text-align:center;">${p.escalated
                ? '<span style="color:#f44336;font-weight:700;">Yes</span>' : 'No'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
  }

  /* ── 7. Simulation Outcomes — FIXED ──
     Does NOT wipe sim-outcomes innerHTML (that destroys the gauge + card structure).
     Instead populates the individual named IDs and renders the sim-gauge. */
  function _renderSimOutcomes(ml) {
    const total  = ml.total_analyzed || 0;
    const anoms  = ml.n_anomalies    || 0;
    const tiers  = ml.risk_tiers     || {};
    const conf   = ml.confusion      || {};
    const denom  = (conf.tp||0)+(conf.tn||0)+(conf.fp||0)+(conf.fn||0) || 1;
    const accPct = denom>1 ? +((conf.tp+conf.tn)/denom*100).toFixed(0) : 0;
    const highPct = total>0 ? +((tiers.High||0)/total*100).toFixed(0) : 0;

    // Populate metric cards (existing HTML elements)
    _set('sim-missions',       total.toLocaleString());
    _set('sim-missions-delta', `${(tiers.Low||0).toLocaleString()} low risk`);
    _set('sim-alerts',         (tiers.High||0).toLocaleString());
    _set('sim-alerts-delta',   `${highPct}% of fleet`);
    _set('sim-peak',           anoms.toLocaleString());
    _set('sim-confidence',     accPct+'%');
    _set('sim-risk-label',     highPct > 20 ? 'High Risk' : highPct > 10 ? 'Elevated' : 'Moderate');
    _set('sim-risk-label2',    'model accuracy');

    // Render sim-gauge (ECharts arc gauge)
    const gaugeEl = document.getElementById('sim-gauge');
    if (gaugeEl && typeof echarts !== 'undefined') {
      let gc = echarts.getInstanceByDom(gaugeEl);
      if (gc) gc.dispose();
      gc = echarts.init(gaugeEl);
      const riskScore = Math.min(100, Math.round(highPct * 3));
      const riskColor = riskScore > 60 ? '#f44336' : riskScore > 30 ? '#ff9800' : '#046A38';
      gc.setOption({
        backgroundColor: 'transparent',
        series:[{ type:'gauge', startAngle:200, endAngle:-20,
          radius:'95%', center:['50%','58%'], min:0, max:100, splitNumber:0,
          axisLine:{lineStyle:{width:10,color:[[riskScore/100,riskColor],[1,'#f3f4f6']]}},
          pointer:{show:false}, axisTick:{show:false}, splitLine:{show:false}, axisLabel:{show:false},
          detail:{offsetCenter:[0,'15%'],
            rich:{v:{fontFamily:'Bebas Neue',fontSize:18,color:'#1C1410'}},
            formatter:`{v|${riskScore}}`},
          data:[{value:riskScore}]
        }]
      });
    }
  }

  /* ── 8. Wire Simulator button — filters from real ml drone-level data only ── */
  function _wireSimulator(ml) {
    const btn = document.getElementById('sim-run-btn');
    if (!btn || btn._wired) return;
    btn._wired = true;

    btn.addEventListener('click', () => {
      const drones = ml.drones || [];
      const conf   = ml.confusion || {};
      const base   = ml.total_analyzed || drones.length || 1;

      // Read the three real-data filters
      const layerSel   = document.getElementById('sim-layer')?.value    || 'all';
      const vehicleSel = document.getElementById('sim-vehicle')?.value  || 'all';
      const tierSel    = document.getElementById('sim-risk-thresh')?.value || 'all';

      // Filter directly from drone-level data — all fields are real
      let filtered = drones;
      if (layerSel   !== 'all') filtered = filtered.filter(d => String(d.layer)     === layerSel);
      if (vehicleSel !== 'all') filtered = filtered.filter(d => d.vehicle            === vehicleSel);
      if (tierSel    !== 'all') filtered = filtered.filter(d => d.risk_tier          === tierSel);

      const simTotal   = filtered.length;
      const simCrashed = filtered.filter(d => d.crashed).length;
      const simAnoms   = filtered.filter(d => d.anomaly).length;
      const simHigh    = filtered.filter(d => d.risk_tier === 'High').length;
      const simMed     = filtered.filter(d => d.risk_tier === 'Medium').length;
      const simLow     = filtered.filter(d => d.risk_tier === 'Low').length;

      const highPct = simTotal > 0 ? Math.round(simHigh / simTotal * 100) : 0;
      const crashPct = simTotal > 0 ? (simCrashed / simTotal * 100).toFixed(1) : '0.0';

      // Model accuracy from confusion matrix (unaffected by filters — it's a model metric)
      const simAcc = conf.tp != null
        ? Math.max(0, Math.min(100, Math.round(((conf.tp + conf.tn) / Math.max(base, 1)) * 100)))
        : 0;

      // Populate outcome cards
      _set('sim-missions',       simTotal.toLocaleString());
      _set('sim-missions-delta', `${simCrashed.toLocaleString()} crashed (${crashPct}%)`);
      _set('sim-alerts',         simHigh.toLocaleString());
      _set('sim-alerts-delta',   `${highPct}% of selection`);
      _set('sim-peak',           simAnoms.toLocaleString());
      _set('sim-confidence',     simAcc + '%');
      _set('sim-risk-label',     highPct > 20 ? 'High Risk' : highPct > 10 ? 'Elevated' : 'Moderate');
      _set('sim-risk-label2',    'model accuracy');

      // Update gauge
      const gaugeEl = document.getElementById('sim-gauge');
      if (gaugeEl && typeof echarts !== 'undefined') {
        let gc = echarts.getInstanceByDom(gaugeEl); if (gc) gc.dispose(); gc = echarts.init(gaugeEl);
        const riskScore = Math.min(100, highPct * 3);
        const riskColor = riskScore > 60 ? '#f44336' : riskScore > 30 ? '#ff9800' : '#046A38';
        gc.setOption({ backgroundColor:'transparent',
          series:[{ type:'gauge', startAngle:90, endAngle:-270,
            radius:'85%', center:['50%','50%'], min:0, max:100, splitNumber:0,
            progress:{ show:true, width:8, itemStyle:{color:riskColor} },
            axisLine:{ lineStyle:{ width:8, color:[[1,'#f3f4f6']] } },
            pointer:{show:false}, axisTick:{show:false}, splitLine:{show:false}, axisLabel:{show:false},
            detail:{ valueAnimation:true, offsetCenter:[0,'-8%'],
              formatter: val => `{v|${Math.round(val)}}`,
              rich:{ v:{fontFamily:'Bebas Neue',fontSize:16,color:'#1C1410'} } },
            data:[{ value:riskScore }]
          }]
        });
      }

      // Show active filter summary below button
      const parts = [];
      if (layerSel   !== 'all') parts.push(`Layer ${layerSel}`);
      if (vehicleSel !== 'all') parts.push(vehicleSel);
      if (tierSel    !== 'all') parts.push(`${tierSel} Risk`);
      if (!parts.length) parts.push('All drones');
      parts.push(`→ ${simTotal.toLocaleString()} drones`);
      const infoEl = document.getElementById('sim-filter-info');
      if (infoEl) infoEl.textContent = parts.join(' · ');
    });
  }

  function _set(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
  return { render };
})();
