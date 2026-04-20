package db

import (
	"context"
	"database/sql"

	"github.com/jmoiron/sqlx"
)

// OrdersRepository handles DB access for the orders table
type OrdersRepository struct {
	db *sqlx.DB
}

func NewOrdersRepository(db *sqlx.DB) *OrdersRepository {
	return &OrdersRepository{db: db}
}

// FindByID fetches a single order
func (r *OrdersRepository) FindByID(ctx context.Context, id string) (*Order, error) {
	var order Order
	err := r.db.QueryRowContext(ctx,
		"SELECT id, user_id, product_id, quantity, status, created_at FROM orders WHERE id = $1",
		id,
	).Scan(&order.ID, &order.UserID, &order.ProductID, &order.Quantity, &order.Status, &order.CreatedAt)
	return &order, err
}

// FindByUser lists orders for a user
func (r *OrdersRepository) FindByUser(ctx context.Context, userID string) ([]Order, error) {
	rows, err := r.db.QueryContext(ctx,
		"SELECT id, user_id, product_id, quantity, status FROM orders WHERE user_id = $1 ORDER BY created_at DESC",
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var orders []Order
	for rows.Next() {
		var o Order
		if err := rows.Scan(&o.ID, &o.UserID, &o.ProductID, &o.Quantity, &o.Status); err != nil {
			return nil, err
		}
		orders = append(orders, o)
	}
	return orders, nil
}

// Insert writes a new order to the DB
func (r *OrdersRepository) Insert(ctx context.Context, o *Order) error {
	_, err := r.db.ExecContext(ctx,
		"INSERT INTO orders (id, user_id, product_id, quantity, status) VALUES ($1, $2, $3, $4, $5)",
		o.ID, o.UserID, o.ProductID, o.Quantity, o.Status,
	)
	return err
}

// UpdateStatus changes the order status
func (r *OrdersRepository) UpdateStatus(ctx context.Context, id, status string) error {
	_, err := r.db.ExecContext(ctx,
		"UPDATE orders SET status = $1 WHERE id = $2",
		status, id,
	)
	return err
}

// Delete removes an order
func (r *OrdersRepository) Delete(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx,
		"DELETE FROM orders WHERE id = $1",
		id,
	)
	return err
}

// CacheKey returns the Redis cache key for an order
func CacheKey(orderID string) string {
	return "orders:" + orderID
}

type Order struct {
	ID        string
	UserID    string
	ProductID string
	Quantity  int32
	Status    string
	CreatedAt string
}

// Unused — suppresses import error in demo
var _ = sql.ErrNoRows
