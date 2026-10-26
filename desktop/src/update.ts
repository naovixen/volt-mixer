import { app, net } from "electron";
import { repositoryName, repositoryUrl } from "./app-info.ts";
import { isNewer } from "./versions.ts";

/*
 * Checks GitHub Releases for a newer version. Builds are unsigned, so there's no automatic
 * install: the page shows a notice with a link to the release.
 */

interface IUpdate {
    isNewer: boolean;
    version: string;
    url: string;
}

/** The latest release, or null when GitHub can't be reached. */
export const checkForUpdate = async (): Promise<IUpdate | null> => {
    try {
        const latestRelease = `https://api.github.com/repos/${repositoryName}/releases/latest`;
        const response = await net.fetch(latestRelease, { headers: { Accept: "application/vnd.github+json" } });
        if (!response.ok) return null;
        const release = (await response.json()) as { tag_name?: unknown; html_url?: unknown };
        const version = typeof release.tag_name === "string" ? release.tag_name.replace(/^v/, "") : "";
        const url =
            typeof release.html_url === "string" && release.html_url.startsWith(`${repositoryUrl}/releases/`)
                ? release.html_url
                : "";
        return version && url ? { isNewer: isNewer(version, app.getVersion()), version, url } : null;
    } catch {
        return null;
    }
};
