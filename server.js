import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import cors from "cors";
import { parseCrimeScript, resolveSceneAnchors, generateCrimePlan } from "./crime_planner.js";
import { loadPhysicalSceneObjects } from "./scene_objects.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3001;

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

// Serve generated models statically
app.use("/models", express.static(path.join(__dirname, "frontend/public/models")));
app.use("/reference", express.static(path.join(__dirname, "input/reference")));
app.use("/input/images", express.static(path.join(__dirname, "input/images")));

// List uploaded scene photos for threat detection pipeline
app.get("/api/scene/images", (req, res) => {
  const dir = path.join(__dirname, "input", "images");
  if (!fs.existsSync(dir)) return res.json({ images: [] });
  const files = fs.readdirSync(dir).filter(f => /\.(jpe?g|png|webp|bmp|tiff?)$/i.test(f));
  res.json({
    images: files.map(f => ({
      name: f,
      url: `/input/images/${f}`
    }))
  });
});

// Ensure threat detection backend is running on port 8000
function ensureThreatBackend() {
  const threatDir = path.join(__dirname, "threat_backend");
  const venvPy = path.join(threatDir, "venv", "bin", "python");
  if (fs.existsSync(venvPy) && fs.existsSync(threatDir)) {
    fetch("http://127.0.0.1:8000/api/health")
      .catch(() => {
        console.log("[ThreatBackend] Spawning self-contained threat backend on port 8000...");
        spawn(venvPy, ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000"], {
          cwd: threatDir,
          detached: true,
          stdio: "ignore"
        }).unref();
      });
  }
}
ensureThreatBackend();

// Threat detection proxy endpoint
const memoryUpload = multer({ storage: multer.memoryStorage() });
app.post("/api/analyze", memoryUpload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ detail: "No file provided" });
    }
    const form = new FormData();
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype || "image/jpeg" });
    form.append("file", blob, req.file.originalname);

    const backendRes = await fetch("http://127.0.0.1:8000/api/analyze", {
      method: "POST",
      body: form,
    });
    const data = await backendRes.json();
    return res.status(backendRes.status).json(data);
  } catch (err) {
    console.error("Proxy error /api/analyze:", err);
    return res.status(502).json({ detail: "Threat detection backend unreachable", error: err.message });
  }
});

// Upload storage – scene images → input/images, reference → input/reference
const inputDir = path.join(__dirname, "input", "images");
const refDir   = path.join(__dirname, "input", "reference");
const outputDir = path.join(__dirname, "output");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === "referenceImage") {
      fs.mkdirSync(refDir, { recursive: true });
      cb(null, refDir);
    } else {
      fs.mkdirSync(inputDir, { recursive: true });
      cb(null, inputDir);
    }
  },
  filename: (req, file, cb) => cb(null, file.originalname),
});
const upload = multer({ storage });

// Keep track of active SSE clients and reconstruction state
let sseClients = [];
let lastStatus = { phase: "idle", log: "", progress: 0, done: false, error: null };

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((res) => res.write(msg));
}

// Thoroughly clean up earlier models, textures, colmap/openmvs runs, and inputs
function cleanupPreviousModels() {
  try {
    // 1. Clean frontend/public/models (except dummy avatar)
    const publicModelsDir = path.join(__dirname, "frontend", "public", "models");
    if (fs.existsSync(publicModelsDir)) {
      const files = fs.readdirSync(publicModelsDir);
      for (const f of files) {
        if (f.startsWith("scene_textured")) {
          try { fs.unlinkSync(path.join(publicModelsDir, f)); } catch (_) {}
        }
      }
    }

    // 2. Clean frontend/dist/models (if built)
    const distModelsDir = path.join(__dirname, "frontend", "dist", "models");
    if (fs.existsSync(distModelsDir)) {
      const files = fs.readdirSync(distModelsDir);
      for (const f of files) {
        if (f.startsWith("scene_textured")) {
          try { fs.unlinkSync(path.join(distModelsDir, f)); } catch (_) {}
        }
      }
    }

    // 3. Clean input directories
    for (const dir of [inputDir, refDir]) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // 4. Clean output directory (colmap, openmvs, all json files)
    if (fs.existsSync(outputDir)) {
      const outFiles = fs.readdirSync(outputDir);
      for (const f of outFiles) {
        const p = path.join(outputDir, f);
        try {
          fs.rmSync(p, { recursive: true, force: true });
        } catch (_) {}
      }
      fs.mkdirSync(outputDir, { recursive: true });
    }

    lastStatus = { phase: "idle", log: "", progress: 0, done: false, error: null };
    broadcast(lastStatus);
    console.log("[Cleanup] Previous models, textures, and artifacts cleaned up successfully.");
  } catch (err) {
    console.error("[Cleanup] Error cleaning previous models:", err);
  }
}

