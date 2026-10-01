/**
 * PrintX Payment Routes
 */

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const paymentController = require('../controllers/paymentController');
const validate = require('../middleware/validate');

// Validation rules
const webhookValidation = [
  body('payment_id')
    .trim()
    .notEmpty()
    .withMessage('Payment ID is required'),
  body('order_id')
    .trim()
    .notEmpty()
    .withMessage('Order ID is required'),
  body('status')
    .isIn(['SUCCESS', 'FAILED'])
    .withMessage('Status must be SUCCESS or FAILED'),
  body('amount')
    .isNumeric()
    .withMessage('Amount must be a number')
    .isFloat({ min: 0 })
    .withMessage('Amount must be positive'),
  validate,
];

// Routes
router.post('/webhook', webhookValidation, paymentController.handlePaymentWebhook);
router.get('/status/:orderId', paymentController.getPaymentStatus);

module.exports = router;
