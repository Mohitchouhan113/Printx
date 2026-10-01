/**
 * PrintX Backend Server
 * Main entry point for the application
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const config = require('./config/config');
const database = require('./config/database');
const logger = require('./utils/logger');
const fileCleanupService = require('./services/fileCleanupService');
const websocketService = require('./services/websocketService');

// Import routes
const healthRoutes = require('./routes/healthRoutes');
const shopRoutes = require('./routes/shopRoutes');
const orderRoutes = require('./routes/orderRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const shopOrderRoutes = require('./routes/shopOrderRoutes');

// Import v1 routes (new)
const v1OrderRoutes = require('./routes/v1/orderRoutes');
const v1PaymentRoutes = require('./routes/v1/paymentRoutes');

// Import PDF analysis routes
const pdfAnalysisRoutes = require('./routes/pdfAnalysisRoutes');

// Import middleware
const { notFound, errorHandler } = require('./middleware/errorHandler');

// Create Express app
const app = express();

// Ensure upload directory exists
const uploadDir = config.upload.dir;
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  logger.info(`Created upload directory: ${uploadDir}`);
}

// Ensure logs directory exists
const logsDir = './logs';
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// ==========================================
// Middleware
// ==========================================

// Security headers
app.use(helmet());

// CORS configuration
app.use(cors({
  origin: config.nodeEnv === 'production' 
    ? ['https://yourdomain.com'] 
    : ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:5000'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  message: {
    status: 'error',
    message: 'Too many requests, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
if (config.nodeEnv !== 'test') {
  app.use(morgan('combined', {
    stream: {
      write: (message) => logger.info(message.trim()),
    },
  }));
}

// Static files (for serving uploaded files if needed)
app.use('/uploads', express.static(path.join(__dirname, '..', uploadDir)));

// ==========================================
// Routes
// ==========================================

// Health check
app.use('/api/health', healthRoutes);

// Legacy routes (keeping backward compatibility)
app.use('/api/shops', shopRoutes);
app.use('/api/shops/:shopId', shopOrderRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);

// v1 API routes (new)
app.use('/api/v1/orders', v1OrderRoutes);
app.use('/api/v1/payments', v1PaymentRoutes);

// PDF Analysis routes
app.use('/api/analyze', pdfAnalysisRoutes);

// 404 handler
app.use(notFound);

// Global error handler
app.use(errorHandler);

// ==========================================
// Server Startup
// ==========================================

const startServer = async () => {
  try {
    // Connect to MongoDB
    await database.connect();
    logger.info('Database connected successfully');

    // Start file cleanup service
    fileCleanupService.start();
    logger.info('File cleanup service started');

    // Start Express server
    const server = app.listen(config.port, () => {
      logger.info(`PrintX backend server running on port ${config.port}`);
      logger.info(`Environment: ${config.nodeEnv}`);
      logger.info(`API available at: http://localhost:${config.port}/api`);
      logger.info(`v1 API available at: http://localhost:${config.port}/api/v1`);
    });

    // Initialize WebSocket service
    websocketService.initialize(server);
    logger.info('WebSocket service initialized');

    // Graceful shutdown handlers
    const gracefulShutdown = async (signal) => {
      logger.info(`${signal} received. Starting graceful shutdown...`);
      
      // Stop accepting new connections
      server.close(async () => {
        logger.info('HTTP server closed');

        // Stop file cleanup service
        fileCleanupService.stop();

        // Close database connection
        await database.disconnect();

        logger.info('Graceful shutdown completed');
        process.exit(0);
      });

      // Force shutdown after 30 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 30000);
    };

    // Handle shutdown signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle unhandled errors
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection:', reason);
    });

    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error);
      gracefulShutdown('uncaughtException');
    });

    return server;

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Start server
startServer();

// Export for testing
module.exports = app;
