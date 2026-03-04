const express = require("express");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static("public"));
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

/* ================= SOCKET ================= */

function logStep(socket, step) {
  socket.emit("log", step);
}

/* ================= PIPELINE ================= */

app.post("/analyze", upload.single("image"), async (req, res) => {

  const socketId = req.body.socketId;
  const socket = io.sockets.sockets.get(socketId);

  try {

    const { imgbb, serpapi, openai } = req.body;

    if (!req.file) return res.status(400).json({ error: "No image" });

    logStep(socket, "📤 Uploading image to ImgBB...");

    /* 1️⃣ Upload ImgBB */

    const form = new FormData();
    form.append("image", req.file.buffer.toString("base64"));

    const imgRes = await axios.post(
      `https://api.imgbb.com/1/upload?key=${imgbb}`,
      form,
      { headers: form.getHeaders() }
    );

    const imageUrl = imgRes.data.data.url;

    logStep(socket, "🔎 Searching via SerpAPI...");

    /* 2️⃣ SerpAPI */

    const serp = await axios.get("https://serpapi.com/search", {
      params: {
        engine: "google_shopping",
        q: imageUrl,
        api_key: serpapi
      }
    });

    const products = serp.data.shopping_results || [];

    logStep(socket, "🛒 Filtering AliExpress products...");

    /* 3️⃣ Filter AliExpress */

    const aliProducts = products.filter(p =>
      p.link && p.link.includes("aliexpress")
    );

    logStep(socket, "🤖 AI comparing products...");

    /* 4️⃣ OpenAI Compare */

    let scores = [];

    if (aliProducts.length > 0) {

      const ai = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4o-mini",
          messages: [{
            role: "user",
            content: `
Rate similarity from 0 to 100 for these products vs original image URL:
${imageUrl}

Products:
${JSON.stringify(aliProducts.slice(0,10))}
Return JSON array: [{title, score}]
`
          }]
        },
        {
          headers: {
            Authorization: `Bearer ${openai}`
          }
        }
      );

      try {
        scores = JSON.parse(ai.data.choices[0].message.content);
      } catch {
        scores = [];
      }
    }

    logStep(socket, "✅ Analysis complete.");

    res.json({
      image: imageUrl,
      products: aliProducts,
      scores
    });

  } catch (err) {
    if (socket) logStep(socket, "❌ Error occurred.");
    res.status(500).json({ error: "Pipeline failed", detail: err.message });
  }

});

server.listen(PORT, () => console.log("Server running on", PORT));
