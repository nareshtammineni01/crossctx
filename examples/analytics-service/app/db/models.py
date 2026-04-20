"""
SQLAlchemy models for the analytics service.
These demonstrate DB usage detection for v0.3.
"""
from sqlalchemy import Column, String, Integer, Float, DateTime, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
import redis

Base = declarative_base()


class EventModel(Base):
    """Raw event log — every tracked action is stored here"""
    __tablename__ = "events"

    id         = Column(String, primary_key=True)
    user_id    = Column(String, nullable=False, index=True)
    event_type = Column(String, nullable=False)
    service    = Column(String, nullable=False)
    metadata   = Column(String)
    created_at = Column(DateTime, nullable=False)


class MetricSnapshot(Base):
    """Aggregated metric snapshots (materialized from events)"""
    __tablename__ = "metric_snapshots"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    service    = Column(String, nullable=False)
    metric     = Column(String, nullable=False)
    value      = Column(Float, nullable=False)
    period     = Column(String, nullable=False)   # "hourly", "daily", "weekly"
    snapshot_at = Column(DateTime, nullable=False)


class DashboardConfig(Base):
    """User-saved dashboard configurations"""
    __tablename__ = "dashboard_configs"

    id        = Column(String, primary_key=True)
    user_id   = Column(String, nullable=False)
    name      = Column(String, nullable=False)
    config    = Column(String, nullable=False)  # JSON blob
    created_at = Column(DateTime, nullable=False)


# ── Redis cache helpers ────────────────────────────────────────────────────────

def get_redis_client():
    import os
    return redis.Redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379"))


def cache_metric(service: str, metric: str, value: float, ttl: int = 300):
    """Cache a computed metric for fast dashboard reads"""
    r = get_redis_client()
    r.set(f"analytics:metric:{service}:{metric}", str(value), ex=ttl)


def get_cached_metric(service: str, metric: str):
    r = get_redis_client()
    return r.get(f"analytics:metric:{service}:{metric}")


def cache_user_dashboard(user_id: str, data: str, ttl: int = 60):
    """Cache a rendered dashboard for a user"""
    r = get_redis_client()
    r.set(f"analytics:dashboard:{user_id}", data, ex=ttl)
