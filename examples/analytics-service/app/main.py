from fastapi import FastAPI
from app.routers import analytics
from shared_utils.auth import verify_jwt_token
from shared_utils.logging import get_logger

logger = get_logger(__name__)
app = FastAPI(title="Analytics Service", version="1.0.0")

app.include_router(analytics.router)
