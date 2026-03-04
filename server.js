require("dotenv").config();

const express = require("express");
const multer = require("multer");
const axios = require("axios");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const upload = multer({
  storage: multer.memoryStorage()
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

/*
====================================================
LIVE LOG SYSTEM
====================================================
*/

function sendLog(socket, message, type = "info") {

  const log = {
    message,
    type,
    time: new Date().toISOString()
  };

  console.log(`[${type}] ${message}`);

  if (socket) {
    socket.emit("log", log);
  }
}

/*
====================================================
UPLOAD IMAGE TO IMGBB
====================================================
*/

async function uploadToImgBB(buffer) {

  const base64 = buffer.toString("base64");

  const response = await axios.post(
    "https://api.imgbb.com/1/upload",
    new URLSearchParams({
      key: process.env.IMGBB_KEY,
      image: base64
    }),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      }
    }
  );

  return response.data.data.url;
}

/*
====================================================
SERPAPI IMAGE SEARCH
====================================================
*/

async function searchWithImage(imageUrl, apiKey) {

  const response = await axios.get("https://serpapi.com/search", {
    params: {
      engine: "google_reverse_image",
      image_url: imageUrl,
      api_key: apiKey
    }
  });

  return response.data.image_results || [];
}

/*
====================================================
OPENAI IMAGE COMPARISON
====================================================
*/

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
              text: "Return only a similarity score between 0 and 100."
            },
            {
              type: "image_url",
              image_url: { url: imageA }
            },
            {
              type: "image_url",
              image_url: { url: imageB }
            }
          ]
        }
      ],
      max_tokens: 10
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      }
    }
  );

  const text = response.data.choices[0].message.content;
  const score = parseInt(text.match(/\d+/)?.[0] || "0");

  return score;
}

/*
====================================================
ANALYZE PIPELINE
====================================================
*/

app.post("/analyze", upload.single("image"), async (req, res) => {

  const socketId = req.body.socketId;
  const socket = io.sockets.sockets.get(socketId);

  if (!req.file) {
    return res.status(400).json({ error: "No image uploaded" });
  }

  try {

    sendLog(socket, "📤 Uploading image to ImgBB...");

    const publicImageUrl = await uploadToImgBB(req.file.buffer);

    sendLog(socket, "✅ Image uploaded");

    /*
    ================================================
    SERPAPI SEARCH
    ================================================
    */

    sendLog(socket, "🔎 Searching via SerpAPI...");

    const serpResults = await searchWithImage(
      publicImageUrl,
      process.env.SERPAPI_KEY
    );

    sendLog(socket, `📦 ${serpResults.length} results found`);

    /*
    ================================================
    FILTER ALIEXPRESS
    ================================================
    */

    const aliexpress = serpResults
      .filter(r =>
        (r.link || "").toLowerCase().includes("aliexpress")
      )
      .slice(0, 10);

    sendLog(socket, `🛍 ${aliexpress.length} AliExpress products`);

    /*
    ================================================
    USE IMAGES FROM SERPAPI
    ================================================
    */

    const products = aliexpress.map(p => ({
      url: p.link,
      title: p.title,
      image: p.thumbnail || p.image || null
    })).filter(p => p.image);

    sendLog(socket, `🖼 ${products.length} images ready for AI comparison`);

    /*
    ================================================
    AI COMPARISON
    ================================================
    */

    const results = [];

    for (const product of products) {

      sendLog(socket, `🤖 Comparing ${product.title || "Product"}`);

      try {

        const score = await compareImages(
          publicImageUrl,
          product.image
        );

        sendLog(socket, `✅ Score = ${score}`);

        if (score >= 70) {

          results.push({
            url: product.url,
            title: product.title,
            image: product.image,
            similarity: score
          });
        }

      } catch (err) {

        sendLog(socket, "❌ Comparison failed", "error");
      }
    }

    sendLog(socket, `🎯 Final matches: ${results.length}`);

    res.json({
      image: publicImageUrl,
      results
    });

  } catch (err) {

    console.error(err);
    sendLog(socket, "🔥 PIPELINE FAILED", "error");

    res.status(500).json({
      error: "Pipeline failed",
      message: err.message
    });
  }

});

/*
====================================================
SOCKET.IO
====================================================
*/

io.on("connection", (socket) => {

  console.log("🟢 Client connected");

  socket.emit("connected", {
    socketId: socket.id
  });

});

/*
====================================================
START SERVER
====================================================
*/

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
