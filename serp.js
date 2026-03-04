const axios = require("axios");

/*
====================================================
SERPAPI GOOGLE SHOPPING IMAGE SEARCH
====================================================
*/

async function searchWithImage({ imageUrl, apiKey }) {
  try {

    console.log("🔎 Sending request to SerpAPI...");
    console.log("IMAGE URL SENT:", imageUrl);

    const response = await axios.get("https://serpapi.com/search", {
      params: {
        engine: "google_reverse_image",
        image_url: imageUrl,
        api_key: apiKey,
        tbm: "shop",              // 🔥 Google Shopping
        google_domain: "google.com"
      },
      timeout: 60000
    });

    const results = response.data?.shopping_results || [];

    console.log("📦 Results received:", results.length);

    return results;

  } catch (err) {

    console.error("🔥 SERPAPI ERROR");
    console.error("MESSAGE:", err.message);

    return [];
  }
}

module.exports = { searchWithImage };
