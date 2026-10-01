/**
 * PrintX v1 Payment Routes
 * Payment webhook with real-time WebSocket notifications
 */

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const Order = require('../../models/Order');
const websocketService = require('../../services/websocketService');
const validate = require('../../middleware/validate');
const { ApiError, PaymentError, NotFoundError } = require('../../middleware/errorHandler');
const logger = require('../../utils/logger');
const config = require('../../config/config');

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

/**
 * POST /api/v1/payments/webhook
 * Handle payment webhook from UPI gateway
 */
router.post('/webhook', webhookValidation, async (req, res, next) => {
  try {
    const {
      payment_id,
      order_id,
      status,
      amount,
      timestamp,
      signature,
    } = req.body;

    // Log webhook received
    logger.info('Payment webhook received:', {
      paymentId: payment_id,
      orderId: order_id,
      status,
    });

    // Verify webhook signature (implement based on your payment gateway)
    if (config.payment.webhookSecret) {
      const isValid = verifyWebhookSignature(req.body, signature);
      if (!isValid) {
        logger.error('Invalid webhook signature:', { orderId: order_id });
        throw new ApiError(401, 'Invalid webhook signature');
      }
    }

    // Find the order
    const order = await Order.findOne({ order_id });
    if (!order) {
      logger.error('Order not found for webhook:', { orderId: order_id });
      throw new NotFoundError('Order', order_id);
    }

    // Verify amount matches
    if (amount !== order.total_amount) {
      logger.error('Amount mismatch:', {
        orderId: order_id,
        expected: order.total_amount,
        received: amount,
      });
      throw new PaymentError('Payment amount does not match order total');
    }

    // Process based on payment status
    if (status === 'SUCCESS') {
      // Only transition if currently PENDING_PAYMENT
      if (order.payment_status !== 'PENDING_PAYMENT') {
        logger.warn('Order already processed:', {
          orderId: order_id,
          currentStatus: order.payment_status,
        });
        // Return success to avoid webhook retry
        return res.json({ status: 'success', message: 'Order already processed' });
      }

      // Mark as paid
      await order.markAsPaid(payment_id);

      logger.info('Order marked as paid:', {
        orderId: order_id,
        paymentId: payment_id,
        amount,
      });

      // Emit WebSocket payment received event
      websocketService.emitPaymentReceived(order.shop_id, {
        order_id: order.order_id,
        payment_id: payment_id,
        amount: amount,
      });

      // Emit WebSocket order update
      websocketService.emitOrderUpdate(order.shop_id, {
        order_id: order.order_id,
        payment_status: 'PAID',
        order_status: 'IN_PROGRESS',
        payment_id: payment_id,
      });

      res.json({
        status: 'success',
        message: 'Payment processed successfully',
        order_id: order_id,
        payment_status: 'PAID',
      });

    } else if (status === 'FAILED') {
      // Mark payment as failed
      await order.markPaymentFailed();

      logger.warn('Payment failed:', {
        orderId: order_id,
        paymentId: payment_id,
      });

      // Emit WebSocket order update
      websocketService.emitOrderUpdate(order.shop_id, {
        order_id: order.order_id,
        payment_status: 'FAILED',
        order_status: order.order_status,
        payment_id: payment_id,
      });

      res.json({
        status: 'success',
        message: 'Payment failure recorded',
        order_id: order_id,
        payment_status: 'FAILED',
      });

    } else {
      logger.warn('Unknown payment status:', { status, orderId: order_id });
      throw new ApiError(400, `Unknown payment status: ${status}`);
    }

  } catch (error) {
    // Always return 200 to webhook to prevent retries
    // Log the error instead
    if (error.isOperational) {
      logger.error('Webhook processing error:', {
        error: error.message,
        orderId: req.body.order_id,
      });
      // Return 200 to prevent retry, but with error message
      return res.status(200).json({
        status: 'error',
        message: error.message,
      });
    }
    next(error);
  }
});

/**
 * GET /api/v1/payments/status/:orderId
 * Get payment status for order
 */
router.get('/status/:orderId', async (req, res, next) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findOne({ order_id: orderId });
    if (!order) {
      throw new NotFoundError('Order', orderId);
    }

    res.json({
      status: 'success',
      data: {
        order_id: order.order_id,
        payment_status: order.payment_status,
        payment_id: order.payment_id,
        total_amount: order.total_amount,
        paid_at: order.paid_at,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Verify webhook signature
 * Implement based on your payment gateway's signature verification
 */
const verifyWebhookSignature = (payload, signature) => {
  const crypto = require('crypto');
  
  if (!config.payment.webhookSecret || !signature) {
    return false;
  }

  // Create HMAC signature (example implementation)
  const hmac = crypto.createHmac('sha256', config.payment.webhookSecret);
  const payloadString = JSON.stringify(payload);
  hmac.update(payloadString);
  const expectedSignature = hmac.digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
};

module.exports = router;
