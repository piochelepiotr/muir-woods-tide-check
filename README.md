# Muirbound

A public GitHub Pages trip planner for the **Manzanita SR‑1 / US‑101 connector** on the way from San Francisco to Muir Woods.

Website: https://piochelepiotr.github.io/muir-woods-tide-check/

This is an uncalibrated tide-exposure planning tool. It cannot certify a dry or open road. It has no road-level water sensor, complete closure/reopening archive, or validated drainage model.

## Features

- NOAA 6-minute astronomical predictions, high/low events, tide heights and ranges, and quality-screened preliminary water-level observations.
- Operational NOAA P-ETSS total-water ensemble mean and 10th–90th percentile band, using the upper bound for crossing checks. No road-open probability is inferred.
- Any past date can be selected. Historical NOAA data loads on demand where available; current weather and closure feeds are never used as evidence of historical road conditions.
- Outbound and same-day return crossings, each checked with a ±30-minute traffic allowance.
- Adjustable extra water allowance (0.5 / 1 / 1.5 ft) and clearance-buffer assumption (1–4 hours, default 2).
- NWS alerts for coastal and bayshore zones CAZ505/CAZ506 matched by hazard validity period, hourly rain screening, Caltrans road reports and nearby CHP incidents.
- Explicit stale/missing-data handling, sources and retrieval timestamps, CSV downloads, and Pacific daylight-saving-aware dates.
- Three independently documented October 2026 tide-impact days with a comparison to predicted and observed water levels. These are case studies, not a validation score.
- A timestamped archive of source reports collected from deployment onward on the `data-history` branch. Missing reports and disappearing incidents remain **unverified**, never “open.”

## Data and decision rules

NOAA station **9414290 (San Francisco)** is about 7 miles from the connector. It was the reference station in the county's January 2021 Manzanita Flood Reduction Study. All plotted water levels are feet above **MLLW**, not road elevation or water depth on pavement.

The study summarizes historical encroachment markers near **5.6 ft MLLW** for the shoulder and **6.5 ft MLLW** for traffic lanes. It reports nearby SR‑1 elevations from just under 6 to 8 ft **NAVD88**. The datums are distinct; no geodetic road-survey height is directly subtracted from tide predictions. Settlement and infrastructure changes mean these markers are approximate.

The tide scenario is astronomical tide + the selected minimum water allowance. The crossing check uses the **higher of this scenario and the official P-ETSS 90th-percentile total-water bound** wherever fresh guidance exists. P-ETSS already includes tide, modeled surge and its observational bias adjustment; these are not added again. For the next 6 hours, a larger positive recent observed excess replaces that allowance. The excess is the median of at least three unflagged observations from the last hour, with a latest sample no older than 30 minutes, matched to contemporaneous predictions. Negative excess cannot reduce the allowance. This is a near-term scenario, **not a surge forecast**.

“Lower tide exposure” requires fresh P-ETSS coverage across the crossing and preceding buffer, its upper bound below the shoulder marker, continuous astronomical prediction coverage, water below the shoulder marker throughout, fresh current weather/road feeds, hourly forecast coverage, no matching flood or tsunami alert, no rain forecast or precipitation probability ≥50%, no nearby closure/flood wording, and a recent observed comparison for the next 6 hours. Predictions exceeding the shoulder or lane marker remain cautionary even when other feeds are unavailable. No missing data is interpreted as confirmation of clearance.

The 2-hour clearance buffer is an assumption, not a measured drain-down time. Caltrans determines reopening on site. Even a 4-hour buffer cannot guarantee drainage. Creek runoff, surge, wind, debris, culvert operations and local differences are not hydraulically modeled.

P-ETSS is read from the operational NOMADS station CSV archive for 9414290, in feet MLLW. `TWL90p` is the **90% exceedance / 10th-percentile lower bound**; `TWL10p` is the **10% exceedance / 90th-percentile upper bound**. The bounds describe ensemble spread, not a guaranteed 80% coverage interval, not an 80% confidence interval, and not road-closure probabilities. Hourly total-water values are linearly interpolated across gaps no larger than about one hour, with no extrapolation. Retrieval must be within 90 minutes and the model cycle within 18 hours. Outside this coverage, tide scenarios remain viewable but no lower-exposure result is given.

Historical views evaluate tide exposure with the selected fixed allowance and buffer. They do not apply today's observed excess, weather, alerts or road reports. Gauge observations are shown separately and are not retroactively used as if they had been a forecast. Historical tide data can be unavailable or revised.

## Why the October 29 difference was large

The 6.534 ft astronomical prediction and 8.046 ft verified observation match at station 9414290 at **2026-10-29 20:42 UTC / 1:42 p.m. PDT**, both in feet MLLW. The observed excess was **1.512 ft**, not a unit, datum or time-zone mismatch. Nearby Point Reyes and Alameda also showed positive daily residuals, and the San Francisco excess persisted across several days. `public/data/anomaly-audit.json` preserves the matched checks and source URLs.

