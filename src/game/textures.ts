import * as THREE from 'three';

export interface BackroomsTextureSet {
  wallMap: THREE.CanvasTexture;
  wallBump: THREE.CanvasTexture;
  carpetMap: THREE.CanvasTexture;
  carpetBump: THREE.CanvasTexture;
  ceilingMap: THREE.CanvasTexture;
  pillarMap: THREE.CanvasTexture;
  contactShadowMap: THREE.CanvasTexture;
  dispose: () => void;
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

export function createBackroomsTextures(maxAnisotropy: number): BackroomsTextureSet {
  const aniso = Math.min(Math.max(maxAnisotropy, 1), 8);

  // 1) Classic Backrooms Level 0 Mono-Yellow Patterned Wallpaper + Damp Baseboard
  const [wallCanvas, wCtx] = makeCanvas(512, 512);
  wCtx.fillStyle = '#c5b465';
  wCtx.fillRect(0, 0, 512, 512);

  // Subtle vertical aged wallpaper seam & damp mottling
  const gradTop = wCtx.createLinearGradient(0, 0, 0, 512);
  gradTop.addColorStop(0, 'rgba(62, 52, 22, 0.24)');
  gradTop.addColorStop(0.14, 'rgba(0, 0, 0, 0)');
  gradTop.addColorStop(0.8, 'rgba(72, 60, 26, 0.08)');
  gradTop.addColorStop(0.92, 'rgba(54, 42, 18, 0.34)');
  gradTop.addColorStop(1, 'rgba(34, 26, 12, 0.55)');
  wCtx.fillStyle = gradTop;
  wCtx.fillRect(0, 0, 512, 512);

  // Iconic subtle vertical striped damask arrows
  wCtx.strokeStyle = 'rgba(130, 114, 52, 0.36)';
  wCtx.fillStyle = 'rgba(138, 122, 56, 0.22)';
  wCtx.lineWidth = 2;
  for (let x = 16; x < 512; x += 32) {
    // Vertical faint stripe
    wCtx.beginPath();
    wCtx.moveTo(x, 0);
    wCtx.lineTo(x, 464);
    wCtx.stroke();

    // Small chevron/arrow motif every 48px
    for (let y = 24; y < 456; y += 48) {
      const offset = ((x / 32) % 2) * 24;
      const py = y + offset;
      if (py > 452) continue;
      wCtx.beginPath();
      wCtx.moveTo(x - 7, py + 7);
      wCtx.lineTo(x, py - 5);
      wCtx.lineTo(x + 7, py + 7);
      wCtx.lineTo(x, py + 3);
      wCtx.closePath();
      wCtx.fill();
    }
  }

  // Fine paper grain speckles
  for (let i = 0; i < 2400; i++) {
    const gx = (i * 97) % 512;
    const gy = (i * 193) % 466;
    wCtx.fillStyle = i % 2 === 0 ? 'rgba(95, 82, 34, 0.09)' : 'rgba(232, 220, 150, 0.07)';
    wCtx.fillRect(gx, gy, 2, 2);
  }

  // Dark aged wooden baseboard along bottom
  wCtx.fillStyle = '#4e4124';
  wCtx.fillRect(0, 468, 512, 44);
  wCtx.fillStyle = '#6b5b34';
  wCtx.fillRect(0, 468, 512, 5);
  wCtx.fillStyle = '#2d2412';
  wCtx.fillRect(0, 474, 512, 3);

  const wallMap = new THREE.CanvasTexture(wallCanvas);
  wallMap.colorSpace = THREE.SRGBColorSpace;
  wallMap.wrapS = THREE.RepeatWrapping;
  wallMap.wrapT = THREE.ClampToEdgeWrapping;
  wallMap.anisotropy = aniso;

  // Wall bump map (grayscale)
  const [wallBumpCanvas, wbCtx] = makeCanvas(256, 256);
  wbCtx.fillStyle = '#808080';
  wbCtx.fillRect(0, 0, 256, 256);
  wbCtx.fillStyle = '#949494';
  for (let x = 8; x < 256; x += 16) {
    wbCtx.fillRect(x, 0, 2, 234);
  }
  wbCtx.fillStyle = '#b4b4b4';
  wbCtx.fillRect(0, 234, 256, 22);
  const wallBump = new THREE.CanvasTexture(wallBumpCanvas);
  wallBump.wrapS = THREE.RepeatWrapping;
  wallBump.wrapT = THREE.ClampToEdgeWrapping;
  wallBump.anisotropy = aniso;

  // 2) Damp Office Carpet (mustard-ochre woven texture)
  const [carpetCanvas, cCtx] = makeCanvas(512, 512);
  cCtx.fillStyle = '#8d7a42';
  cCtx.fillRect(0, 0, 512, 512);

  // Damp irregular stain clouds
  for (let i = 0; i < 18; i++) {
    const cx = ((i * 137) % 480) + 16;
    const cy = ((i * 211) % 480) + 16;
    const r = 45 + (i % 4) * 28;
    const rg = cCtx.createRadialGradient(cx, cy, 4, cx, cy, r);
    rg.addColorStop(0, 'rgba(64, 53, 24, 0.24)');
    rg.addColorStop(1, 'rgba(64, 53, 24, 0)');
    cCtx.fillStyle = rg;
    cCtx.beginPath();
    cCtx.arc(cx, cy, r, 0, Math.PI * 2);
    cCtx.fill();
  }

  // Tight commercial carpet weave speckles
  for (let y = 0; y < 512; y += 4) {
    for (let x = 0; x < 512; x += 4) {
      const h = ((x * 73 + y * 151) ^ (x * 19)) & 255;
      if (h > 175) {
        cCtx.fillStyle = 'rgba(176, 156, 92, 0.22)';
        cCtx.fillRect(x, y, 2, 2);
      } else if (h < 70) {
        cCtx.fillStyle = 'rgba(62, 51, 22, 0.24)';
        cCtx.fillRect(x, y, 2, 2);
      }
    }
  }

  const carpetMap = new THREE.CanvasTexture(carpetCanvas);
  carpetMap.colorSpace = THREE.SRGBColorSpace;
  carpetMap.wrapS = THREE.RepeatWrapping;
  carpetMap.wrapT = THREE.RepeatWrapping;
  carpetMap.repeat.set(22, 22);
  carpetMap.anisotropy = aniso;

  const [carpetBumpCanvas, cbCtx] = makeCanvas(256, 256);
  cbCtx.fillStyle = '#7c7c7c';
  cbCtx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 2) {
    for (let x = 0; x < 256; x += 2) {
      const v = 105 + (((x * 41 + y * 83) ^ (y * 17)) & 45);
      cbCtx.fillStyle = `rgb(${v},${v},${v})`;
      cbCtx.fillRect(x, y, 2, 2);
    }
  }
  const carpetBump = new THREE.CanvasTexture(carpetBumpCanvas);
  carpetBump.wrapS = THREE.RepeatWrapping;
  carpetBump.wrapT = THREE.RepeatWrapping;
  carpetBump.repeat.set(22, 22);

