// Original, generic era-styled figures (plan 10). Pencil-ink look, one neutral tone for skin on every figure,
// no logos, lettering, numbers or pinstripes. Only uniform cut and an era accent color change.

export type Era = '1901-1919' | '1920-1945' | '1946-1969' | '1970-1989' | '1990-2025';
export type Pose = 'bat' | 'pit';

interface EraStyle {
  accent: string;      // cap, sleeves, stockings
  capCrown: number;    // crown height
  brim: number;        // brim length
  pantsTo: number;     // y where pants end (higher = longer pants)
  pantsWidth: number;  // extra bagginess
  sleeveTo: number;    // y where sleeves end on the arm
  collar: 'band' | 'open' | 'button' | 'vneck';
  stirrup: boolean;    // stirrup cut-outs shown on the stockings
  helmet: boolean;     // batting helmet with ear flap
}

const STYLES: Record<Era, EraStyle> = {
  '1901-1919': { accent: '#2b3a67', capCrown: 7, brim: 5, pantsTo: 116, pantsWidth: 7, sleeveTo: 78, collar: 'band', stirrup: false, helmet: false },
  '1920-1945': { accent: '#7a2e2e', capCrown: 6, brim: 6, pantsTo: 118, pantsWidth: 6, sleeveTo: 76, collar: 'open', stirrup: true, helmet: false },
  '1946-1969': { accent: '#2e5a3a', capCrown: 8, brim: 7, pantsTo: 120, pantsWidth: 4, sleeveTo: 74, collar: 'button', stirrup: true, helmet: false },
  '1970-1989': { accent: '#b8611a', capCrown: 9, brim: 8, pantsTo: 120, pantsWidth: 1, sleeveTo: 70, collar: 'vneck', stirrup: true, helmet: true },
  '1990-2025': { accent: '#1c5cab', capCrown: 9, brim: 10, pantsTo: 140, pantsWidth: 3, sleeveTo: 72, collar: 'button', stirrup: false, helmet: true },
};

export function eraOf(year: number): Era {
  if (year < 1920) return '1901-1919';
  if (year < 1946) return '1920-1945';
  if (year < 1970) return '1946-1969';
  if (year < 1990) return '1970-1989';
  return '1990-2025';
}

const INK = '#2b2a28';
const SKIN = '#cfc9bd';    // same neutral wash for every figure
const CLOTH = '#fbf8f1';

