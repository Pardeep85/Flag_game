const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
require("dotenv").config();
const { google } = require("googleapis");
const COUNTRY_NAME_TO_CODE = require("./countryMap");

const youtube = google.youtube({ version: "v3", auth: process.env.YOUTUBE_API_KEY });

/* ================= FLAG / COUNTRY PARSING ================= */

// Converts a flag emoji (two regional indicator symbols) → ISO code, e.g. 🇧🇷 → "BR"
function flagEmojiToCode(emoji) {
    const chars = [...emoji];
    if (chars.length < 2) return null;
    const code = chars.slice(0, 2).map(c => {
        const cp = c.codePointAt(0);
        if (cp >= 0x1F1E6 && cp <= 0x1F1FF) return String.fromCharCode(cp - 0x1F1E6 + 65);
        return null;
    });
    if (code.includes(null)) return null;
    return code.join("");
}

// Returns the first country code found in a chat message, or null
function parseMessageForCountry(text) {
    // 1. Check for flag emojis first
    const flagMatches = text.match(/[\u{1F1E6}-\u{1F1FF}]{2}/gu) || [];
    for (const emoji of flagMatches) {
        const code = flagEmojiToCode(emoji);
        if (code) return code;
    }

    // 2. Check for exact country name match (case-insensitive)
    const lower = text.toLowerCase().trim();
    if (COUNTRY_NAME_TO_CODE[lower]) return COUNTRY_NAME_TO_CODE[lower];

    // 3. Check if message contains a known country name as a whole word
    for (const [name, code] of Object.entries(COUNTRY_NAME_TO_CODE)) {
        const regex = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
        if (regex.test(lower)) return code;
    }

    return null;
}

/* ================= YOUTUBE LIVE CHAT POLLING ================= */

let chatPollTimer = null;
let watchTimer = null;
let chatNextPageToken = null;

const WATCH_INTERVAL_MS = 5 * 60 * 1000; // check for live stream every 10 min when idle

// Polls chat messages and reschedules itself. If the stream ends, falls back to watching.
async function pollYouTubeChat(liveChatId) {
    try {

        console.log("pollYouTubeChat");

        const params = { liveChatId, part: "snippet,authorDetails", maxResults: 200 };
        if (chatNextPageToken) params.pageToken = chatNextPageToken;

        const response = await youtube.liveChatMessages.list(params);
        const data = response.data;

        chatNextPageToken = data.nextPageToken;

        const state = loadState();

        const protectedSet = new Set(state.protectedFlags || []);
        let changed = false;

        const supporters = state.supporters || {};

        for (const item of data.items || []) {

            if (item.snippet?.type !== "textMessageEvent") continue;

            const text = item.snippet?.displayMessage || "";
            const author = item.authorDetails?.channelId || "anonymous";
            const displayName = item.authorDetails?.displayName || "Unknown";
            const code = parseMessageForCountry(text);

            if (state.selectedCountries.includes(code)) {
                console.log("---- CHAT DEBUG ----");
                console.log("Message:", item);
                // console.log("Parsed Code:", code);
                // console.log("In selectedCountries:", code ? state.selectedCountries.includes(code) : false);
                // console.log("Already protected:", code ? protectedSet.has(code) : false);
                console.log("--------------------");
            }

            if (!code || !state.selectedCountries.includes(code)) continue;

            // 🟢 CASE 1: no flag protected yet
            if (protectedSet.size === 0) {

                protectedSet.add(code);

                supporters[code] = [{
                    id: author,
                    name: displayName,
                    time: Date.now()
                }];

                console.log("FIRST PROTECT:", code, "by", displayName);
                changed = true;
                continue;
            }

            // 🔵 CASE 2: only support already protected flag
            const currentFlag = [...protectedSet][0];

            if (code === currentFlag) {

                if (!supporters[currentFlag]) supporters[currentFlag] = [];

                if (!supporters[currentFlag].some(s => s.id === author)) {
                    supporters[currentFlag].push({
                        id: author,
                        name: displayName,
                        time: Date.now()
                    });

                    console.log("SUPPORT:", displayName, "→", currentFlag);
                    changed = true;
                }
            }

            // ❌ ignore other flags completely
        }

        if (changed) {
            saveState({
                ...state,
                protectedFlags: [...protectedSet], // only 1 element
                supporters,
                updatedAt: Date.now()
            });
        }

        const interval = data.pollingIntervalMillis || 5000;

        chatPollTimer = setTimeout(() => pollYouTubeChat(liveChatId), interval);

    } catch (err) {
        console.log("[Chat] Stream ended or chat unavailable:", err.message);
        console.log("[Chat] Watching for next live stream...");
        chatNextPageToken = null;
        watchTimer = setTimeout(watchForLiveStream, WATCH_INTERVAL_MS);
    }
}