// SSE endpoint – frontend connects here to receive live logs
app.get("/api/status", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Send current state immediately on connect
  res.write(`data: ${JSON.stringify(lastStatus)}\n\n`);
  sseClients.push(res);

  req.on("close", () => {
    sseClients = sseClients.filter((c) => c !== res);
  });
});

// Upload endpoint – accepts scene images + optional referenceImage + direction
app.post("/api/upload",
  upload.fields([
    { name: "images",         maxCount: 500 },
    { name: "referenceImage", maxCount: 1   },
  ]),
  (req, res) => {
    const sceneFiles = req.files["images"] || [];
    const refFiles   = req.files["referenceImage"] || [];
    const direction  = req.body.direction || "N";

    if (sceneFiles.length === 0) {
      return res.status(400).json({ error: "No scene images uploaded" });
    }

    const metaPath = path.join(outputDir, "direction.json");
    let existingMeta = {};
    if (fs.existsSync(metaPath)) {
      try { existingMeta = JSON.parse(fs.readFileSync(metaPath, "utf8")); } catch (_) {}
    }

    const refImageName = refFiles[0]?.originalname || existingMeta.referenceImage || (sceneFiles[0]?.originalname ?? null);

    // Persist direction metadata without destroying existing calibration
    const meta = {
      ...existingMeta,
      direction,
      referenceImage: refImageName,
      timestamp: new Date().toISOString(),
    };

    if (meta.northOffset === undefined) {
      meta.angle = { N:0,NE:45,E:90,SE:135,S:180,SW:225,W:270,NW:315 }[direction] ?? 0;
    }

    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    // If COLMAP sparse reconstruction exists, run calibration immediately
    const colmapDir = path.join(outputDir, "colmap", "sparse", "0");
    if (fs.existsSync(colmapDir) && refImageName) {
      const uvPath = "/Users/mohammadmojijansari/.local/bin/uv";
      const pythonCmd = fs.existsSync(uvPath) ? uvPath : "python3";
      const scriptPath = path.join(__dirname, "scripts", "calibrate_direction.py");
      const py = spawn(pythonCmd, ["run", "--with", "pycolmap", "python3", scriptPath, refImageName, direction], { cwd: __dirname });
      py.on("close", () => {
        console.log(`[Upload] Auto-calibrated direction for ${refImageName} facing ${direction}`);
      });
    }

    res.json({
      sceneCount: sceneFiles.length,
      referenceImage: refImageName,
      direction,
      message: `${sceneFiles.length} scene images + direction "${direction}" saved`,
    });
  }
);

