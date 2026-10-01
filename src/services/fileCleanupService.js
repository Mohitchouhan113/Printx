/**
 * PrintX File Cleanup Service
 * Handles automatic deletion of uploaded PDFs after 24 hours
 */

const fs = require('fs').promises;
const path = require('path');
const cron = require('node-cron');
const Order = require('../models/Order');
const config = require('../config/config');
const logger = require('../utils/logger');

class FileCleanupService {
  constructor() {
    this.isRunning = false;
    this.cronJob = null;
  }

  /**
   * Start the cleanup cron job
   * Runs every hour to check for files to delete
   */
  start() {
    // Run every hour at minute 0
    this.cronJob = cron.schedule('0 * * * *', async () => {
      await this.cleanupOldFiles();
    }, {
      scheduled: true,
      timezone: 'Asia/Kolkata',
    });

    logger.info('File cleanup service started (runs every hour)');
  }

  /**
   * Stop the cleanup cron job
   */
  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      logger.info('File cleanup service stopped');
    }
  }

  /**
   * Cleanup files older than retention period
   */
  async cleanupOldFiles() {
    if (this.isRunning) {
      logger.warn('Cleanup already in progress, skipping...');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      logger.info('Starting file cleanup...');

      // Calculate cutoff time (24 hours ago)
      const cutoffTime = new Date(Date.now() - config.fileRetentionHours * 60 * 60 * 1000);

      // Find orders older than retention period with completed status
      const oldOrders = await Order.find({
        created_at: { $lt: cutoffTime },
        order_status: 'COMPLETED',
      }).select('file_url file_name order_id');

      logger.info(`Found ${oldOrders.length} orders to cleanup`);

      let deletedCount = 0;
      let errorCount = 0;

      for (const order of oldOrders) {
        try {
          await this.deleteFile(order.file_url, order.order_id);
          deletedCount++;
        } catch (error) {
          logger.error(`Failed to delete file for order ${order.order_id}:`, error);
          errorCount++;
        }
      }

      const duration = Date.now() - startTime;
      logger.info(`File cleanup completed in ${duration}ms`, {
        deleted: deletedCount,
        errors: errorCount,
      });

    } catch (error) {
      logger.error('File cleanup service error:', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Delete a specific file
   */
  async deleteFile(fileUrl, orderId) {
    // Extract filename from URL or path
    const filename = path.basename(fileUrl);
    const filePath = path.join(config.upload.dir, filename);

    try {
      // Check if file exists
      await fs.access(filePath);
      
      // Delete the file
      await fs.unlink(filePath);
      
      logger.info(`Deleted file: ${filename} (Order: ${orderId})`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, not an error
        logger.debug(`File not found, may have been deleted already: ${filename}`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Cleanup files for a specific order (manual cleanup)
   */
  async cleanupOrderFiles(orderId) {
    const order = await Order.findOne({ order_id: orderId });
    if (!order) {
      throw new Error('Order not found');
    }

    await this.deleteFile(order.file_url, order.order_id);
  }

  /**
   * Get cleanup status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      cronJobActive: this.cronJob !== null,
      retentionHours: config.fileRetentionHours,
    };
  }
}

module.exports = new FileCleanupService();
