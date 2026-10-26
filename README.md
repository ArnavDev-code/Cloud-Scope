# Cloud Scope Intelligence

CloudCost Intelligence is an end-to-end cloud billing cost estimator. It combines
historical billing data, exploratory analysis, feature engineering, a quantile
XGBoost model, and a small web application. A user enters a prospective resource
usage profile and receives a calibrated **low**, **median**, and **high** cost
estimate in INR.

> The result is a model-informed planning range, not a provider invoice or a
> billing guarantee.

## What the project does

The project answers two related questions:

1. **What does a cloud usage record typically cost?**  
   The model predicts the conditional 5th, 50th, and 95th percentiles of
   `total_cost_inr`.
2. **How much uncertainty should be shown around that estimate?**  
   The lower and upper predictions are calibrated on a held-out calibration set
   using Conformalized Quantile Regression (CQR), separately for each usage
   unit (`GB`, `Hours`, and `Requests`).

The UI presents the median as the central forecast and the calibrated lower and
upper values as a planning interval.

## Architecture

```text
Raw billing data / PostgreSQL
              |
              v
notebooks/cleaning.ipynb
  ingestion, normalization, quality checks
              |
              v
data/cleaned_cloud_billings.csv
              |
              v
notebooks/eda.ipynb
  distributions, relationships, time features
              |
              v
data/featured_cloud_billings.csv
              |
              v
notebooks/model.ipynb
  leakage control, log transforms, split, quantile XGBoost,
  CQR calibration, evaluation
              |
              v
model/cloud_cost_model.joblib
              |
              v
backend/main.py  -- FastAPI /predict endpoint
              ^
              |
frontend/index.html + app.js + styles.css
```

### Runtime request flow

1. The browser validates non-negative quantities and utilization ranges.
2. `frontend/app.js` sends JSON to `POST /predict`.
3. FastAPI validates the payload with Pydantic.
4. The backend rebuilds the exact training feature order, applies the same
   `log1p` transforms, and casts categorical columns to pandas categories.
5. The serialized XGBoost model produces three predictions in log-cost space.
6. The backend applies `expm1` to return INR values and applies the stored
   usage-unit correction factor to the interval bounds.
7. The UI displays the median, low/high range, service, and billing unit.

## Repository layout

| Path | Purpose |
| --- | --- |
| [`backend/main.py`](backend/main.py) | FastAPI application, request schema, preprocessing, inference, and CORS configuration |
| [`frontend/index.html`](frontend/index.html) | Cost-estimator page and form |
| [`frontend/app.js`](frontend/app.js) | Client-side validation, API calls, result rendering, and connection testing |
| [`frontend/styles.css`](frontend/styles.css) | Responsive visual design |
| [`notebooks/cleaning.ipynb`](notebooks/cleaning.ipynb) | Database ingestion and cleaning workflow |
| [`notebooks/eda.ipynb`](notebooks/eda.ipynb) | Distribution, outlier, temporal, and correlation analysis |
| [`notebooks/model.ipynb`](notebooks/model.ipynb) | Model training, quantile prediction, calibration, evaluation, and export |
| [`data/data.csv`](data/data.csv) | Raw CSV export with original column names and byte-level network fields |
| [`data/cleaned_cloud_billings.csv`](data/cleaned_cloud_billings.csv) | Normalized 15-column modeling input before derived features |
| [`data/featured_cloud_billings.csv`](data/featured_cloud_billings.csv) | Modeling dataset with duration and calendar features |
| [`model/cloud_cost_model.joblib`](model/cloud_cost_model.joblib) | Serialized model and inference metadata |
| [`billings_sql_analysis.sql`](billings_sql_analysis.sql) | PostgreSQL schema, indexes, and analytical queries |
| [`requirements.txt`](requirements.txt) | Python runtime and notebook dependencies |

## Data and preparation

The available dataset contains **124,275 billing records**. The raw data covers
resource identifiers, service and region labels, usage quantities and units,
CPU/memory utilization, network traffic, timestamps, unit pricing, and the INR
target.

The cleaning workflow:

- reads the billing table from PostgreSQL;
- removes the `resource_` prefix from resource IDs;
- standardizes network fields from bytes to GB;
- parses start/end timestamps;
- checks schema, descriptive statistics, and missing values;
- derives `usage_duration_hours` from the timestamp difference;
- derives `usage_month`, `usage_day_of_week`, `usage_hour`, and `is_weekend`;
- writes the featured dataset used by modeling.

