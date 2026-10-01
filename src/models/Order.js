/**
 * PrintX Order Model
 * Represents a printing order with pricing and token management
 */

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * Order Schema
 */
const orderSchema = new mongoose.Schema({
  order_id: {
    type: String,
    required: true,
    unique: true,
    default: () => `ORD-${uuidv4().substring(0, 8).toUpperCase()}`,
    index: true,
  },
  token_no: {
    type: Number,
    required: true,
    min: 1,
    max: 99,
  },
  shop_id: {
    type: String,
    required: true,
    index: true,
    ref: 'Shop',
  },
  file_url: {
    type: String,
    required: [true, 'File URL is required'],
  },
  file_name: {
    type: String,
    required: true,
  },
  total_pages: {
    type: Number,
    required: true,
    min: 1,
  },
  bw_count: {
    type: Number,
    required: true,
    min: 0,
    default: 0,
  },
  color_count: {
    type: Number,
    required: true,
    min: 0,
    default: 0,
  },
  color_pages_list: {
    type: [Number],
    default: [],
    validate: {
      validator: function (v) {
        return v.every(page => page > 0 && Number.isInteger(page));
      },
      message: 'Color pages must be positive integers',
    },
  },
  copies: {
    type: Number,
    required: true,
    min: 1,
    default: 1,
  },
  binding: {
    type: String,
    enum: ['none', 'spiral', 'stapler'],
    default: 'none',
  },
  total_amount: {
    type: Number,
    required: true,
    min: 0,
  },
  payment_status: {
    type: String,
    enum: ['PENDING_PAYMENT', 'PAID', 'FAILED', 'REFUNDED'],
    default: 'PENDING_PAYMENT',
    required: true,
  },
  order_status: {
    type: String,
    enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
    default: 'PENDING',
    required: true,
  },
  payment_id: {
    type: String,
    sparse: true,
  },
  paid_at: {
    type: Date,
  },
  customer_phone: {
    type: String,
    validate: {
      validator: function (v) {
        if (!v) return true;
        return /^[6-9]\d{9}$/.test(v);
      },
      message: 'Invalid phone number format',
    },
  },
  notes: {
    type: String,
    maxlength: 500,
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
  toJSON: {
    transform: function (doc, ret) {
      delete ret.__v;
      return ret;
    },
  },
});

// Compound indexes for efficient queries
orderSchema.index({ shop_id: 1, created_at: -1 });
orderSchema.index({ shop_id: 1, payment_status: 1 });
orderSchema.index({ shop_id: 1, order_status: 1 });
orderSchema.index({ created_at: 1 }, { expireAfterSeconds: 86400 }); // 24-hour TTL for auto-deletion

// Static method to generate daily token
orderSchema.statics.generateToken = async function (shopId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Count existing orders for this shop today
  const count = await this.countDocuments({
    shop_id: shopId,
    created_at: {
      $gte: today,
      $lt: tomorrow,
    },
  });

  // Sequential token from #1 to #99
  const tokenNo = count + 1;

  if (tokenNo > 99) {
    throw new Error('Daily token limit reached for this shop');
  }

  return tokenNo;
};

// Static method to calculate total amount
orderSchema.statics.calculateTotal = async function (shopId, bwCount, colorCount, binding, copies) {
  const Shop = mongoose.model('Shop');
  const shop = await Shop.findByShopId(shopId);

  if (!shop) {
    throw new Error('Shop not found');
  }

  const rates = shop.getRates();

  // Calculate binding cost
  let bindingCost = 0;
  if (binding === 'spiral') {
    bindingCost = rates.spiral;
  } else if (binding === 'stapler') {
    bindingCost = rates.stapler;
  }

  // Calculate page costs
  const bwCost = bwCount * rates.bw;
  const colorCost = colorCount * rates.color;

  // Total for one copy
  const singleCopyCost = bwCost + colorCost + bindingCost;

  // Total for all copies
  const totalAmount = singleCopyCost * copies;

  return {
    bw_cost: bwCost,
    color_cost: colorCost,
    binding_cost: bindingCost,
    single_copy_cost: singleCopyCost,
    total_amount: totalAmount,
    rates,
  };
};

// Instance method to mark as paid
orderSchema.methods.markAsPaid = async function (paymentId) {
  this.payment_status = 'PAID';
  this.payment_id = paymentId;
  this.paid_at = new Date();
  this.order_status = 'IN_PROGRESS';
  return this.save();
};

// Instance method to mark payment failed
orderSchema.methods.markPaymentFailed = async function () {
  this.payment_status = 'FAILED';
  return this.save();
};

// Instance method to complete order
orderSchema.methods.markCompleted = async function () {
  this.order_status = 'COMPLETED';
  return this.save();
};

// Instance method to cancel order
orderSchema.methods.cancelOrder = async function () {
  this.order_status = 'CANCELLED';
  return this.save();
};

// Instance method to get formatted token
orderSchema.methods.getFormattedToken = function () {
  return `#TOKEN-${this.token_no}`;
};

const Order = mongoose.model('Order', orderSchema);

module.exports = Order;
