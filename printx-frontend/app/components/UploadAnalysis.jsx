'use client';

/**
 * PrintX Step 2: File Upload & Server Analysis
 * Drag & drop PDF to backend for analysis
 */

import React, { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import {
  Upload,
  FileText,
  Check,
  AlertCircle,
  Scan,
  X,
  RefreshCw,
  Loader2
} from 'lucide-react';
import ThemeToggle from './ThemeToggle';

const API_URL = 'http://localhost:3000/api/analyze';

export default function UploadAnalysis({ onAnalysisComplete, onBack }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const handleFile = useCallback(async (file) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('Please upload a PDF file');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError('File size must be less than 10MB');
      return;
    }

    setSelectedFile(file);
    setError(null);
    setAnalysis(null);
    setIsAnalyzing(true);
    setProgress(0);

    const formData = new FormData();
    formData.append('file', file);

    // Safety fallback timeout - 3.5 seconds
    const fallbackAnalysis = {
      file_name: file.name,
      total_pages: 1,
      bw_pages_count: 1,
      color_pages_count: 0,
      color_pages_list: [],
      file_size_kb: Number((file.size / 1024).toFixed(2)), // ensure numeric
    };

    // Safety fallback timeout - 3.5 seconds: never freeze the screen
    const timeoutId = setTimeout(() => {
      setIsAnalyzing((stillAnalyzing) => {
        if (stillAnalyzing) {
          console.warn('Analysis timed out, using fallback values');
          setAnalysis(fallbackAnalysis);
          setProgress(100);
          setTimeout(() => {
            if (onAnalysisComplete) {
              onAnalysisComplete(fallbackAnalysis);
            }
          }, 500);
          return false;
        }
        return stillAnalyzing;
      });
    }, 3500);

    try {
      const response = await axios.post(API_URL, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 5000, // 5 second axios timeout
      });

      clearTimeout(timeoutId);

      if (response.data.status === 'success') {
        // Normalize server data: coerce file_size_kb to a number
        const serverData = {
          ...response.data.data,
          file_size_kb: Number(response.data.data?.file_size_kb ?? file.size / 1024),
        };
        setAnalysis(serverData);
        setProgress(100);
        setIsAnalyzing(false);
        setError(null);

        // Auto-proceed after analysis
        setTimeout(() => {
          if (onAnalysisComplete) {
            onAnalysisComplete(serverData);
          }
        }, 1000);
      }
    } catch (err) {
      clearTimeout(timeoutId);

      if (err.code === 'ECONNABORTED') {
        setError('Server timeout');
      } else {
        setError(err.response?.data?.message || 'Failed to analyze PDF');
      }

      // Fallback to default values
      setAnalysis(fallbackAnalysis);
      setProgress(100);

      setTimeout(() => {
        setIsAnalyzing(false);
        if (onAnalysisComplete) {
          onAnalysisComplete(fallbackAnalysis);
        }
      }, 500);
    }
  }, [onAnalysisComplete]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFile(file);
    }
  }, [handleFile]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleFileInput = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFile(file);
    }
  }, [handleFile]);

  const handleRetry = useCallback(() => {
    if (selectedFile) {
      handleFile(selectedFile);
    }
  }, [selectedFile, handleFile]);

  const handleCancel = useCallback(() => {
    setIsAnalyzing(false);
    setSelectedFile(null);
    setAnalysis(null);
    setError(null);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -100 }}
      transition={{ type: 'spring', damping: 25 }}
      className="min-h-screen bg-gradient-to-b from-blue-50 to-white dark:from-dark-navy dark:to-dark-navy p-4 transition-colors duration-300"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <button 
          onClick={onBack}
          className="w-10 h-10 rounded-xl bg-white dark:bg-dark-accent shadow-card dark:shadow-dark-card flex items-center justify-center transition-colors duration-300"
        >
          ←
        </button>
        <h1 className="text-lg font-semibold text-dark-navy dark:text-white transition-colors duration-300">
          Upload Document
        </h1>
        <ThemeToggle size="sm" />
      </div>

      {/* Upload Area */}
      <AnimatePresence mode="wait">
        {!selectedFile ? (
          <motion.div
            key="upload"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className={`
              relative border-2 border-dashed rounded-3xl p-8 text-center
              transition-all duration-300 cursor-pointer
              ${isDragOver 
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 scale-[1.02]' 
                : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-dark-card hover:border-primary-400 dark:hover:border-primary-500'
              }
            `}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              onChange={handleFileInput}
              className="hidden"
            />
            
            <motion.div
              animate={isDragOver ? { scale: 1.1, y: -5 } : { scale: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            >
              <div className="w-20 h-20 mx-auto mb-4 bg-primary-100 dark:bg-primary-900/50 rounded-2xl flex items-center justify-center transition-colors duration-300">
                <Upload className="w-10 h-10 text-primary-600 dark:text-primary-400" />
              </div>
              <h3 className="text-lg font-semibold text-dark-navy dark:text-white mb-2 transition-colors duration-300">
                Drop your file here
              </h3>
              <p className="text-gray-500 dark:text-gray-400 text-sm mb-4 transition-colors duration-300">
                or click to browse
              </p>
            </motion.div>

            <div className="flex justify-center gap-2">
              <span className="px-3 py-1 bg-blue-100 dark:bg-blue-900/30 rounded-full text-xs font-medium text-blue-600 dark:text-blue-400">
                PDF
              </span>
              <span className="px-3 py-1 bg-gray-100 dark:bg-gray-700 rounded-full text-xs font-medium text-gray-600 dark:text-gray-300">
                Max 10MB
              </span>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="analyzing"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
          >
            {/* Analysis Card */}
            <div className="bg-white dark:bg-dark-card rounded-3xl shadow-card dark:shadow-dark-card p-6 mb-4 transition-colors duration-300">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                    error 
                      ? 'bg-red-500' 
                      : analysis 
                        ? 'bg-green-500' 
                        : 'bg-gradient-to-br from-primary-500 to-purple-500'
                  }`}>
                    {error ? (
                      <AlertCircle className="w-6 h-6 text-white" />
                    ) : analysis ? (
                      <Check className="w-6 h-6 text-white" />
                    ) : isAnalyzing ? (
                      <Loader2 className="w-6 h-6 text-white animate-spin" />
                    ) : (
                      <Scan className="w-6 h-6 text-white" />
                    )}
                  </div>
                  <div>
                    <h3 className="font-semibold text-dark-navy dark:text-white transition-colors duration-300">
                      {error ? 'Analysis Failed' : analysis ? 'Analysis Complete' : 'AI Server Analysis'}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 transition-colors duration-300">
                      {error ? 'Please try again' : analysis ? 'Ready to proceed' : isAnalyzing ? 'Analyzing document...' : 'Drop a PDF to analyze'}
                    </p>
                  </div>
                </div>
                
                {!analysis && !error && (
                  <button
                    onClick={handleCancel}
                    className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-300"
                  >
                    <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                  </button>
                )}
              </div>

              {/* Scanner Animation */}
              <div className="relative bg-gray-100 dark:bg-dark-accent rounded-2xl h-40 mb-4 overflow-hidden transition-colors duration-300">
                <div className="absolute inset-0 flex items-center justify-center">
                  <FileText className="w-16 h-16 text-gray-300 dark:text-gray-600 transition-colors duration-300" />
                </div>
                
                {/* Scanning Beam */}
                {isAnalyzing && (
                  <div className="absolute inset-0 top-0 bottom-0 overflow-hidden">
                    <motion.div
                      initial={{ y: '-100%' }}
                      animate={{ y: '100%' }}
                      transition={{ 
                        duration: 2, 
                        repeat: Infinity, 
                        ease: 'linear' 
                      }}
                      className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-primary-500 to-transparent"
                    >
                      <div className="absolute inset-0 bg-primary-500 blur-sm opacity-50" />
                    </motion.div>
                  </div>
                )}

                {/* Completion */}
                {analysis && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute inset-0 flex items-center justify-center bg-green-50 dark:bg-green-900/20 transition-colors duration-300"
                  >
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.2 }}
                      className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center"
                    >
                      <Check className="w-8 h-8 text-white" />
                    </motion.div>
                  </motion.div>
                )}

                {/* Error State */}
                {error && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute inset-0 flex items-center justify-center bg-red-50 dark:bg-red-900/20 transition-colors duration-300"
                  >
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                      className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center"
                    >
                      <AlertCircle className="w-8 h-8 text-white" />
                    </motion.div>
                  </motion.div>
                )}
              </div>

              {/* Progress Bar */}
              <div className="relative h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden transition-colors duration-300">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.3 }}
                  className={`absolute inset-y-0 left-0 ${
                    error 
                      ? 'bg-gradient-to-r from-red-500 to-red-600' 
                      : 'bg-gradient-to-r from-primary-500 to-primary-600'
                  }`}
                />
              </div>

              {/* File Info */}
              <div className="mt-4 flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400 transition-colors duration-300">
                  <FileText className="w-4 h-4" />
                  <span className="truncate max-w-[150px]">{selectedFile.name}</span>
                </div>
                <span className="text-gray-500 dark:text-gray-400">
                  {analysis?.file_size_kb ? `${Number(analysis.file_size_kb).toFixed(2)} KB` : `${Number(selectedFile?.size / 1024 || 0).toFixed(2)} KB`}
                </span>
              </div>

              {/* Error Message */}
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 rounded-xl transition-colors duration-300"
                >
                  <div className="flex items-start gap-2 text-sm">
                    <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
                    <p className="text-red-600 dark:text-red-400">{error}</p>
                  </div>
                </motion.div>
              )}

              {/* Retry Button */}
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="mt-4 flex gap-3"
                >
                  <button
                    onClick={handleCancel}
                    className="flex-1 py-3 px-4 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 
                               font-medium transition-colors duration-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                  >
                    Choose Different File
                  </button>
                  <button
                    onClick={handleRetry}
                    className="flex-1 py-3 px-4 rounded-xl bg-primary-600 dark:bg-primary-500 text-white 
                               font-medium transition-colors duration-300 hover:bg-primary-700 dark:hover:bg-primary-400
                               flex items-center justify-center gap-2"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Retry
                  </button>
                </motion.div>
              )}
            </div>

            {/* Analysis Results */}
            <AnimatePresence>
              {analysis && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="bg-white dark:bg-dark-card rounded-3xl shadow-card dark:shadow-dark-card p-6 transition-colors duration-300"
                >
                  <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">
                    Analysis Results
                  </h4>
                  
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-surface-light dark:bg-dark-accent rounded-2xl p-3 text-center transition-colors duration-300">
                      <div className="text-2xl font-bold text-dark-navy dark:text-white">
                        {analysis.total_pages}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">Total Pages</div>
                    </div>
                    <div className="bg-amber-50 dark:bg-amber-900/30 rounded-2xl p-3 text-center transition-colors duration-300">
                      <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                        {analysis.color_pages_count}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">Color Pages</div>
                    </div>
                    <div className="bg-gray-100 dark:bg-gray-700 rounded-2xl p-3 text-center transition-colors duration-300">
                      <div className="text-2xl font-bold text-dark-navy dark:text-white">
                        {analysis.bw_pages_count}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">B&W Pages</div>
                    </div>
                  </div>

                  {/* Color Pages List */}
                  {analysis.color_pages_list && analysis.color_pages_list.length > 0 && (
                    <div className="mt-4 p-3 bg-purple-50 dark:bg-purple-900/30 rounded-xl">
                      <div className="text-sm font-medium text-purple-700 dark:text-purple-300">
                        🎨 Color Pages Detected
                      </div>
                      <div className="text-sm text-purple-600 dark:text-purple-400">
                        Page {analysis.color_pages_list.join(', ')}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