The inspected data has no missing values. The target distribution is strongly
right-skewed:

| Statistic | `total_cost_inr` |
| --- | ---: |
| Minimum | 0 |
| 25th percentile | 15,770 |
| Median | 46,231 |
| Mean | 117,853.41 |
| 75th percentile | 159,028 |
| Maximum | 1,161,253 |

The large difference between mean and median is important: a mean-only model
would be pulled upward by expensive records and would not communicate the
uncertainty of ordinary versus unusually expensive usage.

## Features used at inference

The exported artifact records this exact feature order:

```text
service_name
usage_quantity
usage_unit
region_zone
cpu_utilization
memory_utilization
network_inbound_GB
usage_duration_hours
usage_month
usage_day_of_week
```

`service_name`, `usage_unit`, and `region_zone` are categorical features. The
model uses XGBoost's native categorical handling rather than manually assigning
arbitrary integer meanings to categories.

The following fields are intentionally excluded from training:

- `unrounded_cost`, `rounded_cost`, and `cost_per_quantity`: these are direct
  pricing/cost signals and would leak the answer into the predictors;
- `usage_start_time` and `usage_end_time`: replaced by duration and calendar
  features;
- `resource_id`: an identifier, not a stable behavioral feature;
- `usage_hour` and `is_weekend`: engineered during EDA but not included in the
  final exported feature list;
- `network_outbound_GB`: explored in EDA but not retained in the final model.

## Why low, median, and high?

### A single prediction is not enough

Cloud spend is affected by service type, unit economics, region, utilization,
duration, and workload size. Two records with similar inputs can still have
different costs. Returning only one number would hide that uncertainty and can
create false precision for budgeting.

### Quantiles have an operational meaning

The model is trained with XGBoost's `reg:quantileerror` objective for:

- **Low (`alpha = 0.05`)**: a conservative lower-side estimate; roughly the
  5th conditional percentile.
- **Median (`alpha = 0.50`)**: the central estimate; robust to the highly
  skewed cost distribution and usually more representative than the arithmetic
  mean.
- **High (`alpha = 0.95`)**: an upper-side planning estimate; highlights a
  plausible expensive outcome.

Together, the low/high predictions form a useful risk interval while the
median remains easy to communicate. These labels describe model quantiles, not
guaranteed best- and worst-case bills.

### Why not train three unrelated models?

The notebook trains one XGBoost estimator with multiple quantile levels. This
keeps feature handling and tree structure consistent across the three outputs,
reduces duplicated training logic, and makes the three predictions part of one
coherent inference artifact. As with any quantile model, interval ordering
should be monitored when retraining.

## Why log-transform the data?

`usage_quantity`, `usage_duration_hours`, and `network_inbound_GB` are
non-negative and span substantially different scales. The INR target is also
heavily right-skewed. The pipeline therefore applies:

```python
np.log1p(value)
```

to those skewed numeric features and to `total_cost_inr` before training.
`log1p` handles zero safely, reduces the influence of very large values, and
lets the model learn relative changes more effectively. Predictions are
converted back to INR with `np.expm1` before being returned by the API.

## Training, calibration, and reported results

The 124,275 rows are split with `random_state=42` and stratification by usage
unit:

| Partition | Rows | Purpose |
| --- | ---: | --- |
| Training | 89,788 | Fit the quantile XGBoost model |
| Calibration | 15,845 | Estimate unit-specific interval corrections |
| Test | 18,642 | Final held-out evaluation |

Model configuration includes native categorical support, histogram tree
construction, 300 estimators, learning rate `0.05`, maximum depth `6`, and
random state `42`.

The notebook reports:

- **Raw interval coverage: 92.75%**
- **Calibrated interval coverage: 90.39%**
- **Calibrated coverage by unit:** `GB` 90.47%, `Hours` 89.82%,
  `Requests` 90.68%
- **Median prediction R² in log space: 0.665**

### CQR calibration details

For each calibration row, the conformity score is:

```text
max(q_low - y_true, y_true - q_high)
```

The empirical 90% score quantile is calculated separately for each usage unit.
The stored correction factors are:

| Unit | Correction (INR) |
| --- | ---: |
| GB | -1,378.11 |
| Hours | -743.38 |
| Requests | -1,302.76 |

At serving time the implementation applies:

