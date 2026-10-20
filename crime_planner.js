/**
 * Forensic Spatial Crime Scene Event & Animation Planner
 * 
 * Converts free-text crime scene descriptions (e.g. "killer came from door in north...")
 * into structured generic actor scripts and 3D kinematic tracks using Google Gemini API
 * or an advanced rule-based / directional forensic NLP fallback engine.
 */
import fs from "fs";
import { NavGrid } from "./navgrid.js";

// Supported generic actions
export const ACTIONS = [
  "enter", "walk_to", "run_to", "sneak_to", "leave", "flee",
  "attack", "aim", "defend", "surrender", "struggle", "collapse", "stumble",
  "inspect", "search", "grab", "take", "drop_weapon",
  "sit", "stand", "kneel", "crouch", "idle", "wait"
];

export const ATTACK_STYLES = [
  "stab", "strike", "slash", "shoot", "punch", "push", "strangle", "kick"
];

export const WEAPON_TYPES = [
  "gun", "pistol", "knife", "dagger", "crowbar", "bat", "bag"
];

export const COLLAPSE_STYLES = [
  "from_sit", "fall_backward", "fall_forward", "crumple"
];

export const SPEEDS = {
  sneak: 0.85,
  walk: 1.35,
  run: 2.85,
  sprint: 3.6
};

export const CARDINAL_ANGLES = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315
};

const GEMINI_SYSTEM_PROMPT = `You are an expert forensic 3D crime recreation reasoning engine.
Your task is to take ANY freeform user statement (casual description, police report, witness statement, short prompt, or complex narrative) and extract the key forensic event milestones to demonstrate in 3D animation.

No matter how the user phrases the input, extract:
1. Actors: Identify the perpetrator(s), victim(s), accomplice(s), and witnesses.
2. Entry Portal: Identify where the perpetrator enters (e.g., door_south, door_north, window_west, or generic 'door').
3. Victim Position & Posture:
   - Identify where the victim is positioned in the room. If a direction or area is mentioned (e.g. "victim was in north", "victim in south", "victim sits in north-west", "victim near west window"), assign the corresponding sector anchor: chair_north, chair_south, chair_nw, chair_west, etc.
   - If user explicitly says center/middle, use chair_center.
   - Victim Posture:
     * If user mentions standing, stands, stand, upright: "pose": "standing"
     * If user mentions sleeping, sleep, asleep, lying down, lying, bed, nap: "pose": "lying"
     * If user mentions sitting, sits, seated: "pose": "sitting"
     * CRITICAL: Strictly obey the user's requested posture (standing, sitting, or lying).
4. Encounter Actions:
   - Perpetrator enters room (action: "enter", target: entry_anchor).
   - Perpetrator approaches victim (action: "walk_to", target: "victim").
   - Attack:
     * If firearm/gun: aim (action: "aim", weapon: "gun") -> shoot (action: "attack", style: "shoot", weapon: "gun") -> victim collapses (action: "collapse", style: "fall_backward").
     * If bat/club/crowbar: strike (action: "attack", style: "strike", weapon: "bat") -> victim collapses (action: "collapse", style: "crumple").
     * If knife/blade: stab/slash (action: "attack", style: "stab"|"slash", weapon: "knife").
     * If bare hands: punch/push/strangle.
5. Exit / Escape Route:
   - If the user specifies fleeing, escaping, leaving, or "runs away from same path" / "same door" / "same way" / "retracing", add action: "leave", target: entry_anchor, same_path: true.
   - If fleeing through another exit (e.g. "runs out east door"), use target: door_east.

OUTPUT FORMAT: Return ONLY valid JSON matching this schema:
{
  "actors": [
    {
      "id": "killer",
      "role": "perpetrator",
      "name": "Perpetrator",
      "color": "#ef4444",
      "weapon": "gun"|"knife"|"bat"|"crowbar",
      "start": { "hidden": true }
    },
    {
      "id": "victim",
      "role": "victim",
      "name": "Victim",
      "color": "#06b6d4",
      "start": { "at": "chair_north"|"chair_south"|"chair_nw"|"chair_center", "pose": "sitting"|"standing"|"lying" }
    }
  ],
  "anchors_needed": ["door_south", "chair_north"],
  "events": [
    { "actor": "killer", "action": "enter", "target": "door_south", "pace": "walk"|"sneak"|"run", "narrative": "..." },
    { "actor": "killer", "action": "walk_to", "target": "victim", "pace": "walk"|"run", "narrative": "..." },
    { "actor": "killer", "action": "attack", "target": "victim", "style": "strike"|"shoot"|"stab", "weapon": "...", "narrative": "..." },
    { "actor": "victim", "action": "collapse", "style": "crumple"|"fall_backward", "narrative": "..." },
    { "actor": "killer", "action": "leave", "target": "door_south", "same_path": true, "pace": "run", "narrative": "..." }
  ]
}

SAFETY & COMPLIANCE POLICY:
DO NOT generate scenarios depicting or simulating suicide or self-harm under any circumstances. Focus strictly on forensic crime analysis, homicide investigation, and trajectory modeling. Return ONLY JSON.`;

/**
 * Call Google Gemini API to parse prompt into structured action script
 */
