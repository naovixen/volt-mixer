// Builds the Astro site at the repository root into desktop/site, as the app's own copy:
// VOLT_TARGET=desktop serves it from the root of the app://volt scheme and leaves out the pages the
// app opens on the website instead (astro.config.ts).
import { execFileSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const desktop = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.join(desktop, "..");
const site = path.join(desktop, "site");

// Astro's own CLI through Node, so no shell is involved on any system.
execFileSync(
    process.execPath,
    [path.join(root, "node_modules", "astro", "bin", "astro.mjs"), "build", "--outDir", site],
    {
        cwd: root,
        stdio: "inherit",
        env: { ...process.env, VOLT_TARGET: "desktop" },
    },
);
