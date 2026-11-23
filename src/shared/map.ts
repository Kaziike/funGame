import type { Vec2 } from './types';

export const CELL_SIZE = 4.0;
export const WALL_HEIGHT = 3.6;
export const PLAYER_RADIUS = 0.42;
export const PILLAR_RADIUS = 0.85;
export const PILLAR_INTERACT_RADIUS = 3.4;

export const GRID_ROWS = 19;
export const GRID_COLS = 19;

/**
 * 19x19 Backrooms Level 0 Grid (76m x 76m)
 * '#' = solid yellow wallpaper partition wall
 * '.' = walkable damp carpet floor
 * 'P' = central Check-in Pillar cell at exact (9, 9) inside a wide open 5x5 atrium
 * 'I' = item spawn alcove
 * 'H' = prime hiding nook
 */
export const BACKROOMS_GRID: readonly string[] = [
  '###################',
  '#H..#...I...#....H#',
  '#.#.#.#####.#.###.#',
  '#...#.......#...I.#',
  '###.###.#.###.##.##',
  '#I......#.........#',
  '#.###.......###.#.#',
  '#...#.......#...#.#',
  '#.#...........#.#.#',
  '#I.......P.......I#',
  '#.#...........#.#.#',
  '#...#.......#...#.#',
  '#.###.......###.#.#',
  '#.........#......I#',
  '###.##.###.#.###.##',
  '#.I...#.......#...#',
  '#.###.#.#####.#.#.#',
  '#H....#...I...#..H#',
  '###################',
];

export const PILLAR_GRID_ROW = 9;
export const PILLAR_GRID_COL = 9;

export function gridToWorld(row: number, col: number): Vec2 {
  const halfCols = (GRID_COLS - 1) / 2;
  const halfRows = (GRID_ROWS - 1) / 2;
  return {
    x: (col - halfCols) * CELL_SIZE,
    z: (row - halfRows) * CELL_SIZE,
  };
}

export function worldToGrid(x: number, z: number): { row: number; col: number } {
  const halfCols = (GRID_COLS - 1) / 2;
  const halfRows = (GRID_ROWS - 1) / 2;
  return {
    col: Math.round(x / CELL_SIZE + halfCols),
    row: Math.round(z / CELL_SIZE + halfRows),
  };
}

export const PILLAR_POS: Vec2 = gridToWorld(PILLAR_GRID_ROW, PILLAR_GRID_COL);

export function isWallCell(row: number, col: number): boolean {
  if (row < 0 || row >= GRID_ROWS || col < 0 || col >= GRID_COLS) return true;
  return BACKROOMS_GRID[row][col] === '#';
}

export function isWalkableWorld(x: number, z: number): boolean {
  const { row, col } = worldToGrid(x, z);
  return !isWallCell(row, col);
}

/**
 * Resolve circle collision against grid walls AND the central Check-in Pillar column.
 */
export function resolveCircleWallCollision(
  x: number,
  z: number,
  radius: number = PLAYER_RADIUS,
): Vec2 {
  let rx = x;
  let rz = z;

  const { row, col } = worldToGrid(rx, rz);
  const halfCell = CELL_SIZE * 0.5;

  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const nr = row + dr;
      const nc = col + dc;
      if (!isWallCell(nr, nc)) continue;

      const cellCenter = gridToWorld(nr, nc);
      const minX = cellCenter.x - halfCell;
      const maxX = cellCenter.x + halfCell;
      const minZ = cellCenter.z - halfCell;
      const maxZ = cellCenter.z + halfCell;

      const closestX = Math.max(minX, Math.min(rx, maxX));
      const closestZ = Math.max(minZ, Math.min(rz, maxZ));

      const dx = rx - closestX;
      const dz = rz - closestZ;
      const distSq = dx * dx + dz * dz;

      if (distSq < radius * radius) {
        const dist = Math.sqrt(distSq);
        if (dist > 0.0001) {
          const overlap = radius - dist;
          rx += (dx / dist) * overlap;
          rz += (dz / dist) * overlap;
        } else {
          // Fallback push out from cell center
          const pushX = rx - cellCenter.x;
          const pushZ = rz - cellCenter.z;
          if (Math.abs(pushX) > Math.abs(pushZ)) {
            rx = cellCenter.x + Math.sign(pushX || 1) * (halfCell + radius);
          } else {
            rz = cellCenter.z + Math.sign(pushZ || 1) * (halfCell + radius);
          }
        }
      }
    }
  }

  // Also resolve against solid central Check-in Pillar cylinder at (0, 0)
  const pdx = rx - PILLAR_POS.x;
  const pdz = rz - PILLAR_POS.z;
  const pDistSq = pdx * pdx + pdz * pdz;
  const minPillarDist = PILLAR_RADIUS + radius;
  if (pDistSq < minPillarDist * minPillarDist) {
    const pDist = Math.sqrt(pDistSq);
    if (pDist > 0.0001) {
      rx = PILLAR_POS.x + (pdx / pDist) * minPillarDist;
      rz = PILLAR_POS.z + (pdz / pDist) * minPillarDist;
    } else {
      rx = PILLAR_POS.x + minPillarDist;
    }
  }

  return { x: rx, z: rz };
}

