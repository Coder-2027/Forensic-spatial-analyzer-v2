import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import cors from "cors";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3001;

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

// Serve generated models statically
app.use("/models", express.static(path.join(__dirname, "frontend/public/models")));

// Upload storage – save to input/images
const inputDir = path.join(__dirname, "input", "images");
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(inputDir, { recursive: true });
    cb(null, inputDir);
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

// Upload endpoint
app.post("/api/upload", upload.array("images"), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "No files uploaded" });
  }
  res.json({ count: req.files.length, message: `${req.files.length} images saved to input/images` });
});

// Reconstruct endpoint – runs reconstruct.py and streams output
app.post("/api/reconstruct", (req, res) => {
  lastStatus = { phase: "starting", log: "Starting reconstruction…", progress: 0, done: false, error: null };
  broadcast(lastStatus);

  res.json({ message: "Reconstruction started" });

  const python = spawn("python3", [path.join(__dirname, "reconstruct.py")], {
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
    { match: "TextureMesh", label: "Texturing mesh", progress: 92 },
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
      lastStatus = {
        phase: "complete",
        log: "Reconstruction complete!",
        progress: 100,
        done: true,
        error: null,
      };
    } else {
      lastStatus = {
        phase: "error",
        log: `Process exited with code ${code}`,
        progress: 0,
        done: false,
        error: `Reconstruction failed (exit code ${code})`,
      };
    }
    broadcast(lastStatus);
  });
});

// Reset endpoint – clears input to allow a fresh run
app.post("/api/reset", (req, res) => {
  try {
    if (fs.existsSync(inputDir)) {
      fs.rmSync(inputDir, { recursive: true, force: true });
      fs.mkdirSync(inputDir, { recursive: true });
    }
    lastStatus = { phase: "idle", log: "", progress: 0, done: false, error: null };
    broadcast(lastStatus);
    res.json({ message: "Reset complete" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Forensic 3D backend running at http://localhost:${PORT}`);
});
