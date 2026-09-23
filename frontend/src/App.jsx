import { useState, useRef, useCallback, useEffect, Suspense } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Environment, Grid, useGLTF, Html } from "@react-three/drei";
import * as THREE from "three";
import "./index.css";

const API = ""; // Vite proxies /api and /models → http://localhost:3001

// ── Direction constants ────────────────────────────────────────────────
const DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const DIR_ANGLES = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

// ── 3D Model + auto-fit camera to bounding box ────────────────────────
function ModelWithCamera({ url, controlsRef, onModelInfo }) {
  const { scene } = useGLTF(url);
  const { camera } = useThree();
  const groupRef = useRef();

  useEffect(() => {
    if (!groupRef.current) return;
    // Compute bounding box of the model (including Y-up rotation)
    const box = new THREE.Box3().setFromObject(groupRef.current);
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);

    const maxDim = Math.max(size.x, size.y, size.z) || 5;
    const fovRad = (camera.fov * Math.PI) / 180;
    const dist = (maxDim / 2 / Math.tan(fovRad / 2)) * 1.6;

    // Position camera above and in front of scene center
    camera.position.set(center.x, center.y + maxDim * 0.35, center.z + dist);
    camera.near = Math.max(0.01, maxDim * 0.001);
    camera.far = maxDim * 200;
    camera.updateProjectionMatrix();

    if (controlsRef?.current) {
      controlsRef.current.target.copy(center);
      controlsRef.current.update();
    }

    if (onModelInfo) {
      onModelInfo({ center: [center.x, center.y, center.z], size: [size.x, size.y, size.z], maxDim });
    }
  }, [scene]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <group ref={groupRef} rotation={[Math.PI, 0, 0]}>
      <primitive object={scene} />
    </group>
  );
}

// ── Camera azimuth tracker (inside Canvas context) ────────────────────
function CameraTracker({ azimuthRef, controlsRef }) {
  useFrame(() => {
    if (!controlsRef.current) return;
    const cam = controlsRef.current.object;
    const target = controlsRef.current.target;
    const dx = cam.position.x - target.x;
    const dz = cam.position.z - target.z;
    azimuthRef.current = Math.atan2(dx, dz) * (180 / Math.PI);
  });
  return null;
}

// ── 3D Direction Markers (shown after calibration) ───────────────────
function DirectionMarkers({ northOffset, target = [0, 0, 0], radius = 5 }) {
  const cardinals = [
    { label: "N", offset: 0 },
    { label: "E", offset: 90 },
    { label: "S", offset: 180 },
    { label: "W", offset: 270 },
  ];

  return (
    <>
      {cardinals.map(({ label, offset }) => {
        // World-space angle for this direction
        const worldAngle = (northOffset + offset) * (Math.PI / 180);
        // Position in XZ plane around target center
        const px = target[0] - Math.sin(worldAngle) * radius;
        const pz = target[2] - Math.cos(worldAngle) * radius;
        const py = target[1];
        const isNorth = label === "N";
        return (
          <Html key={label} position={[px, py + 0.3, pz]} center>
            <div className={`dir-marker ${isNorth ? "dir-north" : ""}`}>
              {label}
            </div>
          </Html>
        );
      })}
    </>
  );
}

