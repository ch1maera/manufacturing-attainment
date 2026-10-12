# Databricks notebook source
"""
Acme Manufacturing — Plant Attainment Control Tower : synthetic data generator.

Writes raw "Excel-tracker" parquet datasets into the UC Volume
/Volumes/<catalog>/<schema>/raw_data/<dataset>/ (both passed in as widgets).

Story: 20-plant manufacturer. Company attainment ~96%. Two weeks ago
misses tripled at Plano (PLNT-07), Tulsa (PLNT-12), Fresno (PLNT-15), driven by
Mechanical Downtime + Material Shortage. Those three plants dip to ~82%, but the
company roll-up only falls to ~94% because 17 healthy plants dilute it -- that
gap is the point of the demo. $480K spike cost.
The spike misses are OPEN with no corrective action = the backlog the app captures.

See specifications/01-lakeflow.md for the full spec.
"""
import os
from datetime import datetime, timedelta, date

import numpy as np
import pandas as pd
from faker import Faker
from pyspark.sql import functions as F

# Catalog/schema: read from job widgets when running as a DAB setup-job task;
# fall back to the story defaults for standalone (databricks-connect) runs.
# NOTE: the SDP pipeline's read_files() paths are hardcoded to the defaults
# below (SQL read_files can't interpolate bundle vars), so overriding these
# only works if the pipeline SQL is regenerated to match — see dab_instructions.md.
CATALOG = "solution_builder"
SCHEMA = "demo_plant_attainment_control_tower"
try:
    dbutils.widgets.text("catalog", "", "Catalog")
    dbutils.widgets.text("schema", "", "Schema")
    CATALOG = dbutils.widgets.get("catalog") or CATALOG
    SCHEMA = dbutils.widgets.get("schema") or SCHEMA
except Exception:
    pass
VOL = f"/Volumes/{CATALOG}/{SCHEMA}/raw_data"

rng = np.random.default_rng(42)
Faker.seed(42)
fake = Faker("en_US")

# ---- time anchors -----------------------------------------------------------
PIN = os.environ.get("CRISPWAVE_PIN_TIME") == "1"
NOW = datetime(2026, 7, 29) if PIN else datetime.now()
NOW = datetime(NOW.year, NOW.month, NOW.day)          # midnight today
STORY_START = NOW - timedelta(days=456)               # ~15 months
SPIKE_PEAK = NOW - timedelta(days=14)                 # 2 weeks ago
SPIKE_BUILDUP = NOW - timedelta(days=21)              # 3 weeks ago

REASONS = ["Changeover", "Material Shortage", "Mechanical Downtime", "Quality Hold", "Labor"]
AFFECTED = ["PLNT-07", "PLNT-12", "PLNT-15"]

# ---- 1. plants --------------------------------------------------------------
PLANTS = [
    ("PLNT-01", "Atlanta Plant",      "Atlanta",      "GA", "Southeast", 33.75, -84.39),
    ("PLNT-02", "Columbus Plant",     "Columbus",     "OH", "Midwest",   39.96, -82.99),
    ("PLNT-03", "Dallas Plant",       "Dallas",       "TX", "Southwest", 32.78, -96.80),
    ("PLNT-04", "Denver Plant",       "Denver",       "CO", "West",      39.74, -104.99),
    ("PLNT-05", "Chicago Plant",      "Chicago",      "IL", "Midwest",   41.88, -87.63),
    ("PLNT-06", "Charlotte Plant",    "Charlotte",    "NC", "Southeast", 35.23, -80.84),
    ("PLNT-07", "Plano Plant",        "Plano",        "TX", "Southwest", 33.02, -96.70),
    ("PLNT-08", "Phoenix Plant",      "Phoenix",      "AZ", "West",      33.45, -112.07),
    ("PLNT-09", "Indianapolis Plant", "Indianapolis", "IN", "Midwest",   39.77, -86.16),
    ("PLNT-10", "Nashville Plant",    "Nashville",    "TN", "Southeast", 36.16, -86.78),
    ("PLNT-11", "Kansas City Plant",  "Kansas City",  "MO", "Midwest",   39.10, -94.58),
    ("PLNT-12", "Tulsa Plant",        "Tulsa",        "OK", "Southwest", 36.15, -95.99),
    ("PLNT-13", "Sacramento Plant",   "Sacramento",   "CA", "West",      38.58, -121.49),
    ("PLNT-14", "Portland Plant",     "Portland",     "OR", "West",      45.51, -122.68),
    ("PLNT-15", "Fresno Plant",       "Fresno",       "CA", "West",      36.74, -119.77),
    ("PLNT-16", "Orlando Plant",      "Orlando",      "FL", "Southeast", 28.54, -81.38),
    ("PLNT-17", "Richmond Plant",     "Richmond",     "VA", "Northeast", 37.54, -77.44),
    ("PLNT-18", "Harrisburg Plant",   "Harrisburg",   "PA", "Northeast", 40.27, -76.88),
    ("PLNT-19", "Albany Plant",       "Albany",       "NY", "Northeast", 42.65, -73.75),
    ("PLNT-20", "Milwaukee Plant",    "Milwaukee",    "WI", "Midwest",   43.04, -87.91),
]
plants_df = pd.DataFrame(PLANTS, columns=["plant_id", "plant_name", "city", "state", "region", "lat", "lng"])
plants_df["plant_manager"] = [fake.name() for _ in range(len(plants_df))]
plant_ids = plants_df["plant_id"].tolist()

