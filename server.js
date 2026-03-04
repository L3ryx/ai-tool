const express = require("express");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const http = require("http");
const { Server } = require("socket.io");
const cheerio = require("cheerio");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static("public"));
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

function logStep(socket, msg){
  if(socket) socket.emit("log", msg);
}

app.post("/analyze", upload.single("image"), async (req,res)=>{

  const socket = io.sockets.sockets.get(req.body.socketId);

  try{

    const { imgbb, serpapi, openai } = req.body;

    if(!req.file)
      return res.status(400).json({ error:"No image uploaded" });

    /* ================= 1️⃣ Upload Image to ImgBB ================= */

    logStep(socket,"📤 Uploading image to ImgBB...");

    const form = new FormData();
    form.append("image", req.file.buffer.toString("base64"));

    const imgRes = await axios.post(
      `https://api.imgbb.com/1/upload?key=${imgbb}`,
      form,
      { headers: form.getHeaders() }
    );

    const imageUrl = imgRes.data.data.url;

    /* ================= 2️⃣ Google Reverse Image ================= */

    logStep(socket,"🔎 Reverse searching image...");

    const serp = await axios.get("https://serpapi.com/search",{
      params:{
        engine:"google_reverse_image",
        image_url:imageUrl,
        api_key:serpapi
      }
    });

    const imageResults = serp.data.image_results || [];

    const aliPages = imageResults.filter(r =>
      r.link && r.link.includes("aliexpress")
    );

    logStep(socket,`🛒 AliExpress pages: ${aliPages.length}`);

    /* ================= 3️⃣ Extract Images From Pages ================= */

    let allProductImages = [];

    for(let page of aliPages.slice(0,5)){

      try{

        logStep(socket,"📥 Extracting images from page...");

        const html = await axios.get(page.link,{
          headers:{ "User-Agent":"Mozilla/5.0" }
        });

        const $ = cheerio.load(html.data);

        $("img").each((i,el)=>{
          const src = $(el).attr("src");

          if(src && src.includes("alicdn")){
            allProductImages.push({
              page: page.link,
              image: src
            });
          }
        });

      }catch(err){
        logStep(socket,"⚠️ Failed extracting images from page");
      }
    }

    logStep(socket,`📦 Images extracted: ${allProductImages.length}`);

    /* ================= 4️⃣ Compare Top 10 Images ================= */

    const imagesToCompare = allProductImages.slice(0,10);

    logStep(socket,`🤖 Comparing ${imagesToCompare.length} images...`);

    let scoredResults = [];

    for(let img of imagesToCompare){

      try{

        const ai = await axios.post(
          "https://api.openai.com/v1/chat/completions",
          {
            model:"gpt-4o",
            messages:[{
              role:"user",
              content:[
                {
                  type:"text",
                  text:"Compare these images and return ONLY a similarity score between 0 and 100."
                },
                {
                  type:"image_url",
                  image_url:{ url:imageUrl }
                },
                {
                  type:"image_url",
                  image_url:{ url:img.image }
                }
              ]
            }]
          },
          {
            headers:{
              Authorization:`Bearer ${openai}`
            }
          }
        );

        const score =
          parseInt(ai.data.choices[0].message.content) || 0;

        scoredResults.push({
          page: img.page,
          image: img.image,
          score
        });

      }catch(err){
        logStep(socket,"❌ AI comparison failed for one image");
      }
    }

    /* ================= 5️⃣ Filter 70–80 ================= */

    scoredResults.sort((a,b)=> b.score - a.score);

    const filtered = scoredResults.filter(p =>
      p.score >= 70 && p.score <= 80
    );

    logStep(socket,`🎯 Results kept (70-80%): ${filtered.length}`);

    res.json({
      results: filtered
    });

  }catch(err){

    logStep(socket,"🔥 PIPELINE FAILED");

    res.status(500).json({
      error:"Pipeline failed",
      detail: err.message
    });
  }

});

server.listen(PORT,()=>{
  console.log("Server running on port",PORT);
});
