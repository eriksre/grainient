// Tasteful palette generation + image palette extraction.
// Dark schemes: vivid hues anchored by a tinted near-black, often lifted by cream.
// Light schemes: cream/pastel fields with one saturated accent.

import { hexToRgb, hslHex, rgbToHex } from "./engine";
import type { Mode } from "./engine";

type Rand = () => number;

const pick = <T>(rand: Rand, arr: T[]): T =>
  arr[Math.floor(rand() * arr.length)];
const range = (rand: Rand, min: number, max: number) =>
  min + rand() * (max - min);

function nearBlack(rand: Rand, hue: number): string {
  return hslHex(
    hue + range(rand, -20, 20),
    range(rand, 20, 45),
    range(rand, 4, 9)
  );
}

function cream(rand: Rand): string {
  return hslHex(range(rand, 38, 55), range(rand, 45, 75), range(rand, 84, 92));
}

const DARK_SCHEMES = [
  "analogous",
  "complement",
  "ember",
  "noir",
  "triad",
  "jewel",
  "neon",
  "earth",
  "midnight",
  "duotone",
  "wild",
] as const;
const LIGHT_SCHEMES = [
  "dawn",
  "paper",
  "sorbet",
  "mist",
  "porcelain",
  "meadow",
  "candy",
  "wild",
] as const;

function hexToHsl(hex: string): [number, number, number] {
  const [r8, g8, b8] = hexToRgb(hex);
  const r = r8 / 255;
  const g = g8 / 255;
  const b = b8 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) {
    return [0, 0, l * 100];
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) {
    h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  } else if (max === g) {
    h = ((b - r) / d + 2) / 6;
  } else {
    h = ((r - g) / d + 4) / 6;
  }
  return [h * 360, s * 100, l * 100];
}

// hue offsets from the dominant color that read as intentional rather than muddy:
// same family, analogous, split-complement, complement — never the 90–140° clash zone
const HARMONIC_ANCHORS = [0, 28, -28, 55, -55, 150, -150, 180];

/**
 * Gently pull each vivid color's hue toward the nearest harmonic anchor relative
 * to the palette's dominant hue. Neutrals, near-blacks, and creams pass through.
 * Only applied to palettes WE generate — user-picked colors are never touched.
 */
function harmonize(colors: string[]): string[] {
  const hsl = colors.map(hexToHsl);
  let domIdx = 0;
  let best = -1;
  for (const [i, [, s, l]] of hsl.entries()) {
    const score = s * (1 - Math.abs(l - 50) / 50);
    if (score > best) {
      best = score;
      domIdx = i;
    }
  }
  const dominant = hsl[domIdx];
  const [dom] = dominant;
  return colors.map((c, i) => {
    const [h, s, l] = hsl[i];
    if (i === domIdx || s < 25 || l < 12 || l > 92) {
      return c;
    }
    const rel = ((h - dom + 540) % 360) - 180;
    const [initialAnchor] = HARMONIC_ANCHORS;
    let anchor = initialAnchor;
    let min = Infinity;
    for (const a of HARMONIC_ANCHORS) {
      const d = Math.abs(rel - a);
      if (d < min) {
        min = d;
        anchor = a;
      }
    }
    if (min < 10) {
      return c;
    }
    const target = dom + anchor;
    const nh = h + (((target - h + 540) % 360) - 180) * 0.75;
    return hslHex(nh, s, l);
  });
}

