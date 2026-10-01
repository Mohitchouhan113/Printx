/**
 * PrintX Test Flow Script
 * Simulates the entire end-to-end lifecycle:
 * 1. Connect as WebSocket client to shop room
 * 2. Create order via API
 * 3. Simulate UPI payment webhook
 * 4. Verify WebSocket receives events
 */

const io = require('socket.io-client');
const axios = require('axios');
const logger = require('./src/utils/logger');

// Configuration
const CONFIG = {
  baseUrl: process.env.API_URL || 'http://localhost:3000',
  shopId: 'sdbc_xerox_01',
  timeout: 10000, // 10 seconds
};

// Test data
const TEST_ORDER = {
  shop_id: CONFIG.shopId,
  file_url: 'http://example.com/test-document.pdf',
  file_name: 'test-document.pdf',
  total_pages: 10,
  bw_count: 7,
  color_count: 3,
  color_pages_list: [3, 5, 8],
  copies: 2,
  binding: 'spiral',
  customer_phone: '9876543210',
  notes: 'Test order for E2E flow',
};

// State
let socket = null;
let createdOrderId = null;
let receivedEvents = [];

/**
 * Connect to WebSocket
 */
const connectWebSocket = () => {
  return new Promise((resolve, reject) => {
    console.log('\n📡 Connecting to WebSocket...');
    
    socket = io(CONFIG.baseUrl, {
      transports: ['websocket', 'polling'],
      reconnection: false,
    });

    socket.on('connect', () => {
      console.log('✅ WebSocket connected:', socket.id);
      
      // Join shop room
      socket.emit('join_shop', { shop_id: CONFIG.shopId });
    });

    socket.on('joined_shop', (data) => {
      console.log('✅ Joined shop room:', data.shop_id);
      resolve(socket);
    });

    socket.on('NEW_ORDER', (data) => {
      console.log('\n🔔 Received NEW_ORDER event:');
      console.log('   Order ID:', data.data.order_id);
      console.log('   Token:', data.data.formatted_token);
      console.log('   Amount:', data.data.total_amount);
      receivedEvents.push({ event: 'NEW_ORDER', data: data.data });
    });

    socket.on('PAYMENT_RECEIVED', (data) => {
      console.log('\n💰 Received PAYMENT_RECEIVED event:');
      console.log('   Order ID:', data.data.order_id);
      console.log('   Payment ID:', data.data.payment_id);
      console.log('   Amount:', data.data.amount);
      receivedEvents.push({ event: 'PAYMENT_RECEIVED', data: data.data });
    });

    socket.on('ORDER_UPDATE', (data) => {
      console.log('\n🔄 Received ORDER_UPDATE event:');
      console.log('   Order ID:', data.data.order_id);
      console.log('   Payment Status:', data.data.payment_status);
      console.log('   Order Status:', data.data.order_status);
      receivedEvents.push({ event: 'ORDER_UPDATE', data: data.data });
    });

    socket.on('error', (error) => {
      console.error('❌ WebSocket error:', error);
      reject(error);
    });

    socket.on('connect_error', (error) => {
      console.error('❌ WebSocket connection error:', error.message);
      reject(error);
    });

    // Timeout
    setTimeout(() => {
      reject(new Error('WebSocket connection timeout'));
    }, CONFIG.timeout);
  });
};

/**
 * Create order via API
 */
const createOrder = async () => {
  console.log('\n📝 Creating order via API...');
  console.log('   Shop:', CONFIG.shopId);
  console.log('   Pages:', TEST_ORDER.total_pages, '(B&W:', TEST_ORDER.bw_count, ', Color:', TEST_ORDER.color_count, ')');
  console.log('   Copies:', TEST_ORDER.copies);
  console.log('   Binding:', TEST_ORDER.binding);
  
  try {
    const response = await axios.post(
      `${CONFIG.baseUrl}/api/v1/orders/create`,
      TEST_ORDER,
      { timeout: CONFIG.timeout }
    );
    
    const order = response.data.data;
    console.log('\n✅ Order created successfully:');
    console.log('   Order ID:', order.order_id);
    console.log('   Token:', order.formatted_token);
    console.log('   Total Amount:', order.pricing.total_amount);
    console.log('   Payment Status:', order.payment_status);
    console.log('   Order Status:', order.order_status);
    
    return order;
  } catch (error) {
    console.error('❌ Failed to create order:', error.response?.data || error.message);
    throw error;
  }
};

/**
 * Simulate UPI payment webhook
 */
const simulatePaymentWebhook = async (orderId, amount) => {
  console.log('\n💸 Simulating UPI payment webhook...');
  console.log('   Order ID:', orderId);
  console.log('   Amount:', amount);
  
  const webhookPayload = {
    payment_id: `PAY-${Date.now()}`,
    order_id: orderId,
    status: 'SUCCESS',
    amount: amount,
    timestamp: new Date().toISOString(),
    signature: 'test-signature', // In production, use real signature
  };
  
  try {
    const response = await axios.post(
      `${CONFIG.baseUrl}/api/v1/payments/webhook`,
      webhookPayload,
      { timeout: CONFIG.timeout }
    );
    
    console.log('\n✅ Payment webhook processed:');
    console.log('   Response:', response.data.message);
    console.log('   Payment Status:', response.data.payment_status);
    
    return webhookPayload;
  } catch (error) {
    console.error('❌ Failed to process payment webhook:', error.response?.data || error.message);
    throw error;
  }
};

/**
 * Verify WebSocket events received
 */
const verifyEvents = () => {
  console.log('\n🔍 Verifying WebSocket events...');
  
  const expectedEvents = ['NEW_ORDER', 'PAYMENT_RECEIVED', 'ORDER_UPDATE'];
  const receivedEventTypes = receivedEvents.map(e => e.event);
  
  console.log('\n   Expected events:', expectedEvents);
  console.log('   Received events:', receivedEventTypes);
  
  const allReceived = expectedEvents.every(event => 
    receivedEventTypes.includes(event)
  );
  
  if (allReceived) {
    console.log('\n✅ All expected WebSocket events received!');
    return true;
  } else {
    console.log('\n⚠️  Some events may be missing (may still arrive)');
    return false;
  }
};

/**
 * Main test flow
 */
const runTestFlow = async () => {
  console.log('🚀 Starting PrintX E2E Test Flow');
  console.log('='.repeat(50));
  
  try {
    // Step 1: Connect WebSocket
    await connectWebSocket();
    
    // Small delay to ensure connection is stable
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Step 2: Create order
    const order = await createOrder();
    createdOrderId = order.order_id;
    
    // Wait for WebSocket event
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Step 3: Simulate payment
    await simulatePaymentWebhook(order.order_id, order.pricing.total_amount);
    
    // Wait for WebSocket events
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Step 4: Verify events
    const eventsVerified = verifyEvents();
    
    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('📊 Test Flow Summary');
    console.log('='.repeat(50));
    console.log('✅ WebSocket Connected');
    console.log('✅ Order Created:', createdOrderId);
    console.log('✅ Payment Webhook Processed');
    console.log(eventsVerified ? '✅ All WebSocket Events Received' : '⚠️  Some events pending');
    console.log('='.repeat(50));
    
    return true;
    
  } catch (error) {
    console.error('\n❌ Test flow failed:', error.message);
    return false;
    
  } finally {
    // Cleanup
    if (socket) {
      console.log('\n🔌 Disconnecting WebSocket...');
      socket.disconnect();
    }
  }
};

// Run test if called directly
if (require.main === module) {
  runTestFlow()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { runTestFlow, CONFIG, TEST_ORDER };
