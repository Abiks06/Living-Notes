// The Windows app: the same built site as the web version, served from inside the app.
// There's no Node in the page, so it's as sandboxed as a website. The preload adds one thing:
// what's playing on this PC, and a few controls for it.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  Menu,
  net,
  powerSaveBlocker,
  protocol,
  screen,
  session,
  shell,
} from 'electron';
import { nowPlayingHelper } from './nowPlaying.js';

const SCHEME = 'resonance';
const ORIGIN = `${SCHEME}://app`;
const ROOT = app.getAppPath();
const SITE = app.isPackaged ? join(ROOT, 'site') : resolve(ROOT, '../dist');
const WINDOW_STATE = join(app.getPath('userData'), 'window.json');
const HELPER = app.isPackaged
  ? join(process.resourcesPath, 'NowPlaying.exe')
  : join(ROOT, 'now-playing', 'NowPlaying.exe');

const UPDATE_DELAY_MS = 10_000;
/** Crashing again this soon means reloading isn't helping, so it stops rather than looping. */
const CRASH_LOOP_MS = 30_000;

/** Only what the app uses, so nothing else can be switched on from the page. */
const PERMISSIONS = new Set([
  'media',
  'display-capture',
  'fullscreen',
  'fileSystem',
  'clipboard-sanitized-write',
]);

/** The web version's security headers, from the one place they're written down. */
const vercel = JSON.parse(
  readFileSync(
    app.isPackaged ? join(ROOT, 'vercel.json') : resolve(ROOT, '../vercel.json'),
    'utf8',
  ),
);
const SECURITY_HEADERS = vercel.headers
  .find((rule) => rule.source === '/(.*)')
  .headers.map(({ key, value }) => [key, value]);

// Must run before the app is ready. A standard, secure scheme gets the same treatment as
// https, and codeCache keeps compiled JavaScript between launches, which speeds up startup.
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
  },
]);

// Groups the window with its shortcut on the taskbar, and names it in Windows' media controls.
// A Store install already has its own identity, and a different one would split the two.
if (!process.windowsStore) app.setAppUserModelId('app.livingnotes.resonance');

// Older drivers on Chromium's blocklist would otherwise lose WebGL2 and fall back to the CPU.
app.commandLine.appendSwitch('ignore-gpu-blocklist');
// On laptops with two GPUs, render on the fast one.
app.commandLine.appendSwitch('force_high_performance_gpu');

async function serve(request) {
  const { pathname } = new URL(request.url);
  const file = join(SITE, pathname === '/' ? 'index.html' : decodeURIComponent(pathname));
  const found = file.startsWith(SITE + sep)
    ? await net.fetch(pathToFileURL(file).href).catch(() => null)
    : null;
  // A real 404, as on the web: the demo track check depends on it.
  const response = found?.ok ? found : new Response('Not found', { status: 404 });
  const headers = new Headers(response.headers);
  for (const [key, value] of SECURITY_HEADERS) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}

const fromApp = (url) => url === ORIGIN || url.startsWith(`${ORIGIN}/`);

function lockDown(target) {
  target.setPermissionRequestHandler((contents, permission, decide) => {
    decide(fromApp(contents.getURL()) && PERMISSIONS.has(permission));
  });
  target.setPermissionCheckHandler((_contents, permission, origin) => {
    return fromApp(origin) && PERMISSIONS.has(permission);
  });
  // What only the app can do: hear everything Windows plays, with no share dialog.
  target.setDisplayMediaRequestHandler((_request, answer) => {
    desktopCapturer
      .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      .then(([source]) => answer({ video: source, audio: 'loopback' }))
      .catch(() => answer({}));
  });
}

function savedBounds() {
  try {
    const saved = JSON.parse(readFileSync(WINDOW_STATE, 'utf8'));
    const area = screen.getDisplayMatching(saved).workArea;
    const onScreen =
      saved.x < area.x + area.width &&
      saved.y < area.y + area.height &&
      saved.x + saved.width > area.x &&
      saved.y + saved.height > area.y;
    return onScreen ? saved : null;
  } catch {
    return null;
  }
}

function openWindow() {
  const saved = savedBounds();
  const window = new BrowserWindow({
    width: saved?.width ?? 1280,
    height: saved?.height ?? 800,
    ...(saved ? { x: saved.x, y: saved.y } : {}),
    minWidth: 360,
    minHeight: 520,
    title: 'Resonance',
    // Matches the page, so nothing flashes white before the first frame.
    backgroundColor: '#05050a',
    show: false,
    webPreferences: {
      preload: join(ROOT, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      v8CacheOptions: 'bypassHeatCheck',
    },
  });
  if (saved?.maximized) window.maximize();
  window.once('ready-to-show', () => window.show());
  window.on('close', () => {
    try {
      writeFileSync(
        WINDOW_STATE,
        JSON.stringify({ ...window.getNormalBounds(), maximized: window.isMaximized() }),
      );
    } catch {
      // The next launch just opens at the default size.
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // A graphics driver can take the page down with it. Coming back beats a blank window.
  let lastCrash = -Infinity;
  window.webContents.on('render-process-gone', (_event, { reason }) => {
    if (reason === 'clean-exit' || Date.now() - lastCrash < CRASH_LOOP_MS) return;
    lastCrash = Date.now();
    window.webContents.reload();
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) event.preventDefault();
  });
  void window.loadURL(`${ORIGIN}/`);
  return window;
}

/** Stops the screen and the PC going to sleep, without touching the user's power settings. */
function awakeKeeper() {
  let blocker = null;
  return (on) => {
    if (on === true && blocker === null) blocker = powerSaveBlocker.start('prevent-display-sleep');
    if (on === false && blocker !== null) {
      powerSaveBlocker.stop(blocker);
      blocker = null;
    }
  };
}

/**
 * Asks GitHub for a newer version and downloads it quietly. It installs when the app next
 * closes, so nothing interrupts a song. It runs here rather than in the page, and it sends
 * nothing about the music.
 */
async function checkForUpdates() {
  // The Store keeps its own installs up to date.
  if (!app.isPackaged || process.windowsStore) return;
  try {
    // Loaded late, so it costs the launch nothing.
    const { default: updater } = await import('electron-updater');
    updater.autoUpdater.on('error', () => undefined);
    await updater.autoUpdater.checkForUpdates();
  } catch {
    // Offline, or GitHub is down: the next launch tries again.
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let main = null;
  // No menu bar: it's never shown, and leaving it out skips building the default one.
  Menu.setApplicationMenu(null);
  app.on('second-instance', () => {
    if (main?.isMinimized()) main.restore();
    main?.focus();
  });
  app.on('window-all-closed', () => app.quit());
  void app.whenReady().then(() => {
    session.defaultSession.protocol.handle(SCHEME, serve);
    lockDown(session.defaultSession);
    main = openWindow();
    const helper = nowPlayingHelper(HELPER, (message) =>
      main?.webContents.send('now-playing', message),
    );
    const onlyTheApp =
      (handler) =>
      (event, ...args) => {
        if (fromApp(event.senderFrame?.url ?? '')) handler(...args);
      };
    ipcMain.on('now-playing:start', onlyTheApp(helper.start));
    ipcMain.on('now-playing:stop', onlyTheApp(helper.stop));
    ipcMain.on('now-playing:command', onlyTheApp(helper.command));
    ipcMain.on('keep-awake', onlyTheApp(awakeKeeper()));
    app.on('before-quit', helper.stop);
    setTimeout(checkForUpdates, UPDATE_DELAY_MS);
  });
}