export function randomPalette(rand: Rand, mode: Mode = "dark"): string[] {
  const h = rand() * 360;
  let scheme: (typeof DARK_SCHEMES)[number] | (typeof LIGHT_SCHEMES)[number];
  if (mode === "dark") {
    scheme = pick(rand, [...DARK_SCHEMES]);
  } else if (mode === "light") {
    scheme = pick(rand, [...LIGHT_SCHEMES]);
  } else {
    scheme = pick(rand, [...DARK_SCHEMES, ...LIGHT_SCHEMES]);
  }
  let colors: string[] = [];

  switch (scheme) {
    case "analogous": {
      colors = [
        hslHex(h, range(rand, 75, 95), range(rand, 52, 64)),
        hslHex(h + 28, range(rand, 80, 95), range(rand, 58, 70)),
        hslHex(h + 58, range(rand, 70, 90), range(rand, 62, 74)),
        nearBlack(rand, h),
      ];
      if (rand() < 0.5) {
        colors.push(cream(rand));
      }
      break;
    }
    case "complement": {
      colors = [
        hslHex(h, range(rand, 80, 95), range(rand, 52, 62)),
        hslHex(h + 180, range(rand, 75, 90), range(rand, 58, 68)),
        hslHex(h + 18, range(rand, 85, 95), range(rand, 68, 78)),
        nearBlack(rand, h + 180),
      ];
      break;
    }
    case "ember": {
      const hh = range(rand, -8, 40);
      colors = [
        hslHex(hh, range(rand, 88, 100), range(rand, 48, 58)),
        hslHex(hh + 22, range(rand, 90, 100), range(rand, 55, 62)),
        hslHex(hh + 48, range(rand, 92, 100), range(rand, 60, 68)),
        nearBlack(rand, hh + 10),
      ];
      break;
    }
    case "noir": {
      colors = [
        hslHex(h, range(rand, 75, 92), range(rand, 50, 60)),
        hslHex(
          h + range(rand, -12, 12),
          range(rand, 60, 80),
          range(rand, 26, 36)
        ),
        nearBlack(rand, h),
      ];
      if (rand() < 0.5) {
        colors.push(
          hslHex(
            h + range(rand, 30, 60),
            range(rand, 75, 90),
            range(rand, 60, 72)
          )
        );
      }
      break;
    }
    case "triad": {
      colors = [
        hslHex(h, range(rand, 80, 95), range(rand, 52, 63)),
        hslHex(
          h + range(rand, 125, 155),
          range(rand, 75, 90),
          range(rand, 55, 68)
        ),
        hslHex(
          h + range(rand, 215, 250),
          range(rand, 75, 90),
          range(rand, 58, 70)
        ),
        nearBlack(rand, h),
      ];
      break;
    }
    case "dawn": {
      colors = [
        hslHex(h, range(rand, 60, 80), range(rand, 76, 84)),
        hslHex(h + 42, range(rand, 55, 75), range(rand, 70, 80)),
        hslHex(h + 85, range(rand, 50, 70), range(rand, 66, 76)),
        hslHex(
          h + range(rand, 10, 40),
          range(rand, 75, 90),
          range(rand, 55, 63)
        ),
        cream(rand),
      ];
      break;
    }
    case "paper": {
      colors = [
        cream(rand),
        hslHex(h, range(rand, 55, 80), range(rand, 76, 86)),
        hslHex(
          h + range(rand, 25, 50),
          range(rand, 50, 75),
          range(rand, 70, 82)
        ),
        hslHex(
          h + range(rand, -15, 15),
          range(rand, 78, 95),
          range(rand, 56, 66)
        ),
      ];
      break;
    }
    case "sorbet": {
      const hh = rand() < 0.5 ? range(rand, -30, 60) : range(rand, 290, 360);
      colors = [
        hslHex(hh, range(rand, 65, 85), range(rand, 78, 88)),
        hslHex(
          hh + range(rand, 20, 45),
          range(rand, 70, 90),
          range(rand, 74, 84)
        ),
        hslHex(
          hh + range(rand, 50, 90),
          range(rand, 60, 80),
          range(rand, 76, 86)
        ),
        hslHex(
          hh + range(rand, 0, 30),
          range(rand, 80, 95),
          range(rand, 62, 70)
        ),
      ];
      break;
    }
    case "mist": {
      const hh = range(rand, 170, 280);
      colors = [
        hslHex(hh, range(rand, 25, 45), range(rand, 76, 88)),
        hslHex(
          hh + range(rand, 15, 40),
          range(rand, 20, 40),
          range(rand, 70, 82)
        ),
        hslHex(
          hh - range(rand, 10, 30),
          range(rand, 30, 50),
          range(rand, 80, 90)
        ),
        hslHex(
          hh + range(rand, -20, 20),
          range(rand, 55, 75),
          range(rand, 58, 68)
        ),
      ];
      break;
    }
    case "jewel": {
      // deep gem tones with a gold lift
      colors = [
        hslHex(h, range(rand, 65, 90), range(rand, 34, 46)),
        hslHex(
          h + range(rand, 25, 45),
          range(rand, 60, 85),
          range(rand, 42, 54)
        ),
        hslHex(
          h + range(rand, 160, 200),
          range(rand, 55, 80),
          range(rand, 48, 58)
        ),
        nearBlack(rand, h),
      ];
      if (rand() < 0.45) {
        colors.push(
          hslHex(range(rand, 40, 50), range(rand, 70, 90), range(rand, 60, 70))
        );
      }
      break;
    }
    case "neon": {
      // electric strokes on a heavy dark field
      colors = [
        hslHex(h, range(rand, 92, 100), range(rand, 55, 66)),
        hslHex(
          h + range(rand, 25, 60),
          range(rand, 90, 100),
          range(rand, 58, 70)
        ),
        nearBlack(rand, h),
        nearBlack(rand, h + 120),
      ];
      if (rand() < 0.4) {
        colors.push(
          hslHex(
            h + range(rand, 150, 210),
            range(rand, 90, 100),
            range(rand, 60, 70)
          )
        );
      }
      break;
    }
    case "earth": {
      // muted clay, ochre, moss
      const hh = range(rand, 18, 55);
      colors = [
        hslHex(hh, range(rand, 35, 55), range(rand, 30, 42)),
        hslHex(
          hh + range(rand, 10, 30),
          range(rand, 40, 60),
          range(rand, 48, 60)
        ),
        hslHex(
          hh + range(rand, 40, 80),
          range(rand, 25, 45),
          range(rand, 38, 52)
        ),
        cream(rand),
        nearBlack(rand, hh),
      ];
      break;
    }
    case "midnight": {
      // blue/violet depths with one bright signal
      const hh = range(rand, 205, 280);
      colors = [
        hslHex(hh, range(rand, 55, 85), range(rand, 20, 32)),
        hslHex(
          hh + range(rand, -25, 25),
          range(rand, 60, 90),
          range(rand, 38, 50)
        ),
        hslHex(
          hh + range(rand, -15, 15),
          range(rand, 75, 95),
          range(rand, 60, 70)
        ),
        nearBlack(rand, hh),
      ];
      break;
    }
    case "duotone": {
      // one hue, four depths
      const s2 = range(rand, 55, 90);
      colors = [
        hslHex(h, s2, range(rand, 12, 20)),
        hslHex(h + range(rand, -8, 8), s2 * 0.9, range(rand, 34, 44)),
        hslHex(h + range(rand, -8, 8), s2, range(rand, 55, 65)),
        hslHex(h + range(rand, -8, 8), s2 * 0.8, range(rand, 76, 86)),
      ];
      break;
    }
    case "porcelain": {
      // near-white field, one soft wash, one saturated accent
      colors = [
        hslHex(h, range(rand, 15, 30), range(rand, 90, 95)),
        cream(rand),
        hslHex(
          h + range(rand, -20, 20),
          range(rand, 35, 60),
          range(rand, 74, 84)
        ),
        hslHex(
          h + range(rand, -10, 30),
          range(rand, 70, 92),
          range(rand, 55, 65)
        ),
      ];
      break;
    }
    case "meadow": {
      // light greens into warm yellows
      const hh = range(rand, 70, 150);
      colors = [
        hslHex(hh, range(rand, 45, 70), range(rand, 72, 84)),
        hslHex(
          hh - range(rand, 25, 50),
          range(rand, 55, 80),
          range(rand, 70, 82)
        ),
        hslHex(
          hh + range(rand, 15, 40),
          range(rand, 35, 55),
          range(rand, 64, 76)
        ),
        cream(rand),
      ];
      break;
    }
    case "candy": {
      // bright saturated pastels
      colors = [
        hslHex(h, range(rand, 70, 90), range(rand, 72, 82)),
        hslHex(
          h + range(rand, 30, 60),
          range(rand, 70, 90),
          range(rand, 70, 80)
        ),
        hslHex(
          h + range(rand, -60, -30),
          range(rand, 65, 85),
          range(rand, 74, 84)
        ),
        hslHex(
          h + range(rand, 0, 25),
          range(rand, 85, 98),
          range(rand, 60, 68)
        ),
      ];
      break;
    }
    case "wild": {
      // fully procedural: random harmony structure + mode-aware tone bands
      const structure = pick(rand, [
        [0, 25, 50],
        [0, 180, 22],
        [0, 150, -150],
        [0, 32, -32],
        [0, 55, 180],
        // Mono.
        [0, 0, 0],
      ]);
      const k = 3 + Math.floor(rand() * 3);
      const isLight = mode === "light" || (mode === "mix" && rand() < 0.5);
      colors = [];
      for (let i = 0; i < k; i += 1) {
        const hue = h + structure[i % structure.length] + range(rand, -10, 10);
        if (isLight) {
          colors.push(hslHex(hue, range(rand, 35, 90), range(rand, 62, 88)));
        } else {
          colors.push(hslHex(hue, range(rand, 55, 98), range(rand, 28, 68)));
        }
      }
      if (!isLight && rand() < 0.75) {
        colors.push(nearBlack(rand, h));
      }
      if (isLight ? rand() < 0.6 : rand() < 0.3) {
        colors.push(cream(rand));
      }
      colors = colors.slice(0, 6);
      break;
    }
    default: {
      const exhaustiveScheme: never = scheme;
      throw new Error(`Unsupported palette scheme: ${exhaustiveScheme}`);
    }
  }

  colors = harmonize(colors);

  // shuffle so the anchor lands in different spots for linear/waves styles
  for (let i = colors.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [colors[i], colors[j]] = [colors[j], colors[i]];
  }
  return colors;
}

