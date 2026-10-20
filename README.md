# 🏛️ AI Forensics & 3D Crime Scene Reconstruction

An end-to-end, AI-powered forensic spatial analysis platform. This system reconstructs textured 3D crime scene rooms from multi-view photographs, reenacts dynamic criminal incidents with animated 3D human mannequins and obstacle-avoiding navigation, and performs open-vocabulary weapon and bloodstain threat probability detection.

---

## 📑 Table of Contents

- [✨ Key Features](#-key-features)
- [🏗️ System Architecture](#️-system-architecture)
- [⚙️ Prerequisites](#️-prerequisites)
- [📦 Installation Guide](#-installation-guide)
  - [1. Clone Repository](#1-clone-repository)
  - [2. Install Node.js Dependencies](#2-install-nodejs-dependencies)
  - [3. Install Threat Detection Python Backend](#3-install-threat-detection-python-backend)
  - [4. Install 3D Reconstruction Python Packages (Optional)](#4-install-3d-reconstruction-python-packages-optional)
- [🚀 How to Run](#-how-to-run)
  - [Option A: Standard 2-Terminal Run (Recommended)](#option-a-standard-2-terminal-run-recommended)
  - [Option B: Explicit 3-Terminal Run](#option-b-explicit-3-terminal-run)
- [🧭 Module Walkthrough & Usage](#-module-walkthrough--usage)
  - [1. 🏢 3D Photogrammetry Room](#1--3d-photogrammetry-room)
  - [2. 🎬 Crime Recreation Studio](#2--crime-recreation-studio)
  - [3. 🔬 Threat & Weapon Detection (FORENSIQ)](#3--threat--weapon-detection-forensiq)
- [📡 API Endpoints Overview](#-api-endpoints-overview)
- [🛠️ Troubleshooting & Tips](#️-troubleshooting--tips)

---

## ✨ Key Features

1. **🏢 3D Photogrammetry Room Reconstruction**:
   - Extracts camera features and sparse point clouds using **COLMAP**.
   - Generates high-density Poisson surface meshes and textured `.glb` models using **OpenMVS**.
   - Predicts and smooths room geometry, automatically inpainting voids and cleaning floating shards.
   - Cleans up stale models automatically on browser refresh or new image uploads.

2. **🎬 Crime Incident Reenactment Studio**:
   - **Gemini AI / Heuristic Incident Planner**: Translates crime descriptions into structured sequential actions (e.g., _"Killer entered from North-West door, moved towards the victim sitting on the couch, attacked, and fled towards the South door"_).
   - **Dynamic 3D Mannequins**: Human avatars dynamically adjust postures (standing, sitting, prone/fallen) and orientations based on statements.
   - **Obstacle-Aware Pathfinding**: Navigation grid calculates collision-free walking paths around furniture and room obstacles.
   - **Cardinal Compass Calibration**: 8-direction alignment (N, NE, E, SE, S, SW, W, NW) ensures room coordinates match physical walls and corners.
   - **Interactive Playback**: 60 FPS timeline scrubber, speed multiplier ($0.5\times$ to $4\times$), multi-angle camera tracking (Director, Tactical Overhead, Orbit, Follow Target), and video recording.

3. **🔬 AI Weapon & Threat Probability Detection (`FORENSIQ`)**:
   - **Open-Vocabulary YOLO-World**: Detects potential weapons (knives, firearms, blunt objects) and distinguishes them from everyday room objects.
   - **Bloodstain Geometry Segmentation**: Dual-threshold color segmentation maps impact spatters and blood pools with contour polygons.
   - **Bayesian Forensic Scoring**: Computes weapon probability ($0\text{--}100\%$) based on spatial proximity to bloodstains, object lethality, and blood contact transfer.
   - **Interactive Canvas**: High-precision bounding boxes, proximity connector lines, polygon overlays, and downloadable forensic summary reports.

---

## 🏗️ System Architecture

```mermaid
flowchart TD
    subgraph UI ["Frontend (Vite + React + Three.js) - Port 5173"]
        A[3D Photogrammetry Room]
        B[Crime Recreation Studio]
        C[Threat & Weapon Detection Tab]
    end

    subgraph NodeServer ["Backend Server (Express) - Port 3001"]
        D[/api/upload & /api/reconstruct]
        E[/api/recreation/plan]
        F[/api/direction & /api/scene/objects]
        G[/api/analyze proxy]
        H[/api/reset cleanup]
    end

    subgraph ThreatAPI ["Threat Detection Service (FastAPI) - Port 8000"]
        I[YOLOv8-World Detector]
        J[Bloodstain Geometry Analyzer]
        K[Bayesian Weapon Scoring]
    end

    subgraph Reconstruction ["3D Pipeline (Python & Binaries)"]
        L[COLMAP SfM]
        M[OpenMVS Mesh & Texture]
        N[enhance_mesh.py]
    end

    A -->|Upload Photos| D
    D -->|Executes| L --> M --> N
    B -->|Crime Statement| E
    C -->|Images| G -->|Forwards to 8000| ThreatAPI
    NodeServer -->|Auto-spawns if inactive| ThreatAPI
```

---

## ⚙️ Prerequisites

Before getting started, make sure you have the following installed on your system:

| Tool                              | Recommended Version              | Purpose                                                                   |
| --------------------------------- | -------------------------------- | ------------------------------------------------------------------------- |
| **Node.js**                       | `v18.x` or `v20.x`+ (with `npm`) | Runs Express backend and React frontend                                   |
| **Python**                        | `3.10` – `3.14`                  | Powers threat detector and 3D processing scripts                          |
| **Git**                           | `2.x`+                           | Version control                                                           |
| **COLMAP & OpenMVS** _(Optional)_ | Latest                           | Required **only** if generating new photogrammetry 3D meshes from scratch |

> [!NOTE]
> **No COLMAP/OpenMVS?** You can still run the **Crime Recreation Studio** (with spatial room wireframe fallback & dummies) and the **AI Threat & Weapon Detection** tab out of the box!

---

## 📦 Installation Guide

### 1. Clone Repository

```bash
git clone https://github.com/Nishan169/AI-Forensics-3D-Reconstruction.git
cd AI-Forensics-3D-Reconstruction
```

### 2. Install Node.js Dependencies

Install dependencies for the root backend server:

```bash
npm install
```

Install dependencies for the React frontend client:

```bash
npm install --prefix frontend
```

### 3. Install Threat Detection Python Backend

The Threat Detection service runs as an isolated FastAPI microservice.

```bash
# Navigate to threat_backend
cd threat_backend

# Create virtual environment
python3 -m venv venv

# Activate virtual environment
# macOS / Linux:
source venv/bin/activate
# Windows (PowerShell):
# .\venv\Scripts\Activate.ps1

# Install required Python packages
pip install --upgrade pip
pip install -r requirements.txt

# Return to root directory
cd ..
```

_(Pre-trained YOLO weights `yolov8m-worldv2.pt` and `yolov8m.pt` are included in `threat_backend/` and will download automatically if missing)._

### 4. Install 3D Reconstruction Python Packages (Optional)

If you intend to run full photogrammetry reconstruction locally from uploaded photos:

```bash
pip install -r requirements.txt
```

_(Optional: Install `uv` via `brew install uv` or `pip install uv` for accelerated python script executions)._

---

## 🚀 How to Run

### Option A: Standard 2-Terminal Run (Recommended)

`server.js` automatically detects if the Python Threat Detection service is active; if not, it automatically spawns it in the background!

```bash
# Terminal 1: Start Backend Server (Port 3001)
node server.js
```

```bash
# Terminal 2: Start Frontend Application (Port 5173)
npm run frontend
```

Now open **http://localhost:5173** in your web browser.

---

### Option B: Explicit 3-Terminal Run

If you prefer running and monitoring each microservice in its own terminal window:

```bash
# Terminal 1: Threat Detection Backend (Port 8000)
npm run threat:backend
```

```bash
# Terminal 2: Node.js Orchestration Backend (Port 3001)
npm start
```

```bash
# Terminal 3: Vite React Client (Port 5173)
npm run frontend
```

---

## 🧭 Module Walkthrough & Usage

### 1. 🏢 3D Photogrammetry Room

1. In the left sidebar, click the **Scene Photos** dropzone and select or drag & drop multiple overlapping room photos (JPG/PNG).
2. Click **Generate 3D Room**.
3. Watch the real-time progress bar and log stream through feature extraction, dense matching, mesh reconstruction, and texture packing.
4. Orbit, pan, and zoom around the textured 3D model using mouse controls.
5. Use **🎯 Face North** or click compass directions to orient the room.

### 2. 🎬 Crime Recreation Studio

1. Click the **🎬 Crime Recreation Studio** tab at the top.
2. In the text area, type a natural language description of the incident:
   > _"The killer entered through the north door, walked to the south couch where the victim was sitting, attacked the victim, and escaped via the west door."_
3. _(Optional)_ Provide your **Gemini API Key** in the settings field to enable advanced natural language parsing (a deterministic heuristic engine is used if omitted).
4. Click **Generate 3D Reenactment Plan**.
5. Use the playback controls to **Play / Pause**, scrub the timeline, adjust simulation speed ($0.5\times$ to $4\times$), toggle movement paths, and switch camera perspectives (Director, Tactical 2D Overhead, First-Person).

### 3. 🔬 Threat & Weapon Detection (FORENSIQ)

1. Click the **🔬 Threat & Evidence Analysis** tab at the top (or click **Weapon & Threat Detection Tab →** from the sidebar).
2. Drag & drop or browse photos of interest directly into the upload area.
3. The system instantly detects objects using open-vocabulary YOLO-World, highlights blood spatters and transfer pools, and calculates weapon probabilities.
4. Toggle between **Focused View** (single photo with interactive evidence inspection) and **View All (Stacked)**.
5. Hover over any weapon row in the sidebar to trace proximity lines to nearby bloodstains on the canvas.
6. Click **Download Forensic Report** to export evidence summaries for case files.

---

## 📡 API Endpoints Overview

### Orchestration Server (`http://localhost:3001`)

| Method | Endpoint                   | Description                                                      |
| ------ | -------------------------- | ---------------------------------------------------------------- |
| `POST` | `/api/upload`              | Uploads scene photos for 3D reconstruction                       |
| `POST` | `/api/reconstruct`         | Triggers the COLMAP + OpenMVS pipeline                           |
| `GET`  | `/api/status`              | Server-Sent Events (SSE) streaming real-time reconstruction logs |
| `GET`  | `/api/direction`           | Returns calibrated cardinal compass angles                       |
| `POST` | `/api/direction/calibrate` | Updates compass orientation with respect to physical room walls  |
| `GET`  | `/api/scene/objects`       | Loads detected room objects and 8-direction anchors              |
| `POST` | `/api/recreation/plan`     | Generates structured incident timeline and dummy animation paths |
| `POST` | `/api/reset`               | Purges all prior models, textures, and COLMAP artifacts          |
| `POST` | `/api/analyze`             | Proxies image analysis requests to Threat Detection backend      |

### Threat Detection Service (`http://127.0.0.1:8000`)

| Method | Endpoint       | Description                                                                     |
| ------ | -------------- | ------------------------------------------------------------------------------- |
| `GET`  | `/api/health`  | Service liveness health check                                                   |
| `POST` | `/api/analyze` | Processes image, returns bounding boxes, blood polygons, and probability scores |
