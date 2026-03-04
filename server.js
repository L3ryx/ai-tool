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

function log(socket,msg){
  if(socket) socket.emit("log",msg);
}

app.post("/analyze", upload.single("image"), async (req,res)=>{

  const socket = io.sockets.sockets.get(req.body.socketId);

  try{

    const { imgbb, serpapi, openai } = req.body;

    if(!req.file)
      return res.status(400).json({ error:"No image uploaded" });

    /* ================= 1️⃣ Upload Image To ImgBB ================= */

    log(socket,"📤 Uploading image...");

    const form = new FormData();
    form.append("image", req.file.buffer.toString("base64"));

    const uploadRes = await axios.post(
      `https://api.imgbb.com/1/upload?key=${imgbb}`,
      form,
      { headers: form.getHeaders() }
    );

    const imageUrl = uploadRes.data.data.url;

    /* ================= 2️⃣ Google Image Reverse Search ================= */

    log(socket,"🔎 Searching on Google Images...");

    const search = await axios.get("https://serpapi.com/search",{
      params:{
        engine:"google_reverse_image",
        image_url:imageUrl,
        api_key:serpapi
      }
    });

    const results = search.data.image_results || [];

    // 🔥 Prendre les 10 premières images
    const topImages = results.slice(0,10);

    log(socket,"🖼 Top images found: " + topImages.length);

    /* ================= 3️⃣ Compare With OpenAI Vision ================= */

    let finalResults = [];

    for(let img of topImages){

      if(!img.thumbnail) continue;

      log(socket,"🤖 Comparing image...");

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
                  text:"Compare these images and return ONLY similarity score 0-100"
                },
                {
                  type:"image_url",
                  image_url:{ url:imageUrl }
                },
                {
                  type:"image_url",
                  image_url:{ url:img.thumbnail }
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

        // 🔥 Garder seulement les images similaires
        if(score >= 70){

          finalResults.push({
            image: img.thumbnail,
            link: img.link,
            title: img.title || "Image Match",
            score
          });

        }

      }catch(err){
        log(socket,"❌ AI comparison failed for one image");
      }
    }

    log(socket,"🎯 Similar images found: " + finalResults.length);

    res.json({
      results: finalResults
    });

  }catch(err){

    console.error(err);

    log(socket,"🔥 PIPELINE FAILED");

    res.status(500).json({
      error:"Pipeline failed",
      detail: err.message
    });

  }

});

server.listen(PORT,()=>{
  console.log("Server running on port",PORT);
});
