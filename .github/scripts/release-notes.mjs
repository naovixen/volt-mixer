// Writes a release's notes from its Conventional Commits since the previous v* tag:
// node .github/scripts/release-notes.mjs <tag>. Only what people using the app or site notice is
// listed (feat, fix, perf, and anything marked breaking); tools, tests, docs and builds are left out.
// The notes start the draft release, which is still read and edited by hand before publishing.
import { execFileSync } from "child_process";

const sections = [
    ["breaking", "Breaking changes"],
    ["feat", "Features"],
    ["fix", "Fixes"],
    ["perf", "Performance"],
];
const scopeNames = { desktop: "App", tray: "Tray mixer", guide: "Guide" };
const hiddenScopes = new Set(["tools", "ci", "deps"]);

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

const previousTag = (tag) => {
    try {
        return git("describe", "--tags", "--abbrev=0", "--match", "v*", `${tag}^`);
    } catch {
        return null; // the first release
    }
};

const commitsSince = (from, to) =>
    git("log", "--no-merges", "--format=%s%x1f%b%x1e", from ? `${from}..${to}` : to)
        .split("\x1e")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => entry.split("\x1f"));

const capitalise = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** A commit as a line under its section, or null when it isn't one people notice. */
const toNote = ([subject, body = ""]) => {
    const match = subject.match(/^(\w+)(?:\(([\w-]+)\))?(!?): (.+)$/);
    if (!match) return null;
    const [, type, scope, bang, description] = match;
    if (hiddenScopes.has(scope)) return null;
    const isBreaking = bang === "!" || /^BREAKING[ -]CHANGE:/m.test(body);
    const section = isBreaking ? "breaking" : type;
    if (!sections.some(([key]) => key === section)) return null;
    const label = scope ? `${scopeNames[scope] ?? capitalise(scope)}: ` : "";
    return { section, line: `- ${label}${capitalise(description)}` };
};

const render = (notes) =>
    sections
        .map(([key, title]) => [title, notes.filter((note) => note.section === key)])
        .filter(([, lines]) => lines.length > 0)
        .map(([title, lines]) => [`### ${title}`, "", ...lines.map((note) => note.line)].join("\n"))
        .join("\n\n");

const tag = process.argv[2];
if (!tag) {
    console.error("Usage: node release-notes.mjs <tag>");
    process.exit(1);
}
// Oldest first, as the work happened.
const notes = commitsSince(previousTag(tag), tag).reverse().map(toNote).filter(Boolean);
console.log(render(notes) || "No changes people would notice.");
