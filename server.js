require("dotenv").config();
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const http = require("http");
const { Server } = require("socket.io");
const { searchWithImage } = require("./serp");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

/* ==================== LOG SYSTEM ==================== */
function sendLog(socket, message, type = "info") {
  const logData = { message, type, time: new Date().toISOString() };
  console.log(`[${type}] ${message}`);
  if (socket) socket.emit("log", logData);
}

/* ==================== UPLOAD IMAGE ==================== */
async function uploadToImgBB(buffer) {
  const base64 = buffer.toString("base64");
  const response = await axios.post(
    "https://api.imgbb.com/1/upload",
    new URLSearchParams({ key: process.env.IMGBB_KEY, image: base64 }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  return response.data.data.url;
}

/* ==================== OPENAI IMAGE COMPARISON ==================== */
async function compareImages(imageA, imageB) {
  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Compare these two product images and return ONLY a similarity score 0-100."
            },
            { type: "image_url", image_url: { url: imageA } },
            { type: "image_url", image_url: { url: imageB } }
          ]
        }
      ],
      max_tokens: 10
    },
    { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
  );

  const text = response.data.choices[0].message.content.replace(/\D/g, "");
  const score = parseInt(text || "0", 10);
  return score;
}

/* ==================== ANALYZE ROUTE ==================== */
app.post("/analyze", upload.single("image"), async (req, res) => {
  const socketId = req.body.socketId;
  const socket = io.sockets.sockets.get(socketId);

  if (!req.file) return res.status(400).json({ error: "No image uploaded" });

  try {
    sendLog(socket, "📤 Uploading image to ImgBB...");
    const publicImageUrl = await uploadToImgBB(req.file.buffer);
    sendLog(socket, "✅ Image uploaded");

    sendLog(socket, "🔎 Searching products via SerpAPI...");
    const serpResults = await searchWithImage({
      imageUrl: publicImageUrl,
      apiKey: process.env.SERPAPI_KEY,
      socket
    });

    sendLog(socket, `📦 ${serpResults.length} results found`);

    const aliexpressProducts = serpResults
      .filter(r => ((r.link || "") + (r.title || "") + (r.snippet || "")).toLowerCase().includes("aliexpress"))
      .slice(0, 10);

    sendLog(socket, `🛍 ${aliexpressProducts.length} AliExpress products`);

    const productImages = aliexpressProducts
      .map(p => ({ url: p.link, title: p.title, image: p.thumbnail || p.image || null }))
      .filter(p => p.image);

    sendLog(socket, `🖼 ${productImages.length} images ready for comparison`);

    const comparisons = [];
    for (const product of productImages) {
      sendLog(socket, `🤖 Comparing: ${product.title || "Product"}`);
      try {
        const score = await compareImages(publicImageUrl, product.image);
        if (!isNaN(score)) {
          comparisons.push({ ...product, similarity: score });
          sendLog(socket, `✅ Score: ${score}`);
        }
      } catch (err) {
        sendLog(socket, `❌ Comparison failed: ${err.message}`, "error");
      }
    }

    const finalResults = comparisons.filter(p => p.similarity >= 70).sort((a, b) => b.similarity - a.similarity);
    sendLog(socket, `🎯 Final Matches: ${finalResults.length}`);

    res.json({ image: publicImageUrl, results: finalResults });
  } catch (err) {
    console.error(err);
    sendLog(socket, "🔥 PIPELINE FAILED", "error");
    res.status(500).json({ error: "Pipeline failed", detail: err.message });
  }
});

/* ==================== SOCKET.IO ==================== */
io.on("connection", socket => {
  socket.emit("connected", { socketId: socket.id });
  console.log("🟢 Client connected");
});

/* ==================== START SERVER ==================== */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
