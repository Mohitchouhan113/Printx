/**
 * PrintX Database Connection
 * MongoDB connection management with retry logic
 */

const mongoose = require('mongoose');
const config = require('./config');
const logger = require('../utils/logger');

class Database {
  constructor() {
    this.connection = null;
    this.isConnected = false;
  }

  /**
   * Connect to MongoDB with retry logic
   * @param {number} retries - Number of connection attempts
   * @param {number} delay - Delay between retries in ms
   */
  async connect(retries = 5, delay = 5000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        logger.info(`Attempting to connect to MongoDB (attempt ${attempt}/${retries})...`);

        this.connection = await mongoose.connect(config.mongodb.uri, config.mongodb.options);

        this.isConnected = true;

        // Handle connection events
        mongoose.connection.on('error', (err) => {
          logger.error('MongoDB connection error:', err);
          this.isConnected = false;
        });

        mongoose.connection.on('disconnected', () => {
          logger.warn('MongoDB disconnected');
          this.isConnected = false;
        });

        mongoose.connection.on('reconnected', () => {
          logger.info('MongoDB reconnected');
          this.isConnected = true;
        });

        logger.info('Successfully connected to MongoDB');
        return this.connection;

      } catch (error) {
        logger.error(`MongoDB connection attempt ${attempt} failed:`, error.message);

        if (attempt < retries) {
          logger.info(`Retrying in ${delay / 1000} seconds...`);
          await this.sleep(delay);
          delay = Math.min(delay * 2, 30000); // Exponential backoff, max 30s
        } else {
          logger.error('Max connection retries reached. Exiting...');
          process.exit(1);
        }
      }
    }
  }

  /**
   * Disconnect from MongoDB
   */
  async disconnect() {
    try {
      await mongoose.connection.close();
      this.isConnected = false;
      logger.info('MongoDB connection closed');
    } catch (error) {
      logger.error('Error closing MongoDB connection:', error);
    }
  }

  /**
   * Get connection status
   */
  getStatus() {
    return {
      isConnected: this.isConnected,
      readyState: mongoose.connection.readyState,
      host: mongoose.connection.host,
      port: mongoose.connection.port,
      name: mongoose.connection.name,
    };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new Database();
