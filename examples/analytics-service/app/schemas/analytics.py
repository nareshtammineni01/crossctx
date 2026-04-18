from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class RevenueReport(BaseModel):
    period: str
    total_revenue: float
    order_count: int
    avg_order_value: float
    currency: str = "USD"


class UserActivityReport(BaseModel):
    user_id: str
    total_orders: int
    total_spent: float
    last_activity: Optional[datetime] = None
    top_categories: List[str] = []


class TrackEventRequest(BaseModel):
    event_type: str
    user_id: Optional[str] = None
    order_id: Optional[str] = None
    metadata: Optional[dict] = None


class DashboardSummary(BaseModel):
    daily_revenue: float
    weekly_revenue: float
    active_users: int
    pending_orders: int
    conversion_rate: float
