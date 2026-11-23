import * as THREE from 'three';
import type { ItemType, PublicPlayerSnapshot } from '../shared/types';
import { PILLAR_INTERACT_RADIUS } from '../shared/map';

export interface ExplorerRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  torsoMat: THREE.MeshStandardMaterial;
  accentMat: THREE.MeshStandardMaterial;
  visorMat: THREE.MeshPhysicalMaterial;
  lampMat: THREE.MeshStandardMaterial;
  seekerBeacon: THREE.Mesh;
  seekerBeaconMat: THREE.MeshStandardMaterial;
  hitbox: THREE.Mesh;
  gaitPhase: number;
}

/**
 * 10-part composite Backrooms Async Hazmat Explorer model pivoted at bottom-center (y = 0).
 */
export function createExplorerRig(
  entityId: string,
  isDecoy: boolean,
  suitHex: string,
  accentHex: string,
  contactShadowMap: THREE.Texture,
): ExplorerRig {
  const root = new THREE.Group();
  root.userData = { entityId, isDecoy };

  // Ground contact shadow disc
  const shadowMat = new THREE.MeshBasicMaterial({
    map: contactShadowMap,
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
  });
  const shadowDisc = new THREE.Mesh(new THREE.CircleGeometry(0.55, 20), shadowMat);
  shadowDisc.rotation.x = -Math.PI / 2;
  shadowDisc.position.y = 0.015;
  root.add(shadowDisc);

  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const torsoMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(suitHex),
    roughness: 0.72,
    metalness: 0.06,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(accentHex),
    roughness: 0.42,
    metalness: 0.25,
  });
  const bootMat = new THREE.MeshStandardMaterial({
    color: 0x1e1d19,
    roughness: 0.88,
    metalness: 0.08,
  });
  const packMat = new THREE.MeshStandardMaterial({
    color: 0x36342c,
    roughness: 0.36,
    metalness: 0.52,
  });
  const visorMat = new THREE.MeshPhysicalMaterial({
    color: 0x121820,
    roughness: 0.14,
    metalness: 0.45,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
  });
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xfff5d4,
    emissive: 0xffdf88,
    emissiveIntensity: 1.4,
    roughness: 0.2,
  });

  // Legs (articulated at hip y = 0.78)
  const makeLeg = (xOff: number): THREE.Group => {
    const leg = new THREE.Group();
    leg.position.set(xOff, 0.78, 0);
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.095, 0.58, 10), torsoMat);
    thigh.position.y = -0.31;
    thigh.castShadow = true;
    leg.add(thigh);

    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.26), bootMat);
    boot.position.set(0, -0.68, 0.04);
    boot.castShadow = true;
    leg.add(boot);
    return leg;
  };

  const leftLeg = makeLeg(-0.14);
  const rightLeg = makeLeg(0.14);
  bodyGroup.add(leftLeg, rightLeg);

  // Torso (hazmat jacket + chest harness accent band)
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.21, 0.64, 12), torsoMat);
  torso.position.y = 1.1;
  torso.castShadow = true;
  bodyGroup.add(torso);

  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.11, 12), accentMat);
  belt.position.y = 0.86;
  bodyGroup.add(belt);

  // Chest accent stripe (helps players remember who wore what in the lobby!)
  const chestBand = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.13, 0.44), accentMat);
  chestBand.position.set(0, 1.24, 0);
  bodyGroup.add(chestBand);

  // Backpack & twin oxygen canisters
  const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.44, 0.18), packMat);
  backpack.position.set(0, 1.15, -0.24);
  backpack.castShadow = true;
  bodyGroup.add(backpack);

  const canisterL = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.36, 10), accentMat);
  canisterL.position.set(-0.08, 1.15, -0.34);
  const canisterR = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.36, 10), accentMat);
  canisterR.position.set(0.08, 1.15, -0.34);
  bodyGroup.add(canisterL, canisterR);

  // Arms (articulated at shoulders y = 1.35)
  const makeArm = (xOff: number): THREE.Group => {
    const arm = new THREE.Group();
    arm.position.set(xOff, 1.35, 0);
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.068, 0.52, 10), torsoMat);
    sleeve.position.y = -0.26;
    sleeve.castShadow = true;
    arm.add(sleeve);

    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.072, 10, 8), bootMat);
    glove.position.y = -0.54;
    arm.add(glove);
    return arm;
  };
  const leftArm = makeArm(-0.31);
  const rightArm = makeArm(0.31);
  bodyGroup.add(leftArm, rightArm);

  // Helmet + properly centered front curved dark glossy visor + forehead lamp
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.21, 16, 12), torsoMat);
  helmet.position.set(0, 1.61, 0);
  helmet.castShadow = true;
  bodyGroup.add(helmet);

  const visorFrame = new THREE.Mesh(
    new THREE.CylinderGeometry(0.205, 0.205, 0.17, 16, 1, false, -Math.PI * 0.3, Math.PI * 0.6),
    packMat,
  );
  visorFrame.position.set(0, 1.62, 0.025);
  bodyGroup.add(visorFrame);

  const visor = new THREE.Mesh(
    new THREE.CylinderGeometry(0.214, 0.214, 0.13, 16, 1, false, -Math.PI * 0.25, Math.PI * 0.5),
    visorMat,
  );
  visor.position.set(0, 1.62, 0.03);
  bodyGroup.add(visor);

  const headlamp = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.052, 0.06, 10), lampMat);
  headlamp.rotation.x = Math.PI / 2;
  headlamp.position.set(0, 1.78, 0.15);
  bodyGroup.add(headlamp);

  // Seeker shoulder beacon (visible only when role === 'seeker')
  const seekerBeaconMat = new THREE.MeshStandardMaterial({
    color: 0xff3b30,
    emissive: 0xff2222,
    emissiveIntensity: 2.2,
    roughness: 0.2,
  });
  const seekerBeacon = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.14, 10), seekerBeaconMat);
  seekerBeacon.position.set(0.22, 1.48, -0.05);
  seekerBeacon.visible = false;
  bodyGroup.add(seekerBeacon);

  // Generous invisible raycast proxy for crisp crosshair targeting
  const hitbox = new THREE.Mesh(
    new THREE.CylinderGeometry(0.46, 0.46, 1.85, 8),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  hitbox.position.y = 0.92;
  hitbox.userData = { entityId, isDecoy };
  root.add(hitbox);

  return {
    root,
    bodyGroup,
    leftLeg,
    rightLeg,
    leftArm,
    rightArm,
    torsoMat,
    accentMat,
    visorMat,
    lampMat,
    seekerBeacon,
    seekerBeaconMat,
    hitbox,
    gaitPhase: 0,
  };
}