// ── Compass Rose (HTML overlay, outside Canvas) ───────────────────────
function CompassOverlay({ azimuthRef, northOffset, calibrated, refImageUrl, refDirection }) {
  const roseRef = useRef(null);
  const [facing, setFacing] = useState("—");

  useEffect(() => {
    let raf;
    const tick = () => {
      const az = azimuthRef.current;
      const rot = -az + northOffset;

      if (roseRef.current) {
        // SVG-native rotate(angle, cx, cy) — pivot always at SVG centre (70,70).
        // CSS transform-origin drifts with transform-box:fill-box and causes
        // labels / needles to escape the circle boundary during rotation.
        roseRef.current.setAttribute("transform", `rotate(${rot}, 70, 70)`);
      }

      // Facing direction readout
      const norm = ((az - northOffset) % 360 + 360) % 360;
      setFacing(DIRECTIONS[Math.round(norm / 45) % 8]);

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [azimuthRef, northOffset]);

  return (
    <div className={`compass-container ${calibrated ? "calibrated" : ""}`}>
      {/* Reference photo thumbnail */}
      {refImageUrl && (
        <div className="ref-thumb-wrap">
          <img src={refImageUrl} alt="Reference" className="ref-thumb" />
          <div className="ref-thumb-label">
            Ref · {refDirection}
          </div>
        </div>
      )}

      {/* Compass rose */}
      <div className="compass-card">
        {/* Heading indicator (fixed at top) */}
        <div className="compass-heading-pin" />

        <svg viewBox="0 0 140 140" className="compass-svg">
          <defs>
            {/* Clip the rotating rose so needles/labels never bleed outside the bezel */}
            <clipPath id="compass-rose-clip">
              <circle cx="70" cy="70" r="62" />
            </clipPath>
          </defs>

          {/* Outer bezel (fixed) */}
          <circle cx="70" cy="70" r="66"
            fill="rgba(10,11,16,0.9)"
            stroke={calibrated ? "rgba(59,107,255,0.6)" : "rgba(30,33,48,0.9)"}
            strokeWidth="1.5"
          />

          {/* Degree tick marks (fixed ring) */}
          {Array.from({ length: 36 }, (_, i) => {
            const a = i * 10;
            const rad = (a - 90) * Math.PI / 180;
            const r1 = a % 90 === 0 ? 54 : a % 45 === 0 ? 56 : 59;
            return (
              <line key={a}
                x1={70 + r1 * Math.cos(rad)} y1={70 + r1 * Math.sin(rad)}
                x2={70 + 63 * Math.cos(rad)} y2={70 + 63 * Math.sin(rad)}
                stroke={a % 90 === 0 ? "#3d4560" : a % 45 === 0 ? "#2d3248" : "#1e2238"}
                strokeWidth={a % 90 === 0 ? 2 : 1}
              />
            );
          })}

          {/* Rotating rose group — SVG-native transform, clipped inside bezel */}
          <g ref={roseRef} clipPath="url(#compass-rose-clip)">
            {/* North needle (red) */}
            <polygon points="70,14 65,68 70,60 75,68" fill="#ff4444" opacity="0.95" />
            {/* South needle (dark) */}
            <polygon points="70,126 65,72 70,80 75,72" fill="#2d3348" />

            {/* Cardinal N/E/S/W labels */}
            {[
              { l: "N", a: 0, color: "#ff6b6b", fw: 700, fs: 13 },
              { l: "E", a: 90, color: "#a0aec0", fw: 600, fs: 11 },
              { l: "S", a: 180, color: "#718096", fw: 600, fs: 11 },
              { l: "W", a: 270, color: "#a0aec0", fw: 600, fs: 11 },
            ].map(({ l, a, color, fw, fs }) => {
              const rad = (a - 90) * Math.PI / 180;
              const r = 43;
              return (
                <text key={l}
                  x={70 + r * Math.cos(rad)}
                  y={70 + r * Math.sin(rad) + fs * 0.35}
                  textAnchor="middle"
                  fill={color}
                  fontSize={fs}
                  fontWeight={fw}
                  fontFamily="Inter, system-ui, sans-serif"
                >{l}</text>
              );
            })}

            {/* Intercardinal labels */}
            {[
              { l: "NE", a: 45 }, { l: "SE", a: 135 },
              { l: "SW", a: 225 }, { l: "NW", a: 315 },
            ].map(({ l, a }) => {
              const rad = (a - 90) * Math.PI / 180;
              return (
                <text key={l}
                  x={70 + 43 * Math.cos(rad)}
                  y={70 + 43 * Math.sin(rad) + 3}
                  textAnchor="middle"
                  fill="#3d4560"
                  fontSize="8"
                  fontFamily="Inter, system-ui, sans-serif"
                >{l}</text>
              );
            })}
          </g>

          {/* Center hub (fixed, rendered on top of rose) */}
          <circle cx="70" cy="70" r="5.5" fill="#1a1d28" stroke="#3d4560" strokeWidth="1" />
          <circle cx="70" cy="70" r="3" fill="#e8eaf0" />
        </svg>

        {/* Current facing direction readout */}
        <div className="compass-readout">
          {calibrated
            ? <><span className="readout-label">Facing</span><span className="readout-value">{facing}</span></>
            : <span className="readout-uncal">Uncalibrated</span>
          }
        </div>
      </div>
    </div>
  );
}

// ── Upload Icon SVG ───────────────────────────────────────────────────
function UploadIcon({ small = false }) {
  const s = small ? 32 : 48;
  return (
    <svg className={small ? "upload-icon-sm" : "upload-icon"} viewBox="0 0 48 48" fill="none" width={s} height={s}>
      <rect x="6" y="30" width="36" height="12" rx="4" stroke="#8b90a4" strokeWidth="2" />
      <rect x="6" y="6" width="36" height="22" rx="4" stroke="#8b90a4" strokeWidth="2" />
      <path d="M18 17l6-6 6 6M24 11v14" stroke="#8b90a4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Building placeholder ──────────────────────────────────────────────
function BuildingIcon() {
  return (
    <svg className="placeholder-icon" viewBox="0 0 80 80" fill="none">
      <rect x="8" y="20" width="64" height="52" rx="3" stroke="#8b90a4" strokeWidth="2.5" />
      <path d="M8 32h64M28 20v52M52 20v52" stroke="#8b90a4" strokeWidth="2" />
      <path d="M16 14h48M22 8h36" stroke="#8b90a4" strokeWidth="2" strokeLinecap="round" />
      <rect x="34" y="50" width="12" height="22" rx="2" fill="#8b90a4" opacity="0.3" />
    </svg>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────
function Sidebar({
  files, isDragOver, fileInputRef,
  onDrop, onDragOver, onDragLeave, onFileChange, onZoneClick,
  refFile, refPreview, refDirection, refInputRef,
  onRefZoneClick, onRefFileChange, onRefDirChange,
  onRefDrop, onRefDragOver, onRefDragLeave, isRefDragOver,
  status, logs, onGenerate, onReset, isRunning,
}) {
  const dotClass =
    status.done ? "done"
      : status.error ? "error"
        : isRunning ? "active"
          : "idle";

  const statusText =
    status.done ? "Reconstruction complete"
      : status.error ? "Error occurred"
        : isRunning ? (status.phase || "Processing…")
          : files.length > 0
            ? `Ready — ${files.length} image${files.length !== 1 ? "s" : ""} selected`
            : "Ready — upload photos to begin";

  return (
    <aside className="sidebar">
      {/* ── Header */}
      <div className="sidebar-header">
        <div className="logo-icon">
          <svg viewBox="0 0 24 24">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
              stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        </div>
        <div className="logo-text">
          <span className="logo-title">Forensic Spatial</span>
          <span className="logo-sub">Analyzer</span>
        </div>
      </div>

      {/* ── Scene Photos Upload */}
      <div className="sidebar-section">
        <div className="section-label">Scene Photos</div>
        <div
          className={`upload-zone${isDragOver ? " drag-over" : ""}${files.length > 0 ? " has-files" : ""}`}
          onClick={onZoneClick}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
        >
          <UploadIcon />
          <div className="upload-label">
            Drag &amp; drop photos here<br />
            <span>or click to browse</span>
          </div>
          <div className="upload-hint">JPG, PNG, HEIC</div>
          {files.length > 0 && (
            <div className="file-count-badge">✓ {files.length} files selected</div>
          )}
        </div>
        <input id="file-input" ref={fileInputRef} type="file" accept="image/*"
          multiple style={{ display: "none" }} onChange={onFileChange} />
      </div>

      {/* ── Reference Image + Direction */}
      <div className="sidebar-section">
        <div className="section-label">Reference Image &amp; Direction</div>
        <div className="ref-upload-row">
          {/* Small drop zone */}
          <div
            className={`ref-zone${isRefDragOver ? " drag-over" : ""}${refFile ? " has-file" : ""}`}
            onClick={onRefZoneClick}
            onDrop={onRefDrop}
            onDragOver={onRefDragOver}
            onDragLeave={onRefDragLeave}
          >
            {refPreview
              ? <img src={refPreview} alt="ref" className="ref-preview-thumb" />
              : <>
                <UploadIcon small />
                <span className="ref-zone-hint">1 photo</span>
              </>
            }
          </div>
          <input id="ref-input" ref={refInputRef} type="file" accept="image/*"
            style={{ display: "none" }} onChange={onRefFileChange} />

          {/* Direction select */}
          <div className="dir-select-wrap">
            <div className="dir-select-label">Camera facing</div>
            <select
              id="direction-select"
              className="dir-select"
              value={refDirection}
              onChange={(e) => onRefDirChange(e.target.value)}
            >
              {DIRECTIONS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <div className="dir-compass-icon">
              {/* tiny compass */}
              <svg viewBox="0 0 24 24" fill="none" className="dir-icon-svg">
                <circle cx="12" cy="12" r="10" stroke="#3d4560" strokeWidth="1.5" />
                <polygon points="12,4 10,12 12,10 14,12" fill="#ff4444" />
                <polygon points="12,20 10,12 12,14 14,12" fill="#3d4560" />
                <circle cx="12" cy="12" r="1.5" fill="#e8eaf0" />
              </svg>
              <span className="dir-angle-hint">{DIR_ANGLES[refDirection]}°</span>
            </div>
          </div>
        </div>
        {refFile && (
          <div className="ref-info-row">
            <span className="ref-filename">{refFile.name}</span>
            <span className="ref-dir-badge">{refDirection}</span>
          </div>
        )}
      </div>

      {/* ── Actions */}
      <div className="sidebar-actions">
        <button id="btn-generate" className="btn-generate"
          onClick={onGenerate}
          disabled={files.length === 0 || isRunning}
        >
          {isRunning
            ? <><div className="spinner" /> Processing…</>
            : <><span className="btn-icon">✦</span> Generate 3D Room</>}
        </button>
        {(files.length > 0 || status.done) && (
          <button id="btn-reset" className="btn-reset"
            onClick={onReset} disabled={isRunning}>
            ↺ Reset
          </button>
        )}
      </div>

      {/* ── Status */}
      <div className="status-row">
        <div className={`status-dot ${dotClass}`} />
        <span>{statusText}</span>
      </div>

      {/* ── Progress */}
      {(isRunning || status.progress > 0) && (
        <div className="progress-section">
          <div className="progress-header">
            <span>{status.phase || "Initialising"}</span>
            <span>{status.progress}%</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${status.progress}%` }} />
          </div>
        </div>
      )}

      {/* ── Log Console */}
      {logs.length > 0 && (
        <div className="log-section">
          <div className="log-title">Console</div>
          <LogConsole logs={logs} />
        </div>
      )}
    </aside>
  );
}

// Auto-scrolling log console
function LogConsole({ logs }) {
  const bottomRef = useRef(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div className="log-console">
      {logs.map((line, i) => {
        const cls =
          line.includes("ERROR") || line.includes("error") ? "error"
            : line.includes("DONE") || line.includes("complete") ? "success"
              : line.startsWith("$") ? "highlight"
                : "";
        return <div key={i} className={`log-line ${cls}`}>{line}</div>;
      })}
      <div ref={bottomRef} />
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────
export default function App() {
  // Scene photos
  const [files, setFiles] = useState([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef(null);

  // Reference image
  const [refFile, setRefFile] = useState(null);
  const [refPreview, setRefPreview] = useState(null);
  const [refDirection, setRefDirection] = useState("N");
  const [isRefDragOver, setIsRefDragOver] = useState(false);
  const refInputRef = useRef(null);

  // Compass calibration
  const [northOffset, setNorthOffset] = useState(0);
  const [compassCalibrated, setCalibrated] = useState(false);
  const azimuthRef = useRef(0); // live camera azimuth (updated each frame)
  const controlsRef = useRef(null);

  // Reconstruction state
  const [status, setStatus] = useState({ phase: "idle", log: "", progress: 0, done: false, error: null });
  const [logs, setLogs] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [modelUrl, setModelUrl] = useState(null);
  const [modelKey, setModelKey] = useState(0);
  const [modelInfo, setModelInfo] = useState(null);
  const sseRef = useRef(null);

  // ── SSE connection
  useEffect(() => {
    const es = new EventSource(`${API}/api/status`);
    sseRef.current = es;
    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      setStatus(data);
      if (data.log) setLogs((p) => [...p.slice(-200), data.log]);
      if (data.done) {
        setIsRunning(false);
        setModelUrl(`${API}/models/scene_textured.glb?t=${Date.now()}`);
        setModelKey((k) => k + 1);
      }
      if (data.error) setIsRunning(false);
    };
    return () => es.close();
  }, []);

  // ── Scene photo handling
  const handleDrop = useCallback((e) => {
    e.preventDefault(); setIsDragOver(false);
    setFiles(Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/")));
  }, []);
  const handleDragOver = useCallback((e) => { e.preventDefault(); setIsDragOver(true); }, []);
  const handleDragLeave = useCallback(() => setIsDragOver(false), []);
  const handleFileChange = useCallback((e) => setFiles(Array.from(e.target.files)), []);
  const handleZoneClick = useCallback(() => fileInputRef.current?.click(), []);

  // ── Reference image handling
  const handleRefDrop = useCallback((e) => {
    e.preventDefault(); setIsRefDragOver(false);
    const f = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
    if (f) { setRefFile(f); setRefPreview(URL.createObjectURL(f)); }
  }, []);
  const handleRefDragOver = useCallback((e) => { e.preventDefault(); setIsRefDragOver(true); }, []);
  const handleRefDragLeave = useCallback(() => setIsRefDragOver(false), []);
  const handleRefFileChange = useCallback((e) => {
    const f = e.target.files[0];
    if (f) { setRefFile(f); setRefPreview(URL.createObjectURL(f)); }
  }, []);
  const handleRefZoneClick = useCallback(() => refInputRef.current?.click(), []);

  // ── Compass calibration: "I am currently facing <refDirection>"
  const handleSetCompass = useCallback(() => {
    // northOffset = calibrationAzimuth - referenceDirection_angle
    const offset = azimuthRef.current - DIR_ANGLES[refDirection];
    setNorthOffset(offset);
    setCalibrated(true);
  }, [refDirection]);

  // ── Generate
  const handleGenerate = useCallback(async () => {
    if (!files.length || isRunning) return;
    setIsRunning(true);
    setLogs([]);
    setModelUrl(null);
    setCalibrated(false);

    // 1. Upload scene images + reference image + direction
    const form = new FormData();
    files.forEach((f) => form.append("images", f));
    if (refFile) form.append("referenceImage", refFile);
    form.append("direction", refDirection);
    try {
      const r = await fetch(`${API}/api/upload`, { method: "POST", body: form });
      if (!r.ok) throw new Error("Upload failed");
    } catch (err) {
      setLogs((p) => [...p, `ERROR: ${err.message}`]);
      setIsRunning(false);
      return;
    }

    // 2. Start reconstruction
    try {
      await fetch(`${API}/api/reconstruct`, { method: "POST" });
    } catch (err) {
      setLogs((p) => [...p, `ERROR: ${err.message}`]);
      setIsRunning(false);
    }
  }, [files, refFile, refDirection, isRunning]);

  // ── Reset
  const handleReset = useCallback(async () => {
    setFiles([]); setLogs([]); setModelUrl(null); setRefFile(null);
    setRefPreview(null); setCalibrated(false);
    setStatus({ phase: "idle", log: "", progress: 0, done: false, error: null });
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (refInputRef.current) refInputRef.current.value = "";
    await fetch(`${API}/api/reset`, { method: "POST" }).catch(() => { });
  }, []);

  return (
    <div className="app">
      <Sidebar
        files={files} isDragOver={isDragOver} fileInputRef={fileInputRef}
        onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}
        onFileChange={handleFileChange} onZoneClick={handleZoneClick}
        refFile={refFile} refPreview={refPreview} refDirection={refDirection}
        refInputRef={refInputRef}
        onRefZoneClick={handleRefZoneClick} onRefFileChange={handleRefFileChange}
        onRefDirChange={setRefDirection}
        onRefDrop={handleRefDrop} onRefDragOver={handleRefDragOver}
        onRefDragLeave={handleRefDragLeave} isRefDragOver={isRefDragOver}
        status={status} logs={logs}
        onGenerate={handleGenerate} onReset={handleReset} isRunning={isRunning}
      />

      {/* ── 3D Viewer */}
      <main className="viewer-area">
        <div className="viewer-topbar">
          <div className="viewer-topbar-left">
            <span className="viewer-tab active">3D View</span>
            {modelUrl && <span className="viewer-badge">✓ Model ready</span>}
            {compassCalibrated && (
              <span className="compass-badge">🧭 Compass calibrated</span>
            )}
          </div>
          <div className="viewer-topbar-right">
            {modelUrl && !compassCalibrated && refFile && (
              <button id="btn-set-compass" className="btn-calibrate" onClick={handleSetCompass}>
                🧭 Set Compass — I&apos;m facing {refDirection}
              </button>
            )}
            {modelUrl && compassCalibrated && (
              <button id="btn-recalibrate" className="btn-calibrate recalibrate" onClick={() => setCalibrated(false)}>
                ↻ Recalibrate
              </button>
            )}
            {modelUrl && (
              <a href={`${API}/models/scene_textured.glb`} download="scene_textured.glb"
                className="download-link">
                ↓ Download GLB
              </a>
            )}
          </div>
        </div>

        <div className="viewer-canvas">
          {modelUrl ? (
            <Canvas
              key={modelKey}
              camera={{ position: [0, 1.5, 4], fov: 60, near: 0.01, far: 500 }}
              style={{ width: "100%", height: "100%" }}
            >
              <ambientLight intensity={1.2} />
              <directionalLight position={[5, 10, 5]} intensity={2} />
              <Grid
                position={modelInfo ? [modelInfo.center[0], modelInfo.center[1] - modelInfo.size[1] / 2, modelInfo.center[2]] : [0, -1, 0]}
                infiniteGrid cellSize={0.5} sectionSize={2}
                cellColor="#1e2130" sectionColor="#262a3a" fadeDistance={30}
              />
              <Suspense fallback={null}>
                <ModelWithCamera url={modelUrl} controlsRef={controlsRef} onModelInfo={setModelInfo} />
              </Suspense>
              {compassCalibrated && (
                <DirectionMarkers
                  northOffset={northOffset}
                  target={modelInfo?.center || [0, 0, 0]}
                  radius={modelInfo ? Math.max(modelInfo.size[0], modelInfo.size[2]) * 0.6 : 5}
                />
              )}
              <OrbitControls
                ref={controlsRef}
                makeDefault
                enableDamping
                dampingFactor={0.08}
                minDistance={0.5}
                maxDistance={200}
              />
              <CameraTracker azimuthRef={azimuthRef} controlsRef={controlsRef} />
              <Environment preset="city" />
            </Canvas>
          ) : (
            <div className="viewer-placeholder">
              <BuildingIcon />
              <p className="placeholder-text">
                {isRunning
                  ? "Reconstruction in progress — model will appear here when ready…"
                  : 'Upload photos and click "Generate 3D Room" to begin'}
              </p>
            </div>
          )}

          {/* Compass overlay (always visible once model loaded) */}
          {modelUrl && (
            <CompassOverlay
              azimuthRef={azimuthRef}
              northOffset={northOffset}
              calibrated={compassCalibrated}
              refImageUrl={refPreview}
              refDirection={refDirection}
            />
          )}

          {/* "Set Compass" prompt (when model is ready but not yet calibrated and ref image exists) */}
          {modelUrl && !compassCalibrated && refFile && (
            <div className="calibrate-prompt">
              <span>🧭</span>
              <span>Orbit to match the reference photo's viewpoint, then click <strong>Set Compass</strong></span>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}