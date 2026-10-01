/**
 * PrintX PDF Analysis Routes
 * Fast server-side PDF analysis endpoint
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { analyzeDocument } = require('../controllers/orderController');
const { ApiError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

// Configure multer for PDF uploads
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new ApiError(400, 'Only PDF files are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

/**
 * POST /api/analyze
 * Analyze PDF document for page count, color/B&W detection
 */
router.post('/', upload.single('file'), analyzeDocument);

/**
 * POST /api/analyze/multiple
 * Analyze multiple PDF documents
 */
router.post('/multiple', upload.array('files', 5), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      throw new ApiError(400, 'No files uploaded');
    }

    const { PDFDocument } = require('pdf-lib');
    const results = [];

    for (const file of req.files) {
      try {
        const pdfDoc = await PDFDocument.load(file.buffer, { 
          ignoreEncryption: true 
        });

        const totalPages = pdfDoc.getPageCount();
        let colorPagesCount = 0;
        const colorPagesList = [];

        // Quick analysis for each page
        for (let i = 0; i < totalPages; i++) {
          const page = pdfDoc.getPage(i);
          let hasColor = false;

          // Check content stream for color operators
          try {
            const contentStream = page.node.Contents();
            if (contentStream) {
              const stream = contentStream.toString();
              const colorOperators = /[RG|rg|K|k|CS|cs|SC|sc|SCN|scn]/;
              if (colorOperators.test(stream)) {
                hasColor = true;
              }
            }
          } catch (e) {
            // Continue on error
          }

          if (hasColor) {
            colorPagesCount++;
            colorPagesList.push(i + 1);
          }
        }

        results.push({
          file_name: file.originalname,
          total_pages: totalPages,
          bw_pages_count: totalPages - colorPagesCount,
          color_pages_count: colorPagesCount,
          color_pages_list: colorPagesList,
          file_size_kb: parseFloat((file.size / 1024).toFixed(2)),
          status: 'success',
        });

      } catch (error) {
        results.push({
          file_name: file.originalname,
          status: 'error',
          error: error.message,
        });
      }
    }

    res.json({
      status: 'success',
      data: {
        total_files: req.files.length,
        analyzed_files: results.filter(r => r.status === 'success').length,
        failed_files: results.filter(r => r.status === 'error').length,
        results,
      },
    });

  } catch (error) {
    next(error);
  }
});

module.exports = router;
