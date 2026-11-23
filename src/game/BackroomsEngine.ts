import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  BACKROOMS_GRID,
  CELL_SIZE,
  GRID_COLS,
  GRID_ROWS,
  PILLAR_INTERACT_RADIUS,
  PILLAR_POS,
  WALL_HEIGHT,
  distance2D,
  gridToWorld,
  hasLineOfSight,
  isWallCell,
  resolveCircleWallCollision,
} from '../shared/map';
import { ITEM_PICKUP_RADIUS, SPOT_MAX_DISTANCE } from '../shared/rules';
import type { ItemType, PublicPlayerSnapshot, RoomSnapshot } from '../shared/types';
import { BackroomsAudio } from './audio';
import {
  type CheckinPillarRig,
  type ExplorerRig,
  createCheckinPillar,
  createExplorerRig,
  createItemPickupMesh,
  createOfficeCrateCluster,
  createWetFloorSign,
  updateExplorerRig,
} from './models';
import { type BackroomsTextureSet, createBackroomsTextures } from './textures';

export interface CrosshairTarget {
  entityId: string;
  isDecoy: boolean;
  distance: number;
}

export interface ProjectedLabel {
  id: string;
  text: string;
  subtext?: string;
  x: number;
  y: number;
  tone: 'normal' | 'seeker' | 'visitor' | 'pillar';
}

export interface EngineFrameReport {
  stamina: number; // 0..100
  pointerLocked: boolean;
  lockedTarget: CrosshairTarget | null;
  nearPillar: boolean;
  distanceToPillar: number;
  pillarAngleRad: number; // relative to player look direction
  nearItem: { id: string; type: ItemType } | null;
  labels: ProjectedLabel[];
  playerX: number;
  playerZ: number;
  playerYaw: number;
}

export interface EngineCallbacks {
  onSendMove: (payload: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    speed: number;
    crouching: boolean;
  }) => void;
  onReport: (report: EngineFrameReport) => void;
  onInteract: (ctx: {
    lockedTarget: CrosshairTarget | null;
    nearPillar: boolean;
    nearItem: { id: string; type: ItemType } | null;
  }) => void;
  onUseItem: () => void;
  onUseSkill: () => void;
  onTogglePause: () => void;
  onToggleMute: () => void;
}

// Module-scope scratch math helpers (Zero GC inside render loop)
const _vec3A = new THREE.Vector3();
const _vec3B = new THREE.Vector3();
const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _centerNDC = new THREE.Vector2(0, 0);

interface ParticleSlot {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  color: THREE.Color;
}

const MAX_PARTICLES = 120;

export class BackroomsEngine {
  private container: HTMLElement;
  private callbacks: EngineCallbacks;
  private audio: BackroomsAudio;
  private isSoftwareGl: boolean;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private textures: BackroomsTextureSet;
  private pillarRig: CheckinPillarRig;
  private dirLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private flashlight: THREE.SpotLight;
  private ceilingLightsMat: THREE.MeshStandardMaterial;

  private playerRigs = new Map<string, ExplorerRig>();
  private decoyRigs = new Map<string, ExplorerRig>();
  private itemMeshes = new Map<string, { type: ItemType; group: THREE.Group }>();
  private smokeMeshes = new Map<string, THREE.Group>();
  private titleDemoActors: ExplorerRig[] = [];

  private particleMesh: THREE.InstancedMesh;
  private particles: ParticleSlot[] = [];
  private particleCursor = 0;

  private raycaster = new THREE.Raycaster();
  private snapshot: RoomSnapshot | null = null;
  private mode: 'title' | 'live' = 'title';
  private paused = false;
  private modalBlockingInput = false;

  // Local player kinematics
  private localX = 0;
  private localZ = 3.2;
  private localYaw = 0;
  private localPitch = 0;
  private localSpeed = 0;
  private stamina = 100;
  private headBobPhase = 0;
  private stepAccum = 0;
  private cameraTrauma = 0;
  private hitstopTimer = 0;
  private lastServerPhase = '';
  private lastPositionSynced = false;

  // Input state
  private keys = new Set<string>();
  private pointerLocked = false;
  private isDraggingLook = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private sensitivity = 0.0022;

  // Loop & timers
  private frameId = 0;
  private disposed = false;
  private lastFrameTime = 0;
  private elapsed = 0;
  private lastMoveSendAt = 0;
  private lastReportAt = 0;
  private lastLockedTargetId: string | null = null;
  private currentLockedTarget: CrosshairTarget | null = null;
  private currentNearPillar = false;
  private currentNearItem: { id: string; type: ItemType } | null = null;
  private resizeObserver: ResizeObserver;

  constructor(container: HTMLElement, audio: BackroomsAudio, callbacks: EngineCallbacks) {
    this.container = container;
    this.audio = audio;
    this.callbacks = callbacks;

    // Software WebGL detection per threejs skill
    this.isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.dataset.testid = 'backrooms-canvas';
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x231f10);
    this.scene.fog = new THREE.FogExp2(0x231f10, 0.042);

    // Mandatory studio environment map via RoomEnvironment on all devices
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(72, width / height, 0.12, 85);
    this.camera.rotation.order = 'YXZ';
    this.renderer.setSize(width, height);

    this.textures = createBackroomsTextures(this.renderer.capabilities.getMaxAnisotropy());

