import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Html } from "@react-three/drei";

const lerp = (a, b, u) => a + (b - a) * u;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// Keyframe piecewise-linear interpolation helper
function kf(u, keys) {
  if (u <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (u <= keys[i][0]) {
      const [u0, a] = keys[i - 1];
      const [u1, b] = keys[i];
      return lerp(a, b, (u - u0) / (u1 - u0));
    }
  }
  return keys[keys.length - 1][1];
}

/**
 * Procedural 3D Weapon Meshes
 */
function createPistolMesh() {
  const g = new THREE.Group();
  // Slide & barrel (gunmetal gray)
  const slideMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.35, metalness: 0.85 });
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.045, 0.16), slideMat);
  slide.position.set(0, 0.04, 0.06);
  g.add(slide);

  // Barrel tip
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.025, 10), slideMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.04, 0.15);
  g.add(barrel);

  // Textured pistol grip
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.75, metalness: 0.1 });
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.09, 0.045), gripMat);
  grip.rotation.x = -0.25;
  grip.position.set(0, -0.02, 0.015);
  g.add(grip);

  // Trigger guard loop
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.028, 0.035), slideMat);
  guard.position.set(0, 0.01, 0.04);
  g.add(guard);

  return g;
}

function createKnifeMesh() {
  const g = new THREE.Group();
  // Blade (shiny reflective steel)
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.15, metalness: 0.95 });
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.034, 0.22), bladeMat);
  blade.position.set(0, 0.01, 0.13);
  g.add(blade);

  // Crossguard
  const guardMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.4, metalness: 0.7 });
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.065, 0.014), guardMat);
  guard.position.set(0, 0.01, 0.02);
  g.add(guard);

  // Handle
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.75 });
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.028, 0.10), gripMat);
  grip.position.set(0, 0.01, -0.04);
  g.add(grip);

  return g;
}

function createCrowbarMesh() {
  const g = new THREE.Group();
  const barMat = new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.35, metalness: 0.65 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.62, 8), barMat);
  shaft.rotation.x = Math.PI / 2;
  shaft.position.set(0, 0, 0.12);
  g.add(shaft);

  // Angled claw
  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.08, 0.03), barMat);
  hook.rotation.z = 0.4;
  hook.position.set(0, 0.035, 0.43);
  g.add(hook);

  return g;
}

function createBagMesh() {
  const g = new THREE.Group();
  const bagMat = new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.85 });
  const sack = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), bagMat);
  sack.scale.set(0.8, 1.25, 0.9);
  sack.position.set(0, -0.07, 0.03);
  g.add(sack);
  return g;
}

function createBatMesh() {
  const g = new THREE.Group();
  // Wooden baseball bat
  const woodMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.55, metalness: 0.05 });
  // Barrel thicker than handle
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.015, 0.52, 12), woodMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0, 0.26);
  g.add(barrel);
  // Knob at bottom
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 10), woodMat);
  knob.rotation.x = Math.PI / 2;
  knob.position.set(0, 0, -0.12);
  g.add(knob);
  // Grip handle tape
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.013, 0.014, 0.22, 10),
    new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.85 })
  );
  handle.rotation.x = Math.PI / 2;
  handle.position.set(0, 0, -0.01);
  g.add(handle);
  return g;
}

/**
 * Creates a capsule mesh inside a pivot Group
 */
function createLimb(len, r, mat) {
  const group = new THREE.Group();
  const capGeom = new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 4, 10);
  const mesh = new THREE.Mesh(capGeom, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.y = -len / 2;
  group.add(mesh);
  return group;
}

