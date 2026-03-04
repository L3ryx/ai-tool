/*
====================================================
SERPAPI MODULE — STABLE VERSION
====================================================
*/

const axios = require("axios");

async function searchWithImage({
  imageUrl,
  apiKey,
  socket = null
}) {

  if (!imageUrl) {
    throw new Error("Missing imageUrl");
  }

  if (!apiKey) {
    throw new Error("Missing SerpAPI key");
  }

  console.log("🔎 Sending request to SerpAPI...");
  console.log("IMAGE URL SENT:", imageUrl);

  try {

    const response = await axios.get("https://serpapi.com/search", {
      params: {
        engine: "google_reverse_image",
        image_url: imageUrl,   // ✅ CORRECT PARAM
        api_key: apiKey
      },
      timeout: 20000,
      validateStatus: () => true // 🔥 Important pour capturer les erreurs
    });

    console.log("🔵 SERP STATUS:", response.status);
    console.log("🔵 SERP CONTENT-TYPE:", response.headers["content-type"]);
    console.log("🔵 SERP RAW RESPONSE:");
    console.log(JSON.stringify(response.data, null, 2));

    // ❌ Si SerpAPI retourne HTML au lieu JSON
    if (typeof response.data !== "object") {
      throw new Error("SerpAPI returned HTML instead of JSON");
    }

    // ❌ Si erreur API
    if (response.data.error) {
      throw new Error(response.data.error);
    }

    const results = response.data?.image_results || [];

    if (socket) {
      socket.emit("log", {
        message: `📦 ${results.length} results found`,
        type: "info",
        time: new Date().toISOString()
      });
    }

    return results;

  } catch (err) {

    console.error("🔥 SERPAPI ERROR");
    console.error("MESSAGE:", err.message);

    if (err.response) {
      console.error("STATUS:", err.response.status);
      console.error("DATA:", err.response.data);
    }

    if (socket) {
      socket.emit("log", {
        message: `❌ SERPAPI ERROR: ${err.message}`,
        type: "error",
        time: new Date().toISOString()
      });
    }

    throw err;
  }
}

module.exports = {
  searchWithImage
};
