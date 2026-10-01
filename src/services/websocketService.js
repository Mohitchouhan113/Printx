/**
 * PrintX WebSocket Service
 * Handles real-time communication with shop clients
 */

const { Server } = require('socket.io');
const logger = require('../utils/logger');

class WebSocketService {
  constructor() {
    this.io = null;
    this.connectedClients = new Map(); // shopId -> Set of socket ids
  }

  /**
   * Initialize WebSocket server
   * @param {http.Server} server - HTTP server instance
   */
  initialize(server) {
    this.io = new Server(server, {
      cors: {
        origin: process.env.NODE_ENV === 'production' 
          ? ['https://yourdomain.com']
          : ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:5000'],
        methods: ['GET', 'POST'],
        credentials: true,
      },
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    this.setupEventHandlers();
    logger.info('WebSocket service initialized');
  }

  /**
   * Setup WebSocket event handlers
   */
  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      logger.info(`WebSocket client connected: ${socket.id}`);

      // Handle shop room join
      socket.on('join_shop', (data) => {
        const { shop_id } = data;
        
        if (!shop_id) {
          socket.emit('error', { message: 'shop_id is required' });
          return;
        }

        // Join the shop's room
        socket.join(`shop_${shop_id}`);
        
        // Track connected client
        if (!this.connectedClients.has(shop_id)) {
          this.connectedClients.set(shop_id, new Set());
        }
        this.connectedClients.get(shop_id).add(socket.id);
        
        // Store shop_id on socket for cleanup
        socket.shop_id = shop_id;
        
        logger.info(`Client ${socket.id} joined room shop_${shop_id}`);
        socket.emit('joined_shop', { 
          shop_id, 
          message: `Connected to ${shop_id} updates`,
          timestamp: new Date().toISOString(),
        });
      });

      // Handle shop room leave
      socket.on('leave_shop', (data) => {
        const { shop_id } = data;
        socket.leave(`shop_${shop_id}`);
        
        if (this.connectedClients.has(shop_id)) {
          this.connectedClients.get(shop_id).delete(socket.id);
        }
        
        logger.info(`Client ${socket.id} left room shop_${shop_id}`);
      });

      // Handle disconnect
      socket.on('disconnect', (reason) => {
        logger.info(`WebSocket client disconnected: ${socket.id} (${reason})`);
        
        // Clean up tracking
        if (socket.shop_id && this.connectedClients.has(socket.shop_id)) {
          this.connectedClients.get(socket.shop_id).delete(socket.id);
        }
      });

      // Handle errors
      socket.on('error', (error) => {
        logger.error(`WebSocket error for ${socket.id}:`, error);
      });

      // Ping/pong for keepalive
      socket.on('ping', () => {
        socket.emit('pong', { timestamp: new Date().toISOString() });
      });
    });
  }

  /**
   * Emit new order event to shop room
   * @param {string} shopId - Shop ID
   * @param {Object} orderData - Order data to broadcast
   */
  emitNewOrder(shopId, orderData) {
    if (!this.io) {
      logger.warn('WebSocket not initialized, cannot emit new order');
      return false;
    }

    const payload = {
      event: 'NEW_ORDER',
      data: {
        order_id: orderData.order_id,
        token_no: orderData.token_no,
        formatted_token: `#TOKEN-${orderData.token_no}`,
        file_name: orderData.file_name,
        total_pages: orderData.total_pages,
        bw_count: orderData.bw_count,
        color_count: orderData.color_count,
        total_amount: orderData.total_amount,
        payment_status: orderData.payment_status,
        customer_phone: orderData.customer_phone,
        created_at: orderData.created_at,
        timestamp: new Date().toISOString(),
      },
    };

    this.io.to(`shop_${shopId}`).emit('NEW_ORDER', payload);
    logger.info(`Emitted NEW_ORDER to shop_${shopId}:`, { orderId: orderData.order_id });
    return true;
  }

  /**
   * Emit order status update to shop room
   * @param {string} shopId - Shop ID
   * @param {Object} updateData - Status update data
   */
  emitOrderUpdate(shopId, updateData) {
    if (!this.io) {
      logger.warn('WebSocket not initialized, cannot emit order update');
      return false;
    }

    const payload = {
      event: 'ORDER_UPDATE',
      data: {
        order_id: updateData.order_id,
        payment_status: updateData.payment_status,
        order_status: updateData.order_status,
        payment_id: updateData.payment_id,
        timestamp: new Date().toISOString(),
      },
    };

    this.io.to(`shop_${shopId}`).emit('ORDER_UPDATE', payload);
    logger.info(`Emitted ORDER_UPDATE to shop_${shopId}:`, { orderId: updateData.order_id });
    return true;
  }

  /**
   * Emit payment received event
   * @param {string} shopId - Shop ID
   * @param {Object} paymentData - Payment data
   */
  emitPaymentReceived(shopId, paymentData) {
    if (!this.io) {
      logger.warn('WebSocket not initialized, cannot emit payment received');
      return false;
    }

    const payload = {
      event: 'PAYMENT_RECEIVED',
      data: {
        order_id: paymentData.order_id,
        payment_id: paymentData.payment_id,
        amount: paymentData.amount,
        timestamp: new Date().toISOString(),
      },
    };

    this.io.to(`shop_${shopId}`).emit('PAYMENT_RECEIVED', payload);
    logger.info(`Emitted PAYMENT_RECEIVED to shop_${shopId}:`, { orderId: paymentData.order_id });
    return true;
  }

  /**
   * Get connected clients count for a shop
   * @param {string} shopId - Shop ID
   * @returns {number} Number of connected clients
   */
  getConnectedClientsCount(shopId) {
    return this.connectedClients.has(shopId) 
      ? this.connectedClients.get(shopId).size 
      : 0;
  }

  /**
   * Get all connected shops
   * @returns {Array} List of shop IDs with client counts
   */
  getConnectedShops() {
    const shops = [];
    this.connectedClients.forEach((clients, shopId) => {
      shops.push({ shop_id: shopId, clients: clients.size });
    });
    return shops;
  }

  /**
   * Broadcast to all connected clients
   * @param {string} event - Event name
   * @param {Object} data - Data to broadcast
   */
  broadcast(event, data) {
    if (!this.io) {
      logger.warn('WebSocket not initialized, cannot broadcast');
      return false;
    }

    this.io.emit(event, { data, timestamp: new Date().toISOString() });
    logger.info(`Broadcasted ${event} to all clients`);
    return true;
  }
}

module.exports = new WebSocketService();
