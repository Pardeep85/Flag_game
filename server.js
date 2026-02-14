const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
require("dotenv").config();

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

    res.json({ success: true });
});

app.get("/game/chaos", (req, res) => {
    const state = loadState();
    res.json(state.chaosEvent);
});

/* ================= START ================= */

app.listen(PORT, () => {
    console.log(`Backend running on ${PORT}`);
});
