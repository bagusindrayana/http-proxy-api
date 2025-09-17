// file: proxy-server.js
const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Proxy endpoint
app.all("/proxy", async (req, res) => {
  const target = req.query.target;

  if (!target) {
    return res.status(400).json({ error: "target query param required" });
  }
  console.log(target);

  try {
    const response = await axios({
      url: target,
      method: req.method,
      headers: { ...req.headers, host: undefined, "Content-Length": undefined,"Transfer-Encoding": undefined },
      data: req.body,
      validateStatus: () => true,
    });

    res.status(response.status).send(response.data);
  } catch (err) {
    console.error("Proxy error:", err.message);
    res.status(500).json({ error: "Proxy request failed" });
  }
});

app.listen(PORT, () => {
  console.log(`Dynamic proxy running on http://localhost:${PORT}`);
});


module.exports = app