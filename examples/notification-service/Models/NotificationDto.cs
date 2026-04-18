using System.ComponentModel.DataAnnotations;

namespace NotificationService.Models;

public record SendNotificationRequest(
    [Required] string UserId,
    [Required] string Type,
    [Required] string Message,
    string? OrderId,
    string? Channel
);

public class NotificationDto
{
    public Guid Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public DateTime SentAt { get; set; }
    public string? Channel { get; set; }
}

public class StockReservedEvent
{
    [Required] public string OrderId { get; set; } = string.Empty;
    [Required] public string Sku { get; set; } = string.Empty;
    public int Quantity { get; set; }
}