# ---- 2. lines (3-4 per plant) ----------------------------------------------
LINE_TEMPLATES = [
    ("POD-A Fryer", "Chips"), ("POD-B Bagger", "Chips"), ("POD-C Oven", "Crackers"),
    ("POD-D Extruder", "Pretzels"), ("POD-E Popper", "Popcorn"),
]
lines_rows = []
lc = 1
plant_lines = {}
for pid in plant_ids:
    n = rng.integers(3, 5)  # 3 or 4
    chosen = LINE_TEMPLATES[:n]
    ids = []
    for name, fam in chosen:
        lid = f"LINE-{lc:03d}"
        lines_rows.append((lid, pid, name, fam))
        ids.append((lid, fam))
        lc += 1
    plant_lines[pid] = ids
lines_df = pd.DataFrame(lines_rows, columns=["line_id", "plant_id", "line_name", "product_family"])

# ---- 3. skus (40) -----------------------------------------------------------
SKU_SEED = [
    ("Classic Potato Chips 8oz", "Chips"), ("Sea Salt Kettle Chips 5oz", "Chips"),
    ("BBQ Ripple Chips 8oz", "Chips"), ("Sour Cream & Onion Chips 8oz", "Chips"),
    ("Salt & Vinegar Kettle Chips 5oz", "Chips"), ("Jalapeno Kettle Chips 5oz", "Chips"),
    ("Lightly Salted Chips 10oz", "Chips"), ("Ranch Wavy Chips 8oz", "Chips"),
    ("Dill Pickle Chips 8oz", "Chips"), ("Honey BBQ Chips 8oz", "Chips"),
    ("Cheddar Crackers 12oz", "Crackers"), ("Wheat Snack Crackers 12oz", "Crackers"),
    ("Peanut Butter Crackers 8oz", "Crackers"), ("Buttery Round Crackers 14oz", "Crackers"),
    ("Cheese Sandwich Crackers 8oz", "Crackers"), ("Multigrain Crackers 10oz", "Crackers"),
    ("Everything Crackers 10oz", "Crackers"), ("Water Crackers 8oz", "Crackers"),
    ("Rosemary Crackers 9oz", "Crackers"), ("Saltine Crackers 16oz", "Crackers"),
    ("Butter Popcorn 6oz", "Popcorn"), ("White Cheddar Popcorn 5oz", "Popcorn"),
    ("Kettle Corn 7oz", "Popcorn"), ("Caramel Popcorn 9oz", "Popcorn"),
    ("Sea Salt Popcorn 5oz", "Popcorn"), ("Movie Butter Popcorn 6oz", "Popcorn"),
    ("Sweet & Salty Popcorn 7oz", "Popcorn"), ("Jalapeno Cheddar Popcorn 5oz", "Popcorn"),
    ("Sourdough Pretzels 10oz", "Pretzels"), ("Mini Pretzel Twists 16oz", "Pretzels"),
    ("Honey Mustard Pretzel Pieces 8oz", "Pretzels"), ("Pretzel Rods 12oz", "Pretzels"),
    ("Pretzel Sticks 14oz", "Pretzels"), ("Cheddar Pretzel Bites 9oz", "Pretzels"),
    ("Buttermilk Ranch Pretzels 8oz", "Pretzels"), ("Salted Pretzel Knots 12oz", "Pretzels"),
    ("Cinnamon Pretzel Twists 8oz", "Pretzels"), ("Tortilla Rounds 11oz", "Chips"),
    ("Multigrain Tortilla Chips 9oz", "Chips"), ("Blue Corn Tortilla Chips 9oz", "Chips"),
]
PACKS = ["5oz", "6oz", "7oz", "8oz", "9oz", "10oz", "12oz", "14oz", "16oz"]
skus_rows = []
for i, (name, cat) in enumerate(SKU_SEED, start=1):
    sid = f"SKU-{1000 + i}"
    pack = name.split()[-1]
    rate = int(rng.integers(2000, 8000))
    skus_rows.append((sid, name, cat, pack, rate))