function dist(a: [number, number, number], b: [number, number, number]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** dominant vibrant colors from an already-drawn sample canvas */
export function paletteFromCanvas(c: HTMLCanvasElement): string[] {
  const x = c.getContext("2d");
  if (!x) {
    throw new Error("2D canvas context is unavailable");
  }
  const d = x.getImageData(0, 0, c.width, c.height).data;

  // bucket into a coarse rgb cube, scoring vibrant mid-tones higher
  const buckets = new Map<
    number,
    { r: number; g: number; b: number; n: number; score: number }
  >();
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const lum = (max + min) / 510;
    const vib = sat * 1.5 + (1 - Math.abs(lum - 0.5));
    let e = buckets.get(key);
    if (!e) {
      e = { b: 0, g: 0, n: 0, r: 0, score: 0 };
      buckets.set(key, e);
    }
    e.r += r;
    e.g += g;
    e.b += b;
    e.n += 1;
    e.score += vib;
  }

  const sorted = [...buckets.values()].toSorted((a, b) => b.score - a.score);
  const out: string[] = [];
  for (const e of sorted) {
    const rgb: [number, number, number] = [e.r / e.n, e.g / e.n, e.b / e.n];
    if (out.some((hex) => dist(hexToRgb(hex), rgb) < 80)) {
      continue;
    }
    out.push(rgbToHex(rgb[0], rgb[1], rgb[2]));
    if (out.length === 5) {
      break;
    }
  }
  return out;
}

