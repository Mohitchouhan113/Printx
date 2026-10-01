/**
 * PrintX Seed Script
 * Populates MongoDB with initial shop data
 */

require('dotenv').config();
const mongoose = require('mongoose');
const config = require('../config/config');
const Shop = require('../models/Shop');
const logger = require('./logger');

/**
 * Seed data for initial shops
 */
const seedShops = [
  {
    shop_id: 'sdbc_xerox_01',
    name: 'Sharma Xerox (SDBC Campus)',
    owner_phone: '9876543210', // 10-digit Indian format
    rates: {
      bw: 2.0,        // ₹2 per B&W page
      color: 5.0,     // ₹5 per color page
      spiral: 20.0,   // ₹20 for spiral binding
      stapler: 5.0,   // ₹5 for stapler binding
    },
    address: {
      street: 'SDBC Campus, Main Road',
      city: 'Bangalore',
      state: 'Karnataka',
      pincode: '560001',
    },
    is_active: true,
    operating_hours: {
      open: '08:00',
      close: '22:00',
    },
  },
  {
    shop_id: 'downtown_print_01',
    name: 'Downtown Print & Copy',
    owner_phone: '9876543211',
    rates: {
      bw: 1.5,
      color: 4.0,
      spiral: 15.0,
      stapler: 3.0,
    },
    address: {
      street: '123 Main Street',
      city: 'Bangalore',
      state: 'Karnataka',
      pincode: '560002',
    },
    is_active: true,
    operating_hours: {
      open: '09:00',
      close: '21:00',
    },
  },
  {
    shop_id: 'quick_copy_01',
    name: 'Quick Copy Center',
    owner_phone: '9876543212',
    rates: {
      bw: 1.0,
      color: 3.5,
      spiral: 18.0,
      stapler: 4.0,
    },
    address: {
      street: '456 Park Avenue',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400001',
    },
    is_active: true,
    operating_hours: {
      open: '07:00',
      close: '23:00',
    },
  },
];

/**
 * Connect to MongoDB
 */
const connectDB = async () => {
  try {
    await mongoose.connect(config.mongodb.uri, config.mongodb.options);
    logger.info('Connected to MongoDB for seeding');
  } catch (error) {
    logger.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

/**
 * Seed shops to database
 */
const seedShopsData = async () => {
  try {
    // Clear existing shops
    await Shop.deleteMany({});
    logger.info('Cleared existing shops');

    // Insert seed data
    const shops = await Shop.insertMany(seedShops);
    logger.info(`Successfully seeded ${shops.length} shops`);

    // Print seeded shops
    shops.forEach(shop => {
      logger.info(`  ✓ ${shop.shop_id}: ${shop.name}`);
    });

    return shops;
  } catch (error) {
    logger.error('Error seeding shops:', error);
    throw error;
  }
};

/**
 * Main seed function
 */
const seed = async () => {
  try {
    logger.info('Starting PrintX seed script...');
    
    await connectDB();
    await seedShopsData();
    
    logger.info('Seed completed successfully!');
    logger.info('\nSeeded shop IDs:');
    seedShops.forEach(shop => {
      logger.info(`  - ${shop.shop_id} (${shop.name})`);
    });
    
    process.exit(0);
  } catch (error) {
    logger.error('Seed failed:', error);
    process.exit(1);
  }
};

// Run seed if called directly
if (require.main === module) {
  seed();
}

module.exports = { seed, seedShops };
