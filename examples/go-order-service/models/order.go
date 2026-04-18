package models

import "time"

// CreateOrderRequest represents the request payload for creating a new order
type CreateOrderRequest struct {
	ProductID string `json:"productId"`
	Quantity  int    `json:"quantity"`
	UserID    string `json:"userId"`
}

// UpdateOrderRequest represents the request payload for updating an order
type UpdateOrderRequest struct {
	Quantity int    `json:"quantity,omitempty"`
	Status   string `json:"status,omitempty"`
}

// OrderResponse represents the response payload for order endpoints
type OrderResponse struct {
	ID        string    `json:"id"`
	ProductID string    `json:"productId"`
	Quantity  int       `json:"quantity"`
	UserID    string    `json:"userId"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// OrderListResponse represents the response for listing orders
type OrderListResponse struct {
	Orders []OrderResponse `json:"orders"`
	Total  int             `json:"total"`
}
