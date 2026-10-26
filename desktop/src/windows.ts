import {
    app,
    BaseWindow,
    BrowserWindow,
    nativeTheme,
    screen,
    shell,
    type IpcMainEvent,
    type IpcMainInvokeEvent,
    type Rectangle,
} from "electron";
import path from "path";
import { websiteUrl } from "./app-info.ts";
import { appOrigin, isFromWindow } from "./protocol.ts";
import { loadSettings } from "./settings.ts";

/*
 * The app's windows only show what the engine in main holds (engine-host.ts), so none has to stay
 * open for the Volt's sake. The main window is made when it's opened and closed for real when it
 * goes to the tray; the tray window is made when it's first shown and closed after a while hidden.
 * In the tray, then, no page is running at all.
 */

const isLinux = process.platform === "linux";
/* The tray's width; its height follows its rows (fitTrayWindow). */
const trayWindowSize = { width: 340, height: 300 };
/** A tray window hidden this long is closed; the next click makes a new one (a moment slower). */
const trayKeepMs = 2 * 60_000;
/** A new tray window waits this long at most for its page to say how tall it is. */
const trayReadyMs = 1500;

let mainWindow: BrowserWindow | null = null;
let trayWindow: BrowserWindow | null = null;
let isQuitting = false;
let trayHiddenAt = 0;
let trayIcon: Rectangle | undefined;
let trayCloseTimer: NodeJS.Timeout | undefined;
/** Run when a page in the main window has loaded (it knows nothing yet), and when the tray window is shown. */
const onMainLoaded = new Set<(window: BrowserWindow) => void>();
let onTrayShown = (): void => {};

/** Lets close and quit through: set when the user chose Quit, or the system is shutting down. */
export const markQuitting = (): void => {
    isQuitting = true;
};

export const whenMainLoaded = (listen: (window: BrowserWindow) => void): void => void onMainLoaded.add(listen);
export const whenTrayShown = (listen: () => void): void => {
    onTrayShown = listen;
};

/** Each window gets only its own preload's API. */
const webPreferences = (preload: string) => ({
    preload: path.join(import.meta.dirname, preload),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    // On Linux, a spellchecker would fetch its dictionaries from Google; nothing here needs one.
    spellcheck: false,
});

export const isFromMainWindow = (event: IpcMainEvent | IpcMainInvokeEvent): boolean => isFromWindow(event, mainWindow);
export const isFromTrayWindow = (event: IpcMainEvent | IpcMainInvokeEvent): boolean => isFromWindow(event, trayWindow);

/** Links to the web (GitHub, releases) open in the browser; nothing navigates away from the app. */
const lockNavigation = (window: BrowserWindow): void => {
    window.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith("https://")) void shell.openExternal(url);
        return { action: "deny" };
    });
    // The windows stay on their page. A link to the web opens in the browser, and so does any
    // other page of the site (the guide, Privacy), from the website itself.
    window.webContents.on("will-navigate", (event, url) => {
        event.preventDefault();
        if (url.startsWith("https://")) return void shell.openExternal(url);
        if (url.startsWith(`${appOrigin}/`))
            void shell.openExternal(new URL(url.slice(appOrigin.length + 1), websiteUrl).href);
    });
};

const background = (): string => (nativeTheme.shouldUseDarkColors ? "#171615" : "#f5f3ef");

/** A page that crashes is loaded again, unless it crashes again straight away. */
const reloadAfterCrash = (window: BrowserWindow): void => {
    let crashedAt = 0;
    window.webContents.on("render-process-gone", (_event, { reason }) => {
        const isLooping = Date.now() - crashedAt < 10_000;
        crashedAt = Date.now();
        if (reason !== "clean-exit" && !isLooping && !isQuitting && !window.isDestroyed()) window.webContents.reload();
    });
};

/**
 * Close and minimise put the window in the tray (if chosen): it closes, and the app stays. Closed
 * any other way, the app quits.
 */
const keepInTray = (window: BrowserWindow): void => {
    let isToTray = false;
    window.once("show", () => handOverWindows.delete(window));
    window.on("close", () => {
        isToTray = !isQuitting && (isToTray || loadSettings().closeToTray);
    });
    window.on("closed", () => {
        if (mainWindow === window) mainWindow = null;
        // One opened only for the hand-over closes without a word; the app goes on in the tray.
        if (!isToTray && !handOverWindows.has(window)) app.quit();
    });
    // Minimise can't be cancelled, so the window minimises and then closes.
    window.on("minimize", () => {
        if (!loadSettings().minimiseToTray) return;
        isToTray = true;
        window.close();
    });
};

/** Main windows opened hidden, only for the page's old storage, until shown. */
const handOverWindows = new WeakSet<BrowserWindow>();

export const createMainWindow = (isShown: boolean): BrowserWindow => {
    const window = new BrowserWindow({
        width: 1200,
        height: 820,
        minWidth: 360,
        minHeight: 400,
        show: false,
        autoHideMenuBar: true,
        backgroundColor: background(),
        webPreferences: webPreferences("preload.cjs"),
    });
    mainWindow = window;
    if (!isShown) handOverWindows.add(window);
    lockNavigation(window);
    reloadAfterCrash(window);
    window.once("ready-to-show", () => isShown && window.show());
    keepInTray(window);
    window.webContents.on("did-finish-load", () => onMainLoaded.forEach((listen) => listen(window)));
    void window.loadURL(`${appOrigin}/`);
    return window;
};

