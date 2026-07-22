import { access, readdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "dist");
const client = join(dist, "client");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function clean() {
  await rm(dist, { force: true, recursive: true });
}

async function verify() {
  const required = ["index.html", "embed.js", "agents.md", "llms.txt"];
  const requiredResults = await Promise.all(
    required.map(async (file) =>
      (await exists(join(client, file))) ? null : `dist/client/${file}`
    )
  );
  const missing = requiredResults.filter(Boolean);

  if (missing.length > 0) {
    throw new Error(
      `Cloudflare Pages output is incomplete: ${missing.join(", ")}`
    );
  }

  const forbidden = [
    ["functions", "Pages Functions source directory"],
    ["wrangler.json", "Workers configuration"],
    ["wrangler.jsonc", "Workers configuration"],
    ["wrangler.toml", "Workers configuration"],
    ["dist/server", "Workers server bundle"],
    ["dist/client/_worker.js", "Pages advanced-mode Worker"],
  ];

  const forbiddenResults = await Promise.all(
    forbidden.map(async ([path, description]) => ({
      description,
      path,
      present: await exists(join(root, path)),
    }))
  );
  const invalid = forbiddenResults.find(({ present }) => present);
  if (invalid) {
    throw new Error(
      `${invalid.description} found at ${invalid.path}; grainient must remain a static Pages deployment`
    );
  }

  const packageJson = JSON.parse(
    await readFile(join(root, "package.json"), "utf-8")
  );
  const packages = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  if (packages["@cloudflare/vite-plugin"]) {
    throw new Error(
      "@cloudflare/vite-plugin targets Workers builds and must not be used for this Pages deployment"
    );
  }

  const outputEntries = await readdir(dist);
  const unexpected = outputEntries.filter(
    (entry) => entry !== "client" && entry !== ".openai"
  );
  if (unexpected.length > 0) {
    throw new Error(
      `Unexpected deployment output outside dist/client: ${unexpected.join(", ")}`
    );
  }

  console.log(
    "Cloudflare Pages build verified: static assets are ready in dist/client"
  );
}

const command = process.argv.at(2);

if (command === "clean") {
  await clean();
} else if (command === "verify") {
  await verify();
} else {
  throw new Error('Expected "clean" or "verify"');
}
