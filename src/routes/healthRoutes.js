/**
 * PrintX Health Routes
 * Health check and status endpoints
 */

const express = require('express');
const router = express.Router();
const database = require('../config/database');
const fileCleanupService = require('../services/fileCleanupService');
const config = require('../config/config');

/**
 * Basic health check
 * GET /api/health
 */
router.get('/', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'printx-backend',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Detailed health check
 * GET /api/health/detailed
 */
router.get('/detailed', (req, res) => {
  const dbStatus = database.getStatus();
  
  res.json({
    status: 'healthy',
    service: 'printx-backend',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
    database: {
      connected: dbStatus.isConnected,
      host: dbStatus.host,
      name: dbStatus.name,
    },
    fileCleanup: fileCleanupService.getStatus(),
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
  });
});

/**
 * Readiness check (for Kubernetes)
 * GET /api/health/ready
 */
router.get('/ready', (req, res) => {
  const dbStatus = database.getStatus();
  
  if (dbStatus.isConnected) {
    res.json({ status: 'ready' });
  } else {
    res.status(503).json({ status: 'not ready', reason: 'Database not connected' });
  }
});

module.exports = router;
