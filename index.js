const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all routes
app.use(cors());

// Parse JSON bodies
app.use(express.json());

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
      
      // Forward original headers
      if (req.body && req.method !== 'GET' && req.method !== 'HEAD') {
        const bodyData = JSON.stringify(req.body);
        proxyReq.setHeader('Content-Type', 'application/json');
        proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
        proxyReq.write(bodyData);
      }
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
      const cleanPath = path.replace(/^\/auth-proxy/, '');
      return targetPath + cleanPath;
    },
    onProxyReq: (proxyReq, req, res) => {
      // Add authentication header if provided
      if (authToken) {
        proxyReq.setHeader('Authorization', authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`);
      }
      
      // Forward other headers
      Object.keys(req.headers).forEach(key => {
        if (key.toLowerCase() !== 'host') {
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
  console.log(`\n📝 Examples with subfolders:`);
  console.log(`   • /proxy?target=https://api.github.com/repos/microsoft/vscode`);
  console.log(`   • /proxy?target=https://httpbin.org/anything/test/path`);
  console.log(`   • /auth-proxy?target=https://api.example.com/v1/users&token=your_token`);
});

module.exports = app;