/** SVG markup for a figure. Left-handed players are mirrored. viewBox 0 0 120 160. */
export function figure(era: Era, pose: Pose, hand: string): string {
  const s = STYLES[era] ?? STYLES['1990-2025'];
  const mirror = hand === 'L' ? ' transform="translate(120 0) scale(-1 1)"' : '';
  const stroke = `stroke="${INK}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"`;
  const pw = s.pantsWidth;

  // Head and headwear
  const head = `<circle cx="60" cy="30" r="10" fill="${SKIN}" ${stroke}/>`;
  const headwear = s.helmet && pose === 'bat'
    ? `<path d="M48 30 Q48 16 60 16 Q72 16 72 30 L72 34 L66 34 L66 28 L50 28 Z" fill="${s.accent}" ${stroke}/>` +
      `<path d="M66 28 L72 28 L72 37 Q68 38 66 35 Z" fill="${s.accent}" ${stroke}/>`
    : `<path d="M49 ${27 - s.capCrown / 3} Q50 ${20 - s.capCrown} 60 ${20 - s.capCrown} Q70 ${20 - s.capCrown} 71 ${27 - s.capCrown / 3} Z" fill="${s.accent}" ${stroke}/>` +
      `<path d="M49 27 L${49 - s.brim} 29 L49 29.5 Z" fill="${s.accent}" ${stroke}/>`;

  // Torso and collar
  const torso = `<path d="M46 44 Q60 39 74 44 L76 90 L44 90 Z" fill="${CLOTH}" ${stroke}/>`;
  const collar = {
    band: `<path d="M53 42 Q60 46 67 42" fill="none" ${stroke}/><path d="M53 42 L53 45 Q60 49 67 45 L67 42" fill="${s.accent}" ${stroke}/>`,
    open: `<path d="M54 42 L60 50 L66 42" fill="none" ${stroke}/>`,
    button: `<path d="M54 42 L60 48 L66 42" fill="none" ${stroke}/><line x1="60" y1="48" x2="60" y2="86" ${stroke}/>` +
      `<circle cx="61.5" cy="56" r="0.9" fill="${INK}"/><circle cx="61.5" cy="66" r="0.9" fill="${INK}"/><circle cx="61.5" cy="76" r="0.9" fill="${INK}"/>`,
    vneck: `<path d="M53 42 L60 52 L67 42" fill="none" stroke="${s.accent}" stroke-width="3"/>`,
  }[s.collar];

  // Legs: hips, pants, stockings (stirrup cut-out as a light notch), shoes
  const pantsEnd = Math.min(s.pantsTo, 140);
  const hips = `<path d="M${44 - pw / 2} 84 L${76 + pw / 2} 84 L${77 + pw / 2} 96 L${43 - pw / 2} 96 Z" fill="${CLOTH}" ${stroke}/>`;
  const legs = [45, 61].map((x, i) => {
    const flare = i === 0 ? -pw / 2 : pw / 2;
    const pants = `<path d="M${x - 1 + (i === 0 ? flare : 0)} 94 L${x + 15 + (i === 1 ? flare : 0)} 94 L${x + 13 + flare / 2} ${pantsEnd} L${x + 1 + flare / 2} ${pantsEnd} Z" fill="${CLOTH}" ${stroke}/>`;
    const sock = pantsEnd < 140
      ? `<rect x="${x + 2}" y="${pantsEnd}" width="10" height="${140 - pantsEnd}" fill="${s.accent}" ${stroke}/>` +
        (s.stirrup ? `<path d="M${x + 4} 140 Q${x + 7} ${pantsEnd + 7} ${x + 10} 140 Z" fill="${CLOTH}" ${stroke}/>` : '')
      : '';
    const toe = i === 0 ? -5 : 5;
    const shoe = `<path d="M${x + 1 + Math.min(0, toe)} 140 L${x + 13 + Math.max(0, toe)} 140 L${x + 13 + Math.max(0, toe)} 145 L${x + 1 + Math.min(0, toe)} 145 Z" fill="${INK}" ${stroke}/>`;
    return pants + sock + shoe;
  }).join('') + hips;

  // Arms and the pose-specific prop
  const sleeve = (x1: number, y1: number, x2: number, y2: number) => {
    const t = Math.max(0, Math.min(1, (s.sleeveTo - y1) / Math.max(1, y2 - y1)));
    const sx = x1 + (x2 - x1) * t, sy = y1 + (y2 - y1) * t;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${INK}" stroke-width="9" stroke-linecap="round"/>` +
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${SKIN}" stroke-width="6.4" stroke-linecap="round"/>` +
      `<line x1="${x1}" y1="${y1}" x2="${sx}" y2="${sy}" stroke="${s.accent}" stroke-width="6.4" stroke-linecap="round"/>`;
  };
  const arms = pose === 'bat'
    ? sleeve(48, 48, 66, 64) + sleeve(72, 48, 70, 64) +
      `<line x1="68" y1="64" x2="88" y2="10" stroke="#8a6a44" stroke-width="4" stroke-linecap="round"/>` +
      `<line x1="68" y1="64" x2="88" y2="10" stroke="${INK}" stroke-width="0.8"/>`
    : sleeve(48, 48, 54, 70) + sleeve(72, 48, 66, 70) +
      `<ellipse cx="60" cy="70" rx="9" ry="7" fill="#7a5a3a" ${stroke}/>`;

  const ground = `<ellipse cx="60" cy="148" rx="44" ry="5" fill="${INK}" opacity="0.12"/>`;
  return `<svg viewBox="0 0 120 160" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Illustrated ${pose === 'bat' ? 'batter' : 'pitcher'} in a ${era} style uniform">` +
    `<g${mirror}>${ground}${legs}${torso}${collar}${arms}${head}${headwear}</g></svg>`;
}
