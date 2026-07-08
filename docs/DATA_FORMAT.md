# Data Format Reference

This document describes the exact Excel workbook format and PostgreSQL schema
that `main.py` expects. Column names must match exactly (case-sensitive).

---

## Excel Workbook

### Sheet naming convention

Drone sheets must be named:  `Run 1 — <label>`,  `Run 2 — <label>`, …
The run number is extracted with the regex `Run\s+(\d+)\s*[—\-]+\s*(.+)`.

The collision sheet must be named exactly:  **`Collision Log`**

### Drone sheets (`Run N — label`)

```
Row 1:  (ignored — can contain a title or be blank)
Row 2:  Column headers  (exact names listed below)
Row 3+: Data rows (blank Drone ID → row is skipped)
```

| Column header         | Internal name       | Type    | Notes                        |
|-----------------------|---------------------|---------|------------------------------|
| Drone ID              | drone_id            | int     | Required — blank rows skipped |
| Vehicle Type          | vehicle             | str     | quad / hexa / octa / vtol / fixed_wing |
| Flight Status         | flight_status       | str     | See status values below      |
| Battery Start (%)     | battery_start       | float   | `"85"` or `"85%"` — both work |
| Battery End (%)       | battery_end         | float   |                              |
| Battery Used (%)      | battery_consumed    | float   |                              |
| Speed                 | drone_speed         | float   | m/s — `"12"` or `"12 m/s"` ok |
| Final Latitude        | coord_x             | float   | WGS84 latitude               |
| Final Longitude       | coord_y             | float   | WGS84 longitude              |
| Layer                 | drone_layer         | int     | 1, 2, 3, or 4                |
| Layer Name            | layer_name          | str     | e.g. "Ground Level"          |
| Distance Actual (m)   | distance_actual     | float   | Metres flown                 |
| Source Node           | source_node         | str     |                              |
| Destination Node      | destination_node    | str     |                              |
| Start Time            | start_time          | str/dt  | Parsed with pd.to_datetime() |
| End Time              | end_time            | str/dt  |                              |

### Collision Log sheet

```
Row 1:  (ignored)
Row 2:  Column headers
Row 3+: Data rows (blank Event ID → row is skipped)
```

| Column header      | Internal name             | Type   |
|--------------------|---------------------------|--------|
| Event ID           | event_id                  | int    |
| Path Run           | path_run                  | int    |
| Path Label         | path_label                | str    |
| Grid Tick          | grid_tick                 | int    |
| Type               | type                      | str    | Direct / Proximity / Near Miss |
| Severity           | severity                  | str    | Critical / Major / Minor / Near Miss |
| Collision Type     | collision_type            | str    | pair label e.g. "quad-quad"  |
| Drone A ID         | drone_a_id                | int    |
| Drone A Vehicle    | drone_a_vehicle           | str    |
| Drone B ID         | drone_b_id                | int    |
| Drone B Vehicle    | drone_b_vehicle           | str    |
| Crash Latitude     | drone_a_coord_x           | float  |
| Crash Longitude    | drone_a_coord_y           | float  |
| Crash Layer        | drone_a_layer             | int    |
| Drone A Battery    | drone_a_battery_start     | float  |
| Drone B Battery    | drone_b_battery_start     | float  |

> `drone_b_coord_x`, `drone_b_coord_y`, `drone_b_layer`,
> `drone_a_distance_actual`, `drone_b_distance_actual` are set to `None`
> in the Excel loader (not present in the sheet).

---

## PostgreSQL Schema

Tables `drone_summary_geo` and `collision_log_geo` must both have a
`run_id` column that joins to `simulation_runs_geo`.

### `simulation_runs_geo`

| Column        | Type    | Notes                             |
|---------------|---------|-----------------------------------|
| run_id        | int PK  |                                   |
| run_label     | varchar | Becomes `trial_id` in the session |
| trial_number  | int     |                                   |

### `drone_summary_geo`

| Column              | Type    | Maps to internal name  |
|---------------------|---------|------------------------|
| run_id              | int FK  |                        |
| drone_id            | int     | drone_id               |
| vehicle_type        | varchar | vehicle                |
| flight_status       | varchar | flight_status          |
| battery_start       | float   | battery_start          |
| battery_end         | float   | battery_end            |
| battery_used        | float   | battery_consumed       |
| speed               | float   | drone_speed            |
| final_lat           | float   | coord_x                |
| final_lon           | float   | coord_y                |
| layer               | int     | drone_layer            |
| layer_name          | varchar | layer_name             |
| distance_planned_m  | float   | distance_planned       |
| distance_actual_m   | float   | distance_actual        |

### `collision_log_geo`

| Column              | Type    | Maps to internal name       |
|---------------------|---------|-----------------------------|
| run_id              | int FK  |                             |
| drone_a_id          | int     | drone_a_id                  |
| drone_b_id          | int     | drone_b_id                  |
| drone_a_vehicle     | varchar | drone_a_vehicle             |
| drone_b_vehicle     | varchar | drone_b_vehicle             |
| grid_tick           | int     | grid_tick                   |
| type                | varchar | type                        |
| severity            | varchar | severity                    |
| collision_type      | varchar | collision_type              |
| crash_lat           | float   | drone_a_coord_x             |
| crash_lon           | float   | drone_a_coord_y             |
| crash_layer         | int     | drone_a_layer               |
| drone_a_battery     | float   | drone_a_battery_start       |
| drone_b_battery     | float   | drone_b_battery_start       |
| drone_a_distance    | float   | drone_a_distance_actual     |
| drone_b_distance    | float   | drone_b_distance_actual     |

---

## Flight Status values

The following exact strings appear in `flight_status` and are tested
with `str.startswith()` throughout the codebase:

| Value                       | Counted as  |
|-----------------------------|-------------|
| `Complete`                  | n_ok        |
| `Collision — Node to Node`  | n_crash     |
| `Collision — Proximity`     | n_crash     |
| `Incomplete — Battery`      | n_batt      |
| `Cancelled — In-flight`     | n_canc      |
| `Cancelled — Pre-flight`    | n_canc      |

## Altitude layer mapping

`layer_to_alt()` in `main.py`:

| Layer | Altitude |
|-------|----------|
| 1     | 0 m      |
| 2     | 50 m     |
| 3     | 100 m    |
| 4     | 150 m    |
