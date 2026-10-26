// Memory and CPU time of a process tree (a browser or Electron and everything it started), or of
// every process with a name (the installed app), from Windows' own counters: what Task Manager shows.
import { spawnSync } from "child_process";
import os from "os";

const script = `
$p = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,UserModeTime,KernelModeTime,PrivatePageCount,@{n='Created';e={$_.CreationDate.ToFileTimeUtc()}}
$w = Get-CimInstance Win32_PerfRawData_PerfProc_Process | Select-Object IDProcess,WorkingSetPrivate
@{ p = @($p); w = @($w) } | ConvertTo-Json -Depth 3 -Compress`;

const snapshot = () => {
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status !== 0) throw new Error(`Reading processes failed: ${result.stderr}`);
    const { p, w } = JSON.parse(result.stdout);
    const privateSet = new Map(w.map((row) => [row.IDProcess, Number(row.WorkingSetPrivate)]));
    return p.map((row) => ({
        pid: row.ProcessId,
        parent: row.ParentProcessId,
        name: row.Name,
        created: Number(row.Created),
        cpu100ns: Number(row.UserModeTime) + Number(row.KernelModeTime),
        privateBytes: Number(row.PrivatePageCount),
        privateSet: privateSet.get(row.ProcessId) ?? 0,
    }));
};

/* A child starts after its parent: a process left over from one that had the same ID earlier doesn't count. */
const treeOf = (rows, root) => {
    const pids = new Set([root]);
    const createdAt = new Map(rows.map((row) => [row.pid, row.created]));
    for (let grew = true; grew;) {
        grew = false;
        for (const row of rows) {
            if (!pids.has(row.parent) || pids.has(row.pid) || row.created < (createdAt.get(row.parent) ?? 0)) continue;
            pids.add(row.pid);
            grew = true;
        }
    }
    return rows.filter((row) => pids.has(row.pid));
};

/** Which processes count: a tree under `root`, or every process called `name`. */
export const sampleProcesses = ({ root, name }) => {
    const rows = snapshot();
    const chosen = root ? treeOf(rows, root) : rows.filter((row) => row.name === name);
    return { at: performance.now(), rows: chosen };
};

const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);
const megabytes = (bytes) => Math.round(bytes / 1024 / 1024);

/**
 * Between two samples: CPU as a share of the whole machine (as Task Manager shows it) and of one
 * core, and memory at the end, summed over the processes. Processes that ended in between count
 * only up to the first sample.
 */
export const compareSamples = (before, after) => {
    const cpuBefore = new Map(before.rows.map((row) => [row.pid, row.cpu100ns]));
    const cpu100ns = after.rows.reduce((total, row) => total + row.cpu100ns - (cpuBefore.get(row.pid) ?? 0), 0);
    const seconds = (after.at - before.at) / 1000;
    const oneCore = (cpu100ns / 1e7 / seconds) * 100;
    return {
        processes: after.rows.length,
        cpuPercentMachine: +(oneCore / os.availableParallelism()).toFixed(2),
        cpuPercentOneCore: +oneCore.toFixed(1),
        privateSetMB: megabytes(sum(after.rows, "privateSet")),
        privateBytesMB: megabytes(sum(after.rows, "privateBytes")),
    };
};
