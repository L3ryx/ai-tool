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

function logStep(socket, message) {
  if (socket) socket.emit("log", message);
}

app.post("/analyze", upload.single("image"), async (req, res) => {

  const socket = io.sockets.sockets.get(req.body.socketId);

  try {
    const { imgbb, serpapi, openai } = req.body;

    if (!req.file) return res.status(400).json({ error: "No image uploaded" });

    logStep(socket, "📤 Uploading image to ImgBB...");

    // 1️⃣ Upload to ImgBB
    const form = new FormData();
    form.append("image", req.file.buffer.toString("base64"));

    const imgRes = await axios.post(
      `https://api.imgbb.com/1/upload?key=${imgbb}`,
      form,
      { headers: form.getHeaders() }
    );

    const imageUrl = imgRes.data.data.url;

    logStep(socket, "🔎 Reverse searching image via Google...");

    // 2️⃣ Google Reverse Image via SerpAPI
    const serp = await axios.get("https://serpapi.com/search", {
      params: {
        engine: "google_reverse_image",
        image_url: imageUrl,
        api_key: serpapi
      }
    });

    const imageResults = serp.data.image_results || [];

    logStep(socket, `📦 Total reverse results: ${imageResults.length}`);

    // 3️⃣ Filter AliExpress
    const aliResults = imageResults.filter(r =>
      r.link && r.link.includes("aliexpress")
    );

    logStep(socket, `🛒 AliExpress results found: ${aliResults.length}`);

    let scored = [];

    // 4️⃣ Compare images with OpenAI Vision
    for (let item of aliResults.slice(0,5)) {

      logStep(socket, `🤖 Comparing: ${item.title}`);

      try {

        const ai = await axios.post(
          "https://api.openai.com/v1/chat/completions",
          {
            model: "gpt-4o",
            messages: [{
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Rate similarity between these two product images from 0 to 100. Return ONLY the number."
                },
                {
                  type: "image_url",
                  image_url: { url: imageUrl }
                },
                {
                  type: "image_url",
                  image_url: { url: item.thumbnail }
                }
              ]
            }]
          },
          {
            headers: {
              Authorization: `Bearer ${openai}`,
              "Content-Type": "application/json"
            }
          }
        );

        const score = parseInt(ai.data.choices[0].message.content) || 0;

        scored.push({
          title: item.title,
          link: item.link,
          thumbnail: item.thumbnail,
          score
        });

      } catch {
        logStep(socket, "⚠️ AI comparison failed for one item.");
      }
    }

    scored.sort((a,b)=> b.score - a.score);

    logStep(socket, "✅ Analysis complete.");

    res.json({
      originalImage: imageUrl,
      results: scored
    });

  } catch (err) {
    logStep(socket, "❌ Error occurred.");
    res.status(500).json({ error: "Pipeline failed", detail: err.message });
  }
});

server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
