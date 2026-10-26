import { app } from "electron";
import fs from "fs";
import path from "path";
import { fileWithin } from "./site-paths.ts";

/*
 * The built site, for app:// and for the phone. It's packed in app.asar with main's code
 * (electron-builder.yml), so the asar integrity check covers it; app.getAppPath() is app.asar
 * when packaged and desktop/ when run from source.
 */

const siteDir = path.resolve(app.getAppPath(), "site");

const contentTypes: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".xml": "application/xml",
};

/* Style attributes carry slider ticks and meter zones; stylesheets and scripts are files only. */
export const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
].join("; ");

/** A site file's contents and type, or null when there's no such file. */
export const readSiteFile = async (pathname: string): Promise<{ body: Buffer; type: string } | null> => {
    const file = fileWithin(siteDir, pathname);
    if (!file) return null;
    try {
        return {
            body: await fs.promises.readFile(file),
            type: contentTypes[path.extname(file)] ?? "application/octet-stream",
        };
    } catch {
        return null;
    }
};
