# PrintX Backend

Smart web-based printing platform backend for local xerox shops.

## Overview

PrintX is a comprehensive backend system for managing xerox shop operations including:
- Shop management with dynamic pricing
- Order creation with automatic pricing calculation
- Sequential token generation per shop per day
- UPI payment integration with webhook handling
- Automatic PDF file cleanup after 24 hours

## Architecture

- **Stack**: Node.js (Express) + MongoDB
- **Isolation**: Completely isolated from DineFlow (no shared codebases or databases)
- **File Storage**: Local file system with automatic cleanup

## Features

### 1. Pricing Calculation
```
Total Cost = (B&W_Pages × B&W_Rate) + (Color_Pages × Color_Rate) + Binding_Cost
```
- Rates are dynamically fetched based on `shop_id`
- Supports multiple binding types (spiral, stapler)

### 2. Token Logic
- Sequential token generation per shop per day (#TOKEN-1 to #TOKEN-99)
- Daily reset at midnight
- Real-time token status API

### 3. Payment Guardrail
- Orders stay in `PENDING_PAYMENT` state until confirmed
- Only transitions to `PAID` upon successful UPI webhook
- Signature verification for webhook security

### 4. Auto-Deletion
- Uploaded PDFs are automatically deleted 24 hours after order creation
- Runs hourly via cron job
- Manual cleanup available

## Data Models

### Shop
```javascript
{
  shop_id: String,        // Auto-generated (SHOP-XXXXXXXX)
  name: String,
  owner_phone: String,    // Indian format (10 digits)
  rates: {
    bw: Number,           // B&W per page rate
    color: Number,        // Color per page rate
    spiral: Number,       // Spiral binding cost
    stapler: Number       // Stapler binding cost
  },
  address: Object,
  is_active: Boolean
}
```

### Order
```javascript
{
  order_id: String,       // Auto-generated (ORD-XXXXXXXX)
  token_no: Number,       // Sequential (1-99)
  shop_id: String,        // Reference to Shop
  file_url: String,
  file_name: String,
  total_pages: Number,
  bw_count: Number,
  color_count: Number,
  color_pages_list: [Number],
  copies: Number,
  binding: String,        // 'none' | 'spiral' | 'stapler'
  total_amount: Number,
  payment_status: String, // 'PENDING_PAYMENT' | 'PAID' | 'FAILED' | 'REFUNDED'
  order_status: String    // 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
}
```

## API Endpoints

### Health Check
- `GET /api/health` - Basic health check
- `GET /api/health/detailed` - Detailed status with DB and cleanup info
- `GET /api/health/ready` - Readiness probe for Kubernetes

### Shops
- `POST /api/shops` - Create a new shop
- `GET /api/shops` - Get all active shops (with pagination)
- `GET /api/shops/:shopId` - Get shop by ID
- `PUT /api/shops/:shopId` - Update shop
- `PATCH /api/shops/:shopId/rates` - Update shop rates
- `DELETE /api/shops/:shopId` - Deactivate shop

### Shop-specific
- `GET /api/shops/:shopId/orders` - Get shop orders (with filters)
- `GET /api/shops/:shopId/token/current` - Get current token status
- `GET /api/shops/:shopId/stats` - Get shop statistics

### Orders
- `POST /api/orders` - Create a new order
- `GET /api/orders/:orderId` - Get order by ID
- `PATCH /api/orders/:orderId/cancel` - Cancel order

### Payments
- `POST /api/payments/webhook` - UPI payment webhook
- `GET /api/payments/status/:orderId` - Get payment status

## Setup

### Prerequisites
- Node.js 18+
- MongoDB 6+

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd printx-backend

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your configuration
```

### Running

```bash
# Development
npm run dev

# Production
npm start
```

### Docker (Optional)

```bash
docker-compose up -d
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| PORT | Server port | 3000 |
| NODE_ENV | Environment | development |
| MONGODB_URI | MongoDB connection string | mongodb://localhost:27017/printx |
| UPLOAD_DIR | File upload directory | ./uploads |
| MAX_FILE_SIZE | Max file size in bytes | 52428800 (50MB) |
| PAYMENT_WEBHOOK_SECRET | Webhook signature secret | - |
| FILE_RETENTION_HOURS | Hours before file deletion | 24 |
| RATE_LIMIT_WINDOW_MS | Rate limit window | 900000 (15 min) |
| RATE_LIMIT_MAX_REQUESTS | Max requests per window | 100 |

## Error Handling

The API returns consistent error responses:

```json
{
  "status": "error",
  "statusCode": 400,
  "message": "Validation failed",
  "type": "VALIDATION_ERROR",
  "details": [
    {
      "field": "owner_phone",
      "message": "Invalid Indian phone number"
    }
  ]
}
```

Error types:
- `VALIDATION_ERROR` - Input validation failed
- `NOT_FOUND` - Resource not found
- `CONFLICT` - Duplicate resource
- `PAYMENT_ERROR` - Payment processing failed
- `INTERNAL_ERROR` - Server error

## Development

### Project Structure

```
printx-backend/
├── src/
│   ├── config/
│   │   ├── config.js          # Central configuration
│   │   └── database.js        # MongoDB connection
│   ├── controllers/
│   │   ├── shopController.js  # Shop CRUD
│   │   ├── orderController.js # Order management
│   │   └── paymentController.js # Payment webhooks
│   ├── middleware/
│   │   ├── errorHandler.js    # Error handling
│   │   ├── fileUpload.js      # Multer config
│   │   └── validate.js        # Validation
│   ├── models/
│   │   ├── Shop.js           # Shop schema
│   │   └── Order.js          # Order schema
│   ├── routes/
│   │   ├── shopRoutes.js     # Shop endpoints
│   │   ├── orderRoutes.js    # Order endpoints
│   │   ├── paymentRoutes.js  # Payment endpoints
│   │   ├── shopOrderRoutes.js # Shop-specific orders
│   │   └── healthRoutes.js   # Health checks
│   ├── services/
│   │   └── fileCleanupService.js # File cleanup
│   ├── utils/
│   │   └── logger.js         # Winston logger
│   └── index.js              # Entry point
├── uploads/                  # PDF storage
├── logs/                     # Application logs
├── .env.example              # Environment template
├── package.json
└── README.md
```

### Testing

```bash
npm test
```

### Linting

```bash
npm run lint
```

## License

MIT © Flow Labs
