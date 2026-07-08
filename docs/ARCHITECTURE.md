# Architecture Reference — UTM Command Dashboard v10

## How a page load works (end-to-end)

```
User connects (PostgreSQL or Excel upload)
        │
        ▼
POST /api/connect/postgres  or  POST /api/connect/excel
        │
        │  main.py: load_postgres() or load_excel()
        │  → normalises column names to internal schema
        │  → stores two Pandas DataFrames in _S dict:
        │      _S["drones"]     — one row per drone flight
        │      _S["collisions"] — one row per collision event
        │      _S["trials"]     — list of trial IDs
        │
        ▼
User picks a trial + path runs from the sidebar dropdown
        │
        ▼
app.js: _loadPage(page)
        │
        │  Calls the matching API method from api.js, e.g.:
        │    API.overview(tid, selPaths)
        │    API.safety(tid, selPaths)
        │    …etc.
        │
        ▼
main.py: GET /api/trial/{tid}/{endpoint}?path_runs=1,2,3
        │
        │  _get(tid, path_runs) filters _S["drones"] and
        │  _S["collisions"] to the requested trial + runs,
        │  then calls enrich() to compute derived columns:
        │    bat_s, bat_e, bat_u, spd, cx, cy, layer, alt,
        │    dp, da, eff, duration
        │
        │  Data builder function runs (compute_kpis,
        │  vehicle_performance, fleet_funnel, ml_risk, …)
        │  Returns a plain Python dict → JSONResponse via J()
        │
        ▼
Browser receives JSON
        │
        ▼
app.js: _render(page, data)
        │  Calls the matching page renderer, e.g.:
        │    SafetyPage.render(data)
        │    FleetPage.render(data)
        │    …etc.
        │
        ▼
Page JS file reads the JSON fields it needs and draws
charts using ECharts or Chart.js into the pre-existing
<div id="..."> elements in index.html.
```

## In-memory session (_S)

All data is loaded once on connect and held in RAM.
There is no database round-trip on every chart load.
Restarting the server clears the session and requires reconnecting.

```python
_S = {
    "drones":     pd.DataFrame(),   # all drone flights, all trials
    "collisions": pd.DataFrame(),   # all collision events, all trials
    "source":     "none",           # "postgresql" or "excel"
    "trials":     [],               # list of trial_id strings
}
```

## Column name normalisation

Raw data from PostgreSQL and Excel use different column names.
Both loaders map them to the same internal schema before storing:

| Internal name     | Excel column         | PostgreSQL column      |
|-------------------|----------------------|------------------------|
| `coord_x`         | Final Latitude       | final_lat              |
| `coord_y`         | Final Longitude      | final_lon              |
| `vehicle`         | Vehicle Type         | vehicle_type           |
| `battery_start`   | Battery Start (%)    | battery_start          |
| `battery_consumed`| Battery Used (%)     | battery_used           |
| `drone_layer`     | Layer                | layer                  |
| `distance_actual` | Distance Actual (m)  | distance_actual_m      |
| `flight_status`   | Flight Status        | flight_status          |

`enrich()` then computes shorthand columns (`cx`, `cy`, `bat_u`, `da`, etc.)
that all data builder functions and page JS files use.

## Derived columns added by enrich()

| Derived column | Source                          | Meaning                          |
|----------------|---------------------------------|----------------------------------|
| `bat_s`        | battery_start → parse_battery() | Battery at launch (%)            |
| `bat_e`        | battery_end → parse_battery()   | Battery at landing (%)           |
| `bat_u`        | battery_consumed → parse_battery() | Battery consumed (%)          |
| `spd`          | drone_speed → parse_speed()     | Speed (m/s)                      |
| `cx`           | coord_x → to_numeric            | Final latitude (WGS84)           |
| `cy`           | coord_y → to_numeric            | Final longitude (WGS84)          |
| `layer`        | drone_layer → to_numeric        | Altitude layer 1–4               |
| `alt`          | layer → layer_to_alt()          | Altitude metres: L1=0 L2=50 L3=100 L4=150 |
| `da`           | distance_actual → to_numeric    | Actual distance flown (m)        |
| `eff`          | dp / da                         | Route efficiency ratio           |
| `duration`     | end_dt − start_dt               | Flight duration (seconds)        |

## How the frontend is served

FastAPI mounts three static directories:

```python
app.mount("/static",  StaticFiles(directory="frontend"))
app.mount("/js",      StaticFiles(directory="frontend/js"))
app.mount("/css",     StaticFiles(directory="frontend/css"))
```

`GET /` returns `frontend/index.html`.
All JS and CSS files are referenced by the HTML with absolute paths
starting `/js/` and `/css/`.

## Coordinate system

Drone positions come from the simulation as "Final Latitude" /
"Final Longitude". These should be WGS84 degrees in the IIT Bombay
campus range (lat ≈ 19.12–19.14, lon ≈ 72.90–72.92).

`airspace.js → _toLatLon()` checks whether values are already in
WGS84 range (|lat| ≥ 18 and |lon| ≥ 68). If not (simulation-unit
metres), it linearly maps onto the IIT Bombay bounding box:
SW = [19.1270, 72.9085], NE = [19.1430, 72.9205].

The same logic is applied in `map.js → _coordToLatLon()` for the
Overview page collision markers.

## File-to-responsibility map

```
main.py                      Entire backend: loaders, enrichment,
                              data builders, API routes

frontend/index.html          Single HTML shell — all 8 page panels
                              live here as hidden divs; shown/hidden
                              by app.js nav routing

frontend/css/utm.css         Design tokens, glass-panel card,
                              typography, responsive layout

frontend/js/api.js           All fetch() calls — one method per
                              backend endpoint; single source of
                              truth for API URLs

frontend/js/app.js           Application state (S object), login
                              modal, nav routing, trial/path-run
                              selector, _loadPage(), _render()

frontend/js/map.js           Leaflet overview map: satellite tiles,
                              IIT Bombay labels, collision dot plots,
                              Nominatim search, filter panel,
                              coordinate transform

frontend/js/charts/
  overview-charts.js         All Chart.js chart renderers used
                              exclusively by the Overview page:
                              outcome bars, vehicle bars, layer bars,
                              collision log table, path run chart

frontend/js/pages/
  overview.js                Overview page orchestrator — receives
                              API data, calls overview-charts.js
                              functions, updates KPI values

  airspace.js                Airspace page — Leaflet map with real
                              drone positions, layer toggles, filters,
                              Nominatim search, density bar chart,
                              occupancy gauge

  safety.js                  Safety page — severity donut, vehicle
                              collision rate, battery KDE, layer
                              safety profile, vehicle×layer heatmap,
                              collision pair types

  fleet.js                   Fleet page — flight status bar, battery
                              KDE curves, vehicle donut, distance bar,
                              battery-by-status KDE, layer reserve bar

  temporal.js                Temporal page — airborne over ticks,
                              collision type×layer heatmap, status
                              distribution donut, vehicle involvement
                              pie, rolling collision rate, severity
                              over tick windows

  predictive.js              Predictive (ML Risk) page — risk tier
                              bars, feature importance, risk score
                              scatter, confusion matrix metrics,
                              vehicle radar, conflict escalation list

  algo.js                    Algorithm Diagnostics page — route
                              assignment distance bar, crash vs safe
                              distribution, layer fail rate, risk
                              quadrant pie, vehicle pair heatmap,
                              escalated pairs table, severity bars

  intel.js                   Multi-Trial Intel page — Leaflet map
                              with trial circles, trial donut, fleet
                              distribution, collision rate timeline,
                              completion bars, trial×metric heatmap
```