// Checks if the channel is currently live. If yes, starts chat polling. If not, checks again later.
async function watchForLiveStream() {
    try {
        const res = await youtube.search.list({
            part: "snippet",
            channelId: process.env.YOUTUBE_CHANNEL_ID,
            eventType: "live",
            type: "video",
            maxResults: 1
        });

        const liveVideo = res.data.items?.[0];

        if (!liveVideo) {
            console.log("[Chat] No active stream found. Checking again in 60s...");
            watchTimer = setTimeout(watchForLiveStream, WATCH_INTERVAL_MS);
            return;
        }

        const videoId = liveVideo.id.videoId;
        console.log(`[Chat] Live stream detected! Video ID: ${videoId}`);

        // Fetch the live chat ID from the video
        const videoRes = await youtube.videos.list({
            part: "liveStreamingDetails",
            id: videoId
        });

        const liveChatId = videoRes.data.items?.[0]?.liveStreamingDetails?.activeLiveChatId;

        if (!liveChatId) {
            console.log("[Chat] Could not get live chat ID. Retrying in 60s...");
            watchTimer = setTimeout(watchForLiveStream, WATCH_INTERVAL_MS);
            return;
        }

        console.log(`[Chat] Connected to live chat: ${liveChatId}. Polling started.`);
        chatNextPageToken = null;
        pollYouTubeChat(liveChatId);
    } catch (err) {
        console.error("[Chat] Error while watching for live stream:", err.message);
        watchTimer = setTimeout(watchForLiveStream, WATCH_INTERVAL_MS);
    }
}

// Entry point — called once on server start
function startYouTubeChatPolling() {
    if (!process.env.YOUTUBE_API_KEY) {
        console.log("[Chat] YOUTUBE_API_KEY not set — skipping.");
        return;
    }

    if (!process.env.YOUTUBE_CHANNEL_ID) {
        console.log("[Chat] YOUTUBE_CHANNEL_ID not set — skipping.");
        return;
    }

    console.log("[Chat] Watching channel for live streams:", process.env.YOUTUBE_CHANNEL_ID);
    watchForLiveStream();
}

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;
const STATE_FILE = path.join(__dirname, "gameState.json");

/* ================= FILE HELPERS ================= */

