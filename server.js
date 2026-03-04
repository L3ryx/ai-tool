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
OPENAI VISION COMPARISON
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
      ]
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
    ============================================
    STEP 1 — Upload Image
    ============================================
    */

    sendLog(socket, "📤 Uploading image to ImgBB...");

    const publicImageUrl = await uploadToImgBB(req.file.buffer);

    sendLog(socket, "✅ Image uploaded");
    sendLog(socket, `🔗 Image URL: ${publicImageUrl}`);

    /*
    ============================================
    STEP 2 — Google Lens Search (STABLE)
    ============================================
    */

    sendLog(socket, "🔎 Searching with Google Lens...");

    const serp = await axios.get("https://serpapi.com/search", {
      params: {
        engine: "google_lens",
        image_url: publicImageUrl,
        api_key: process.env.SERPAPI_KEY
      }
    });

    console.log("SERP FULL RESPONSE:", JSON.stringify(serp.data, null, 2));

    const results = serp.data?.visual_matches || [];

    sendLog(socket, `📦 ${results.length} visual matches found`);

    /*
    ============================================
    STEP 3 — Take Top 10 AliExpress Links
    ============================================
    */

    const aliexpressLinks = results
      .filter(r => r.link?.includes("aliexpress.com"))
      .slice(0, 10);

    sendLog(socket, `🛍 AliExpress products: ${aliexpressLinks.length}`);

    /*
    ============================================
    STEP 4 — Parallel AI Comparison
    ============================================
    */

    const comparisons = await Promise.all(

      aliexpressLinks.map(async (item) => {

        if (!item.thumbnail) return null;

        try {

          sendLog(socket, `🤖 Comparing ${item.title || "Product"}...`);

          const score = await compareImages(
            publicImageUrl,
            item.thumbnail
          );

          return {
            url: item.link,
            image: item.thumbnail,
            title: item.title,
            similarity: score
          };

        } catch (err) {

          sendLog(socket, "❌ AI comparison failed", "error");

          return null;
        }

      })

    );

    /*
    ============================================
    STEP 5 — Filter Score ≥ 70
    ============================================
    */

    const finalResults = comparisons
      .filter(Boolean)
      .filter(p => p.similarity >= 70)
      .sort((a, b) => b.similarity - a.similarity);

    sendLog(socket, `🎯 Final Matches: ${finalResults.length}`);

    /*
    ============================================
    STEP 6 — Return Results
    ============================================
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
