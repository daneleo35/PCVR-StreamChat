const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, globalShortcut, session, dialog } = require("electron");
const { spawn } = require("child_process");
const http = require("http");
const crypto = require("crypto");
const net = require("net");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const tmi = require("tmi.js");
const WebSocket = require("ws");
const { getOptionsFromLivePage, parseChatData } = require("youtube-chat/dist/parser");

const KICK_PUSHER_KEY = "32cbd69e4b950bf97679";
const MAX_MESSAGES = 120;
const YOUTUBE_RETRY_MS = 60000;
const KICK_RETRY_MS = 30000;
const OAUTH_CALLBACK_PORT = 38947;
const APP_REPOSITORY = {
  owner: "daneleo35",
  repo: "PCVR-StreamChat"
};
const GITHUB_LATEST_RELEASE_API = `https://api.github.com/repos/${APP_REPOSITORY.owner}/${APP_REPOSITORY.repo}/releases/latest`;
const GITHUB_RELEASES_PAGE = `https://github.com/${APP_REPOSITORY.owner}/${APP_REPOSITORY.repo}/releases/latest`;

const TWITCH_FALLBACK_EMOTES = new Map(Object.entries({
  Kappa: "25",
  PogChamp: "305954156",
  LUL: "425618",
  NotLikeThis: "58765",
  HeyGuys: "30259",
  BibleThump: "86",
  Kreygasm: "41",
  DansGame: "33",
  CoolCat: "58127",
  SwiftRage: "34",
  WutFace: "28087",
  VoHiYo: "81274",
  ResidentSleeper: "245",
  FailFish: "360",
  TwitchConHYPE: "171381"
}).map(([name, id]) => [name, {
  platform: "twitch",
  id,
  name,
  url: `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0`
}]));

const emoteCaches = {
  twitchGlobal: new Map(TWITCH_FALLBACK_EMOTES),
  thirdPartyGlobal: new Map(),
  loadedAt: 0
};

const EMOTE_CACHE_MS = 15 * 60 * 1000;

const USER_DEFAULT_SOURCES = {
  twitchChannels: [],
  youtubeSources: [],
  kickChannels: []
};

let mainWindow;
let youtubeLoginWindow;
let chatOverlayWindow;
let chatOverlayWindowLoaded = false;
let tray;
let configPath;
let config = getDefaultConfig();
let activeConnectors = [];
const statusCache = new Map();
let clickThrough = false;
let openVrHost;
let openVrFrameTimer;
let openVrFramePath;
let openVrFrameWriteInFlight = false;
let openVrLastFrameBytes;
let openVrTextureMode = false;
let openVrCaptureBounds;
let openVrShutdownRequested = false;
let openVrStartupRefreshPending = true;
let openVrFrameDebounceTimer;
let openVrFrameDirty = false;
let alertOverlayWindow;
let alertOverlayWindowLoaded = false;
let alertOverlayWindowUrl = "";
let alertVrHost;
let alertVrFrameTimer;
let alertVrFramePath;
let alertVrFrameWriteInFlight = false;
let alertVrLastFrameBytes;
let alertVrShutdownRequested = false;
let alertVrFrameDebounceTimer;
let alertVrFrameDirty = false;
let alertServer;
let alertWss;
let alertServerPort;
let oauthCallbackServer;
const oauthPendingStates = new Map();
const oauthWindows = new Map();
let obsSocket;
let obsRequestId = 0;
let obsIdentified = false;
const obsPendingRequests = new Map();
const moderationWindows = new Map();
const kickChannelCache = new Map();
const chatOverlayMessages = [];
let chatOverlayBootstrapHtml = null;

function getAssetPath(name) {
  const basePath = app.isPackaged
    ? path.join(process.resourcesPath, "app")
    : app.getAppPath();
  return path.join(basePath, "assets", name);
}

function getDefaultConfig() {
  return {
    twitchChannels: [...USER_DEFAULT_SOURCES.twitchChannels],
    youtubeLiveIds: [...USER_DEFAULT_SOURCES.youtubeSources],
    kickChannels: [...USER_DEFAULT_SOURCES.kickChannels],
    maxMessages: MAX_MESSAGES,
    opacity: 0.92,
    fontScale: 1,
    compactMode: false,
    clickThrough: false,
    alwaysOnTop: true,
    showBadges: true,
    showTimestamps: false,
    updates: {
      checkOnStartup: true
    },
    youtubeUseCookies: true,
    youtubeAuthMode: "oauth",
    suiteMode: "chat",
    controlProvider: "obs",
    alerts: {
      enabled: true,
      browserSourcePort: 39273,
      durationMs: 6000,
      mode: "custom",
      streamlabsAlertUrl: "",
      overlayPosition: "banner",
      overlayScale: 1
    },
    obs: {
      host: "127.0.0.1",
      port: 4455,
      password: "",
      autoConnect: false
    },
    streamDeck: {
      sceneName: "",
      microphoneInput: "",
      cameraSource: ""
    },
    moderation: {
      twitchUsername: "",
      twitchOAuthToken: "",
      timeoutSeconds: 60,
      reason: "Handled from VR"
    },
    oauth: {
      twitch: getDefaultOAuthAccount(),
      youtube: getDefaultOAuthAccount(),
      kick: getDefaultOAuthAccount()
    },
    openVrOverlay: {
      enabled: false,
      anchor: "world",
      controllerPreset: "top",
      widthMeters: 0.28,
      alpha: 0.95,
      x: 0,
      y: 1.35,
      z: -1.35,
      pitch: 0,
      yaw: 0,
      roll: 0,
      frameIntervalMs: 250,
      worldGrabMode: false,
      worldLocked: true
    }
  };
}

function normalizeConfig(value) {
  const defaults = getDefaultConfig();
  const next = { ...defaults, ...(value || {}) };
  next.twitchChannels = normalizeList(next.twitchChannels).map((item) => item.replace(/^#/, ""));
  next.youtubeLiveIds = normalizeList(next.youtubeLiveIds);
  next.kickChannels = normalizeList(next.kickChannels);
  next.maxMessages = clamp(Number(next.maxMessages) || MAX_MESSAGES, 25, 300);
  next.opacity = clamp(Number(next.opacity) || defaults.opacity, 0.2, 1);
  next.fontScale = clamp(Number(next.fontScale) || defaults.fontScale, 0.75, 1.6);
  next.compactMode = Boolean(next.compactMode);
  next.clickThrough = false;
  next.alwaysOnTop = Boolean(next.alwaysOnTop);
  next.showBadges = Boolean(next.showBadges);
  next.showTimestamps = Boolean(next.showTimestamps);
  next.updates = normalizeUpdatesConfig(next.updates);
  next.youtubeUseCookies = value?.youtubeUseCookies !== false;
  next.youtubeAuthMode = ["oauth", "browser"].includes(String(next.youtubeAuthMode)) ? String(next.youtubeAuthMode) : defaults.youtubeAuthMode;
  next.suiteMode = ["chat", "alerts", "deck"].includes(String(next.suiteMode)) ? String(next.suiteMode) : defaults.suiteMode;
  next.controlProvider = ["obs", "streamlabs-desktop"].includes(String(next.controlProvider)) ? String(next.controlProvider) : defaults.controlProvider;
  next.alerts = normalizeAlertsConfig(next.alerts);
  next.obs = normalizeObsConfig(next.obs);
  next.streamDeck = normalizeStreamDeckConfig(next.streamDeck);
  next.moderation = normalizeModerationConfig(next.moderation);
  next.oauth = normalizeOAuthConfig(next.oauth);
  next.openVrOverlay = normalizeOpenVrConfig(next.openVrOverlay);
  return next;
}

function getDefaultOAuthAccount() {
  return {
    clientId: "",
    clientSecret: "",
    accessToken: "",
    refreshToken: "",
    expiresAt: 0,
    login: "",
    displayName: "",
    email: "",
    userId: "",
    scopes: []
  };
}

function normalizeOAuthAccount(value) {
  const defaults = getDefaultOAuthAccount();
  const next = { ...defaults, ...(value || {}) };
  next.clientId = String(next.clientId || "").trim();
  next.clientSecret = String(next.clientSecret || "").trim();
  next.accessToken = String(next.accessToken || "").trim();
  next.refreshToken = String(next.refreshToken || "").trim();
  next.expiresAt = Math.max(0, Number(next.expiresAt) || 0);
  next.login = String(next.login || "").trim();
  next.displayName = String(next.displayName || "").trim();
  next.email = String(next.email || "").trim();
  next.userId = String(next.userId || "").trim();
  next.scopes = Array.isArray(next.scopes) ? next.scopes.map(String).filter(Boolean) : [];
  return next;
}

function normalizeOAuthConfig(value) {
  return {
    twitch: normalizeOAuthAccount(value?.twitch),
    youtube: normalizeOAuthAccount(value?.youtube),
    kick: normalizeOAuthAccount(value?.kick)
  };
}

function normalizeAlertsConfig(value) {
  const defaults = getDefaultConfig().alerts;
  const next = { ...defaults, ...(value || {}) };
  next.enabled = value?.enabled !== false;
  next.browserSourcePort = Math.round(clampNumber(next.browserSourcePort, defaults.browserSourcePort, 1024, 65535));
  next.durationMs = Math.round(clampNumber(next.durationMs, defaults.durationMs, 1500, 20000));
  next.mode = ["custom", "streamlabs"].includes(String(next.mode)) ? String(next.mode) : defaults.mode;
  next.streamlabsAlertUrl = String(next.streamlabsAlertUrl || "").trim();
  next.overlayPosition = ["banner", "above-chat"].includes(String(next.overlayPosition)) ? String(next.overlayPosition) : defaults.overlayPosition;
  next.overlayScale = clampNumber(next.overlayScale, defaults.overlayScale, 0.6, 1.6);
  return next;
}

function normalizeUpdatesConfig(value) {
  return {
    checkOnStartup: value?.checkOnStartup !== false
  };
}

function normalizeObsConfig(value) {
  const defaults = getDefaultConfig().obs;
  const next = { ...defaults, ...(value || {}) };
  next.host = String(next.host || defaults.host).trim() || defaults.host;
  next.port = Math.round(clampNumber(next.port, defaults.port, 1, 65535));
  next.password = String(next.password || "");
  next.autoConnect = Boolean(next.autoConnect);
  return next;
}

function normalizeStreamDeckConfig(value) {
  const defaults = getDefaultConfig().streamDeck;
  const next = { ...defaults, ...(value || {}) };
  next.sceneName = String(next.sceneName || "").trim();
  next.microphoneInput = String(next.microphoneInput || "").trim();
  next.cameraSource = String(next.cameraSource || "").trim();
  return next;
}

function normalizeModerationConfig(value) {
  const defaults = getDefaultConfig().moderation;
  const next = { ...defaults, ...(value || {}) };
  next.twitchUsername = String(next.twitchUsername || "").trim();
  next.twitchOAuthToken = String(next.twitchOAuthToken || "").trim();
  next.timeoutSeconds = Math.round(clampNumber(next.timeoutSeconds, defaults.timeoutSeconds, 1, 1209600));
  next.reason = String(next.reason || defaults.reason).slice(0, 160);
  return next;
}

function normalizeOpenVrConfig(value) {
  const defaults = getDefaultConfig().openVrOverlay;
  const next = { ...defaults, ...(value || {}) };
  next.enabled = Boolean(next.enabled);
  next.anchor = ["world", "left-controller", "right-controller"].includes(String(next.anchor)) ? String(next.anchor) : defaults.anchor;
  next.controllerPreset = ["top", "behind", "wrist-side", "custom"].includes(String(next.controllerPreset)) ? String(next.controllerPreset) : defaults.controllerPreset;
  next.widthMeters = clampNumber(next.widthMeters, defaults.widthMeters, 0.02, 2);
  next.alpha = clampNumber(next.alpha, defaults.alpha, 0.1, 1);
  next.x = clampNumber(next.x, defaults.x, -10, 10);
  next.y = clampNumber(next.y, defaults.y, -10, 10);
  next.z = clampNumber(next.z, defaults.z, -10, 10);
  next.pitch = clampNumber(next.pitch, defaults.pitch, -180, 180);
  next.yaw = clampNumber(next.yaw, defaults.yaw, -180, 180);
  next.roll = clampNumber(next.roll, defaults.roll, -180, 180);
  next.frameIntervalMs = clampNumber(next.frameIntervalMs, defaults.frameIntervalMs, 50, 2000);
  next.worldGrabMode = Boolean(next.worldGrabMode);
  next.worldLocked = value?.worldLocked !== false;
  return next;
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }

  return String(value || "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, min, max) : fallback;
}

function loadConfig() {
  configPath = path.join(app.getPath("userData"), "config.json");

  try {
    config = normalizeConfig(JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, "")));
  } catch {
    config = getDefaultConfig();
  }

  if (!config.twitchChannels.length && !config.youtubeLiveIds.length && !config.kickChannels.length) {
    config.twitchChannels = [...USER_DEFAULT_SOURCES.twitchChannels];
    config.youtubeLiveIds = [...USER_DEFAULT_SOURCES.youtubeSources];
    config.kickChannels = [...USER_DEFAULT_SOURCES.kickChannels];
    saveConfig();
  }
}