[NOAA’s event assessment](https://oceanservice.noaa.gov/news/nov26/california-record-water-levels.html) attributes the regional event to astronomical tides plus El Niño-driven Kelvin waves and thermal expansion during a marine heatwave. The last two mechanisms raise coastal sea level beyond an astronomical tide-table prediction. These data do not uniquely apportion the 1.512 ft among physical causes. A fixed +0.5 ft allowance is not a sufficient bound for this event. The app therefore now incorporates official probabilistic total-water guidance rather than treating the astronomical prediction as the full forecast.

## Historical evidence and verification limits

[Caltrans' November 3, 2026 report](https://dot.ca.gov/caltrans-near-me/district-4/d4-news/2026-11-03-us101-sr1-connector) documents tide impacts October 29–31, with an approximate 1–6:30 p.m. impact interval on October 29. It does **not** provide a complete binary closure/reopening log. Lot closures are not treated as connector closures. Date-only reports do not become full-day closures.

`public/data/evidence.json` preserves the source, precision and limitations of these reports, plus NOAA comparisons fetched separately. Three positive disruption reports with no known-open intervals are insufficient to measure false alarms, missed closures, sensitivity, specificity, road-clearance timing or a calibrated drainage duration. No such score is displayed.

The [official 511 archive](https://511.org/open-data) can return up to 1,000 archived traffic events with a token; additional history can be requested from 511. No 511 token is configured and no 511 archive was imported. This implementation uses public evidence only.

## Refresh and hosting

The GitHub Action refreshes the public snapshot at minutes 17 and 47 each hour, runs the tests, commits source report checks to the separate `data-history` branch, then deploys `public/` with GitHub Pages. Schedules can be delayed. Current reports older than 90 minutes are treated as stale. NOAA/alert/hourly weather data also refresh directly in the browser every 5 minutes while the tab is open. Clicking Refresh reloads the latest deployed road snapshot; it does not trigger an Action.

The archive branch also saves each P-ETSS forecast cycle on first retrieval, without overwriting it. Later verification must use valid times after that first retrieval, so model analysis values and later observations are not mistaken for forecasts available in advance. Source checks also retain gauge observations and matching astronomical predictions to support future water-level verification.

The archive branch retains all collected records; the deployment exposes the 90 most recent recorded days. Each check records source availability, timestamps, source text and the latest gauge observation. The archive is sampled, incomplete and not a ground-truth closure log.

GitHub may disable scheduled workflows after 60 days of inactivity in a public repository. If source freshness stops advancing, enable the workflow again under Actions. Current checks will fail cautiously when the snapshot becomes stale.

No paid services, private data, API keys, application server or build step are needed. The workflow needs `contents: write` for its archive branch and `pages: write` plus `id-token: write` for Pages deployment.

## Local development

Requires Node 22+ for tests and Python 3.10+ for public data collection.

```sh
npm test
python3 -m unittest discover -s tests -p 'test_*.py'
python3 scripts/fetch_data.py
python3 scripts/fetch_forecast.py
python3 scripts/fetch_evidence.py   # optional historical refresh
python3 scripts/archive_reports.py .history
npm run dev
```

Visit http://localhost:4173. No npm dependencies are needed. Tests cover DST, thresholds, positive/negative excess, quality flags, missing values, prediction gaps, drainage buffers, alert validity, stale feeds and historical separation.

## Primary sources

- [Manzanita Flood Reduction Study, January 2021](https://storage.googleapis.com/proudcity/marinwatershedprogramca/uploads/2022/07/Manzanita-Flood-Reduction-Study-Report_FINAL_01192021_s.pdf), printed pp. 4, 11–12, 17–18 and Appendix B.
- [Caltrans November 2026 reopening guidance](https://dot.ca.gov/caltrans-near-me/district-4/d4-news/2026-11-10-marin-tidal-flooding).
- [NOAA API](https://api.tidesandcurrents.noaa.gov/api/prod/) and [station 9414290](https://tidesandcurrents.noaa.gov/stationhome.html?id=9414290).
- [NOAA P-ETSS product inventory](https://www.nco.ncep.noaa.gov/pmb/products/petss/) and [San Francisco guidance](https://slosh.nws.noaa.gov/petss/index.php?stid=9414290&datum=MLLW).
- [NWS API](https://www.weather.gov/documentation/services-web-api).
- [Caltrans QuickMap FAQ](https://quickmap.dot.ca.gov/faq), [CHP KML](https://quickmap.dot.ca.gov/data/chp-only.kml), and [road reports](https://roads.dot.ca.gov/).
- [NPS directions and visit planning](https://www.nps.gov/muwo/planyourvisit/directions.htm).

Independent project, not affiliated with Caltrans, NOAA, NPS or 511. Respect closures and never drive into floodwater.
