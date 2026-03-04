require("dotenv").config();
const express = require("express");
const multer = require("multer");
const axios = require("axios");
const http = require("http");
const { searchWithImage } = require("./serp");

const app = express();
const server = http.createServer(app);

const upload = multer({
  storage: multer.memoryStorage()
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

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

  const text = response.data.choices[0].message.content || "";
  const cleaned = text.replace(/\D/g, "");
  const score = parseInt(cleaned || "0", 10);

  return score;
}

/*
====================================================
ANALYZE ROUTE
====================================================
*/

app.post("/analyze", upload.single("image"), async (req, res) => {

  if (!req.file) {
    return res.status(400).json({ error: "No image uploaded" });
  }

  try {

    // 1️⃣ Upload image to ImgBB
    const publicImageUrl = await uploadToImgBB(req.file.buffer);

    // 2️⃣ Search with SerpAPI (reverse image)
    const serpResults = await searchWithImage({
      imageUrl: publicImageUrl,
      apiKey: process.env.SERPAPI_KEY
    });

    // 3️⃣ Filter AliExpress results
    const aliexpressProducts = serpResults
      .filter(r =>
        ((r.link || "") + (r.title || "") + (r.snippet || ""))
          .toLowerCase()
          .includes("aliexpress")
      )
      .slice(0, 10);

    // 4️⃣ Extract images
    const products = aliexpressProducts
      .map(p => ({
        url: p.link,
        title: p.title,
        image: p.thumbnail || p.image || null
      }))
      .filter(p => p.image);

    // 5️⃣ Compare with OpenAI
    const comparisons = [];

    for (const product of products) {

      const score = await compareImages(publicImageUrl, product.image);

      if (!isNaN(score) && score >= 70) {
        comparisons.push({
          url: product.url,
          title: product.title,
          image: product.image,
          similarity: score
        });
      }
    }

    // Sort best matches first
    const finalResults = comparisons.sort(
      (a, b) => b.similarity - a.similarity
    );

    // 6️⃣ Return results
    res.json({
      image: publicImageUrl,
      results: finalResults
    });

  } catch (err) {

    console.error("PIPELINE ERROR:", err.message);

    res.status(500).json({
      error: "Pipeline failed",
      detail: err.message
    });
  }
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
