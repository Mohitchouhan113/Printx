/**
 * PrintX Validation Middleware
 * Handles express-validator errors
 */

const { validationResult } = require('express-validator');
const { ValidationError } = require('./errorHandler');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map(err => ({
      field: err.path,
      message: err.msg,
      value: err.value,
    }));

    throw new ValidationError('Validation failed', errorMessages);
  }
  
  next();
};

module.exports = validate;