skus_df = pd.DataFrame(skus_rows, columns=["sku_id", "sku_name", "category", "pack_size", "std_units_per_hr"])
sku_cat = dict(zip(skus_df.sku_id, skus_df.category))
sku_rate = dict(zip(skus_df.sku_id, skus_df.std_units_per_hr))

# assign ~10 active SKUs per plant; map each to a dominant line matching family
def pick_line(pid, cat):
    fams = plant_lines[pid]
    same = [lid for lid, fam in fams if fam == cat]
    return rng.choice(same) if same else rng.choice([lid for lid, _ in fams])

plant_active = {}
all_sids = skus_df.sku_id.tolist()
for pid in plant_ids:
    active = list(rng.choice(all_sids, size=10, replace=False))
    plant_active[pid] = [(s, pick_line(pid, sku_cat[s])) for s in active]

# ---- 4. build_plan (date x plant x sku) ------------------------------------
dates = [STORY_START + timedelta(days=d) for d in range((NOW - STORY_START).days)]
n_dates = len(dates)

def spike_dip(pid, d):
    """Attainment dip (0..~0.16) for affected plants across the spike window."""
    if pid not in AFFECTED or d < SPIKE_BUILDUP:
        return 0.0
    if d <= SPIKE_PEAK:  # ramp up
        frac = (d - SPIKE_BUILDUP).days / max(1, (SPIKE_PEAK - SPIKE_BUILDUP).days)
        return 0.16 * frac
    # recover from peak toward ~0.06 by NOW
    frac = (d - SPIKE_PEAK).days / max(1, (NOW - SPIKE_PEAK).days)
    return 0.16 - (0.16 - 0.06) * frac

bp_rows = []
for pid in plant_ids:
    for sid, lid in plant_active[pid]:
        rate = sku_rate[sid]
        # vectorized per (plant,sku) across all days
        base_att = np.clip(rng.normal(0.96, 0.025, n_dates), 0.85, 1.02)
        for i, d in enumerate(dates):
            wd = d.weekday()
            season = 1.0 + 0.10 * np.sin(2 * np.pi * (d.timetuple().tm_yday) / 365.0)
            shift_h = (8 if wd >= 5 else rng.integers(12, 21))
            planned = int(rate * shift_h * (0.85 + 0.30 * rng.random()) * season)
            if planned <= 0:
                planned = rate
            dip = spike_dip(pid, d)
            att = float(base_att[i] - dip)
            att = max(att, 0.55)
            actual = int(planned * att)
            # adherence / on-time
            on_time_p = 0.95
            if pid in AFFECTED and SPIKE_BUILDUP <= d <= NOW:
                on_time_p = 0.75
            on_time = rng.random() < on_time_p
            planned_ts = datetime(d.year, d.month, d.day, 6) + timedelta(hours=int(shift_h))
            delay = 0 if on_time else int(rng.integers(1, 8))
            actual_ts = planned_ts + timedelta(hours=delay)
            bp_rows.append((d.date(), pid, lid, sid, planned, actual, planned_ts, actual_ts, bool(on_time)))
