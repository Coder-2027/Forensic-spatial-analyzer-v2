import { useRef, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import ForensicMannequin from "./ForensicMannequin";

/**
 * Animated Impact Shockwave Ring
 */
function ImpactRing({ impact, currentTime }) {
  const meshRef = useRef();
  const d = currentTime - impact.t;
  const isVisible = d >= 0 && d < 1.5;

  useFrame(() => {
    if (!meshRef.current) return;
    if (isVisible) {
      const u = d / 1.5;
      meshRef.current.visible = true;
      meshRef.current.scale.setScalar(1 + 2.8 * u);
      meshRef.current.material.opacity = Math.max(0, 1 - u);
    } else {
      meshRef.current.visible = false;
    }
  });

  return (
    <mesh
      ref={meshRef}
      position={impact.pos}
      rotation={[-Math.PI / 2, 0, 0]}
      visible={isVisible}
    >
      <ringGeometry args={[0.15, 0.28, 48]} />
      <meshBasicMaterial
        color="#ff4466"
        transparent
        opacity={1}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

/**
 * 3D Dashed Floor Path for an Actor
 */
function ActorPath({ lines = [], color = "#ef4444" }) {
  const lineObjects = useMemo(() => {
    return lines.map((segment) => {
      const points = segment.map((p) => {
        const fy = p.length >= 3 ? p[2] : (p.y || 0.02);
        return new THREE.Vector3(p[0], fy + 0.025, p[1]);
      });
      const geom = new THREE.BufferGeometry().setFromPoints(points);
      const mat = new THREE.LineDashedMaterial({
        color: new THREE.Color(color),
        dashSize: 0.14,
        gapSize: 0.08,
        linewidth: 2,
        transparent: true,
        opacity: 0.75
      });
      const line = new THREE.Line(geom, mat);
      line.computeLineDistances();
      return line;
    });
  }, [lines, color]);

  return (
    <group>
      {lineObjects.map((obj, i) => (
        <primitive key={i} object={obj} />
      ))}
    </group>
  );
}

/**
 * 3D Firearm Ballistics FX: Muzzle flash, dynamic projectile tracer beam,
 * and persistent forensic laser trajectory line.
 */
function BallisticTracerFX({ shot, currentTime }) {
  const d = currentTime - shot.tShoot;
  const isShooting = d >= 0 && d <= (shot.duration || 0.28);
  const isAfterShot = d > (shot.duration || 0.28);

  const fromV = useMemo(() => new THREE.Vector3(...shot.from), [shot.from]);
  const toV = useMemo(() => new THREE.Vector3(...shot.to), [shot.to]);
  const midV = useMemo(() => new THREE.Vector3().lerpVectors(fromV, toV, 0.5), [fromV, toV]);

  // Projectile position along line
  const projPos = useMemo(() => {
    const u = Math.min(1, Math.max(0, d / (shot.duration || 0.28)));
    return new THREE.Vector3().lerpVectors(fromV, toV, u);
  }, [fromV, toV, d, shot.duration]);

  // Trajectory dashed laser line
  const trajectoryLine = useMemo(() => {
    const geom = new THREE.BufferGeometry().setFromPoints([fromV, toV]);
    const mat = new THREE.LineDashedMaterial({
      color: "#ef4444",
      dashSize: 0.12,
      gapSize: 0.08,
      linewidth: 2,
      transparent: true,
      opacity: 0.7
    });
    const line = new THREE.Line(geom, mat);
    line.computeLineDistances();
    return line;
  }, [fromV, toV]);

  return (
    <group>
      {/* 1. Instantaneous Muzzle Flash at Gun Tip */}
      {isShooting && d < 0.14 && (
        <group position={shot.from}>
          <pointLight color="#fef08a" intensity={8} distance={4} />
          {/* Visual glowing flash sphere/diamond */}
          <mesh>
            <octahedronGeometry args={[0.08, 0]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
          <mesh>
            <octahedronGeometry args={[0.16, 0]} />
            <meshBasicMaterial color="#f59e0b" transparent opacity={0.8} />
          </mesh>
        </group>
      )}

      {/* 2. High-Velocity Projectile Tracer */}
      {isShooting && (
        <group position={projPos}>
          <mesh>
            <sphereGeometry args={[0.035, 12, 12]} />
            <meshBasicMaterial color="#fef08a" />
          </mesh>
          <pointLight color="#f59e0b" intensity={3} distance={2} />
        </group>
      )}

      {/* 3. Persistent Forensic Trajectory Laser (Real Forensics Ballistic Line) */}
      {isAfterShot && (
        <group>
          <primitive object={trajectoryLine} />
          {/* Label at midpoint */}
          <Html position={[midV.x, midV.y + 0.15, midV.z]} center distanceFactor={14}>
            <div
              style={{
                padding: "2px 6px",
                borderRadius: "3px",
                background: "rgba(185, 28, 28, 0.85)",
                border: "1px solid #ef4444",
                color: "#ffffff",
                fontSize: "9px",
                fontWeight: "700",
                letterSpacing: "0.5px",
                whiteSpace: "nowrap",
                pointerEvents: "none"
              }}
            >
              TRAJECTORY {shot.id?.toUpperCase() || "#1"} (BALLISTICS)
            </div>
          </Html>
        </group>
      )}
    </group>
  );
}

/**
 * Dropped Weapon on Floor with Yellow Forensic Evidence Marker Tent
 */
function DroppedWeaponMarker({ item, currentTime }) {
  if (currentTime < item.t) return null;

  const isGun = item.weapon === "gun" || item.weapon === "pistol";
  const isKnife = item.weapon === "knife" || item.weapon === "dagger";
  const isBat = item.weapon === "bat" || item.weapon === "baseball_bat" || item.weapon === "club";
  const isCrowbar = (item.weapon === "crowbar" || item.weapon === "hammer" || item.weapon === "pipe") && !isBat;

  const numStr = String(item.evidenceNum || 1).padStart(2, "0");

  return (
    <group position={[item.pos[0], item.y || 0.02, item.pos[1]]}>
      {/* Dropped weapon prop resting flat on floor */}
      <group rotation={[0, item.yaw || 0, Math.PI / 2]}>
        {isGun && (
          <mesh position={[0, 0.015, 0]}>
            <boxGeometry args={[0.035, 0.045, 0.16]} />
            <meshStandardMaterial color="#1f2937" roughness={0.4} metalness={0.8} />
          </mesh>
        )}
        {isKnife && (
          <mesh position={[0, 0.01, 0]}>
            <boxGeometry args={[0.008, 0.035, 0.22]} />
            <meshStandardMaterial color="#e2e8f0" roughness={0.2} metalness={0.9} />
          </mesh>
        )}
        {isBat && (
          <mesh position={[0, 0.015, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.022, 0.014, 0.62, 10]} />
            <meshStandardMaterial color="#d97706" roughness={0.6} metalness={0.05} />
          </mesh>
        )}
        {isCrowbar && (
          <mesh position={[0, 0.015, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.014, 0.014, 0.6, 8]} />
            <meshStandardMaterial color="#991b1b" roughness={0.3} metalness={0.7} />
          </mesh>
        )}
      </group>

      {/* Yellow Forensic Evidence Tent Marker (Classic Crime Scene Number Card) */}
      <group position={[0.2, 0, 0.15]}>
        {/* A-frame tent card */}
        <mesh position={[0, 0.06, 0]} rotation={[0, 0.3, 0]}>
          <coneGeometry args={[0.08, 0.12, 3]} />
          <meshStandardMaterial color="#facc15" roughness={0.5} />
        </mesh>

        {/* Forensic Item Label */}
        <Html position={[0, 0.22, 0]} center distanceFactor={12}>
          <div
            style={{
              padding: "1px 5px",
              borderRadius: "2px",
              background: "#facc15",
              color: "#000000",
              fontSize: "10px",
              fontWeight: "900",
              fontFamily: "monospace",
              border: "1px solid #ca8a04",
              whiteSpace: "nowrap",
              boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
              pointerEvents: "none"
            }}
          >
            EVID #{numStr}: {item.weapon?.toUpperCase() || "WEAPON"}
          </div>
        </Html>
      </group>
    </group>
  );
}

/**
 * 3D Cardinal & Physical Room Anchor Visualizer (North Door, East Window, Chair, etc.)
 */
export function SceneAnchorMarker({ name, anchor }) {
  const isDoor = anchor.type === "door";
  const isWindow = anchor.type === "window";
  const isVerified = Boolean(anchor.verified);
  const color = isVerified
    ? (isDoor ? "#10b981" : isWindow ? "#38bdf8" : "#f59e0b")
    : (isDoor ? "#22d3a0" : isWindow ? "#38bdf8" : "#94a3b8");

  const sector = anchor.sector || "";
  const icon = isDoor ? "🚪" : isWindow ? "🪟" : anchor.type === "chair" ? "🪑" : anchor.type === "table" ? "🪵" : anchor.type === "bed" ? "🛏️" : "📍";

  const displayLabel = anchor.label || name;
  const hasSectorAlready = sector && (displayLabel.includes(`[${sector}]`) || displayLabel.includes(`(${sector})`));

  const isChair = anchor.type === "chair";
  const isTable = anchor.type === "table";
  const inwardAngle = anchor.inward ? Math.atan2(anchor.inward[0], anchor.inward[1]) : 0;

  return (
    <group position={[anchor.pos[0], anchor.y || 0.015, anchor.pos[1]]}>
      {/* 3D Physical Chair Model */}
      {isChair && (
        <group rotation={[0, inwardAngle, 0]}>
          {/* Seat Cushion (height 0.44m matches sitting mannequin hip height 0.52m) */}
          <mesh position={[0, 0.44, 0]} castShadow>
            <boxGeometry args={[0.50, 0.07, 0.48]} />
            <meshStandardMaterial color="#78350f" roughness={0.65} metalness={0.1} />
          </mesh>
          {/* Backrest */}
          <mesh position={[0, 0.72, -0.21]} castShadow>
            <boxGeometry args={[0.46, 0.48, 0.04]} />
            <meshStandardMaterial color="#92400e" roughness={0.6} metalness={0.05} />
          </mesh>
          {/* 4 Wooden Legs */}
          {[[-0.20, -0.19], [0.20, -0.19], [-0.20, 0.19], [0.20, 0.19]].map(([lx, lz], li) => (
            <mesh key={li} position={[lx, 0.22, lz]} castShadow>
              <cylinderGeometry args={[0.018, 0.018, 0.44, 8]} />
              <meshStandardMaterial color="#451a03" roughness={0.8} />
            </mesh>
          ))}
        </group>
      )}

      {/* 3D Physical Central Table Model (obstacle in middle of room) */}
      {isTable && (
        <group rotation={[0, inwardAngle, 0]}>
          {/* Table Top Surface */}
          <mesh position={[0, 0.50, 0]} castShadow>
            <boxGeometry args={[1.60, 0.06, 1.10]} />
            <meshStandardMaterial color="#991b1b" roughness={0.45} metalness={0.1} />
          </mesh>
          {/* Tablecloth center cloth */}
          <mesh position={[0, 0.505, 0]}>
            <boxGeometry args={[1.35, 0.062, 0.85]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.7} />
          </mesh>
          {/* 4 Sturdy Table Legs */}
          {[[-0.70, -0.45], [0.70, -0.45], [-0.70, 0.45], [0.70, 0.45]].map(([lx, lz], li) => (
            <mesh key={li} position={[lx, 0.25, lz]} castShadow>
              <cylinderGeometry args={[0.035, 0.035, 0.50, 8]} />
              <meshStandardMaterial color="#3e2723" roughness={0.8} />
            </mesh>
          ))}
        </group>
      )}

      {/* Ground Ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.22, 0.32, 32]} />
        <meshBasicMaterial color={color} side={THREE.DoubleSide} transparent opacity={isVerified ? 0.85 : 0.6} />
      </mesh>

      {/* Verified inner beacon */}
      {isVerified && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
          <circleGeometry args={[0.09, 16]} />
          <meshBasicMaterial color={color} side={THREE.DoubleSide} transparent opacity={0.9} />
        </mesh>
      )}

      {/* Direction normal arrow if inward defined */}
      {anchor.inward && !isChair && !isTable && (
        <group rotation={[0, Math.atan2(anchor.inward[0], anchor.inward[1]), 0]}>
          <mesh position={[0, 0.01, 0.22]} rotation={[-Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.08, 0.18, 16]} />
            <meshBasicMaterial color={color} />
          </mesh>
        </group>
      )}

      {/* Overhead Label with 8-direction sector and verified badge */}
      <Html position={[0, 0.45, 0]} center distanceFactor={16}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            padding: "3px 8px",
            borderRadius: "5px",
            background: "rgba(10, 13, 20, 0.95)",
            border: `1px solid ${color}`,
            color: "#f1f5f9",
            fontSize: "11px",
            fontWeight: "600",
            letterSpacing: "0.3px",
            whiteSpace: "nowrap",
            boxShadow: `0 2px 10px rgba(0, 0, 0, 0.6), 0 0 10px ${color}33`,
            pointerEvents: "none"
          }}
        >
          <span>{icon}</span>
          <span>{displayLabel}</span>
          {sector && !hasSectorAlready && (
            <span
              style={{
                fontSize: "9px",
                fontWeight: "700",
                padding: "1px 5px",
                borderRadius: "3px",
                background: isVerified ? "rgba(16, 185, 129, 0.25)" : "rgba(148, 163, 184, 0.2)",
                color: isVerified ? "#34d399" : "#cbd5e1",
                border: `1px solid ${isVerified ? "#10b98166" : "#64748b44"}`
              }}
            >
              {sector}
            </span>
          )}
          {isVerified && (
            <span
              title="Verified physical room object"
              style={{
                fontSize: "10px",
                color: "#10b981",
                fontWeight: "800"
              }}
            >
              ✓
            </span>
          )}
        </div>
      </Html>
    </group>
  );
}

/**
 * Forensic 3D Crime Scene Recreation Simulation Component
 */
export default function ForensicSimulation({
  plan,
  anchors = {},
  physicalObjects = [],
  currentTime = 0,
  cameraMode = "orbit", // orbit | follow_killer | follow_victim | surveillance | director
  controlsRef,
  showRoutes = true,
  showLabels = true,
  showAnchors = false,
  center = [0, 0, 0],
  radius = 5
}) {
  const { camera } = useThree();

  // Find perpetrator and victim IDs
  const perpId = useMemo(() => {
    if (!plan?.roles) return null;
    return Object.keys(plan.roles).find(
      (k) => plan.roles[k] === "perpetrator" || plan.roles[k] === "killer"
    ) || Object.keys(plan.roles)[0];
  }, [plan]);

  const victimId = useMemo(() => {
    if (!plan?.roles) return null;
    return Object.keys(plan.roles).find((k) => plan.roles[k] === "victim");
  }, [plan]);

  // Deduplicate and filter scene anchors so we display clean, canonical landmarks
  const displayAnchors = useMemo(() => {
    if (!showAnchors) return [];

    const effectiveAnchors = { ...(anchors || {}) };
    if (Array.isArray(physicalObjects)) {
      for (const po of physicalObjects) {
        if (!effectiveAnchors[po.id]) {
          effectiveAnchors[po.id] = {
            pos: po.pos || [po.position?.[0] || 0, po.position?.[2] || 0],
            y: po.y || po.position?.[1] || 0.02,
            type: po.type,
            label: po.label,
            sector: po.sector,
            verified: po.verified,
            inward: po.inward,
            source: "physical",
          };
        }
      }
    }

    // Collect all anchor names specifically referenced in plan events and actors
    const usedAnchors = new Set();
    if (plan?.events) {
      for (const ev of plan.events) {
        if (ev.anchor) usedAnchors.add(ev.anchor);
        if (ev.target) usedAnchors.add(ev.target);
        if (ev.from_anchor) usedAnchors.add(ev.from_anchor);
      }
    }
    if (plan?.actors) {
      for (const act of Object.values(plan.actors)) {
        if (act.start?.at) usedAnchors.add(act.start.at);
        if (act.startAnchor) usedAnchors.add(act.startAnchor);
      }
    }

    // Canonical primary anchors for clean default room layout
    const canonicalKeys = new Set([
      "door_north", "door_south", "door_east", "door_west",
      "window_north", "window_south", "window_east", "window_west",
      "chair_center", "couch_center", "desk_east", "table_west",
      "door_main", "chair_center"
    ]);

    const entries = Object.entries(effectiveAnchors);
    // Prioritize physical/verified objects and used anchors first
    entries.sort(([k1, a1], [k2, a2]) => {
      const p1 = (a1.verified ? 3 : 0) + (usedAnchors.has(k1) ? 2 : (canonicalKeys.has(k1) ? 1 : 0));
      const p2 = (a2.verified ? 3 : 0) + (usedAnchors.has(k2) ? 2 : (canonicalKeys.has(k2) ? 1 : 0));
      return p2 - p1;
    });

    const seenPositions = new Set();
    const result = [];

    for (const [name, anc] of entries) {
      if (!anc || !anc.pos) continue;
      const isUsed = usedAnchors.has(name);
      const isCanonical = canonicalKeys.has(name);
      const isVerified = Boolean(anc.verified) || anc.source === "physical";
      // Skip redundant short aliases unless used, canonical, or verified physical object
      if (!isUsed && !isCanonical && !isVerified) continue;

      // Deduplicate overlapping positions within 0.35m
      const gridX = Math.round(anc.pos[0] * 2) / 2;
      const gridZ = Math.round(anc.pos[1] * 2) / 2;
      const posKey = `${gridX},${gridZ}`;

      if (!seenPositions.has(posKey)) {
        seenPositions.add(posKey);
        result.push({ name, ...anc });
      }
    }

    return result;
  }, [anchors, physicalObjects, showAnchors, plan]);

  // Helper to get actor position at current time
  const getActorCurrentPos = (aid) => {
    const trk = plan?.tracks?.[aid];
    if (!trk || trk.length === 0) return null;
    let i = 0;
    while (i + 1 < trk.length && trk[i + 1].t0 <= currentTime) i++;
    const s = trk[i];
    if (s.kind === "hidden") return null;
    const u = Math.min(1, Math.max(0, (currentTime - s.t0) / Math.max(1e-5, s.t1 - s.t0)));
    const x = s.from[0] + (s.to[0] - s.from[0]) * u;
    const z = s.from[1] + (s.to[1] - s.from[1]) * u;
    return { x, z, yaw: s.yaw };
  };

  // Dynamic Camera Controller
  useFrame(() => {
    if (!controlsRef?.current) return;
    const controls = controlsRef.current;

    if (cameraMode === "follow_killer" && perpId) {
      const p = getActorCurrentPos(perpId);
      if (p) {
        const targetCamX = p.x - Math.sin(p.yaw) * 2.3;
        const targetCamZ = p.z - Math.cos(p.yaw) * 2.3;
        camera.position.lerp(new THREE.Vector3(targetCamX, 1.8, targetCamZ), 0.1);
        controls.target.lerp(new THREE.Vector3(p.x, 1.15, p.z), 0.15);
      }

    } else if (cameraMode === "follow_victim" && victimId) {
      const v = getActorCurrentPos(victimId);
      if (v) {
        camera.position.lerp(new THREE.Vector3(v.x + 1.8, 1.7, v.z + 1.8), 0.08);
        controls.target.lerp(new THREE.Vector3(v.x, 0.9, v.z), 0.12);
      }

    } else if (cameraMode === "surveillance") {
      // Overhead CCTV top-down perspective
      const cx = center[0];
      const cz = center[1] || center[2] || 0;
      camera.position.lerp(new THREE.Vector3(cx, Math.max(6.5, radius * 1.6), cz + 0.01), 0.08);
      controls.target.lerp(new THREE.Vector3(cx, 0, cz), 0.1);

    } else if (cameraMode === "director") {
      // Cinematic Director cut based on active narrative events
      const p = perpId ? getActorCurrentPos(perpId) : null;
      const v = victimId ? getActorCurrentPos(victimId) : null;

      // Check if near impact / attack moment
      const nearImpact = plan?.impacts?.some((im) => Math.abs(currentTime - im.t) < 1.2);

      if (nearImpact && v) {
        // Dramatic close shot on victim & attack
        camera.position.lerp(new THREE.Vector3(v.x + 1.4, 1.4, v.z + 1.4), 0.12);
        controls.target.lerp(new THREE.Vector3(v.x, 1.0, v.z), 0.15);
      } else if (p) {
        // Dynamic medium tracking shot
        const camX = p.x - Math.sin(p.yaw + 0.5) * 2.5;
        const camZ = p.z - Math.cos(p.yaw + 0.5) * 2.5;
        camera.position.lerp(new THREE.Vector3(camX, 1.9, camZ), 0.08);
        controls.target.lerp(new THREE.Vector3(p.x, 1.1, p.z), 0.12);
      }
    }
  });

  if (!plan) {
    return (
      <group>
        {showAnchors &&
          displayAnchors.map((anc) => (
            <SceneAnchorMarker key={anc.name} name={anc.name} anchor={anc} />
          ))}
      </group>
    );
  }

  return (
    <group>
      {/* 1. Mannequins for all actors */}
      {Object.entries(plan.actors || {}).map(([id, actor]) => (
        <ForensicMannequin
          key={id}
          actor={actor}
          tracks={plan.tracks?.[id] || []}
          currentTime={currentTime}
          showLabel={showLabels}
        />
      ))}

      {/* 2. Dashed Trajectory Paths */}
      {showRoutes &&
        Object.entries(plan.paths || {}).map(([id, lines]) => {
          const actor = plan.actors?.[id];
          const color = actor?.color || (actor?.role === "victim" ? "#06b6d4" : "#ef4444");
          return <ActorPath key={id} lines={lines} color={color} />;
        })}

      {/* 3. Impact Shockwave Rings */}
      {(plan.impacts || []).map((im, i) => (
        <ImpactRing key={i} impact={im} currentTime={currentTime} />
      ))}

      {/* 4. Cardinal Anchor Markers */}
      {showAnchors &&
        displayAnchors.map((anc) => (
          <SceneAnchorMarker key={anc.name} name={anc.name} anchor={anc} />
        ))}

      {/* 5. Firearm Ballistic Tracers & Muzzle Flashes */}
      {(plan.ballistics || []).map((shot) => (
        <BallisticTracerFX key={shot.id} shot={shot} currentTime={currentTime} />
      ))}

      {/* 6. Dropped Weapons & Yellow Forensic Evidence Markers */}
      {(plan.droppedWeapons || []).map((item) => (
        <DroppedWeaponMarker key={item.id} item={item} currentTime={currentTime} />
      ))}
    </group>
  );
}
