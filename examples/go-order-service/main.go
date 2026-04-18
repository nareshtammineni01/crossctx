package main

import (
	"net/http"
	"os"

	"github.com/example/order-service/handlers"
	"github.com/gin-gonic/gin"
	"github.com/go-chi/chi/v5"
)

const orderServicePort = ":8080"

func main() {
	// Example 1: Gin router (default)
	setupGinRouter()

	// Example 2: Chi router (alternative, commented out to avoid conflict)
	// setupChiRouter()

	// Example 3: Stdlib router (alternative)
	// setupStdlibRouter()
}

func setupGinRouter() {
	router := gin.Default()

	// Create controller
	orderCtrl := handlers.NewOrderController()

	// API v1 group
	v1 := router.Group("/api/v1")
	{
		// Orders endpoints
		orders := v1.Group("/orders")
		{
			orders.GET("", orderCtrl.GetOrders)
			orders.GET("/:id", orderCtrl.GetOrderByID)
			orders.POST("", orderCtrl.CreateOrder)
			orders.PUT("/:id", orderCtrl.UpdateOrder)
			orders.DELETE("/:id", orderCtrl.DeleteOrder)
		}
	}

	// Start server
	router.Run(orderServicePort)
}

func setupChiRouter() {
	router := chi.NewRouter()

	// Create controller
	orderCtrl := handlers.NewOrderController()

	// API routes
	router.Route("/api", func(r chi.Router) {
		// V1 sub-routes
		r.Route("/v1", func(r chi.Router) {
			// Orders sub-routes
			r.Route("/orders", func(r chi.Router) {
				r.Get("/", orderCtrl.GetOrders)
				r.Get("/{id}", orderCtrl.GetOrderByID)
				r.Post("/", orderCtrl.CreateOrder)
				r.Put("/{id}", orderCtrl.UpdateOrder)
				r.Delete("/{id}", orderCtrl.DeleteOrder)
			})
		})
	})

	http.ListenAndServe(orderServicePort, router)
}

func setupStdlibRouter() {
	mux := http.NewServeMux()

	// Register stdlib handlers
	mux.HandleFunc("/api/orders", handlers.StdlibGetOrders)
	mux.HandleFunc("/api/orders/", handlers.StdlibGetOrders)

	// Start server
	http.ListenAndServe(orderServicePort, mux)
}
