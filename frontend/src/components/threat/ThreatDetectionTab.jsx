import { useState, useCallback, useRef, useEffect } from "react";
import {
  RefreshCw,
  PlusCircle,
  Columns,
  Layers,
  Droplets,
  Images,
  ShieldAlert,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import ImageUploader from "./ImageUploader";
import EvidenceCanvas from "./EvidenceCanvas";
import EvidenceSidebar from "./EvidenceSidebar";
import "../../threat-detection.css";

/* ── helpers ─────────────────────────────────────────────────────────────── */

function getTopThreat(results) {
  if (!results || results.length === 0) return null;
  const weapons = results.filter((r) => r.category !== "unaccounted");
  return weapons.length > 0 ? weapons[0] : null;
}

function threatBadgeColor(pct) {
  if (pct >= 60) return "text-red-400 bg-red-950/70 border-red-800";
  if (pct >= 25) return "text-amber-400 bg-amber-950/70 border-amber-800";
  return "text-blue-400 bg-blue-950/70 border-blue-800";
}

export default function ThreatDetectionTab({
  onSwitchTo3D,
  onSwitchToStudio,
}) {
  const [analyzedImages, setAnalyzedImages] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [viewMode, setViewMode] = useState("focused"); // 'focused' | 'stacked'
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hoveredLabel, setHoveredLabel] = useState(null);
  const [stackedHovers, setStackedHovers] = useState({}); // { [imageId]: label }
  const [progressText, setProgressText] = useState("");
  const [progressPct, setProgressPct] = useState(0);

  const addInputRef = useRef(null);

  const handleInitialResult = useCallback((newItems) => {
    setAnalyzedImages(newItems);
    setActiveIdx(0);
    setHoveredLabel(null);
    setStackedHovers({});
  }, []);

  const analyzeFileItems = useCallback(async (filesToAnalyze) => {
    if (!filesToAnalyze || filesToAnalyze.length === 0) return;
    setIsLoading(true);
    setError(null);
    setProgressPct(0);

    const items = [];
    const valid = Array.from(filesToAnalyze).filter((f) => {
      const name = f.name || f.filename || "";
      return f.type?.startsWith("image/") || /\.(jpe?g|png|webp|bmp|tiff?)$/i.test(name);
    });

    if (valid.length === 0) {
      setIsLoading(false);
      return;
    }

    try {
      for (let i = 0; i < valid.length; i++) {
        const file = valid[i];
        const pct = Math.round((i / valid.length) * 100);
        setProgressPct(pct);
        setProgressText(
          valid.length > 1
            ? `Analyzing photo ${i + 1} of ${valid.length}: ${file.name}…`
            : `Running forensic threat pipeline on ${file.name}…`
        );

        const form = new FormData();
        form.append("file", file);

        let res;
        try {
          res = await fetch("http://127.0.0.1:8000/api/analyze", { method: "POST", body: form });
        } catch {
          res = await fetch("/api/analyze", { method: "POST", body: form });
        }

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail ?? `Server error ${res.status} on ${file.name}`);
        }

        const data = await res.json();
        data._id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        data._imageURL = URL.createObjectURL(file);
        data._filename = file.name;
        data._size = file.size;
        items.push(data);
      }

      setProgressPct(100);
      setAnalyzedImages((prev) => {
        // Merge or replace
        const existingNames = new Set(prev.map((x) => x._filename));
        const newUniques = items.filter((x) => !existingNames.has(x._filename));
        return prev.length === 0 ? items : [...prev, ...newUniques];
      });
    } catch (err) {
      console.error("[ThreatDetection] Pipeline error:", err);
      setError(err.message ?? "Error running forensic pipeline.");
    } finally {
      setIsLoading(false);
      setProgressText("");
    }
  }, []);

  const handleAppendFiles = useCallback((files) => {
    analyzeFileItems(files);
  }, [analyzeFileItems]);

  const handleReset = () => {
    analyzedImages.forEach((img) => {
      if (img._imageURL) URL.revokeObjectURL(img._imageURL);
    });
    setAnalyzedImages([]);
    setActiveIdx(0);
    setError(null);
    setHoveredLabel(null);
    setStackedHovers({});
  };

  const showDashboard = analyzedImages.length > 0;
  const activeImage = analyzedImages[activeIdx] ?? analyzedImages[0];

  return (
    <div className="threat-tab-container min-h-full w-full bg-slate-950 text-slate-100 font-sans selection:bg-red-900 selection:text-white overflow-y-auto">
      {/* ── Top Navigation Bar ── */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur px-6 py-3 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <span className="text-red-500 font-black text-lg tracking-widest uppercase flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse" />
            FORENSIQ
          </span>
          <span className="hidden sm:block text-slate-400 text-xs tracking-wider uppercase border-l border-slate-800 pl-3">
            AI Crime Scene Weapon & Blood Probability System
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Quick tab switch shortcuts */}
          {onSwitchTo3D && (
            <button
              onClick={onSwitchTo3D}
              className="text-xs text-slate-400 hover:text-slate-200 border border-slate-800 hover:border-slate-700 rounded-lg px-2.5 py-1.5 transition-colors"
              title="Return to 3D Photogrammetry Room"
            >
              🏢 3D Room
            </button>
          )}
          {onSwitchToStudio && (
            <button
              onClick={onSwitchToStudio}
              className="text-xs text-slate-400 hover:text-slate-200 border border-slate-800 hover:border-slate-700 rounded-lg px-2.5 py-1.5 transition-colors"
              title="Switch to Crime Recreation Studio"
            >
              🎬 Studio
            </button>
          )}

          {showDashboard && (
            <>
              {/* View Mode Toggle when multiple images exist */}
              {analyzedImages.length > 1 && (
                <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-xs">
                  <button
                    onClick={() => setViewMode("focused")}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-all ${
                      viewMode === "focused"
                        ? "bg-slate-800 text-slate-100 font-semibold shadow-sm"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                    title="Focus on one image with tabs"
                  >
                    <Columns size={13} />
                    <span>Focused View</span>
                  </button>
                  <button
                    onClick={() => setViewMode("stacked")}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-all ${
                      viewMode === "stacked"
                        ? "bg-slate-800 text-slate-100 font-semibold shadow-sm"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                    title="View all images with respective markings and sidebars"
                  >
                    <Layers size={13} />
                    <span>View All ({analyzedImages.length})</span>
                  </button>
                </div>
              )}

              {/* Add more photos button */}
              <button
                onClick={() => addInputRef.current?.click()}
                disabled={isLoading}
                className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-white
                           bg-slate-850 border border-slate-700 hover:border-slate-500 rounded-lg px-3 py-1.5
                           transition-colors"
              >
                <PlusCircle size={13} className="text-red-400" />
                <span>Add Photos</span>
              </button>
              <input
                ref={addInputRef}
                type="file"
                multiple
                accept="image/*,.webp,.png,.jpg,.jpeg,.bmp,.tiff"
                className="hidden"
                onChange={(e) => handleAppendFiles(e.target.files)}
              />

              {/* Reset button */}
              <button
                onClick={handleReset}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200
                           border border-slate-800 hover:border-slate-700 rounded-lg px-3 py-1.5
                           transition-colors"
              >
                <RefreshCw size={12} />
                <span>New Analysis</span>
              </button>
            </>
          )}
        </div>
      </header>

      {/* Progress banner during batch analysis */}
      {isLoading && (
        <div className="bg-red-950/70 border-b border-red-900/60 px-6 py-2.5 flex items-center gap-4 text-xs">
          <Loader2 size={16} className="text-red-400 animate-spin shrink-0" />
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-red-200 font-medium">{progressText || "Processing forensic pipeline…"}</span>
              <span className="font-mono text-red-400">{progressPct}%</span>
            </div>
            <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-red-500 h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mx-6 mt-4 p-3 rounded-xl bg-red-950/80 border border-red-800 text-red-200 text-xs flex items-center justify-between">
          <span>⚠️ {error}</span>
          <button onClick={() => setError(null)} className="text-slate-400 hover:text-white">✕</button>
        </div>
      )}

      {/* ── Main content ── */}
      <main className="max-w-screen-2xl mx-auto px-4 py-6">
        {!showDashboard ? (
          /* ── Initial Upload view ── */
          <div className="flex flex-col items-center justify-center min-h-[70vh] gap-8">
            <ImageUploader
              onResult={handleInitialResult}
              isLoading={isLoading}
              setIsLoading={setIsLoading}
              setError={setError}
              error={error}
            />

            {/* Feature hints */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-2xl text-center">
              {[
                {
                  icon: "🔍",
                  title: "Open-Vocabulary Detection",
                  desc: "YOLO-World identifies weapons and distinguishes them from shoes, clothing, and furniture.",
                },
                {
                  icon: "🩸",
                  title: "Bloodstain Geometry",
                  desc: "Dual-threshold segmentation maps impact spatters and blood pools with contour polygons.",
                },
                {
                  icon: "📊",
                  title: "Forensic Crime Probability",
                  desc: "Bayesian crime probability calculates weapon likelihood from proximity, lethality, and blood contact.",
                },
              ].map(({ icon, title, desc }) => (
                <div
                  key={title}
                  className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 text-left"
                >
                  <div className="text-2xl mb-2">{icon}</div>
                  <div className="text-sm font-semibold text-slate-200 mb-1">{title}</div>
                  <div className="text-xs text-slate-400 leading-relaxed">{desc}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* ── Dashboard view ── */
          <div className="space-y-6">
            {/* Multi-Image Selector Bar (shown when multiple images uploaded) */}
            {analyzedImages.length > 1 && (
              <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-3 shadow-lg">
                <div className="flex items-center justify-between mb-2.5 px-1">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    <Images size={14} className="text-red-400" />
                    <span>Evidence Photo Series ({analyzedImages.length} Photographs)</span>
                  </div>
                  <span className="text-xs text-slate-500">
                    Click any photo to focus or switch to "View All"
                  </span>
                </div>

                <div className="flex items-center gap-3 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-slate-700">
                  {analyzedImages.map((img, idx) => {
                    const topThreat = getTopThreat(img.results);
                    const isActive = viewMode === "focused" && activeIdx === idx;

                    return (
                      <button
                        key={img._id || idx}
                        onClick={() => {
                          setActiveIdx(idx);
                          if (viewMode === "stacked") setViewMode("focused");
                        }}
                        className={`flex items-center gap-3 p-2 rounded-xl border text-left shrink-0 transition-all ${
                          isActive
                            ? "bg-slate-800/90 border-red-600 shadow-md shadow-red-950/50 scale-[1.01]"
                            : "bg-slate-950/70 border-slate-800 hover:border-slate-700 hover:bg-slate-900"
                        }`}
                      >
                        {/* Thumbnail */}
                        <div className="w-14 h-14 rounded-lg overflow-hidden bg-slate-900 shrink-0 border border-slate-800 relative">
                          <img
                            src={img._imageURL}
                            alt={img._filename}
                            className="w-full h-full object-cover"
                          />
                          <span className="absolute bottom-0 right-0 bg-slate-950/90 text-[10px] px-1 font-mono text-slate-300 rounded-tl">
                            #{idx + 1}
                          </span>
                        </div>

                        {/* Metadata */}
                        <div className="flex flex-col gap-1 min-w-[120px] max-w-[170px]">
                          <span className="text-xs font-medium text-slate-200 truncate">
                            {img._filename || `Photo #${idx + 1}`}
                          </span>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {topThreat ? (
                              <span
                                className={`text-[11px] font-bold px-1.5 py-0.5 rounded border capitalize ${threatBadgeColor(
                                  topThreat.probability_pct
                                )}`}
                              >
                                {topThreat.label} {topThreat.probability_pct.toFixed(0)}%
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
                                No weapon
                              </span>
                            )}
                            <span className="text-[10px] text-red-400/90 font-mono flex items-center gap-0.5">
                              <Droplets size={10} />
                              {img.blood?.stain_count ?? 0}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── VIEW MODE 1: FOCUSED VIEW (Single selected photo with canvas + sidebar) ── */}
            {viewMode === "focused" && activeImage && (
              <div className="flex flex-col xl:flex-row gap-6 items-start">
                {/* Canvas column */}
                <div className="flex-1 min-w-0 w-full">
                  {/* Meta bar */}
                  <div className="flex items-center gap-4 mb-3 text-xs text-slate-400 bg-slate-900/50 border border-slate-800/80 rounded-xl px-4 py-2">
                    <span className="font-semibold text-slate-200 truncate max-w-xs">
                      {activeImage._filename || `Photo #${activeIdx + 1}`}
                    </span>
                    <span>·</span>
                    <span className="font-mono text-slate-400">
                      {activeImage.image.width} × {activeImage.image.height}px
                    </span>
                    <span>·</span>
                    <span>
                      {activeImage.results.filter((r) => r.category !== "unaccounted").length}{" "}
                      weapon candidate(s)
                    </span>
                    <span>·</span>
                    <span className="text-red-400 font-medium flex items-center gap-1">
                      <Droplets size={12} />
                      {activeImage.blood.stain_count} bloodstain
                      {activeImage.blood.stain_count !== 1 ? "s" : ""}
                    </span>

                    {/* Legend */}
                    <div className="ml-auto hidden md:flex items-center gap-3">
                      {[
                        { label: "≥ 60%", color: "bg-red-600" },
                        { label: "25–59%", color: "bg-amber-500" },
                        { label: "< 25%", color: "bg-blue-500" },
                      ].map(({ label, color }) => (
                        <span key={label} className="flex items-center gap-1">
                          <span className={`inline-block w-2.5 h-2.5 rounded-sm ${color}`} />
                          {label}
                        </span>
                      ))}
                      <span className="flex items-center gap-1 text-amber-300">
                        <span className="inline-block w-5 border-t border-dashed border-amber-400" />
                        Proximity
                      </span>
                    </div>
                  </div>

                  {/* Marking Canvas */}
                  <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-2 overflow-hidden">
                    <EvidenceCanvas
                      imageURL={activeImage._imageURL}
                      apiData={activeImage}
                      hoveredLabel={hoveredLabel}
                      onHover={setHoveredLabel}
                    />
                  </div>
                </div>

                {/* Evidence Sidebar column */}
                <div className="w-full xl:w-96 shrink-0">
                  <div className="flex items-center justify-between mb-3 px-1">
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
                      Evidence Report
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono">
                      Photo #{activeIdx + 1}
                    </span>
                  </div>
                  <EvidenceSidebar
                    results={activeImage.results}
                    hoveredLabel={hoveredLabel}
                    onHover={setHoveredLabel}
                    bloodInfo={activeImage.blood}
                  />
                </div>
              </div>
            )}

            {/* ── VIEW MODE 2: STACKED / ALL IMAGES VIEW ── */}
            {viewMode === "stacked" && (
              <div className="space-y-10">
                {analyzedImages.map((img, idx) => {
                  const currentHover = stackedHovers[img._id || idx] ?? null;
                  const topThreat = getTopThreat(img.results);

                  return (
                    <section
                      key={img._id || idx}
                      className="bg-slate-900/40 border border-slate-800 rounded-3xl p-5 shadow-2xl relative"
                    >
                      {/* Section Header */}
                      <div className="flex items-center justify-between border-b border-slate-800/80 pb-3 mb-4 flex-wrap gap-2">
                        <div className="flex items-center gap-3">
                          <span className="bg-red-900/80 text-white font-mono text-xs font-bold px-2.5 py-1 rounded-lg border border-red-700">
                            EVIDENCE #{idx + 1}
                          </span>
                          <h2 className="text-base font-bold text-slate-100 font-mono">
                            {img._filename || `Crime Scene Photo #${idx + 1}`}
                          </h2>
                          <span className="text-xs text-slate-500 font-mono">
                            ({img.image.width} × {img.image.height}px)
                          </span>
                        </div>

                        <div className="flex items-center gap-3 text-xs">
                          {topThreat && (
                            <span
                              className={`px-2.5 py-0.5 rounded-full border font-bold capitalize ${threatBadgeColor(
                                topThreat.probability_pct
                              )}`}
                            >
                              Top Weapon: {topThreat.label} ({topThreat.probability_pct.toFixed(1)}%)
                            </span>
                          )}
                          <span className="text-red-400 font-mono flex items-center gap-1">
                            <Droplets size={12} />
                            {img.blood?.stain_count ?? 0} bloodstains
                          </span>
                          <button
                            onClick={() => {
                              setActiveIdx(idx);
                              setViewMode("focused");
                            }}
                            className="text-xs text-slate-400 hover:text-slate-200 border border-slate-700 rounded-md px-2 py-0.5"
                          >
                            Focus this
                          </button>
                        </div>
                      </div>

                      {/* Respective image with marking on the left, material & probability on the side */}
                      <div className="flex flex-col xl:flex-row gap-6 items-start">
                        {/* Left: Evidence Canvas with marking */}
                        <div className="flex-1 min-w-0 w-full bg-slate-950/60 rounded-2xl p-2 border border-slate-800/80">
                          <EvidenceCanvas
                            imageURL={img._imageURL}
                            apiData={img}
                            hoveredLabel={currentHover}
                            onHover={(label) =>
                              setStackedHovers((prev) => ({
                                ...prev,
                                [img._id || idx]: label,
                              }))
                            }
                          />
                        </div>

                        {/* Right: Respective Evidence Sidebar with material and probability */}
                        <div className="w-full xl:w-96 shrink-0">
                          <div className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3 px-1">
                            Evidence & Probability Rationale
                          </div>
                          <EvidenceSidebar
                            results={img.results}
                            hoveredLabel={currentHover}
                            onHover={(label) =>
                              setStackedHovers((prev) => ({
                                ...prev,
                                [img._id || idx]: label,
                              }))
                            }
                            bloodInfo={img.blood}
                          />
                        </div>
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
