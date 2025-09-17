const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all routes
app.use(cors());

// Parse request bodies - support multiple formats
app.use(express.json({ limit: '10mb' })); // JSON bodies
app.use(express.urlencoded({ extended: true, limit: '10mb' })); // Form data
app.use(express.raw({ type: 'application/octet-stream', limit: '10mb' })); // Binary data
app.use(express.text({ type: 'text/*', limit: '10mb' })); // Text data

// Log incoming requests
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Basic health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Test endpoints for different HTTP methods with bodies
app.post('/test/echo', (req, res) => {
  res.json({
    message: 'Echo test endpoint',
    method: req.method,
    headers: req.headers,
    body: req.body,
    timestamp: new Date().toISOString()
  });
});

app.put('/test/echo', (req, res) => {
  res.json({
    message: 'Echo test endpoint',
    method: req.method,
    headers: req.headers,
    body: req.body,
    timestamp: new Date().toISOString()
  });
});

app.delete('/test/echo', (req, res) => {
  res.json({
    message: 'Echo test endpoint', 
    method: req.method,
    headers: req.headers,
    body: req.body,
    timestamp: new Date().toISOString()
  });
});

app.patch('/test/echo', (req, res) => {
  res.json({
    message: 'Echo test endpoint',
    method: req.method,
    headers: req.headers,
    body: req.body,
    timestamp: new Date().toISOString()
  });
});

// Generic proxy route - forwards to target specified in query parameter
app.use('/proxy', (req, res, next) => {
  const target = req.query.target;
  
  if (!target) {
    return res.status(400).json({ 
      error: 'Missing target parameter. Usage: /proxy?target=https://api.example.com/sub/path' 
    });
  }

  // Validate URL format
  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch (err) {
    return res.status(400).json({ 
      error: 'Invalid target URL format' 
    });
  }

  // Extract base URL and path from target
  const baseUrl = `${targetUrl.protocol}//${targetUrl.host}`;
  const targetPath = targetUrl.pathname;
  
  console.log(`Target base: ${baseUrl}, Target path: ${targetPath}`);

  // Create proxy middleware dynamically
  const proxy = createProxyMiddleware({
    target: baseUrl,
    changeOrigin: true,
    pathRewrite: (path, req) => {
      return targetPath;
    },
    onError: (err, req, res) => {
      console.error('Proxy error:', err.message);
      res.status(502).json({ 
        error: 'Proxy error', 
        message: err.message 
      });
    },
    onProxyReq: (proxyReq, req, res) => {
      const finalUrl = baseUrl + targetPath + req.url.replace(/^\/proxy/, '');
      console.log(`Proxying ${req.method} ${req.originalUrl} to ${finalUrl}`);
      
      // Handle request body for POST, PUT, PATCH, DELETE
      if (req.body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        let bodyData;
        let contentType = req.get('Content-Type') || 'application/json';
        
        if (Buffer.isBuffer(req.body)) {
          // Binary data
          bodyData = req.body;
        } else if (typeof req.body === 'string') {
          // Text data
          bodyData = req.body;
        } else {
          // JSON data
          bodyData = JSON.stringify(req.body);
          contentType = 'application/json';
        }
        
        // Set appropriate headers
        proxyReq.setHeader('Content-Type', contentType);
        proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
        
        // Write the body
        proxyReq.write(bodyData);
        
        console.log(`📝 ${req.method} body forwarded:`, {
          contentType,
          bodySize: Buffer.byteLength(bodyData),
          bodyPreview: typeof bodyData === 'string' ? bodyData.substring(0, 200) + '...' : '[Binary Data]'
        });
      }
      
      // Forward other important headers
      const headersToForward = ['authorization', 'user-agent', 'accept', 'accept-language', 'accept-encoding'];
      headersToForward.forEach(header => {
        const value = req.get(header);
        if (value) {
          proxyReq.setHeader(header, value);
        }
      });
    },
    onProxyRes: (proxyRes, req, res) => {
      console.log(`Response from ${baseUrl}${targetPath}: ${proxyRes.statusCode}`);
    }
  });

  proxy(req, res, next);
});

// Specific proxy routes for common APIs
const apiProxies = {
  '/api/jsonplaceholder': {
    target: 'https://jsonplaceholder.typicode.com',
    pathRewrite: { '^/api/jsonplaceholder': '' }
  },
  '/api/httpbin': {
    target: 'https://httpbin.org',
    pathRewrite: { '^/api/httpbin': '' }
  },
  '/api/github': {
    target: 'https://api.github.com',
    pathRewrite: { '^/api/github': '' }
  }
};

