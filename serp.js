const axios = require("axios");

/*
====================================================
SERPAPI IMAGE SEARCH MODULE
====================================================
*/

async function searchWithImage({
  imageUrl,
  apiKey,
  socket = null,
  logger = console
}) {

  if (!imageUrl) {
    throw new Error("Missing imageUrl");
  }

  if (!apiKey) {
    throw new Error("Missing SerpAPI key");
  }

  logger.log("🔎 Sending request to SerpAPI...");

  try {

    const response = await axios.get("https://serpapi.com/search", {
      params: {
        engine: "google_reverse_image",
        url: imageUrl,              // ✅ PARAM REQUIRED
        api_key: apiKey
      },
      timeout: 15000
    });

    logger.log("✅ SerpAPI response received");

    // Debug full response
    logger.log("SERP FULL RESPONSE:");
    logger.log(JSON.stringify(response.data, null, 2));

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

    const status = err.response?.status;
    const data = err.response?.data;

    logger.error("🔥 SERPAPI REQUEST FAILED");
    logger.error("STATUS:", status);
    logger.error("ERROR DATA:", data);

    if (socket) {
      socket.emit("log", {
        message: `❌ SerpAPI Error ${status || ""}`,
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
