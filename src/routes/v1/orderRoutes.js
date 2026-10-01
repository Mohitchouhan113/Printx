/**
 * PrintX v1 Order Routes
 * Order creation with real-time WebSocket notifications
 */

const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const Order = require('../../models/Order');
const Shop = require('../../models/Shop');
const websocketService = require('../../services/websocketService');
const validate = require('../../middleware/validate');
const { ApiError, NotFoundError, ValidationError } = require('../../middleware/errorHandler');
const logger = require('../../utils/logger');

// Validation rules
const createOrderValidation = [
  body('shop_id')
    .trim()
    .notEmpty()
    .withMessage('Shop ID is required'),
  body('file_url')
    .trim()
    .notEmpty()
    .withMessage('File URL is required'),
  body('file_name')
    .trim()
    .notEmpty()
    .withMessage('File name is required'),
  body('total_pages')
    .isInt({ min: 1 })
    .withMessage('Total pages must be at least 1'),
  body('bw_count')
    .isInt({ min: 0 })
    .withMessage('B&W count must be a non-negative integer'),
  body('color_count')
    .isInt({ min: 0 })
    .withMessage('Color count must be a non-negative integer'),
  body('color_pages_list')
    .optional()
    .isArray()
    .withMessage('Color pages list must be an array'),
  body('color_pages_list.*')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Color page numbers must be positive integers'),
  body('copies')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Copies must be at least 1'),
  body('binding')
    .optional()
    .isIn(['none', 'spiral', 'stapler'])
    .withMessage('Binding must be none, spiral, or stapler'),
  body('customer_phone')
    .optional()
    .matches(/^[6-9]\d{9}$/)
    .withMessage('Invalid Indian phone number'),
  body('notes')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Notes cannot exceed 500 characters'),
  validate,
];

/**
 * POST /api/v1/orders/create
 * Create a new order with WebSocket notification
 */
router.post('/create', createOrderValidation, async (req, res, next) => {
  try {
    const {
      shop_id,
      file_url,
      file_name,
      total_pages,
      bw_count,
      color_count,
      color_pages_list,
      copies,
      binding,
      customer_phone,
      notes,
    } = req.body;

    // Validate shop exists
    const shop = await Shop.findByShopId(shop_id);
    if (!shop) {
      throw new NotFoundError('Shop', shop_id);
    }

    // Validate page counts
    if (bw_count + color_count !== total_pages) {
      throw new ValidationError('Page counts mismatch', {
        message: 'B&W count + Color count must equal total pages',
        bw_count,
        color_count,
        total_pages,
      });
    }

    // Validate color pages list matches color count
    if (color_pages_list && color_pages_list.length !== color_count) {
      throw new ValidationError('Color pages list mismatch', {
        message: 'Color pages list length must match color count',
        color_pages_list_length: color_pages_list.length,
        color_count,
      });
    }

    // Generate sequential token for today
    const token_no = await Order.generateToken(shop_id);

    // Calculate total amount
    const pricing = await Order.calculateTotal(
      shop_id,
      bw_count,
      color_count,
      binding,
      copies || 1
    );

    // Create order
    const order = new Order({
      shop_id,
      token_no,
      file_url,
      file_name,
      total_pages,
      bw_count,
      color_count,
      color_pages_list: color_pages_list || [],
      copies: copies || 1,
      binding: binding || 'none',
      total_amount: pricing.total_amount,
      customer_phone,
      notes,
    });

    await order.save();

    logger.info('Order created:', {
      orderId: order.order_id,
      shopId: shop_id,
      token: `#TOKEN-${token_no}`,
      totalAmount: pricing.total_amount,
    });

    // Emit WebSocket NEW_ORDER event
    websocketService.emitNewOrder(shop_id, {
      order_id: order.order_id,
      token_no: order.token_no,
      file_name: order.file_name,
      total_pages: order.total_pages,
      bw_count: order.bw_count,
      color_count: order.color_count,
      total_amount: order.total_amount,
      payment_status: order.payment_status,
      customer_phone: order.customer_phone,
      created_at: order.created_at,
    });

    res.status(201).json({
      status: 'success',
      data: {
        order_id: order.order_id,
        token_no: order.token_no,
        formatted_token: `#TOKEN-${order.token_no}`,
        shop_id: order.shop_id,
        total_pages: order.total_pages,
        bw_count: order.bw_count,
        color_count: order.color_count,
        copies: order.copies,
        binding: order.binding,
        pricing: {
          bw_cost: pricing.bw_cost,
          color_cost: pricing.color_cost,
          binding_cost: pricing.binding_cost,
          single_copy_cost: pricing.single_copy_cost,
          total_amount: pricing.total_amount,
        },
        payment_status: order.payment_status,
        order_status: order.order_status,
        created_at: order.created_at,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/orders/:orderId
 * Get order by ID
 */
router.get('/:orderId', async (req, res, next) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findOne({ order_id: orderId });
    if (!order) {
      throw new NotFoundError('Order', orderId);
    }

    res.json({
      status: 'success',
      data: {
        ...order.toJSON(),
        formatted_token: `#TOKEN-${order.token_no}`,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/orders/shop/:shopId
 * Get orders for a specific shop
 */
router.get('/shop/:shopId', async (req, res, next) => {
  try {
    const { shopId } = req.params;
    const { page = 1, limit = 20, status, payment_status } = req.query;
    const skip = (page - 1) * limit;

    // Build query
    let query = { shop_id: shopId };
    if (status) query.order_status = status;
    if (payment_status) query.payment_status = payment_status;

    const orders = await Order.find(query)
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ created_at: -1 });

    const total = await Order.countDocuments(query);

    res.json({
      status: 'success',
      data: orders.map(order => ({
        ...order.toJSON(),
        formatted_token: `#TOKEN-${order.token_no}`,
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/v1/orders/:orderId/cancel
 * Cancel order
 */
router.patch('/:orderId/cancel', async (req, res, next) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findOne({ order_id: orderId });
    if (!order) {
      throw new NotFoundError('Order', orderId);
    }

    // Can only cancel if not completed
    if (order.order_status === 'COMPLETED') {
      throw new ApiError(400, 'Cannot cancel a completed order');
    }

    // Can only cancel if not paid or if paid but not completed
    if (order.payment_status === 'PAID' && order.order_status === 'IN_PROGRESS') {
      throw new ApiError(400, 'Cannot cancel an order that is in progress and paid');
    }

    await order.cancelOrder();

    // Emit WebSocket update
    websocketService.emitOrderUpdate(order.shop_id, {
      order_id: order.order_id,
      payment_status: order.payment_status,
      order_status: order.order_status,
    });

    logger.info('Order cancelled:', { orderId: order.order_id });

    res.json({
      status: 'success',
      data: {
        order_id: order.order_id,
        order_status: order.order_status,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