export default function ForensicMannequin({
  actor,
  tracks = [],
  currentTime = 0,
  showLabel = true
}) {
  const rootRef = useRef();
  const labelRef = useRef(null);
  const partsRef = useRef(null);

  // Material with actor's forensic color
  const color = actor.color || (actor.role === "victim" ? "#06b6d4" : "#ef4444");
  const mat = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: 0.45,
      metalness: 0.15
    });
  }, [color]);

  const jointMat = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(color).multiplyScalar(0.7),
      roughness: 0.6
    });
  }, [color]);

  // Build mannequin joint hierarchy once
  useEffect(() => {
    if (!rootRef.current) return;
    const root = rootRef.current;
    
    // Safely remove only previous body group without destroying Html nodes
    let body = root.getObjectByName("__mannequin_body__");
    if (body) root.remove(body);

    body = new THREE.Group();
    body.name = "__mannequin_body__";
    root.add(body);

    const hips = new THREE.Group();
    const spine = new THREE.Group();
    const head = new THREE.Group();

    hips.position.y = 0.95;
    body.add(hips);
    hips.add(spine);
    spine.add(head);

    // Torso
    const torsoMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.38, 4, 12), mat);
    torsoMesh.position.y = 0.32;
    torsoMesh.castShadow = true;
    spine.add(torsoMesh);

    // Head
    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 14), mat);
    headMesh.position.y = 0.1;
    head.position.y = 0.72;
    head.add(headMesh);

    // Gaze visor bar (makes direction of dummy's face clearly readable!)
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.13, 0.03, 0.04),
      new THREE.MeshBasicMaterial({ color: 0x111827 })
    );
    visor.position.set(0, 0.1, 0.1);
    head.add(visor);

    // Limbs dictionary
    const parts = { root, body, hips, spine, head };

    // Arms & Legs
    for (const [side, sx] of [["L", -1], ["R", 1]]) {
      // Shoulder & Arm
      const sh = createLimb(0.3, 0.048, mat);
      sh.position.set(sx * 0.23, 0.58, 0);
      spine.add(sh);

      const el = createLimb(0.28, 0.042, mat);
      el.position.y = -0.3;
      sh.add(el);

      // Hand
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), jointMat);
      hand.position.y = -0.28;
      el.add(hand);

      // Weapons mount (on right hand)
      if (side === "R") {
        const weaponHolder = new THREE.Group();
        weaponHolder.position.set(0, -0.28, 0.02);
        el.add(weaponHolder);

        const pistol = createPistolMesh();
        pistol.visible = false;
        weaponHolder.add(pistol);

        const knife = createKnifeMesh();
        knife.visible = false;
        weaponHolder.add(knife);

        const crowbar = createCrowbarMesh();
        crowbar.visible = false;
        weaponHolder.add(crowbar);

        const bat = createBatMesh();
        bat.visible = false;
        weaponHolder.add(bat);

        const bag = createBagMesh();
        bag.visible = false;
        weaponHolder.add(bag);

        parts.weapons = { pistol, knife, crowbar, bat, bag };
      }

      // Hip & Leg
      const hip = createLimb(0.46, 0.07, mat);
      hip.position.set(sx * 0.1, 0, 0);
      hips.add(hip);

      const kn = createLimb(0.47, 0.06, mat);
      kn.position.y = -0.46;
      hip.add(kn);

      // Foot attached to bottom of shin
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.16), jointMat);
      foot.position.set(0, -0.47, 0.05);
      kn.add(foot);

      parts[`sh${side}`] = sh;
      parts[`el${side}`] = el;
      parts[`hip${side}`] = hip;
      parts[`kn${side}`] = kn;
    }

    partsRef.current = parts;
  }, [mat, jointMat]);

  // Reset joints to standard neutral standing T/A-pose
  const resetPose = (p) => {
    p.root.rotation.set(0, 0, 0);
    p.root.position.set(0, 0, 0);
    if (p.body) {
      p.body.rotation.set(0, 0, 0);
      p.body.position.set(0, 0, 0);
    }
    p.hips.position.y = 0.95;
    p.spine.rotation.set(0, 0, 0);
    p.head.rotation.set(0, 0, 0);
    ["shL", "shR", "elL", "elR", "hipL", "hipR", "knL", "knR"].forEach((k) => {
      p[k]?.rotation.set(0, 0, 0);
    });
  };

  // Sample the active track at time t
  const sampleTrack = (t) => {
    if (!tracks || tracks.length === 0) return [null, 0, null];
    let i = 0;
    while (i + 1 < tracks.length && tracks[i + 1].t0 <= t) i++;
    const s = tracks[i];
    const u = clamp((t - s.t0) / Math.max(1e-6, s.t1 - s.t0), 0, 1);
    const prev = i > 0 ? tracks[i - 1] : null;
    return [s, u, prev];
  };

  // Kinematic solver executed every frame
  useFrame(() => {
    const p = partsRef.current;
    if (!p) return;

    const [s, u, prev] = sampleTrack(currentTime);
    if (!s) {
      if (p.body) p.body.visible = false;
      if (labelRef.current) labelRef.current.style.display = "none";
      return;
    }

    resetPose(p);

    if (s.kind === "hidden") {
      if (p.body) p.body.visible = false;
      if (labelRef.current) labelRef.current.style.display = "none";
      return;
    }

    if (p.body) p.body.visible = true;
    if (labelRef.current) labelRef.current.style.display = "block";

    // Root floor position & elevation
    p.root.position.x = lerp(s.from[0], s.to[0], u);
    p.root.position.z = lerp(s.from[1], s.to[1], u);
    const curFloorY = lerp(s.from_y ?? s.floor_y ?? 0.02, s.to_y ?? s.floor_y ?? 0.02, u);
    p.root.position.y = Math.max(0.04, curFloorY);

    // Easing yaw orientation between segments
    let yaw = s.yaw;
    if (prev && prev.kind !== "hidden" && s.kind !== "sit" && s.kind !== "collapse") {
      const w = clamp((u * (s.t1 - s.t0)) / 0.25, 0, 1);
      const k = w * w * (3 - 2 * w);
      let d = s.yaw - prev.yaw;
      d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
      yaw = prev.yaw + d * k;
    }
    p.root.rotation.y = yaw;

    // Weapon props visibility
    if (p.weapons) {
      const isHidden = s.kind === "hidden" || s.kind === "collapse";
      const wep = s.weapon;
      const isAim = s.kind === "aim";
      const isShoot = s.kind === "attack" && s.style === "shoot";
      const isStab = s.kind === "attack" && (s.style === "stab" || s.style === "slash");
      const isStrike = s.kind === "attack" && s.style === "strike";
      const isLoot = s.kind === "inspect" || s.kind === "grab";

      const isBat = wep === "bat" || wep === "baseball_bat" || wep === "club" || wep === "stick";
      const isCrowbar = wep === "crowbar" || wep === "pipe" || wep === "hammer";

      const showPistol = !isHidden && (wep === "gun" || wep === "pistol" || isAim || isShoot);
      const showKnife = !isHidden && !showPistol && (wep === "knife" || wep === "dagger" || isStab);
      const showBat = !isHidden && !showPistol && !showKnife && (isBat || (isStrike && !isCrowbar));
      const showCrowbar = !isHidden && !showPistol && !showKnife && !showBat && (isCrowbar || isStrike);
      const showBag = !isHidden && !showPistol && !showKnife && !showCrowbar && !showBat && (wep === "bag" || isLoot);

      p.weapons.pistol.visible = Boolean(showPistol);
      p.weapons.knife.visible = Boolean(showKnife);
      p.weapons.bat.visible = Boolean(showBat);
      p.weapons.crowbar.visible = Boolean(showCrowbar);
      p.weapons.bag.visible = Boolean(showBag);
    }

    // Action Keyframe Kinematics
    if (s.kind === "walk") {
      const pace = s.pace || "walk";
      const isRun = pace === "run" || pace === "sprint";
      const isSneak = pace === "sneak";

      const A = isRun ? 0.95 : isSneak ? 0.35 : 0.55;
      const cycleLen = isRun ? 2.2 : isSneak ? 1.0 : 1.4;
      const ph = ((s.dist0 || 0) + u * (s.length || 1)) * 2 * Math.PI / cycleLen;
      const sn = Math.sin(ph);

      // Legs swing
      p.hipL.rotation.x = -A * sn;
      p.hipR.rotation.x = A * sn;
      p.knL.rotation.x = (isRun ? 0.9 : 0.45) * (0.5 + 0.5 * Math.sin(ph + 1.2));
      p.knR.rotation.x = (isRun ? 0.9 : 0.45) * (0.5 + 0.5 * Math.sin(ph + 1.2 + Math.PI));

      // Arms counter-swing
      p.shL.rotation.x = (A - 0.05) * sn;
      p.shR.rotation.x = -(A - 0.05) * sn;
      p.elL.rotation.x = isRun ? -1.2 : isSneak ? -0.8 : -0.35;
      p.elR.rotation.x = isRun ? -1.2 : isSneak ? -0.8 : -0.35;

      // Hip vertical bounce & forward lean
      p.hips.position.y = 0.95 - (isSneak ? 0.15 : 0.015) + 0.02 * Math.abs(Math.cos(ph));
      if (isRun) p.spine.rotation.x = 0.24;
      if (isSneak) {
        p.spine.rotation.x = 0.18;
        p.head.rotation.x = -0.1;
      }

    } else if (s.kind === "sit") {
      p.hips.position.y = 0.50;
      p.hipL.rotation.x = p.hipR.rotation.x = -Math.PI / 2;
      p.knL.rotation.x = p.knR.rotation.x = Math.PI / 2;
      p.shL.rotation.x = p.shR.rotation.x = -0.45;
      p.elL.rotation.x = p.elR.rotation.x = -0.9;

    } else if (s.kind === "lie" || s.kind === "sleep") {
      // Horizontal sleeping / lying posture on bed or floor surface
      p.hips.position.y = 0.16;
      p.spine.rotation.x = -1.45;
      p.head.rotation.x = -0.10;
      p.head.rotation.z = 0.25;
      p.hipL.rotation.x = -1.50;
      p.hipR.rotation.x = -1.50;
      p.knL.rotation.x = 0.05;
      p.knR.rotation.x = 0.05;
      p.shL.rotation.z = -0.25;
      p.shR.rotation.z = 0.25;
      p.shL.rotation.x = -0.15;
      p.shR.rotation.x = -0.20;
      p.elL.rotation.x = -0.3;
      p.elR.rotation.x = -0.4;
      const breath = 0.02 * Math.sin(currentTime * 1.8);
      p.spine.rotation.x = -1.45 + breath;

    } else if (s.kind === "aim") {
      // Tactical Weaver firearm aiming stance
      p.shR.rotation.x = -1.55;
      p.shR.rotation.z = -0.12;
      p.elR.rotation.x = -0.05;
      p.shL.rotation.x = -1.50;
      p.shL.rotation.z = 0.28;
      p.elL.rotation.x = -0.35;
      p.spine.rotation.x = 0.05;
      p.spine.rotation.y = 0.15;
      p.head.rotation.y = -0.12;

    } else if (s.kind === "surrender") {
      // Hostage / Victim surrender (hands raised high overhead, trembling)
      p.shL.rotation.x = p.shR.rotation.x = -2.6;
      p.shL.rotation.z = -0.45;
      p.shR.rotation.z = 0.45;
      p.elL.rotation.x = p.elR.rotation.x = -0.75;
      const tremble = 0.02 * Math.sin(currentTime * 14);
      p.spine.rotation.x = -0.08 + tremble;
      p.head.rotation.x = -0.15;

    } else if (s.kind === "kick") {
      // Front thrust kick
      p.hipR.rotation.x = kf(u, [[0, 0], [0.25, -1.2], [0.45, -1.7], [0.65, -1.7], [1, 0]]);
      p.knR.rotation.x = kf(u, [[0, 0], [0.25, 1.3], [0.45, 0.1], [0.65, 0.1], [1, 0]]);
      p.spine.rotation.x = kf(u, [[0, 0], [0.45, -0.35], [1, 0]]);
      p.shR.rotation.x = 0.35;
      p.shL.rotation.x = -0.6;

    } else if (s.kind === "attack") {
      const style = s.style || "stab";

      if (style === "stab") {
        // Stabbing downward thrust
        p.shR.rotation.x = kf(u, [[0, 0], [0.35, -2.1], [0.55, -1.45], [0.72, -1.45], [1, 0]]);
        p.elR.rotation.x = kf(u, [[0, 0], [0.35, -1.9], [0.55, -0.1], [0.72, -0.1], [1, 0]]);
        p.spine.rotation.x = kf(u, [[0, 0], [0.55, 0.35], [0.8, 0.2], [1, 0]]);
        p.shL.rotation.x = -0.3;
        p.elL.rotation.x = -0.6;

      } else if (style === "strike") {
        // Overhead club / blunt weapon swing
        p.shR.rotation.x = kf(u, [[0, 0], [0.4, -2.9], [0.55, -0.6], [0.75, -0.6], [1, 0]]);
        p.shR.rotation.z = kf(u, [[0, 0], [0.3, 0.4], [0.55, -0.3], [1, 0]]);
        p.elR.rotation.x = kf(u, [[0, 0], [0.4, -0.5], [0.55, -0.1], [1, 0]]);
        p.spine.rotation.x = kf(u, [[0, 0], [0.55, 0.45], [0.8, 0.25], [1, 0]]);
        p.shL.rotation.x = -0.4;
        p.elL.rotation.x = -0.7;

      } else if (style === "shoot") {
        // Aiming firearm with sharp recoil impulse at trigger squeeze
        const recoilX = kf(u, [
          [0, -1.55],
          [0.34, -1.55],
          [0.38, -1.95],
          [0.48, -1.58],
          [1, -1.55]
        ]);
        p.shR.rotation.x = recoilX;
        p.shL.rotation.x = recoilX;
        p.shR.rotation.z = -0.12;
        p.shL.rotation.z = 0.28;
        p.elR.rotation.x = kf(u, [[0, -0.05], [0.34, -0.05], [0.38, -0.35], [0.48, -0.05], [1, -0.05]]);
        p.elL.rotation.x = -0.35;
        p.spine.rotation.x = kf(u, [[0, 0.05], [0.38, -0.10], [0.5, 0.05], [1, 0.05]]);
        p.head.rotation.x = kf(u, [[0, 0], [0.38, -0.08], [0.5, 0], [1, 0]]);

      } else if (style === "strangle") {
        // Homicide chokehold struggle
        p.shR.rotation.x = p.shR.rotation.x = -1.45;
        p.shR.rotation.z = -0.32;
        p.shL.rotation.z = 0.32;
        p.elR.rotation.x = p.elL.rotation.x = -1.2;
        const struggleOsc = 0.15 * Math.sin(u * 6 * Math.PI);
        p.spine.rotation.y = struggleOsc;
        p.spine.rotation.x = 0.15;

      } else if (style === "punch") {
        // Direct forward punch
        p.shR.rotation.x = kf(u, [[0, 0], [0.25, -0.5], [0.5, -1.55], [0.7, -1.55], [1, 0]]);
        p.elR.rotation.x = kf(u, [[0, -1.2], [0.25, -1.4], [0.5, -0.1], [0.7, -0.1], [1, -0.3]]);
        p.spine.rotation.y = kf(u, [[0, 0], [0.5, -0.4], [1, 0]]);
        p.shL.rotation.x = -0.5;
        p.elL.rotation.x = -1.2;

      } else if (style === "push") {
        // Two-handed violent shove
        const pushX = kf(u, [[0, 0], [0.3, -0.6], [0.55, -1.5], [0.75, -1.5], [1, 0]]);
        p.shR.rotation.x = p.shL.rotation.x = pushX;
        p.elR.rotation.x = p.elL.rotation.x = kf(u, [[0, -0.8], [0.3, -1.2], [0.55, -0.2], [1, -0.4]]);
        p.spine.rotation.x = kf(u, [[0, 0], [0.55, 0.3], [1, 0]]);

      } else {
        // General slash or attack
        p.shR.rotation.x = kf(u, [[0, 0], [0.3, -1.8], [0.6, -0.8], [1, 0]]);
        p.elR.rotation.x = kf(u, [[0, 0], [0.3, -1.0], [0.6, -0.1], [1, 0]]);
        p.spine.rotation.y = kf(u, [[0, 0], [0.3, 0.5], [0.6, -0.5], [1, 0]]);
      }

    } else if (s.kind === "defend") {
      // Protective defense stance
      p.shL.rotation.x = p.shR.rotation.x = -1.35;
      p.shL.rotation.z = -0.25;
      p.shR.rotation.z = 0.25;
      p.elL.rotation.x = p.elR.rotation.x = -1.55;
      p.spine.rotation.x = -0.2;
      p.head.rotation.x = 0.3;

    } else if (s.kind === "struggle") {
      // Grappling oscillation
      const ph = u * 4 * Math.PI;
      p.spine.rotation.y = 0.35 * Math.sin(ph);
      p.shR.rotation.x = -1.2 + 0.3 * Math.cos(ph);
      p.shL.rotation.x = -1.2 - 0.3 * Math.cos(ph);
      p.elR.rotation.x = -1.0;
      p.elL.rotation.x = -1.0;

    } else if (s.kind === "collapse") {
      const isFromSit = s.from_pose === "sit";
      const isFromLie = s.from_pose === "lie" || s.from_pose === "sleep";
      const isFinal = Boolean(s.final || prev?.kind === "collapse");
      const e = isFinal ? 1.0 : (1 - Math.pow(1 - u, 3));
      const style = s.collapse_style || (isFromSit ? "from_sit" : isFromLie ? "from_lie" : "crumple");

      if (isFromLie || style === "from_lie") {
        // Already lying down / sleeping when attacked - slump limply on surface
        p.hips.position.y = lerp(0.16, 0.14, e);
        p.spine.rotation.x = -1.45;
        p.head.rotation.z = lerp(0.25, 0.55, e);
        p.shL.rotation.z = lerp(-0.25, -0.65, e);
        p.shR.rotation.z = lerp(0.25, 0.65, e);
        p.hipL.rotation.x = -1.50;
        p.hipR.rotation.x = -1.50;
        p.knL.rotation.x = lerp(0.05, 0.18, e);
        p.knR.rotation.x = lerp(0.05, 0.15, e);

      } else if (isFromSit) {
        // Victim sitting on chair when struck:
        // Slumps forward heavily over the chair seat and knees, resting securely on top of chair & floor
        const fwdDist = 0.10 * e;
        p.root.position.x += Math.sin(yaw) * fwdDist;
        p.root.position.z += Math.cos(yaw) * fwdDist;

        // Hips remain supported on chair seat
        p.hips.position.y = lerp(0.50, 0.46, e);

        // Torso slumps forward heavily over lap with subtle sideways limpness
        p.spine.rotation.x = lerp(0, 1.15, e);
        p.spine.rotation.z = lerp(0, 0.35, e);
        p.head.rotation.x = lerp(0, 0.70, e);
        p.head.rotation.z = lerp(0, 0.25, e);

        // Arms fall completely limp beside legs
        p.shL.rotation.x = lerp(-0.45, 0.35, e);
        p.shR.rotation.x = lerp(-0.45, 0.40, e);
        p.elL.rotation.x = lerp(-0.90, -0.20, e);
        p.elR.rotation.x = lerp(-0.90, -0.20, e);

        // Legs remain on chair and floor (feet on floor surface at Y >= 0.04m)
        p.hipL.rotation.x = p.hipR.rotation.x = lerp(-Math.PI / 2, -1.45, e);
        p.knL.rotation.x = p.knR.rotation.x = lerp(Math.PI / 2, 1.40, e);

      } else if (style === "fall_backward") {
        // Fall flat on back, resting completely on top of floor surface (Y >= 0.06m)
        p.hips.position.y = lerp(0.95, 0.20, e);
        p.spine.rotation.x = lerp(0, -1.45, e);
        p.head.rotation.x = lerp(0, -0.10, e);
        p.shL.rotation.z = -0.55 * e;
        p.shR.rotation.z = 0.55 * e;
        p.hipL.rotation.x = p.hipR.rotation.x = lerp(0, -1.50, e);
        p.knL.rotation.x = p.knR.rotation.x = lerp(0, 0.05, e);

      } else {
        // Crumple forward onto knees and hands, resting completely on top of floor surface (Y >= 0.06m)
        p.hips.position.y = lerp(0.95, 0.30, e);
        p.hipL.rotation.x = p.hipR.rotation.x = lerp(0, -1.20, e);
        p.knL.rotation.x = p.knR.rotation.x = lerp(0, 2.30, e);
        p.spine.rotation.x = lerp(0, 0.85, e);
        p.head.rotation.x = lerp(0, 0.55, e);
        p.shL.rotation.x = p.shR.rotation.x = -0.60 * e;
      }

    } else if (s.kind === "inspect" || s.kind === "grab") {
      // Leaning over searching
      p.spine.rotation.x = 0.55;
      p.head.rotation.x = 0.4;
      p.shR.rotation.x = -0.7;
      p.elR.rotation.x = -0.6;
      p.shL.rotation.x = -0.5;
      p.elL.rotation.x = -0.4;

    } else if (s.kind === "idle" || s.kind === "stand") {
      // Upright standing posture with natural breathing
      p.hips.position.y = 0.95;
      const breath = 0.03 * Math.sin(currentTime * 2.5);
      p.spine.rotation.x = breath;
      p.shL.rotation.x = -0.15 + breath * 0.5;
      p.shR.rotation.x = -0.15 + breath * 0.5;
      p.elL.rotation.x = -0.2;
      p.elR.rotation.x = -0.2;
    }
  });

  const [currentSeg] = sampleTrack(currentTime);
  const isDown = currentSeg?.kind === "collapse" || currentSeg?.kind === "lie" || currentSeg?.kind === "sleep";
  const labelHeight = isDown ? 0.45 : (currentSeg?.kind === "sit" ? 1.45 : 1.95);

  return (
    <group ref={rootRef}>
      {showLabel && (
        <Html position={[0, labelHeight, 0]} center distanceFactor={14}>
          <div
            ref={labelRef}
            style={{
              padding: "2px 7px",
              borderRadius: "4px",
              background: "rgba(10, 12, 18, 0.88)",
              border: `1px solid ${color}`,
              color: "#e8eaf0",
              fontSize: "11px",
              fontWeight: "600",
              letterSpacing: "0.4px",
              whiteSpace: "nowrap",
              pointerEvents: "none",
              boxShadow: `0 2px 8px ${color}33`,
              textTransform: "uppercase"
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: color,
                marginRight: "5px"
              }}
            />
            {actor.name || actor.role}
          </div>
        </Html>
      )}
    </group>
  );
}