// Create proxy middleware for each predefined API
Object.entries(apiProxies).forEach(([path, config]) => {
  app.use(path, createProxyMiddleware({
    ...config,
    changeOrigin: true,
    onError: (err, req, res) => {
      console.error(`Proxy error for ${path}:`, err.message);
      res.status(502).json({ 
        error: 'Proxy error', 
        message: err.message,
        path: path
      });
    },
    onProxyReq: (proxyReq, req, res) => {
      console.log(`Proxying ${req.method} ${path}${req.url} to ${config.target}`);
    }
  }));
});

// Custom proxy with authentication headers
app.use('/auth-proxy', (req, res, next) => {
  const target = req.query.target;
  const authToken = req.headers.authorization || req.query.token;
  
  if (!target) {
    return res.status(400).json({ 
      error: 'Missing target parameter' 
    });
  }

  // Parse target URL to handle subfolders
  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch (err) {
    return res.status(400).json({ 
      error: 'Invalid target URL format' 
    });
  }

  const baseUrl = `${targetUrl.protocol}//${targetUrl.host}`;
  const targetPath = targetUrl.pathname;
  const proxy = createProxyMiddleware({
    target: baseUrl,
    changeOrigin: true,
    pathRewrite: (path, req) => {
      return targetPath;
    },
    onProxyReq: (proxyReq, req, res) => {
      // Add authentication header if provided
      if (authToken) {
        proxyReq.setHeader('Authorization', authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`);
      }
      
      // Handle request body for POST, PUT, PATCH, DELETE
      if (req.body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        let bodyData;
        let contentType = req.get('Content-Type') || 'application/json';
        
        if (Buffer.isBuffer(req.body)) {
          bodyData = req.body;
        } else if (typeof req.body === 'string') {
          bodyData = req.body;
        } else {
          bodyData = JSON.stringify(req.body);
          contentType = 'application/json';
        }
        
        proxyReq.setHeader('Content-Type', contentType);
        proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
        proxyReq.write(bodyData);
        
        console.log(`📝 Auth ${req.method} body forwarded (${Buffer.byteLength(bodyData)} bytes)`);
      }
      
      // Forward other headers (except host and authorization which we handle separately)
      Object.keys(req.headers).forEach(key => {
        if (!['host', 'authorization', 'content-length', 'content-type'].includes(key.toLowerCase())) {
          proxyReq.setHeader(key, req.headers[key]);
        }
      });

      const finalUrl = baseUrl + targetPath + req.url.replace(/^\/auth-proxy/, '');
      console.log(`Auth proxying ${req.method} to ${finalUrl}`);
    }
  });

  proxy(req, res, next);
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    availableRoutes: [
      'GET /health - Health check',
      'ALL /proxy?target=URL - Generic proxy',
      'ALL /api/jsonplaceholder/* - JSONPlaceholder API proxy',
      'ALL /api/httpbin/* - HTTPBin API proxy', 
      'ALL /api/github/* - GitHub API proxy',
      'ALL /auth-proxy?target=URL&token=TOKEN - Authenticated proxy'
    ]
  });
});

app.listen(PORT, () => {
  console.log(`🚀 HTTP Proxy Server running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  console.log(`🔄 Generic proxy: http://localhost:${PORT}/proxy?target=https://api.example.com/sub/path`);
  console.log(`📋 Available predefined proxies:`);
  console.log(`   • /api/jsonplaceholder - JSONPlaceholder API`);
  console.log(`   • /api/httpbin - HTTPBin testing API`);
  console.log(`   • /api/github - GitHub API`);
  console.log(`\n📝 Test endpoints (POST/PUT/DELETE/PATCH with body):`);
  console.log(`   • POST/PUT/DELETE/PATCH http://localhost:${PORT}/test/echo`);
  console.log(`\n🌐 Examples with request bodies:`);
  console.log(`   • POST /proxy?target=https://httpbin.org/post`);
  console.log(`   • PUT /proxy?target=https://httpbin.org/put`);
  console.log(`   • DELETE /proxy?target=https://httpbin.org/delete`);
  console.log(`\n📊 Supported body formats: JSON, Form Data, Text, Binary`);
});

module.exports = app;