```text
calibrated_low  = max(0, raw_low  - correction)
calibrated_high = raw_high + correction
```

Because the learned corrections are negative for this artifact, this particular
calibration narrows the raw interval and brings its empirical coverage closer
to the requested 90%. The correction values are data-dependent and must be
recomputed whenever the model or data distribution changes.

## SQL analysis

[`billings_sql_analysis.sql`](billings_sql_analysis.sql) defines a PostgreSQL
raw billing table and indexes on service, region, and usage timestamp. It also
contains analysis queries for:

- highest-spending services;
- within-region cost ranking and top-three resources;
- spending associated with CPU utilization above 90%;
- chronological cumulative spend;
- four cost tiers using `NTILE(4)`;
- deviation from each region's average;
- maximum cost per service shown beside every record.

These queries complement prediction: the model estimates future/expected cost
for an input profile, while SQL explains historical spend and helps identify
expensive services, regions, and anomalies.

## Running locally

### 1. Install Python dependencies

Use Python 3.10+ and install the pinned minimum dependency set:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 2. Start the FastAPI backend

`backend/main.py` loads the model path relative to its working directory, so
start Uvicorn from the `backend` directory:

```powershell
cd backend
uvicorn main:app --reload
```

The API is available at:

- Health check: `http://127.0.0.1:8000/`
- Swagger UI: `http://127.0.0.1:8000/docs`
- Prediction endpoint: `http://127.0.0.1:8000/predict`

### 3. Serve the frontend

In a second terminal, from the project root:

```powershell
python -m http.server 5500 --directory frontend
```

Open `http://127.0.0.1:5500`. The frontend is intentionally static and expects
the backend at `http://127.0.0.1:8000/predict`; update `API_URL` in
[`frontend/app.js`](frontend/app.js) if the backend address changes.

### Example request

```json
{
  "service_name": "Compute Engine",
  "usage_quantity": 120,
  "usage_unit": "Hours",
  "region_zone": "asia-south1",
  "cpu_utilization": 65,
  "memory_utilization": 72,
  "network_inbound_GB": 10,
  "usage_duration_hours": 24,
  "usage_month": 10,
  "usage_day_of_week": 0
}
```

Example response shape:

```json
{
  "service_name": "Compute Engine",
  "usage_unit": "Hours",
  "predicted_cost_inr": {
    "low": 12345.67,
    "median": 23456.78,
    "high": 34567.89
  }
}
```

## Reproducing the pipeline

1. Run [`notebooks/cleaning.ipynb`](notebooks/cleaning.ipynb) if the source
   billing table is available, or use the checked-in cleaned CSV.
2. Run [`notebooks/eda.ipynb`](notebooks/eda.ipynb) to create
   `featured_cloud_billings.csv`.
3. Run [`notebooks/model.ipynb`](notebooks/model.ipynb) to retrain, evaluate,
   calibrate, and overwrite `cloud_cost_model.joblib`.
4. Restart FastAPI so it loads the newly exported artifact.

The notebooks currently use relative paths such as `../data` and
`../model`; run them with the notebook working directory set to
[`notebooks/`](notebooks/), or adjust paths for another environment.

## Limitations and production considerations

- The dataset represents historical records from 2022–2023. It may not reflect
  current provider pricing, discounts, taxes, currency conversion, or workload
  behavior.
- The random split is useful for the demonstrated experiment, but a
  time-based split would be a stronger test for future forecasting.
- The model does not receive cost fields at inference time, by design; this
  means it estimates from usage/context rather than reproducing a provider
  pricing calculation.
- Categories and regions should match values seen during training. The UI
  provides known labels, but direct API clients should validate them too.
- CORS is configured with `allow_origins=["*"]` for local development. Restrict
  origins and add authentication before exposing the API publicly.
- The model artifact is version-sensitive: retraining should use compatible
  versions of Python, XGBoost, NumPy, pandas, and joblib.
- Add automated tests for preprocessing parity, interval ordering, unseen
  categories, artifact loading, and API responses before production deployment.

## Technology stack

- **Frontend:** HTML, CSS, vanilla JavaScript
- **API:** FastAPI, Pydantic, Uvicorn
- **Data:** PostgreSQL-compatible SQL, pandas, NumPy
- **Modeling:** XGBoost, scikit-learn, joblib
- **Analysis:** Jupyter, Matplotlib, Seaborn