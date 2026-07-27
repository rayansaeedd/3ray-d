type ProfilePoint = { t: number; r: number };

const VASE_PROFILE: ProfilePoint[] = [
  { t: 0, r: 0.6 },
  { t: 0.08, r: 0.88 },
  { t: 0.22, r: 1 },
  { t: 0.55, r: 0.8 },
  { t: 0.8, r: 0.66 },
  { t: 1, r: 0.44 },
];

function radiusAt(t: number): number {
  for (let i = 0; i < VASE_PROFILE.length - 1; i++) {
    const a = VASE_PROFILE[i];
    const b = VASE_PROFILE[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t;
      const local = span === 0 ? 0 : (t - a.t) / span;
      const eased = 0.5 - 0.5 * Math.cos(Math.PI * local);
      return a.r + (b.r - a.r) * eased;
    }
  }
  return VASE_PROFILE[VASE_PROFILE.length - 1].r;
}

/**
 * Traces a single continuous helical line top-to-bottom, mimicking a
 * vase-mode (spiralize) 3D print: the actual toolpath a printer draws
 * for these planters, one wall, no seams.
 */
export function generateVasePath(opts: {
  width: number;
  height: number;
  turns: number;
  pointsPerTurn: number;
  squash?: number;
}): string {
  const { width, height, turns, pointsPerTurn, squash = 0.34 } = opts;
  const totalPoints = Math.round(turns * pointsPerTurn);
  const cx = width / 2;
  const topY = height * 0.08;
  const usableHeight = height * 0.84;
  const maxRadius = width * 0.4;

  const commands: string[] = [];
  for (let i = 0; i <= totalPoints; i++) {
    const t = i / totalPoints;
    const angle = t * turns * Math.PI * 2;
    const r = radiusAt(t) * maxRadius;
    const x = cx + r * Math.cos(angle);
    const y = topY + t * usableHeight + r * Math.sin(angle) * squash;
    commands.push(`${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return commands.join(" ");
}
