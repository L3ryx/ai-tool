require("dotenv").config();
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const http = require("http");
const { Server } = require("socket.io");
const { searchWithImage } = require("./serp"); // Ta fonction SerpAPI

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Multer pour upload en mémoire
const upload = multer({
  storage: multer.memoryStorage()
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

/* ====================================================
   UPLOAD IMAGE TO IMGBB
==================================================== */
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

/* ====================================================
   OPENAI IMAGE COMPARISON
==================================================== */
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
            { type: "image_url", image_url: { url: imageA } },
            { type: "image_url", image_url: { url: imageB } }
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
  return parseInt(text.match(/\d+/)?.[0] || "0");
}

/* ====================================================
   ANALYZE ROUTE
==================================================== */
app.post("/analyze", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No image uploaded" });

  try {
    // 1️⃣ Upload sur ImgBB
    const publicImageUrl = await uploadToImgBB(req.file.buffer);

    // 2️⃣ Rechercher images sur SerpAPI
    const serpResults = await searchWithImage({
      imageUrl: publicImageUrl,
      apiKey: process.env.SERPAPI_KEY
    });

    // 3️⃣ Filtrer AliExpress + récupérer 10 premiers
    const aliexpressProducts = serpResults
      .filter(r => (r.link + r.title + r.snippet).toLowerCase().includes("aliexpress"))
      .slice(0, 10);

    // 4️⃣ Extraire images des produits
    const productImages = aliexpressProducts
      .map(p => ({ url: p.link, title: p.title, image: p.thumbnail || p.image }))
      .filter(p => p.image);

    // 5️⃣ Comparer chaque image avec OpenAI
    const comparisons = [];
    for (const product of productImages) {
      try {
        const score = await compareImages(publicImageUrl, product.image);
        comparisons.push({ ...product, similarity: score });
      } catch {}
    }

    // 6️⃣ Filtrer les résultats ≥ 70
    const finalResults = comparisons
      .filter(p => p.similarity >= 70)
      .sort((a, b) => b.similarity - a.similarity);

    res.json({ image: publicImageUrl, results: finalResults });

  } catch (err) {
    res.status(500).json({ error: "Pipeline failed", detail: err.message });
  }
});

/* ====================================================
   SOCKET.IO (optionnel)
==================================================== */
io.on("connection", socket => {
  socket.emit("connected", { socketId: socket.id });
});

/* ====================================================
   START SERVER
==================================================== */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
