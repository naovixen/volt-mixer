# Performance

How Volt Mixer's CPU and memory are measured, and what the numbers were before and after the
engine rework (`docs/decisions.md`, "The engine runs beside the views").

## Measuring

`tools/perf-bench.mjs` measures against a fake Volt (`tools/perf/fake-volt.js`), never the real one.
The browser or app starts with WebHID switched off (`--disable-blink-features=WebHID`). The bench
checks that the page really has none before it installs the fake, and stops if it does. The fake:

- answers identify and the state request with bytes built from `src/data` (`tools/perf/volt-config.mjs`);
- sends meter reports 50 times a second, with levels that move like a voice and music;
- counts every report the page sends.

Each run uses a throwaway profile with a saved mix seeded, so the page owns the mix and a drag
sends crosspoints.

```sh
pnpm build && (cd desktop && pnpm build)
cd tools && node perf-bench.mjs <label> [web] [desktop] [installed]
```

It runs these scenarios:

- **web:** headless Edge (InPrivate, no extensions) on `astro preview`, idle for 15 s with the
  meters moving. Then a 6 s fader drag, with pointer moves every 4 ms like a 240 Hz mouse. Then the
  window minimised, then shown again.
- **desktop:** the app from source with a temporary `--user-data-dir`. It runs with the window open
  (idle, then the drag), and started in the tray (`--hidden`). Since phase 3 the pretend Volt is in
  the app's main process (`desktop/src/hid-backend-fake.ts`, only when `VOLT_FAKE_VOLT=bench` and
  run from source), and the bench stops the app unless main says it's using it.
- **installed:** the installed app as it's running now, sampled for 30 s. It is only read.

The bench records these columns:

- **CPU:** the CPU time of the whole process tree, as a share of the machine (as Task Manager shows
  it) and of one core.
- **Memory:** private working set, which is what Task Manager shows as memory, and private bytes.
- **Page work:** the page's own work per second, from DevTools' Performance metrics: task and
  script time, layouts, and style recalculations.
- **HID writes:** the reports sent to the Volt per second.

Results are kept in `tools/perf/results/<label>.json`, with the writes broken down by command.

This machine has 8 logical cores and a 240 Hz display (headless frames follow it), so a drag here
draws 240 frames a second.

## Baseline (before the rework, 2026-10-26)

| scenario                  | processes | private set MB | private bytes MB | CPU % machine | CPU % one core | page task ms/s | layouts/s | style recalcs/s | HID writes/s |
| ------------------------- | --------- | -------------- | ---------------- | ------------- | -------------- | -------------- | --------- | --------------- | ------------ |
| web, idle                 | 10        | 217            | 328              | 1.92          | 15.4           | 51.0           | 0         | 52.5            | 0.7          |
| web, drag                 | 8         | 241            | 351              | 9.90          | 79.2           | 300.3          | 137.2     | 166.4           | 275.5        |
| web, hidden               | 7         | 172            | 273              | 0.23          | 1.9            | 5.4            | 0         | 0               | 0.7          |
| web, shown again (3 s)    | 7         | 179            | 289              | 2.82          | 22.6           | 49.6           | 0         | 50.2            | 1.3          |
| app, window open, idle    | 5         | 157            | 274              | 2.07          | 16.6           | 57.0           | 0         | 55.6            | 0.7          |
| app, window open, drag    | 5         | 195            | 327              | 11.04         | 88.3           | 283.8          | 126.9     | 158.2           | 254.2        |
| app, in the tray          | 5         | 117            | 245              | 0.12          | 1.0            | 3.6            | 0         | 0               | 0.7          |
| installed app, as running | 5         | 81             | 281              | 0.10          | 0.8            |                |           |                 |              |

What these show:

- **A drag:** about 255–275 reports a second go to the Volt (one fader, Input 1). There are 130
  layouts a second, and close to a whole core is busy. Writes follow the screen's frame rate, every
  frame re-renders every view, and the slider moves by layout.
- **Idle with the window open:** about 50 ms of page work a second. The meters draw a frame for
  every meter report, with a style recalculation each time.
- **In the tray:** the app keeps five processes and about 245 MB of private bytes, two of them
  renderers for windows no one can see.

## After each phase

The same scenarios. CPU in headless runs moves by about a percent of the machine from run to
run, so the page's own work and the writes are the steadier columns.

| phase                               | web idle: page ms/s, recalcs/s | web drag: page ms/s, layouts/s, HID writes/s | app idle: page ms/s | app drag: CPU % one core, HID writes/s | app in tray: processes, private set MB, private bytes MB |
| ----------------------------------- | ------------------------------ | -------------------------------------------- | ------------------- | -------------------------------------- | -------------------------------------------------------- |
| baseline                            | 51.0, 52.5                     | 300.3, 137.2, 275.5                          | 57.0                | 88.3, 254.2                            | 5, 117, 245                                              |
| 1: engine, send pump, meter frames  | 43.9, 39.3                     | 253.4, 130.2, 70.1                           | 32.3                | 49.1, 70.2                             | 5, 115, 236                                              |
| 2: views draw only what changed     | 26.5, 33.0                     | 226.3, 118.5, 70.2                           | 30.7                | 50.4, 70.6                             | 5, 112, 234                                              |
| 3: engine in the app's main process | 26.8, 33.6                     | 240.0, 125.5, 70.6                           | 18.0                | 58.3, 48.0                             | 4, 62, 130                                               |

What's left in a drag is the browser drawing a frame for every screen refresh while the handle
moves, which it should. A trace of a 3 s drag at 240 Hz shows only three style changes a frame
(the slider's position, its readout's text and the meter covers), and a layout only for the
readout's new text. The layout count stays high because text has to be laid out, but each pass is
small (9 ms a second in all). The meter covers keep `will-change: transform`: without it, painting
doubled (12 to 22 ms a second) and layerising didn't get cheaper.