export function updateExplorerRig(
  rig: ExplorerRig,
  snap: PublicPlayerSnapshot,
  dt: number,
  elapsed: number,
): void {
  // Smoothly interpolate position & facing
  const damp = 1 - Math.exp(-14 * dt);
  rig.root.position.x = THREE.MathUtils.lerp(rig.root.position.x, snap.x, damp);
  rig.root.position.z = THREE.MathUtils.lerp(rig.root.position.z, snap.z, damp);

  // Shortest-angle yaw lerp
  let dyaw = snap.yaw - rig.root.rotation.y;
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  rig.root.rotation.y += dyaw * damp;

  // Gait animation synced to velocity
  if (snap.speed > 0.25) {
    rig.gaitPhase += dt * snap.speed * 2.1;
    const swing = Math.sin(rig.gaitPhase) * 0.65;
    rig.leftLeg.rotation.x = swing;
    rig.rightLeg.rotation.x = -swing;
    rig.leftArm.rotation.x = -swing * 0.75;
    rig.rightArm.rotation.x = swing * 0.75;
    rig.bodyGroup.position.y = Math.abs(Math.cos(rig.gaitPhase)) * 0.05;
  } else {
    rig.leftLeg.rotation.x *= 0.85;
    rig.rightLeg.rotation.x *= 0.85;
    rig.leftArm.rotation.x *= 0.85;
    rig.rightArm.rotation.x *= 0.85;
    rig.bodyGroup.position.y = Math.sin(elapsed * 2.2) * 0.015;
  }

  // Crouch scale
  const targetScaleY = snap.crouching ? 0.76 : 1.0;
  rig.bodyGroup.scale.y = THREE.MathUtils.lerp(rig.bodyGroup.scale.y, targetScaleY, damp);

  // Suit appearance states
  if (snap.status === 'visitor') {
    rig.torsoMat.color.set('#7dd3fc');
    rig.torsoMat.emissive.set('#0284c7');
    rig.torsoMat.emissiveIntensity = 0.55;
    rig.torsoMat.transparent = true;
    rig.torsoMat.opacity = 0.58;
    rig.accentMat.color.set('#e0f2fe');
    rig.accentMat.transparent = true;
    rig.accentMat.opacity = 0.65;
    rig.seekerBeacon.visible = false;
  } else if (snap.status === 'eliminated') {
    rig.root.visible = false;
    return;
  } else if (snap.cloakMs > 0) {
    rig.root.visible = true;
    rig.torsoMat.color.set('#d5ca88');
    rig.torsoMat.emissive.set('#222015');
    rig.torsoMat.emissiveIntensity = 0.1;
    rig.torsoMat.transparent = true;
    rig.torsoMat.opacity = 0.28 + Math.sin(elapsed * 18) * 0.08;
    rig.accentMat.color.set('#d5ca88');
    rig.accentMat.transparent = true;
    rig.accentMat.opacity = 0.28;
    rig.seekerBeacon.visible = false;
  } else {
    rig.root.visible = true;
    rig.torsoMat.color.set(snap.suitColor);
    rig.torsoMat.emissive.set(snap.role === 'seeker' ? '#3a0909' : '#000000');
    rig.torsoMat.emissiveIntensity = snap.role === 'seeker' ? 0.45 : 0;
    rig.torsoMat.transparent = false;
    rig.torsoMat.opacity = 1;
    rig.accentMat.color.set(snap.role === 'seeker' ? '#ef4444' : snap.accentColor);
    rig.accentMat.transparent = false;
    rig.accentMat.opacity = 1;
    rig.seekerBeacon.visible = snap.role === 'seeker';
    if (snap.role === 'seeker') {
      rig.seekerBeaconMat.emissiveIntensity =
        snap.stunMs > 0 ? 0.3 : 1.6 + Math.sin(elapsed * 8) * 0.8;
    }
  }
}

