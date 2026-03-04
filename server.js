// ============================================
// IMAGE → SERPAPI → FILTER → AI COMPARE → LOGS
// ============================================

const express = require("express");
const multer = require("multer");
const axios = require("axios");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

const upload = multer({
  storage: multer.memoryStorage()
});

/* ============================================
   PIPELINE
============================================ */

app.post("/analyze", upload.single("image"), async (req, res) => {

  try {

    const { serpapi, openai } = req.body;

    if (!req.file)
      return res.json({ error: "Image missing" });

    if (!serpapi || !openai)
      return res.json({ error: "API keys missing" });

    // --------------------------------------
    // 1️⃣ SERPAPI SEARCH
    // --------------------------------------

    const serp = await axios.get("https://serpapi.com/search", {
      params: {
        engine: "google_shopping",
        q: "product",
        api_key: serpapi
      }
    });

    const products = serp.data.shopping_results || [];

    // --------------------------------------
    // 2️⃣ FILTER ALIEXPRESS
    // --------------------------------------

    const aliProducts = products.filter(p =>
      p.link && p.link.includes("aliexpress")
    );

    // --------------------------------------
    // 3️⃣ OPENAI PRODUCT COMPARISON
    // --------------------------------------

    let comparison = null;

    if (aliProducts.length > 0) {

      const ai = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-3.5-turbo",
          messages: [
            {
              role: "user",
              content: `
Compare these products:

${JSON.stringify(aliProducts.slice(0,5), null, 2)}

Return best product + why.
`
            }
          ]
        },
        {
          headers: {
            Authorization: `Bearer ${openai}`,
            "Content-Type": "application/json"
          }
        }
      );

      comparison = ai.data.choices[0].message.content;
    }

    // --------------------------------------
    // 4️⃣ LOGS
    // --------------------------------------

    const log = {
      time: new Date(),
      totalProducts: aliProducts.length
    };

    fs.appendFileSync("logs.json", JSON.stringify(log) + "\n");

    // --------------------------------------
    // RESPONSE
    // --------------------------------------

    res.json({
      products: aliProducts,
      comparison
    });

  } catch (err) {

    console.error(err.message);

    res.status(500).json({
      error: "Pipeline failed",
      debug: err.message
    });

  }

});

/* ============================================
   LIVE LOGS
============================================ */

app.get("/logs", (req, res) => {

  if (!fs.existsSync("logs.json"))
    return res.json([]);

  const logs = fs.readFileSync("logs.json", "utf8")
    .split("\n")
    .filter
