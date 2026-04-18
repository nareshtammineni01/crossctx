package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"

	"github.com/example/order-service/models"
	"github.com/gin-gonic/gin"
)

// OrderController handles order-related HTTP requests
type OrderController struct {
	productServiceURL string
}

// NewOrderController creates a new OrderController
func NewOrderController() *OrderController {
	return &OrderController{
		productServiceURL: os.Getenv("PRODUCT_SERVICE_URL"),
	}
}

// GetOrders retrieves all orders
func (c *OrderController) GetOrders(ctx *gin.Context) {
	// Make a call to product service to get product details
	resp, err := http.Get(c.productServiceURL + "/api/products")
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer resp.Body.Close()

	orders := models.OrderListResponse{
		Orders: []models.OrderResponse{
			{
				ID:        "order-1",
				ProductID: "prod-1",
				Quantity:  5,
				UserID:    "user-1",
				Status:    "pending",
			},
		},
		Total: 1,
	}

	ctx.JSON(http.StatusOK, orders)
}

// GetOrderByID retrieves a specific order by ID
func (c *OrderController) GetOrderByID(ctx *gin.Context) {
	orderID := ctx.Param("id")

	order := models.OrderResponse{
		ID:        orderID,
		ProductID: "prod-1",
		Quantity:  5,
		UserID:    "user-1",
		Status:    "pending",
	}

	ctx.JSON(http.StatusOK, order)
}

// CreateOrder creates a new order
func (c *OrderController) CreateOrder(ctx *gin.Context) {
	var req models.CreateOrderRequest

	// Bind the JSON request body
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Make an external call to validate product
	validateURL := fmt.Sprintf("%s/api/products/%s", c.productServiceURL, req.ProductID)
	respProduct, err := http.Get(validateURL)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to validate product"})
		return
	}
	defer respProduct.Body.Close()

	response := models.OrderResponse{
		ID:        "order-new",
		ProductID: req.ProductID,
		Quantity:  req.Quantity,
		UserID:    req.UserID,
		Status:    "pending",
	}

	ctx.JSON(http.StatusCreated, response)
}

// UpdateOrder updates an existing order
func (c *OrderController) UpdateOrder(ctx *gin.Context) {
	orderID := ctx.Param("id")
	var req models.UpdateOrderRequest

	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updatedOrder := models.OrderResponse{
		ID:       orderID,
		Quantity: req.Quantity,
		Status:   req.Status,
	}

	ctx.JSON(http.StatusOK, updatedOrder)
}

// DeleteOrder deletes an order
func (c *OrderController) DeleteOrder(ctx *gin.Context) {
	orderID := ctx.Param("id")
	ctx.JSON(http.StatusOK, gin.H{"message": fmt.Sprintf("Order %s deleted", orderID)})
}

// StdlibGetOrders is a stdlib http handler for demonstration
func StdlibGetOrders(w http.ResponseWriter, r *http.Request) {
	orders := models.OrderListResponse{
		Orders: []models.OrderResponse{},
		Total:  0,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(orders)
}
