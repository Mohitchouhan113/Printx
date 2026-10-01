/**
 * PrintX Order Routes
 */

const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const orderController = require('../controllers/orderController');
const validate = require('../middleware/validate');

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

// Routes
router.post('/', createOrderValidation, orderController.createOrder);
router.get('/:orderId', orderController.getOrder);
router.patch('/:orderId/cancel', orderController.cancelOrder);

module.exports = router;
