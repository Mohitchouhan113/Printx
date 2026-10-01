/**
 * PrintX Order Controller
 * Handles order creation, pricing calculation, and token generation
 */

const Order = require('../models/Order');
const Shop = require('../models/Shop');
const { PDFDocument } = require('pdf-lib');
const { ApiError, NotFoundError, ValidationError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

/**
 * Create a new order
 * POST /api/orders
 */
const createOrder = async (req, res, next) => {
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
};

/**
 * Get order by ID
 * GET /api/orders/:orderId
 */
const getOrder = async (req, res, next) => {
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
};

/**
 * Get orders by shop
 * GET /api/shops/:shopId/orders
 */
const getShopOrders = async (req, res, next) => {
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
};

/**
 * Get current token for shop
 * GET /api/shops/:shopId/token/current
 */
const getCurrentToken = async (req, res, next) => {
  try {
    const { shopId } = req.params;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get today's orders count
    const count = await Order.countDocuments({
      shop_id: shopId,
      created_at: {
        $gte: today,
        $lt: tomorrow,
      },
    });

    res.json({
      status: 'success',
      data: {
        shop_id: shopId,
        current_token: count,
        next_token: count + 1,
        formatted_current: count > 0 ? `#TOKEN-${count}` : null,
        formatted_next: `#TOKEN-${count + 1}`,
        max_tokens: 99,
        is_limit_reached: count >= 99,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get order statistics for shop
 * GET /api/shops/:shopId/stats
 */
const getShopStats = async (req, res, next) => {
  try {
    const { shopId } = req.params;
    const { period = 'today' } = req.query;

    let startDate = new Date();
    startDate.setHours(0, 0, 0, 0);

    if (period === 'week') {
      startDate.setDate(startDate.getDate() - 7);
    } else if (period === 'month') {
      startDate.setMonth(startDate.getMonth() - 1);
    }

    const stats = await Order.aggregate([
      {
        $match: {
          shop_id: shopId,
          created_at: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: null,
          total_orders: { $sum: 1 },
          total_revenue: { $sum: '$total_amount' },
          paid_orders: {
            $sum: { $cond: [{ $eq: ['$payment_status', 'PAID'] }, 1, 0] },
          },
          pending_orders: {
            $sum: { $cond: [{ $eq: ['$payment_status', 'PENDING_PAYMENT'] }, 1, 0] },
          },
          total_pages: { $sum: '$total_pages' },
        },
      },
    ]);

    res.json({
      status: 'success',
      data: {
        shop_id: shopId,
        period,
        stats: stats[0] || {
          total_orders: 0,
          total_revenue: 0,
          paid_orders: 0,
          pending_orders: 0,
          total_pages: 0,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Analyze PDF document
 * POST /api/analyze
 */
const analyzeDocument = async (req, res, next) => {
  try {
    // Check if file was uploaded
    if (!req.file) {
      throw new ValidationError('No file uploaded', {
        message: 'Please upload a PDF file',
      });
    }

    const fileBuffer = req.file.buffer;
    const fileName = req.file.originalname;
    const fileSize = req.file.size;

    // Load PDF using pdf-lib
    const pdfDoc = await PDFDocument.load(fileBuffer, { 
      ignoreEncryption: true 
    });

    const totalPages = pdfDoc.getPageCount();
    
    // Color detection using page streams
    let colorPagesCount = 0;
    const colorPagesList = [];

    // Analyze each page for color content
    for (let i = 0; i < totalPages; i++) {
      const page = pdfDoc.getPage(i);
      let hasColor = false;

      // Method 1: Check page content stream for color operators
      try {
        const contentStream = page.node.Contents();
        if (contentStream) {
          const stream = contentStream.toString();
          // Look for color operators (RG, rg, K, k, CS, cs, SC, sc)
          const colorOperators = /[RG|rg|K|k|CS|cs|SC|sc|SCN|scn]/;
          if (colorOperators.test(stream)) {
            hasColor = true;
          }
        }
      } catch (e) {
        // Stream parsing failed, continue
      }

      // Method 2: Check for non-grayscale color spaces
      try {
        const pageDict = page.node;
        const resourcesDict = pageDict.get(PDFDocument.Name.of('Resources'));
        if (resourcesDict) {
          const cs = resourcesDict.get(PDFDocument.Name.of('ColorSpace'));
          if (cs && cs.toString().includes('DeviceRGB')) {
            hasColor = true;
          }
          if (cs && cs.toString().includes('DeviceCMYK')) {
            hasColor = true;
          }
        }
      } catch (e) {
        // Resource parsing failed, continue
      }

      // Method 3: Check XObject resources for images
      try {
        const pageDict = page.node;
        const resourcesDict = pageDict.get(PDFDocument.Name.of('Resources'));
        if (resourcesDict) {
          const xObjects = resourcesDict.get(PDFDocument.Name.of('XObject'));
          if (xObjects) {
            // If page has images, it likely has color
            hasColor = true;
          }
        }
      } catch (e) {
        // XObject parsing failed, continue
      }

      if (hasColor) {
        colorPagesCount++;
        colorPagesList.push(i + 1); // 1-based index
      }
    }

    const bwPagesCount = totalPages - colorPagesCount;
    const fileSizeKb = (fileSize / 1024).toFixed(2);

    logger.info('PDF analyzed:', {
      fileName,
      totalPages,
      colorPages: colorPagesCount,
      bwPages: bwPagesCount,
    });

    res.json({
      status: 'success',
      data: {
        file_name: fileName,
        total_pages: totalPages,
        bw_pages_count: bwPagesCount,
        color_pages_count: colorPagesCount,
        color_pages_list: colorPagesList,
        file_size_kb: parseFloat(fileSizeKb),
      },
    });
  } catch (error) {
    logger.error('PDF analysis error:', error);
    
    // If pdf-lib fails, return error with suggestion
    if (error.message && error.message.includes('encrypted')) {
      throw new ApiError(400, 'PDF is encrypted and cannot be analyzed');
    }
    
    next(error);
  }
};

/**
 * Cancel order
 * PATCH /api/orders/:orderId/cancel
 */
const cancelOrder = async (req, res, next) => {
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
};

module.exports = {
  createOrder,
  getOrder,
  getShopOrders,
  getCurrentToken,
  getShopStats,
  cancelOrder,
  analyzeDocument,
};
