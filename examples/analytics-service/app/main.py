from fastapi import FastAPI
from app.routers import analytics

app = FastAPI(title="Analytics Service", version="1.0.0")

app.include_router(analytics.router)