function createDefaultState() {
    return {
        flagCount: 20,
        netSize: 200,
        fireTarget: null,
        heartTarget: null,
        selectedCountries: [
            "AC",
            "AD",
            "AE",
            "AF",
            "AG",
            "AI",
            "AL",
            "AM",
            "AO",
            "AQ",
            "AR",
            "AS",
            "AT",
            "AU",
            "AW",
            "AX",
            "AZ",
            "BA",
            "BB",
            "BD",
            "BE",
            "BF",
            "BG",
            "BH",
            "BI",
            "BJ",
            "BL",
            "BM",
            "BN",
            "BO",
            "BQ",
            "BR",
            "BS",
            "BT",
            "BV",
            "BW",
            "BY",
            "BZ",
            "CA",
            "CC",
            "CD",
            "CF",
            "CG",
            "CH",
            "CI",
            "CK",
            "CL",
            "CM",
            "CN",
            "CO",
            "CR",
            "CU",
            "CV",
            "CW",
            "CX",
            "CY",
            "CZ",
            "DE",
            "DJ",
            "DK",
            "DM",
            "DO",
            "DZ",
            "EC",
            "EE",
            "EG",
            "EH",
            "ER",
            "ES",
            "ET",
            "EU",
            "FI",
            "FJ",
            "FK",
            "FM",
            "FO",
            "FR",
            "GA",
            "GB",
            "GD",
            "GE",
            "GF",
            "GG",
            "GH",
            "GI",
            "GL",
            "GM",
            "GN",
            "GP",
            "GQ",
            "GR",
            "GS",
            "GT",
            "GU",
            "GW",
            "GY",
            "HK",
            "HM",
            "HN",
            "HR",
            "HT",
            "HU",
            "ID",
            "IE",
            "IL",
            "IM",
            "IN",
            "IO",
            "IQ",
            "IR",
            "IS",
            "IT",
            "JE",
            "JM",
            "JO",
            "JP",
            "KE",
            "KG",
            "KH",
            "KI",
            "KM",
            "KN",
            "KP",
            "KR",
            "KW",
            "KY",
            "KZ",
            "LA",
            "LB",
            "LC",
            "LI",
            "LK",
            "LR",
            "LS",
            "LT",
            "LU",
            "LV",
            "LY",
            "MA",
            "MC",
            "MD",
            "ME",
            "MF",
            "MG",
            "MH",
            "MK",
            "ML",
            "MM",
            "MN",
            "MO",
            "MP",
            "MQ",
            "MR",
            "MS",
            "MT",
            "MU",
            "MV",
            "MW",
            "MX",
            "MY",
            "MZ",
            "NA",
            "NC",
            "NE",
            "NF",
            "NG",
            "NI",
            "NL",
            "NO",
            "NP",
            "NR",
            "NU",
            "NZ",
            "OM",
            "PA",
            "PE",
            "PF",
            "PG",
            "PH",
            "PK",
            "PL",
            "PM",
            "PN",
            "PR",
            "PS",
            "PT",
            "PW",
            "PY",
            "QA",
            "RE",
            "RO",
            "RS",
            "RU",
            "RW",
            "SA",
            "SB",
            "SC",
            "SD",
            "SE",
            "SG",
            "SH",
            "SI",
            "SJ",
            "SK",
            "SL",
            "SM",
            "SN",
            "SO",
            "SR",
            "SS",
            "ST",
            "SV",
            "SX",
            "SY",
            "SZ",
            "TA",
            "TC",
            "TD",
            "TF",
            "TG",
            "TH",
            "TJ",
            "TK",
            "TL",
            "TM",
            "TN",
            "TO",
            "TR",
            "TT",
            "TV",
            "TW",
            "TZ",
            "UA",
            "UG",
            "UM",
            "US",
            "UY",
            "UZ",
            "VA",
            "VC",
            "VE",
            "VG",
            "VI",
            "VN",
            "VU",
            "WF",
            "WS",
            "XK",
            "YE",
            "YT",
            "ZA",
            "ZM",
            "ZW"
        ],

        volume: 0.7,

        chaosEvent: {
            triggeredAt: 0,
            enabled: false
        },

        protectedFlags: [],

        updatedAt: Date.now()
    };
}
// function createDefaultState() {
//     return {
//         flagCount: 20,
//         netSize: 200,
//         fireTarget: null,
//         heartTarget: null,
//         selectedCountries: [],
//         volume: 0.7,

//         chaosEvent: {
//             triggeredAt: 0,
//             enabled: false
//         },

//         updatedAt: Date.now()
//     };
// }

function loadState() {
    if (!fs.existsSync(STATE_FILE)) {
        const initial = createDefaultState();
        fs.writeFileSync(STATE_FILE, JSON.stringify(initial, null, 2));
        return initial;
    }

    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
}

function saveState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/* ================= VALIDATION ================= */

// function validatePayload(p) {
//     if (p.flagCount !== undefined) {
//         if (typeof p.flagCount !== "number" || p.flagCount < 5 || p.flagCount > 100)
//             return "flagCount invalid";
//     }

//     if (p.netSize !== undefined) {
//         if (typeof p.netSize !== "number" || p.netSize < 100 || p.netSize > 300)
//             return "netSize invalid";
//     }

//     if (
//         p.fireTarget !== undefined &&
//         p.heartTarget !== undefined &&
//         p.fireTarget === p.heartTarget
//     ) {
//         return "fireTarget and heartTarget cannot match";
//     }

//     return null;
// }

function validatePayload(p) {

    if (p.flagCount && (p.flagCount < 5 || p.flagCount > 100))
        return "flagCount invalid";

    if (p.netSize && (p.netSize < 100 || p.netSize > 300))
        return "netSize invalid";

    if (p.fireTarget && p.fireTarget === p.heartTarget)
        return "fireTarget and heartTarget cannot match";


    if (p.chaos) {
        if (typeof p.chaos.active !== "boolean")
            return "chaos.active must be boolean";

        if (p.chaos.speed && p.chaos.speed <= 0)
            return "chaos.speed invalid";
    }

    return null;
}

