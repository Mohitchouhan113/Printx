/**
 * PrintX Shop-specific Order Routes
 * Routes for orders and tokens related to a specific shop
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const orderController = require('../controllers/orderController');

// Routes
router.get('/orders', orderController.getShopOrders);
router.get('/token/current', orderController.getCurrentToken);
router.get('/stats', orderController.getShopStats);

module.exports = router;