/**
 * Raymarch line-of-sight between two world points.
 * Returns true if unobstructed by walls (and optionally smoke clouds).
 */
export function hasLineOfSight(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  smokes: Array<{ x: number; z: number; radius: number }> = [],
): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.05) return true;

  const stepSize = 0.35;
  const steps = Math.ceil(dist / stepSize);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const px = ax + dx * t;
    const pz = az + dz * t;
    const { row, col } = worldToGrid(px, pz);
    if (isWallCell(row, col)) return false;

    for (const s of smokes) {
      const sdx = px - s.x;
      const sdz = pz - s.z;
      if (sdx * sdx + sdz * sdz < s.radius * s.radius) {
        return false;
      }
    }
  }
  return true;
}

export function distance2D(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(bx - ax, bz - az);
}

/**
 * Lobby & match spawn positions arranged in a safe open ring around the central Check-in Pillar,
 * facing the pillar / open corridors (never facing into a wall).
 */
export const LOBBY_SPAWNS: Array<{ x: number; z: number; yaw: number }> = [
  { x: -3.2, z: 4.8, yaw: -0.45 },
  { x: 3.0, z: 2.2, yaw: 0.9 },
  { x: -2.8, z: -2.4, yaw: -2.3 },
  { x: 3.4, z: -2.8, yaw: 2.3 },
  { x: 0.2, z: -5.0, yaw: Math.PI },
  { x: -5.2, z: 0.4, yaw: -Math.PI / 2 },
  { x: 5.2, z: 0.4, yaw: Math.PI / 2 },
  { x: 2.8, z: 5.0, yaw: 0.45 },
];

export function getItemSpawnPoints(): Vec2[] {
  const pts: Vec2[] = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      if (BACKROOMS_GRID[r][c] === 'I') {
        pts.push(gridToWorld(r, c));
      }
    }
  }
  return pts;
}

export function getHidingSpots(): Vec2[] {
  const pts: Vec2[] = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      const ch = BACKROOMS_GRID[r][c];
      if (ch === 'H' || ch === 'I') {
        pts.push(gridToWorld(r, c));
      }
    }
  }
  return pts;
}

export function getAllWalkableCells(): Array<{ row: number; col: number; x: number; z: number }> {
  const cells: Array<{ row: number; col: number; x: number; z: number }> = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      if (!isWallCell(r, c)) {
        const w = gridToWorld(r, c);
        cells.push({ row: r, col: c, x: w.x, z: w.z });
      }
    }
  }
  return cells;
}

/**
 * Simple BFS next-step grid pathfinder for server-side Bots so they navigate corridors
 * smartly without getting stuck on walls.
 */
export function findNextPathPoint(fromX: number, fromZ: number, toX: number, toZ: number): Vec2 {
  const start = worldToGrid(fromX, fromZ);
  const goal = worldToGrid(toX, toZ);
  if (start.row === goal.row && start.col === goal.col) {
    return { x: toX, z: toZ };
  }

  const key = (r: number, c: number) => `${r},${c}`;
  const queue: Array<{ row: number; col: number }> = [start];
  const visited = new Set<string>([key(start.row, start.col)]);
  const parent = new Map<string, { row: number; col: number }>();

  const dirs = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];

  let found = false;
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.row === goal.row && cur.col === goal.col) {
      found = true;
      break;
    }
    for (const [dr, dc] of dirs) {
      const nr = cur.row + dr;
      const nc = cur.col + dc;
      const k = key(nr, nc);
      if (!visited.has(k) && !isWallCell(nr, nc)) {
        visited.add(k);
        parent.set(k, cur);
        queue.push({ row: nr, col: nc });
      }
    }
  }

  if (!found) return { x: toX, z: toZ };

  let step = goal;
  while (true) {
    const p = parent.get(key(step.row, step.col));
    if (!p) break;
    if (p.row === start.row && p.col === start.col) break;
    step = p;
  }

  const wp = gridToWorld(step.row, step.col);
  // Avoid exact (0,0) center of pillar
  if (step.row === PILLAR_GRID_ROW && step.col === PILLAR_GRID_COL) {
    return { x: wp.x + 1.6, z: wp.z + 1.6 };
  }
  return wp;
}
