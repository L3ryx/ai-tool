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

function logStep(socket,msg){
  if(socket) socket.emit("log",msg);
}

app.post("/analyze", upload.single("image"), async (req,res)=>{

  const socket = io.sockets.sockets.get(req.body.socketId);

  try{

    const { imgbb, serpapi, openai } = req.body;

    if(!req.file)
      return res.status(400).json({ error:"No image uploaded" });

    /* ================= 1️⃣ Upload Image ================= */

    logStep(socket,"📤 Uploading image to ImgBB...");

    const form = new FormData();
    form.append("image", req.file.buffer.toString("base64"));

    const imgRes = await axios.post(
      `https://api.imgbb.com/1/upload?key=${imgbb}`,
      form,
      { headers: form.getHeaders() }
    );

    const imageUrl = imgRes.data.data.url;

    /* ================= 2️⃣ AliExpress Image Search ================= */

    logStep(socket,"🔎 Searching directly on AliExpress...");

    const search = await axios.get("https://serpapi.com/search",{
      params:{
        engine:"aliexpress_search",
        q:imageUrl,
        api_key:serpapi
      }
    });

    const products = search.data.products || [];

    logStep(socket,"🛍 Products found: " + products.length);

    const topProducts = products.slice(0,10);

    /* ================= 3️⃣ Compare 10 Products ================= */

    let scoredResults = [];

    for(let product of topProducts){

      if(!product.image) continue;

      logStep(socket,"🤖 Comparing: " + product.title);

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
                  text:"Compare these images and return only a similarity score from 0 to 100"
                },
                {
                  type:"image_url",
                  image_url:{ url:imageUrl }
                },
                {
                  type:"image_url",
                  image_url:{ url:product.image }
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
          title: product.title,
          image: product.image,
          link: product.link,
          price: product.price,
          score
        });

      }catch(err){
        logStep(socket,"❌ AI comparison failed");
      }
    }

    /* ================= 4️⃣ Filter 70–80 ================= */

    scoredResults.sort((a,b)=> b.score - a.score);

    const filtered = scoredResults.filter(p =>
      p.score >= 70 && p.score <= 80
    );

    logStep(socket,"🎯 Final Results: " + filtered.length);

    res.json({
      results: filtered
    });

  }catch(err){

    console.error(err);

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
