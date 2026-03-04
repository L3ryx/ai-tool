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

const upload = multer({
  storage: multer.memoryStorage()
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

/*
====================================================
LOG SYSTEM
====================================================
*/

function sendLog(socket, message, type = "info") {

  console.log(`[${type}] ${message}`);

  if (socket) {
    socket.emit("log", {
      message,
      type,
      time: new Date().toISOString()
    });
  }
}

/*
====================================================
UPLOAD TO IMGBB
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
              text: "Compare these two product images and return ONLY a similarity score between 0 and 100."
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
EXTRACT ALL IMAGES FROM PRODUCT PAGE
====================================================
*/

async function extractImagesFromProductPage(url) {

  try {

    const page = await axios.get(url, {
      timeout: 15000,
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    const $ = cheerio.load(page.data);

    let images = [];

    $("img").each((i, el) => {

      const src = $(el).attr("src");

      if (src && src.startsWith("http")) {
        images.push(src);
      }

    });

    // Garder seulement les images uniques
    images = [...new Set(images)];

    return images.slice(0, 5); // 🔥 On prend 5 images max par produit

  } catch (err) {

    console.log("❌ Failed extracting images");
    return [];
  }
}

/*
====================================================
ANALYZE ROUTE
====================================================
*/

app.post("/analyze", upload.single("image"), async (req, res) => {

  const socketId = req.body.socketId;
  const socket = io.sockets.sockets.get(socketId);

  if (!req.file) {
    return res.status(400).json({ error: "No image uploaded" });
  }

  try {

    /*
    ====================================================
    STEP 1 — Upload Image
    ====================================================
    */

    sendLog(socket, "📤 Uploading image to ImgBB...");

    const publicImageUrl = await uploadToImgBB(req.file.buffer);

    sendLog(socket, "✅ Image uploaded");

    /*
    ====================================================
    STEP 2 — SerpAPI Search
    ====================================================
    */

    const serpResults = await searchWithImage({
      imageUrl: publicImageUrl,
      apiKey: process.env.SERPAPI_KEY,
      socket
    });

    /*
    ====================================================
    STEP 3 — Filter AliExpress
    ====================================================
    */

    const aliexpressProducts = serpResults.filter(r => {

      const combined = (
        (r.link || "") +
        (r.title || "") +
        (r.snippet || "")
      ).toLowerCase();

      return combined.includes("aliexpress");

    }).slice(0, 10);

    sendLog(socket, `🛍 ${aliexpressProducts.length} products found`);

    /*
    ====================================================
    STEP 4 — Extract Product Images + Compare
    ====================================================
    */

    const finalResults = [];

    for (const product of aliexpressProducts) {

      if (!product.link) continue;

      sendLog(socket, `🔎 Extracting images from ${product.link}`);

      const images = await extractImagesFromProductPage(product.link);

      if (images.length === 0) continue;

      let scores = [];

      for (const img of images) {

        try {

          sendLog(socket, "🤖 Comparing extracted image...");

          const score = await compareImages(publicImageUrl, img);

          scores.push(score);

        } catch (err) {
          continue;
        }

      }

      if (scores.length === 0) continue;

      const avgScore =
        scores.reduce((a, b) => a + b, 0) / scores.length;

      if (avgScore >= 70) {

        finalResults.push({
          url: product.link,
          title: product.title,
          averageScore: avgScore,
          images
        });

      }

    }

    sendLog(socket, `🎯 Final Matches: ${finalResults.length}`);

    /*
    ====================================================
    STEP 5 — Return Results
    ====================================================
    */

    res.json({
      image: publicImageUrl,
      results: finalResults
    });

  } catch (err) {

    console.error(err);
    sendLog(socket, "🔥 PIPELINE FAILED", "error");

    res.status(500).json({
      error: "Pipeline failed",
      detail: err.message
    });

  }

});

/*
====================================================
SOCKET
====================================================
*/

io.on("connection", (socket) => {

  socket.emit("connected", {
    socketId: socket.id
  });

  console.log("🟢 Client connected");

});

/*
====================================================
START SERVER
====================================================
*/

server.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Server running");
});