build_plan_df = pd.DataFrame(bp_rows, columns=[
    "plan_date", "plant_id", "line_id", "sku_id", "planned_units", "actual_units",
    "planned_complete_ts", "actual_complete_ts", "on_time_flag"])

# ---- 5. adherence_miss ------------------------------------------------------
COMMENTS = {
    "Mechanical Downtime": [
        "Fryer #3 conveyor belt failure - 4hr line stop",
        "POD-B bagger jam, seal head replaced",
        "Extruder motor overheated, waiting on part",
        "Oven belt misalignment on POD-C",
        "Popper heating element failure",
    ],
    "Material Shortage": [
        "Seasoning blend delayed from supplier",
        "Corn flour shipment arrived short",
        "Film/packaging stockout on POD-A",
        "Oil delivery missed the window",
        "Cheese powder backorder",
    ],
    "Changeover": [
        "Extended changeover between BBQ and Sour Cream runs",
        "Sanitation overrun after allergen changeover",
        "Tooling swap took longer than planned",
    ],
    "Quality Hold": [
        "Metal-detector reject spike - QA hold",
        "Salt level out of spec, held pending retest",
        "Seal integrity check failed, batch held",
    ],
    "Labor": [
        "Two operators called out on POD-B",
        "Overtime cap reached, short-staffed 2nd shift",
        "Training gap on new line lead",
    ],
}

miss_rows = []
mc = 1
def add_miss(d, pid, reason, status):
    global mc
    sid, lid = plant_active[pid][int(rng.integers(0, len(plant_active[pid])))]
    units = int(rng.integers(500, 8000))
    comment = rng.choice(COMMENTS[reason])
    mid = f"MISS-{mc:06d}"
    # Production order the miss was booked against. Derived from the miss
    # counter rather than rng so adding this field doesn't perturb every
    # downstream random draw (and with it the spike story).
    po = f"PO-{pid.split('-')[1]}{d:%y%m}-{mc:04d}"
    mc += 1
    created = datetime(d.year, d.month, d.day, int(rng.integers(6, 22)))
    miss_rows.append((mid, d.date(), pid, lid, sid, po, units, reason, comment,
                      fake.name(), status, created))
    return mid

# baseline: ~40/week company-wide across full history, evenly across plants/reasons
n_weeks = n_dates // 7
baseline_total = int(40 * n_weeks)
for _ in range(baseline_total):
    d = STORY_START + timedelta(days=int(rng.integers(0, n_dates)))
    # keep baseline out of the affected-plant spike window (that's the spike's job)
    pid = str(rng.choice(plant_ids))
    reason = str(rng.choice(REASONS, p=[0.28, 0.20, 0.20, 0.16, 0.16]))
    add_miss(d, pid, reason, "resolved")

# spike: extra OPEN misses at the 3 affected plants across the window, peak-weighted
spike_days = [d for d in dates if SPIKE_BUILDUP <= d <= NOW]
def peak_weight(d):
    # highest at peak, tapering both sides
    return max(0.15, 1.0 - abs((d - SPIKE_PEAK).days) / 10.0)
open_targets = {"PLNT-07": 68, "PLNT-12": 46, "PLNT-15": 40}
for pid, tgt in open_targets.items():
    w = np.array([peak_weight(d) for d in spike_days], dtype=float)
    w /= w.sum()
    for _ in range(tgt):
        d = spike_days[int(rng.choice(len(spike_days), p=w))]
        reason = str(rng.choice(REASONS, p=[0.10, 0.30, 0.45, 0.08, 0.07]))
        add_miss(d, pid, reason, "open")

miss_df = pd.DataFrame(miss_rows, columns=[
    "miss_id", "miss_date", "plant_id", "line_id", "sku_id", "production_order",
    "miss_units", "reason_code", "comment", "detected_by", "status", "created_ts"])

