using Microsoft.AspNetCore.Mvc;
using NotificationService.Models;
using Swashbuckle.AspNetCore.Annotations;

namespace NotificationService.Controllers;

[ApiController]
[Route("api/[controller]")]
public class NotificationController : ControllerBase
{
    private readonly IHttpClientFactory _factory;
    private readonly IConfiguration _configuration;

    public NotificationController(IHttpClientFactory factory, IConfiguration configuration)
    {
        _factory = factory;
        _configuration = configuration;
    }

    /// <summary>Send a notification to a user</summary>
    [HttpPost]
    [SwaggerOperation(Summary = "Send a notification")]
    public async Task<ActionResult<NotificationDto>> SendNotification([FromBody] SendNotificationRequest request)
    {
        // Fetch user details from user-service to get email/phone
        var userServiceUrl = _configuration["ServiceUrls:UserServiceUrl"];
        var httpClient = _factory.CreateClient("user-service");
        var userResponse = await httpClient.GetAsync($"{userServiceUrl}/api/users/{request.UserId}");

        return Ok(new NotificationDto
        {
            Id = Guid.NewGuid(),
            UserId = request.UserId,
            Status = "sent"
        });
    }

    /// <summary>Handle stock reserved event — notify user their order is confirmed</summary>
    [HttpPost("stock-reserved")]
    [SwaggerOperation(Summary = "Handle stock reserved event")]
    public async Task<ActionResult<NotificationDto>> HandleStockReserved([FromBody] StockReservedEvent evt)
    {
        // Look up the order to get the user ID
        var orderServiceUrl = _configuration["ServiceUrls:OrderServiceUrl"];
        var httpClient = _factory.CreateClient("order-service");
        var orderResponse = await httpClient.GetAsync($"{orderServiceUrl}/api/orders/{evt.OrderId}");

        // Then get the user details to send the notification
        var userServiceUrl = _configuration["ServiceUrls:UserServiceUrl"];
        var userClient = _factory.CreateClient("user-service");
        await userClient.GetAsync($"{userServiceUrl}/api/users/by-order/{evt.OrderId}");

        return Ok(new NotificationDto { Status = "sent" });
    }

    /// <summary>Get all notifications for a user</summary>
    [HttpGet("user/{userId}")]
    public async Task<ActionResult<IEnumerable<NotificationDto>>> GetUserNotifications(string userId)
    {
        return Ok(Array.Empty<NotificationDto>());
    }

    /// <summary>Get a notification by ID</summary>
    [HttpGet("{id}")]
    public async Task<ActionResult<NotificationDto>> GetNotification(Guid id)
    {
        return Ok(new NotificationDto { Id = id });
    }

    /// <summary>Delete a notification</summary>
    [HttpDelete("{id}")]
    public async Task<IActionResult> DeleteNotification(Guid id)
    {
        return NoContent();
    }
}
