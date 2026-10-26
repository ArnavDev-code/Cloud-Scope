import numpy as np
import pandas as pd
import joblib
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
from fastapi.middleware.cors import CORSMiddleware

# Initialize FastAPI app
app = FastAPI(title="Cloud Cost Predictor API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load model artifacts globally on startup
try:
    artifacts = joblib.load('../model/cloud_cost_model.joblib')
    model = artifacts['model']
    correction_factors = artifacts['correction_factors']
    expected_features = artifacts['features']
    categorical_cols = artifacts['categorical_cols']
except Exception as e:
    raise RuntimeError(f"Failed to load model artifacts: {e}")

# Define the expected input schema
class CostPredictionRequest(BaseModel):
    service_name: str
    usage_quantity: float
    usage_unit: str
    region_zone: str
    cpu_utilization: Optional[float] = None
    memory_utilization: Optional[float] = None
    network_inbound_GB: float = 0.0
    usage_duration_hours: float
    usage_month: int
    usage_day_of_week: int

@app.get("/")
def greet():
    return{"API is LIVE"}

@app.post("/predict")
def predict_cost(request: CostPredictionRequest):
    try:
        # Convert incoming JSON payload to DataFrame
        input_data = request.model_dump()
        df = pd.DataFrame([input_data])
        
        # Ensure column order exactly matches the training data
        df = df[expected_features]

        df['cpu_utilization'] = df['cpu_utilization'].astype(float)
        df['memory_utilization'] = df['memory_utilization'].astype(float)
        
        # 1. Apply Log Transformations to skewed features
        skewed_features = ['usage_quantity', 'usage_duration_hours', 'network_inbound_GB']
        for col in skewed_features:
            df[col] = np.log1p(df[col].fillna(0))
            
        # 2. Apply Categorical Casts
        for col in categorical_cols:
            df[col] = df[col].astype('category')
            
        # 3. Generate Predictions (returns array of shape [1, 3] for low, median, high)
        preds_log = model.predict(df)
        preds_abs = np.expm1(preds_log)[0]
        
        q_low_raw, q_med, q_high_raw = preds_abs[0], preds_abs[1], preds_abs[2]
        
        # 4. Apply Unit-Specific Conformal Calibration
        unit = request.usage_unit
        correction = correction_factors.get(unit, 0.0)
        
        q_low_calib = max(0.0, q_low_raw - correction)
        q_high_calib = q_high_raw + correction
        
        # Return formatted response
        # Return formatted response
        return {
            "service_name": request.service_name,
            "usage_unit": unit,
            "predicted_cost_inr": {
                "low": float(round(q_low_calib, 2)),
                "median": float(round(q_med, 2)),
                "high": float(round(q_high_calib, 2))
            }
        }
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))