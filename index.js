require('dotenv').config();
const { Api, TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { Telegraf } = require("telegraf");
const { MongoClient } = require("mongodb");
const { NewMessage } = require('telegram/events');

// Credentials jo aapne diye the
const API_ID = 38822360;
const API_HASH = "75bdf5b305f75fdbe947ff1959128af0";
const BOT_TOKEN = "8479123695:AAFuoSXnYqeaYMCCxszXeIWaWocMcbL2yds";
const ADMIN_ID = 5291409360;
const TARGET_GROUP = -5374996428; 

// Aapke 4 tags yaha daal dena. Inme se koi 1 bhi match hua to chalega.
const tags = ["ORDER_PLACED", "ORDER_PAID", "𝐀𝐮𝐭𝐨𝐬𝐡𝐨𝐩𝐢𝐟𝐲", " ᏟꮋꭺꭱƦᏽꭼꭰ"];

const bot = new Telegraf(BOT_TOKEN);
let userClient;
let dbCollection;

// Ek message ko double forward hone se rokne ke liye cache
const forwardedCache = new Set();

let loginState = "IDLE";
let resolvePhone, resolveCode, resolvePassword;

// MongoDB Connection Setup
async function initDb() {
    const mongoUrl = process.env.MONGO_URL;
    if (!mongoUrl) {
        console.log("Railway me MONGO_URL variable set nahi hai!");
        return;
    }
    const client = new MongoClient(mongoUrl);
    await client.connect();
    const db = client.db("TelegramForwarder");
    dbCollection = db.collection("sessions");
    console.log("MongoDB connect ho gaya hai.");
}

// Userbot Login Function
async function startUserbotLogin(ctx) {
    userClient = new TelegramClient(new StringSession(""), API_ID, API_HASH, { connectionRetries: 5 });

    try {
        await userClient.start({
            phoneNumber: async () => new Promise(r => resolvePhone = r),
            password: async () => new Promise(r => resolvePassword = r),
            phoneCode: async () => new Promise(r => resolveCode = r),
            onError: (err) => {
                console.log(err);
                ctx.reply("Error aagya: " + err.message);
            }
        });

        // Session Mongo me save kar rahe hai
        const sessionString = userClient.session.save();
        await dbCollection.updateOne(
            { id: "main_session" },
            { $set: { session: sessionString } },
            { upsert: true }
        );

        ctx.reply("Activated! Userbot start ho gaya hai aur messages filter kar raha hai.");
        setupEventHandler();
    } catch (error) {
        ctx.reply("Login me dikkat aayi: " + error.message);
    }
}

// Message Filter and Forward Logic
function setupEventHandler() {
    userClient.addEventHandler(async (event) => {
        const message = event.message;
        if (!message || !message.text) return;

        // Raw text uthayega (font style automatically hat jayega parsing me)
        const text = message.text.toLowerCase();

        // Condition 1: Check karna ki 4 tags me se koi 1 available hai ya nahi
        const hasTag = tags.some(tag => text.includes(tag.toLowerCase()));

        // Condition 2: Message me koi bhi number 4, 5, ya 6 se start ho raha hai kya
        // \b means word space, [456] means starts with 4/5/6, \d* means baki numbers
        const hasNumber = /\b[456]\d*\b/.test(text);

        // Agar dono conditions true hai
        if (hasTag && hasNumber) {
            const msgId = message.id;
            
            // Ek baar forward ho chuka hai to skip kar dega
            if (forwardedCache.has(msgId)) return;
            
            forwardedCache.add(msgId);
            if (forwardedCache.size > 500) forwardedCache.clear(); // Cache limit

            try {
                await userClient.forwardMessages(TARGET_GROUP, {
                    messages: [msgId],
                    fromPeer: message.peerId
                });
                console.log("Message targeted group me forward kar diya gaya hai!");
            } catch (err) {
                console.log("Forward error:", err);
            }
        }
    }, new NewMessage({}));
}

// Telegraf Bot Commands
bot.command("start", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;

    const sessionDoc = await dbCollection.findOne({ id: "main_session" });
    if (sessionDoc && sessionDoc.session) {
        ctx.reply("Saved session mil gaya! Auto-login ho raha hai...");
        userClient = new TelegramClient(new StringSession(sessionDoc.session), API_ID, API_HASH, { connectionRetries: 5 });
        await userClient.connect();
        ctx.reply("Activated! Bot successfully restart ho chuka hai.");
        setupEventHandler();
        return;
    }

    ctx.reply("Send number (country code ke sath, jaise +91...):");
    loginState = "WAIT_PHONE";
    startUserbotLogin(ctx);
});

bot.on("text", (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;

    if (loginState === "WAIT_PHONE") {
        resolvePhone(ctx.message.text);
        loginState = "WAIT_CODE";
        ctx.reply("Number done! Ab Telegram OTP do (spaces add karke dena taaki expire na ho, like 1 2 3 4 5):");
    }
    else if (loginState === "WAIT_CODE") {
        // Space hata ke actual code resolve karega
        resolveCode(ctx.message.text.replace(/\s+/g, ''));
        loginState = "WAIT_PASSWORD";
        ctx.reply("OTP done! Agar 2FA laga hai to password do, warna 'none' likh do:");
    }
    else if (loginState === "WAIT_PASSWORD") {
        resolvePassword(ctx.message.text.toLowerCase() === 'none' ? '' : ctx.message.text);
        loginState = "IDLE";
        ctx.reply("Credentials check ho rahe hai...");
    }
});

initDb().then(() => {
    bot.launch();
    console.log("Bot zinda ho gaya, admin message ka wait kar raha hai...");
}).catch(console.error);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
