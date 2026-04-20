package handlers

// Example: calling the inventory service over gRPC from the order service
// This is a demo file to exercise the gRPC outbound call detector.

import (
	"context"

	inventorypb "github.com/example/inventory-service/proto"
	"google.golang.org/grpc"
)

// InventoryGRPCClient wraps a gRPC connection to inventory-service
type InventoryGRPCClient struct {
	conn   *grpc.ClientConn
	client inventorypb.InventoryServiceClient
}

// NewInventoryGRPCClient creates a new gRPC client for inventory-service
func NewInventoryGRPCClient() (*InventoryGRPCClient, error) {
	conn, err := grpc.Dial("inventory-service:50051", grpc.WithInsecure())
	if err != nil {
		return nil, err
	}

	client := inventorypb.NewInventoryServiceClient(conn)
	return &InventoryGRPCClient{conn: conn, client: client}, nil
}

// CheckStock calls the inventory service via gRPC to verify stock availability
func (c *InventoryGRPCClient) CheckStock(ctx context.Context, productID string, quantity int32) (bool, error) {
	resp, err := c.client.CheckStock(ctx, &inventorypb.CheckStockRequest{
		ProductId: productID,
		Quantity:  quantity,
	})
	if err != nil {
		return false, err
	}
	return resp.Available, nil
}

// ReserveStock calls the inventory service to reserve stock for an order
func (c *InventoryGRPCClient) ReserveStock(ctx context.Context, productID string, quantity int32) error {
	_, err := c.client.ReserveStock(ctx, &inventorypb.ReserveStockRequest{
		ProductId: productID,
		Quantity:  quantity,
	})
	return err
}
