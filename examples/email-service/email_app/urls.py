from django.urls import path, include
from rest_framework.routers import DefaultRouter
from email_app.views.email_views import EmailViewSet, send_bulk_email, get_email_templates

router = DefaultRouter()
router.register(r'emails', EmailViewSet, basename='email')

urlpatterns = [
    path('api/', include(router.urls)),
    path('api/emails/bulk/', send_bulk_email),
    path('api/emails/templates/', get_email_templates),
]
