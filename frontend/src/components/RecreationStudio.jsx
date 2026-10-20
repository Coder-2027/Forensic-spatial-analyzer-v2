import { useState, useRef, useEffect, useCallback } from "react";

const PRESET_SCENARIOS = [
  {
    label: "Sequential Entry (Victim South Door, Killer North Door, Shoot & Flee)",
    prompt: "Victim comes from south door and then killer comes from north door and shoots him then flees from same path"
  },
  {
    label: "Follow & Ambush (North Door Entry, Bat Attack, Same Path)",
    prompt: "Let victim come from north door and behind of which let killer come and hit the victim by a bat and run away from same path"
  },
  {
    label: "North Door Entry & Same Path Return (Firearm)",
    prompt: "Killer comes from north door and shoots a victim sitting in the middle of room and then runs away from same path."
  },
  {
    label: "East Door Entry & Knife Attack",
    prompt: "Killer enters through east door with a knife, approaches victim sitting on chair in center, attacks victim, victim collapses, killer flees."
  },
  {
    label: "South Door Entry & Knife Attack",
    prompt: "Killer enters through south door, walks to victim on chair in center, stabs victim, victim falls, killer flees."
  },
  {
    label: "Armed Ambush & Firearm Discharge",
    prompt: "Killer enters through the door with a gun, aims firearm at victim sitting on chair in center, shoots victim, victim collapses backward from gunshot impact, killer drops gun on the floor and flees."
  },
  {
    label: "Window Intrusion & Crowbar Strike",
    prompt: "Burglar breaks in through north window with a crowbar, approaches center, strikes victim with crowbar, searches area for valuables, and escapes."
  },
  {
    label: "Physical Combat & Violent Shove",
    prompt: "Perpetrator enters through door, confronts victim in center, throws punches and struggles physically, gives victim a violent two-handed shove, victim falls backward, perpetrator flees."
  }
];

