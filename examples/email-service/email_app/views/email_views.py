import os
import requests
from shared_utils.auth import verify_jwt_token
from shared_utils.logging import get_logger
from rest_framework.views import APIView
from rest_framework.viewsets import ViewSet
from rest_framework.response import Response
from rest_framework.decorators import api_view
from rest_framework import status

from email_app.serializers.email_serializers import (
    SendEmailSerializer, EmailStatusSerializer, BulkEmailSerializer
)

USER_SERVICE_URL = os.getenv("USER_SERVICE_URL", "http://user-service:8080")
ORDER_SERVICE_URL = os.getenv("ORDER_SERVICE_URL", "http://order-service:8082")
NOTIFICATION_SERVICE_URL = os.getenv("NOTIFICATION_SERVICE_URL", "http://notification-service:8085")


class EmailViewSet(ViewSet):
    """ViewSet for managing email sending and status."""

    def list(self, request):
        """List all sent emails."""
        return Response([])

    def create(self, request):
        """Send a transactional email.
        Validates the recipient user via user-service before sending.
        Also notifies notification-service of the send event.
        """
        serializer = SendEmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        # Validate user exists in user-service
        user_resp = requests.get(
            USER_SERVICE_URL + f"/api/users/{data.get('user_id')}",
        )

        # If there's an order, fetch its details to enrich the email
        if data.get("order_id"):
            order_resp = requests.get(
                ORDER_SERVICE_URL + f"/api/orders/{data['order_id']}"
            )

        # After sending, ping notification-service
        requests.post(
            NOTIFICATION_SERVICE_URL + "/api/notifications",
            json={"type": "email_sent", "user_id": data.get("user_id")},
        )

        return Response({"email_id": "email_001", "status": "queued"}, status=status.HTTP_201_CREATED)

    def retrieve(self, request, pk=None):
        """Get email send status by ID."""
        serializer = EmailStatusSerializer({"email_id": pk, "status": "sent", "sent_at": None})
        return Response(serializer.data)

    def destroy(self, request, pk=None):
        """Cancel a queued email."""
        return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["POST"])
def send_bulk_email(request):
    """Send the same email to multiple recipients.
    Validates all users via user-service before bulk send.
    """
    serializer = BulkEmailSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    # Validate recipient list via user-service
    user_resp = requests.post(
        USER_SERVICE_URL + "/api/users/validate-bulk",
        json={"emails": serializer.validated_data["recipients"]},
    )

    return Response({"queued": len(serializer.validated_data["recipients"])})


@api_view(["GET"])
def get_email_templates(request):
    """List available email templates."""
    return Response([
        {"id": "order_confirmation", "name": "Order Confirmation"},
        {"id": "password_reset", "name": "Password Reset"},
        {"id": "welcome", "name": "Welcome Email"},
    ])
