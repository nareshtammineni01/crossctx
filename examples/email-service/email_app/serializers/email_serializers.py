from rest_framework import serializers


class SendEmailSerializer(serializers.Serializer):
    to_email = serializers.EmailField()
    subject = serializers.CharField(max_length=255)
    body = serializers.CharField()
    template = serializers.CharField(required=False, allow_null=True)
    order_id = serializers.CharField(required=False, allow_null=True)
    user_id = serializers.CharField(required=False, allow_null=True)


class EmailStatusSerializer(serializers.Serializer):
    email_id = serializers.CharField()
    status = serializers.CharField()
    sent_at = serializers.DateTimeField(allow_null=True)
    error = serializers.CharField(required=False, allow_null=True)


class BulkEmailSerializer(serializers.Serializer):
    recipients = serializers.ListField(child=serializers.EmailField())
    subject = serializers.CharField(max_length=255)
    body = serializers.CharField()
    template = serializers.CharField(required=False)