    // Lighting rig: warm fluorescent overhead key + cool-olive hemisphere bounce
    this.hemiLight = new THREE.HemisphereLight(0xfff1be, 0x3b3522, 1.05);
    this.scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xffe9a6, 0.95);
    this.dirLight.position.set(14, 24, 10);
    this.dirLight.castShadow = !this.isSoftwareGl;
    this.dirLight.shadow.mapSize.set(1024, 1024);
    this.dirLight.shadow.camera.left = -28;
    this.dirLight.shadow.camera.right = 28;
    this.dirLight.shadow.camera.top = 28;
    this.dirLight.shadow.camera.bottom = -28;
    this.dirLight.shadow.camera.near = 2;
    this.dirLight.shadow.camera.far = 60;
    this.dirLight.shadow.bias = -0.0005;
    this.dirLight.shadow.normalBias = 0.02;
    this.scene.add(this.dirLight);

    // Helmet flashlight attached to camera (illuminates corridors, extra bright during Blackout!)
    this.flashlight = new THREE.SpotLight(0xfff4d6, 2.2, 24, Math.PI / 4.2, 0.52, 1.4);
    this.flashlight.position.set(0, 0, 0);
    this.flashlight.target.position.set(0, 0, -5);
    this.camera.add(this.flashlight);
    this.camera.add(this.flashlight.target);
    this.scene.add(this.camera);

    this.ceilingLightsMat = new THREE.MeshStandardMaterial({
      color: 0xfffce4,
      emissive: 0xfff3b8,
      emissiveIntensity: 1.5,
      roughness: 0.25,
    });

    this.buildLevelGeometry();

    // Hero Centerpiece: Central Check-in Pillar ("Cột Điểm Danh")
    this.pillarRig = createCheckinPillar(this.textures.pillarMap);
    this.pillarRig.group.position.set(PILLAR_POS.x, 0, PILLAR_POS.z);
    this.scene.add(this.pillarRig.group);

    // Build atmospheric idling Hazmat figures for Title Screen showcase
    this.buildTitleDemoActors();

    // Pooled Zero-GC Particle System (dust motes + burst effects)
    const pGeo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
    const pMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 });
    this.particleMesh = new THREE.InstancedMesh(pGeo, pMat, MAX_PARTICLES);
    this.particleMesh.frustumCulled = false;
    this.scene.add(this.particleMesh);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({
        active: i < 48,
        x: (Math.random() - 0.5) * 32,
        y: 0.4 + Math.random() * 2.8,
        z: (Math.random() - 0.5) * 32,
        vx: (Math.random() - 0.5) * 0.14,
        vy: 0.04 + Math.random() * 0.08,
        vz: (Math.random() - 0.5) * 0.14,
        life: Math.random() * 6,
        maxLife: 8,
        size: 0.5 + Math.random() * 0.5,
        color: new THREE.Color(0xefe2a8),
      });
    }

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);

    this.lastFrameTime = performance.now();
    this.tick();
  }

  private buildLevelGeometry(): void {
    const arenaWidth = GRID_COLS * CELL_SIZE;
    const arenaDepth = GRID_ROWS * CELL_SIZE;

    // 1) Damp Office Carpet Floor
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: this.textures.carpetMap,
      bumpMap: this.textures.carpetBump,
      bumpScale: 0.04,
      roughness: 0.92,
      metalness: 0.02,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(arenaWidth, arenaDepth), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // 2) Acoustic Drop Ceiling
    const ceilingMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: this.textures.ceilingMap,
      roughness: 0.88,
      metalness: 0.02,
    });
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(arenaWidth, arenaDepth), ceilingMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = WALL_HEIGHT;
    this.scene.add(ceiling);

    // 3) Instanced Mono-Yellow Wallpaper Walls
    const wallCells: Array<{ x: number; z: number }> = [];
    const lightCells: Array<{ x: number; z: number }> = [];

    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const wp = gridToWorld(r, c);
        if (isWallCell(r, c)) {
          wallCells.push(wp);
        } else if ((r + c) % 2 === 0 && (r % 2 === 1 || c % 2 === 1)) {
          lightCells.push(wp);
        }
      }
    }

    const wallGeo = new THREE.BoxGeometry(CELL_SIZE, WALL_HEIGHT, CELL_SIZE);
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: this.textures.wallMap,
      bumpMap: this.textures.wallBump,
      bumpScale: 0.03,
      roughness: 0.82,
      metalness: 0.03,
    });
    const wallInstanced = new THREE.InstancedMesh(wallGeo, wallMat, wallCells.length);
    wallInstanced.castShadow = !this.isSoftwareGl;
    wallInstanced.receiveShadow = true;

    wallCells.forEach((wc, idx) => {
      _mat4.makeTranslation(wc.x, WALL_HEIGHT * 0.5, wc.z);
      wallInstanced.setMatrixAt(idx, _mat4);
    });
    wallInstanced.instanceMatrix.needsUpdate = true;
    wallInstanced.computeBoundingSphere();
    this.scene.add(wallInstanced);

    // 4) Instanced Fluorescent Ceiling Light Fixtures
    const lightPanelGeo = new THREE.BoxGeometry(1.5, 0.06, 0.72);
    const lightInstanced = new THREE.InstancedMesh(
      lightPanelGeo,
      this.ceilingLightsMat,
      lightCells.length,
    );
    lightCells.forEach((lc, idx) => {
      _mat4.makeTranslation(lc.x, WALL_HEIGHT - 0.035, lc.z);
      lightInstanced.setMatrixAt(idx, _mat4);
    });
    lightInstanced.instanceMatrix.needsUpdate = true;
    lightInstanced.computeBoundingSphere();
    this.scene.add(lightInstanced);

    // 5) 4 Warm Accent PointLights at cardinal corridor entrances (within 4-6 PointLight budget)
    const cardinalLights = [
      [0, 3.1, -12],
      [0, 3.1, 12],
      [-12, 3.1, 0],
      [12, 3.1, 0],
    ];
    for (const [lx, ly, lz] of cardinalLights) {
      const pl = new THREE.PointLight(0xffe9a3, 1.5, 19, 1.6);
      pl.position.set(lx, ly, lz);
      this.scene.add(pl);
    }

    // 6) Grounded Backrooms Level 0 micro-props (wet floor caution signs & crate stacks in corners)
    const signPositions = [
      { x: 4.8, z: 4.8, rot: 0.5 },
      { x: -5.2, z: -4.4, rot: -0.9 },
      { x: 11.4, z: -4.2, rot: 1.2 },
      { x: -11.4, z: 4.6, rot: -0.4 },
    ];
    for (const sp of signPositions) {
      if (!isWallCell(Math.round(sp.z / CELL_SIZE + 9), Math.round(sp.x / CELL_SIZE + 9))) {
        const sign = createWetFloorSign();
        sign.position.set(sp.x, 0, sp.z);
        sign.rotation.y = sp.rot;
        this.scene.add(sign);
      }
    }

    const cratePositions = [
      { x: -7.1, z: -6.9, rot: 0.2 },
      { x: 7.0, z: 6.9, rot: -0.6 },
      { x: -15.0, z: -15.0, rot: 0.8 },
      { x: 15.0, z: 15.0, rot: 2.1 },
    ];
    for (const cp of cratePositions) {
      const cluster = createOfficeCrateCluster();
      cluster.position.set(cp.x, 0, cp.z);
      cluster.rotation.y = cp.rot;
      this.scene.add(cluster);
    }
  }

  private buildTitleDemoActors(): void {
    const spots = [
      { x: -3.2, z: 2.4, yaw: 0.85, suit: '#d8b643', accent: '#dc2626' },
      { x: 3.1, z: -1.8, yaw: -2.2, suit: '#cfb34e', accent: '#2563eb' },
      { x: 1.8, z: 3.6, yaw: -2.8, suit: '#c8ab44', accent: '#16a34a' },
    ];
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      const rig = createExplorerRig(`demo-${i}`, false, s.suit, s.accent, this.textures.contactShadowMap);
      rig.root.position.set(s.x, 0, s.z);
      rig.root.rotation.y = s.yaw;
      this.scene.add(rig.root);
      this.titleDemoActors.push(rig);
    }
  }

  setMode(mode: 'title' | 'live'): void {
    this.mode = mode;
    for (const demo of this.titleDemoActors) {
      demo.root.visible = mode === 'title';
    }
    if (mode === 'title') {
      this.exitPointerLock();
      this.keys.clear();
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      this.keys.clear();
      this.exitPointerLock();
    }
  }

  setModalBlockingInput(blocking: boolean): void {
    this.modalBlockingInput = blocking;
    if (blocking) {
      this.keys.clear();
      this.exitPointerLock();
    }
  }

  setSensitivity(sens: number): void {
    this.sensitivity = sens;
  }

  triggerImpact(trauma: number, hitstopSec = 0, burstX?: number, burstZ?: number, colorHex = 0xfbbf24): void {
    this.cameraTrauma = Math.min(1, this.cameraTrauma + trauma);
    this.hitstopTimer = Math.max(this.hitstopTimer, hitstopSec);
    if (burstX !== undefined && burstZ !== undefined) {
      this.spawnBurst(burstX, 1.3, burstZ, 20, colorHex);
    }
  }

  private spawnBurst(x: number, y: number, z: number, count: number, colorHex: number): void {
    for (let i = 0; i < count; i++) {
      // Reserve slots 0..47 for ambient dust motes; use 48..MAX_PARTICLES-1 for bursts
      const slotIdx = 48 + (this.particleCursor % (MAX_PARTICLES - 48));
      this.particleCursor++;
      const p = this.particles[slotIdx];
      p.active = true;
      p.x = x;
      p.y = y;
      p.z = z;
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.4 + Math.random() * 3.8;
      p.vx = Math.cos(angle) * speed;
      p.vy = 1.2 + Math.random() * 2.6;
      p.vz = Math.sin(angle) * speed;
      p.life = 0;
      p.maxLife = 0.55 + Math.random() * 0.45;
      p.size = 0.9 + Math.random() * 0.9;
      p.color.setHex(colorHex);
    }
  }

  requestPointerLock(): void {
    if (this.mode !== 'live' || this.paused || this.modalBlockingInput) return;
    try {
      this.renderer.domElement.requestPointerLock?.();
    } catch {
      // ignore if browser blocks pointer lock
    }
  }

  exitPointerLock(): void {
    if (document.pointerLockElement === this.renderer.domElement) {
      document.exitPointerLock?.();
    }
  }

  applyServerSnapshot(snap: RoomSnapshot): void {
    const prevPhase = this.lastServerPhase;
    this.snapshot = snap;
    this.lastServerPhase = snap.phase;

    const me = snap.players.find((p) => p.id === snap.yourId);
    if (me) {
      // Snap local position on first join or phase reset (warmup/lobby)
      const phaseReset =
        !this.lastPositionSynced ||
        (prevPhase !== snap.phase && (snap.phase === 'warmup' || snap.phase === 'lobby'));
      if (phaseReset) {
        this.localX = me.x;
        this.localZ = me.z;
        this.localYaw = me.yaw;
        this.localPitch = 0;
        this.lastPositionSynced = true;
      } else {
        // Gentle reconciliation if server disagrees by > 2.2m (e.g. stun lock or collision)
        const drift = distance2D(this.localX, this.localZ, me.x, me.z);
        if (drift > 2.2) {
          this.localX = me.x;
          this.localZ = me.z;
        }
      }
    }

    // Sync remote player rigs
    const activeIds = new Set<string>();
    for (const p of snap.players) {
      if (p.id === snap.yourId) continue;
      activeIds.add(p.id);
      if (!this.playerRigs.has(p.id)) {
        const rig = createExplorerRig(
          p.id,
          false,
          p.suitColor,
          p.accentColor,
          this.textures.contactShadowMap,
        );
        rig.root.position.set(p.x, 0, p.z);
        rig.root.rotation.y = p.yaw;
        this.scene.add(rig.root);
        this.playerRigs.set(p.id, rig);
      }
    }
    for (const [id, rig] of this.playerRigs.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(rig.root);
        this.playerRigs.delete(id);
      }
    }

    // Sync Decoy rigs
    const activeDecoyIds = new Set<string>();
    for (const d of snap.decoys) {
      activeDecoyIds.add(d.id);
      if (!this.decoyRigs.has(d.id)) {
        const rig = createExplorerRig(
          d.id,
          true,
          d.suitColor,
          d.accentColor,
          this.textures.contactShadowMap,
        );
        rig.root.position.set(d.x, 0, d.z);
        rig.root.rotation.y = d.yaw;
        this.scene.add(rig.root);
        this.decoyRigs.set(d.id, rig);
      }
    }
    for (const [id, rig] of this.decoyRigs.entries()) {
      if (!activeDecoyIds.has(id)) {
        this.scene.remove(rig.root);
        this.decoyRigs.delete(id);
      }
    }

    // Sync World Items
    const activeItemIds = new Set<string>();
    for (const it of snap.items) {
      activeItemIds.add(it.id);
      if (!this.itemMeshes.has(it.id)) {
        const mesh = createItemPickupMesh(it.type, this.textures.contactShadowMap);
        mesh.position.set(it.x, 0, it.z);
        this.scene.add(mesh);
        this.itemMeshes.set(it.id, { type: it.type, group: mesh });
      }
    }
    for (const [id, entry] of this.itemMeshes.entries()) {
      if (!activeItemIds.has(id)) {
        this.scene.remove(entry.group);
        this.itemMeshes.delete(id);
      }
    }

    // Sync Smoke Clouds
    const activeSmokeIds = new Set<string>();
    for (const sm of snap.smokes) {
      activeSmokeIds.add(sm.id);
      if (!this.smokeMeshes.has(sm.id)) {
        const g = new THREE.Group();
        const smokeMat = new THREE.MeshStandardMaterial({
          color: 0xd9cfa2,
          transparent: true,
          opacity: 0.62,
          roughness: 1.0,
          depthWrite: false,
        });
        for (let i = 0; i < 6; i++) {
          const puff = new THREE.Mesh(
            new THREE.DodecahedronGeometry(sm.radius * (0.48 + (i % 3) * 0.14), 1),
            smokeMat,
          );
          const a = (i / 6) * Math.PI * 2;
          puff.position.set(Math.cos(a) * 1.1, 1.0 + (i % 2) * 0.85, Math.sin(a) * 1.1);
          g.add(puff);
        }
        g.position.set(sm.x, 0, sm.z);
        this.scene.add(g);
        this.smokeMeshes.set(sm.id, g);
      }
    }
    for (const [id, g] of this.smokeMeshes.entries()) {
      if (!activeSmokeIds.has(id)) {
        this.scene.remove(g);
        this.smokeMeshes.delete(id);
      }
    }
  }

  private bindEvents(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onWindowBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('mousemove', this.onMouseMove);

    const dom = this.renderer.domElement;
    dom.addEventListener('mousedown', this.onCanvasMouseDown);
    window.addEventListener('mouseup', this.onWindowMouseUp);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const activeTag = (document.activeElement as HTMLElement | null)?.tagName;
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;

    if (e.code === 'KeyM' && !e.repeat) {
      this.callbacks.onToggleMute();
      return;
    }

    if (this.mode !== 'live') return;

    if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) {
      if (!this.modalBlockingInput) {
        this.callbacks.onTogglePause();
      }
      return;
    }

    if (this.paused || this.modalBlockingInput) return;

    this.keys.add(e.code);

    if (!e.repeat) {
      if (e.code === 'KeyE') {
        this.callbacks.onInteract({
          lockedTarget: this.currentLockedTarget,
          nearPillar: this.currentNearPillar,
          nearItem: this.currentNearItem,
        });
      } else if (e.code === 'KeyF') {
        this.callbacks.onUseItem();
      } else if (e.code === 'KeyQ') {
        this.callbacks.onUseSkill();
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onWindowBlur = (): void => {
    this.keys.clear();
    this.isDraggingLook = false;
  };

  private onVisibilityChange = (): void => {
    if (document.hidden) {
      this.keys.clear();
      this.isDraggingLook = false;
    }
  };

  private onPointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.renderer.domElement;
  };

  private onCanvasMouseDown = (e: MouseEvent): void => {
    if (this.mode !== 'live' || this.paused || this.modalBlockingInput) return;
    this.audio.unlock();

    if (e.button === 0) {
      // If pointer is already locked and Seeker has a crosshair target or near Pillar -> interact immediately!
      if (this.pointerLocked) {
        if (this.currentLockedTarget || this.currentNearPillar || this.currentNearItem) {
          this.callbacks.onInteract({
            lockedTarget: this.currentLockedTarget,
            nearPillar: this.currentNearPillar,
            nearItem: this.currentNearItem,
          });
          return;
        }
      } else {
        // Allow click-drag look AND attempt PointerLock for FPS feel
        this.isDraggingLook = true;
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;
        if (this.currentLockedTarget) {
          this.callbacks.onInteract({
            lockedTarget: this.currentLockedTarget,
            nearPillar: this.currentNearPillar,
            nearItem: this.currentNearItem,
          });
          return;
        }
        this.requestPointerLock();
      }
    }
  };

  private onWindowMouseUp = (): void => {
    this.isDraggingLook = false;
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (this.mode !== 'live' || this.paused || this.modalBlockingInput) return;

    if (this.pointerLocked) {
      this.localYaw -= e.movementX * this.sensitivity;
      this.localPitch = THREE.MathUtils.clamp(
        this.localPitch - e.movementY * this.sensitivity,
        -Math.PI * 0.42,
        Math.PI * 0.42,
      );
    } else if (this.isDraggingLook) {
      const dx = e.clientX - this.lastPointerX;
      const dy = e.clientY - this.lastPointerY;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      this.localYaw -= dx * this.sensitivity * 1.4;
      this.localPitch = THREE.MathUtils.clamp(
        this.localPitch - dy * this.sensitivity * 1.4,
        -Math.PI * 0.42,
        Math.PI * 0.42,
      );
    }
  };

  private handleResize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private tick = (): void => {
    if (this.disposed) return;

    const now = performance.now();
    const rawDt = Math.max(0.001, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;
    const dt = Math.min(rawDt, 0.05);

    this.elapsed += dt;
    const simDt = this.hitstopTimer > 0 ? 0 : dt;
    if (this.hitstopTimer > 0) {
      this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
    }

    this.updateAtmosphere(dt);
    this.updateParticles(dt);

    if (this.mode === 'title') {
      this.updateTitleFlyover(dt);
    } else {
      this.updateLiveGameplay(simDt, dt, now);
    }

    this.renderer.render(this.scene, this.camera);

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private updateAtmosphere(dt: number): void {
    const isBlackout = Boolean(this.snapshot?.isBlackout);
    this.audio.setBlackoutModulation(isBlackout);

    // Fluorescent flicker / Blackout Surge
    const subtleFlicker = 0.96 + Math.sin(this.elapsed * 31) * 0.02 + Math.sin(this.elapsed * 13) * 0.02;
    const blackoutFlicker = isBlackout
      ? Math.sin(this.elapsed * 47) > 0.72
        ? 0.42
        : 0.08
      : subtleFlicker;

    const damp = 1 - Math.exp(-8 * dt);
    this.dirLight.intensity = THREE.MathUtils.lerp(
      this.dirLight.intensity,
      isBlackout ? 0.12 : 0.95 * subtleFlicker,
      damp,
    );
    this.hemiLight.intensity = THREE.MathUtils.lerp(
      this.hemiLight.intensity,
      isBlackout ? 0.16 : 1.05,
      damp,
    );
    this.ceilingLightsMat.emissiveIntensity = isBlackout ? blackoutFlicker * 0.9 : 1.45 * subtleFlicker;
    this.flashlight.intensity = THREE.MathUtils.lerp(
      this.flashlight.intensity,
      isBlackout ? 5.8 : 1.8,
      damp,
    );

    // Check-in Pillar beacon color reacts to active claim or phase
    const hasClaim = Boolean(this.snapshot?.claim);
    if (hasClaim) {
      this.pillarRig.beaconMat.color.setHex(0xef4444);
      this.pillarRig.beaconMat.emissive.setHex(0xdc2626);
      this.pillarRig.beaconMat.emissiveIntensity = 1.6 + Math.sin(this.elapsed * 10) * 0.8;
      this.pillarRig.floorRingMat.color.setHex(0xef4444);
      this.pillarRig.light.color.setHex(0xff5555);
    } else {
      this.pillarRig.beaconMat.color.setHex(0xfbbf24);
      this.pillarRig.beaconMat.emissive.setHex(0xf59e0b);
      this.pillarRig.beaconMat.emissiveIntensity = 1.5 + Math.sin(this.elapsed * 3) * 0.3;
      this.pillarRig.floorRingMat.color.setHex(0xeab308);
      this.pillarRig.light.color.setHex(0xffcf6e);
    }

    // Rotate & bob hidden Backrooms pickups
    for (const entry of this.itemMeshes.values()) {
      const bob = entry.group.getObjectByName('bob');
      if (bob) {
        bob.rotation.y += dt * 1.6;
        bob.position.y = 0.56 + Math.sin(this.elapsed * 2.8 + entry.group.position.x) * 0.08;
      }
    }

    // Gentle swirl on smoke clouds
    for (const g of this.smokeMeshes.values()) {
      g.rotation.y += dt * 0.45;
    }
  }

  private updateParticles(dt: number): void {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.active) {
        _scale.set(0, 0, 0);
        _mat4.compose(_vec3A.set(0, -10, 0), _quat.identity(), _scale);
        this.particleMesh.setMatrixAt(i, _mat4);
        continue;
      }
      p.life += dt;
      if (i < 48) {
        // Ambient floating dust motes inside the Backrooms atrium
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        if (p.y > WALL_HEIGHT - 0.2) p.y = 0.3;
        _scale.setScalar(p.size * 0.45);
      } else {
        // Burst particles with gravity
        p.vy -= 5.8 * dt;
        p.x += p.vx * dt;
        p.y = Math.max(0.05, p.y + p.vy * dt);
        p.z += p.vz * dt;
        const remain = Math.max(0, 1 - p.life / p.maxLife);
        if (remain <= 0) {
          p.active = false;
        }
        _scale.setScalar(p.size * remain);
      }
      _mat4.compose(_vec3A.set(p.x, p.y, p.z), _quat.identity(), _scale);
      this.particleMesh.setMatrixAt(i, _mat4);
      this.particleMesh.setColorAt(i, p.color);
    }
    this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor) {
      this.particleMesh.instanceColor.needsUpdate = true;
    }
  }

  private updateTitleFlyover(dt: number): void {
    // Atmospheric orbiting showcase around the central Check-in Pillar & Backrooms corridors
    const angle = this.elapsed * 0.16;
    const radius = 8.4 + Math.sin(this.elapsed * 0.28) * 1.4;
    const camX = Math.sin(angle) * radius;
    const camZ = Math.cos(angle) * radius;
    const camY = 2.05 + Math.sin(this.elapsed * 0.45) * 0.25;

    this.camera.position.set(camX, camY, camZ);
    // Offset lookAt slightly left so the glowing Pillar sits cleanly in the right 65% of the frame!
    _vec3A.set(PILLAR_POS.x - Math.cos(angle) * 1.6, 1.55, PILLAR_POS.z + Math.sin(angle) * 1.6);
    this.camera.lookAt(_vec3A);

    for (let i = 0; i < this.titleDemoActors.length; i++) {
      const rig = this.titleDemoActors[i];
      rig.bodyGroup.position.y = Math.sin(this.elapsed * 2.1 + i * 1.7) * 0.018;
      rig.root.rotation.y += Math.sin(this.elapsed * 0.5 + i) * 0.08 * dt;
    }
  }

  private updateLiveGameplay(simDt: number, dt: number, nowMs: number): void {
    const snap = this.snapshot;
    const me: PublicPlayerSnapshot | undefined = snap?.players.find((p) => p.id === snap.yourId);

    // Update remote player rigs
    if (snap) {
      for (const p of snap.players) {
        if (p.id === snap.yourId) continue;
        const rig = this.playerRigs.get(p.id);
        if (rig) {
          updateExplorerRig(rig, p, dt, this.elapsed);
        }
      }
    }

    // Subtle glitch wobble on Decoy Echoes
    for (const rig of this.decoyRigs.values()) {
      rig.bodyGroup.position.y = Math.sin(this.elapsed * 4.5) * 0.025;
      rig.torsoMat.emissive.set('#2b2612');
      rig.torsoMat.emissiveIntensity = 0.25 + Math.sin(this.elapsed * 14) * 0.12;
    }

    // Local controls & kinematics
    const isSeekerWarmupLocked = Boolean(snap?.phase === 'warmup' && me?.role === 'seeker');
    const isStunned = Boolean(me && me.stunMs > 0);
    const canMove = !this.paused && !this.modalBlockingInput && !isSeekerWarmupLocked && !isStunned;

    // Keyboard turning support (ArrowLeft / ArrowRight)
    if (!this.paused && !this.modalBlockingInput) {
      const turnSpeed = 2.1;
      if (this.keys.has('ArrowLeft')) this.localYaw += turnSpeed * dt;
      if (this.keys.has('ArrowRight')) this.localYaw -= turnSpeed * dt;
    }

    let moveForward = 0;
    let moveRight = 0;
    if (canMove) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) moveForward += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) moveForward -= 1;
      if (this.keys.has('KeyD')) moveRight += 1;
      if (this.keys.has('KeyA')) moveRight -= 1;
    }

    const crouching = canMove && (this.keys.has('KeyC') || this.keys.has('ControlLeft'));
    const wantsSprint =
      canMove &&
      !crouching &&
      (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) &&
      (moveForward !== 0 || moveRight !== 0) &&
      this.stamina > 2;

    const hasSpeedBoost = Boolean(me && me.speedBoostMs > 0);
    if (hasSpeedBoost) {
      this.stamina = Math.min(100, this.stamina + 40 * dt);
    } else if (wantsSprint) {
      this.stamina = Math.max(0, this.stamina - 24 * dt);
    } else {
      this.stamina = Math.min(100, this.stamina + 16 * dt);
    }

    const isVisitorOrGhost = me?.status === 'visitor' || me?.status === 'eliminated';
    let targetSpeed = 0;
    if (moveForward !== 0 || moveRight !== 0) {
      const baseWalk = isVisitorOrGhost ? 6.2 : me?.role === 'seeker' ? 4.8 : 4.4;
      const sprintMult = wantsSprint ? 1.52 : crouching ? 0.58 : 1.0;
      const boostMult = hasSpeedBoost ? 1.35 : 1.0;
      const claimRushMult =
        me?.role === 'seeker' && snap?.claim?.seekerId === me.id ? 1.15 : 1.0;
      targetSpeed = baseWalk * sprintMult * boostMult * claimRushMult;

      // Forward vector in Three.js (-Z when yaw=0)
      const sinY = Math.sin(this.localYaw);
      const cosY = Math.cos(this.localYaw);
      const fx = -sinY;
      const fz = -cosY;
      const rx = cosY;
      const rz = -sinY;

      let vx = fx * moveForward + rx * moveRight;
      let vz = fz * moveForward + rz * moveRight;
      const vLen = Math.hypot(vx, vz) || 1;
      vx = (vx / vLen) * targetSpeed * simDt;
      vz = (vz / vLen) * targetSpeed * simDt;

      const resolved = resolveCircleWallCollision(this.localX + vx, this.localZ + vz);
      const movedDist = distance2D(this.localX, this.localZ, resolved.x, resolved.z);
      this.localX = resolved.x;
      this.localZ = resolved.z;

      this.headBobPhase += movedDist * 3.1;
      this.stepAccum += movedDist;
      if (this.stepAccum >= (wantsSprint ? 1.65 : 1.85) && !isVisitorOrGhost) {
        this.stepAccum = 0;
        this.audio.playFootstep(wantsSprint);
      }
    }
    this.localSpeed = targetSpeed;

    // Camera height, head bob, FOV kick, and decaying trauma shake
    const targetEyeY = isVisitorOrGhost ? 2.15 : crouching ? 1.12 : 1.62;
    const bobOffset =
      targetSpeed > 0.5 && !isVisitorOrGhost ? Math.sin(this.headBobPhase) * 0.055 : 0;

    this.cameraTrauma = Math.max(0, this.cameraTrauma - 1.9 * dt);
    const shake = this.cameraTrauma * this.cameraTrauma;
    const shakeYaw = (Math.random() - 0.5) * 0.06 * shake;
    const shakePitch = (Math.random() - 0.5) * 0.06 * shake;

    const damp = 1 - Math.exp(-12 * dt);
    this.camera.position.x = this.localX;
    this.camera.position.z = this.localZ;
    this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, targetEyeY + bobOffset, damp);
    this.camera.rotation.y = this.localYaw + shakeYaw;
    this.camera.rotation.x = this.localPitch + shakePitch;
    this.camera.rotation.z = THREE.MathUtils.lerp(
      this.camera.rotation.z,
      -moveRight * 0.018,
      damp,
    );

    const desiredFov = hasSpeedBoost ? 82 : wantsSprint ? 77 : 72;
    if (Math.abs(this.camera.fov - desiredFov) > 0.1) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, desiredFov, damp);
      this.camera.updateProjectionMatrix();
    }

    // Proximity Heartbeat Audio for active Hider when Seeker gets close
    if (snap && me && snap.phase === 'playing' && me.role === 'hider' && me.status === 'active') {
      const seeker = snap.players.find((p) => p.role === 'seeker');
      if (seeker) {
        const dSeeker = distance2D(this.localX, this.localZ, seeker.x, seeker.z);
        this.audio.tickProximityHeartbeat(dSeeker);
      }
    }

    // Send movement update to server at 20Hz
    if (nowMs - this.lastMoveSendAt >= 50) {
      this.lastMoveSendAt = nowMs;
      // Convert camera yaw (Three.js -Z forward) to character facing yaw (+Z forward)
      const bodyYaw = this.localYaw + Math.PI;
      this.callbacks.onSendMove({
        x: Number(this.localX.toFixed(3)),
        y: 0,
        z: Number(this.localZ.toFixed(3)),
        yaw: Number(bodyYaw.toFixed(3)),
        pitch: Number(this.localPitch.toFixed(3)),
        speed: Number(this.localSpeed.toFixed(2)),
        crouching,
      });
    }

    // Throttled HUD raycast, pillar proximity, item proximity & 3D->2D nameplate projection (~15Hz)
    if (nowMs - this.lastReportAt >= 66) {
      this.lastReportAt = nowMs;
      this.computeAndEmitHudReport(snap, me);
    }
  }

  private computeAndEmitHudReport(
    snap: RoomSnapshot | null,
    me: PublicPlayerSnapshot | undefined,
  ): void {
    // 1) Seeker crosshair raycast against active Hiders & Decoys
    let lockedTarget: CrosshairTarget | null = null;
    if (
      snap &&
      me &&
      snap.phase === 'playing' &&
      me.role === 'seeker' &&
      me.stunMs <= 0
    ) {
      const hitboxes: THREE.Object3D[] = [];
      for (const p of snap.players) {
        if (p.id === me.id || p.role !== 'hider' || p.status !== 'active') continue;
        const rig = this.playerRigs.get(p.id);
        if (rig && rig.root.visible) hitboxes.push(rig.hitbox);
      }
      for (const rig of this.decoyRigs.values()) {
        hitboxes.push(rig.hitbox);
      }

      if (hitboxes.length > 0) {
        this.raycaster.setFromCamera(_centerNDC, this.camera);
        this.raycaster.far = SPOT_MAX_DISTANCE;
        const hits = this.raycaster.intersectObjects(hitboxes, false);
        if (hits.length > 0) {
          const hit = hits[0];
          const entityId = String(hit.object.userData.entityId || '');
          const isDecoy = Boolean(hit.object.userData.isDecoy);
          const worldPos = hit.object.getWorldPosition(_vec3B);
          if (hasLineOfSight(this.localX, this.localZ, worldPos.x, worldPos.z, snap.smokes)) {
            lockedTarget = {
              entityId,
              isDecoy,
              distance: Math.round(hit.distance),
            };
          }
        }
      }
    }

    if (lockedTarget && lockedTarget.entityId !== this.lastLockedTargetId) {
      this.audio.playTargetLock();
    }
    this.lastLockedTargetId = lockedTarget?.entityId ?? null;
    this.currentLockedTarget = lockedTarget;

    // 2) Pillar proximity & relative compass angle
    const distToPillar = distance2D(this.localX, this.localZ, PILLAR_POS.x, PILLAR_POS.z);
    const nearPillar = distToPillar <= PILLAR_INTERACT_RADIUS;
    this.currentNearPillar = nearPillar;

    // Angle from player forward vector (-sin(yaw), -cos(yaw)) to pillar
    const dxP = PILLAR_POS.x - this.localX;
    const dzP = PILLAR_POS.z - this.localZ;
    const worldAngleToPillar = Math.atan2(-dxP, -dzP);
    let relAngle = worldAngleToPillar - this.localYaw;
    while (relAngle > Math.PI) relAngle -= Math.PI * 2;
    while (relAngle < -Math.PI) relAngle += Math.PI * 2;

    // 3) Nearby pickup item
    let nearItem: { id: string; type: ItemType } | null = null;
    if (snap && me && me.status === 'active' && (snap.phase === 'playing' || snap.phase === 'warmup')) {
      for (const it of snap.items) {
        if (distance2D(this.localX, this.localZ, it.x, it.z) <= ITEM_PICKUP_RADIUS) {
          nearItem = { id: it.id, type: it.type };
          break;
        }
      }
    }
    this.currentNearItem = nearItem;

    // 4) Project visible floating nameplates & central Pillar beacon label
    const labels: ProjectedLabel[] = [];
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    // Project Pillar label when visible
    _vec3A.set(PILLAR_POS.x, 3.05, PILLAR_POS.z);
    _vec3A.project(this.camera);
    if (_vec3A.z >= -1 && _vec3A.z <= 1) {
      const sx = ((_vec3A.x + 1) / 2) * width;
      const sy = (-(_vec3A.y - 1) / 2) * height;
      if (sx > -40 && sx < width + 40 && sy > -40 && sy < height + 40) {
        labels.push({
          id: 'pillar-marker',
          text: 'CỘT ĐIỂM DANH',
          subtext: `${Math.round(distToPillar)}m`,
          x: Math.round(sx),
          y: Math.round(sy),
          tone: 'pillar',
        });
      }
    }

    if (snap) {
      for (const p of snap.players) {
        if (p.id === snap.yourId || p.status === 'eliminated') continue;
        if (!p.displayName) continue; // Hidden hider names are strictly omitted!
        const rig = this.playerRigs.get(p.id);
        if (!rig || !rig.root.visible) continue;

        const d = distance2D(this.localX, this.localZ, rig.root.position.x, rig.root.position.z);
        if (d > 26) continue;
        if (
          snap.phase === 'playing' &&
          me?.status === 'active' &&
          !hasLineOfSight(this.localX, this.localZ, rig.root.position.x, rig.root.position.z, snap.smokes)
        ) {
          continue;
        }

        _vec3A.set(rig.root.position.x, p.crouching ? 1.65 : 2.08, rig.root.position.z);
        _vec3A.project(this.camera);
        if (_vec3A.z >= -1 && _vec3A.z <= 1) {
          const sx = ((_vec3A.x + 1) / 2) * width;
          const sy = (-(_vec3A.y - 1) / 2) * height;
          if (sx > 0 && sx < width && sy > 0 && sy < height) {
            labels.push({
              id: p.id,
              text: p.displayName,
              subtext:
                p.status === 'visitor'
                  ? 'VISITOR · ĐÃ THẮNG'
                  : p.role === 'seeker' && snap.phase !== 'lobby'
                    ? 'NGƯỜI ĐI TÌM'
                    : undefined,
              x: Math.round(sx),
              y: Math.round(sy),
              tone:
                p.status === 'visitor'
                  ? 'visitor'
                  : p.role === 'seeker' && snap.phase !== 'lobby'
                    ? 'seeker'
                    : 'normal',
            });
          }
        }
      }
    }

    this.callbacks.onReport({
      stamina: Math.round(this.stamina),
      pointerLocked: this.pointerLocked,
      lockedTarget,
      nearPillar,
      distanceToPillar: Math.round(distToPillar),
      pillarAngleRad: relAngle,
      nearItem,
      labels,
      playerX: this.localX,
      playerZ: this.localZ,
      playerYaw: this.localYaw,
    });
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.resizeObserver.disconnect();
    this.exitPointerLock();

    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onWindowBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('mousemove', this.onMouseMove);
    this.renderer.domElement.removeEventListener('mousedown', this.onCanvasMouseDown);
    window.removeEventListener('mouseup', this.onWindowMouseUp);

    this.textures.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
