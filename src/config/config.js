/**
 * PrintX Configuration
 * Central configuration management with environment variable support
 */

require('dotenv').config();

const config = {
  // Server
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',

  // MongoDB
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/printx',
    options: {
      // Connection pool settings
      maxPoolSize: 10,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    },
  },

  // File Upload
  upload: {
    dir: process.env.UPLOAD_DIR || './uploads',
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 52428800, // 50MB
    allowedMimeTypes: ['application/pdf'],
  },

  // Payment
  payment: {
    webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET,
    gatewayUrl: process.env.PAYMENT_GATEWAY_URL || 'https://api.payment-gateway.com',
  },

  // File Retention
  fileRetentionHours: parseInt(process.env.FILE_RETENTION_HOURS, 10) || 24,

  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 900000, // 15 minutes
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100,
  },

  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',

  // Token settings
  token: {
    maxPerShop: 99, // Tokens #1 to #99 per shop per day
  },
};

module.exports = config;