# ---- 6. corrective_actions (only for resolved/baseline misses, ~70%) --------
CA_TEMPLATES = {
    "Mechanical Downtime": "Schedule preventive maintenance and replace worn line components; add vibration monitoring.",
    "Material Shortage": "Add safety stock and dual-source the material; tighten supplier delivery SLA.",
    "Changeover": "Adopt SMED changeover checklist and pre-stage tooling to cut changeover time.",
    "Quality Hold": "Recalibrate inline QA sensors and add mid-run spec checks.",
    "Labor": "Cross-train backup operators and adjust shift coverage plan.",
}
CA_STATUS = ["completed", "completed", "in progress", "planned"]
ca_rows = []
cc = 1
resolved = miss_df[miss_df.status == "resolved"]
for _, m in resolved.iterrows():
    if rng.random() < 0.70:
        aid = f"CA-{cc:06d}"
        cc += 1
        impl = pd.Timestamp(m.miss_date) + pd.Timedelta(days=int(rng.integers(3, 21)))
        ca_rows.append((aid, m.miss_id, CA_TEMPLATES[m.reason_code], fake.name(),
                        impl.date(), str(rng.choice(CA_STATUS)),
                        m.created_ts + timedelta(days=1)))
corrective_df = pd.DataFrame(ca_rows, columns=[
    "action_id", "miss_id", "action_desc", "owner", "implementation_date",
    "ca_status", "created_ts"])

# ---- 7. plant_kpi_daily -----------------------------------------------------
# baseline per plant-day; affected plants elevated across the spike window; the
# EXTRA maintenance spend for the 3 plants over the window sums to ~$480K.
kpi_rows = []
window_days = [d for d in dates if SPIKE_BUILDUP <= d <= NOW]
extra_w = {pid: np.array([peak_weight(d) for d in window_days]) for pid in AFFECTED}
extra_budget = 480000.0
per_plant_budget = extra_budget / len(AFFECTED)
extra_map = {}
for pid in AFFECTED:
    w = extra_w[pid] / extra_w[pid].sum()
    for d, frac in zip(window_days, w):
        extra_map[(pid, d.date())] = per_plant_budget * frac

for pid in plant_ids:
    for d in dates:
        breakdowns = int(max(0, rng.poisson(1.2)))
        work_orders = int(rng.integers(3, 12))
        spend = float(rng.normal(4000, 800))
        fpq = float(np.clip(rng.normal(97.5, 1.0), 90, 99.8))
        holds = int(max(0, rng.poisson(0.5)))
        if pid in AFFECTED and SPIKE_BUILDUP <= d <= NOW:
            intensity = peak_weight(d)
            breakdowns += int(round(4 * intensity + rng.integers(0, 3)))
            work_orders += int(round(8 * intensity))
            spend += extra_map.get((pid, d.date()), 0.0)
            fpq -= 7 * intensity
            holds += int(round(3 * intensity))
        kpi_rows.append((d.date(), pid, breakdowns, work_orders, round(spend, 2),
                         round(float(np.clip(fpq, 88, 99.8)), 2), holds))
kpi_df = pd.DataFrame(kpi_rows, columns=[
    "kpi_date", "plant_id", "breakdowns_count", "work_orders_count",
    "maintenance_spend_usd", "first_pass_quality_pct", "holds_count"])

# ---- write to volume --------------------------------------------------------
# Standalone (databricks-connect venv) → serverless remote session.
# Inside a Databricks Job (serverless) → fall back to the ambient SparkSession.
try:
    from databricks.connect import DatabricksSession
    spark = DatabricksSession.builder.serverless(True).getOrCreate()
except Exception:
    from pyspark.sql import SparkSession
    spark = SparkSession.builder.getOrCreate()
spark.sql(f"CREATE SCHEMA IF NOT EXISTS {CATALOG}.{SCHEMA}")
spark.sql(f"CREATE VOLUME IF NOT EXISTS {CATALOG}.{SCHEMA}.raw_data")

def write(pdf, name):
    sdf = spark.createDataFrame(pdf)
    sdf.write.mode("overwrite").parquet(f"{VOL}/{name}")
    print(f"wrote {name}: {len(pdf):,} rows")

write(plants_df, "plants")
write(lines_df, "lines")
write(skus_df, "skus")
write(build_plan_df, "build_plan")
write(miss_df, "adherence_miss")
write(corrective_df, "corrective_actions")
write(kpi_df, "plant_kpi_daily")
print("DONE. NOW =", NOW.date(), " SPIKE_PEAK =", SPIKE_PEAK.date())
