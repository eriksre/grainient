// HTML/CSS export: a self-contained document with the embed runtime inlined
// at the bottom. A single gradient exports as one <section data-grainient>;
// a stitched page exports as one <section data-grainient-page> whose seams
// cross-fade. Either way the canvas re-renders to fit its container, so
// resizing a section (aspect-ratio, min-height, anything) "just works".

import embedRuntime from "virtual:grainient-embed";

import { DEFAULT_BLEND, encodeCode, encodePageCode, ratioParam } from "./code";
import { pageHeightUnits } from "./stitch";
import type { PageSectionSpec } from "./stitch";

export type SectionSpec = PageSectionSpec;

const escapeAttr = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

/** CSS aspect-ratio value: "16 / 9" for presets, a plain number otherwise */
function aspectValue(ratio: number): string {
  const name = ratioParam(ratio);
  return name.includes(":") ? name.replace(":", " / ") : name;
}

export interface EmbedHTMLOptions {
  title?: string;
  /** seam cross-fade for multi-section pages, 0..1 */
  blend?: number;
}

export function buildEmbedHTML(
  sections: SectionSpec[],
  opts: EmbedHTMLOptions = {}
): string {
  if (sections.length === 0) {
    throw new Error("At least one section is required");
  }

  const [firstSection] = sections;
  const title = opts.title ?? "grainient";
  const blend = opts.blend ?? DEFAULT_BLEND;
  let block: string;
  if (sections.length === 1) {
    const sec = firstSection;
    const code = encodeCode(sec.settings, sec.ratio);
    block = `  <!-- edit this gradient by pasting its seed back into grainient: ${code} -->
  <section
    class="grainient"
    style="aspect-ratio: ${aspectValue(sec.ratio)}; background: ${sec.settings.colors[0] ?? "#111"};"
    data-grainient="${escapeAttr(code)}"
  >
    <!-- your content goes here — it renders on top of the gradient -->
  </section>`;
  } else {
    const pageCode = encodePageCode(sections, blend);
    const combined = 1 / pageHeightUnits(sections);
    block = `  <!-- ${sections.length} stitched sections with blended seams — paste this page seed back into grainient to edit:
${pageCode
  .split("\n")
  .map((l) => `       ${l}`)
  .join("\n")}
  -->
  <section
    class="grainient"
    style="aspect-ratio: ${Math.round(combined * 10_000) / 10_000}; background: ${firstSection.settings.colors[0] ?? "#111"};"
    data-grainient-page="${escapeAttr(pageCode.replaceAll("\n", " "))}"
  >
    <!-- your content goes here — it renders on top of the stitched page -->
  </section>`;
  }

  return `<!doctype html>
<!--
  grainient html export

  HOW TO USE IN YOUR OWN SITE
  1. Copy the .grainient CSS rules, the <section> block, and the <script>
     at the bottom into your page (or just keep this file and add content).
  2. Size the section however you like: change its aspect-ratio, or drop the
     aspect-ratio and give it any width/height (e.g. min-height: 100vh).
     The gradient re-renders itself to fit whenever the section resizes.
  3. Put your content inside the section — it sits on top of the gradient.
  4. To tweak, paste the data-grainient / data-grainient-page seed into the
     grainient app (share seed box in the sidebar), edit, copy the new seed back.
  5. Add more gradients anywhere: any element with data-grainient="<seed>" or
     data-grainient-page="<page seed>" is picked up automatically on load.
     For elements added later, call GrainientEmbed.mountAll().
-->
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeAttr(title)}</title>
  <style>
    html, body { margin: 0; }
    .grainient { position: relative; isolation: isolate; overflow: hidden; }
    .grainient > canvas { position: absolute; inset: 0; z-index: -1; width: 100%; height: 100%; display: block; }
  </style>
</head>
<body>

${block}

  <script>${embedRuntime}</script>
</body>
</html>
`;
}

function triggerDownload(html: string, filename: string) {
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadEmbedHTML(
  sections: SectionSpec[],
  filename: string,
  opts?: EmbedHTMLOptions
) {
  triggerDownload(buildEmbedHTML(sections, opts), filename);
}

/** open the exported page in a new tab (live resizable preview) */
export function previewEmbedHTML(
  sections: SectionSpec[],
  opts?: EmbedHTMLOptions
) {
  const blob = new Blob([buildEmbedHTML(sections, opts)], {
    type: "text/html",
  });
  window.open(URL.createObjectURL(blob), "_blank");
}