function saveConfig() {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function saveAndBroadcastConfig() {
  saveConfig();
  emit("config:updated", config);
}

function getOAuthAccount(platform) {
  return normalizeOAuthAccount(config.oauth?.[platform]);
}

function updateOAuthAccount(platform, patch) {
  config.oauth = normalizeOAuthConfig(config.oauth);
  config.oauth[platform] = normalizeOAuthAccount({ ...config.oauth[platform], ...patch });
  saveAndBroadcastConfig();
  return config.oauth[platform];
}

function clearOAuthAccount(platform) {
  const current = getOAuthAccount(platform);
  updateOAuthAccount(platform, {
    ...getDefaultOAuthAccount(),
    clientId: current.clientId,
    clientSecret: current.clientSecret
  });
}

function getOAuthRedirectUri(platform) {
  return `http://localhost:${OAUTH_CALLBACK_PORT}/callback/${platform}`;
}

function getOAuthScopes(platform) {
  if (platform === "twitch") {
    return ["chat:read", "chat:edit", "moderator:manage:banned_users", "moderator:manage:chat_messages"];
  }
  if (platform === "youtube") {
    return ["https://www.googleapis.com/auth/youtube.force-ssl", "openid", "profile", "email"];
  }
  if (platform === "kick") {
    return ["user:read", "chat:write", "moderation:ban", "moderation:chat_message:manage"];
  }
  throw new Error(`Unsupported OAuth platform: ${platform}`);
}

function getOAuthLabel(platform) {
  if (platform === "twitch") return "Twitch";
  if (platform === "youtube") return "YouTube";
  if (platform === "kick") return "Kick";
  return platform;
}

function debugLog(message) {
  try {
    const logPath = path.join(app.getPath("userData"), "debug.log");
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 460,
    height: 720,
    minWidth: 320,
    minHeight: 320,
    frame: false,
    transparent: true,
    resizable: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    title: "VR Chat Screen",
    icon: getAssetPath("icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.setAlwaysOnTop(config.alwaysOnTop, "screen-saver");
  mainWindow.setMovable(true);
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  setClickThrough(false);

  if (process.argv.includes("--dev")) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}

function openYouTubeSignInWindow() {
  if (youtubeLoginWindow && !youtubeLoginWindow.isDestroyed()) {
    youtubeLoginWindow.show();
    youtubeLoginWindow.focus();
    return;
  }

  youtubeLoginWindow = new BrowserWindow({
    width: 1120,
    height: 820,
    title: "Sign in to YouTube",
    icon: getAssetPath("icon.ico"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  youtubeLoginWindow.loadURL("https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F");
  youtubeLoginWindow.webContents.on("did-finish-load", async () => {
    const summary = await getYouTubeCookieSummary();
    status("YouTube Auth", summary.signedIn ? "connected" : "idle", summary.signedIn ? "Signed-in cookies available" : "Sign in to enable private/unlisted access");
  });
  youtubeLoginWindow.on("closed", async () => {
    youtubeLoginWindow = undefined;
    const summary = await getYouTubeCookieSummary();
    status("YouTube Auth", summary.signedIn ? "connected" : "idle", summary.signedIn ? "Signed-in cookies saved" : "No YouTube sign-in cookies found");
  });
}

function createTray() {
  const image = nativeImage.createFromPath(getAssetPath("icon.ico"));

  tray = new Tray(image);
  tray.setToolTip("VR Chat Screen");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show overlay", click: () => mainWindow?.show() },
    { label: "Unlock mouse input", click: () => setClickThrough(false) },
    { label: "Toggle click-through (Ctrl+Shift+V / Ctrl+Alt+V / F8)", click: () => toggleClickThrough() },
    { label: "Restart OpenVR overlay", click: () => restartOpenVrOverlay() },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() }
  ]));
}

function emit(channel, payload) {
  mainWindow?.webContents.send(channel, payload);
}

function status(source, state, detail) {
  const payload = { source, state, detail };
  statusCache.set(source, payload);
  emit("chat:status", payload);
}

function message(payload) {
  const entry = {
    id: `${payload.platform}:${payload.channel}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toISOString(),
    ...payload
  };
  emit("chat:message", entry);
  rememberChatOverlayMessage(entry);
}

function rememberChatOverlayMessage(entry) {
  chatOverlayMessages.push(entry);
  while (chatOverlayMessages.length > (config.maxMessages || MAX_MESSAGES)) {
    chatOverlayMessages.shift();
  }
  scheduleOpenVrFrameWrite(90);
}

function scheduleOpenVrFrameWrite(delayMs = 0) {
  openVrFrameDirty = true;

  if (!config.openVrOverlay.enabled || !openVrFramePath) {
    return;
  }

  if (openVrFrameDebounceTimer) {
    clearTimeout(openVrFrameDebounceTimer);
  }

  openVrFrameDebounceTimer = setTimeout(() => {
    openVrFrameDebounceTimer = undefined;
    writeOpenVrFrame().catch((error) => status("OpenVR", "error", cleanError(error)));
  }, Math.max(0, delayMs));
}

function moderationNotice(action, target) {
  const platform = String(target?.platform || "").trim();
  const author = String(target?.author || "").trim() || "viewer";
  const channel = String(target?.channel || "").trim() || platform;
  const timeoutSeconds = platform === "youtube"
    ? 300
    : config.moderation.timeoutSeconds;
  const verb = action === "delete"
    ? "Deleted"
    : action === "timeout"
      ? `Timed out for ${timeoutSeconds}s`
      : action === "ban"
        ? "Banned"
        : action;

  message({
    platform: "system",
    channel,
    author: "Moderation",
    text: `${verb} ${author} on ${platform || "chat"}.`,
    parts: [{ type: "text", text: `${verb} ${author} on ${platform || "chat"}.` }],
    color: "#53fc18",
    badges: ["done"]
  });
}

function moderationFailureNotice(action, target, error) {
  const platform = String(target?.platform || "").trim() || "chat";
  const author = String(target?.author || "").trim() || "viewer";
  const detail = cleanError(error) || "Unknown moderation error";
  const text = `${String(action || "Action")} failed for ${author} on ${platform}: ${detail}`;

  message({
    platform: "system",
    channel: platform,
    author: "Moderation",
    text,
    parts: [{ type: "text", text }],
    color: "#ff5c7a",
    badges: ["failed"]
  });
}

function setClickThrough(enabled) {
  clickThrough = Boolean(enabled);
  config.clickThrough = clickThrough;
  mainWindow?.setIgnoreMouseEvents(clickThrough, { forward: true });
  emit("overlay:click-through", clickThrough);
}

function toggleClickThrough() {
  setClickThrough(!clickThrough);
  if (!clickThrough) {
    mainWindow?.show();
    mainWindow?.focus();
  }
  return clickThrough;
}

async function restartConnectors() {
  for (const connector of activeConnectors) {
    try {
      await connector.stop();
    } catch (error) {
      console.warn("Failed to stop connector", error);
    }
  }

  activeConnectors = [];
  for (const source of [...statusCache.keys()]) {
    if (source.startsWith("Twitch") || source.startsWith("YouTube") || source.startsWith("Kick")) {
      statusCache.delete(source);
    }
  }
  emit("chat:reset", {});
  chatOverlayMessages.length = 0;
  scheduleOpenVrFrameWrite(0);
  emitStatusSnapshot();

  if (config.twitchChannels.length) {
    activeConnectors.push(createTwitchConnector(config.twitchChannels));
  }

  for (const source of config.youtubeLiveIds) {
    activeConnectors.push(createYouTubeConnector(source));
  }

  for (const channel of config.kickChannels) {
    activeConnectors.push(createKickConnector(channel));
  }

  for (const connector of activeConnectors) {
    connector.start().catch((error) => status(connector.label, "error", cleanError(error)));
  }
}

function emitStatusSnapshot() {
  for (const item of statusCache.values()) {
    emit("chat:status", item);
  }
}

async function restartOpenVrOverlay() {
  debugLog(`restartOpenVrOverlay enabled=${config.openVrOverlay.enabled}`);
  await stopOpenVrOverlay();
  await stopAlertVrOverlay();

  if (!config.openVrOverlay.enabled) {
    status("OpenVR", "disabled", "Native overlay is off");
    return;
  }

  const hostExe = getOpenVrHostPath();
  debugLog(`OpenVR host path=${hostExe} exists=${fs.existsSync(hostExe)}`);
  if (!fs.existsSync(hostExe)) {
    status("OpenVR", "error", "Run npm run build:openvr first");
    return;
  }

  openVrFramePath = path.join(app.getPath("userData"), "openvr-frame.png");
  try {
    mainWindow?.webContents.invalidate();
  } catch {
  }
  debugLog(`Writing OpenVR frame ${openVrFramePath}`);
  await writeOpenVrFrame().catch((error) => debugLog(`Initial OpenVR frame write failed ${cleanError(error)}`));
  debugLog("OpenVR frame write completed");

  const vr = config.openVrOverlay;
  openVrShutdownRequested = false;
  debugLog(`Spawning OpenVR host anchor=${vr.anchor} preset=${vr.controllerPreset}`);
  openVrHost = spawn(hostExe, [
    "--frame", openVrFramePath,
    "--anchor", openVrAnchorForHost(vr.anchor),
    "--preset", openVrPresetForHost(vr.controllerPreset),
    "--width", String(vr.widthMeters),
    "--alpha", String(vr.alpha),
    "--x", String(vr.x),
    "--y", String(vr.y),
    "--z", String(vr.z),
    "--pitch", String(vr.pitch || 0),
    "--yaw", String(vr.yaw || 0),
    "--roll", String(vr.roll || 0),
    "--interval", String(vr.frameIntervalMs),
    "--grab", String(vr.worldGrabMode),
    "--locked", String(vr.worldLocked),
    "--texture", String(openVrTextureMode)
  ], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"]
  });
  debugLog(`OpenVR host pid=${openVrHost.pid || "none"}`);

  openVrHost.stdout.on("data", (data) => handleOpenVrOutput(data.toString()));
  openVrHost.stderr.on("data", (data) => {
    const text = data.toString().trim();
    debugLog(`OpenVR stderr: ${text}`);
    if (/texture mode failed|SetOverlayTexture failed/i.test(text)) {
      openVrTextureMode = false;
      debugLog("OpenVR texture mode disabled; falling back to PNG file updates");
    }
    status("OpenVR", "error", text);
  });
  openVrHost.stdin.on("error", (error) => debugLog(`OpenVR stdin error: ${cleanError(error)}`));
  openVrHost.on("exit", (code) => {
    debugLog(`OpenVR host exited with ${code}`);
    status("OpenVR", code === 0 ? "stopped" : "error", `Host exited with ${code}`);
    openVrHost = undefined;
    clearInterval(openVrFrameTimer);
    openVrFrameTimer = undefined;
    if (!openVrShutdownRequested && config.openVrOverlay.enabled) {
      debugLog("OpenVR host exited unexpectedly while overlay was enabled. Scheduling restart.");
      setTimeout(() => {
        if (config.openVrOverlay.enabled && !openVrHost) {
          restartOpenVrOverlay().catch((error) => status("OpenVR", "error", cleanError(error)));
        }
      }, 500);
    }
  });

  for (const ms of [120, 320, 720]) {
    setTimeout(() => {
      openVrFrameDirty = true;
      writeOpenVrFrame().catch((error) => debugLog(`Delayed OpenVR frame write failed ${cleanError(error)}`));
    }, ms);
  }

  if (openVrStartupRefreshPending) {
    openVrStartupRefreshPending = false;
    setTimeout(() => {
      if (!config.openVrOverlay.enabled || !openVrHost) {
        return;
      }
      debugLog("Running one-time OpenVR startup refresh");
      restartOpenVrOverlay().catch((error) => debugLog(`OpenVR startup refresh failed ${cleanError(error)}`));
    }, 1500);
  }

  restartAlertVrOverlay().catch((error) => debugLog(`Alert OpenVR startup failed ${cleanError(error)}`));
}

function handleOpenVrOutput(text) {
  for (const line of text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    if (line.startsWith("CONFIG ")) {
      applyOpenVrHostConfig(line.slice(7));
      continue;
    }

    if (line.startsWith("INPUT ")) {
      handleOpenVrInput(line.slice(6));
      continue;
    }

    status("OpenVR", "connected", line);
  }
}

function getAuthPlatformConfig(platform) {
  if (platform === "youtube") {
    return {
      label: "YouTube",
      loginUrl: "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F",
      cookieUrl: "https://www.youtube.com",
      signedInCookies: ["SID", "HSID", "SSID", "APISID", "SAPISID", "LOGIN_INFO"]
    };
  }
  if (platform === "twitch") {
    return {
      label: "Twitch",
      loginUrl: "https://www.twitch.tv/login",
      cookieUrl: "https://www.twitch.tv",
      signedInCookies: ["auth-token", "persistent", "login"]
    };
  }
  if (platform === "kick") {
    return {
      label: "Kick",
      loginUrl: "https://kick.com/login",
      cookieUrl: "https://kick.com",
      signedInCookies: ["session", "XSRF-TOKEN", "remember_web"]
    };
  }
  throw new Error(`Unsupported auth platform: ${platform}`);
}

async function getBrowserAuthSummary(platform) {
  const auth = getAuthPlatformConfig(platform);
  const cookies = await session.defaultSession.cookies.get({ url: auth.cookieUrl });
  const signedIn = cookies.some((cookie) => auth.signedInCookies.includes(cookie.name)) || cookies.length >= 3;
  return {
    platform,
    label: auth.label,
    signedIn,
    count: cookies.length
  };
}

async function openBrowserSignInWindow(platform) {
  if (platform === "youtube") {
    openYouTubeSignInWindow();
    return getBrowserAuthSummary(platform);
  }

  const auth = getAuthPlatformConfig(platform);
  const signInWindow = new BrowserWindow({
    width: 1120,
    height: 820,
    title: `Sign in to ${auth.label}`,
    icon: getAssetPath("icon.ico"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  signInWindow.loadURL(auth.loginUrl);
  signInWindow.webContents.on("did-finish-load", async () => {
    const summary = await getBrowserAuthSummary(platform);
    status(`${auth.label} Auth`, summary.signedIn ? "connected" : "idle", summary.signedIn ? "Signed-in browser session available" : `Sign in to enable ${auth.label} browser session features`);
  });

  signInWindow.on("closed", async () => {
    const summary = await getBrowserAuthSummary(platform);
    status(`${auth.label} Auth`, summary.signedIn ? "connected" : "idle", summary.signedIn ? "Signed-in browser session saved" : `No ${auth.label} sign-in cookies found`);
  });

  return getBrowserAuthSummary(platform);
}

async function clearBrowserAuth(platform) {
  const auth = getAuthPlatformConfig(platform);
  const cookies = await session.defaultSession.cookies.get({ url: auth.cookieUrl });
  await Promise.allSettled(cookies.map((cookie) => {
    const protocol = cookie.secure ? "https" : "http";
    const domain = cookie.domain?.replace(/^\./, "") || new URL(auth.cookieUrl).hostname;
    const url = `${protocol}://${domain}${cookie.path || "/"}`;
    return session.defaultSession.cookies.remove(url, cookie.name);
  }));
  const summary = await getBrowserAuthSummary(platform);
  status(`${auth.label} Auth`, summary.signedIn ? "connected" : "idle", summary.signedIn ? "Signed-in browser session still present" : "Signed out");
  return summary;
}

function applyOpenVrHostConfig(json) {
  try {
    const value = JSON.parse(json);
    config.openVrOverlay = normalizeOpenVrConfig({
      ...config.openVrOverlay,
      ...value,
      enabled: config.openVrOverlay.enabled,
      anchor: config.openVrOverlay.anchor,
      controllerPreset: config.openVrOverlay.controllerPreset,
      worldGrabMode: config.openVrOverlay.worldGrabMode,
      worldLocked: config.openVrOverlay.worldLocked
    });
    saveConfig();
    emit("config:updated", config);
  } catch (error) {
    status("OpenVR", "error", cleanError(error));
  }
}

function openVrAnchorForHost(value) {
  switch (value) {
    case "left-controller":
      return "LeftController";
    case "right-controller":
      return "RightController";
    default:
      return "World";
  }
}

function openVrPresetForHost(value) {
  switch (value) {
    case "behind":
      return "Behind";
    case "custom":
      return "Custom";
    case "wrist-side":
      return "WristSide";
    default:
      return "Top";
  }
}

async function stopOpenVrOverlay() {
  openVrShutdownRequested = true;
  clearInterval(openVrFrameTimer);
  openVrFrameTimer = undefined;
  clearTimeout(openVrFrameDebounceTimer);
  openVrFrameDebounceTimer = undefined;
  openVrFrameWriteInFlight = false;
  openVrLastFrameBytes = undefined;
  openVrFrameDirty = false;

  const host = openVrHost;
  openVrHost = undefined;

  if (host?.stdin && !host.stdin.destroyed) {
    host.stdin.end();
  }

  if (host && !host.killed) {
    const exited = new Promise((resolve) => {
      const done = () => resolve(undefined);
      host.once("exit", done);
      setTimeout(done, 800);
    });
    host.kill();
    await exited;
  }

  if (chatOverlayWindow && !chatOverlayWindow.isDestroyed()) {
    chatOverlayWindow.destroy();
  }
  chatOverlayWindow = undefined;
}

function getOpenVrHostPath() {
  const basePath = app.isPackaged
    ? path.join(process.resourcesPath, "app")
    : app.getAppPath();
  return path.join(basePath, "native", "OpenVRHost", "VrChatScreen.OpenVRHost.exe");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderChatOverlayText(parts, fallbackText) {
  const safeParts = Array.isArray(parts) && parts.length ? parts : [{ type: "text", text: fallbackText || "" }];
  return safeParts.map((part) => {
    if (part?.type === "emote" && part.url) {
      return `<img class="emote" src="${escapeHtml(part.url)}" alt="${escapeHtml(part.name || "emote")}" />`;
    }
    return `<span>${escapeHtml(part?.text || "")}</span>`;
  }).join("");
}

function getChatOverlayBootstrapHtml() {
  if (chatOverlayBootstrapHtml) {
    return chatOverlayBootstrapHtml;
  }

  const candidatePaths = [
    path.join(__dirname, "renderer", "chat-overlay.html"),
    path.join(app.getAppPath(), "src", "renderer", "chat-overlay.html"),
    path.join(process.resourcesPath || "", "app", "src", "renderer", "chat-overlay.html")
  ].filter(Boolean);

  for (const candidate of candidatePaths) {
    try {
      if (fs.existsSync(candidate)) {
        chatOverlayBootstrapHtml = fs.readFileSync(candidate, "utf8");
        debugLog(`Loaded chat overlay bootstrap html from ${candidate}`);
        return chatOverlayBootstrapHtml;
      }
    } catch (error) {
      debugLog(`Reading chat overlay html failed ${candidate}: ${cleanError(error)}`);
    }
  }

  throw new Error(`Chat overlay HTML not found. Tried: ${candidatePaths.join(" | ")}`);
}

function primeCaptureWindow(win, width, height) {
  if (!win || win.isDestroyed()) return;
  try {
    win.setBounds({ x: -32000, y: 0, width, height });
    win.setSkipTaskbar(true);
    win.setAlwaysOnTop(false);
    win.setIgnoreMouseEvents(true);
    win.setOpacity(1);
    win.showInactive();
  } catch (error) {
    debugLog(`primeCaptureWindow failed ${cleanError(error)}`);
  }
}

async function waitForChatOverlayReady(timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (chatOverlayWindowLoaded && chatOverlayWindow && !chatOverlayWindow.isDestroyed()) {
      return true;
    }
    await delay(50);
  }
  return chatOverlayWindowLoaded;
}

async function ensureChatOverlayWindow() {
  if (!chatOverlayWindow || chatOverlayWindow.isDestroyed()) {
    chatOverlayWindowLoaded = false;
    chatOverlayWindow = new BrowserWindow({
      x: -32000,
      y: 0,
      width: 700,
      height: 900,
      show: true,
      frame: false,
      transparent: false,
      resizable: false,
      hasShadow: false,
      focusable: false,
      skipTaskbar: true,
      backgroundColor: "#080a0d",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    });
    chatOverlayWindow.webContents.on("did-finish-load", () => {
      chatOverlayWindowLoaded = true;
      const currentUrl = chatOverlayWindow?.webContents?.getURL?.() || "";
      debugLog(`Chat overlay helper did-finish-load url=${currentUrl}`);
    });
    chatOverlayWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      debugLog(`Chat overlay helper did-fail-load code=${errorCode} desc=${errorDescription} url=${validatedURL} main=${isMainFrame}`);
    });
    const helperPath = path.join(__dirname, "renderer", "chat-overlay.html");
    debugLog(`Loading chat overlay helper file ${helperPath}`);
    chatOverlayWindow.loadFile(helperPath).catch((error) => {
      debugLog(`Chat overlay helper loadFile rejected ${cleanError(error)}`);
    });
  }

  primeCaptureWindow(chatOverlayWindow, 700, 900);

  return chatOverlayWindow;
}

async function syncChatOverlayWindow() {
  if (!config.openVrOverlay.enabled && (!chatOverlayWindow || chatOverlayWindow.isDestroyed())) {
    return;
  }

  const win = await ensureChatOverlayWindow();
  if (!(await waitForChatOverlayReady())) {
    debugLog("Chat overlay helper not ready for sync yet");
    return;
  }
  const payload = JSON.stringify(chatOverlayMessages.slice(-(config.maxMessages || MAX_MESSAGES)));
  debugLog("Syncing chat overlay helper messages");
  await win.webContents.executeJavaScript(`(() => {
    const list = ${payload};
    const target = document.getElementById("messages");
    const escapeText = (value) => String(value || "").replace(/[&<>"']/g, (c) => {
      if (c === "&") return "&amp;";
      if (c === "<") return "&lt;";
      if (c === ">") return "&gt;";
      if (c === '"') return "&quot;";
      return "&#39;";
    });
    const isSafeImageUrl = (value) => {
      try {
        const url = new URL(String(value || ""));
        return url.protocol === "https:" || url.protocol === "http:";
      } catch {
        return false;
      }
    };
    const renderParts = (parts, fallbackText) => {
      const safeParts = Array.isArray(parts) && parts.length ? parts : [{ type: "text", text: fallbackText || "" }];
      return safeParts.map((part) => {
        if (part?.type === "emote" && isSafeImageUrl(part.url)) {
          return '<img class="emote" src="' + escapeText(part.url) + '" alt="' + escapeText(part.name || "emote") + '" />';
        }
        return '<span>' + escapeText(part?.text || "") + '</span>';
      }).join("");
    };
    if (!target) return;
    if (!list.length) {
      target.innerHTML = '<div class="empty">Waiting for chat</div>';
      return;
    }
    target.innerHTML = list.map((item) => {
      const colorStyle = item.color ? ' style="--author-color:' + escapeText(item.color) + '"' : '';
      const platformClass = escapeText(item.platform || '');
      return '<article class="message">' +
        '<div class="row">' +
          '<div class="meta">' +
            '<span class="platform ' + platformClass + '">' + platformClass + '</span>' +
            '<span class="author"' + colorStyle + '>' + escapeText(item.author || '') + '</span>' +
          '</div>' +
          '<p class="text ' + platformClass + '">' + renderParts(item.parts, item.text) + '</p>' +
        '</div>' +
      '</article>';
    }).join('');
    target.scrollTop = target.scrollHeight;
  })()`);
  debugLog("Chat overlay helper messages synced");
}

