// Stitched pages: several gradients rendered into one tall canvas, with
// feathered cross-fades at the seams so adjacent sections melt into each
// other instead of meeting at a hard edge.

import { DEFAULT_BLEND } from "./code";
import { renderGradient } from "./engine";
import type { Settings } from "./engine";

export interface PageSectionSpec {
  settings: Settings;
  ratio: number;
}

/** total page height in units of page width (sum of 1/ratio) */
export function pageHeightUnits(sections: PageSectionSpec[]): number {
  return sections.reduce((t, s) => t + 1 / s.ratio, 0);
}

/**
 * Render a stitched page into `canvas` at width `w`.
 *
 * Each section after the first is rendered with extra height at its top and
 * faded in from transparent over that zone, so the seam is a gradual
 * cross-fade into the section above. `blend` 0..1 scales the feather from a
 * hard edge up to half the shorter neighbor's height.
 *
 * `heights` (optional) pins each section's pixel height — used by embeds
 * where the container, not the ratios, dictates total size.
 */
export function renderPage(
  canvas: HTMLCanvasElement,
  sections: PageSectionSpec[],
  w: number,
  blend: number = DEFAULT_BLEND,
  heights?: number[]
) {
  const hs =
    heights ?? sections.map((s) => Math.max(2, Math.round(w / s.ratio)));
  const total = hs.reduce((a, b) => a + b, 0);
  canvas.width = w;
  canvas.height = total;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas context is unavailable");
  }
  let y = 0;
  for (let i = 0; i < sections.length; i += 1) {
    const h = hs[i];
    const feather =
      i === 0
        ? 0
        : Math.round(
            Math.min(h, hs[i - 1]) * 0.5 * Math.min(1, Math.max(0, blend))
          );
    const off = document.createElement("canvas");
    renderGradient(off, sections[i].settings, w, h + feather);
    if (feather > 0) {
      // alpha ramp over the top feather zone; fully opaque below it
      const octx = off.getContext("2d");
      if (!octx) {
        throw new Error("2D canvas context is unavailable");
      }
      octx.globalCompositeOperation = "destination-in";
      const g = octx.createLinearGradient(0, 0, 0, h + feather);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(feather / (h + feather), "rgba(0,0,0,1)");
      g.addColorStop(1, "rgba(0,0,0,1)");
      octx.fillStyle = g;
      octx.fillRect(0, 0, w, h + feather);
      octx.globalCompositeOperation = "source-over";
    }
    ctx.drawImage(off, 0, y - feather);
    y += h;
  }
}
