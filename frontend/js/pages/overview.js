/* ─────────────────────────────────────────────────────────────────────────────
   pages/overview.js  —  Overview page orchestrator.

   FILE ROLE:
     Thin orchestrator. Receives the JSON from API.overview() and
     passes each slice to the chart functions in overview-charts.js.
     Also updates the KPI strip (metric-value elements in the HTML).

   API DATA CONSUMED:
     /api/trial/{tid}/overview
     → {kpis, outcomes, vehicles, layers, coll_log,
        path_run_comparison, collision_pairs}

   CHART CALLS:
     → overview-charts.js functions
     → UTMMap.plotCollisions(coll_log)  (from map.js)

   DOM IDs targeted:  ov-kpi-*, outcome-chart, vehicle-bar-chart,
                      layer-bar-chart, path-run-chart, coll-log-table, …
──────────────────────────────────────────────────────────────────────────── */
const OverviewPage = (() => {
  function render(data) {
    if (!data) return;
    const { kpis, layers, vehicles, path_run_comparison, coll_log } = data;

    // KPI strip — 7 cards from DB
    renderKPIs(kpis);

    // Right column charts — ECharts, respond to real data
    renderAirspaceUtil(layers || {});
    renderFleetChart(vehicles || {});

    // Bottom tab panels — Chart.js, change with selected runs
    renderMissionHealth(path_run_comparison || []);
    renderCollisionTimeline(coll_log || []);
    renderBatteryHealth(kpis || {});        // pass kpis so bell centres on avg_bat_used

    // Live comms table + drone feed
    renderCollisionLog(coll_log || []);
    renderDroneUpdates(coll_log || []);

    // Plot collision markers on Leaflet map
    if (window.UTMMap && coll_log?.length) window.UTMMap.plotCollisions(coll_log);

    // Status bar alert
    const al = document.getElementById('status-alert');
    if (al && kpis) al.textContent = (kpis.crash_pct||0) > 10
      ? `High Crash Rate (${(kpis.crash_pct||0).toFixed(1)}%) — L2 Avoidance Recommended`
      : 'High Density Detected near Academic Zone — L2 Layer';
  }
  return { render };
})();