export interface ImageImport {
  colors: string[];
  /** small cover-crop canvas used as the 'image' style's color field */
  field: HTMLCanvasElement;
}

function importBitmap(bmp: ImageBitmap): ImageImport {
  const long = 256;
  const k = long / Math.max(bmp.width, bmp.height);
  const field = document.createElement("canvas");
  field.width = Math.max(8, Math.round(bmp.width * k));
  field.height = Math.max(8, Math.round(bmp.height * k));
  const fieldContext = field.getContext("2d");
  if (!fieldContext) {
    throw new Error("2D canvas context is unavailable");
  }
  fieldContext.drawImage(bmp, 0, 0, field.width, field.height);
  bmp.close();

  const sample = document.createElement("canvas");
  sample.width = 64;
  sample.height = 64;
  const sampleContext = sample.getContext("2d");
  if (!sampleContext) {
    throw new Error("2D canvas context is unavailable");
  }
  sampleContext.drawImage(field, 0, 0, 64, 64);
  return { colors: paletteFromCanvas(sample), field };
}

export async function importImage(file: File): Promise<ImageImport> {
  return importBitmap(await createImageBitmap(file));
}

export async function importImageUrl(url: string): Promise<ImageImport> {
  const res = await fetch(url);
  return importBitmap(await createImageBitmap(await res.blob()));
}
