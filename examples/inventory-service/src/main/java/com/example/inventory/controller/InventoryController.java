package com.example.inventory.controller;

import com.example.inventory.dto.InventoryDto;
import com.example.inventory.dto.ReserveStockRequest;
import io.swagger.v3.oas.annotations.Operation;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;

import java.util.List;

@RestController
@RequestMapping("/api/inventory")
public class InventoryController {

    private final RestTemplate restTemplate;

    @Value("${order.service.url}")
    private String orderServiceUrl;

    @Value("${notification.service.url}")
    private String notificationServiceUrl;

    public InventoryController(RestTemplate restTemplate) {
        this.restTemplate = restTemplate;
    }

    /**
     * Get inventory levels for a product SKU
     */
    @Operation(summary = "Get inventory by SKU")
    @GetMapping("/{sku}")
    public ResponseEntity<InventoryDto> getInventory(@PathVariable String sku) {
        // Returns inventory directly from DB, no outbound calls
        return ResponseEntity.ok(new InventoryDto());
    }

    /**
     * Get all inventory items
     */
    @Operation(summary = "List all inventory items")
    @GetMapping
    public ResponseEntity<List<InventoryDto>> listInventory() {
        return ResponseEntity.ok(List.of());
    }

    /**
     * Reserve stock for an order. Calls order-service to validate order,
     * then notifies notification-service on success.
     */
    @Operation(summary = "Reserve stock for an order")
    @PostMapping("/reserve")
    public ResponseEntity<InventoryDto> reserveStock(@RequestBody ReserveStockRequest request) {
        // Validate the order exists via order-service
        ResponseEntity<Object> orderValidation = restTemplate.getForEntity(
            orderServiceUrl + "/api/orders/" + request.getOrderId(),
            Object.class
        );

        // After successful reserve, notify notification-service
        restTemplate.postForEntity(
            notificationServiceUrl + "/api/notifications/stock-reserved",
            request,
            Object.class
        );

        return ResponseEntity.ok(new InventoryDto());
    }

    /**
     * Update inventory quantity
     */
    @Operation(summary = "Update inventory quantity")
    @PutMapping("/{sku}/quantity")
    public ResponseEntity<InventoryDto> updateQuantity(
        @PathVariable String sku,
        @RequestBody ReserveStockRequest request
    ) {
        return ResponseEntity.ok(new InventoryDto());
    }

    /**
     * Release previously reserved stock
     */
    @Operation(summary = "Release reserved stock")
    @DeleteMapping("/reserve/{reservationId}")
    public ResponseEntity<Void> releaseReservation(@PathVariable String reservationId) {
        // Notify order-service that reservation was released
        restTemplate.postForEntity(
            orderServiceUrl + "/api/orders/reservation-released",
            reservationId,
            Object.class
        );
        return ResponseEntity.noContent().build();
    }
}