async function writeOpenVrFrame() {
  if (!mainWindow || !openVrFramePath) return;
  if (openVrFrameWriteInFlight) {
    openVrFrameDirty = true;
    return;
  }
  if (!openVrFrameDirty && openVrLastFrameBytes) return;

  openVrFrameWriteInFlight = true;
  try {
    openVrFrameDirty = false;
    await writeOpenVrFrameOnce();
  } finally {
    openVrFrameWriteInFlight = false;
    if (openVrFrameDirty && config.openVrOverlay.enabled) {
      scheduleOpenVrFrameWrite(60);
    }
  }
}

async function writeOpenVrFrameOnce() {
  if (!openVrFramePath) return;
  const sourceWindow = await ensureChatOverlayWindow().catch((error) => {
    debugLog(`ensureChatOverlayWindow failed ${cleanError(error)}`);
    return null;
  });
  if (!sourceWindow) return;
  if (!(await waitForChatOverlayReady())) {
    debugLog("Chat overlay helper not ready for capture yet");
    return;
  }

  await syncChatOverlayWindow().catch((error) => debugLog(`syncChatOverlayWindow before capture failed ${cleanError(error)}`));
  try {
    sourceWindow.webContents.invalidate();
  } catch {
  }
  await delay(80);
  debugLog("Capturing chat overlay helper frame");
  const image = await withTimeout(
    sourceWindow.webContents.capturePage().catch((error) => {
      debugLog(`capturePage failed ${cleanError(error)}`);
      return null;
    }),
    2500,
    null
  );
  if (!image) {
    debugLog("OpenVR frame capture skipped");
    return;
  }
  debugLog("Chat overlay helper frame captured");
  const bytes = image.toPNG();
  if (openVrLastFrameBytes && Buffer.compare(bytes, openVrLastFrameBytes) === 0) {
    return;
  }

  if (!writeOpenVrTextureFrame(bytes)) {
    const tempPath = `${openVrFramePath}.tmp`;
    fs.writeFileSync(tempPath, bytes);
    await replaceOpenVrFrame(tempPath, openVrFramePath);
  }
  openVrLastFrameBytes = bytes;
}

async function ensureAlertOverlayWindow(url) {
  if (!url) return null;

  if (!alertOverlayWindow || alertOverlayWindow.isDestroyed()) {
    alertOverlayWindowLoaded = false;
    alertOverlayWindowUrl = "";
    alertOverlayWindow = new BrowserWindow({
      x: -32000,
      y: 0,
      width: 920,
      height: 260,
      show: true,
      frame: false,
      transparent: true,
      resizable: false,
      hasShadow: false,
      focusable: false,
      skipTaskbar: true,
      backgroundColor: "#00000000",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    });
    alertOverlayWindow.webContents.on("did-finish-load", () => {
      alertOverlayWindowLoaded = true;
      debugLog(`Alert overlay helper did-finish-load url=${alertOverlayWindow?.webContents?.getURL?.() || ""}`);
    });
    alertOverlayWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      debugLog(`Alert overlay helper did-fail-load code=${errorCode} desc=${errorDescription} url=${validatedURL} main=${isMainFrame}`);
    });
    alertOverlayWindow.webContents.on("console-message", (_event, _level, message) => {
      if (message === "__VR_ALERT_DIRTY__") {
        scheduleAlertVrFrameWrite(60);
      }
    });
  }

  if (alertOverlayWindowUrl !== url) {
    alertOverlayWindowLoaded = false;
    alertOverlayWindowUrl = url;
    alertOverlayWindow.loadURL(url).catch((error) => {
      debugLog(`Alert overlay helper loadURL rejected ${cleanError(error)}`);
    });
  }

  const ready = await (async () => {
    const start = Date.now();
    while (Date.now() - start < 3500) {
      if (alertOverlayWindowLoaded && alertOverlayWindow && !alertOverlayWindow.isDestroyed()) {
        return true;
      }
      await delay(50);
    }
    return false;
  })();
  if (!ready) {
    debugLog("Alert overlay helper not ready yet");
    return null;
  }

  primeCaptureWindow(alertOverlayWindow, 920, 260);
  await installAlertOverlayObserver(alertOverlayWindow).catch((error) => {
    debugLog(`Alert overlay observer install failed ${cleanError(error)}`);
  });

  return alertOverlayWindow;
}

async function installAlertOverlayObserver(win) {
  if (!win || win.isDestroyed()) {
    return;
  }

  await win.webContents.executeJavaScript(`(() => {
    if (window.__vrAlertObserverInstalled) {
      return true;
    }
    window.__vrAlertObserverInstalled = true;

    let debounceTimer = null;
    let pumpTimer = null;
    let pumpRefs = 0;

    const emit = () => console.debug("__VR_ALERT_DIRTY__");
    const queue = (delay = 40) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(emit, delay);
    };
    const ensurePump = () => {
      if (!pumpTimer) {
        pumpTimer = setInterval(emit, 90);
      }
      pumpRefs += 1;
      emit();
    };
    const releasePump = () => {
      pumpRefs = Math.max(0, pumpRefs - 1);
      if (pumpRefs === 0 && pumpTimer) {
        clearInterval(pumpTimer);
        pumpTimer = null;
        queue(120);
      }
    };
    const attachObserver = () => {
      const root = document.documentElement || document.body;
      if (!root) {
        setTimeout(attachObserver, 50);
        return;
      }
      new MutationObserver(() => queue(60)).observe(root, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true
      });
      queue(0);
    };

    document.addEventListener("animationstart", ensurePump, true);
    document.addEventListener("animationend", releasePump, true);
    document.addEventListener("transitionstart", ensurePump, true);
    document.addEventListener("transitionend", releasePump, true);
    window.addEventListener("load", () => queue(0), { once: true });
    attachObserver();
    return true;
  })()`, true);
}

function getAlertOverlaySourceUrl() {
  if (config.alerts.mode === "streamlabs" && config.alerts.streamlabsAlertUrl) {
    return config.alerts.streamlabsAlertUrl;
  }
  return `${getAlertBrowserSourceUrl()}?vr=1`;
}

function getAlertOverlayPlacement() {
  const scale = Number(config.alerts.overlayScale) || 1;
  if (config.alerts.overlayPosition === "banner") {
    return {
      key: "com.codex.vrchatscreen.alert",
      name: "VR Chat Alerts",
      anchor: "Hmd",
      preset: "Custom",
      width: 0.34 * scale,
      x: 0,
      y: 0.09,
      z: -0.55,
      pitch: -8,
      yaw: 0,
      roll: 180,
      alpha: 1
    };
  }

  const vr = config.openVrOverlay;
  const basePose = getOpenVrRelativePose(vr);
  const chatHeight = vr.widthMeters * (900 / 700);
  const alertWidth = Math.max(0.16, vr.widthMeters * 0.95 * scale);
  const alertHeight = alertWidth * (260 / 920);
  const verticalOffset = (chatHeight / 2) + (alertHeight / 2) + Math.max(0.015, vr.widthMeters * 0.05);
  const liftedPose = offsetPoseAlongLocalUp(basePose, verticalOffset);
  if (vr.anchor === "world") {
    return {
      key: "com.codex.vrchatscreen.alert",
      name: "VR Chat Alerts",
      anchor: "World",
      preset: "Custom",
      width: alertWidth,
      x: liftedPose.x,
      y: liftedPose.y,
      z: liftedPose.z,
      pitch: basePose.pitch,
      yaw: basePose.yaw,
      roll: basePose.roll,
      alpha: 1
    };
  }

  return {
    key: "com.codex.vrchatscreen.alert",
    name: "VR Chat Alerts",
    anchor: openVrAnchorForHost(vr.anchor),
    preset: "Custom",
    width: alertWidth,
    x: liftedPose.x,
    y: liftedPose.y,
    z: liftedPose.z,
    pitch: basePose.pitch,
    yaw: basePose.yaw,
    roll: basePose.roll,
    alpha: 1
  };
}

function getOpenVrRelativePose(vr) {
  let x = Number(vr.x) || 0;
  let y = Number(vr.y) || 0;
  let z = Number(vr.z) || 0;
  let pitch = Number(vr.pitch) || 0;
  let yaw = Number(vr.yaw) || 0;
  let roll = Number(vr.roll) || 0;

  if (vr.anchor !== "world" && vr.controllerPreset !== "custom") {
    const rightSide = vr.anchor === "right-controller";
    const presetPose = vr.controllerPreset === "top"
      ? { x: 0, y: 0.16, z: -0.06, pitch: 55, yaw: 0, roll: 180 }
      : vr.controllerPreset === "behind"
        ? { x: 0, y: -0.08, z: 0.10, pitch: 35, yaw: 180, roll: 180 }
        : {
            x: rightSide ? 0.05 : -0.05,
            y: 0.08,
            z: 0.18,
            pitch: -25,
            yaw: rightSide ? 90 : -90,
            roll: rightSide ? -15 : 15
          };

    x += presetPose.x;
    y += presetPose.y;
    z += presetPose.z;
    pitch += presetPose.pitch;
    yaw += presetPose.yaw;
    roll += presetPose.roll;
  }

  return { x, y, z, pitch, yaw, roll };
}

function offsetPoseAlongLocalUp(pose, distance) {
  const matrix = rotationMatrixDegrees(pose.pitch, pose.yaw, pose.roll + 180);
  const up = {
    x: matrix[0][1],
    y: matrix[1][1],
    z: matrix[2][1]
  };
  return {
    ...pose,
    x: pose.x + (up.x * distance),
    y: pose.y + (up.y * distance),
    z: pose.z + (up.z * distance)
  };
}

function rotationMatrixDegrees(pitchDegrees, yawDegrees, rollDegrees) {
  const pitch = pitchDegrees * Math.PI / 180;
  const yaw = yawDegrees * Math.PI / 180;
  const roll = rollDegrees * Math.PI / 180;

  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);

  return [
    [cy * cr + sy * sp * sr, sr * cp, -sy * cr + cy * sp * sr],
    [-cy * sr + sy * sp * cr, cr * cp, sr * sy + cy * sp * cr],
    [sy * cp, -sp, cy * cp]
  ];
}

function scheduleAlertVrFrameWrite(delayMs = 0) {
  alertVrFrameDirty = true;

  if (!config.openVrOverlay.enabled || !config.alerts.enabled || !alertVrFramePath) {
    return;
  }

  if (alertVrFrameDebounceTimer) {
    clearTimeout(alertVrFrameDebounceTimer);
  }

  alertVrFrameDebounceTimer = setTimeout(() => {
    alertVrFrameDebounceTimer = undefined;
    writeAlertVrFrame().catch((error) => debugLog(`Alert OpenVR frame write failed ${cleanError(error)}`));
  }, Math.max(0, delayMs));
}

async function restartAlertVrOverlay() {
  await stopAlertVrOverlay();

  if (!config.openVrOverlay.enabled || !config.alerts.enabled) {
    return;
  }

  const sourceUrl = getAlertOverlaySourceUrl();
  if (!sourceUrl) {
    return;
  }

  const hostExe = getOpenVrHostPath();
  if (!fs.existsSync(hostExe)) {
    return;
  }

  const alertWindow = await ensureAlertOverlayWindow(sourceUrl).catch((error) => {
    debugLog(`Alert overlay window failed ${cleanError(error)}`);
    return null;
  });
  if (!alertWindow) {
    return;
  }

  alertVrFramePath = path.join(app.getPath("userData"), "openvr-alert-frame.png");
  alertVrFrameDirty = true;
  await writeAlertVrFrame().catch((error) => debugLog(`Initial alert OpenVR frame write failed ${cleanError(error)}`));

  const placement = getAlertOverlayPlacement();
  alertVrShutdownRequested = false;
  alertVrHost = spawn(hostExe, [
    "--frame", alertVrFramePath,
    "--key", placement.key,
    "--name", placement.name,
    "--anchor", placement.anchor,
    "--preset", placement.preset,
    "--width", String(placement.width),
    "--alpha", String(placement.alpha),
    "--x", String(placement.x),
    "--y", String(placement.y),
    "--z", String(placement.z),
    "--pitch", String(placement.pitch),
    "--yaw", String(placement.yaw),
    "--roll", String(placement.roll),
    "--interval", String(Math.max(80, Math.min(500, config.openVrOverlay.frameIntervalMs))),
    "--grab", "false",
    "--locked", "true",
    "--texture", String(openVrTextureMode)
  ], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  alertVrHost.stdout.on("data", (data) => {
    const text = data.toString().trim();
    if (text) {
      debugLog(`Alert OpenVR stdout: ${text}`);
    }
  });
  alertVrHost.stderr.on("data", (data) => {
    const text = data.toString().trim();
    if (text) {
      debugLog(`Alert OpenVR stderr: ${text}`);
    }
  });
  alertVrHost.on("exit", (code) => {
    debugLog(`Alert OpenVR host exited with ${code}`);
    alertVrHost = undefined;
    clearInterval(alertVrFrameTimer);
    alertVrFrameTimer = undefined;
    if (!alertVrShutdownRequested && config.openVrOverlay.enabled && config.alerts.enabled) {
      setTimeout(() => {
        if (!alertVrHost && config.openVrOverlay.enabled && config.alerts.enabled) {
          restartAlertVrOverlay().catch((error) => debugLog(`Alert OpenVR restart failed ${cleanError(error)}`));
        }
      }, 500);
    }
  });

  for (const ms of [120, 320, 720]) {
    setTimeout(() => {
      alertVrFrameDirty = true;
      writeAlertVrFrame().catch((error) => debugLog(`Delayed alert OpenVR frame write failed ${cleanError(error)}`));
    }, ms);
  }

  alertVrFrameTimer = setInterval(() => {
    alertVrFrameDirty = true;
    writeAlertVrFrame().catch((error) => debugLog(`Alert OpenVR frame write failed ${cleanError(error)}`));
  }, Math.max(120, Math.min(260, config.openVrOverlay.frameIntervalMs)));
}

async function stopAlertVrOverlay() {
  alertVrShutdownRequested = true;
  clearInterval(alertVrFrameTimer);
  alertVrFrameTimer = undefined;
  clearTimeout(alertVrFrameDebounceTimer);
  alertVrFrameDebounceTimer = undefined;
  alertVrFrameWriteInFlight = false;
  alertVrLastFrameBytes = undefined;
  alertVrFrameDirty = false;

  const host = alertVrHost;
  alertVrHost = undefined;
  if (host && !host.killed) {
    const exited = new Promise((resolve) => {
      const done = () => resolve(undefined);
      host.once("exit", done);
      setTimeout(done, 800);
    });
    host.kill();
    await exited;
  }

  if (alertOverlayWindow && !alertOverlayWindow.isDestroyed()) {
    alertOverlayWindow.destroy();
  }
  alertOverlayWindow = undefined;
  alertOverlayWindowLoaded = false;
  alertOverlayWindowUrl = "";
}

async function writeAlertVrFrame() {
  if (!alertOverlayWindow || !alertVrFramePath) return;
  if (alertVrFrameWriteInFlight) {
    alertVrFrameDirty = true;
    return;
  }
  if (!alertVrFrameDirty && alertVrLastFrameBytes) {
    return;
  }

  alertVrFrameWriteInFlight = true;
  try {
    alertVrFrameDirty = false;
    const image = await withTimeout(
      alertOverlayWindow.webContents.capturePage().catch((error) => {
        debugLog(`alert capturePage failed ${cleanError(error)}`);
        return null;
      }),
      2500,
      null
    );
    if (!image) {
      return;
    }
    const bytes = image.toPNG();
    if (alertVrLastFrameBytes && Buffer.compare(bytes, alertVrLastFrameBytes) === 0) {
      return;
    }

    const tempPath = `${alertVrFramePath}.tmp`;
    fs.writeFileSync(tempPath, bytes);
    await replaceOpenVrFrame(tempPath, alertVrFramePath);
    alertVrLastFrameBytes = bytes;
  } finally {
    alertVrFrameWriteInFlight = false;
    if (alertVrFrameDirty && config.openVrOverlay.enabled && config.alerts.enabled) {
      scheduleAlertVrFrameWrite(60);
    }
  }
}

function writeOpenVrTextureFrame(bytes) {
  if (!openVrTextureMode || !openVrHost?.stdin || openVrHost.stdin.destroyed || !openVrHost.stdin.writable) {
    return false;
  }

  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(bytes.length, 0);
  openVrHost.stdin.write(header);
  openVrHost.stdin.write(bytes);
  return true;
}

async function replaceOpenVrFrame(tempPath, targetPath, attempts = 8) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      fs.renameSync(tempPath, targetPath);
      return;
    } catch (error) {
      if (!["EPERM", "EACCES", "EBUSY"].includes(error.code) || attempt === attempts - 1) {
        throw error;
      }

      await delay(20 + attempt * 20);
    }
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    delay(ms).then(() => fallback)
  ]);
}

