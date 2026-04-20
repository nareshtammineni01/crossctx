import os
import httpx
from fastapi import APIRouter, HTTPException
from typing import List

from app.schemas.analytics import (
    RevenueReport, UserActivityReport, TrackEventRequest, DashboardSummary
)

router = APIRouter(prefix="/api/analytics")

ORDER_SERVICE_URL = os.getenv("ORDER_SERVICE_URL", "http://order-service:8082")
USER_SERVICE_URL = os.getenv("USER_SERVICE_URL", "http://user-service:8080")
PAYMENT_SERVICE_URL = os.getenv("PAYMENT_SERVICE_URL", "http://payment-service:8081")


NOTIFICATION_SERVICE_URL = os.getenv("NOTIFICATION_SERVICE_URL", "http://notification-service:8085")


@router.get("/revenue", response_model=RevenueReport)
async def get_revenue_report(period: str = "daily", notify: bool = False):
    """Get revenue report for a given period.
    Fetches raw order data from order-service and payment data from payment-service.
    Conditionally pings notification-service if notify=True.
    """
    async with httpx.AsyncClient() as client:
        orders = await client.get(f"{ORDER_SERVICE_URL}/api/orders?period={period}")
        payments = await client.get(f"{PAYMENT_SERVICE_URL}/api/payments?period={period}")
        # Only notify if the caller requested it
        if notify:
            await client.post(f"{NOTIFICATION_SERVICE_URL}/api/notifications",
                              json={"type": "revenue_report", "period": period})

    return RevenueReport(
        period=period,
        total_revenue=0.0,
        order_count=0,
        avg_order_value=0.0,
    )


@router.get("/users/{user_id}/activity", response_model=UserActivityReport)
async def get_user_activity(user_id: str):
    """Get activity report for a specific user.
    Enriches analytics with user profile from user-service.
    """
    async with httpx.AsyncClient() as client:
        user_resp = await client.get(f"{USER_SERVICE_URL}/api/users/{user_id}")
        orders_resp = await client.get(f"{ORDER_SERVICE_URL}/api/orders?user_id={user_id}")

    return UserActivityReport(
        user_id=user_id,
        total_orders=0,
        total_spent=0.0,
    )


@router.post("/events", status_code=201)
async def track_event(request: TrackEventRequest):
    """Track a custom analytics event."""
    return {"event_id": "evt_123", "status": "tracked"}


@router.get("/dashboard", response_model=DashboardSummary)
async def get_dashboard():
    """Get a full dashboard summary.
    Aggregates data from order-service, user-service, and payment-service.
    """
    async with httpx.AsyncClient() as client:
        orders = await client.get(f"{ORDER_SERVICE_URL}/api/orders/summary")
        users = await client.get(f"{USER_SERVICE_URL}/api/users/active-count")
        payments = await client.get(f"{PAYMENT_SERVICE_URL}/api/payments/summary")

    return DashboardSummary(
        daily_revenue=0.0,
        weekly_revenue=0.0,
        active_users=0,
        pending_orders=0,
        conversion_rate=0.0,
    )


@router.delete("/events/{event_id}", status_code=204)
async def delete_event(event_id: str):
    """Delete a tracked event."""
    return None
