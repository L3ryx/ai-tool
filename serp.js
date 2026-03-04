const axios = require("axios");

/*
====================================================
SERPAPI IMAGE SEARCH MODULE
====================================================
*/

async function searchWithImage({ imageUrl, apiKey, socket = null }) {

  if (!imageUrl) throw new Error("Missing imageUrl");
  if (!apiKey) throw new Error("Missing SerpAPI key");

  try {

    console.log("🔎 Sending request to SerpAPI...");

    const response = await axios.get("https://serpapi.com/search", {
      params: {
        engine: "google_reverse_image",
        url: imageUrl,  // ✅ REQUIRED PARAM
        api_key: apiKey
      },
      timeout: 20000
    });

    console.log("✅ SerpAPI response received");

    console.log("SERP FULL RESPONSE:");
    console.log(JSON.stringify(response.data, null, 2));

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
    console.error("STATUS:", err.response?.status);
    console.error("DATA:", err.response?.data);

    if (socket) {
      socket.emit("log", {
        message: `❌ SerpAPI Error ${err.response?.status || ""}`,
        type: "error",
        time: new Date().toISOString()
      });
    }

    throw err;
  }
}

module.exports = { searchWithImage };
