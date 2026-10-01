/**
 * PrintX Shop Routes
 */

const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const shopController = require('../controllers/shopController');
const validate = require('../middleware/validate');

// Validation rules
const createShopValidation = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Shop name is required')
    .isLength({ max: 100 })
    .withMessage('Shop name cannot exceed 100 characters'),
  body('owner_phone')
    .trim()
    .notEmpty()
    .withMessage('Owner phone is required')
    .matches(/^[6-9]\d{9}$/)
    .withMessage('Invalid Indian phone number'),
  body('rates.bw')
    .isNumeric()
    .withMessage('B&W rate must be a number')
    .isFloat({ min: 0 })
    .withMessage('B&W rate must be positive'),
  body('rates.color')
    .isNumeric()
    .withMessage('Color rate must be a number')
    .isFloat({ min: 0 })
    .withMessage('Color rate must be positive'),
  body('rates.spiral')
    .isNumeric()
    .withMessage('Spiral rate must be a number')
    .isFloat({ min: 0 })
    .withMessage('Spiral rate must be positive'),
  body('rates.stapler')
    .isNumeric()
    .withMessage('Stapler rate must be a number')
    .isFloat({ min: 0 })
    .withMessage('Stapler rate must be positive'),
  validate,
];

const updateShopValidation = [
  param('shopId')
    .trim()
    .notEmpty()
    .withMessage('Shop ID is required'),
  body('name')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Shop name cannot exceed 100 characters'),
  validate,
];

const updateRatesValidation = [
  param('shopId')
    .trim()
    .notEmpty()
    .withMessage('Shop ID is required'),
  body('rates')
    .isObject()
    .withMessage('Rates must be an object'),
  body('rates.bw')
    .optional()
    .isNumeric()
    .withMessage('B&W rate must be a number')
    .isFloat({ min: 0 })
    .withMessage('B&W rate must be positive'),
  body('rates.color')
    .optional()
    .isNumeric()
    .withMessage('Color rate must be a number')
    .isFloat({ min: 0 })
    .withMessage('Color rate must be positive'),
  body('rates.spiral')
    .optional()
    .isNumeric()
    .withMessage('Spiral rate must be a number')
    .isFloat({ min: 0 })
    .withMessage('Spiral rate must be positive'),
  body('rates.stapler')
    .optional()
    .isNumeric()
    .withMessage('Stapler rate must be a number')
    .isFloat({ min: 0 })
    .withMessage('Stapler rate must be positive'),
  validate,
];

// Routes
router.post('/', createShopValidation, shopController.createShop);
router.get('/', shopController.getAllShops);
router.get('/:shopId', shopController.getShop);
router.put('/:shopId', updateShopValidation, shopController.updateShop);
router.patch('/:shopId/rates', updateRatesValidation, shopController.updateShopRates);
router.delete('/:shopId', shopController.deactivateShop);

module.exports = router;
