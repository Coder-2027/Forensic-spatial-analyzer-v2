import { useState, useRef, useCallback, useEffect, Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment, Grid, useGLTF, Center } from "@react-three/drei";
import "./index.css";

const API = ""; // Vite proxies /api and /models → http://localhost:3001

// ── 3D Model ─────────────────────────────────────────────────────────
function Model({ url }) {
  const { scene } = useGLTF(url);
  return (
    <Center>
      <primitive object={scene} rotation={[Math.PI, 0, 0]} />
    </Center>
  );
}

// ── Upload Icon SVG ───────────────────────────────────────────────────
function UploadIcon() {
  return (
    <svg className="upload-icon" viewBox="0 0 48 48" fill="none">
      <rect x="6" y="30" width="36" height="12" rx="4" fill="none" stroke="#8b90a4" strokeWidth="2" />
      <rect x="6" y="6" width="36" height="22" rx="4" fill="none" stroke="#8b90a4" strokeWidth="2" />
      <path d="M18 17l6-6 6 6M24 11v14" stroke="#8b90a4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Building (placeholder) Icon ───────────────────────────────────────
function BuildingIcon() {
  return (
    <svg className="placeholder-icon" viewBox="0 0 80 80" fill="none">
      <rect x="8" y="20" width="64" height="52" rx="3" stroke="#8b90a4" strokeWidth="2.5" fill="none" />
      <path d="M8 32h64M28 20v52M52 20v52" stroke="#8b90a4" strokeWidth="2" />
      <path d="M16 14h48M22 8h36" stroke="#8b90a4" strokeWidth="2" strokeLinecap="round" />
      <rect x="34" y="50" width="12" height="22" rx="2" fill="#8b90a4" opacity="0.3" />
    </svg>
  );
}

// ── Sidebar Component ─────────────────────────────────────────────────
function Sidebar({
  files, isDragOver, fileInputRef,
  onDrop, onDragOver, onDragLeave, onFileChange, onZoneClick,
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
    : files.length > 0 ? `Ready — ${files.length} image${files.length !== 1 ? "s" : ""} selected`
    : "Ready — upload photos to begin";

  return (
    <aside className="sidebar">
      {/* Header */}
      <div className="sidebar-header">
        <div className="logo-icon">
          <svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>
        </div>
        <div className="logo-text">
          <span className="logo-title">Forensic Spatial</span>
          <span className="logo-sub">Analyzer</span>
        </div>
      </div>

      {/* Upload Zone */}
      <div className="sidebar-section">
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
          <div className="upload-hint">JPG, PNG, HEIC · min 20 images</div>
          {files.length > 0 && (
            <div className="file-count-badge">✓ {files.length} files selected</div>
          )}
        </div>
        <input
          id="file-input"
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={onFileChange}
        />
      </div>

      {/* Actions */}
      <div className="sidebar-actions">
        <button
          id="btn-generate"
          className="btn-generate"
          onClick={onGenerate}
          disabled={files.length === 0 || isRunning}
        >
          {isRunning ? (
            <><div className="spinner" /> Processing…</>
          ) : (
            <><span className="btn-icon">✦</span> Generate 3D Room</>
          )}
        </button>
        {(files.length > 0 || status.done) && (
          <button
            id="btn-reset"
            className="btn-reset"
            onClick={onReset}
            disabled={isRunning}
          >
            ↺ Reset
          </button>
        )}
      </div>

      {/* Status */}
      <div className="status-row">
        <div className={`status-dot ${dotClass}`} />
        <span>{statusText}</span>
      </div>

      {/* Progress Bar (only when running) */}
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

      {/* Log Console */}
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
        const cls = line.includes("ERROR") || line.includes("error")
          ? "error"
          : line.includes("DONE") || line.includes("complete")
          ? "success"
          : line.startsWith("$")
          ? "highlight"
          : "";
        return <div key={i} className={`log-line ${cls}`}>{line}</div>;
      })}
      <div ref={bottomRef} />
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────
export default function App() {
  const [files, setFiles] = useState([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [status, setStatus] = useState({ phase: "idle", log: "", progress: 0, done: false, error: null });
  const [logs, setLogs] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [modelUrl, setModelUrl] = useState(null);
  const [modelKey, setModelKey] = useState(0); // force re-mount on new model
  const fileInputRef = useRef(null);
  const sseRef = useRef(null);

  // Connect to SSE on mount to receive live updates
  useEffect(() => {
    const evtSource = new EventSource(`${API}/api/status`);
    sseRef.current = evtSource;

    evtSource.onmessage = (e) => {
      const data = JSON.parse(e.data);
      setStatus(data);
      if (data.log) setLogs((prev) => [...prev.slice(-200), data.log]);
      if (data.done) {
        setIsRunning(false);
        // Add cache-busting timestamp so React re-fetches the GLB
        setModelUrl(`${API}/models/scene_textured.glb?t=${Date.now()}`);
        setModelKey((k) => k + 1);
      }
      if (data.error) {
        setIsRunning(false);
      }
    };

    return () => evtSource.close();
  }, []);

  // ── File handling
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);
    const dropped = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    setFiles(dropped);
  }, []);

  const handleDragOver = useCallback((e) => { e.preventDefault(); setIsDragOver(true); }, []);
  const handleDragLeave = useCallback(() => setIsDragOver(false), []);
  const handleFileChange = useCallback((e) => {
    setFiles(Array.from(e.target.files));
  }, []);
  const handleZoneClick = useCallback(() => fileInputRef.current?.click(), []);

  // ── Generate
  const handleGenerate = useCallback(async () => {
    if (!files.length || isRunning) return;
    setIsRunning(true);
    setLogs([]);
    setModelUrl(null);

    // 1. Upload images
    const form = new FormData();
    files.forEach((f) => form.append("images", f));
    try {
      const upRes = await fetch(`${API}/api/upload`, { method: "POST", body: form });
      if (!upRes.ok) throw new Error("Upload failed");
    } catch (err) {
      setLogs((prev) => [...prev, `ERROR: ${err.message}`]);
      setIsRunning(false);
      return;
    }

    // 2. Trigger reconstruction
    try {
      await fetch(`${API}/api/reconstruct`, { method: "POST" });
    } catch (err) {
      setLogs((prev) => [...prev, `ERROR: ${err.message}`]);
      setIsRunning(false);
    }
  }, [files, isRunning]);

  // ── Reset
  const handleReset = useCallback(async () => {
    setFiles([]);
    setLogs([]);
    setModelUrl(null);
    setStatus({ phase: "idle", log: "", progress: 0, done: false, error: null });
    if (fileInputRef.current) fileInputRef.current.value = "";
    await fetch(`${API}/api/reset`, { method: "POST" }).catch(() => {});
  }, []);

  return (
    <div className="app">
      <Sidebar
        files={files}
        isDragOver={isDragOver}
        fileInputRef={fileInputRef}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onFileChange={handleFileChange}
        onZoneClick={handleZoneClick}
        status={status}
        logs={logs}
        onGenerate={handleGenerate}
        onReset={handleReset}
        isRunning={isRunning}
      />

      {/* 3D Viewer Area */}
      <main className="viewer-area">
        <div className="viewer-topbar">
          <div className="viewer-topbar-left">
            <span className="viewer-tab active">3D View</span>
            {modelUrl && <span className="viewer-badge">✓ Model ready</span>}
          </div>
          {modelUrl && (
            <a
              href={`${API}/models/scene_textured.glb`}
              download="scene_textured.glb"
              style={{ fontSize: 11, color: "var(--text-muted)", textDecoration: "none" }}
            >
              ↓ Download GLB
            </a>
          )}
        </div>

        <div className="viewer-canvas">
          {modelUrl ? (
            <Canvas
              key={modelKey}
              camera={{ position: [3, 2, 3], fov: 50 }}
              style={{ width: "100%", height: "100%" }}
            >
              <ambientLight intensity={1.2} />
              <directionalLight position={[5, 10, 5]} intensity={2} />
              <Grid
                infiniteGrid
                cellSize={0.5}
                sectionSize={2}
                cellColor="#1e2130"
                sectionColor="#262a3a"
                fadeDistance={30}
              />
              <Suspense fallback={null}>
                <Model url={modelUrl} />
              </Suspense>
              <OrbitControls makeDefault />
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
        </div>
      </main>
    </div>
  );
}