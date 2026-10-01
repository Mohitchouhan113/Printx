/**
 * PrintX Shop Controller
 * Handles shop CRUD operations
 */

const Shop = require('../models/Shop');
const { ApiError, NotFoundError, ConflictError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

/**
 * Create a new shop
 * POST /api/shops
 */
const createShop = async (req, res, next) => {
  try {
    const { name, owner_phone, rates, address, operating_hours } = req.body;

    // Check if shop already exists with this phone
    const existingShop = await Shop.findByOwnerPhone(owner_phone);
    if (existingShop) {
      throw new ConflictError('A shop with this phone number already exists');
    }

    // Create shop
    const shop = new Shop({
      name,
      owner_phone,
      rates,
      address,
      operating_hours,
    });

    await shop.save();

    logger.info('Shop created:', { shopId: shop.shop_id, name: shop.name });

    res.status(201).json({
      status: 'success',
      data: {
        shop_id: shop.shop_id,
        name: shop.name,
        owner_phone: shop.owner_phone,
        rates: shop.rates,
        address: shop.address,
        is_active: shop.is_active,
        created_at: shop.created_at,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get shop by ID
 * GET /api/shops/:shopId
 */
const getShop = async (req, res, next) => {
  try {
    const { shopId } = req.params;

    const shop = await Shop.findByShopId(shopId);
    if (!shop) {
      throw new NotFoundError('Shop', shopId);
    }

    res.json({
      status: 'success',
      data: shop.toJSON(),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all active shops
 * GET /api/shops
 */
const getAllShops = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, city } = req.query;
    const skip = (page - 1) * limit;

    let query = { is_active: true };
    if (city) {
      query['address.city'] = city;
    }

    const shops = await Shop.find(query)
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ created_at: -1 });

    const total = await Shop.countDocuments(query);

    res.json({
      status: 'success',
      data: shops,
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
 * Update shop
 * PUT /api/shops/:shopId
 */
const updateShop = async (req, res, next) => {
  try {
    const { shopId } = req.params;
    const updates = req.body;

    const shop = await Shop.findByShopId(shopId);
    if (!shop) {
      throw new NotFoundError('Shop', shopId);
    }

    // Update fields
    Object.keys(updates).forEach(key => {
      if (key === 'rates') {
        // Merge rates
        shop.rates = { ...shop.rates, ...updates.rates };
      } else if (shop[key] !== undefined) {
        shop[key] = updates[key];
      }
    });

    await shop.save();

    logger.info('Shop updated:', { shopId: shop.shop_id });

    res.json({
      status: 'success',
      data: shop.toJSON(),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update shop rates
 * PATCH /api/shops/:shopId/rates
 */
const updateShopRates = async (req, res, next) => {
  try {
    const { shopId } = req.params;
    const { rates } = req.body;

    const shop = await Shop.findByShopId(shopId);
    if (!shop) {
      throw new NotFoundError('Shop', shopId);
    }

    await shop.updateRates(rates);

    logger.info('Shop rates updated:', { shopId: shop.shop_id, rates });

    res.json({
      status: 'success',
      data: {
        shop_id: shop.shop_id,
        rates: shop.rates,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Deactivate shop
 * DELETE /api/shops/:shopId
 */
const deactivateShop = async (req, res, next) => {
  try {
    const { shopId } = req.params;

    const shop = await Shop.findByShopId(shopId);
    if (!shop) {
      throw new NotFoundError('Shop', shopId);
    }

    shop.is_active = false;
    await shop.save();

    logger.info('Shop deactivated:', { shopId: shop.shop_id });

    res.json({
      status: 'success',
      message: 'Shop deactivated successfully',
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createShop,
  getShop,
  getAllShops,
  updateShop,
  updateShopRates,
  deactivateShop,
};
