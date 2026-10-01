/**
 * PrintX Payment Controller
 * Handles payment webhooks and status updates
 */

const Order = require('../models/Order');
const { ApiError, PaymentError, NotFoundError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const config = require('../config/config');

/**
 * Handle payment webhook from UPI gateway
 * POST /api/payments/webhook
 * 
 * Webhook payload structure (typical UPI gateway):
 * {
 *   "payment_id": "PAY-XXX",
 *   "order_id": "ORD-XXX",
 *   "status": "SUCCESS" | "FAILED",
 *   "amount": 100,
 *   "timestamp": "2024-01-01T00:00:00Z",
 *   "signature": "xxx"  // For verification
 * }
 */
const handlePaymentWebhook = async (req, res, next) => {
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
};

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

/**
 * Get payment status for order
 * GET /api/payments/status/:orderId
 */
const getPaymentStatus = async (req, res, next) => {
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
};

module.exports = {
  handlePaymentWebhook,
  getPaymentStatus,
};