export async function parseWithGemini(prompt, apiKey) {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error("No Gemini API key provided");

  // Models to try in order of preference
  const models = ["gemini-3.8-flash", "gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"];

  let lastError = null;

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const payload = {
        contents: [
          {
            role: "user",
            parts: [{ text: `${GEMINI_SYSTEM_PROMPT}\n\nCrime Scene Description:\n${prompt}` }]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json"
        }
      };

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini API error (${res.status}): ${errText}`);
      }

      const data = await res.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) throw new Error("Empty response from Gemini API");

      // Extract JSON substring if wrapped in markdown
      let jsonStr = rawText.trim();
      const firstBrace = jsonStr.indexOf("{");
      const lastBrace = jsonStr.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1) {
        jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
      }

      const script = JSON.parse(jsonStr);
      if (Array.isArray(script.actors) && Array.isArray(script.events)) {
        return script;
      }
    } catch (e) {
      lastError = e;
      console.warn(`[Gemini] ${model} failed: ${e.message}, trying next if available...`);
    }
  }

  throw lastError || new Error("Failed to parse script with Gemini");
}

/**
 * Advanced Rule-Based & Cardinal Forensic NLP Parser (Offline fallback)
 */
export function ruleBasedParse(prompt) {
  const t = prompt.toLowerCase();

  // Helper: Format anchor name to clean human-readable text
  function formatAnchorLabel(anchor) {
    if (!anchor) return "door";
    if (anchor.includes("_")) {
      const parts = anchor.split("_");
      const type = parts[0];
      const dir = parts.slice(1).join(" ");
      const dirMap = { n: "North", s: "South", e: "East", w: "West", ne: "North-East", nw: "North-West", se: "South-East", sw: "South-West", center: "Center", corner: "Corner" };
      const dirName = dirMap[dir.toLowerCase()] || dir.toUpperCase();
      return `${dirName} ${type}`;
    }
    return anchor;
  }

  // Helper: Extract cardinal direction from any text snippet (returns null if none found)
  function extractDirection(str) {
    if (!str) return null;
    if (/\b(?:north[\s-]?west|nw)\b/i.test(str)) return "NW";
    if (/\b(?:north[\s-]?east|ne)\b/i.test(str)) return "NE";
    if (/\b(?:south[\s-]?west|sw)\b/i.test(str)) return "SW";
    if (/\b(?:south[\s-]?east|se)\b/i.test(str)) return "SE";
    if (/\b(?:north|n)\b/i.test(str)) return "N";
    if (/\b(?:south|s)\b/i.test(str)) return "S";
    if (/\b(?:east|e)\b/i.test(str)) return "E";
    if (/\b(?:west|w)\b/i.test(str)) return "W";
    if (/\b(?:center|middle)\b/i.test(str)) return "Center";
    return null;
  }

  function extractPortalType(str, defaultType = "door") {
    if (!str) return defaultType;
    const m = str.match(/\b(door|window|hallway|entrance|gate|backdoor|balcony)\b/i);
    return m ? m[1].toLowerCase() : defaultType;
  }

  function extractPortalInfo(clause) {
    const dir = extractDirection(clause);
    const type = extractPortalType(clause, "door");
    if (dir && dir !== "Center") {
      return { anchor: `${type}_${dir.toLowerCase()}`, dir, type, hasDir: true };
    }
    return { anchor: type, dir: null, type, hasDir: false };
  }

  // Split prompt into sequential clauses by conjunctions or punctuation
  const clauses = prompt.split(/\b(?:and\s+then|then|after\s+that|afterwards|meanwhile|while|and\s+behind(?:\s+of)?(?:\s+which)?|behind\s+of\s+which)\b|[.,;]|\band\s+(?=(?:killer|attacker|perpetrator|burglar|intruder|shooter|assailant|gunman|victim|target|person|man|woman|resident|he|she|they)\b)/i)
    .map(s => s.trim())
    .filter(Boolean);

  // 1. Detect if the VICTIM enters the room
  const victimEnters = /(?:(?:the\s+)?victim|(?:the\s+)?resident|(?:the\s+)?target)\s+(?:comes?|enters?|walks?|steps?|runs?|sneaks?|arrives?|breaks?)\b/i.test(t)
    || /(?:let|allow|make)\s+(?:the\s+)?victim\s+(?:come|enter|walk|step|sneak)\b/i.test(t);

  let victimEntryAnchor = "door";
  if (victimEnters) {
    const vMatch = t.match(/(?:(?:let|allow|make)\s+(?:the\s+)?victim|(?:the\s+)?victim|(?:the\s+)?resident|(?:the\s+)?target)\s+(?:comes?|enters?|walks?|steps?|runs?|sneaks?|arrives?|come|enter|walk|step)[^.,;]*/i);
    const vClause = vMatch ? vMatch[0].split(/\b(?:and\s+then|then|after\s+that|meanwhile|while|and\s+behind|behind|and)\b/i)[0] : "";
    victimEntryAnchor = extractPortalInfo(vClause).anchor;
  }

  // 2. Detect KILLER's entry
  const killerBehind = victimEnters && /\b(?:behind\s+(?:of\s+)?(?:which|whom|them|him|her)|follows?|comes?\s+behind|sneaks?\s+behind|after\s+(?:them|him|her)|behind)\b/i.test(t);

  let killerEntryAnchor = victimEntryAnchor;
  if (!killerBehind) {
    const kMatch = t.match(/(?:killer|attacker|perpetrator|burglar|intruder|shooter|assailant|gunman)[^.,;]*(?:comes?|enters?|walks?|broke|breaks|sneaks?|from|bursts?|jumps?|climbs?)[^.,;]*/i)
      || t.match(/(?:killer|attacker|perpetrator|burglar|intruder|shooter|assailant|gunman)[^.,;]*/i);
    const kClause = kMatch ? kMatch[0].split(/\b(?:and\s+then|then|after\s+that|meanwhile|while|and\s+(?:shoots?|attacks?|hits?|stabs?|kills?|strikes?)|and)\b/i)[0] : t;
    killerEntryAnchor = extractPortalInfo(kClause).anchor;
  }

  // 3. Return / Escape route detection
  const isSamePath = /\b(?:same\s+(?:path|route|way|door|entrance|exit)|way\s+(?:he|she|they)\s+came|back\s+(?:the\s+same\s+way|out|to\s+(?:the\s+)?door)|retraces?\s+(?:his|her|their)?\s*steps?|retreats?\s+(?:back|along)?)\b/i.test(t);

  let exitAnchor;
  let exitNarrative;
  if (isSamePath) {
    exitAnchor = killerEntryAnchor;
    exitNarrative = `Perpetrator runs away along the same path through the ${formatAnchorLabel(killerEntryAnchor)}`;
  } else {
    const exitMatch = t.match(/(?:leaves?|fled|flees?|runs?\s*(?:out|away)|escapes?|exits?|climbed\s*out|jumps?\s*out|departs?)[^.,;]*/i);
    const exitClause = exitMatch ? exitMatch[0].split(/\b(?:and\s+then|then|after\s+that|meanwhile|while|and)\b/i)[0] : "";
    const exitPortal = extractPortalInfo(exitClause);
    if (exitPortal.hasDir) {
      exitAnchor = exitPortal.anchor;
    } else {
      const kDir = extractDirection(killerEntryAnchor);
      if (kDir) {
        const defaultExitDir = { N: "S", S: "N", E: "W", W: "E", NE: "SW", NW: "SE", SE: "NW", SW: "NE" }[kDir] || "S";
        exitAnchor = `${exitPortal.type}_${defaultExitDir.toLowerCase()}`;
      } else {
        exitAnchor = exitPortal.type; // "door" or "window"
      }
    }
    exitNarrative = `Perpetrator flees through the ${formatAnchorLabel(exitAnchor)}`;
  }

  // 4. Detect Weapon & Attack Style
  let attackStyle = "strike";
  let weapon = "bat";

  if (/\b(?:bat|baseball\s*bat|cricket\s*bat|club|stick)\b/i.test(t)) {
    attackStyle = "strike";
    weapon = "bat";
  } else if (/\b(?:crowbar|hammer|iron\s*rod|pipe|wrench)\b/i.test(t)) {
    attackStyle = "strike";
    weapon = "crowbar";
  } else if (/\b(?:shoot|shoots|shot|fired|gun|firearm|pistol|rifle|revolver|bullet|gunpoint)\b/i.test(t)) {
    attackStyle = "shoot";
    weapon = "gun";
  } else if (/\b(?:stab|stabs|stabbed|knife|dagger|blade|machete|sword)\b/i.test(t)) {
    attackStyle = "stab";
    weapon = "knife";
  } else if (/\b(?:slash|slashes|slashed|cut|cuts)\b/i.test(t)) {
    attackStyle = "slash";
    weapon = "knife";
  } else if (/\b(?:punch|punched|punches|fist|boxed)\b/i.test(t)) {
    attackStyle = "punch";
    weapon = null;
  } else if (/\b(?:pushed|pushes|shoved|shoves)\b/i.test(t)) {
    attackStyle = "push";
    weapon = null;
  } else if (/\b(?:strangled|strangles|choked|chokes|suffocated)\b/i.test(t)) {
    attackStyle = "strangle";
    weapon = null;
  } else if (/\b(?:kicked|kicks)\b/i.test(t)) {
    attackStyle = "kick";
    weapon = null;
  } else if (/\b(?:hit|hits|struck|strikes|beat|beats|attack|attacks|bludgeon)\b/i.test(t)) {
    attackStyle = "strike";
    weapon = "bat";
  }

  // 5. Victim static anchor (when victim does NOT enter from outside)
  const vMatch = t.match(/(?:(?:the\s+)?victim|(?:the\s+)?resident|(?:the\s+)?target|person|someone|somebody|occupant|individual|man|woman|hostage|guest|bystander)[^.,;]*/i);
  const vClause = vMatch ? vMatch[0] : "";
  const vPreMatch = t.match(/(north[\s-]?west|north[\s-]?east|south[\s-]?west|south[\s-]?east|north|south|east|west|nw|ne|sw|se|center|middle|corner)[^.]*?(?:victim|resident|target|person|someone|somebody|occupant|individual|man|woman|hostage|guest|bystander)/i);
  const chairMatch = t.match(/(?:chair|stool|seat|armchair|bed|couch|sofa|desk|table)[^.,;]*(?:located|placed|in|at|near|towards)?\s*(?:north[\s-]?west|north[\s-]?east|south[\s-]?west|south[\s-]?east|north|south|east|west|nw|ne|sw|se|center|middle|corner)\b/i)
    || t.match(/(?:north[\s-]?west|north[\s-]?east|south[\s-]?west|south[\s-]?east|north|south|east|west|nw|ne|sw|se|center|middle|corner)\s*(?:chair|stool|seat|armchair|bed|couch|sofa|desk|table)\b/i);

  let vChairDir = extractDirection(vClause) || extractDirection(vPreMatch ? vPreMatch[0] : null) || extractDirection(chairMatch ? chairMatch[0] : null);

  // Fallback directional deduction: If prompt mentions directions, and one is not the perpetrator's entrance, assign it to victim!
  if (!vChairDir) {
    const kDir = extractDirection(killerEntryAnchor);
    const dirRegex = /\b(north[\s-]?west|north[\s-]?east|south[\s-]?west|south[\s-]?east|north|south|east|west|nw|ne|sw|se)\b/gi;
    let m;
    while ((m = dirRegex.exec(t)) !== null) {
      const d = extractDirection(m[1]);
      if (d && d !== kDir) {
        vChairDir = d;
        break;
      }
    }
  }
  const isCorner = /\bcorner\b/i.test(vClause) || /\bcorner\b/i.test(chairMatch ? chairMatch[0] : "") || /\bcorner\b/i.test(t);

  // Precise posture detection (independent of furniture words)
  const isStanding = /\b(?:stand|standing|stands|stood|upright|erect|on (?:his|her|their) feet)\b/i.test(t);
  const isSitting = /\b(?:sit|sitting|sits|seated)\b/i.test(t);
  const isLying = /\b(?:lie|lying|lies|lay|sleep|sleeping|sleeps|asleep|bed|slumber|resting|nap)\b/i.test(t);

  let victimPose;
  if (isStanding && !isSitting) {
    victimPose = "standing";
  } else if (isLying && !isSitting) {
    victimPose = "lying";
  } else if (isSitting) {
    victimPose = "sitting";
  } else if (/\b(?:bed)\b/i.test(t)) {
    victimPose = "lying";
  } else if (/\b(?:chair|stool|seat|armchair|couch|sofa)\b/i.test(t)) {
    victimPose = "sitting";
  } else {
    // Default when no posture keyword is provided: standing
    victimPose = "standing";
  }

  let victimAnchor = "chair";
  const dirCode = (vChairDir && vChairDir !== "Center") ? vChairDir.toLowerCase() : null;

  if (dirCode) {
    if (victimPose === "lying" || /\b(?:bed)\b/i.test(t)) {
      victimAnchor = `bed_${dirCode}`;
    } else if (/\b(?:couch|sofa)\b/i.test(t)) {
      victimAnchor = `couch_${dirCode}`;
    } else {
      victimAnchor = `chair_${dirCode}`;
    }
  } else if (/\b(?:middle|center)\b/i.test(t) || vChairDir === "Center") {
    victimAnchor = victimPose === "lying" ? "bed_center" : (victimPose === "standing" ? "chair_center" : "chair_center");
  } else if (isCorner) {
    victimAnchor = "chair_corner";
  } else if (victimPose === "lying" || /\b(?:bed)\b/i.test(t)) {
    victimAnchor = "bed";
  } else if (/\b(?:couch|sofa)\b/i.test(t)) {
    victimAnchor = "couch";
  } else {
    victimAnchor = "chair";
  }

  // 6. Action Flags
  const hasAim = /\b(?:aim|aims|aimed|pointing|points|gunpoint)\b/i.test(t) || (attackStyle === "shoot" && !/\b(?:rush|surprise)\b/i.test(t));
  const hasSurrender = /\b(?:surrender|surrenders|hands up|raises hands)\b/i.test(t);
  const hasDropWeapon = /\b(?:drops? (?:the )?(?:gun|weapon|knife|crowbar|bat|firearm|pistol)|drops? it)\b/i.test(t);
  const hasStruggle = /\b(?:struggle|struggles|fought|fight|defend|defends)\b/i.test(t);
  const hasSearch = /\b(?:steal|steals|stole|take|takes|took|grab|grabs|search|searches|bag|evidence|drawers)\b/i.test(t);
  const hasAccomplice = /\b(?:accomplice|partner|second (?:killer|attacker|person))\b/i.test(t);
  const hasWitness = /\b(?:witness|bystander|security|guard)\b/i.test(t);

  const perpEnterPace = /\b(?:sneak|sneaks|crawls)\b/i.test(t) ? "sneak"
    : /\b(?:rush|rushes|runs|sprints)\b/i.test(t) ? "run"
      : "walk";
  const perpExitPace = /\b(?:walk|walks|slowly)\b/i.test(t) && !/\b(?:flees|runs|sprints)\b/i.test(t) ? "walk" : "run";

  // Build actors list
  const actors = [];
  if (victimEnters) {
    actors.push({
      id: "victim",
      role: "victim",
      name: "Victim",
      color: "#06b6d4",
      start: { hidden: true }
    });
  } else {
    actors.push({
      id: "victim",
      role: "victim",
      name: "Victim",
      color: "#06b6d4",
      start: { at: victimAnchor, pose: victimPose }
    });
  }

  actors.push({
    id: "killer",
    role: "perpetrator",
    name: "Perpetrator",
    color: "#ef4444",
    weapon: weapon,
    start: { hidden: true }
  });

  if (hasAccomplice) {
    actors.push({
      id: "accomplice",
      role: "accomplice",
      name: "Accomplice",
      color: "#eab308",
      start: { hidden: true }
    });
  }

  if (hasWitness) {
    actors.push({
      id: "witness",
      role: "witness",
      name: "Witness",
      color: "#a855f7",
      start: { at: "window_w", pose: "standing" }
    });
  }

  // 7. Chronological Events
  const events = [];

  if (victimEnters) {
    // Victim enters room first
    events.push({
      actor: "victim",
      action: "enter",
      target: victimEntryAnchor,
      pace: "walk",
      narrative: `Victim enters through the ${formatAnchorLabel(victimEntryAnchor)}`
    });
    // Victim walks towards center of room
    events.push({
      actor: "victim",
      action: "walk_to",
      target: "room_center",
      pace: "walk",
      narrative: "Victim walks towards the center of the room"
    });

    // Killer enters behind victim or from own entrance
    events.push({
      actor: "killer",
      action: "enter",
      target: killerEntryAnchor,
      pace: killerBehind ? "walk" : perpEnterPace,
      narrative: killerBehind
        ? `Perpetrator enters through the ${formatAnchorLabel(killerEntryAnchor)} behind the victim`
        : `Perpetrator enters through the ${formatAnchorLabel(killerEntryAnchor)}`
    });

    if (hasAccomplice) {
      events.push({
        actor: "accomplice",
        action: "enter",
        target: killerEntryAnchor,
        pace: perpEnterPace,
        narrative: `Accomplice enters through the ${formatAnchorLabel(killerEntryAnchor)}`
      });
    }

    // Killer approaches victim
    events.push({
      actor: "killer",
      action: "walk_to",
      target: "victim",
      pace: perpEnterPace === "sneak" ? "sneak" : "walk",
      narrative: "Perpetrator approaches the victim from behind"
    });

  } else {
    // Killer enters room where victim is already present
    events.push({
      actor: "killer",
      action: "enter",
      target: killerEntryAnchor,
      pace: perpEnterPace,
      narrative: `Perpetrator enters through the ${formatAnchorLabel(killerEntryAnchor)}`
    });

    if (hasAccomplice) {
      events.push({
        actor: "accomplice",
        action: "enter",
        target: killerEntryAnchor,
        pace: perpEnterPace,
        narrative: `Accomplice enters through the ${formatAnchorLabel(killerEntryAnchor)}`
      });
    }

    events.push({
      actor: "killer",
      action: "walk_to",
      target: "victim",
      pace: perpEnterPace === "sneak" ? "sneak" : "walk",
      narrative: "Perpetrator approaches the victim"
    });
  }

  // Aiming firearm check
  if (hasAim && weapon === "gun") {
    events.push({
      actor: "killer",
      action: "aim",
      target: "victim",
      weapon: "gun",
      narrative: "Perpetrator aims firearm at the victim"
    });
  }

  if (hasSurrender) {
    events.push({
      actor: "victim",
      action: "surrender",
      target: "killer",
      narrative: "Victim raises hands in surrender"
    });
  }

  if (hasStruggle) {
    events.push({
      actor: "victim",
      action: "defend",
      target: "killer",
      narrative: "Victim raises arms defensively"
    });
    events.push({
      actor: "killer",
      action: "struggle",
      target: "victim",
      narrative: "Perpetrator and victim struggle physically"
    });
  }

  // Attack event
  events.push({
    actor: "killer",
    action: "attack",
    target: "victim",
    style: attackStyle,
    weapon: weapon,
    narrative: `Perpetrator attacks victim with ${weapon ? weapon : "bare hands"} (${attackStyle})`
  });

  // Victim collapse
  const collapseStyle = (!victimEnters && victimPose === "sitting") ? "from_sit"
    : (attackStyle === "shoot" || attackStyle === "push" || attackStyle === "kick") ? "fall_backward"
      : "fall_forward";

  events.push({
    actor: "victim",
    action: "collapse",
    style: collapseStyle,
    narrative: `Victim collapses to the floor (${collapseStyle.replace("_", " ")})`
  });

  // Dropping weapon
  if (hasDropWeapon && weapon) {
    events.push({
      actor: "killer",
      action: "drop_weapon",
      weapon: weapon,
      narrative: `Perpetrator drops the ${weapon} at the scene`
    });
  }

  // Search / Loot
  if (hasSearch) {
    events.push({
      actor: "killer",
      action: "inspect",
      target: "victim",
      seconds: 2.0,
      narrative: "Perpetrator searches area and grabs evidence"
    });
  }

  // Exit
  events.push({
    actor: "killer",
    action: "leave",
    target: exitAnchor,
    pace: perpExitPace,
    same_path: Boolean(isSamePath),
    narrative: exitNarrative || `Perpetrator flees through the ${exitAnchor.replace("_", " ")}`
  });

  if (hasAccomplice) {
    events.push({
      actor: "accomplice",
      action: "leave",
      target: exitAnchor,
      pace: perpExitPace,
      same_path: Boolean(isSamePath),
      narrative: `Accomplice flees through the ${exitAnchor.replace("_", " ")}`
    });
  }

  const anchorsNeeded = [killerEntryAnchor, exitAnchor];
  if (victimEnters) anchorsNeeded.push(victimEntryAnchor);
  else anchorsNeeded.push(victimAnchor);

  return {
    actors,
    anchors_needed: Array.from(new Set(anchorsNeeded)),
    events
  };
}

/**
 * Main parser entry point: Tries Gemini if key available, falls back to rule-based engine.
 */
export async function parseCrimeScript(prompt, apiKey = null) {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (key) {
    try {
      const script = await parseWithGemini(prompt, key);
      return { script, source: "gemini" };
    } catch (err) {
      console.warn(`[Forensics] Gemini parsing failed: ${err.message}. Using rule-based engine.`);
    }
  }
  const script = ruleBasedParse(prompt);
  return { script, source: "rule_based" };
}

import { loadPhysicalSceneObjects, verifyTargetObject, CARDINAL_SECTORS } from "./scene_objects.js";

/**
 * Resolves 3D world anchors given room bounds and compass direction calibration.
 * Performs physical object verification against user-requested anchors across 8 cardinal sectors.
 */
export function resolveSceneAnchors(script, bounds = null, directionMeta = null, physicalObjectsOverride = null) {
  // Default bounds if none provided
  const min = bounds?.min || [-3.5, 0, -3.5];
  const max = bounds?.max || [3.5, 2.7, 3.5];
  const cx = bounds?.center?.[0] ?? (min[0] + max[0]) / 2;
  const cy = bounds?.center?.[1] ?? 0;
  const cz = bounds?.center?.[2] ?? (min[2] + max[2]) / 2;
  const center = [cx, cz];

  const spanX = Math.max(3.0, (max[0] - min[0]));
  const spanZ = Math.max(3.0, (max[2] - min[2]));
  const radius = Math.min(spanX, spanZ) * 0.46;

  // Calibration offset: northOffset aligns 3D world space with physical North
  const northOffset = directionMeta?.northOffset ?? directionMeta?.angle ?? 0;

  // 1. Load physical scene objects and label with 8 cardinal directions based on northOffset
  const physicalObjects = physicalObjectsOverride || loadPhysicalSceneObjects(null, { min, max, center, radius }, northOffset);

  const anchors = {};
  const verificationReport = {};

  // 2. Add all physical objects to the anchors dictionary with 8-direction badges
  for (const obj of physicalObjects) {
    anchors[obj.id] = {
      pos: obj.pos,
      y: obj.y ?? 0.02,
      inward: obj.inward || [0, 1],
      label: `${obj.label} [${obj.sector}]`,
      type: obj.type,
      sector: obj.sector,
      sectorLabel: obj.sectorLabel,
      verified: true,
      confidence: obj.confidence || 0.95
    };
  }

  // 3. Resolve and verify targets requested in the user's crime script
  const needed = new Set(script?.anchors_needed || []);
  for (const ev of script?.events || []) {
    if (ev.target && !script.actors?.some(a => a.id === ev.target)) {
      needed.add(ev.target);
    }
  }
  for (const act of script?.actors || []) {
    if (act.start?.at) needed.add(act.start.at);
  }

  for (const targetName of needed) {
    const verifiedResult = verifyTargetObject(targetName, physicalObjects, { min, max, center, radius }, northOffset);
    verificationReport[targetName] = verifiedResult;

    anchors[targetName] = {
      pos: verifiedResult.pos,
      y: verifiedResult.y ?? 0.02,
      inward: verifiedResult.inward,
      label: verifiedResult.label,
      type: verifiedResult.objectType,
      sector: verifiedResult.sector,
      sectorLabel: verifiedResult.sectorLabel,
      verified: verifiedResult.verified,
      status: verifiedResult.status,
      message: verifiedResult.message,
      confidence: verifiedResult.confidence
    };
  }

  // Ensure standard aliases (e.g. chair, door, window, center) point to verified objects
  const doorObj = physicalObjects.find(o => o.type === "door" || o.type === "entrance") || physicalObjects[0];
  if (doorObj && !anchors["door"]) {
    anchors["door"] = anchors[doorObj.id] || {
      pos: doorObj.pos,
      y: doorObj.y ?? 0.02,
      inward: doorObj.inward || [0, 1],
      label: doorObj.label,
      type: "door",
      sector: doorObj.sector,
      sectorLabel: doorObj.sectorLabel,
      verified: true
    };
  }
  const winObj = physicalObjects.find(o => o.type === "window");
  if (winObj && !anchors["window"]) {
    anchors["window"] = anchors[winObj.id] || {
      pos: winObj.pos,
      y: winObj.y ?? 0.02,
      inward: winObj.inward || [0, 1],
      label: winObj.label,
      type: "window",
      sector: winObj.sector,
      sectorLabel: winObj.sectorLabel,
      verified: true
    };
  }
  const chairObj = physicalObjects.find(o => o.type === "chair");
  if (chairObj) {
    if (!anchors["chair"]) {
      anchors["chair"] = anchors[chairObj.id] || {
        pos: chairObj.pos,
        y: chairObj.y ?? 0.02,
        inward: chairObj.inward || [0, 1],
        label: chairObj.label,
        type: "chair",
        sector: chairObj.sector,
        sectorLabel: chairObj.sectorLabel,
        verified: true
      };
    }
    if (!anchors["chair_center"]) anchors["chair_center"] = anchors[chairObj.id] || anchors["chair"];
  } else {
    const unverifiedChair = {
      pos: [Number(cx.toFixed(3)), Number(cz.toFixed(3))],
      y: 0.02,
      inward: [0, 1],
      label: "Room Center (No Chair Detected)",
      type: "center",
      sector: "Center",
      sectorLabel: "Center",
      verified: false,
      status: "object_not_found",
      message: "⚠️ No chair was detected in this room. Victim placed standing at room center.",
      confidence: 0.0
    };
    if (!anchors["chair"]) anchors["chair"] = unverifiedChair;
    if (!anchors["chair_center"]) anchors["chair_center"] = unverifiedChair;
  }

  // Ensure victim anchor is valid and strictly respect requested posture (standing, sitting, lying)
  for (const act of script?.actors || []) {
    if (act.role === "victim" && act.start) {
      const targetAnchor = act.start.at;
      if (targetAnchor && !anchors[targetAnchor]) {
        const fallbackChairKey = Object.keys(anchors).find(k => k === "chair_center" || k.startsWith("chair_")) || "chair";
        if (anchors[fallbackChairKey]) {
          act.start.at = fallbackChairKey;
        }
      }
      // If no pose was specified by the user or parser, provide a sensible default based on anchor
      if (!act.start.pose) {
        if (act.start.at && act.start.at.includes("bed")) {
          act.start.pose = "lying";
        } else if (act.start.at && (act.start.at.includes("chair") || act.start.at.includes("couch"))) {
          act.start.pose = "sitting";
        } else {
          act.start.pose = "standing";
        }
      }
    }
  }

  anchors["room_center"] = {
    pos: [Number(cx.toFixed(3)), Number(cz.toFixed(3))],
    inward: [0, 1],
    label: "Center",
    type: "center",
    sector: "Center",
    sectorLabel: "Center",
    verified: true
  };
  if (!anchors["center"]) anchors["center"] = anchors["room_center"];

  return {
    anchors,
    center,
    bounds: { min, max, radius },
    verificationReport,
    physicalObjects,
    northOffset
  };
}

/**
 * Yaw angle calculation from point A to point B
 */
function calcYaw(a, b) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  return Number(Math.atan2(dx, dz).toFixed(3));
}

function clampInsideRoom(pt, maxR = 5.0) {
  const r = Math.hypot(pt[0], pt[1]);
  if (r > maxR && r > 0.001) {
    return [Number(((pt[0] / r) * maxR).toFixed(3)), Number(((pt[1] / r) * maxR).toFixed(3))];
  }
  return [Number(pt[0].toFixed(3)), Number(pt[1].toFixed(3))];
}

/**
 * Generates timed 3D playback tracks, collision offsets, impact points, and captions.
 */
export function generateCrimePlan(script, anchors, bounds, center, grid = null, verificationReport = null, physicalObjects = null) {
  const actors = {};
  for (const a of script.actors) actors[a.id] = a;

  // Initialize clean NavGrid stamped with room bounds, doors, furniture, and physical obstacles
  let navGrid = grid;
  if (!navGrid) {
    navGrid = NavGrid.createSceneGrid(bounds, anchors, physicalObjects);
  }

  const tracks = {};
  const paths = {};
  const dist = {};
  const pos = {};
  const captions = [];
  const impacts = [];
  const ballistics = [];
  const droppedWeapons = [];
  const collapsed = new Set();

  const actorWeapons = {};
  for (const [aid, a] of Object.entries(actors)) {
    actorWeapons[aid] = a.weapon || (a.role === "perpetrator" ? "gun" : null);
  }

  for (const aid of Object.keys(actors)) {
    tracks[aid] = [];
    paths[aid] = [];
    dist[aid] = 0;
  }

  const clock = { t: 0.8 };
  const actorClocks = {};
  for (const aid of Object.keys(actors)) {
    actorClocks[aid] = 0.8;
  }

  // If victim enters first and killer enters behind, offset killer's entrance so killer enters behind
  const victimEntersOutside = script.events.some(e => e.actor === "victim" && e.action === "enter");
  const killerEntersOutside = script.events.some(e => (e.actor === "killer" || e.actor === "perpetrator") && e.action === "enter");
  if (victimEntersOutside && killerEntersOutside) {
    if (actorClocks["killer"] !== undefined) {
      actorClocks["killer"] = 1.8; // enters 1s behind victim
    }
  }

  function addSeg(aid, kind, t0, t1, from, to, yaw, extra = {}) {
    const trk = tracks[aid];
    if (trk && trk.length > 0) {
      const last = trk[trk.length - 1];
      if (t0 > last.t1 + 0.005) {
        const holdKind = (last.kind === "sit" || last.from_pose === "sit") ? "sit"
          : (last.kind === "lie" || last.from_pose === "lie" || last.kind === "sleep" || last.from_pose === "sleep") ? "lie"
          : (last.kind === "hidden" ? "hidden"
            : (last.kind === "collapse" ? "collapse" : "idle"));
        const holdFloorY = last.floor_y ?? (navGrid?.getFloorY ? navGrid.getFloorY(last.to[0], last.to[1]) : 0.02);
        trk.push({
          kind: holdKind,
          t0: Number(last.t1.toFixed(3)),
          t1: Number(t0.toFixed(3)),
          from: [Number(last.to[0].toFixed(3)), Number(last.to[1].toFixed(3))],
          to: [Number(last.to[0].toFixed(3)), Number(last.to[1].toFixed(3))],
          yaw: Number(last.yaw.toFixed(3)),
          weapon: (holdKind === "hidden" || holdKind === "collapse") ? null : actorWeapons[aid],
          from_pose: last.from_pose,
          collapse_style: last.collapse_style,
          floor_y: Number(holdFloorY.toFixed(3)),
          from_y: Number(holdFloorY.toFixed(3)),
          to_y: Number(holdFloorY.toFixed(3))
        });
      }
    }

    const segWeapon = extra.weapon !== undefined ? extra.weapon : actorWeapons[aid];
    const from_y = extra.from_y !== undefined ? extra.from_y : (navGrid?.getFloorY ? navGrid.getFloorY(from[0], from[1]) : 0.02);
    const to_y = extra.to_y !== undefined ? extra.to_y : (navGrid?.getFloorY ? navGrid.getFloorY(to[0], to[1]) : 0.02);
    const floor_y = extra.floor_y !== undefined ? extra.floor_y : from_y;

    tracks[aid].push({
      kind,
      t0: Number(t0.toFixed(3)),
      t1: Number(t1.toFixed(3)),
      from: [Number(from[0].toFixed(3)), Number(from[1].toFixed(3))],
      to: [Number(to[0].toFixed(3)), Number(to[1].toFixed(3))],
      yaw: Number(yaw.toFixed(3)),
      weapon: segWeapon,
      ...extra,
      from_y: Number(from_y.toFixed(3)),
      to_y: Number(to_y.toFixed(3)),
      floor_y: Number(floor_y.toFixed(3))
    });
  }

  function getAnchorPos(name) {
    if (anchors[name]) return anchors[name].pos;
    if (actors[name] && pos[name]) return pos[name];
    return center;
  }

  function walk(aid, from, to, pace = "walk", nav = true, startTime = null, customPts = null) {
    const spd = SPEEDS[pace] || SPEEDS.walk;
    const a = [Number(from[0]), Number(from[1])];
    const b = [Number(to[0]), Number(to[1])];
    const directD = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (directD < 0.03 && (!customPts || customPts.length < 2)) return;

    // Plan obstacle-avoiding route if nav is enabled and navGrid is available
    const pts = (customPts && customPts.length >= 2)
      ? customPts
      : ((navGrid && nav) ? navGrid.path(a, b) : [a, b]);

    // Save polyline with 3D elevation for dashed route visualization
    const ptsWithElevation = pts.map(p => {
      const flrY = navGrid?.getFloorY ? navGrid.getFloorY(p[0], p[1]) : 0.02;
      return [p[0], p[1], Number(flrY.toFixed(3))];
    });
    paths[aid].push(ptsWithElevation);

    let tCur = startTime !== null ? startTime : (actorClocks[aid] ?? clock.t);

    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i];
      const q = pts[i + 1];
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d < 0.02) continue;

      const dur = Math.max(0.2, d / spd);
      const yaw = calcYaw(p, q);

      const fromY = navGrid?.getFloorY ? navGrid.getFloorY(p[0], p[1]) : 0.02;
      const toY = navGrid?.getFloorY ? navGrid.getFloorY(q[0], q[1]) : 0.02;

      addSeg(aid, "walk", tCur, tCur + dur, p, q, yaw, {
        length: Number(d.toFixed(3)),
        dist0: Number(dist[aid].toFixed(3)),
        pace,
        weapon: actorWeapons[aid],
        from_y: fromY,
        to_y: toY,
        floor_y: fromY
      });

      tCur += dur;
      dist[aid] += d;
    }

    pos[aid] = pts[pts.length - 1];
    actorClocks[aid] = tCur;
    clock.t = Math.max(clock.t, tCur);
  }

  // 1. Initial Actor Placements
  for (const [aid, a] of Object.entries(actors)) {
    const start = a.start || {};
    if (start.at && anchors[start.at]) {
      const anc = anchors[start.at];
      const rawPose = (start.pose || "").toLowerCase();
      const isSit = rawPose === "sitting" || rawPose === "sit";
      const isLie = rawPose === "lying" || rawPose === "sleep" || rawPose === "lie" || rawPose === "asleep";
      const initialPose = isSit ? "sit" : (isLie ? "lie" : "idle");

      // If standing or lying near a chair, offset slightly inward so mannequin doesn't intersect chair mesh
      let p = anc.pos;
      if (!isSit && anc.type === "chair" && anc.inward) {
        p = [
          Number((anc.pos[0] + anc.inward[0] * 0.35).toFixed(3)),
          Number((anc.pos[1] + anc.inward[1] * 0.35).toFixed(3))
        ];
      }
      pos[aid] = p;

      const startYaw = (isSit && anc?.inward)
        ? Math.atan2(anc.inward[0], anc.inward[1])
        : calcYaw(p, center);
      const flrY = anc?.y ?? (navGrid?.getFloorY ? navGrid.getFloorY(p[0], p[1]) : 0.02);
      addSeg(aid, initialPose, 0, clock.t, p, p, startYaw, {
        weapon: actorWeapons[aid],
        floor_y: flrY,
        from_y: flrY,
        to_y: flrY,
        from_pose: initialPose
      });
    } else {
      pos[aid] = null;
      addSeg(aid, "hidden", 0, clock.t, [0, 0], [0, 0], 0, { weapon: null, floor_y: 0.02, from_y: 0.02, to_y: 0.02, from_pose: "hidden" });
    }
  }

  // 2. Process Chronological Events
  for (const ev of script.events) {
    const aid = ev.actor;
    const act = ev.action;
    const tgt = ev.target;
    const role = actors[aid]?.role || "actor";
    const pace = ev.pace || "walk";
    const t = clock.t;

    if (act === "enter") {
      const anc = anchors[tgt] || anchors["door"] || Object.values(anchors).find(a => a.type === "door") || Object.values(anchors)[0];
      const p = anc.pos;
      const inw = anc.inward;
      // Start at doorway portal threshold, step cleanly inside room (past door frame, clear of entrance chairs)
      const threshold = [Number((p[0] - inw[0] * 0.05).toFixed(3)), Number((p[1] - inw[1] * 0.05).toFixed(3))];
      const inside = [Number((p[0] + inw[0] * 0.20).toFixed(3)), Number((p[1] + inw[1] * 0.20).toFixed(3))];

      const startT = actorClocks[aid] ?? clock.t;
      captions.push({ t: Number(startT.toFixed(2)), text: ev.narrative || `The ${role} enters through the ${tgt.replace("_", " ")}` });
      pos[aid] = threshold;
      walk(aid, threshold, inside, pace, false, startT);

    } else if (act === "walk_to" || act === "run_to" || act === "sneak_to") {
      const tp = getAnchorPos(tgt);
      const cur = pos[aid] || [0, 0];
      const isGun = actorWeapons[aid] === "gun" || ev.weapon === "gun";

      let stopPos;
      const victimChair = Object.values(anchors).find(
        (a) => a.type === "chair" && Math.hypot(a.pos[0] - tp[0], a.pos[1] - tp[1]) < 0.45
      );

      if (actors[tgt] && victimChair && victimChair.inward) {
        // When approaching a victim sitting on or positioned at a chair:
        // The attacker must stop in front of the victim along the chair's inward facing direction
        const standOff = isGun ? 1.4 : 0.65;
        const frontPos = [
          victimChair.pos[0] + victimChair.inward[0] * standOff,
          victimChair.pos[1] + victimChair.inward[1] * standOff
        ];
        stopPos = navGrid ? navGrid.getFreePosition(frontPos) : frontPos;
      } else {
        const dx = cur[0] - tp[0];
        const dz = cur[1] - tp[1];
        const len = Math.hypot(dx, dz) || 1;
        const standOff = actors[tgt] ? (isGun ? 1.85 : 0.8) : 0.35;
        const candidatePos = [tp[0] + (dx / len) * standOff, tp[1] + (dz / len) * standOff];
        stopPos = navGrid ? navGrid.getFreePosition(candidatePos) : candidatePos;
      }

      const startT = actorClocks[aid] ?? clock.t;
      captions.push({ t: Number(startT.toFixed(2)), text: ev.narrative || `The ${role} approaches the ${tgt}` });
      walk(aid, cur, stopPos, act.includes("run") ? "run" : act.includes("sneak") ? "sneak" : pace, true, startT);

    } else if (act === "aim") {
      const tp = getAnchorPos(tgt);
      const cur = pos[aid] || tp;
      const yaw = calcYaw(cur, tp);
      const wep = ev.weapon || actorWeapons[aid] || "gun";
      const startT = actorClocks[aid] ?? clock.t;
      captions.push({ t: Number(startT.toFixed(2)), text: ev.narrative || `The ${role} aims firearm at ${tgt}` });
      addSeg(aid, "aim", startT, startT + 1.4, cur, cur, yaw, { weapon: wep });
      actorClocks[aid] = startT + 1.4;
      clock.t = Math.max(clock.t, actorClocks[aid]);

    } else if (act === "surrender") {
      const tp = getAnchorPos(tgt);
      const cur = pos[aid] || tp;
      const yaw = calcYaw(cur, tp);
      const startT = actorClocks[aid] ?? clock.t;
      captions.push({ t: Number(startT.toFixed(2)), text: ev.narrative || `The ${role} raises hands in surrender` });
      addSeg(aid, "surrender", startT, startT + 1.4, cur, cur, yaw, { weapon: null });
      actorClocks[aid] = startT + 1.4;
      clock.t = Math.max(clock.t, actorClocks[aid]);

    } else if (act === "attack") {
      const tp = getAnchorPos(tgt);
      const cur = pos[aid] || tp;
      const yaw = calcYaw(cur, tp);
      const style = ev.style || "strike";
      const wep = ev.weapon || actorWeapons[aid] || (style === "shoot" ? "gun" : (style === "strike" ? "bat" : (style === "stab" || style === "slash" ? "knife" : null)));
      const dur = style === "shoot" ? 1.4 : (style === "strangle" ? 2.2 : (style === "strike" ? 1.6 : 1.4));

      // Synchronize attack time so attacker and victim are both in position
      const tAttack = Math.max(actorClocks[aid] || clock.t, actorClocks[tgt] || clock.t);

      captions.push({ t: Number(tAttack.toFixed(2)), text: ev.narrative || `The ${role} attacks the ${tgt} (${style})` });

      // Attacker animation
      addSeg(aid, "attack", tAttack, tAttack + dur, cur, cur, yaw, { style, weapon: wep });

      // Impact shockwave & ballistics
      const impactTime = tAttack + (style === "shoot" ? 0.38 : (style === "strangle" ? 1.2 : 0.65));
      impacts.push({
        t: Number(impactTime.toFixed(3)),
        pos: [Number(tp[0].toFixed(3)), 1.15, Number(tp[1].toFixed(3))],
        style
      });

      if (style === "shoot") {
        ballistics.push({
          id: `shot_${ballistics.length + 1}`,
          shooterId: aid,
          victimId: tgt,
          tShoot: Number(impactTime.toFixed(3)),
          duration: 0.25,
          from: [Number(cur[0].toFixed(3)), 1.35, Number(cur[1].toFixed(3))],
          to: [Number(tp[0].toFixed(3)), 1.15, Number(tp[1].toFixed(3))]
        });
      }

      if (style === "strangle" && actors[tgt]) {
        addSeg(tgt, "struggle", tAttack, tAttack + dur, tp, tp, calcYaw(tp, cur));
      }

      // Victim collapse if not already collapsed
      if (actors[tgt] && !collapsed.has(tgt)) {
        const victimLast = tracks[tgt]?.[tracks[tgt].length - 1];
        const fromPose = (victimLast?.kind === "sit" || victimLast?.from_pose === "sit") ? "sit"
          : (victimLast?.kind === "lie" || victimLast?.from_pose === "lie" || victimLast?.kind === "sleep" || victimLast?.from_pose === "sleep") ? "lie"
          : "stand";
        const collStyle = fromPose === "sit" ? "from_sit"
          : fromPose === "lie" ? "from_lie"
          : (style === "shoot" || style === "push" || style === "kick" ? "fall_backward" : "fall_forward");
        const victimFloorY = victimLast?.floor_y ?? (navGrid?.getFloorY ? navGrid.getFloorY(tp[0], tp[1]) : 0.02);

        addSeg(tgt, "collapse", impactTime, impactTime + 1.4, tp, tp, victimLast?.yaw || 0, {
          from_pose: fromPose,
          collapse_style: collStyle,
          floor_y: victimFloorY,
          from_y: victimFloorY,
          to_y: victimFloorY
        });
        collapsed.add(tgt);
        actorClocks[tgt] = impactTime + 1.4;
      }

      actorClocks[aid] = tAttack + dur + 0.4;
      clock.t = Math.max(clock.t, actorClocks[aid]);

    } else if (act === "defend") {
      const tp = getAnchorPos(tgt);
      const cur = pos[aid] || tp;
      const yaw = calcYaw(cur, tp);
      const startT = actorClocks[aid] ?? clock.t;
      captions.push({ t: Number(startT.toFixed(2)), text: ev.narrative || `The ${role} defends themselves` });
      addSeg(aid, "defend", startT, startT + 1.5, cur, cur, yaw);
      actorClocks[aid] = startT + 1.5;
      clock.t = Math.max(clock.t, actorClocks[aid]);

    } else if (act === "struggle") {
      const tp = getAnchorPos(tgt);
      const cur = pos[aid] || tp;
      const yaw = calcYaw(cur, tp);
      const startT = Math.max(actorClocks[aid] || clock.t, actorClocks[tgt] || clock.t);
      captions.push({ t: Number(startT.toFixed(2)), text: ev.narrative || `The ${role} struggles with ${tgt}` });
      addSeg(aid, "struggle", startT, startT + 2.0, cur, cur, yaw);
      if (actors[tgt]) {
        addSeg(tgt, "struggle", startT, startT + 2.0, tp, tp, calcYaw(tp, cur));
        actorClocks[tgt] = startT + 2.0;
      }
      actorClocks[aid] = startT + 2.0;
      clock.t = Math.max(clock.t, startT + 2.0);

    } else if (act === "collapse") {
      if (!collapsed.has(aid)) {
        const cur = pos[aid] || center;
        const victimLast = tracks[aid]?.[tracks[aid].length - 1];
        const fromPose = (victimLast?.kind === "sit" || victimLast?.from_pose === "sit") ? "sit"
          : (victimLast?.kind === "lie" || victimLast?.from_pose === "lie" || victimLast?.kind === "sleep" || victimLast?.from_pose === "sleep") ? "lie"
          : "stand";
        const collStyle = ev.style || (fromPose === "sit" ? "from_sit" : fromPose === "lie" ? "from_lie" : "fall_forward");
        const startT = actorClocks[aid] ?? clock.t;
        const victimFloorY = victimLast?.floor_y ?? (navGrid?.getFloorY ? navGrid.getFloorY(cur[0], cur[1]) : 0.02);
        addSeg(aid, "collapse", startT, startT + 1.4, cur, cur, victimLast?.yaw || 0, {
          from_pose: fromPose,
          collapse_style: collStyle,
          floor_y: victimFloorY,
          from_y: victimFloorY,
          to_y: victimFloorY
        });
        impacts.push({
          t: Number(startT.toFixed(3)),
          pos: [Number(cur[0].toFixed(3)), 0.5, Number(cur[1].toFixed(3))],
          style: "fall"
        });
        collapsed.add(aid);
        actorClocks[aid] = startT + 1.4;
        clock.t = Math.max(clock.t, actorClocks[aid]);
      }

    } else if (act === "drop_weapon") {
      const cur = pos[aid] || center;
      const droppedWep = ev.weapon || actorWeapons[aid] || "bat";
      actorWeapons[aid] = null;
      const startT = actorClocks[aid] ?? clock.t;
      captions.push({ t: Number(startT.toFixed(2)), text: ev.narrative || `The ${role} drops the ${droppedWep} at the scene` });
      addSeg(aid, "idle", startT, startT + 0.8, cur, cur, tracks[aid]?.[tracks[aid].length - 1]?.yaw || 0, { weapon: null });
      const flrY = navGrid?.getFloorY ? navGrid.getFloorY(cur[0], cur[1]) : 0.02;
      droppedWeapons.push({
        id: `ev_${droppedWeapons.length + 1}`,
        weapon: droppedWep,
        pos: [Number(cur[0].toFixed(3)), Number(cur[1].toFixed(3))],
        y: Number(flrY.toFixed(3)),
        yaw: Number((tracks[aid]?.[tracks[aid].length - 1]?.yaw || 0).toFixed(3)),
        t: Number((startT + 0.35).toFixed(3)),
        evidenceNum: droppedWeapons.length + 1
      });
      actorClocks[aid] = startT + 0.8;
      clock.t = Math.max(clock.t, actorClocks[aid]);

    } else if (act === "inspect" || act === "search" || act === "grab") {
      const cur = pos[aid] || center;
      const sec = ev.seconds || 1.8;
      const startT = actorClocks[aid] ?? clock.t;
      captions.push({ t: Number(startT.toFixed(2)), text: ev.narrative || `The ${role} searches the area` });
      addSeg(aid, "inspect", startT, startT + sec, cur, cur, tracks[aid]?.[tracks[aid].length - 1]?.yaw || 0, { weapon: "bag" });
      actorClocks[aid] = startT + sec;
      clock.t = Math.max(clock.t, actorClocks[aid]);

    } else if (act === "leave" || act === "flee") {
      const anc = anchors[tgt] || anchors["door"] || Object.values(anchors).find(a => a.type === "door") || Object.values(anchors)[0];
      const p = anc.pos;
      const inw = anc.inward;
      const cur = pos[aid] || center;
      const threshold = [Number((p[0] - inw[0] * 0.05).toFixed(3)), Number((p[1] - inw[1] * 0.05).toFixed(3))];
      const insideDoor = [Number((p[0] + inw[0] * 0.20).toFixed(3)), Number((p[1] + inw[1] * 0.20).toFixed(3))];

      const startT = actorClocks[aid] ?? clock.t;
      captions.push({ t: Number(startT.toFixed(2)), text: ev.narrative || `The ${role} flees through the ${tgt.replace("_", " ")}` });

      // Check if user requested fleeing via same path / retracing route
      const retraceSamePath = Boolean(ev.same_path || ev.narrative?.toLowerCase().includes("same path") || ev.narrative?.toLowerCase().includes("same way") || ev.narrative?.toLowerCase().includes("retrace"));

      if (retraceSamePath && paths[aid] && paths[aid].length > 0) {
        // Collect all previously traversed inbound waypoints in chronological order
        const fullInbound = [];
        for (const seg of paths[aid]) {
          for (const rawPt of seg) {
            const pt = [Number(rawPt[0].toFixed(3)), Number(rawPt[1].toFixed(3))];
            if (fullInbound.length === 0 || Math.hypot(pt[0] - fullInbound[fullInbound.length - 1][0], pt[1] - fullInbound[fullInbound.length - 1][1]) > 0.05) {
              fullInbound.push(pt);
            }
          }
        }
        // Retrace in reverse: from current position back through all waypoints to inside the entry door
        const returnPts = fullInbound.slice().reverse();
        // Ensure starting point is current position
        if (returnPts.length > 0 && Math.hypot(cur[0] - returnPts[0][0], cur[1] - returnPts[0][1]) > 0.05) {
          returnPts.unshift(cur);
        }
        // Ensure final point reaches threshold
        const lastPt = returnPts[returnPts.length - 1];
        if (Math.hypot(threshold[0] - lastPt[0], threshold[1] - lastPt[1]) > 0.1) {
          returnPts.push(threshold);
        }

        walk(aid, cur, threshold, pace, false, startT, returnPts);
      } else {
        // Retreat from current position around obstacles directly to inside the door
        walk(aid, cur, insideDoor, pace, true, startT);
        // Step cleanly to the door threshold
        walk(aid, insideDoor, threshold, pace, false, actorClocks[aid]);
      }

      // Actor exits through the door and vanishes at the doorway threshold (inside room boundary)
      const exitFloorY = navGrid?.getFloorY ? navGrid.getFloorY(threshold[0], threshold[1]) : 0.02;
      addSeg(aid, "hidden", actorClocks[aid], actorClocks[aid] + 2.0, threshold, threshold, 0, { weapon: null, floor_y: exitFloorY, from_y: exitFloorY, to_y: exitFloorY });
      actorClocks[aid] += 2.0;
      clock.t = Math.max(clock.t, actorClocks[aid]);

    } else if (act === "wait" || act === "idle") {
      const cur = pos[aid] || center;
      const sec = ev.seconds || 1.2;
      const startT = actorClocks[aid] ?? clock.t;
      addSeg(aid, "idle", startT, startT + sec, cur, cur, tracks[aid]?.[tracks[aid].length - 1]?.yaw || 0);
      actorClocks[aid] = startT + sec;
      clock.t = Math.max(clock.t, actorClocks[aid]);
    }
  }

  // Align ending of all active tracks
  const totalDuration = Number((clock.t + 1.5).toFixed(2));
  for (const [aid, trk] of Object.entries(tracks)) {
    if (trk.length > 0) {
      const last = trk[trk.length - 1];
      if (last.t1 < totalDuration) {
        if (last.kind === "collapse") {
          addSeg(aid, "collapse", last.t1, totalDuration, last.to, last.to, last.yaw, {
            from_pose: last.from_pose,
            collapse_style: last.collapse_style,
            final: true,
            weapon: null,
            floor_y: last.floor_y,
            from_y: last.floor_y,
            to_y: last.floor_y
          });
        } else if (last.kind === "hidden") {
          addSeg(aid, "hidden", last.t1, totalDuration, last.to, last.to, 0, { weapon: null, floor_y: last.floor_y, from_y: last.floor_y, to_y: last.floor_y });
        } else if (last.kind === "sit" || last.from_pose === "sit") {
          addSeg(aid, "sit", last.t1, totalDuration, last.to, last.to, last.yaw, { weapon: actorWeapons[aid], floor_y: last.floor_y, from_y: last.floor_y, to_y: last.floor_y, from_pose: "sit" });
        } else if (last.kind === "lie" || last.from_pose === "lie" || last.kind === "sleep" || last.from_pose === "sleep") {
          addSeg(aid, "lie", last.t1, totalDuration, last.to, last.to, last.yaw, { weapon: actorWeapons[aid], floor_y: last.floor_y, from_y: last.floor_y, to_y: last.floor_y, from_pose: "lie" });
        } else {
          addSeg(aid, "idle", last.t1, totalDuration, last.to, last.to, last.yaw, { weapon: actorWeapons[aid], floor_y: last.floor_y, from_y: last.floor_y, to_y: last.floor_y, from_pose: "idle" });
        }
      }
    }
  }

  captions.sort((a, b) => a.t - b.t);

  return {
    duration: totalDuration,
    tracks,
    paths,
    captions,
    impacts,
    ballistics,
    droppedWeapons,
    roles: Object.fromEntries(Object.entries(actors).map(([id, a]) => [id, a.role])),
    actors,
    verificationReport: verificationReport || {},
    physicalObjects: physicalObjects || []
  };
}