export default function RecreationStudio({
  planData,
  sceneObjects = [],
  onGeneratePlan,
  isPlanning,
  currentTime,
  onTimeChange,
  isPlaying,
  onTogglePlay,
  onRestart,
  speed,
  onSpeedChange,
  cameraMode,
  onCameraModeChange,
  showRoutes,
  onToggleRoutes,
  showLabels,
  onToggleLabels,
  showAnchors,
  onToggleAnchors,
  activeCaption,
  getCanvasElement,
  apiKey,
  onApiKeyChange,
  onScrollTo3D
}) {
  const [prompt, setPrompt] = useState(
    "Killer comes from north door and shoots a victim sitting in the middle of room and then runs away from same path."
  );
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);
  const [tempKey, setTempKey] = useState(apiKey || "");
  const [isCardCollapsed, setIsCardCollapsed] = useState(false);

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);

  const duration = planData?.plan?.duration || 10;
  const recordProgress = Math.min(100, Math.round((currentTime / duration) * 100));

  // Submit Prompt to Plan Simulation
  const handleGenerate = (e) => {
    e?.preventDefault();
    if (!prompt.trim() || isPlanning) return;
    onGeneratePlan(prompt.trim());
  };

  // Keyboard Shortcuts (Space to play/pause, R to restart)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.code === "Space") {
        e.preventDefault();
        onTogglePlay();
      } else if (e.code === "KeyR") {
        e.preventDefault();
        onRestart();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onTogglePlay, onRestart]);

  // Video Recording Engine
  const startRecording = useCallback(() => {
    const canvas = getCanvasElement();
    if (!canvas) {
      alert("Canvas not ready for recording");
      return;
    }

    try {
      const stream = canvas.captureStream(30);
      let mimeType = "video/webm;codecs=vp9";
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = "video/webm;codecs=vp8";
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = "video/webm";
        }
      }

      recordedChunksRef.current = [];
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 5000000 // 5 Mbps
      });

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        const videoUrl = URL.createObjectURL(blob);
        setRecordedVideoUrl(videoUrl);
        setIsRecording(false);

        // Auto trigger download
        const a = document.createElement("a");
        a.href = videoUrl;
        a.download = `crime_scene_recreation_${Date.now()}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      };

      mediaRecorderRef.current = recorder;
      recorder.start(100);
      setIsRecording(true);

      // Reset and play simulation from start
      onRestart();
      if (!isPlaying) onTogglePlay();
    } catch (err) {
      console.error("Recording error:", err);
      alert(`Could not start video recording: ${err.message}`);
      setIsRecording(false);
    }
  }, [getCanvasElement, isPlaying, onRestart, onTogglePlay]);

  // Stop recording when simulation finishes
  useEffect(() => {
    if (isRecording && currentTime >= duration) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    }
  }, [currentTime, duration, isRecording]);

  const cancelRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  return (
    <div className="recreation-panel">
      {/* ── Prompt Input Section */}
      <div className={`recreation-input-card ${isCardCollapsed ? "collapsed" : ""}`}>
        <div className="recreation-header-row">
          <div className="rec-title">
            <span className="rec-icon">🎬</span>
            <span>Crime Scene Reenactment</span>
            {planData && (
              <span className="rec-status-pill">
                {isCardCollapsed ? "Active (Minimized)" : "Active Plan"}
              </span>
            )}
          </div>

          <div className="rec-header-actions">
            <button
              type="button"
              className="btn-collapse-toggle"
              onClick={() => setIsCardCollapsed(!isCardCollapsed)}
              title={isCardCollapsed ? "Expand prompt and reports panel" : "Minimize panel to view 3D room"}
            >
              {isCardCollapsed ? "▼ Show Prompt & Report" : "▲ Minimize"}
            </button>

            <button
              type="button"
              className={`btn-api-key ${apiKey ? "configured" : ""}`}
              onClick={() => {
                setTempKey(apiKey || "");
                setIsKeyModalOpen(true);
              }}
              title="Configure Google Gemini API Key"
            >
              {apiKey ? "✓ Gemini Key Active" : "🔑 Set Gemini Key"}
            </button>
          </div>
        </div>

        {!isCardCollapsed && (
          <div className="recreation-card-scrollable">
            <form onSubmit={handleGenerate} className="prompt-form">
              <textarea
                className="prompt-textarea"
                rows={2}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe how the crime occurred (e.g. killer entered from north door, attacked victim, fled east)..."
                disabled={isPlanning || isRecording}
              />

              <div className="prompt-actions-row">
                {/* Preset chips */}
                <div className="preset-chips">
                  <span className="preset-label">Presets:</span>
                  {PRESET_SCENARIOS.map((p, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className="preset-chip"
                      onClick={() => setPrompt(p.prompt)}
                      disabled={isPlanning || isRecording}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                <button
                  type="submit"
                  className="btn-plan-generate"
                  disabled={!prompt.trim() || isPlanning || isRecording}
                >
                  {isPlanning ? (
                    <>
                      <div className="spinner-sm" />
                      Generating…
                    </>
                  ) : (
                    <>
                      <span>⚡</span> Recreate Crime
                    </>
                  )}
                </button>
              </div>
            </form>



            {/* Source badge if plan loaded */}
            {planData?.source && (
              <div className="plan-source-badge">
                Engine:{" "}
                <strong>
                  {planData.source === "gemini" ? "Google Gemini 2.0 Flash" : "Forensic Spatial NLP Engine"}
                </strong>{" "}
                · {Object.keys(planData.script?.actors || {}).length} Actors ·{" "}
                {planData.script?.events?.length || 0} Events
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Playback & Video Export Controls */}
      {planData?.plan && (
        <div className="playback-hud">
          {/* Timeline Row */}
          <div className="playback-scrub-row">
            <button
              className="btn-play-pause"
              onClick={onTogglePlay}
              disabled={isRecording}
              title={isPlaying ? "Pause (Space)" : "Play (Space)"}
            >
              {isPlaying ? "❚❚" : "▶"}
            </button>

            <button
              className="btn-restart"
              onClick={onRestart}
              disabled={isRecording}
              title="Restart from beginning (R)"
            >
              ↺
            </button>

            <input
              type="range"
              className="scrub-slider"
              min={0}
              max={duration}
              step={0.02}
              value={currentTime}
              onChange={(e) => onTimeChange(parseFloat(e.target.value))}
              disabled={isRecording}
            />

            <span className="time-display">
              {currentTime.toFixed(1)} / {duration.toFixed(1)}s
            </span>
          </div>

          {/* Controls Bar */}
          <div className="playback-controls-bar">
            {/* Speed Selector */}
            <div className="control-group">
              <span className="control-label">Speed</span>
              <select
                className="select-control"
                value={speed}
                onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
                disabled={isRecording}
              >
                <option value={0.5}>0.5x</option>
                <option value={1.0}>1.0x</option>
                <option value={1.5}>1.5x</option>
                <option value={2.0}>2.0x</option>
              </select>
            </div>

            {/* Camera Mode Selector */}
            <div className="control-group">
              <span className="control-label">Camera</span>
              <select
                className="select-control camera-select"
                value={cameraMode}
                onChange={(e) => onCameraModeChange(e.target.value)}
              >
                <option value="orbit">Free Orbit</option>
                <option value="follow_killer">Follow Killer</option>
                <option value="follow_victim">Follow Victim</option>
                <option value="surveillance">CCTV Surveillance (Top-Down)</option>
                <option value="director">Director Cine-Cam</option>
              </select>
            </div>

            {/* Layer Toggles */}
            <div className="control-toggles">
              <label className="toggle-chip">
                <input
                  type="checkbox"
                  checked={showRoutes}
                  onChange={(e) => onToggleRoutes(e.target.checked)}
                />
                Routes
              </label>

              <label className="toggle-chip">
                <input
                  type="checkbox"
                  checked={showLabels}
                  onChange={(e) => onToggleLabels(e.target.checked)}
                />
                Labels
              </label>


            </div>

            {/* Video Record Button */}
            <div className="record-actions">
              {isRecording ? (
                <button className="btn-record recording" onClick={cancelRecording}>
                  <span className="rec-dot pulsing" />
                  Recording {recordProgress}% (Cancel)
                </button>
              ) : (
                <button
                  className="btn-record"
                  onClick={startRecording}
                  title="Record and Export Recreation Video"
                >
                  <span className="rec-dot" />
                  Export Video (WebM)
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Live Narrative Subtitle Banner */}
      {planData?.plan && activeCaption && (
        <div className="narrative-banner">
          <span className="narrative-badge">INCIDENT TELEMETRY</span>
          <span className="narrative-text">{activeCaption}</span>
        </div>
      )}

      {/* ── Scroll To 3D Model Quick Button ── */}
      {onScrollTo3D && (
        <div className="scroll-to-canvas-bar" onClick={onScrollTo3D}>
          <span className="scroll-text">🏢 3D Forensic Scene &amp; Simulation Room</span>
          <span className="scroll-btn">↓ Scroll Down to View 3D Model</span>
        </div>
      )}

      {/* ── API Key Configuration Modal */}
      {isKeyModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsKeyModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                <span>🔑</span> Google Gemini API Key
              </div>
              <button
                className="modal-close"
                onClick={() => setIsKeyModalOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <p className="modal-desc">
                By default, the recreation system uses its built-in rule-based forensic NLP engine.
                To empower full natural language reasoning with Google Gemini (e.g. Gemini 2.0 Flash),
                enter your Google Gemini API key below.
              </p>

              <label className="modal-input-label">Gemini API Key</label>
              <input
                type="password"
                className="modal-input"
                placeholder="AIzaSy..."
                value={tempKey}
                onChange={(e) => setTempKey(e.target.value)}
              />

              <div className="modal-hint">
                Key is stored securely in your browser&apos;s localStorage.
              </div>
            </div>

            <div className="modal-footer">
              {apiKey && (
                <button
                  className="btn-modal-clear"
                  onClick={() => {
                    onApiKeyChange("");
                    setTempKey("");
                    setIsKeyModalOpen(false);
                  }}
                >
                  Clear Key
                </button>
              )}

              <button
                className="btn-modal-save"
                onClick={() => {
                  onApiKeyChange(tempKey.trim());
                  setIsKeyModalOpen(false);
                }}
              >
                Save Key
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Recorded Video Preview Dialog */}
      {recordedVideoUrl && (
        <div className="modal-backdrop" onClick={() => setRecordedVideoUrl(null)}>
          <div className="modal-card video-preview-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                <span>📹</span> Generated Crime Recreation Video
              </div>
              <button
                className="modal-close"
                onClick={() => setRecordedVideoUrl(null)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body video-modal-body">
              <video
                src={recordedVideoUrl}
                controls
                autoPlay
                className="preview-video-player"
              />
              <p className="video-download-note">
                ✓ Video automatically downloaded to your Downloads folder as <code>.webm</code>.
              </p>
            </div>

            <div className="modal-footer">
              <a
                href={recordedVideoUrl}
                download="crime_scene_recreation.webm"
                className="btn-modal-save"
              >
                ↓ Download Again
              </a>
              <button
                className="btn-modal-clear"
                onClick={() => setRecordedVideoUrl(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