// Direction metadata endpoint
app.get("/api/direction", (req, res) => {
  const metaPath = path.join(outputDir, "direction.json");
  if (!fs.existsSync(metaPath)) {
    return res.status(404).json({ error: "No direction metadata found" });
  }
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    if (meta.referenceImage) {
      const refFileOnDisk = path.join(refDir, meta.referenceImage);
      const inputFileOnDisk = path.join(inputDir, meta.referenceImage);
      if (fs.existsSync(refFileOnDisk) || fs.existsSync(inputFileOnDisk)) {
        meta.referenceImageUrl = `/reference/${meta.referenceImage}`;
      }
    }
    res.json(meta);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Calibrate direction from reference photo or manual compass azimuth
app.post("/api/direction/calibrate", (req, res) => {
  try {
    const { referenceImage, direction, northOffset } = req.body;
    const metaPath = path.join(outputDir, "direction.json");
    let dirMeta = {};
    if (fs.existsSync(metaPath)) {
      try { dirMeta = JSON.parse(fs.readFileSync(metaPath, "utf8")); } catch (_) {}
    }
    if (direction) dirMeta.direction = direction;
    if (referenceImage) dirMeta.referenceImage = referenceImage;
    if (northOffset !== undefined) {
      dirMeta.northOffset = Number(northOffset);
      dirMeta.angle = Number(northOffset);
      dirMeta.calibrated = true;
      dirMeta.timestamp = new Date().toISOString();
      fs.writeFileSync(metaPath, JSON.stringify(dirMeta, null, 2));
      return res.json(dirMeta);
    }
    // Run python camera pose calibrator
    const uvPath = "/Users/mohammadmojijansari/.local/bin/uv";
    const pythonCmd = fs.existsSync(uvPath) ? uvPath : "python3";
    const scriptPath = path.join(__dirname, "scripts", "calibrate_direction.py");
    const detectPath = path.join(__dirname, "scripts", "detect_scene_objects.py");
    const py = spawn(pythonCmd, ["run", "--with", "pycolmap", "python3", scriptPath, dirMeta.referenceImage || "", dirMeta.direction || "N"], { cwd: __dirname });
    py.on("close", () => {
      // Refresh dynamic scene objects with new northOffset
      if (fs.existsSync(detectPath)) {
        const detectPy = spawn(pythonCmd, ["run", "--with", "pycolmap", "--with", "trimesh", "--with", "scipy", "python3", detectPath], { cwd: __dirname });
        detectPy.on("close", () => {
          let updated = dirMeta;
          if (fs.existsSync(metaPath)) {
            try { updated = JSON.parse(fs.readFileSync(metaPath, "utf8")); } catch (_) {}
          }
          res.json(updated);
        });
      } else {
        let updated = dirMeta;
        if (fs.existsSync(metaPath)) {
          try { updated = JSON.parse(fs.readFileSync(metaPath, "utf8")); } catch (_) {}
        }
        res.json(updated);
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Scene physical objects & 8-direction labels endpoint
app.get("/api/scene/objects", (req, res) => {
  try {
    const dirPath = path.join(outputDir, "direction.json");
    let dirMeta = {};
    if (fs.existsSync(dirPath)) {
      try { dirMeta = JSON.parse(fs.readFileSync(dirPath, "utf8")); } catch (_) {}
    }
    const northOffset = dirMeta.northOffset ?? dirMeta.angle ?? 0;
    const objects = loadPhysicalSceneObjects(null, null, northOffset);
    res.json({ objects, northOffset, direction: dirMeta.direction || "N" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 3D Mesh Enhancement & Artifact Purge Endpoint ─────────────────────
app.post("/api/mesh/enhance", (req, res) => {
  try {
    const uvPath = "/Users/mohammadmojijansari/.local/bin/uv";
    const pythonCmd = fs.existsSync(uvPath) ? uvPath : "python3";
    const scriptPath = path.join(__dirname, "scripts", "enhance_mesh.py");
    const glbPath = path.join(__dirname, "frontend", "public", "models", "scene_textured.glb");

    const py = spawn(pythonCmd, ["run", "--with", "scipy", "--with", "numpy", "--with", "pillow", "--with", "trimesh", "--with", "networkx", "python3", scriptPath, glbPath], {
      cwd: __dirname
    });

    let stdout = "";
    let stderr = "";
    py.stdout.on("data", (d) => stdout += d.toString());
    py.stderr.on("data", (d) => stderr += d.toString());

    py.on("close", (code) => {
      if (code !== 0) {
        return res.status(500).json({ error: `Mesh enhancement failed: ${stderr}` });
      }

      // Automatically detect room boundaries and regenerate navgrid + scene objects for the enhanced mesh
      const detectPath = path.join(__dirname, "scripts", "detect_scene_objects.py");
      if (fs.existsSync(detectPath)) {
        spawn(pythonCmd, ["run", "--with", "pycolmap", "--with", "trimesh", "--with", "scipy", "python3", detectPath], { cwd: __dirname });
      }

      try {
        // Find last json output
        const lines = stdout.trim().split("\n");
        const jsonStart = lines.findIndex(l => l.trim().startsWith("{"));
        const report = jsonStart >= 0 ? JSON.parse(lines.slice(jsonStart).join("\n")) : { success: true };
        res.json({ success: true, report });
      } catch (_) {
        res.json({ success: true, stdout });
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reconstruct endpoint – runs reconstruct.py and streams output
app.post("/api/reconstruct", (req, res) => {
  // Purge any earlier models before building new mesh
  const publicModelsDir = path.join(__dirname, "frontend", "public", "models");
  if (fs.existsSync(publicModelsDir)) {
    for (const f of fs.readdirSync(publicModelsDir)) {
      if (f.startsWith("scene_textured")) {
        try { fs.unlinkSync(path.join(publicModelsDir, f)); } catch (_) {}
      }
    }
  }
  const distModelsDir = path.join(__dirname, "frontend", "dist", "models");
  if (fs.existsSync(distModelsDir)) {
    for (const f of fs.readdirSync(distModelsDir)) {
      if (f.startsWith("scene_textured")) {
        try { fs.unlinkSync(path.join(distModelsDir, f)); } catch (_) {}
      }
    }
  }

  lastStatus = { phase: "starting", log: "Starting reconstruction…", progress: 0, done: false, error: null };
  broadcast(lastStatus);

  res.json({ message: "Reconstruction started" });

  const uvPath = "/Users/mohammadmojijansari/.local/bin/uv";
  const pythonCmd = fs.existsSync(uvPath) ? uvPath : "python3";
  const pythonArgs = fs.existsSync(uvPath)
    ? ["run", "--with", "numpy", "--with", "pillow", "--with", "trimesh", "--with", "pycolmap", "python3", path.join(__dirname, "reconstruct.py")]
    : [path.join(__dirname, "reconstruct.py")];

  const python = spawn(pythonCmd, pythonArgs, {
    cwd: __dirname,
  });

  const PHASES = [
    { match: "feature_extractor", label: "Extracting features", progress: 10 },
    { match: "exhaustive_matcher", label: "Matching features", progress: 20 },
    { match: "mapper", label: "Sparse reconstruction (COLMAP)", progress: 35 },
    { match: "image_undistorter", label: "Undistorting images", progress: 45 },
    { match: "InterfaceCOLMAP", label: "Interfacing COLMAP → OpenMVS", progress: 55 },
    { match: "DensifyPointCloud", label: "Densifying point cloud", progress: 68 },
    { match: "ReconstructMesh", label: "Reconstructing mesh", progress: 80 },
    { match: "TextureMesh", label: "Texturing mesh", progress: 90 },
    { match: "enhance_mesh", label: "Predicting & smoothing room geometry", progress: 96 },
    { match: "DONE", label: "Done!", progress: 100 },
  ];

  function handleLine(line) {
    let update = { ...lastStatus, log: line };
    for (const p of PHASES) {
      if (line.includes(p.match)) {
        update.phase = p.label;
        update.progress = p.progress;
        break;
      }
    }
    lastStatus = update;
    broadcast(lastStatus);
  }

  python.stdout.on("data", (chunk) => {
    chunk.toString().split("\n").filter(Boolean).forEach(handleLine);
  });
  python.stderr.on("data", (chunk) => {
    chunk.toString().split("\n").filter(Boolean).forEach(handleLine);
  });

  python.on("close", (code) => {
    if (code === 0) {
      // Auto-calibrate direction right after reconstruction completes
      const scriptPath = path.join(__dirname, "scripts", "calibrate_direction.py");
      const metaPath = path.join(outputDir, "direction.json");
      let dMeta = {};
      if (fs.existsSync(metaPath)) {
        try { dMeta = JSON.parse(fs.readFileSync(metaPath, "utf8")); } catch (_) {}
      }
      const calibPy = spawn(pythonCmd, ["run", "--with", "pycolmap", "python3", scriptPath, dMeta.referenceImage || "", dMeta.direction || "N"], { cwd: __dirname });
      const detectPath = path.join(__dirname, "scripts", "detect_scene_objects.py");
      calibPy.on("close", () => {
        if (fs.existsSync(detectPath)) {
          const detectPy = spawn(pythonCmd, ["run", "--with", "pycolmap", "--with", "trimesh", "--with", "scipy", "python3", detectPath], { cwd: __dirname });
          detectPy.on("close", () => {
            lastStatus = {
              phase: "complete",
              log: "Reconstruction complete, compass calibrated, and room objects detected!",
              progress: 100,
              done: true,
              error: null,
            };
            broadcast(lastStatus);
          });
        } else {
          lastStatus = {
            phase: "complete",
            log: "Reconstruction complete and compass calibrated!",
            progress: 100,
            done: true,
            error: null,
          };
          broadcast(lastStatus);
        }
      });
    } else {
      lastStatus = {
        phase: "error",
        log: `Process exited with code ${code}`,
        progress: 0,
        done: false,
        error: `Reconstruction failed (exit code ${code})`,
      };
      broadcast(lastStatus);
    }
  });
});

// Reset endpoint – thoroughly cleans up previous models, textures, colmap/openmvs, input and metadata
app.post("/api/reset", (req, res) => {
  try {
    cleanupPreviousModels();
    res.json({ message: "Reset and cleanup complete" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Forensic Crime Scene Recreation & Video Planning Endpoint ────────
app.post("/api/recreation/plan", async (req, res) => {
  try {
    const { prompt, apiKey, bounds, directionMeta } = req.body;
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Missing or invalid prompt string" });
    }

    // Load saved direction metadata if none passed
    let effectiveDirMeta = directionMeta;
    if (!effectiveDirMeta) {
      const dirPath = path.join(outputDir, "direction.json");
      if (fs.existsSync(dirPath)) {
        try {
          effectiveDirMeta = JSON.parse(fs.readFileSync(dirPath, "utf8"));
        } catch (_) {}
      }
    }

    // 1. Parse prompt into structured action script (Gemini or Rule-based)
    const { script, source } = await parseCrimeScript(prompt, apiKey);

    // 2. Resolve 3D anchors given scene bounds and cardinal compass calibration
    const { anchors, bounds: effectiveBounds, center, verificationReport, physicalObjects, northOffset } = resolveSceneAnchors(script, bounds, effectiveDirMeta);

    // 3. Generate kinematic simulation tracks, timed impacts, and captions
    const plan = generateCrimePlan(script, anchors, effectiveBounds, center, null, verificationReport, physicalObjects);

    const result = {
      success: true,
      prompt,
      source,
      script,
      anchors,
      plan,
      bounds: effectiveBounds,
      center,
      verificationReport,
      physicalObjects,
      northOffset,
      timestamp: new Date().toISOString()
    };

    // Persist recreation plan
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, "recreation_plan.json"), JSON.stringify(result, null, 2));

    res.json(result);
  } catch (err) {
    console.error("Crime recreation planning error:", err);
    res.status(500).json({ error: err.message || "Failed to generate crime recreation plan" });
  }
});

// Retrieve latest recreation plan
app.get("/api/recreation/plan", (req, res) => {
  const planPath = path.join(outputDir, "recreation_plan.json");
  if (!fs.existsSync(planPath)) {
    return res.status(404).json({ error: "No recreation plan found" });
  }
  try {
    const data = JSON.parse(fs.readFileSync(planPath, "utf8"));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to read recreation plan" });
  }
});

app.listen(PORT, () => {
  console.log(`Forensic 3D backend running at http://localhost:${PORT}`);
});

