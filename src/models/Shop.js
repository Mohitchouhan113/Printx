/**
 * PrintX Shop Model
 * Represents a xerox shop with its pricing rates
 */

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * Rate Schema - Pricing rates for a shop
 */
const rateSchema = new mongoose.Schema({
  bw: {
    type: Number,
    required: true,
    min: 0,
    description: 'Black & White per page rate',
  },
  color: {
    type: Number,
    required: true,
    min: 0,
    description: 'Color per page rate',
  },
  spiral: {
    type: Number,
    required: true,
    min: 0,
    description: 'Spiral binding cost',
  },
  stapler: {
    type: Number,
    required: true,
    min: 0,
    description: 'Stapler binding cost',
  },
}, { _id: false });

/**
 * Shop Schema
 */
const shopSchema = new mongoose.Schema({
  shop_id: {
    type: String,
    required: true,
    unique: true,
    default: () => `SHOP-${uuidv4().substring(0, 8).toUpperCase()}`,
    index: true,
  },
  name: {
    type: String,
    required: [true, 'Shop name is required'],
    trim: true,
    maxlength: [100, 'Shop name cannot exceed 100 characters'],
  },
  owner_phone: {
    type: String,
    required: [true, 'Owner phone number is required'],
    unique: true,
    validate: {
      validator: function (v) {
        // Indian phone number format (10 digits)
        return /^[6-9]\d{9}$/.test(v);
      },
      message: 'Invalid phone number format',
    },
  },
  rates: {
    type: rateSchema,
    required: true,
  },
  address: {
    street: String,
    city: String,
    state: String,
    pincode: String,
  },
  is_active: {
    type: Boolean,
    default: true,
  },
  operating_hours: {
    open: { type: String, default: '09:00' },
    close: { type: String, default: '21:00' },
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

// Index for faster lookups
shopSchema.index({ owner_phone: 1 });
shopSchema.index({ is_active: 1 });

// Static method to find shop by ID
shopSchema.statics.findByShopId = function (shopId) {
  return this.findOne({ shop_id: shopId, is_active: true });
};

// Static method to find shop by owner phone
shopSchema.statics.findByOwnerPhone = function (phone) {
  return this.findOne({ owner_phone: phone });
};

// Instance method to get rates
shopSchema.methods.getRates = function () {
  return this.rates;
};

// Instance method to update rates
shopSchema.methods.updateRates = async function (newRates) {
  Object.assign(this.rates, newRates);
  return this.save();
};

const Shop = mongoose.model('Shop', shopSchema);

module.exports = Shop;