function createTwitchConnector(channels) {
  let client;
  let reconnectTimer;
  let shouldRun = true;

  return {
    label: "Twitch",
    async start() {
      shouldRun = true;
      status("Twitch", "connecting", channels.join(", "));
      await refreshGlobalEmoteCaches().catch((error) => debugLog(`Emote cache load failed: ${cleanError(error)}`));

      client = new tmi.Client({
        connection: { reconnect: true, secure: true },
        channels
      });

      client.on("message", (channel, userstate, text, self) => {
        if (self) return;
        message({
          platform: "twitch",
          channel: channel.replace(/^#/, ""),
          author: userstate["display-name"] || userstate.username || "viewer",
          text,
          platformMessageId: userstate.id,
          platformAuthorId: userstate["user-id"] || "",
          parts: buildTwitchMessageParts(text, userstate.emotes),
          color: userstate.color || "#a970ff",
          badges: Object.keys(userstate.badges || {})
        });
      });

      client.on("connected", () => status("Twitch", "connected", channels.join(", ")));
      client.on("disconnected", (reason) => {
        status("Twitch", "disconnected", reason);
        if (shouldRun) {
          reconnectTimer = setTimeout(() => this.start().catch((error) => status("Twitch", "error", cleanError(error))), 10000);
        }
      });

      await client.connect().catch((error) => {
        status("Twitch", "error", cleanError(error));
        if (shouldRun) {
          reconnectTimer = setTimeout(() => this.start().catch((retryError) => status("Twitch", "error", cleanError(retryError))), 10000);
        }
      });
    },
    async stop() {
      shouldRun = false;
      clearTimeout(reconnectTimer);
      if (client?.readyState() === "OPEN") {
        await client.disconnect();
      }
    }
  };
}

function createYouTubeConnector(source) {
  let interval;
  let retryTimer;
  let shouldRun = true;
  let options;
  const statusSource = `YouTube ${shortYouTubeSource(source)}`;

  return {
    label: statusSource,
    async start() {
      shouldRun = true;
      await connect();
    },
    async stop() {
      shouldRun = false;
      clearInterval(interval);
      clearTimeout(retryTimer);
    }
  };

  async function connect() {
    clearInterval(interval);
    clearTimeout(retryTimer);
    interval = undefined;
    retryTimer = undefined;

    if (!shouldRun) {
      return;
    }

      let target;
      try {
        target = await resolveYouTubeTarget(source);
      } catch (error) {
        status(statusSource, "error", cleanError(error));
        scheduleYouTubeRetry(statusSource, error);
        return;
      }

      try {
        status(statusSource, "connecting", target.label);
        options = await fetchYouTubeLivePage(target.options);
        status(statusSource, "connected", `${options.liveId}: waiting for messages`);
        await pollYouTubeChat(statusSource, options);

        interval = setInterval(() => {
          pollYouTubeChat(statusSource, options).catch((error) => {
            status(statusSource, "error", cleanError(error));
            scheduleYouTubeRetry(statusSource, error);
          });
        }, 1250);
      } catch (error) {
        const state = isExplicitYouTubeVideoSource(source) ? "error" : "idle";
        status(statusSource, state, `${cleanError(error)}. Retrying in ${Math.round(YOUTUBE_RETRY_MS / 1000)}s.`);
        scheduleYouTubeRetry(statusSource, error);
      }
  }

  function scheduleYouTubeRetry(sourceLabel, error) {
    clearInterval(interval);
    clearTimeout(retryTimer);
    if (!shouldRun) {
      return;
    }

    const detail = `${cleanError(error)}. Polling for a live chat every ${Math.round(YOUTUBE_RETRY_MS / 1000)}s.`;
    status(sourceLabel, isExplicitYouTubeVideoSource(source) ? "retrying" : "idle", detail);
    retryTimer = setTimeout(() => connect().catch((retryError) => scheduleYouTubeRetry(sourceLabel, retryError)), YOUTUBE_RETRY_MS);
  }

  async function pollYouTubeChat(sourceLabel, currentOptions) {
    if (!shouldRun || !currentOptions) {
      return;
    }

    const [items, continuation] = await fetchYouTubeChat(currentOptions);
    currentOptions.continuation = continuation;
    if (!items.length) {
      return;
    }

    status(sourceLabel, "connected", `${currentOptions.liveId}: ${items.length} new`);
    for (const item of items) {
      message({
        platform: "youtube",
        channel: currentOptions.liveId,
        author: item.author?.name || "viewer",
        text: flattenYouTubeMessage(item.message),
        platformMessageId: item.id,
        platformAuthorId: item.author?.channelId,
        moderationContext: {
          liveId: currentOptions.liveId
        },
        parts: buildYouTubeMessageParts(item.message),
        color: item.superchat?.color || "#ff3d3d",
        badges: getYouTubeBadges(item)
      });
    }
  }
}

function shortYouTubeSource(source) {
  const value = String(source || "").trim();
  const videoId = extractYouTubeVideoId(value);
  if (videoId) {
    return videoId;
  }

  return value
    .replace(/^https?:\/\/(www\.)?youtube\.com\//i, "")
    .replace(/\/live$/i, "")
    .replace(/\/$/, "") || "source";
}

function isExplicitYouTubeVideoSource(source) {
  return Boolean(extractYouTubeVideoId(String(source || "")));
}

async function fetchYouTubeLivePage(id) {
  const url = generateYouTubeLiveUrl(id);
  if (!url) {
    throw new TypeError("YouTube source did not contain a channel, handle, or video id");
  }

  const headers = await getYouTubeRequestHeaders();
  const response = await axios.get(url, {
    headers,
    maxRedirects: 5,
    validateStatus: (statusCode) => statusCode >= 200 && statusCode < 400
  });

  return parseYouTubeLivePage(response.data.toString(), "liveId" in id ? id.liveId : undefined);
}

async function fetchYouTubeChat(options) {
  const headers = await getYouTubeRequestHeaders();
  const response = await axios.post(`https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${options.apiKey}`, {
    context: {
      client: {
        clientVersion: options.clientVersion,
        clientName: "WEB"
      }
    },
    continuation: options.continuation
  }, { headers });

  return parseChatData(response.data);
}

function generateYouTubeLiveUrl(id) {
  if ("channelId" in id) {
    return `https://www.youtube.com/channel/${id.channelId}/live`;
  }

  if ("liveId" in id) {
    return `https://www.youtube.com/watch?v=${id.liveId}`;
  }

  if ("handle" in id) {
    const handle = id.handle.startsWith("@") ? id.handle : `@${id.handle}`;
    return `https://www.youtube.com/${handle}/live`;
  }

  return "";
}

function parseYouTubeLivePage(data, fallbackLiveId) {
  try {
    return getOptionsFromLivePage(data);
  } catch (originalError) {
    const liveId = data.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([^"]+)">/)?.[1] ||
      data.match(/"videoId":"([\w-]{11})"/)?.[1] ||
      fallbackLiveId;
    const apiKey = data.match(/['"]INNERTUBE_API_KEY['"]:\s*['"](.+?)['"]/)?.[1];
    const clientVersion = data.match(/['"]clientVersion['"]:\s*['"]([^'"]+?)['"]/)?.[1] ||
      data.match(/['"]INNERTUBE_CLIENT_VERSION['"]:\s*['"]([^'"]+?)['"]/)?.[1];
    const continuation = data.match(/['"]continuation['"]:\s*['"](.+?)['"]/)?.[1];

    if (data.match(/['"]isReplay['"]:\s*(true)/)) {
      throw new Error(`${liveId || "This video"} is finished live`);
    }

    if (!liveId || !apiKey || !clientVersion || !continuation) {
      throw originalError;
    }

    return {
      liveId,
      apiKey,
      clientVersion,
      continuation
    };
  }
}

async function getYouTubeRequestHeaders() {
  const headers = {
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "en-GB,en;q=0.9",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
  };

  if (config.youtubeUseCookies) {
    const cookieHeader = await getYouTubeCookieHeader();
    if (cookieHeader) {
      headers.cookie = cookieHeader;
    }
  }

  return headers;
}

async function getYouTubeCookieHeader() {
  const cookies = await session.defaultSession.cookies.get({ url: "https://www.youtube.com" });
  return cookies
    .filter((cookie) => cookie.name && cookie.value)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

async function getYouTubeCookieSummary() {
  const cookies = await session.defaultSession.cookies.get({ url: "https://www.youtube.com" });
  const signedIn = cookies.some((cookie) => ["SID", "HSID", "SSID", "APISID", "SAPISID", "LOGIN_INFO"].includes(cookie.name));
  return {
    signedIn,
    count: cookies.length
  };
}

async function resolveYouTubeTarget(source) {
  const value = String(source || "").trim();
  const videoId = extractYouTubeVideoId(value);
  if (videoId) {
    return { label: videoId, options: { liveId: videoId } };
  }

  if (/^UC[\w-]{20,}$/i.test(value)) {
    return { label: value, options: { channelId: value } };
  }

  const channelId = await resolveYouTubeChannelId(value);
  return {
    label: value.replace(/^https?:\/\/(www\.)?youtube\.com\//i, ""),
    options: { channelId }
  };
}

function extractYouTubeVideoId(value) {
  const trimmed = value.trim();
  if (/^[\w-]{11}$/.test(trimmed) && !trimmed.startsWith("@")) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    if (url.hostname.includes("youtu.be")) {
      return url.pathname.split("/").filter(Boolean)[0];
    }
    if (url.hostname.includes("youtube.com")) {
      const watchId = url.searchParams.get("v");
      if (watchId) {
        return watchId;
      }

      const parts = url.pathname.split("/").filter(Boolean);
      if ((parts[0] === "live" || parts[0] === "shorts" || parts[0] === "embed") && /^[\w-]{11}$/.test(parts[1] || "")) {
        return parts[1];
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

async function resolveYouTubeChannelId(source) {
  const url = source.startsWith("http")
    ? source
    : `https://www.youtube.com/${source.startsWith("@") ? source : `@${source}`}`;
  const response = await fetch(url, {
    headers: {
      "accept": "text/html",
      "user-agent": "VRChatScreen/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`YouTube source ${source} returned ${response.status}`);
  }

  const html = await response.text();
  const match =
    html.match(/"channelId":"(UC[\w-]+)"/) ||
    html.match(/"externalId":"(UC[\w-]+)"/) ||
    html.match(/"browseId":"(UC[\w-]+)"/) ||
    html.match(/<meta itemprop="channelId" content="(UC[\w-]+)">/);
  if (!match) {
    throw new Error(`Could not resolve YouTube channel id from ${source}`);
  }

  return match[1];
}


function buildTwitchMessageParts(text, emotes) {
  const value = String(text || "");
  const ranges = [];

  for (const [id, positions] of Object.entries(emotes || {})) {
    for (const position of positions || []) {
      const [startText, endText] = String(position).split("-");
      const start = Number(startText);
      const end = Number(endText);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
        continue;
      }

      const name = value.slice(start, end + 1);
      ranges.push({
        start,
        end,
        id,
        name,
        url: `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(id)}/default/dark/2.0`
      });
    }
  }

  ranges.sort((a, b) => a.start - b.start || a.end - b.end);

  const parts = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) {
      continue;
    }

    if (range.start > cursor) {
      pushTwitchTextAndKnownEmotes(parts, value.slice(cursor, range.start));
    }

    parts.push({
      type: "emote",
      platform: "twitch",
      id: range.id,
      name: range.name,
      url: range.url
    });
    cursor = range.end + 1;
  }

  if (cursor < value.length) {
    pushTwitchTextAndKnownEmotes(parts, value.slice(cursor));
  }

  return parts.length ? parts : [{ type: "text", text: value }];
}

function pushTwitchTextAndKnownEmotes(parts, text) {
  const value = String(text || "");
  if (!value) return;

  const tokenPattern = /(\S+|\s+)/g;
  let match;
  while ((match = tokenPattern.exec(value)) !== null) {
    const token = match[0];
    if (/^\s+$/.test(token)) {
      parts.push({ type: "text", text: token });
      continue;
    }

    const emote = getKnownTwitchEmote(token);
    if (emote) {
      parts.push({ ...emote, type: "emote" });
    } else {
      parts.push({ type: "text", text: token });
    }
  }
}

function getKnownTwitchEmote(token) {
  return emoteCaches.twitchGlobal.get(token) || emoteCaches.thirdPartyGlobal.get(token);
}

async function refreshGlobalEmoteCaches() {
  if (Date.now() - emoteCaches.loadedAt < EMOTE_CACHE_MS) {
    return;
  }

  emoteCaches.loadedAt = Date.now();
  await Promise.allSettled([
    loadIvrTwitchGlobalEmotes(),
    loadBttvGlobalEmotes(),
    loadFfzGlobalEmotes(),
    loadSevenTvGlobalEmotes()
  ]);
}

async function loadIvrTwitchGlobalEmotes() {
  const response = await axios.get("https://api.ivr.fi/v2/twitch/emotes/global", { timeout: 8000 });
  const items = Array.isArray(response.data) ? response.data : response.data?.emotes;
  for (const item of items || []) {
    const name = item.name || item.code;
    const id = item.id;
    if (!name || !id) continue;
    emoteCaches.twitchGlobal.set(name, {
      platform: "twitch",
      id: String(id),
      name,
      url: `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(id)}/default/dark/2.0`
    });
  }
}

async function loadBttvGlobalEmotes() {
  const response = await axios.get("https://api.betterttv.net/3/cached/emotes/global", { timeout: 8000 });
  for (const item of response.data || []) {
    if (!item?.code || !item?.id) continue;
    emoteCaches.thirdPartyGlobal.set(item.code, {
      platform: "twitch",
      id: item.id,
      name: item.code,
      url: `https://cdn.betterttv.net/emote/${encodeURIComponent(item.id)}/2x`
    });
  }
}

async function loadFfzGlobalEmotes() {
  const response = await axios.get("https://api.frankerfacez.com/v1/set/global", { timeout: 8000 });
  for (const setId of response.data?.default_sets || []) {
    const set = response.data?.sets?.[setId];
    for (const item of set?.emoticons || []) {
      const url = normalizeFfzUrl(item.urls?.[2] || item.urls?.[1] || item.urls?.[4]);
      if (!item?.name || !url) continue;
      emoteCaches.thirdPartyGlobal.set(item.name, {
        platform: "twitch",
        id: String(item.id || item.name),
        name: item.name,
        url
      });
    }
  }
}

async function loadSevenTvGlobalEmotes() {
  const response = await axios.get("https://7tv.io/v3/emote-sets/global", { timeout: 8000 });
  for (const item of response.data?.emotes || []) {
    const file = [...(item.data?.host?.files || [])].reverse().find((entry) => entry?.format === "WEBP") || item.data?.host?.files?.[0];
    if (!item?.name || !item?.data?.host?.url || !file?.name) continue;
    emoteCaches.thirdPartyGlobal.set(item.name, {
      platform: "twitch",
      id: item.id || item.name,
      name: item.name,
      url: normalizeImageUrl(`${item.data.host.url}/${file.name}`)
    });
  }
}

function normalizeFfzUrl(value) {
  if (!value) return "";
  const url = String(value);
  return url.startsWith("//") ? `https:${url}` : url;
}

function buildYouTubeMessageParts(parts) {
  const result = [];

  for (const part of parts || []) {
    const text = part?.text || part?.run?.text;
    if (text) {
      result.push({ type: "text", text });
      continue;
    }

    const emoji = part?.emoji || part?.run?.emoji || part;
    const url = getYouTubeEmojiUrl(emoji) || normalizeImageUrl(part?.url);
    const name = emoji?.shortcuts?.[0] || emoji?.searchTerms?.[0] || emoji?.emojiId || part?.alt || part?.emojiText || "emoji";
    if (url) {
      result.push({
        type: "emote",
        platform: "youtube",
        id: emoji?.emojiId || part?.emojiText || name,
        name,
        url
      });
    } else if (part?.emojiText || part?.alt) {
      result.push({ type: "text", text: part.emojiText || part.alt });
    }
  }

  return result.length ? result : [{ type: "text", text: flattenYouTubeMessage(parts) }];
}

function getYouTubeEmojiUrl(emoji) {
  const thumbnails = emoji?.image?.thumbnails || emoji?.thumbnails || [];
  const best = thumbnails[thumbnails.length - 1] || thumbnails[0];
  return normalizeImageUrl(best?.url || emoji?.image?.url || emoji?.url);
}

function parseKickMessageParts(text, emotes = []) {
  const value = String(text || "");
  const parts = [];
  const pattern = /\[emote:(\d+):([^\]]+)\]/g;
  let cursor = 0;
  let match;

  while ((match = pattern.exec(value)) !== null) {
    if (match.index > cursor) {
      parts.push({ type: "text", text: value.slice(cursor, match.index) });
    }

    const id = match[1];
    const name = match[2] || `emote-${id}`;
    parts.push({
      type: "emote",
      platform: "kick",
      id,
      name,
      url: `https://files.kick.com/emotes/${encodeURIComponent(id)}/fullsize`,
      fallbackUrls: [
        `https://files.kick.com/emotes/${encodeURIComponent(id)}/fullsize.webp`,
        `https://files.kick.com/emotes/${encodeURIComponent(id)}/fullsize.png`,
        `https://cdn.kick.com/emotes/${encodeURIComponent(id)}/fullsize`
      ]
    });
    cursor = match.index + match[0].length;
  }

  if (cursor < value.length) {
    parts.push({ type: "text", text: value.slice(cursor) });
  }

  if (!parts.length && Array.isArray(emotes) && emotes.length) {
    parts.push({ type: "text", text: value });
  }

  return parts.length ? parts : [{ type: "text", text: value }];
}

function normalizeImageUrl(value) {
  if (!value) {
    return "";
  }

  const url = String(value);
  if (url.startsWith("//")) {
    return `https:${url}`;
  }

  if (url.startsWith("/")) {
    return `https://www.youtube.com${url}`;
  }

  return url;
}

function flattenYouTubeMessage(parts) {
  return (parts || [])
    .map((part) => part.text || part.run?.text || part.emojiText || part.alt || part.emoji?.shortcuts?.[0] || part.emoji?.emojiId || "")
    .join("")
    .trim();
}

function getYouTubeBadges(item) {
  const badges = [];
  if (item.isOwner) badges.push("owner");
  if (item.isModerator) badges.push("mod");
  if (item.isVerified) badges.push("verified");
  if (item.isMembership) badges.push("member");
  if (item.superchat) badges.push(item.superchat.amount || "super");
  return badges;
}

function createKickConnector(slug) {
  let socket;
  let reconnectTimer;
  let shouldRun = true;

  return {
    label: `Kick ${slug}`,
    async start() {
      shouldRun = true;
      let roomId;
      try {
        roomId = await fetchKickChatroomId(slug);
      } catch (error) {
        status("Kick", "error", `${cleanError(error)}. Retrying in ${Math.round(KICK_RETRY_MS / 1000)}s.`);
        reconnectTimer = setTimeout(() => this.start().catch((retryError) => status("Kick", "error", cleanError(retryError))), KICK_RETRY_MS);
        return;
      }

      status("Kick", "connecting", `${slug} (${roomId})`);

      socket = new WebSocket(`wss://ws-us2.pusher.com/app/${KICK_PUSHER_KEY}?protocol=7&client=js&version=8.4.0&flash=false`);

      socket.on("open", () => {
        socket.send(JSON.stringify({
          event: "pusher:subscribe",
          data: { auth: "", channel: `chatrooms.${roomId}.v2` }
        }));
      });

      socket.on("message", (raw) => {
        const event = parseJson(raw.toString());
        if (!event) return;

        if (event.event === "pusher:connection_established") {
          status("Kick", "connected", slug);
          return;
        }

        const data = parseJson(event.data);
        const body = parseKickMessage(data);
        if (!body) return;

        message({
          platform: "kick",
          channel: slug,
          author: body.author,
          text: body.text,
          platformMessageId: body.messageId,
          platformAuthorId: body.userId,
          moderationContext: {
            messageId: body.messageId
          },
          parts: body.parts,
          color: "#53fc18",
          badges: body.badges
        });
      });

      socket.on("close", () => {
        status("Kick", "disconnected", slug);
        if (shouldRun) {
          reconnectTimer = setTimeout(() => this.start().catch((error) => status("Kick", "error", cleanError(error))), 5000);
        }
      });

      socket.on("error", (error) => status("Kick", "error", cleanError(error)));
    },
    async stop() {
      shouldRun = false;
      clearTimeout(reconnectTimer);
      socket?.close();
    }
  };
}

async function fetchKickChatroomId(slug) {
  const details = await fetchKickChannelDetails(slug);
  if (!details.roomId) {
    throw new Error(`Kick channel ${slug} did not expose a chatroom id`);
  }
  return details.roomId;
}

async function fetchKickChannelDetails(slug) {
  const key = String(slug || "").trim().toLowerCase();
  if (kickChannelCache.has(key)) {
    return kickChannelCache.get(key);
  }

  const apiUrl = `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`;
  const response = await fetch(apiUrl, {
    headers: {
      "accept": "application/json",
      "accept-language": "en-GB,en;q=0.9",
      "referer": `https://kick.com/${encodeURIComponent(slug)}`,
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
    }
  });

  if (!response.ok) {
    if (response.status === 403) {
      const browserDetails = await fetchKickChannelDetailsWithBrowser(slug);
      kickChannelCache.set(key, browserDetails);
      return browserDetails;
    }

    throw new Error(`Kick channel ${slug} returned ${response.status}`);
  }

  const channel = await response.json();
  const details = {
    roomId: channel.chatroom?.id || channel.chatroom_id || 0,
    userId: channel.user_id || channel.id || channel.user?.id || channel.broadcaster_user_id || 0
  };
  kickChannelCache.set(key, details);
  return details;
}

async function fetchKickChannelDetailsWithBrowser(slug) {
  status("Kick", "connecting", `Browser lookup for ${slug}`);

  const lookupWindow = new BrowserWindow({
    width: 960,
    height: 720,
    show: false,
    title: "Kick lookup",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  try {
    await lookupWindow.loadURL(`https://kick.com/${encodeURIComponent(slug)}`);
    await new Promise((resolve) => setTimeout(resolve, 3500));

    const result = await lookupWindow.webContents.executeJavaScript(`
      (async () => {
        const slug = ${JSON.stringify(slug)};
        const readRoomId = (value) => {
          if (!value || typeof value !== "object") return undefined;
          return value.chatroom?.id || value.chatroom_id || value.channel?.chatroom?.id || value.props?.pageProps?.channel?.chatroom?.id;
        };
        const readUserId = (value) => {
          if (!value || typeof value !== "object") return undefined;
          return value.user_id || value.id || value.channel?.user_id || value.props?.pageProps?.channel?.user_id;
        };

        try {
          const response = await fetch("/api/v2/channels/" + encodeURIComponent(slug), {
            credentials: "include",
            headers: { "accept": "application/json" }
          });
          if (response.ok) {
            const data = await response.json();
            const roomId = readRoomId(data);
            const userId = readUserId(data);
            if (roomId || userId) return { roomId, userId };
          }
        } catch (error) {}

        const scripts = [...document.querySelectorAll("script")].map((script) => script.textContent || "");
        for (const text of scripts) {
          if (!text.includes("chatroom")) continue;
          const direct = text.match(/"chatroom"\\s*:\\s*\\{[^{}]*"id"\\s*:\\s*(\\d+)/);
          const directUser = text.match(/"user_id"\\s*:\\s*(\\d+)/);
          if (direct || directUser) return { roomId: direct ? Number(direct[1]) : 0, userId: directUser ? Number(directUser[1]) : 0 };
          const escaped = text.match(/\\\\"chatroom\\\\"\\s*:\\s*\\{[^{}]*\\\\"id\\\\"\\s*:\\s*(\\d+)/);
          const escapedUser = text.match(/\\\\"user_id\\\\"\\s*:\\s*(\\d+)/);
          if (escaped || escapedUser) return { roomId: escaped ? Number(escaped[1]) : 0, userId: escapedUser ? Number(escapedUser[1]) : 0 };
        }

        const body = document.body?.innerText || "";
        if (body.includes("Request blocked by security policy")) {
          return { error: "Kick blocked the browser lookup with a security policy." };
        }

        return { error: "Kick chatroom id was not found on the channel page." };
      })()
    `);

    if (result?.roomId || result?.userId) {
      return { roomId: Number(result.roomId || 0), userId: Number(result.userId || 0) };
    }

    throw new Error(result?.error || "Kick browser lookup failed");
  } finally {
    lookupWindow.destroy();
  }
}

function parseKickMessage(data) {
  if (!data) return undefined;

  const sender = data.sender || data.user || data.author || {};
  const rawText = data.content || data.message || data.text;
  const text = typeof rawText === "string"
    ? rawText
    : rawText?.text || rawText?.content || rawText?.message || rawText?.body || "";

  if (!text) return undefined;

  return {
    author: sender.username || sender.slug || sender.name || "viewer",
    userId: String(sender.user_id || sender.id || sender.userId || ""),
    messageId: String(data.id || data.message_id || data.uuid || ""),
    text,
    parts: parseKickMessageParts(text, data.emotes || data.message?.emotes),
    badges: (sender.identity?.badges || sender.badges || []).map((badge) => badge.text || badge.name || badge.type).filter(Boolean)
  };
}

function parseJson(value) {
  if (!value) return undefined;
  if (typeof value === "object") return value;

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function handleOpenVrInput(json) {
  if (!mainWindow || !openVrCaptureBounds) return;

  try {
    const input = JSON.parse(json);
    const x = Math.round(openVrCaptureBounds.x + (clampNumber(input.x, 0, 0, 1000) / 1000) * openVrCaptureBounds.width);
    const y = Math.round(openVrCaptureBounds.y + (clampNumber(input.y, 0, 0, 1000) / 1000) * openVrCaptureBounds.height);

    if (input.type === "move") {
      mainWindow.webContents.focus();
      mainWindow.webContents.sendInputEvent({ type: "mouseMove", x, y, movementX: 0, movementY: 0 });
      return;
    }

    if (input.type === "scroll") {
      mainWindow.webContents.focus();
      mainWindow.webContents.sendInputEvent({
        type: "mouseWheel",
        x,
        y,
        deltaX: Math.round(Number(input.deltaX) || 0),
        deltaY: Math.round(Number(input.deltaY) || 0),
        canScroll: true
      });
      return;
    }

    if (input.type === "down" || input.type === "up") {
      mainWindow.focus();
      mainWindow.webContents.focus();
      mainWindow.webContents.sendInputEvent({ type: "mouseMove", x, y, movementX: 0, movementY: 0 });
      mainWindow.webContents.sendInputEvent({
        type: input.type === "down" ? "mouseDown" : "mouseUp",
        x,
        y,
        button: "left",
        clickCount: 1
      });
    }
  } catch (error) {
    debugLog(`OpenVR input parse failed ${cleanError(error)}`);
  }
}

async function restartSuiteServices() {
  await restartAlertServer().catch((error) => status("Alerts", "error", cleanError(error)));
  await restartAlertVrOverlay().catch((error) => debugLog(`Alert OpenVR restart failed ${cleanError(error)}`));
  if (config.obs.autoConnect) {
    connectControlProvider().catch((error) => status(getControlProviderLabel(), "error", cleanError(error)));
  }
}

async function restartAlertServer() {
  await stopAlertServer();

  if (!config.alerts.enabled) {
    status("Alerts", "disabled", "Browser source is off");
    return;
  }

  alertServerPort = config.alerts.browserSourcePort;
  alertServer = http.createServer((request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
    if (url.pathname !== "/" && url.pathname !== "/alerts") {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(getAlertBrowserSourceHtml(url.searchParams.get("vr") === "1"));
  });

  alertWss = new WebSocket.Server({ noServer: true });
  alertServer.on("upgrade", (request, socket, head) => {
    alertWss.handleUpgrade(request, socket, head, (ws) => alertWss.emit("connection", ws, request));
  });

  await new Promise((resolve, reject) => {
    alertServer.once("error", reject);
    alertServer.listen(alertServerPort, "127.0.0.1", resolve);
  });

  status("Alerts", "connected", `${getAlertTransportLabel()} | ${getAlertBrowserSourceUrl()}`);
}

async function stopAlertServer() {
  for (const client of alertWss?.clients || []) {
    client.close();
  }

  await new Promise((resolve) => {
    if (!alertServer) {
      resolve();
      return;
    }

    alertServer.close(() => resolve());
  });

  alertWss = undefined;
  alertServer = undefined;
  alertServerPort = undefined;
}

function getAlertBrowserSourceUrl() {
  return `http://127.0.0.1:${config.alerts.browserSourcePort}/alerts`;
}

function getAlertTransportLabel() {
  if (config.alerts.mode === "streamlabs" && config.alerts.streamlabsAlertUrl) {
    return "Primary alerts use Streamlabs Alert Box";
  }
  return `Browser source for ${config.controlProvider === "streamlabs-desktop" ? "Streamlabs Desktop" : "OBS"}`;
}

function getAlertBrowserSourceHtml(vrMode = false) {
  const duration = Number(config.alerts.durationMs) || 6000;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
:root { color-scheme: dark; font-family: Segoe UI, Arial, sans-serif; }
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent !important; color: #f7fbff; }
body { display: block; }
.stage { position: fixed; inset: 0; display: grid; place-items: start center; padding: 18px; background: transparent; }
.alert { width: min(720px, calc(100vw - 36px)); padding: 18px 22px; border-radius: 18px; background: rgba(8, 12, 18, .88); border: 1px solid rgba(255,255,255,.18); box-shadow: 0 24px 80px rgba(0,0,0,.40); transform: ${vrMode ? "none" : "translateY(-18px) scale(.98)"}; opacity: 0; transition: ${vrMode ? "none" : "opacity .22s ease, transform .22s ease"}; }
.alert.show { opacity: 1; transform: none; }
.type { color: #53fc18; font-size: 12px; font-weight: 900; text-transform: uppercase; letter-spacing: .08em; }
.title { margin-top: 6px; font-size: 26px; font-weight: 900; line-height: 1.1; }
.message { margin-top: 6px; color: #cfe3f2; font-size: 16px; line-height: 1.28; }
</style>
</head>
<body>
<main class="stage"><section id="alert" class="alert"><div id="type" class="type"></div><div id="title" class="title"></div><div id="message" class="message"></div></section></main>
<script>
const box = document.getElementById("alert");
const type = document.getElementById("type");
const title = document.getElementById("title");
const message = document.getElementById("message");
let timer;
function showAlert(value) {
  clearTimeout(timer);
  type.textContent = value.type || "Alert";
  title.textContent = value.title || "Stream alert";
  message.textContent = value.message || "";
  box.classList.add("show");
  timer = setTimeout(() => box.classList.remove("show"), Number(value.durationMs) || ${duration});
}
function connect() {
  const ws = new WebSocket("ws://" + location.host + "/alerts");
  ws.onmessage = (event) => {
    try { showAlert(JSON.parse(event.data)); } catch {}
  };
  ws.onclose = () => setTimeout(connect, 1000);
}
connect();
</script>
</body>
</html>`;
}

function triggerAlert(input = {}) {
  const payload = {
    type: String(input.type || "Test alert"),
    title: String(input.title || "PCVR Stream Suite"),
    message: String(input.message || "Alert overlay is ready."),
    durationMs: Number(input.durationMs) || config.alerts.durationMs,
    createdAt: new Date().toISOString()
  };

  emit("suite:alert", payload);
  const text = JSON.stringify(payload);
  for (const client of alertWss?.clients || []) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(text);
    }
  }

  status("Alerts", "connected", `${getAlertTransportLabel()} | ${payload.type}: ${payload.title}`);
  return payload;
}

function getControlProviderLabel() {
  return config.controlProvider === "streamlabs-desktop" ? "Streamlabs" : "OBS";
}

async function connectControlProvider() {
  if (config.controlProvider === "streamlabs-desktop") {
    return connectStreamlabsDesktop();
  }
  return connectObs();
}

function disconnectControlProvider() {
  if (config.controlProvider === "streamlabs-desktop") {
    status("Streamlabs", "disconnected", "Disconnected by user");
    return { connected: false };
  }
  disconnectObs();
  status("OBS", "disconnected", "Disconnected by user");
  return { connected: false };
}

async function connectObs() {
  disconnectObs();
  status("OBS", "connecting", `${config.obs.host}:${config.obs.port}`);

  const socket = new WebSocket(`ws://${config.obs.host}:${config.obs.port}`);
  obsSocket = socket;
  obsIdentified = false;

  socket.on("message", (data) => handleObsMessage(socket, data));
  socket.on("close", () => {
    if (obsSocket === socket) {
      obsSocket = undefined;
      obsIdentified = false;
      status("OBS", "disconnected", "OBS WebSocket closed");
    }
  });
  socket.on("error", (error) => status("OBS", "error", cleanError(error)));

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("OBS connection timed out")), 8000);
    socket.once("open", () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });

  return { connected: true };
}

function slobsCall(resource, method, args = []) {
  const request = JSON.stringify({
    jsonrpc: "2.0",
    id: Date.now(),
    method,
    params: { resource, args }
  }) + "\n";

  return new Promise((resolve, reject) => {
    const socket = net.createConnection("\\\\.\\pipe\\slobs");
    let buffer = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Timed out connecting to Streamlabs Desktop API"));
    }, 2500);

    socket.on("connect", () => socket.write(request));
    socket.on("data", (data) => {
      buffer += data.toString("utf8");
      const line = buffer.split("\n").find((item) => item.trim());
      if (!line) return;
      clearTimeout(timer);
      socket.end();
      try {
        const response = JSON.parse(line);
        if (response.error) {
          reject(new Error(response.error.message || JSON.stringify(response.error)));
          return;
        }
        resolve(response.result);
      } catch (error) {
        reject(error);
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on("close", () => clearTimeout(timer));
  });
}

async function ensureOAuthCallbackServer() {
  if (oauthCallbackServer?.listening) {
    return;
  }

  oauthCallbackServer = http.createServer((request, response) => {
    handleOAuthCallback(request, response).catch((error) => {
      response.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<h1>OAuth failed</h1><p>${escapeHtml(cleanError(error))}</p>`);
    });
  });

  await new Promise((resolve, reject) => {
    oauthCallbackServer.once("error", reject);
    oauthCallbackServer.listen(OAUTH_CALLBACK_PORT, "127.0.0.1", resolve);
  });
}

async function handleOAuthCallback(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host || `127.0.0.1:${OAUTH_CALLBACK_PORT}`}`);
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] !== "callback" || !segments[1]) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const state = url.searchParams.get("state") || "";
  const pending = oauthPendingStates.get(state);
  if (!pending) {
    response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<h1>Login expired</h1><p>This OAuth session is no longer active. Return to the app and try again.</p>");
    return;
  }

  oauthPendingStates.delete(state);
  const error = url.searchParams.get("error");
  if (error) {
    pending.reject(new Error(url.searchParams.get("error_description") || error));
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<h1>${escapeHtml(getOAuthLabel(pending.platform))} login cancelled</h1><p>You can close this browser tab and return to the app.</p>`);
    return;
  }

  pending.resolve({
    code: url.searchParams.get("code") || "",
    state
  });
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(`<h1>${escapeHtml(getOAuthLabel(pending.platform))} connected</h1><p>You can close this browser tab and return to the app.</p>`);
}

function buildOAuthAuthorizeUrl(platform, account, state, codeChallenge) {
  const redirectUri = getOAuthRedirectUri(platform);
  const scopes = getOAuthScopes(platform);
  const params = new URLSearchParams();
  params.set("response_type", "code");
  params.set("client_id", account.clientId);
  params.set("redirect_uri", redirectUri);
  params.set("state", state);

  if (platform === "twitch") {
    params.set("scope", scopes.join(" "));
    return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
  }

  if (platform === "youtube") {
    params.set("scope", scopes.join(" "));
    params.set("access_type", "offline");
    params.set("prompt", "consent");
    params.set("code_challenge", codeChallenge);
    params.set("code_challenge_method", "S256");
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  if (platform === "kick") {
    params.set("redirect_uri", redirectUri);
    params.set("scope", scopes.join(" "));
    params.set("code_challenge", codeChallenge);
    params.set("code_challenge_method", "S256");
    return `https://id.kick.com/oauth/authorize?${params.toString()}`;
  }

  throw new Error(`Unsupported OAuth platform: ${platform}`);
}

function createPkcePair() {
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function waitForOAuthCode(platform, authWindow) {
  return new Promise((resolve, reject) => {
    const state = crypto.randomBytes(18).toString("hex");
    oauthPendingStates.set(state, { platform, resolve, reject });

    authWindow.once("closed", () => {
      if (!oauthPendingStates.has(state)) {
        return;
      }
      oauthPendingStates.delete(state);
      reject(new Error("Login window was closed before authorization finished"));
    });

    setTimeout(() => {
      if (!oauthPendingStates.has(state)) {
        return;
      }
      oauthPendingStates.delete(state);
      reject(new Error("Login timed out"));
    }, 5 * 60 * 1000);

    authWindow.webContents.once("did-finish-load", () => {
      authWindow.show();
      authWindow.focus();
    });

    authWindow.__oauthState = state;
  });
}

async function beginOAuthLogin(platform) {
  const account = getOAuthAccount(platform);
  if (!account.clientId) {
    throw new Error(`Add a ${getOAuthLabel(platform)} client ID in settings first`);
  }
  if ((platform === "twitch" || platform === "youtube" || platform === "kick") && !account.clientSecret) {
    throw new Error(`Add a ${getOAuthLabel(platform)} client secret in settings first`);
  }

  await ensureOAuthCallbackServer();
  const pkce = createPkcePair();
  const authWindow = new BrowserWindow({
    width: 960,
    height: 820,
    show: false,
    title: `Connect ${getOAuthLabel(platform)}`,
    icon: getAssetPath("icon.ico"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  oauthWindows.set(platform, authWindow);
  status(`${getOAuthLabel(platform)} Auth`, "connecting", "Waiting for approval");

  try {
    const waitPromise = waitForOAuthCode(platform, authWindow);
    const state = authWindow.__oauthState;
    const authorizeUrl = buildOAuthAuthorizeUrl(platform, account, state, pkce.challenge);
    await authWindow.loadURL(authorizeUrl);
    const { code } = await waitPromise;
    const tokens = await exchangeOAuthCode(platform, account, code, pkce.verifier);
    const profile = await fetchOAuthProfile(platform, tokens.access_token);
    updateOAuthAccount(platform, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || "",
      expiresAt: computeExpiry(tokens.expires_in),
      login: profile.login || profile.email || profile.name || "",
      displayName: profile.displayName || profile.name || profile.login || "",
      email: profile.email || "",
      userId: profile.userId || "",
      scopes: profile.scopes?.length ? profile.scopes : getOAuthScopes(platform)
    });

    if (platform === "twitch" && !config.moderation.twitchUsername && profile.login) {
      config.moderation.twitchUsername = profile.login;
      if (!config.moderation.twitchOAuthToken) {
        config.moderation.twitchOAuthToken = tokens.access_token;
      }
      saveAndBroadcastConfig();
    }

    status(`${getOAuthLabel(platform)} Auth`, "connected", profile.email ? `${profile.displayName || profile.login} (${profile.email})` : (profile.displayName || profile.login || "Connected"));
    return getOAuthAccount(platform);
  } finally {
    oauthWindows.delete(platform);
    if (!authWindow.isDestroyed()) {
      authWindow.destroy();
    }
  }
}

async function exchangeOAuthCode(platform, account, code, codeVerifier) {
  const redirectUri = getOAuthRedirectUri(platform);
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("client_id", account.clientId);
  body.set("client_secret", account.clientSecret);
  body.set("redirect_uri", redirectUri);
  body.set("code", code);
  if (platform !== "twitch") {
    body.set("code_verifier", codeVerifier);
  }

  const url = platform === "twitch"
    ? "https://id.twitch.tv/oauth2/token"
    : platform === "youtube"
      ? "https://oauth2.googleapis.com/token"
      : "https://id.kick.com/oauth/token";

  const response = await axios.post(url, body.toString(), {
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "accept": "application/json"
    }
  });
  return response.data;
}

async function fetchOAuthProfile(platform, accessToken) {
  if (platform === "twitch") {
    const response = await axios.get("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `OAuth ${accessToken}` }
    });
    return {
      login: response.data.login,
      displayName: response.data.login,
      userId: String(response.data.user_id || ""),
      scopes: Array.isArray(response.data.scopes) ? response.data.scopes : []
    };
  }

  if (platform === "youtube") {
    const response = await axios.get("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    return {
      login: response.data.email || response.data.name || "",
      displayName: response.data.name || response.data.email || "",
      email: response.data.email || "",
      userId: String(response.data.id || ""),
      scopes: getOAuthScopes(platform)
    };
  }

  if (platform === "kick") {
    const [userResponse, introspectResponse] = await Promise.all([
      axios.get("https://api.kick.com/public/v1/users", {
        headers: { Authorization: `Bearer ${accessToken}` }
      }),
      axios.post("https://api.kick.com/public/v1/token/introspect", undefined, {
        headers: { Authorization: `Bearer ${accessToken}` }
      })
    ]);
    const user = userResponse.data?.data?.[0] || {};
    return {
      login: user.name || user.email || "",
      displayName: user.name || user.email || "",
      email: user.email || "",
      userId: String(user.user_id || ""),
      scopes: String(introspectResponse.data?.data?.scope || "").split(/\s+/).filter(Boolean)
    };
  }

  throw new Error(`Unsupported OAuth platform: ${platform}`);
}

async function getOAuthStatus(platform) {
  const account = getOAuthAccount(platform);
  const label = getOAuthLabel(platform);

  if (!account.clientId || !account.clientSecret) {
    return {
      platform,
      configured: false,
      connected: false,
      valid: false,
      needsLogin: false,
      detail: `${label} API not configured`
    };
  }

  if (!account.accessToken) {
    return {
      platform,
      configured: true,
      connected: false,
      valid: false,
      needsLogin: false,
      detail: `${label} API ready to connect`
    };
  }

  if (account.expiresAt && Date.now() >= (Number(account.expiresAt) - 60_000)) {
    return {
      platform,
      configured: true,
      connected: false,
      valid: false,
      needsLogin: true,
      detail: `${label} login expired. Sign in again.`
    };
  }

  try {
    const profile = await fetchOAuthProfile(platform, account.accessToken);
    const next = {};
    if (profile.login && profile.login !== account.login) next.login = profile.login;
    if (profile.displayName && profile.displayName !== account.displayName) next.displayName = profile.displayName;
    if (typeof profile.email === "string" && profile.email !== account.email) next.email = profile.email;
    if (typeof profile.userId === "string" && profile.userId !== account.userId) next.userId = profile.userId;
    if (Array.isArray(profile.scopes) && JSON.stringify(profile.scopes) !== JSON.stringify(account.scopes || [])) {
      next.scopes = profile.scopes;
    }
    if (Object.keys(next).length) {
      updateOAuthAccount(platform, next);
    }

    const login = String(profile.displayName || profile.login || profile.email || "").trim();
    return {
      platform,
      configured: true,
      connected: true,
      valid: true,
      needsLogin: false,
      login,
      detail: login ? `${label} API connected as ${login}` : `${label} API connected`
    };
  } catch (error) {
    const detail = cleanError(error);
    const needsLogin = oauthErrorNeedsLogin(error, detail);
    return {
      platform,
      configured: true,
      connected: false,
      valid: false,
      needsLogin,
      detail: needsLogin ? `${label} login expired or was revoked. Sign in again.` : `${label} API check failed: ${detail}`
    };
  }
}

function oauthErrorNeedsLogin(error, detail = "") {
  const statusCode = Number(error?.response?.status || 0);
  if ([400, 401, 403].includes(statusCode)) {
    return true;
  }

  const text = String(detail || "").toLowerCase();
  return [
    "invalid token",
    "unauthorized",
    "invalid credentials",
    "token expired",
    "expired",
    "revoked",
    "invalid_grant",
    "autherror"
  ].some((fragment) => text.includes(fragment));
}

async function logoutOAuth(platform) {
  const account = getOAuthAccount(platform);
  if (account.accessToken) {
    try {
      if (platform === "twitch") {
        await axios.post(`https://id.twitch.tv/oauth2/revoke?client_id=${encodeURIComponent(account.clientId)}&token=${encodeURIComponent(account.accessToken)}`);
      } else if (platform === "youtube") {
        await axios.post(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(account.accessToken)}`, undefined, {
          headers: { "content-type": "application/x-www-form-urlencoded" }
        });
      } else if (platform === "kick") {
        await axios.post(`https://id.kick.com/oauth/revoke?token=${encodeURIComponent(account.accessToken)}&token_hint_type=access_token`, undefined, {
          headers: { "content-type": "application/x-www-form-urlencoded" }
        });
      }
    } catch (error) {
      debugLog(`${platform} revoke failed ${cleanError(error)}`);
    }
  }

  clearOAuthAccount(platform);
  if (platform === "twitch" && config.moderation.twitchOAuthToken === account.accessToken) {
    config.moderation.twitchOAuthToken = "";
    saveAndBroadcastConfig();
  }
  status(`${getOAuthLabel(platform)} Auth`, "idle", "Disconnected");
  return getOAuthAccount(platform);
}

function computeExpiry(expiresInSeconds) {
  const seconds = Number(expiresInSeconds) || 0;
  return seconds > 0 ? Date.now() + seconds * 1000 : 0;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function connectStreamlabsDesktop() {
  status("Streamlabs", "connecting", "Connecting to local desktop API");
  const activeScene = await slobsCall("ScenesService", "activeScene");
  status("Streamlabs", "connected", activeScene?.name || "Ready");
  return { connected: true };
}

async function discoverStreamlabsState() {
  const [activeScene, scenes, audioSources] = await Promise.all([
    slobsCall("ScenesService", "activeScene"),
    slobsCall("ScenesService", "getScenes"),
    slobsCall("AudioService", "getSourcesForCurrentScene")
  ]);

  return {
    currentScene: activeScene?.name || "",
    scenes: (scenes || []).map((scene) => ({ id: scene.id, name: scene.name })).filter((scene) => scene.id && scene.name),
    audioInputs: (audioSources || []).map((source) => ({
      id: source.id || source.sourceId || source.resourceId,
      resourceId: source.resourceId,
      name: source.name || source.sourceId || "Audio Source",
      muted: Boolean(source.muted)
    })).filter((source) => source.resourceId)
  };
}

async function discoverObsState() {
  const [currentScene, sceneList, inputList] = await Promise.all([
    obsRequest("GetCurrentProgramScene"),
    obsRequest("GetSceneList"),
    obsRequest("GetInputList")
  ]);

  const inputs = Array.isArray(inputList?.inputs) ? inputList.inputs : [];
  const normalizedInputs = inputs.map((input) => ({
    id: String(input.inputUuid || input.inputName || ""),
    name: String(input.inputName || ""),
    kind: String(input.inputKind || "")
  })).filter((input) => input.name);

  const audioInputs = normalizedInputs.filter((input) => /audio|wasapi|pulse|coreaudio|alsa|jack|ffmpeg|mic/i.test(input.kind || input.name));
  const audioStates = await Promise.all(audioInputs.map(async (input) => {
    try {
      const mute = await obsRequest("GetInputMute", { inputName: input.name });
      return { ...input, muted: Boolean(mute?.inputMuted) };
    } catch {
      return { ...input, muted: false };
    }
  }));

  return {
    currentScene: currentScene?.currentProgramSceneName || "",
    scenes: (sceneList?.scenes || []).map((scene) => ({
      id: String(scene.sceneUuid || scene.sceneIndex || scene.sceneName || ""),
      name: String(scene.sceneName || "")
    })).filter((scene) => scene.name),
    audioInputs: audioStates,
    videoInputs: normalizedInputs.filter((input) => /video|camera|capture|dshow|avfoundation|v4l2|vlc/i.test(input.kind || input.name))
  };
}

async function getControlProviderState() {
  if (config.controlProvider === "streamlabs-desktop") {
    const state = await discoverStreamlabsState();
    return {
      provider: "streamlabs-desktop",
      currentScene: state.currentScene,
      scenes: state.scenes,
      audioInputs: state.audioInputs,
      videoInputs: []
    };
  }

  if (!obsSocket || obsSocket.readyState !== WebSocket.OPEN || !obsIdentified) {
    await connectObs();
  }

  const state = await discoverObsState();
  return {
    provider: "obs",
    currentScene: state.currentScene,
    scenes: state.scenes,
    audioInputs: state.audioInputs,
    videoInputs: state.videoInputs
  };
}

function disconnectObs() {
  for (const pending of obsPendingRequests.values()) {
    pending.reject(new Error("OBS disconnected"));
  }
  obsPendingRequests.clear();

  if (obsSocket && obsSocket.readyState === WebSocket.OPEN) {
    obsSocket.close();
  }
  obsSocket = undefined;
  obsIdentified = false;
}

function handleObsMessage(socket, data) {
  const message = parseJson(data.toString());
  if (!message) return;

  if (message.op === 0) {
    const identify = { rpcVersion: 1 };
    const auth = message.d?.authentication;
    if (auth?.salt && auth?.challenge) {
      identify.authentication = createObsAuthentication(config.obs.password, auth.salt, auth.challenge);
    }
    socket.send(JSON.stringify({ op: 1, d: identify }));
    return;
  }

  if (message.op === 2) {
    obsIdentified = true;
    status("OBS", "connected", "OBS WebSocket ready");
    return;
  }

  if (message.op === 7) {
    const requestId = message.d?.requestId;
    const pending = obsPendingRequests.get(requestId);
    if (!pending) return;
    obsPendingRequests.delete(requestId);

    if (message.d?.requestStatus?.result) {
      pending.resolve(message.d?.responseData || {});
    } else {
      pending.reject(new Error(message.d?.requestStatus?.comment || "OBS request failed"));
    }
  }
}

function createObsAuthentication(password, salt, challenge) {
  const secret = crypto.createHash("sha256").update(`${password}${salt}`).digest("base64");
  return crypto.createHash("sha256").update(`${secret}${challenge}`).digest("base64");
}

async function obsRequest(requestType, requestData = {}) {
  if (!obsSocket || obsSocket.readyState !== WebSocket.OPEN || !obsIdentified) {
    throw new Error("OBS is not connected");
  }

  const requestId = `req-${++obsRequestId}`;
  const promise = new Promise((resolve, reject) => {
    obsPendingRequests.set(requestId, { resolve, reject });
    setTimeout(() => {
      if (obsPendingRequests.delete(requestId)) {
        reject(new Error(`${requestType} timed out`));
      }
    }, 8000);
  });

  obsSocket.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
  return promise;
}

async function runStreamDeckAction(action) {
  const deck = config.streamDeck;
  if (config.controlProvider === "streamlabs-desktop") {
    const streamlabsState = await discoverStreamlabsState();
    const actions = {
      switchScene: async () => {
        const sceneName = requireValue({ sceneName: deck.sceneName }, "Scene name").sceneName;
        const scene = streamlabsState.scenes.find((item) => item.name === sceneName) ||
          (await slobsCall("ScenesService", "getScenes")).find((item) => item.name === sceneName);
        if (!scene?.id) {
          throw new Error(`Streamlabs scene not found: ${sceneName}`);
        }
        await slobsCall("ScenesService", "makeSceneActive", [scene.id]);
        return { sceneName };
      },
      toggleMic: async () => {
        const inputName = requireValue({ inputName: deck.microphoneInput }, "Microphone input").inputName;
        const source = streamlabsState.audioInputs.find((item) => item.name === inputName || item.id === inputName || item.resourceId === inputName);
        if (!source?.resourceId) {
          throw new Error(`Streamlabs audio source not found: ${inputName}`);
        }
        await slobsCall(source.resourceId, "setMuted", [!source.muted]);
        return { inputName, muted: !source.muted };
      }
    };
    const handler = actions[action];
    if (!handler) {
      throw new Error("This deck action is not wired for Streamlabs Desktop yet");
    }
    const result = await handler();
    status("Streamlabs", "connected", `Ran ${action}`);
    return result;
  }

  const actions = {
    startStream: () => obsRequest("StartStream"),
    stopStream: () => obsRequest("StopStream"),
    startRecord: () => obsRequest("StartRecord"),
    stopRecord: () => obsRequest("StopRecord"),
    saveReplay: () => obsRequest("SaveReplayBuffer"),
    switchScene: () => obsRequest("SetCurrentProgramScene", requireValue({ sceneName: deck.sceneName }, "Scene name")),
    toggleMic: () => obsRequest("ToggleInputMute", requireValue({ inputName: deck.microphoneInput }, "Microphone input")),
    studioMode: () => obsRequest("ToggleStudioMode")
  };

  const handler = actions[action];
  if (!handler) {
    throw new Error(`Unknown stream deck action: ${action}`);
  }

  const result = await handler();
  status("OBS", "connected", `Ran ${action}`);
  return result;
}

async function setProviderScene(sceneName) {
  const targetName = String(sceneName || "").trim();
  if (!targetName) {
    throw new Error("Scene name is required");
  }

  if (config.controlProvider === "streamlabs-desktop") {
    const scenes = await slobsCall("ScenesService", "getScenes");
    const scene = (scenes || []).find((item) => item.name === targetName);
    if (!scene?.id) {
      throw new Error(`Streamlabs scene not found: ${targetName}`);
    }
    await slobsCall("ScenesService", "makeSceneActive", [scene.id]);
    status("Streamlabs", "connected", `Scene: ${targetName}`);
    return { sceneName: targetName };
  }

  await obsRequest("SetCurrentProgramScene", { sceneName: targetName });
  status("OBS", "connected", `Scene: ${targetName}`);
  return { sceneName: targetName };
}

async function toggleProviderAudio(inputName) {
  const targetName = String(inputName || "").trim();
  if (!targetName) {
    throw new Error("Audio input name is required");
  }

  if (config.controlProvider === "streamlabs-desktop") {
    const state = await discoverStreamlabsState();
    const source = state.audioInputs.find((item) => item.name === targetName || item.id === targetName || item.resourceId === targetName);
    if (!source?.resourceId) {
      throw new Error(`Streamlabs audio source not found: ${targetName}`);
    }
    await slobsCall(source.resourceId, "setMuted", [!source.muted]);
    status("Streamlabs", "connected", `${!source.muted ? "Muted" : "Unmuted"} ${targetName}`);
    return { inputName: targetName, muted: !source.muted };
  }

  const mute = await obsRequest("GetInputMute", { inputName: targetName });
  const nextMuted = !Boolean(mute?.inputMuted);
  await obsRequest("SetInputMute", { inputName: targetName, inputMuted: nextMuted });
  status("OBS", "connected", `${nextMuted ? "Muted" : "Unmuted"} ${targetName}`);
  return { inputName: targetName, muted: nextMuted };
}

function requireValue(value, label) {
  const key = Object.keys(value)[0];
  if (!String(value[key] || "").trim()) {
    throw new Error(`${label} is required`);
  }
  return value;
}

async function runModerationAction(action, target) {
  try {
    if (!target?.platform) {
      throw new Error("Select a message first");
    }

    if (target.platform === "youtube") {
      return await runYouTubeModerationAction(action, target);
    }

    if (target.platform === "kick") {
      return await runKickModerationAction(action, target);
    }

    if (target.platform !== "twitch") {
      throw new Error(`Moderation is not wired for ${target.platform} yet`);
    }

    const twitchOauth = getOAuthAccount("twitch");
    const hasTwitchApi = Boolean(String(twitchOauth.accessToken || "").trim() && String(twitchOauth.clientId || "").trim());
    if (hasTwitchApi) {
      const twitchApiResult = await tryTwitchApiModerationAction(action, target);
      status("Moderation", "connected", `${action} ${target.author}`);
      moderationNotice(action, target);
      return { action, author: target.author, channel: target.channel, via: "twitch-api" };
    }

    const credentials = await getTwitchModerationCredentials();
    const username = credentials.username;
    const token = credentials.token;
    if (!username || !token) {
      throw new Error("Sign in to Twitch in Accounts or add a Twitch moderator token in settings");
    }

    const channel = String(target.channel || "").replace(/^#/, "");
    const author = String(target.author || "").replace(/^@/, "");
    if (!channel || !author) {
      throw new Error("Selected message is missing channel or author");
    }

    const client = new tmi.Client({
      connection: { reconnect: false, secure: true },
      identity: { username, password: token.startsWith("oauth:") ? token : `oauth:${token}` },
      channels: [channel]
    });

    await client.connect();
    try {
      if (action === "timeout") {
        await client.timeout(channel, author, config.moderation.timeoutSeconds, config.moderation.reason);
      } else if (action === "ban") {
        await client.ban(channel, author, config.moderation.reason);
      } else if (action === "delete") {
        if (!target.platformMessageId) {
          throw new Error("Selected Twitch message does not include a message id");
        }
        await client.say(channel, `/delete ${target.platformMessageId}`);
      } else {
        throw new Error(`Unknown moderation action: ${action}`);
      }
    } finally {
      await client.disconnect().catch(() => {});
    }

    status("Moderation", "connected", `${action} ${author}`);
    moderationNotice(action, target);
    return { action, author, channel };
  } catch (error) {
    status("Moderation", "error", cleanError(error));
    moderationFailureNotice(action, target, error);
    throw error;
  }
}

async function runYouTubeModerationAction(action, target) {
  if (config.youtubeAuthMode !== "browser") {
    const apiResult = await tryYouTubeApiModerationAction(action, target).catch((error) => {
      debugLog(`YouTube API moderation failed ${cleanError(error)}`);
      return { error };
    });

    if (!apiResult?.error) {
      status("Moderation", "connected", `${action} ${target.author} on YouTube`);
      moderationNotice(action, target);
      return { action, author: target.author, channel: target.channel, via: "youtube-api" };
    }

    if (config.youtubeAuthMode === "oauth") {
      const auth = await getBrowserAuthSummary("youtube");
      if (!auth.signedIn) {
        throw apiResult.error || new Error("Login to YouTube in Accounts first");
      }
    }

    if (config.youtubeAuthMode === "oauth" && !["quotaExceeded", "quota exceeded"].some((token) => cleanError(apiResult.error).toLowerCase().includes(token))) {
      throw apiResult.error;
    }
  }

  const liveId = target?.moderationContext?.liveId || target.channel;
  if (!liveId) {
    throw new Error("Selected YouTube message is missing the live video id");
  }

  const auth = await getBrowserAuthSummary("youtube");
  if (!auth.signedIn) {
    throw new Error("Sign in to YouTube browser fallback in Accounts first");
  }

  const moderationUrl = `https://www.youtube.com/live_chat?v=${encodeURIComponent(liveId)}&is_popout=1`;
  const window = await getModerationWindow(`youtube:${liveId}`, moderationUrl);
  await ensureModerationWindowReady(window, "youtube");
  const payload = {
    action,
    author: target.author,
    messageId: target.platformMessageId,
    authorChannelId: target.platformAuthorId,
    text: target.text || "",
    timeoutSeconds: 300
  };

  const result = await window.webContents.executeJavaScript(`
    (async () => {
      const payload = ${JSON.stringify(payload)};
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const targetText = normalize(payload.text);
      const targetAuthor = normalize(payload.author);
      const targetWords = targetText.split(/\\s+/).filter((word) => word.length >= 3).slice(0, 8);
      const selectors = 'yt-live-chat-text-message-renderer, yt-live-chat-paid-message-renderer, yt-live-chat-membership-item-renderer';
      const findMatchNode = () => {
        const messageNodes = [...document.querySelectorAll(selectors)];
        return messageNodes.find((node) => {
          const nodeId = node.getAttribute('id');
          const authorId = node.getAttribute('author-external-channel-id') || node.data?.authorExternalChannelId;
          const text = normalize(node.innerText || node.textContent || '');
          const author = normalize(node.querySelector('#author-name')?.textContent?.trim() || '');
          const textMatch = !targetText ||
            text.includes(targetText) ||
            targetWords.filter((word) => text.includes(word)).length >= Math.min(2, targetWords.length || 0);
          return (payload.messageId && nodeId === payload.messageId) ||
            ((payload.authorChannelId && authorId === payload.authorChannelId) && textMatch) ||
            (author === targetAuthor && textMatch);
        });
      };

      let matchNode;
      for (let phase = 0; phase < 2 && !matchNode; phase += 1) {
        for (let attempt = 0; attempt < 24; attempt += 1) {
          matchNode = findMatchNode();
          if (matchNode) {
            break;
          }
          const app = document.querySelector('yt-live-chat-app');
          const scroller = document.querySelector('#item-scroller, #items, yt-live-chat-item-list-renderer #items');
          app?.dispatchEvent(new Event('scroll', { bubbles: true }));
          if (scroller && 'scrollTop' in scroller) {
            scroller.scrollTop = scroller.scrollHeight;
          }
          await wait(250);
        }
        if (!matchNode) {
          await wait(900);
        }
      }
      if (!matchNode) {
        return { ok: false, error: 'Matching YouTube chat message was not found in the live chat window.' };
      }

      const clickNode = (node) => {
        if (!node) return false;
        const target = node.closest?.('button, tp-yt-paper-item, ytd-menu-service-item-renderer, [role="menuitem"], [role="button"]') || node;
        try {
          target.scrollIntoView?.({ block: 'center', inline: 'nearest' });
        } catch {}
        for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
          try {
            target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window }));
          } catch {}
        }
        try {
          target.click?.();
        } catch {}
        return true;
      };

      const hoverNode = (node) => {
        if (!node) return;
        const rect = node.getBoundingClientRect();
        const x = Math.max(rect.left + 8, rect.right - 18);
        const y = rect.top + Math.max(8, Math.min(rect.height - 8, rect.height / 2));
        for (const type of ['pointerenter', 'mouseenter', 'mouseover', 'pointermove', 'mousemove']) {
          try {
            node.dispatchEvent(new MouseEvent(type, {
              bubbles: true,
              cancelable: true,
              composed: true,
              view: window,
              clientX: x,
              clientY: y
            }));
          } catch {}
        }
      };

      const getMenuItems = () => [...document.querySelectorAll(
        'tp-yt-paper-listbox ytd-menu-service-item-renderer,' +
        ' tp-yt-paper-listbox tp-yt-paper-item,' +
        ' ytd-menu-popup-renderer tp-yt-paper-item,' +
        ' ytd-menu-popup-renderer ytd-menu-service-item-renderer,' +
        ' tp-yt-iron-dropdown [role="menuitem"],' +
        ' tp-yt-paper-dialog tp-yt-paper-item,' +
        ' yt-list-item-view-model,' +
        ' [role="option"]'
      )];
      const menuText = (entry) => normalize(
        entry?.innerText ||
        entry?.textContent ||
        entry?.getAttribute?.('aria-label') ||
        entry?.getAttribute?.('title') ||
        ''
      );
      const actionMap = {
        delete: ['remove', 'delete', 'retract'],
        ban: ['ban'],
        timeout: ['put user in timeout', 'timeout', '5 minute timeout', 'place in timeout']
      };
      const labels = actionMap[payload.action] || [payload.action];
      const isWrongMenu = (items) => {
        const joined = items.map((entry) => menuText(entry)).filter(Boolean).join(' | ');
        return joined.includes('top chat') || joined.includes('live chat all messages are visible') || joined.includes('go to channel');
      };
      const switchToLiveChatFromWrongMenu = async (items) => {
        const liveItem = items.find((entry) => {
          const text = menuText(entry);
          return text.includes('live chat') && text.includes('all messages');
        });
        if (liveItem) {
          clickNode(liveItem);
          await wait(260);
          return true;
        }
        return false;
      };
      const closeMenus = async () => {
        try {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
        } catch {}
        try {
          document.body?.click?.();
        } catch {}
        await wait(180);
      };
      const findMessageMenuButton = () => {
        const hostRect = matchNode.getBoundingClientRect();
        const candidates = [...matchNode.querySelectorAll('#menu button, #menu-button button, #menu yt-icon-button, #menu-button yt-icon-button, button[aria-label*="More"], button[aria-label*="Action"], button[aria-haspopup="true"], yt-icon-button[aria-label*="More"], yt-icon-button[aria-label*="Action"]')]
          .map((button) => ({ button, rect: button.getBoundingClientRect() }))
          .filter(({ rect }) => rect.width >= 12 && rect.height >= 12 && rect.right > hostRect.left && rect.left < hostRect.right && rect.top >= hostRect.top - 8 && rect.bottom <= hostRect.bottom + 8)
          .sort((a, b) => {
            const center = hostRect.top + (hostRect.height / 2);
            const scoreA = (a.rect.right - hostRect.left) - Math.abs((a.rect.top + (a.rect.height / 2)) - center);
            const scoreB = (b.rect.right - hostRect.left) - Math.abs((b.rect.top + (b.rect.height / 2)) - center);
            return scoreB - scoreA;
          });
        return candidates[0]?.button || null;
      };

      const findMenuButtonByPoint = () => {
        const rect = matchNode.getBoundingClientRect();
        const pointX = Math.max(rect.left + 8, rect.right - 16);
        const pointY = rect.top + Math.max(8, Math.min(rect.height - 8, rect.height / 2));
        const hit = document.elementFromPoint(pointX, pointY);
        const button = hit?.closest?.('button, [role="button"], yt-icon-button');
        if (!button) return null;
        if (!matchNode.contains(button) && button !== matchNode) return null;
        const buttonRect = button.getBoundingClientRect();
        if (buttonRect.width < 12 || buttonRect.height < 12) return null;
        return button;
      };

      await closeMenus();
      hoverNode(matchNode);
      await wait(180);

      let item = null;
      for (let openAttempt = 0; openAttempt < 3 && !item; openAttempt += 1) {
        const menuButton = findMenuButtonByPoint() || findMessageMenuButton();
        if (!menuButton) {
          hoverNode(matchNode);
          await wait(220);
          continue;
        }

        clickNode(menuButton);
        await wait(420);

        let items = [];
        for (let attempt = 0; attempt < 4; attempt += 1) {
          items = getMenuItems();
          item = items.find((entry) => {
            const text = menuText(entry);
            return text && labels.some((label) => text.includes(label));
          });
          if (item) {
            break;
          }
          if (isWrongMenu(items)) {
            await switchToLiveChatFromWrongMenu(items);
            break;
          }
          await wait(220);
        }

        if (item) {
          break;
        }

        await closeMenus();
        hoverNode(matchNode);
        await wait(200);
      }

      if (!item) {
        const available = getMenuItems()
          .map((entry) => menuText(entry))
          .filter(Boolean)
          .slice(0, 8)
          .join(' | ');
        if (available) {
          await closeMenus();
        }
        return { ok: false, error: 'That YouTube moderation action is not available in the current chat menu.' + (available ? ' Available: ' + available : '') };
      }

      clickNode(item);
      await wait(450);

      if (payload.action === 'timeout' || payload.action === 'ban') {
        if (payload.action === 'timeout') {
          const timeoutChoice = [...document.querySelectorAll('tp-yt-paper-listbox tp-yt-paper-item, tp-yt-paper-dialog tp-yt-paper-item, ytd-menu-service-item-renderer, [role="option"]')]
            .find((entry) => {
              const text = normalize(entry.innerText || entry.textContent || '');
              return text && !text.includes('cancel') && (
                text.includes('5 minute') ||
                text.includes('300 second') ||
                text === '5m'
              );
            });
          if (timeoutChoice) {
            timeoutChoice.click();
            await wait(250);
          }
        }

        const confirmLabels = payload.action === 'timeout'
          ? ['timeout', 'put user in timeout', 'confirm', 'apply']
          : ['hide', 'ban', 'remove', 'confirm'];
        const confirmButton = [...document.querySelectorAll('yt-button-renderer button, tp-yt-paper-dialog button, button, [role="button"]')]
          .find((button) => {
            const text = normalize(button.innerText || button.textContent || '');
            return text && confirmLabels.some((label) => text.includes(label)) && !text.includes('cancel');
          });
        if (confirmButton) {
          confirmButton.click();
          await wait(500);
        }
      }
      return { ok: true };
    })()
  `, true);

  if (!result?.ok) {
    throw new Error(result?.error || "YouTube moderation failed");
  }

  status("Moderation", "connected", `${action} ${target.author} on YouTube`);
  moderationNotice(action, target);
  return { action, author: target.author, channel: target.channel };
}

async function tryTwitchApiModerationAction(action, target) {
  const oauth = getOAuthAccount("twitch");
  const accessToken = String(oauth.accessToken || "").trim();
  const clientId = String(oauth.clientId || "").trim();
  if (!accessToken || !clientId) {
    return null;
  }

  const moderator = await validateTwitchToken(accessToken);
  const channelLogin = String(target.channel || "").replace(/^#/, "").trim().toLowerCase();
  const authorId = String(target.platformAuthorId || "").trim();
  const ids = await fetchTwitchUserIds([channelLogin, String(target.author || "").trim().toLowerCase()].filter(Boolean), accessToken, clientId);
  const broadcasterId = ids.get(channelLogin)?.id;
  const targetUserId = authorId || ids.get(String(target.author || "").trim().toLowerCase())?.id;
  if (!broadcasterId) {
    throw new Error("Twitch broadcaster ID was not found");
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Client-Id": clientId,
    Accept: "application/json"
  };

  if (action === "delete") {
    if (!target.platformMessageId) {
      throw new Error("Selected Twitch message does not include a message id");
    }
    await axios.delete("https://api.twitch.tv/helix/moderation/chat", {
      headers,
      params: {
        broadcaster_id: broadcasterId,
        moderator_id: moderator.userId || moderator.user_id,
        message_id: target.platformMessageId
      }
    });
    return { ok: true };
  }

  if (!targetUserId) {
    throw new Error("Twitch target user ID was not found");
  }

  if (action === "ban" || action === "timeout") {
    const body = {
      data: {
        user_id: targetUserId
      }
    };
    if (config.moderation.reason) {
      body.data.reason = String(config.moderation.reason).slice(0, 500);
    }
    if (action === "timeout") {
      body.data.duration = Math.max(1, Number(config.moderation.timeoutSeconds) || 60);
    }
    await axios.post("https://api.twitch.tv/helix/moderation/bans", body, {
      headers,
      params: {
        broadcaster_id: broadcasterId,
        moderator_id: moderator.userId || moderator.user_id
      }
    });
    return { ok: true };
  }

  return null;
}

async function fetchTwitchUserIds(logins, accessToken, clientId) {
  const uniqueLogins = [...new Set((logins || []).map((item) => String(item || "").trim().toLowerCase()).filter(Boolean))];
  const result = new Map();
  if (!uniqueLogins.length) {
    return result;
  }

  const query = uniqueLogins.map((login) => `login=${encodeURIComponent(login)}`).join("&");
  const response = await axios.get(`https://api.twitch.tv/helix/users?${query}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Client-Id": clientId,
      Accept: "application/json"
    }
  });

  for (const user of response.data?.data || []) {
    result.set(String(user.login || "").toLowerCase(), {
      id: String(user.id || ""),
      login: String(user.login || "")
    });
  }

  return result;
}

async function tryYouTubeApiModerationAction(action, target) {
  const account = getOAuthAccount("youtube");
  const accessToken = String(account.accessToken || "").trim();
  if (!accessToken) {
    throw new Error("Login to YouTube in Accounts first");
  }

  if (action !== "delete" && action !== "timeout") {
    throw new Error(`YouTube ${action} is not supported in the current app flow`);
  }

  if (action === "delete") {
    if (!target.platformMessageId) {
      throw new Error("Selected YouTube message does not include a message id");
    }
    await axios.delete("https://www.googleapis.com/youtube/v3/liveChat/messages", {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { id: target.platformMessageId }
    });
    return { ok: true };
  }

  const liveId = String(target?.moderationContext?.liveId || target.channel || "").trim();
  if (!liveId) {
    throw new Error("Selected YouTube message is missing the live video id");
  }
  if (!target.platformAuthorId) {
    throw new Error("Selected YouTube message is missing the author channel id");
  }

  const liveChatId = await fetchYouTubeActiveLiveChatId(liveId, accessToken);
  await axios.post("https://www.googleapis.com/youtube/v3/liveChat/bans?part=snippet", {
    snippet: {
      liveChatId,
      type: "temporary",
      bannedUserDetails: {
        channelId: target.platformAuthorId
      },
      banDurationSeconds: 300
    }
  }, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    }
  });
  return { ok: true };
}

async function fetchYouTubeActiveLiveChatId(liveId, accessToken) {
  const response = await axios.get("https://www.googleapis.com/youtube/v3/videos", {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    params: {
      part: "liveStreamingDetails",
      id: liveId
    }
  });

  const item = response.data?.items?.[0];
  const liveChatId = item?.liveStreamingDetails?.activeLiveChatId;
  if (!liveChatId) {
    throw new Error("YouTube active live chat ID was not found");
  }
  return liveChatId;
}

async function runKickModerationAction(action, target) {
  const channel = String(target.channel || "").trim();
  const author = String(target.author || "").trim();
  if (!channel || !author) {
    throw new Error("Selected Kick message is missing channel or author");
  }

  if (action === "delete") {
    throw new Error("Kick delete is not supported in the current app build");
  }

  if (action === "ban" || action === "timeout") {
    const apiResult = await tryKickApiModerationAction(action, target);
    if (!apiResult) {
      throw new Error("Login to Kick API in Accounts first for timeout and ban");
    }
    status("Moderation", "connected", `${action} ${target.author} on Kick`);
    moderationNotice(action, target);
    return { action, author: target.author, channel: target.channel, via: "kick-api" };
  }

  throw new Error(`Kick ${action} is not supported in the current app build`);
}

async function tryKickApiModerationAction(action, target) {
  const account = getOAuthAccount("kick");
  const accessToken = String(account.accessToken || "").trim();
  const scopes = Array.isArray(account.scopes) ? account.scopes : [];
  if (!accessToken || !scopes.includes("moderation:ban")) {
    return null;
  }

  const targetUserId = Number(target.platformAuthorId || target?.moderationContext?.userId || 0);
  if (!targetUserId) {
    return null;
  }

  const details = await fetchKickChannelDetails(String(target.channel || "").trim());
  const broadcasterUserId = Number(details.userId || 0);
  if (!broadcasterUserId) {
    return null;
  }

  const body = {
    broadcaster_user_id: broadcasterUserId,
    user_id: targetUserId
  };

  if (action === "timeout") {
    body.duration = Math.max(1, Math.ceil((Number(config.moderation.timeoutSeconds) || 60) / 60));
    if (config.moderation.reason) {
      body.reason = String(config.moderation.reason).slice(0, 100);
    }
  } else if (action === "ban") {
    if (config.moderation.reason) {
      body.reason = String(config.moderation.reason).slice(0, 100);
    }
  } else {
    return null;
  }

  const response = await axios.post("https://api.kick.com/public/v1/moderation/bans", body, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    }
  });

  return response.data || { ok: true };
}

async function getModerationWindow(key, url) {
  let win = moderationWindows.get(key);
  if (win && !win.isDestroyed()) {
    if (win.webContents.getURL() !== url) {
      await win.loadURL(url);
      await waitForWindowLoad(win);
      win.__moderationWarm = false;
    }
    return win;
  }

  win = new BrowserWindow({
    width: 1100,
    height: 820,
    show: false,
    title: "Moderation helper",
    icon: getAssetPath("icon.ico"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  moderationWindows.set(key, win);
  win.__moderationWarm = false;
  win.on("closed", () => {
    if (moderationWindows.get(key) === win) {
      moderationWindows.delete(key);
    }
  });
  await win.loadURL(url);
  await waitForWindowLoad(win);
  return win;
}

async function ensureModerationWindowReady(win, platform) {
  if (win.isDestroyed()) {
    throw new Error("Moderation helper window is no longer available");
  }

  if (win.__moderationWarm) {
    return;
  }

  const script = platform === "youtube"
    ? `
      (async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
        const clickNode = (node) => {
          if (!node) return false;
          try {
            node.scrollIntoView?.({ block: 'center', inline: 'nearest' });
          } catch {}
          for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
            try {
              node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window }));
            } catch {}
          }
          try {
            node.click?.();
          } catch {}
          return true;
        };

        const switchToLiveChat = async () => {
          const liveItem = [...document.querySelectorAll('tp-yt-paper-listbox tp-yt-paper-item, ytd-menu-popup-renderer tp-yt-paper-item, [role="menuitem"], [role="option"]')]
            .find((entry) => {
              const text = normalize(entry.innerText || entry.textContent || entry.getAttribute?.('aria-label') || '');
              return text.includes('live chat') && text.includes('all messages');
            });
          if (liveItem) {
            clickNode(liveItem);
            await wait(250);
            return true;
          }
          return false;
        };

        for (let attempt = 0; attempt < 24; attempt += 1) {
          const app = document.querySelector('yt-live-chat-app');
          const items = document.querySelectorAll('yt-live-chat-text-message-renderer, yt-live-chat-paid-message-renderer, yt-live-chat-membership-item-renderer');
          if (app && items.length) {
            const buttons = [...document.querySelectorAll('button, [role="button"]')];
            const topChatButton = buttons.find((entry) => {
              const text = normalize(entry.innerText || entry.textContent || entry.getAttribute?.('aria-label') || '');
              return text === 'top chat' || text.startsWith('top chat ');
            });
            if (topChatButton) {
              clickNode(topChatButton);
              await wait(250);
              await switchToLiveChat();
            }
            return true;
          }
          await wait(250);
        }
        return false;
      })()
    `
    : `
      (async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        for (let attempt = 0; attempt < 24; attempt += 1) {
          const chatTab = [...document.querySelectorAll('button, a, [role="tab"], [role="button"]')]
            .find((entry) => /(^|\\s)chat(\\s|$)/i.test((entry.innerText || entry.textContent || '').trim()));
          if (chatTab) {
            chatTab.click?.();
          }
          const hasInput = !!document.querySelector('textarea, input[placeholder*="Send"], [contenteditable="true"]');
          const hasMessages = document.querySelectorAll('[data-chat-entry], [data-message-id], [data-message-id-wrapper], [class*="chat-message"], [class*="messageRow"], [class*="message-row"], [class*="chat-entry"]').length > 0;
          if (hasInput || hasMessages) return true;
          await wait(250);
        }
        return false;
      })()
    `;

  await win.webContents.executeJavaScript(script, true).catch(() => false);
  win.__moderationWarm = true;
}

async function waitForWindowLoad(win) {
  if (!win || win.isDestroyed()) {
    throw new Error("Moderation window is unavailable");
  }

  if (!win.webContents.isLoadingMainFrame()) {
    await delay(1200);
    return;
  }

  await new Promise((resolve) => {
    win.webContents.once("did-finish-load", resolve);
  });
  await delay(1200);
}

async function getTwitchModerationCredentials() {
  const configuredToken = String(config.moderation.twitchOAuthToken || "").trim();
  const configuredUsername = String(config.moderation.twitchUsername || "").trim();
  if (configuredToken && configuredUsername) {
    return {
      username: configuredUsername,
      token: configuredToken.startsWith("oauth:") ? configuredToken.slice(6) : configuredToken
    };
  }

  const oauthToken = String(getOAuthAccount("twitch").accessToken || "").trim();
  if (oauthToken) {
    const profile = await validateTwitchToken(oauthToken);
    return {
      username: configuredUsername || profile.login || "",
      token: oauthToken
    };
  }

  const sessionToken = await getTwitchSessionToken();
  if (sessionToken) {
    const profile = await validateTwitchToken(sessionToken);
    if (profile.login && !config.moderation.twitchUsername) {
      config.moderation.twitchUsername = profile.login;
      saveAndBroadcastConfig();
    }
    return {
      username: configuredUsername || profile.login || "",
      token: sessionToken
    };
  }

  return { username: configuredUsername, token: configuredToken };
}

async function getTwitchSessionToken() {
  const cookies = await session.defaultSession.cookies.get({ url: "https://www.twitch.tv" });
  const tokenCookie = cookies.find((cookie) => cookie.name === "auth-token" && cookie.value);
  return tokenCookie?.value || "";
}

async function validateTwitchToken(token) {
  const response = await axios.get("https://id.twitch.tv/oauth2/validate", {
    headers: { Authorization: `OAuth ${token}` }
  });
  return response.data || {};
}

function cleanError(error) {
  if (!error) {
    return "Unknown error";
  }

  if (typeof error === "string") {
    return error;
  }

  const responseData = error?.response?.data;
  if (typeof responseData === "string" && responseData.trim()) {
    return responseData;
  }

  if (responseData && typeof responseData === "object") {
    const parts = [
      responseData.error,
      responseData.error_description,
      responseData.message,
      responseData.status,
      responseData.error?.message
    ].filter((value) => typeof value === "string" && value.trim());
    if (parts.length) {
      return parts.join(" | ");
    }

    try {
      return JSON.stringify(responseData);
    } catch {
    }
  }

  if (error?.message) {
    return error.message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function normalizeVersionString(value) {
  return String(value || "").trim().replace(/^v/i, "");
}

function compareVersions(left, right) {
  const leftParts = normalizeVersionString(left).split(/[.-]/).map((part) => Number.parseInt(part, 10)).filter((part) => Number.isFinite(part));
  const rightParts = normalizeVersionString(right).split(/[.-]/).map((part) => Number.parseInt(part, 10)).filter((part) => Number.isFinite(part));
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const a = leftParts[index] || 0;
    const b = rightParts[index] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }

  return 0;
}

function summarizeReleaseBody(body) {
  const lines = String(body || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6);

  if (!lines.length) {
    return "";
  }

  return lines.join("\n");
}

function pickReleaseDownloadUrl(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const exeAsset = assets.find((asset) => /\.exe$/i.test(String(asset?.name || "")) && /setup|installer/i.test(String(asset?.name || "")));
  if (exeAsset?.browser_download_url) {
    return exeAsset.browser_download_url;
  }

  const anyExe = assets.find((asset) => /\.exe$/i.test(String(asset?.name || "")));
  if (anyExe?.browser_download_url) {
    return anyExe.browser_download_url;
  }

  return release?.html_url || GITHUB_RELEASES_PAGE;
}

async function fetchLatestReleaseInfo() {
  const response = await axios.get(GITHUB_LATEST_RELEASE_API, {
    timeout: 12000,
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "PCVR-StreamChat"
    }
  });

  return response.data || {};
}

async function checkForAppUpdates({ manual = false } = {}) {
  if (!manual && !app.isPackaged) {
    return { skipped: true, reason: "dev-build" };
  }

  try {
    const release = await fetchLatestReleaseInfo();
    const currentVersion = normalizeVersionString(app.getVersion());
    const latestVersion = normalizeVersionString(release.tag_name || release.name || "");

    if (!latestVersion) {
      if (manual) {
        await dialog.showMessageBox(mainWindow, {
          type: "info",
          buttons: ["OK"],
          defaultId: 0,
          title: "Updates",
          message: "Could not determine the latest release version."
        });
      }
      return { available: false, reason: "no-latest-version" };
    }

    if (compareVersions(latestVersion, currentVersion) <= 0) {
      if (manual) {
        await dialog.showMessageBox(mainWindow, {
          type: "info",
          buttons: ["OK"],
          defaultId: 0,
          title: "Updates",
          message: `PCVR StreamChat is up to date.`,
          detail: `Current version: ${currentVersion}`
        });
      }
      return { available: false, currentVersion, latestVersion };
    }

    const downloadUrl = pickReleaseDownloadUrl(release);
    const notes = summarizeReleaseBody(release.body);
    const result = await dialog.showMessageBox(mainWindow, {
      type: "info",
      buttons: ["Update now", "Later"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: "Update available",
      message: `PCVR StreamChat ${latestVersion} is available.`,
      detail: [
        `Current version: ${currentVersion}`,
        `Latest version: ${latestVersion}`,
        notes ? "" : null,
        notes || null
      ].filter(Boolean).join("\n")
    });

    if (result.response === 0) {
      await shell.openExternal(downloadUrl);
      return { available: true, opened: true, currentVersion, latestVersion, downloadUrl };
    }

    return { available: true, opened: false, currentVersion, latestVersion, downloadUrl };
  } catch (error) {
    debugLog(`update check failed ${cleanError(error)}`);
    if (manual) {
      await dialog.showMessageBox(mainWindow, {
        type: "error",
        buttons: ["OK"],
        defaultId: 0,
        title: "Update check failed",
        message: "PCVR StreamChat could not check for updates right now.",
        detail: cleanError(error)
      });
    }
    return { available: false, error: cleanError(error) };
  }
}

ipcMain.handle("config:get", () => config);
ipcMain.handle("app:version", () => app.getVersion());
ipcMain.handle("status:get", () => [...statusCache.values()]);
ipcMain.handle("updates:check", () => checkForAppUpdates({ manual: true }));
ipcMain.handle("youtube:cookie-status", () => getYouTubeCookieSummary());
ipcMain.handle("youtube:sign-in", () => {
  openYouTubeSignInWindow();
  return getYouTubeCookieSummary();
});
ipcMain.handle("auth:status", async (_event, platform) => getBrowserAuthSummary(String(platform || "")));
ipcMain.handle("auth:sign-in", async (_event, platform) => openBrowserSignInWindow(String(platform || "")));
ipcMain.handle("auth:logout", async (_event, platform) => clearBrowserAuth(String(platform || "")));
ipcMain.handle("oauth:login", async (_event, platform) => beginOAuthLogin(String(platform || "")));
ipcMain.handle("oauth:logout", async (_event, platform) => logoutOAuth(String(platform || "")));
ipcMain.handle("oauth:status", async (_event, platform) => getOAuthStatus(String(platform || "")));
ipcMain.handle("config:save", async (_event, value) => {
  config = normalizeConfig(value);
  saveConfig();
  mainWindow?.setOpacity(config.opacity);
  mainWindow?.setAlwaysOnTop(config.alwaysOnTop, "screen-saver");
  config.clickThrough = false;
  setClickThrough(false);
  await restartConnectors();
  await restartOpenVrOverlay();
  await restartSuiteServices();
  return config;
});

ipcMain.handle("alerts:test", (_event, value) => triggerAlert(value));
ipcMain.handle("alerts:url", () => getAlertBrowserSourceUrl());
ipcMain.handle("alerts:primary", () => {
  if (config.alerts.mode === "streamlabs" && config.alerts.streamlabsAlertUrl) {
    return {
      mode: "streamlabs",
      label: "Streamlabs Alert Box",
      url: config.alerts.streamlabsAlertUrl
    };
  }

  return {
    mode: "custom",
    label: "App browser source",
    url: getAlertBrowserSourceUrl()
  };
});
ipcMain.handle("obs:connect", () => connectControlProvider());
ipcMain.handle("obs:disconnect", () => disconnectControlProvider());
ipcMain.handle("obs:action", async (_event, action) => runStreamDeckAction(action));
ipcMain.handle("provider:state", async () => getControlProviderState());
ipcMain.handle("provider:set-scene", async (_event, sceneName) => setProviderScene(sceneName));
ipcMain.handle("provider:toggle-audio", async (_event, inputName) => toggleProviderAudio(inputName));
ipcMain.handle("moderation:action", async (_event, action, target) => runModerationAction(action, target));

ipcMain.handle("openvr:toggle", async () => {
  config.openVrOverlay.enabled = !config.openVrOverlay.enabled;
  saveAndBroadcastConfig();
  mainWindow?.setOpacity(config.opacity);
  mainWindow?.setAlwaysOnTop(config.alwaysOnTop, "screen-saver");
  config.clickThrough = false;
  setClickThrough(false);
  await restartOpenVrOverlay();
  if (config.openVrOverlay.enabled) {
    await delay(80);
    openVrFrameDirty = true;
    await writeOpenVrFrame().catch((error) => debugLog(`Toggle OpenVR frame write failed ${cleanError(error)}`));
  }
  return config;
});

ipcMain.handle("overlay:set-click-through", (_event, enabled) => {
  setClickThrough(enabled);
  return clickThrough;
});

ipcMain.handle("overlay:toggle-click-through", () => toggleClickThrough());

ipcMain.handle("overlay:set-always-on-top", (_event, enabled) => {
  config.alwaysOnTop = Boolean(enabled);
  mainWindow?.setAlwaysOnTop(config.alwaysOnTop, "screen-saver");
  saveConfig();
  return config.alwaysOnTop;
});

ipcMain.handle("overlay:open-external", (_event, url) => shell.openExternal(url));
ipcMain.handle("window:minimize", () => mainWindow?.minimize());
ipcMain.handle("window:close", () => mainWindow?.hide());

app.whenReady().then(async () => {
  debugLog("app ready");
  loadConfig();
  debugLog("config loaded");
  await createWindow();
  debugLog("window created");
  createTray();
  registerClickThroughHotkeys();
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.setOpacity(config.opacity);
  await restartConnectors();
  debugLog("connectors restarted");
  await restartOpenVrOverlay();
  await restartSuiteServices();
  debugLog("startup complete");
  if (config.updates?.checkOnStartup !== false) {
    setTimeout(() => {
      checkForAppUpdates().catch((error) => debugLog(`startup update check failed ${cleanError(error)}`));
    }, 1800);
  }
}).catch((error) => debugLog(`startup failed ${cleanError(error)} ${error?.stack || ""}`));

function registerClickThroughHotkeys() {
  const accelerators = ["CommandOrControl+Shift+V", "CommandOrControl+Alt+V", "F8"];
  const registered = accelerators.filter((accelerator) => globalShortcut.register(accelerator, () => toggleClickThrough()));

  if (registered.length) {
    debugLog(`Mouse input unlock hotkeys: ${registered.join(", ")}`);
  } else {
    debugLog("No click-through hotkeys registered. Use the tray menu to unlock mouse input.");
  }
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async () => {
  globalShortcut.unregisterAll();
  oauthCallbackServer?.close();
  for (const win of moderationWindows.values()) {
    try {
      win.destroy();
    } catch {
    }
  }
  moderationWindows.clear();
  await stopOpenVrOverlay();
  for (const connector of activeConnectors) {
    await connector.stop().catch(() => {});
  }
});