export interface CheckinPillarRig {
  group: THREE.Group;
  beaconMat: THREE.MeshStandardMaterial;
  floorRingMat: THREE.MeshBasicMaterial;
  light: THREE.PointLight;
}

/**
 * 9-part Hero Centerpiece: The Backrooms Check-in Pillar ("Cột Điểm Danh / Cột Năm Mười").
 */
export function createCheckinPillar(pillarMap: THREE.Texture): CheckinPillarRig {
  const group = new THREE.Group();

  const concreteMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: pillarMap,
    roughness: 0.78,
    metalness: 0.08,
  });
  const steelMat = new THREE.MeshStandardMaterial({
    color: 0x3b382e,
    roughness: 0.32,
    metalness: 0.72,
  });
  const beaconMat = new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    emissive: 0xf59e0b,
    emissiveIntensity: 1.8,
    roughness: 0.22,
    metalness: 0.15,
  });

  // 1) Octagonal grounded concrete plinth
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.08, 1.18, 0.28, 8), steelMat);
  plinth.position.y = 0.14;
  plinth.receiveShadow = true;
  group.add(plinth);

  // 2) Main concrete structural column with caution stripes
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.76, 0.78, 3.2, 16), concreteMat);
  column.position.y = 1.84;
  column.castShadow = true;
  column.receiveShadow = true;
  group.add(column);

  // 3-6) 4 vertical steel structural ribs around the column
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2 + Math.PI / 4;
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.14, 3.3, 0.14), steelMat);
    rib.position.set(Math.cos(angle) * 0.78, 1.8, Math.sin(angle) * 0.78);
    rib.rotation.y = -angle;
    group.add(rib);
  }

  // 7) Upper luminous Check-in Halo Ring
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.09, 12, 28), beaconMat);
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 2.68;
  group.add(halo);

  // 8) Ceiling junction crown collar
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 0.94, 0.32, 8), steelMat);
  crown.position.y = 3.44;
  group.add(crown);

  // 9) Floor Check-in Zone Perimeter Ring (offset y = 0.025 + polygonOffset so zero Z-fighting)
  const floorRingMat = new THREE.MeshBasicMaterial({
    color: 0xeab308,
    transparent: true,
    opacity: 0.45,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const floorRing = new THREE.Mesh(
    new THREE.RingGeometry(PILLAR_INTERACT_RADIUS - 0.14, PILLAR_INTERACT_RADIUS, 40),
    floorRingMat,
  );
  floorRing.rotation.x = -Math.PI / 2;
  floorRing.position.y = 0.025;
  group.add(floorRing);

  const light = new THREE.PointLight(0xffcf6e, 3.2, 22, 1.6);
  light.position.set(0, 2.7, 0);
  group.add(light);

  return { group, beaconMat, floorRingMat, light };
}

/**
 * 4-6 part composite Backrooms hidden item pickup models.
 */
export function createItemPickupMesh(
  type: ItemType,
  contactShadowMap: THREE.Texture,
): THREE.Group {
  const root = new THREE.Group();

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.42, 16),
    new THREE.MeshBasicMaterial({
      map: contactShadowMap,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  root.add(shadow);

  const bobGroup = new THREE.Group();
  bobGroup.name = 'bob';
  bobGroup.position.y = 0.55;
  root.add(bobGroup);

  if (type === 'almond_water') {
    const bottleMat = new THREE.MeshStandardMaterial({
      color: 0xdbeafe,
      roughness: 0.25,
      metalness: 0.65,
    });
    const labelMat = new THREE.MeshStandardMaterial({
      color: 0x3b82f6,
      emissive: 0x1d4ed8,
      emissiveIntensity: 0.7,
      roughness: 0.5,
    });
    const capMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.7,
    });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.42, 12), bottleMat);
    const label = new THREE.Mesh(new THREE.CylinderGeometry(0.146, 0.146, 0.18, 12), labelMat);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.13, 0.1, 12), bottleMat);
    neck.position.y = 0.25;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.07, 10), capMat);
    cap.position.y = 0.32;
    bobGroup.add(body, label, neck, cap);
  } else if (type === 'smoke_bomb') {
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x57534e,
      roughness: 0.45,
      metalness: 0.6,
    });
    const stripeMat = new THREE.MeshStandardMaterial({
      color: 0xeab308,
      emissive: 0xa16207,
      emissiveIntensity: 0.65,
      roughness: 0.4,
    });
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.38, 12), bodyMat);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.136, 0.136, 0.1, 12), stripeMat);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.08, 10), bodyMat);
    nozzle.position.y = 0.23;
    const pin = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.015, 8, 14), stripeMat);
    pin.position.set(0.09, 0.24, 0);
    bobGroup.add(cyl, band, nozzle, pin);
  } else if (type === 'emf_scanner') {
    const casingMat = new THREE.MeshStandardMaterial({
      color: 0x1c1917,
      roughness: 0.55,
      metalness: 0.3,
    });
    const screenMat = new THREE.MeshStandardMaterial({
      color: 0x34d399,
      emissive: 0x10b981,
      emissiveIntensity: 1.4,
      roughness: 0.2,
    });
    const copperMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      roughness: 0.25,
      metalness: 0.85,
    });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.34, 0.1), casingMat);
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.11), screenMat);
    screen.position.y = 0.06;
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.24, 8), copperMat);
    antenna.position.set(0.07, 0.28, 0);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), screenMat);
    tip.position.set(0.07, 0.4, 0);
    bobGroup.add(box, screen, antenna, tip);
  } else {
    // static_cloak
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x4c1d95,
      emissive: 0x7c3aed,
      emissiveIntensity: 0.9,
      roughness: 0.3,
      metalness: 0.5,
    });
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0xc4b5fd,
      roughness: 0.2,
      metalness: 0.8,
    });
    const octa = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), coreMat);
    const ring1 = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.024, 8, 22), rimMat);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.024, 8, 22), rimMat);
    ring2.rotation.x = Math.PI / 2;
    bobGroup.add(octa, ring1, ring2);
  }

  // Ground glow ring
  const glowColor =
    type === 'almond_water'
      ? 0x60a5fa
      : type === 'smoke_bomb'
        ? 0xeab308
        : type === 'emf_scanner'
          ? 0x34d399
          : 0xa78bfa;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.28, 0.36, 20),
    new THREE.MeshBasicMaterial({
      color: glowColor,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  root.add(ring);

  return root;
}

/**
 * Grounded Backrooms Level 0 environmental props (A-frame caution wet-floor signs, office water coolers)
 */
export function createWetFloorSign(): THREE.Group {
  const g = new THREE.Group();
  const yellowMat = new THREE.MeshStandardMaterial({
    color: 0xd9b326,
    roughness: 0.45,
    metalness: 0.08,
  });
  const markMat = new THREE.MeshStandardMaterial({
    color: 0x1a1812,
    roughness: 0.7,
  });

  const panelA = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.62, 0.03), yellowMat);
  panelA.position.set(0, 0.3, 0.11);
  panelA.rotation.x = -0.24;
  const panelB = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.62, 0.03), yellowMat);
  panelB.position.set(0, 0.3, -0.11);
  panelB.rotation.x = 0.24;
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.04), markMat);
  stripe.position.set(0, 0.34, 0.12);
  stripe.rotation.x = -0.24;

  g.add(panelA, panelB, stripe);
  return g;
}

export function createOfficeCrateCluster(): THREE.Group {
  const g = new THREE.Group();
  const boxMat = new THREE.MeshStandardMaterial({
    color: 0x9b8255,
    roughness: 0.86,
    metalness: 0.02,
  });
  const tapeMat = new THREE.MeshStandardMaterial({
    color: 0x5c4b2b,
    roughness: 0.55,
  });

  const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.65, 0.72), boxMat);
  b1.position.set(0, 0.325, 0);
  const tape1 = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.06, 0.14), tapeMat);
  tape1.position.set(0, 0.64, 0);

  const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.48, 0.54), boxMat);
  b2.position.set(0.06, 0.89, -0.04);
  b2.rotation.y = 0.28;

  const b3 = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.52, 0.6), boxMat);
  b3.position.set(0.68, 0.26, 0.18);
  b3.rotation.y = -0.15;

  g.add(b1, tape1, b2, b3);
  return g;
}