/* ================= ROUTES ================= */

// Get full game state
app.get("/game/state", (req, res) => {
    const state = loadState();
    res.json(state);
});

// Update normal settings (NOT chaos)
app.post("/game/state", (req, res) => {
    const incoming = req.body;

    const error = validatePayload(incoming);
    if (error) {
        return res.status(400).json({ error });
    }

    const current = loadState();

    const updated = {
        ...current,
        ...incoming,
        updatedAt: Date.now()
    };

    saveState(updated);

    res.json({ success: true, state: updated });
});

// 🔥 Chaos button trigger endpoint
app.post("/game/chaos", (req, res) => {
    const current = loadState();

    const updated = {
        ...current,
        chaosEvent: {
            triggeredAt: Date.now(),
            enabled: true
        },
        updatedAt: Date.now()
    };

    saveState(updated);

    res.json({ success: true });
});

app.post("/game/chaos/reset", (req, res) => {
    const current = loadState();

    const updated = {
        ...current,
        chaosEvent: {
            triggeredAt: 0,
            enabled: false
        },
        updatedAt: Date.now()
    };

    saveState(updated);

    res.json({ success: true, message: updated });
});

app.get("/game/chaos", (req, res) => {
    const state = loadState();
    res.json(state.chaosEvent);
});

/* ================= PROTECTED FLAGS ROUTES ================= */

// Get currently protected flags
app.get("/game/protected", (_req, res) => {
    const state = loadState();
    res.json({ protectedFlags: state.protectedFlags || [] });
});

// Manually protect a flag (by country code)
app.post("/game/protected", (req, res) => {
    const { code } = req.body;
    if (!code || typeof code !== "string") return res.status(400).json({ error: "code required" });

    const state = loadState();
    const upper = code.toUpperCase();
    if (!state.selectedCountries.includes(upper)) return res.status(400).json({ error: "country not in game" });

    const protectedSet = new Set(state.protectedFlags || []);
    protectedSet.add(upper);
    saveState({ ...state, protectedFlags: [...protectedSet], updatedAt: Date.now() });
    res.json({ success: true, protectedFlags: [...protectedSet] });
});

// Clear all protected flags
app.post("/game/protected/clear", (_req, res) => {
    const state = loadState();
    saveState({ ...state, protectedFlags: [], updatedAt: Date.now() });
    res.json({ success: true });
});

// Simulate a chat message (for testing without a real YouTube stream)
app.post("/game/chat/test", (req, res) => {
    const { message, username } = req.body;
    if (!message || typeof message !== "string") return res.status(400).json({ error: "message required" });

    const code = parseMessageForCountry(message);
    if (!code) return res.json({ matched: false, message });

    const state = loadState();
    if (!state.selectedCountries.includes(code)) {
        return res.json({ matched: true, code, protected: false, reason: "country not in current game" });
    }

    const protectedSet = new Set(state.protectedFlags || []);
    const alreadyProtected = protectedSet.has(code);
    protectedSet.add(code);

    const supporters = state.supporters || {};
    if (!supporters[code]) supporters[code] = [];
    const user = username || `TestUser_${Date.now()}`;
    if (!supporters[code].some(s => s.name === user)) {
        supporters[code].push({ id: user, name: user, time: Date.now() });
    }

    saveState({ ...state, protectedFlags: [...protectedSet], supporters, updatedAt: Date.now() });

    res.json({ matched: true, code, protected: true, alreadyProtected, message, supporter: user });
});

// Get supporters for a specific flag
app.get("/game/supporters/:code", (req, res) => {
    const state = loadState();
    const code = req.params.code.toUpperCase();
    const supporters = state.supporters || {};
    res.json(supporters[code] || []);
});

// Clear all supporters (called on new round)
app.post("/game/supporters/clear", (_req, res) => {
    const state = loadState();
    saveState({ ...state, supporters: {}, updatedAt: Date.now() });
    res.json({ success: true });
});

/* ================= START ================= */

app.listen(PORT, () => {
    console.log(`Backend running on ${PORT}`);
    startYouTubeChatPolling();
});
