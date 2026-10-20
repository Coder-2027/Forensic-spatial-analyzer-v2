import { useState, useRef, useCallback, useEffect, useMemo, Suspense } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Environment, Grid, useGLTF, Html } from "@react-three/drei";
import * as THREE from "three";
import "./index.css";
import ForensicSimulation, { SceneAnchorMarker } from "./components/ForensicSimulation";
import RecreationStudio from "./components/RecreationStudio";
import ThreatDetectionTab from "./components/threat/ThreatDetectionTab";

const API = ""; // Vite proxies /api and /models → http://localhost:3001

// ── Direction constants ────────────────────────────────────────────────
const DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const DIR_ANGLES = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

// ── WebGL Canvas DOM Element Capture for Video Recording ──────────────
function CanvasCaptureRef({ canvasRef }) {
  const { gl } = useThree();
  useEffect(() => {
    if (gl?.domElement) canvasRef.current = gl.domElement;
  }, [gl, canvasRef]);
  return null;
}

// ── 60 FPS Synchronized Simulation Clock ──────────────────────────────
function SimulationClock({ isPlaying, speed, onTick }) {
  useFrame((_, delta) => {
    if (isPlaying) {
      onTick(delta * speed);
    }
  });
  return null;
}

// ── Forensic Spatial Room (shown when no photogrammetry mesh loaded) ──
function ForensicSpatialRoom({ center = [0, 0, 0], radius = 4, northOffset = 0, roomSize = null }) {
  const halfX = roomSize ? roomSize[0] * 0.48 : radius;
  const halfZ = roomSize ? roomSize[2] * 0.48 : radius;

  const cardinals = [
    { label: "N", relPos: [0, -halfZ], color: "#ff6b6b", isNorth: true },
    { label: "S", relPos: [0, halfZ], color: "#94a3b8" },
    { label: "E", relPos: [halfX, 0], color: "#94a3b8" },
    { label: "W", relPos: [-halfX, 0], color: "#94a3b8" },
    { label: "NE", relPos: [halfX, -halfZ], color: "#64748b" },
    { label: "NW", relPos: [-halfX, -halfZ], color: "#64748b" },
    { label: "SE", relPos: [halfX, halfZ], color: "#64748b" },
    { label: "SW", relPos: [-halfX, halfZ], color: "#64748b" },
  ];

  const rotRad = (northOffset * Math.PI) / 180;
  const cosR = Math.cos(rotRad);
  const sinR = Math.sin(rotRad);

  return (
    <group position={[center[0], 0, center[2]]}>
      {/* Rectangular room boundary floor outline */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
        <planeGeometry args={[halfX * 2, halfZ * 2]} />
        <meshBasicMaterial color="#3b6bff" wireframe opacity={0.25} transparent />
      </mesh>

      {/* Cardinal & corner perimeter markers */}
      {cardinals.map(({ label, relPos, color }) => {
        const px = relPos[0] * cosR - relPos[1] * sinR;
        const pz = relPos[0] * sinR + relPos[1] * cosR;
        return (
          <group key={label} position={[px, 0.02, pz]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.15, 0.22, 24]} />
              <meshBasicMaterial color={color} side={THREE.DoubleSide} />
            </mesh>
            <Html position={[0, 0.35, 0]} center distanceFactor={14}>
              <div
                style={{
                  padding: "2px 8px",
                  borderRadius: "12px",
                  background: label === "N" ? "rgba(239, 68, 68, 0.25)" : "rgba(15, 23, 42, 0.85)",
                  border: `1px solid ${color}`,
                  color: color,
                  fontSize: "11px",
                  fontWeight: "700",
                  pointerEvents: "none",
                  userSelect: "none",
                }}
              >
                {label}
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

// ── 3D Model + auto-fit camera to bounding box ────────────────────────
function ModelWithCamera({
  url,
  controlsRef,
  onModelInfo,
  northOffset = 0,
}) {
  const { scene } = useGLTF(url);
  const { camera } = useThree();
  const groupRef = useRef();
  const [modelTransform, setModelTransform] = useState(null);
  const [boundsInfo, setBoundsInfo] = useState(null);

  useEffect(() => {
    if (!groupRef.current || !scene) return;

    // 1. Ensure photogrammetry mesh renders with true photographic colors and zero shadow acne
    scene.traverse((child) => {
      if (child.isMesh) {
        child.frustumCulled = false;
        // Never cast self-shadows on complex photogrammetry scan mesh (eliminates shadow acne and black speckles)
        child.castShadow = false;
        child.receiveShadow = false;

        if (child.material) {
          child.material.side = THREE.DoubleSide;
          child.material.depthWrite = true;
          child.material.transparent = false;
          child.material.opacity = 1.0;

          if (child.material.map) {
            child.material.map.colorSpace = THREE.SRGBColorSpace;
            child.material.map.minFilter = THREE.LinearMipmapLinearFilter;
            child.material.map.magFilter = THREE.LinearFilter;
            child.material.map.generateMipmaps = true;
            child.material.map.needsUpdate = true;
          }

          // Unlit photographic colors: renders exact camera photo pixels with zero shadow acne or dark blotches
          if (!child.material.isMeshBasicMaterial) {
            const oldMap = child.material.map;
            child.material = new THREE.MeshBasicMaterial({
              map: oldMap,
              side: THREE.DoubleSide,
              color: 0xffffff,
            });
          }
          child.material.needsUpdate = true;
        }
      }
    });

    // 2. Reset transforms for accurate measurement
    groupRef.current.position.set(0, 0, 0);
    groupRef.current.scale.set(1, 1, 1);
    groupRef.current.rotation.set(0, 0, 0);
    groupRef.current.updateMatrixWorld(true);

    // 3. Sample mesh vertices and normals to detect orientation & robust percentiles
    const xs = [];
    const ys = [];
    const zs = [];
    let upNormals = 0;
    let downNormals = 0;

    scene.traverse((child) => {
      if (child.isMesh && child.geometry?.attributes?.position) {
        const pos = child.geometry.attributes.position;
        const norm = child.geometry.attributes.normal;
        const index = child.geometry.index;
        const v = new THREE.Vector3();
        const step = Math.max(1, Math.floor(pos.count / 2500));
        for (let i = 0; i < pos.count; i += step) {
          v.fromBufferAttribute(pos, i);
          xs.push(v.x);
          ys.push(v.y);
          zs.push(v.z);
        }

        if (norm) {
          const n = new THREE.Vector3();
          for (let i = 0; i < norm.count; i += step) {
            n.fromBufferAttribute(norm, i);
            if (n.y > 0.4) upNormals++;
            else if (n.y < -0.4) downNormals++;
          }
        } else if (index) {
          // Direct face normal sampling when vertex normals are not present
          const vA = new THREE.Vector3();
          const vB = new THREE.Vector3();
          const vC = new THREE.Vector3();
          const cb = new THREE.Vector3();
          const ab = new THREE.Vector3();
          const fStep = Math.max(1, Math.floor(index.count / 3000)) * 3;
          for (let i = 0; i < index.count - 2; i += fStep) {
            vA.fromBufferAttribute(pos, index.getX(i));
            vB.fromBufferAttribute(pos, index.getX(i + 1));
            vC.fromBufferAttribute(pos, index.getX(i + 2));
            cb.subVectors(vC, vB);
            ab.subVectors(vA, vB);
            cb.cross(ab).normalize();
            if (cb.y > 0.35) upNormals++;
            else if (cb.y < -0.35) downNormals++;
          }
        }
      }
    });

    if (xs.length < 10) return;

    // In COLMAP / OpenMVS, cameras use OpenCV Y-down coordinates, so floor surfaces predominantly face -Y (downNormals > upNormals).
    // An un-flipped COLMAP mesh needs rotationX = Math.PI to be upright (+Y up) in Three.js.
    const isCOLMAPInverted = downNormals > upNormals || (upNormals === 0 && downNormals === 0);
    const rotationX = isCOLMAPInverted ? Math.PI : 0;

    // Detect upward floor normal to level the room mesh horizontally
    let floorNx = 0, floorNy = 0, floorNz = 0, floorCount = 0;
    scene.traverse((child) => {
      if (child.isMesh && child.geometry?.attributes?.position) {
        const norm = child.geometry.attributes.normal;
        if (norm) {
          const n = new THREE.Vector3();
          const step = Math.max(1, Math.floor(norm.count / 2500));
          for (let i = 0; i < norm.count; i += step) {
            n.fromBufferAttribute(norm, i);
            const ny = isCOLMAPInverted ? -n.y : n.y;
            const nz = isCOLMAPInverted ? -n.z : n.z;
            const nx = n.x;
            if (ny > 0.5) {
              floorNx += nx; floorNy += ny; floorNz += nz;
              floorCount++;
            }
          }
        }
      }
    });

    let tiltRotX = 0;
    let tiltRotZ = 0;
    if (floorCount > 20) {
      floorNx /= floorCount; floorNy /= floorCount; floorNz /= floorCount;
      const len = Math.hypot(floorNx, floorNy, floorNz) || 1;
      floorNx /= len; floorNy /= len; floorNz /= len;
      tiltRotX = -Math.atan2(floorNz, floorNy);
      tiltRotZ = Math.atan2(floorNx, floorNy);
    }

    if (isCOLMAPInverted) {
      const qFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
      const qLevel = new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltRotX, 0, tiltRotZ, "XYZ"));
      groupRef.current.quaternion.copy(qLevel.multiply(qFlip));
    } else {
      groupRef.current.rotation.set(tiltRotX, 0, tiltRotZ);
    }
    groupRef.current.rotation.setFromQuaternion(groupRef.current.quaternion, "XYZ");
    groupRef.current.updateMatrixWorld(true);

    // Sample vertices in world coordinate space (with rotation applied)
    const worldXs = [];
    const worldYs = [];
    const worldZs = [];

    scene.traverse((child) => {
      if (child.isMesh && child.geometry?.attributes?.position) {
        const pos = child.geometry.attributes.position;
        const v = new THREE.Vector3();
        const step = Math.max(1, Math.floor(pos.count / 2500));
        for (let i = 0; i < pos.count; i += step) {
          v.fromBufferAttribute(pos, i);
          v.applyMatrix4(child.matrixWorld);
          worldXs.push(v.x);
          worldYs.push(v.y);
          worldZs.push(v.z);
        }
      }
    });

    worldXs.sort((a, b) => a - b);
    worldYs.sort((a, b) => a - b);
    worldZs.sort((a, b) => a - b);

    const N = worldXs.length;
    // Robust 1.5% and 98.5% percentiles eliminate stray floating noise points
    const p1_x = worldXs[Math.floor(N * 0.015)];
    const p99_x = worldXs[Math.floor(N * 0.985)];
    const p1_z = worldZs[Math.floor(N * 0.015)];
    const p99_z = worldZs[Math.floor(N * 0.985)];

    // Floor and ceiling
    const floorY = worldYs[Math.floor(N * 0.025)];
    const ceilingY = worldYs[Math.floor(N * 0.975)];
    const rawHeight = Math.max(1.0, ceilingY - floorY);

    const centerX = (p1_x + p99_x) / 2;
    const centerZ = (p1_z + p99_z) / 2;

    const spanX = Math.max(2.0, p99_x - p1_x);
    const spanZ = Math.max(2.0, p99_z - p1_z);

    // Normalize height if unrealistically large (> 5.5m) or small (< 2.2m)
    let modelScale = 1.0;
    if (rawHeight > 5.5 || rawHeight < 2.2) {
      modelScale = THREE.MathUtils.clamp(3.8 / rawHeight, 0.4, 2.5);
    }

    // Check if mesh is already pre-enhanced, leveled, and canonical
    const isPreEnhanced = !isCOLMAPInverted &&
      Math.abs(tiltRotX) < 0.08 &&
      Math.abs(tiltRotZ) < 0.08 &&
      Math.abs(centerX) < 0.8 &&
      Math.abs(centerZ) < 0.8 &&
      Math.abs(floorY) < 0.35 &&
      rawHeight >= 2.0 && rawHeight <= 5.5;

    let finalPos = [-centerX * modelScale, -floorY * modelScale, -centerZ * modelScale];
    let finalRotation = [groupRef.current.rotation.x, groupRef.current.rotation.y, groupRef.current.rotation.z];

    if (isPreEnhanced) {
      // Keep exact 1:1 world coordinate correspondence with ForensicSimulation
      groupRef.current.position.set(0, 0, 0);
      groupRef.current.rotation.set(0, 0, 0);
      groupRef.current.scale.set(1, 1, 1);
      groupRef.current.updateMatrixWorld(true);
      modelScale = 1.0;
      finalPos = [0, 0, 0];
      finalRotation = [0, 0, 0];
    } else {
      groupRef.current.scale.setScalar(modelScale);
      groupRef.current.position.set(finalPos[0], finalPos[1], finalPos[2]);
      groupRef.current.updateMatrixWorld(true);
    }

    const finalSizeX = spanX * modelScale;
    const finalSizeY = rawHeight * modelScale;
    const finalSizeZ = spanZ * modelScale;

    setModelTransform({
      position: finalPos,
      scale: modelScale,
      rotation: finalRotation,
    });

    setBoundsInfo({
      width: finalSizeX,
      height: finalSizeY,
      depth: finalSizeZ,
    });

    const maxSpan = Math.max(finalSizeX, finalSizeZ);
    const roomRadius = Math.min(finalSizeX, finalSizeZ) * 0.44;

    // Position camera to look directly into the centered room at actor height (1.2m)
    const fovRad = (camera.fov * Math.PI) / 180;
    const dist = (maxSpan / 2 / Math.tan(fovRad / 2)) * 1.25;
    const camY = THREE.MathUtils.clamp(finalSizeY * 0.65, 1.8, 4.5);

    const rad = ((northOffset || 0) * Math.PI) / 180;
    const nx = Math.sin(rad);
    const nz = -Math.cos(rad);
    camera.position.set(-nx * dist, camY, -nz * dist);
    camera.near = 0.05;
    camera.far = maxSpan * 50;
    camera.updateProjectionMatrix();

    if (controlsRef?.current) {
      controlsRef.current.target.set(0, 1.2, 0);
      controlsRef.current.update();
    }

    if (onModelInfo) {
      onModelInfo({
        center: [0, 0, 0],
        floorY: 0,
        size: [finalSizeX, finalSizeY, finalSizeZ],
        radius: roomRadius,
        maxDim: maxSpan,
        modelScale,
      });
    }
  }, [scene, url, northOffset]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <group>
      <group
        ref={groupRef}
        position={modelTransform ? modelTransform.position : [0, 0, 0]}
        scale={modelTransform ? modelTransform.scale : 1}
        rotation={modelTransform ? modelTransform.rotation : [0, 0, 0]}
      >
        <primitive object={scene} />
      </group>
    </group>
  );
}

// ── Camera azimuth tracker (inside Canvas context) ────────────────────
function CameraTracker({ azimuthRef, controlsRef }) {
  const dirVec = useRef(new THREE.Vector3());
  useFrame(() => {
    if (!controlsRef.current?.object) return;
    const cam = controlsRef.current.object;
    cam.getWorldDirection(dirVec.current);
    // In Three.js: -Z is North (0°), +X is East (90°), +Z is South (180°), -X is West (270°)
    const az = (Math.atan2(dirVec.current.x, -dirVec.current.z) * (180 / Math.PI) + 360) % 360;
    azimuthRef.current = az;
  });
  return null;
}

// ── 3D Direction Markers (8 Directions, dynamically mapped to room walls & corners) ───────
function DirectionMarkers({ northOffset = 0, target = [0, 0, 0], radius = 2.4, roomSize = null, onSelectDirection }) {
  const halfX = roomSize ? roomSize[0] * 0.48 : Math.max(2.4, (radius || 2.6) * 0.95);
  const halfZ = roomSize ? roomSize[2] * 0.48 : Math.max(2.4, (radius || 2.6) * 0.95);

  const cardinals = [
    { label: "N", relPos: [0, -halfZ], isPrimary: true, isNorth: true },
    { label: "S", relPos: [0, halfZ], isPrimary: true },
    { label: "E", relPos: [halfX, 0], isPrimary: true },
    { label: "W", relPos: [-halfX, 0], isPrimary: true },
    { label: "NE", relPos: [halfX, -halfZ], isPrimary: false },
    { label: "NW", relPos: [-halfX, -halfZ], isPrimary: false },
    { label: "SE", relPos: [halfX, halfZ], isPrimary: false },
    { label: "SW", relPos: [-halfX, halfZ], isPrimary: false },
  ];

  const rotRad = (northOffset * Math.PI) / 180;
  const cosR = Math.cos(rotRad);
  const sinR = Math.sin(rotRad);

  return (
    <>
      {cardinals.map(({ label, relPos, isPrimary, isNorth }) => {
        // Position in XZ plane: pure walls at N (-Z), S (+Z), E (+X), W (-X) and corners at diagonals
        const rx = relPos[0] * cosR - relPos[1] * sinR;
        const rz = relPos[0] * sinR + relPos[1] * cosR;
        const px = target[0] + rx;
        const pz = target[2] + rz;
        const py = target[1] || 0.02;
        return (
          <Html key={label} position={[px, py + 0.3, pz]} center distanceFactor={18}>
            <div
              className={`dir-marker ${
                isNorth ? "dir-north" : !isPrimary ? "dir-intercardinal" : ""
              }`}
              style={{ cursor: "pointer" }}
              title={`Click to face ${label}`}
              onClick={(e) => {
                e.stopPropagation();
                onSelectDirection?.(label);
              }}
            >
              {label}
            </div>
          </Html>
        );
      })}
    </>
  );
}

// ── Compass Rose (HTML overlay, outside Canvas) ───────────────────────
function CompassOverlay({ azimuthRef, northOffset = 0, onAlignDirection }) {
  const roseRef = useRef(null);
  const [facing, setFacing] = useState("—");

  useEffect(() => {
    let raf;
    const tick = () => {
      const az = azimuthRef.current;
      const rot = -az + northOffset;

      if (roseRef.current) {
        // SVG-native rotate(angle, cx, cy) — pivot always at SVG centre (70,70).
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
    <div className="compass-container calibrated">
      {/* Compass rose */}
      <div
        className="compass-card"
        title="Compass · Click to face North"
      >
        {/* Heading indicator (fixed at top) */}
        <div className="compass-heading-pin" />

        <svg
          viewBox="0 0 140 140"
          className="compass-svg"
          onClick={() => onAlignDirection?.("N")}
          style={{ cursor: "pointer" }}
        >
          <defs>
            {/* Clip the rotating rose so needles/labels never bleed outside the bezel */}
            <clipPath id="compass-rose-clip">
              <circle cx="70" cy="70" r="62" />
            </clipPath>
          </defs>

          {/* Outer bezel (fixed) */}
          <circle cx="70" cy="70" r="66"
            fill="rgba(10,11,16,0.9)"
            stroke="rgba(59,107,255,0.6)"
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
                  style={{ cursor: "pointer" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAlignDirection?.(l);
                  }}
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
                  style={{ cursor: "pointer" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAlignDirection?.(l);
                  }}
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
          <span className="readout-label">Facing</span>
          <span className="readout-value">{facing}</span>
          <button
            type="button"
            className="compass-snap-btn"
            onClick={(e) => {
              e.stopPropagation();
              onAlignDirection?.("N");
            }}
            title="Face North"
          >
            🎯 Face North
          </button>
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
  status, logs, onGenerate, onReset, isRunning,
  onOpenThreatDetection,
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

      {/* ── Actions */}
      <div className="sidebar-actions">
        <button id="btn-generate" className="btn-generate"
          onClick={onGenerate}
          disabled={files.length === 0 || (isRunning && !status.error)}
        >
          {isRunning && !status.error
            ? <><div className="spinner" /> Processing…</>
            : status.error
              ? <><span className="btn-icon">↺</span> Retry 3D Generation</>
              : <><span className="btn-icon">✦</span> Generate 3D Room</>}
        </button>
        {(files.length > 0 || status.done || status.error) && (
          <button id="btn-reset" className="btn-reset"
            onClick={onReset} disabled={isRunning && !status.error}>
            ↺ Reset
          </button>
        )}
        <button
          type="button"
          className="btn-threat-analysis"
          onClick={onOpenThreatDetection}
          title="Open AI Weapon & Threat Detection Tab"
        >
          <span>🔬</span> Weapon &amp; Threat Detection Tab →
        </button>
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
  // View mode tab: "3d_scene" (3D Room Reconstruction) or "recreation" (Crime Recreation Studio)
  const [activeTab, setActiveTab] = useState("3d_scene");

  // Scene photos
  const [files, setFiles] = useState([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef(null);

  // Compass calibration - default North aligns room symmetrically
  const [northOffset, setNorthOffset] = useState(0);
  const [compassCalibrated, setCalibrated] = useState(true);
  const azimuthRef = useRef(0); // live camera azimuth (updated each frame)
  const controlsRef = useRef(null);
  const canvasRef = useRef(null);

  // Reconstruction state
  const [status, setStatus] = useState({ phase: "idle", log: "", progress: 0, done: false, error: null });
  const [logs, setLogs] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [modelUrl, setModelUrl] = useState(null);
  const [modelKey, setModelKey] = useState(0);
  const [modelInfo, setModelInfo] = useState(null);
  const sseRef = useRef(null);

  // ── Crime Recreation & Video Simulation State ────────────────────────
  const [planData, setPlanData] = useState(null);
  const [sceneObjects, setSceneObjects] = useState([]);
  const [isPlanning, setIsPlanning] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [cameraMode, setCameraMode] = useState("orbit");
  const [showRoutes, setShowRoutes] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showAnchors, setShowAnchors] = useState(false);
  const [geminiApiKey, setGeminiApiKey] = useState(
    () => localStorage.getItem("forensic_gemini_key") || ""
  );

  // ── Fetch physical room objects and 8-direction labels ───────────────
  const fetchSceneObjects = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/scene/objects`);
      if (r.ok) {
        const data = await r.json();
        if (data.objects) setSceneObjects(data.objects);
        if (data.northOffset !== undefined) {
          setNorthOffset(data.northOffset);
          setCalibrated(true);
        }
      }
    } catch (_) {}
  }, []);

  // ── On mount / page refresh: clean up any earlier models so the user starts fresh ──
  useEffect(() => {
    setModelUrl(null);
    setModelInfo(null);
    setPlanData(null);
    setSceneObjects([]);
    setStatus({ phase: "idle", log: "", progress: 0, done: false, error: null });
    // Tell backend to thoroughly clean up previous model artifacts
    fetch(`${API}/api/reset`, { method: "POST" }).catch(() => {});
  }, []);

  const modelUrlToLoad = modelUrl;

  // ── Plan generation handler ──────────────────────────────────────────
  const handleGenerateRecreationPlan = useCallback(
    async (promptText) => {
      setIsPlanning(true);
      try {
        const halfX = (modelInfo?.size?.[0] || 6.0) / 2;
        const halfZ = (modelInfo?.size?.[2] || 6.0) / 2;
        const heightY = modelInfo?.size?.[1] || 3.8;
        const boundsPayload = {
          min: [-halfX, 0, -halfZ],
          max: [halfX, heightY, halfZ],
          center: [0, 0, 0],
          size: [halfX * 2, heightY, halfZ * 2],
          radius: modelInfo?.radius || Math.hypot(halfX, halfZ) * 0.7,
        };

        const res = await fetch(`${API}/api/recreation/plan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: promptText,
            apiKey: geminiApiKey || undefined,
            bounds: boundsPayload,
            directionMeta: {
              direction: "N",
              northOffset: northOffset || 0,
              calibrated: true,
            },
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Server responded with ${res.status}`);
        }

        const data = await res.json();
        setPlanData(data);
        setCurrentTime(0);
        setIsPlaying(true);
      } catch (err) {
        console.error("Recreation plan error:", err);
        alert(`Error generating simulation: ${err.message}`);
      } finally {
        setIsPlanning(false);
      }
    },
    [geminiApiKey, modelInfo, northOffset, compassCalibrated]
  );

  // ── Auto-load saved recreation plan if available on server ───────────
  useEffect(() => {
    fetch(`${API}/api/recreation/plan`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.plan) {
          setPlanData(data);
          setCurrentTime(0);
        }
      })
      .catch(() => {});
  }, []);

  // ── Clock tick handler ───────────────────────────────────────────────
  const duration = planData?.plan?.duration || 10;
  const handleClockTick = useCallback(
    (deltaSec) => {
      setCurrentTime((prev) => {
        const next = prev + deltaSec;
        if (next >= duration) {
          setIsPlaying(false);
          return duration;
        }
        return next;
      });
    },
    [duration]
  );

  // ── Active narrative caption computed from timeline ──────────────────
  const activeCaption = useMemo(() => {
    if (!planData?.plan?.captions) return "";
    let cap = "";
    for (const c of planData.plan.captions) {
      if (c.t <= currentTime) cap = c.text;
    }
    return cap;
  }, [planData, currentTime]);

  // ── Gemini API key storage ───────────────────────────────────────────
  const handleApiKeyChange = useCallback((newKey) => {
    setGeminiApiKey(newKey);
    if (newKey) localStorage.setItem("forensic_gemini_key", newKey);
    else localStorage.removeItem("forensic_gemini_key");
  }, []);

  // ── SSE connection ───────────────────────────────────────────────────
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
        fetchSceneObjects();
      }
      if (data.error || data.phase === "error") {
        setIsRunning(false);
      }
    };
    return () => es.close();
  }, [fetchSceneObjects]);

  // ── Align 3D Camera to Cardinal Direction (e.g. North) ────────────────
  const alignCameraToDirection = useCallback(
    (dir = "N") => {
      if (!controlsRef.current) return;
      const cam = controlsRef.current.object;
      const target = controlsRef.current.target || new THREE.Vector3(0, 1.2, 0);
      const dist = Math.hypot(cam.position.x - target.x, cam.position.z - target.z) || 5.0;
      const camY = THREE.MathUtils.clamp(cam.position.y, 1.8, 4.5);

      const targetDirAngle = DIR_ANGLES[dir] ?? 0;
      const rad = ((northOffset + targetDirAngle) * Math.PI) / 180;
      const nx = Math.sin(rad);
      const nz = -Math.cos(rad);

      cam.position.set(target.x - nx * dist, camY, target.z - nz * dist);
      controlsRef.current.update();
    },
    [northOffset]
  );

  // ── Scene photo handling ─────────────────────────────────────────────
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);
    setModelUrl(null);
    setModelInfo(null);
    setPlanData(null);
    setSceneObjects([]);
    setStatus({ phase: "idle", log: "", progress: 0, done: false, error: null });
    setIsRunning(false);
    setFiles(Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/")));
    fetch(`${API}/api/reset`, { method: "POST" }).catch(() => {});
  }, []);
  const handleDragOver = useCallback((e) => { e.preventDefault(); setIsDragOver(true); }, []);
  const handleDragLeave = useCallback(() => setIsDragOver(false), []);
  const handleFileChange = useCallback((e) => {
    setModelUrl(null);
    setModelInfo(null);
    setPlanData(null);
    setSceneObjects([]);
    setStatus({ phase: "idle", log: "", progress: 0, done: false, error: null });
    setIsRunning(false);
    setFiles(Array.from(e.target.files));
    fetch(`${API}/api/reset`, { method: "POST" }).catch(() => {});
  }, []);
  const handleZoneClick = useCallback(() => fileInputRef.current?.click(), []);

  // ── 3D Reconstruction Generate ───────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!files.length) return;
    setIsRunning(true);
    setStatus({ phase: "starting", log: "Starting reconstruction…", progress: 5, done: false, error: null });
    setLogs([]);
    setModelUrl(null);
    setModelInfo(null);
    setPlanData(null);
    setSceneObjects([]);

    // Clear any previous session models and images so different batches don't mix
    await fetch(`${API}/api/reset`, { method: "POST" }).catch(() => {});

    const form = new FormData();
    files.forEach((f) => form.append("images", f));
    form.append("direction", "N");
    try {
      const r = await fetch(`${API}/api/upload`, { method: "POST", body: form });
      if (!r.ok) throw new Error("Upload failed");
    } catch (err) {
      setLogs((p) => [...p, `ERROR: ${err.message}`]);
      setStatus({ phase: "error", log: err.message, progress: 0, done: false, error: err.message });
      setIsRunning(false);
      return;
    }

    try {
      await fetch(`${API}/api/reconstruct`, { method: "POST" });
    } catch (err) {
      setLogs((p) => [...p, `ERROR: ${err.message}`]);
      setStatus({ phase: "error", log: err.message, progress: 0, done: false, error: err.message });
      setIsRunning(false);
    }
  }, [files]);

  // ── Reset ────────────────────────────────────────────────────────────
  const handleReset = useCallback(async () => {
    setFiles([]);
    setLogs([]);
    setModelUrl(null);
    setModelInfo(null);
    setPlanData(null);
    setSceneObjects([]);
    setStatus({ phase: "idle", log: "", progress: 0, done: false, error: null });
    if (fileInputRef.current) fileInputRef.current.value = "";
    await fetch(`${API}/api/reset`, { method: "POST" }).catch(() => {});
  }, []);

  const sceneCenter = [0, 0, 0];
  const sceneRadius = modelInfo?.radius || 2.4;

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
        onOpenThreatDetection={() => setActiveTab("threat_detection")}
      />

      {/* ── 3D Viewer & Simulation Canvas ── */}
      <main className={`viewer-area ${activeTab === "recreation" ? "recreation-mode" : ""} ${activeTab === "threat_detection" ? "threat-mode" : ""}`}>
        <div className="viewer-topbar">
          <div className="viewer-topbar-left">
            <span
              className={`viewer-tab ${activeTab === "recreation" ? "active" : ""}`}
              onClick={() => setActiveTab("recreation")}
            >
              🎬 Crime Recreation Studio
            </span>
            <span
              className={`viewer-tab ${activeTab === "3d_scene" ? "active" : ""}`}
              onClick={() => setActiveTab("3d_scene")}
            >
              🏢 3D Photogrammetry Room
            </span>
            <span
              className={`viewer-tab ${activeTab === "threat_detection" ? "active" : ""}`}
              onClick={() => setActiveTab("threat_detection")}
            >
              🔬 Threat & Evidence Analysis
            </span>

            {activeTab !== "threat_detection" && modelUrl && <span className="viewer-badge">✓ 3D Mesh Active</span>}
            {activeTab !== "threat_detection" && (
              <button
                id="btn-face-direction"
                className="btn-face-quick"
                title="Orient 3D view to face North"
                onClick={() => alignCameraToDirection("N")}
              >
                🎯 Face North
              </button>
            )}
          </div>

          <div className="viewer-topbar-right">
            {modelUrlToLoad && (
              <a
                href={modelUrlToLoad}
                download="scene_textured.glb"
                className="download-link"
              >
                ↓ Download GLB
              </a>
            )}
          </div>
        </div>

        {/* ── Top Section: Crime Recreation Controls appear on TOP ── */}
        {activeTab === "recreation" && (
          <div className="recreation-top-container">
            <RecreationStudio
              planData={planData}
              sceneObjects={sceneObjects}
              onGeneratePlan={handleGenerateRecreationPlan}
              isPlanning={isPlanning}
              currentTime={currentTime}
              onTimeChange={setCurrentTime}
              isPlaying={isPlaying}
              onTogglePlay={() => {
                if (currentTime >= duration) setCurrentTime(0);
                setIsPlaying(!isPlaying);
              }}
              onRestart={() => {
                setCurrentTime(0);
                setIsPlaying(true);
              }}
              speed={playbackSpeed}
              onSpeedChange={setPlaybackSpeed}
              cameraMode={cameraMode}
              onCameraModeChange={setCameraMode}
              showRoutes={showRoutes}
              onToggleRoutes={setShowRoutes}
              showLabels={showLabels}
              onToggleLabels={setShowLabels}
              showAnchors={showAnchors}
              onToggleAnchors={setShowAnchors}
              activeCaption={activeCaption}
              getCanvasElement={() => canvasRef.current || document.querySelector("canvas")}
              apiKey={geminiApiKey}
              onApiKeyChange={handleApiKeyChange}
              onScrollTo3D={() => {
                document.getElementById("simulation-canvas-section")?.scrollIntoView({ behavior: "smooth" });
              }}
            />
          </div>
        )}

        {/* Threat Detection & Evidence Analysis Tab */}
        {activeTab === "threat_detection" && (
          <div style={{ flex: 1, width: "100%", height: "calc(100% - 49px)", overflowY: "auto", position: "relative", zIndex: 1 }}>
            <ThreatDetectionTab
              onSwitchTo3D={() => setActiveTab("3d_scene")}
              onSwitchToStudio={() => setActiveTab("recreation")}
            />
          </div>
        )}

        {/* ── 3D Model Section: When we scroll, at the bottom we get the 3D model ── */}
        {activeTab !== "threat_detection" && (
          <div
            id="simulation-canvas-section"
            className={`viewer-canvas ${activeTab === "recreation" ? "recreation-canvas" : ""}`}
          >
            <Canvas
              key={modelKey}
              camera={{ position: [0, 2.5, 5.5], fov: 55, near: 0.01, far: 500 }}
              style={{ width: "100%", height: "100%" }}
              gl={{ preserveDrawingBuffer: true, antialias: true }}
            >
              <ambientLight intensity={1.3} />
              <directionalLight position={[6, 12, 6]} intensity={2.2} castShadow />
              <directionalLight position={[-6, 8, -6]} intensity={0.8} />

              {/* Grid Floor */}
              <Grid
                position={[sceneCenter[0], -0.01, sceneCenter[2]]}
                infiniteGrid
                cellSize={0.5}
                sectionSize={2}
                cellColor="#1e2130"
                sectionColor="#2a3048"
                fadeDistance={35}
              />

              {/* Architectural Grounding Plinth / Forensic Diorama Base */}
              <group position={[sceneCenter[0], -0.04, sceneCenter[2]]}>
                <mesh receiveShadow position={[0, -0.02, 0]}>
                  <cylinderGeometry args={[Math.max(3.8, sceneRadius * 1.35), Math.max(4.0, sceneRadius * 1.4), 0.08, 64]} />
                  <meshStandardMaterial
                    color="#141721"
                    roughness={0.92}
                    metalness={0.04}
                  />
                </mesh>
                <mesh position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                  <ringGeometry args={[Math.max(3.7, sceneRadius * 1.32), Math.max(3.75, sceneRadius * 1.35), 64]} />
                  <meshBasicMaterial color="#38bdf8" opacity={0.3} transparent />
                </mesh>
              </group>

              {/* Model if available */}
              {modelUrlToLoad && (
                <Suspense fallback={null}>
                  <ModelWithCamera
                    url={modelUrlToLoad}
                    controlsRef={controlsRef}
                    onModelInfo={setModelInfo}
                    northOffset={northOffset}
                  />
                </Suspense>
              )}

              {/* Fallback room wireframe and compass if no photogrammetry mesh */}
              {!modelUrlToLoad && (
                <ForensicSpatialRoom
                  center={sceneCenter}
                  radius={sceneRadius}
                  northOffset={northOffset}
                  roomSize={modelInfo?.size}
                />
              )}

              {/* Direction markers (both 3D Scene and Recreation Studio tabs) */}
              {compassCalibrated && (
                <DirectionMarkers
                  northOffset={northOffset}
                  target={sceneCenter}
                  radius={sceneRadius}
                  roomSize={modelInfo?.size}
                  onSelectDirection={alignCameraToDirection}
                />
              )}

              {/* In 3D Scene tab: show physical room anchors (doors, chairs, table) when enabled */}
              {activeTab === "3d_scene" && showAnchors && sceneObjects.length > 0 && (
                <group>
                  {sceneObjects.map((obj) => (
                    <SceneAnchorMarker key={obj.id} name={obj.id} anchor={obj} />
                  ))}
                </group>
              )}

              {/* Forensic Crime Reenactment Simulation with Dummies - in recreation tab */}
              {activeTab === "recreation" && (planData || sceneObjects.length > 0) && (
                <ForensicSimulation
                  plan={planData?.plan}
                  anchors={planData?.anchors}
                  physicalObjects={planData?.physicalObjects || sceneObjects}
                  currentTime={currentTime}
                  cameraMode={cameraMode}
                  controlsRef={controlsRef}
                  showRoutes={showRoutes}
                  showLabels={showLabels}
                  showAnchors={showAnchors}
                  center={sceneCenter}
                  radius={sceneRadius}
                />
              )}

              {/* Simulation Clock & WebGL Canvas Link */}
              <SimulationClock
                isPlaying={isPlaying}
                speed={playbackSpeed}
                onTick={handleClockTick}
              />
              <CanvasCaptureRef canvasRef={canvasRef} />

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

            {/* Placeholder when in 3D Scene tab without a model */}
            {activeTab === "3d_scene" && !modelUrl && (
              <div className="viewer-placeholder" style={{ zIndex: 10 }}>
                <BuildingIcon />
                <p className="placeholder-text">
                  {isRunning
                    ? "Reconstruction in progress — model will appear here when ready…"
                    : 'Upload photos and click "Generate 3D Room" to begin, or switch to Crime Recreation tab.'}
                </p>
              </div>
            )}

            {/* Compass overlay */}
            <CompassOverlay
              azimuthRef={azimuthRef}
              northOffset={northOffset}
              onAlignDirection={alignCameraToDirection}
            />
          </div>
        )}
      </main>
    </div>
  );
}