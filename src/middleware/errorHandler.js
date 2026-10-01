/**
 * PrintX Error Handler Middleware
 * Centralized error handling with custom error classes
 */

const logger = require('../utils/logger');

/**
 * Custom API Error class
 */
class ApiError extends Error {
  constructor(statusCode, message, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Validation Error class
 */
class ValidationError extends ApiError {
  constructor(message, errors) {
    super(400, message);
    this.errors = errors;
    this.type = 'VALIDATION_ERROR';
  }
}

/**
 * Not Found Error class
 */
class NotFoundError extends ApiError {
  constructor(resource, identifier) {
    super(404, `${resource} not found: ${identifier}`);
    this.type = 'NOT_FOUND';
  }
}

/**
 * Conflict Error class (for duplicate resources)
 */
class ConflictError extends ApiError {
  constructor(message) {
    super(409, message);
    this.type = 'CONFLICT';
  }
}

/**
 * Payment Error class
 */
class PaymentError extends ApiError {
  constructor(message) {
    super(402, message);
    this.type = 'PAYMENT_ERROR';
  }
}

/**
 * Not Found middleware
 */
const notFound = (req, res, next) => {
  const error = new ApiError(404, `Route not found: ${req.originalUrl}`);
  next(error);
};

/**
 * Global Error Handler middleware
 */
const errorHandler = (err, req, res, next) => {
  // Log the error
  logger.error('Error:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    ip: req.ip,
  });

  // Default values
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  let details = err.details || null;
  let type = err.type || 'INTERNAL_ERROR';

  // Handle Mongoose validation errors
  if (err.name === 'ValidationError') {
    statusCode = 400;
    type = 'VALIDATION_ERROR';
    message = 'Validation failed';
    details = Object.values(err.errors).map(e => ({
      field: e.path,
      message: e.message,
    }));
  }

  // Handle Mongoose duplicate key error
  if (err.code === 11000) {
    statusCode = 409;
    type = 'DUPLICATE_ERROR';
    const field = Object.keys(err.keyValue)[0];
    message = `Duplicate value for field: ${field}`;
    details = { field, value: err.keyValue[field] };
  }

  // Handle Mongoose cast errors (invalid ObjectId)
  if (err.name === 'CastError') {
    statusCode = 400;
    type = 'INVALID_ID';
    message = `Invalid ${err.path}: ${err.value}`;
  }

  // Don't leak error details in production
  if (process.env.NODE_ENV === 'production' && statusCode === 500) {
    message = 'Internal Server Error';
    details = null;
  }

  // Send response
  const response = {
    status: 'error',
    statusCode,
    message,
    type,
    ...(details && { details }),
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  };

  res.status(statusCode).json(response);
};

module.exports = {
  ApiError,
  ValidationError,
  NotFoundError,
  ConflictError,
  PaymentError,
  notFound,
  errorHandler,
};