/** The main window, if it's open. */
export const getMainWindow = (): BrowserWindow | null => mainWindow;

/** The tray window, if it's open (shown or not). */
export const getTrayWindow = (): BrowserWindow | null => (trayWindow && !trayWindow.isDestroyed() ? trayWindow : null);

export const showMainWindow = (): void => {
    mainWindow ??= createMainWindow(true);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    trayWindow?.hide();
};

/** Closes a main window opened only to hand over the page's old storage (store-file.ts), once it has. */
export const closeHiddenMainWindow = (): void => {
    if (mainWindow && handOverWindows.has(mainWindow)) mainWindow.destroy();
};

/** Like the Windows volume flyout: clicking anywhere else puts it away. */
const hideOnBlur = (window: BrowserWindow): void =>
    void window.on("blur", () => {
        // Windows also sends blur to the window after it's hidden (when the taskbar is clicked);
        // counting that one would swallow the next click on the tray icon.
        if (isLinux || !window.isVisible()) return;
        trayHiddenAt = Date.now();
        window.hide();
    });

/** Alt+F4, Cmd+W or a Linux title bar's close hides it, like its own Close button; quitting closes it. */
const hideOnClose = (window: BrowserWindow): void => {
    window.on("close", (event) => {
        if (isQuitting) return;
        event.preventDefault();
        window.hide();
    });
    window.on("closed", () => {
        if (trayWindow === window) trayWindow = null;
    });
};

/** Hidden a while, the tray window closes; shown again, it stays. */
const closeWhenIdle = (window: BrowserWindow): void => {
    window.on("hide", () => {
        clearTimeout(trayCloseTimer);
        trayCloseTimer = setTimeout(() => !window.isDestroyed() && !window.isVisible() && window.destroy(), trayKeepMs);
    });
    window.on("show", () => {
        clearTimeout(trayCloseTimer);
        onTrayShown();
    });
};

const createTrayWindow = (): BrowserWindow => {
    const window = new BrowserWindow({
        ...trayWindowSize,
        show: false,
        frame: isLinux,
        resizable: isLinux,
        skipTaskbar: !isLinux,
        alwaysOnTop: !isLinux,
        fullscreenable: false,
        title: "Volt Mixer",
        backgroundColor: background(),
        ...(process.platform === "darwin" ? { type: "panel" } : {}),
        webPreferences: webPreferences("tray-preload.cjs"),
    });
    lockNavigation(window);
    reloadAfterCrash(window);
    if (process.platform === "darwin") window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    hideOnBlur(window);
    hideOnClose(window);
    closeWhenIdle(window);
    void window.loadURL(`${appOrigin}/tray/`);
    return window;
};

/** Above (or below) the tray icon, kept inside the screen's work area. */
const placeNear = (window: BrowserWindow, icon: Rectangle): void => {
    const { workArea } = screen.getDisplayNearestPoint({ x: icon.x, y: icon.y });
    const [width, height] = window.getSize() as [number, number];
    const x = Math.round(
        Math.min(Math.max(icon.x + icon.width / 2 - width / 2, workArea.x), workArea.x + workArea.width - width),
    );
    const isBarAtTop = icon.y < workArea.y + workArea.height / 2;
    const y = isBarAtTop ? workArea.y + 8 : workArea.y + workArea.height - height - 8;
    window.setPosition(x, Math.round(y));
};

let trayReady: (() => void) | null = null;

/** Sizes the tray window to its content (in CSS px, from the page), within the screen. */
export const fitTrayWindow = (height: number): void => {
    if (!trayWindow || !Number.isFinite(height)) return;
    const { workArea } = screen.getDisplayMatching(trayWindow.getBounds());
    const fitted = Math.round(Math.min(Math.max(height, 120), workArea.height - 16));
    const [width, current] = trayWindow.getContentSize() as [number, number];
    if (fitted !== current) trayWindow.setContentSize(width, fitted);
    if (trayIcon) placeNear(trayWindow, trayIcon);
    trayReady?.();
};

/** The tray window's own Close button. */
export const hideTrayWindow = (): void => trayWindow?.hide();

/** A new tray window: shown once its page has sized it, so it doesn't open at the wrong height. */
const whenSized = (): Promise<void> =>
    new Promise((resolve) => {
        const done = (): void => {
            clearTimeout(timer);
            trayReady = null;
            resolve();
        };
        const timer = setTimeout(done, trayReadyMs);
        trayReady = done;
    });

/** Opens or closes the tray window. `icon` is where the tray icon is (none on Linux). */
export const toggleTrayWindow = async (icon?: Rectangle): Promise<void> => {
    const isNew = !trayWindow;
    trayWindow ??= createTrayWindow();
    // The click that blurred it shouldn't reopen it straight away.
    if (trayWindow.isVisible() || Date.now() - trayHiddenAt < 250) return trayWindow.hide();
    if (icon && icon.width > 0) trayIcon = icon;
    if (isNew) await whenSized();
    if (!trayWindow || trayWindow.isDestroyed()) return;
    if (trayIcon) placeNear(trayWindow, trayIcon);
    trayWindow.show();
    trayWindow.focus();
};

/**
 * Windows tells only windows that it's shutting down, so a window that's never shown, with no
 * page in it, hears it for the app (lifecycle.ts) while every other one is closed.
 */
export const createSessionWindow = (): BaseWindow =>
    new BaseWindow({ show: false, skipTaskbar: true, width: 1, height: 1 });