  // 3) Acoustic Drop Ceiling Tiles
  const [ceilCanvas, ceCtx] = makeCanvas(512, 512);
  ceCtx.fillStyle = '#cfc59d';
  ceCtx.fillRect(0, 0, 512, 512);
  // Tile grid T-bars (2x4 acoustic panels)
  ceCtx.strokeStyle = '#7e7657';
  ceCtx.lineWidth = 8;
  ceCtx.strokeRect(0, 0, 512, 512);
  ceCtx.beginPath();
  ceCtx.moveTo(256, 0);
  ceCtx.lineTo(256, 512);
  ceCtx.moveTo(0, 128);
  ceCtx.lineTo(512, 128);
  ceCtx.moveTo(0, 256);
  ceCtx.lineTo(512, 256);
  ceCtx.moveTo(0, 384);
  ceCtx.lineTo(512, 384);
  ceCtx.stroke();

  // Acoustic pinhole dots
  ceCtx.fillStyle = 'rgba(72, 65, 42, 0.28)';
  for (let i = 0; i < 1600; i++) {
    const px = (i * 113) % 512;
    const py = (i * 227) % 512;
    ceCtx.fillRect(px, py, 2, 2);
  }

  const ceilingMap = new THREE.CanvasTexture(ceilCanvas);
  ceilingMap.colorSpace = THREE.SRGBColorSpace;
  ceilingMap.wrapS = THREE.RepeatWrapping;
  ceilingMap.wrapT = THREE.RepeatWrapping;
  ceilingMap.repeat.set(19, 19);
  ceilingMap.anisotropy = aniso;

  // 4) Central Check-in Pillar Industrial Concrete & Caution Stripes
  const [pillarCanvas, pCtx] = makeCanvas(512, 512);
  pCtx.fillStyle = '#8b836b';
  pCtx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 1800; i++) {
    const px = (i * 89) % 512;
    const py = (i * 179) % 512;
    pCtx.fillStyle = i % 2 === 0 ? 'rgba(42, 39, 30, 0.14)' : 'rgba(218, 210, 182, 0.1)';
    pCtx.fillRect(px, py, 3, 2);
  }
  // Seamless 360-degree yellow-black hazard stripe band (period = 64px divides 512px evenly)
  pCtx.save();
  pCtx.beginPath();
  pCtx.rect(0, 216, 512, 80);
  pCtx.clip();
  pCtx.fillStyle = '#e2b632';
  pCtx.fillRect(0, 216, 512, 80);
  pCtx.fillStyle = '#1b1913';
  for (let sx = -128; sx < 640; sx += 64) {
    pCtx.beginPath();
    pCtx.moveTo(sx, 216);
    pCtx.lineTo(sx + 32, 216);
    pCtx.lineTo(sx - 48, 296);
    pCtx.lineTo(sx - 80, 296);
    pCtx.closePath();
    pCtx.fill();
  }
  pCtx.restore();
  pCtx.fillStyle = '#242016';
  pCtx.fillRect(0, 213, 512, 4);
  pCtx.fillRect(0, 295, 512, 4);

  const pillarMap = new THREE.CanvasTexture(pillarCanvas);
  pillarMap.colorSpace = THREE.SRGBColorSpace;
  pillarMap.wrapS = THREE.RepeatWrapping;
  pillarMap.wrapT = THREE.ClampToEdgeWrapping;
  pillarMap.anisotropy = aniso;

  // 5) Soft Radial Contact Shadow Disc
  const [shadowCanvas, sCtx] = makeCanvas(128, 128);
  const sGrad = sCtx.createRadialGradient(64, 64, 6, 64, 64, 60);
  sGrad.addColorStop(0, 'rgba(0, 0, 0, 0.62)');
  sGrad.addColorStop(0.55, 'rgba(0, 0, 0, 0.28)');
  sGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  sCtx.fillStyle = sGrad;
  sCtx.fillRect(0, 0, 128, 128);
  const contactShadowMap = new THREE.CanvasTexture(shadowCanvas);

  return {
    wallMap,
    wallBump,
    carpetMap,
    carpetBump,
    ceilingMap,
    pillarMap,
    contactShadowMap,
    dispose: () => {
      wallMap.dispose();
      wallBump.dispose();
      carpetMap.dispose();
      carpetBump.dispose();
      ceilingMap.dispose();
      pillarMap.dispose();
      contactShadowMap.dispose();
    },
  };
}
