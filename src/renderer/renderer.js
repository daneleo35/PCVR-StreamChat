const messages = document.getElementById("messages");
const statusStrip = document.getElementById("statusStrip");
const settingsPanel = document.getElementById("settingsPanel");
const overlay = document.getElementById("overlay");
const emptyChat = document.getElementById("emptyChat");
const captureSurface = document.getElementById("captureSurface");
const messageActions = document.getElementById("messageActions");
const messageActionsTitle = document.getElementById("messageActionsTitle");
const messageActionsDetail = document.getElementById("messageActionsDetail");
const alertBrowserUrl = document.getElementById("alertBrowserUrl");
const alertProviderHint = document.getElementById("alertProviderHint");
const alertModeHint = document.getElementById("alertModeHint");
const alertPreview = document.getElementById("alertPreview");
const vrAlertLayer = document.getElementById("vrAlertLayer");
const vrAlertFrame = document.getElementById("vrAlertFrame");
const controlProviderHint = document.getElementById("controlProviderHint");
const streamCurrentScene = document.getElementById("streamCurrentScene");
const streamScenesList = document.getElementById("streamScenesList");
const streamAudioHint = document.getElementById("streamAudioHint");
const streamAudioList = document.getElementById("streamAudioList");
const statusTrack = document.createElement("div");
statusTrack.className = "status-track";
statusStrip.append(statusTrack);

const fields = {
  twitchChannels: document.getElementById("twitchChannels"),
  youtubeLiveIds: document.getElementById("youtubeLiveIds"),
  kickChannels: document.getElementById("kickChannels"),
  opacity: document.getElementById("opacity"),
  fontScale: document.getElementById("fontScale"),
  compactMode: document.getElementById("compactMode"),
  showBadges: document.getElementById("showBadges"),
  showTimestamps: document.getElementById("showTimestamps"),
  alwaysOnTop: document.getElementById("alwaysOnTop"),
  updatesCheckOnStartup: document.getElementById("updatesCheckOnStartup"),
  youtubeAuthMode: document.getElementById("youtubeAuthMode"),
  alertsEnabled: document.getElementById("alertsEnabled"),
  alertPort: document.getElementById("alertPort"),
  alertDuration: document.getElementById("alertDuration"),
  alertMode: document.getElementById("alertMode"),
  streamlabsAlertUrl: document.getElementById("streamlabsAlertUrl"),
  alertOverlayPosition: document.getElementById("alertOverlayPosition"),
  alertOverlayScale: document.getElementById("alertOverlayScale"),
  controlProvider: document.getElementById("controlProvider"),
  obsHost: document.getElementById("obsHost"),
  obsPort: document.getElementById("obsPort"),
  obsPassword: document.getElementById("obsPassword"),
  obsAutoConnect: document.getElementById("obsAutoConnect"),
  twitchOAuthClientId: document.getElementById("twitchOAuthClientId"),
  twitchOAuthClientSecret: document.getElementById("twitchOAuthClientSecret"),
  youtubeOAuthClientId: document.getElementById("youtubeOAuthClientId"),
  youtubeOAuthClientSecret: document.getElementById("youtubeOAuthClientSecret"),
  kickOAuthClientId: document.getElementById("kickOAuthClientId"),
  kickOAuthClientSecret: document.getElementById("kickOAuthClientSecret"),
  modTwitchUser: document.getElementById("modTwitchUser"),
  modTwitchToken: document.getElementById("modTwitchToken"),
  modTimeout: document.getElementById("modTimeout"),
  modReason: document.getElementById("modReason"),
  openVrEnabled: document.getElementById("openVrEnabled"),
  openVrWorldGrab: document.getElementById("openVrWorldGrab"),
  openVrWorldLocked: document.getElementById("openVrWorldLocked"),
  openVrAnchor: document.getElementById("openVrAnchor"),
  openVrPreset: document.getElementById("openVrPreset"),
  openVrWidth: document.getElementById("openVrWidth"),
  openVrAlpha: document.getElementById("openVrAlpha"),
  openVrX: document.getElementById("openVrX"),
  openVrY: document.getElementById("openVrY"),
  openVrZ: document.getElementById("openVrZ"),
  openVrPitch: document.getElementById("openVrPitch"),
  openVrYaw: document.getElementById("openVrYaw"),
  openVrRoll: document.getElementById("openVrRoll"),
  openVrInterval: document.getElementById("openVrInterval")
};

const platformNames = {
  twitch: "Twitch",
  youtube: "YouTube",
  kick: "Kick",
  system: "System"
};

let config;
let autoSaveTimer;
let saveInFlight = false;
let selectedModerationTarget;
let selectedModerationElement;
const statuses = new Map();
let providerStateCache = { provider: "obs", scenes: [], audioInputs: [], videoInputs: [], currentScene: "" };
const MESSAGE_LIFETIME_MS = 5 * 60 * 1000;
const MESSAGE_PRUNE_INTERVAL_MS = 30 * 1000;
let messagePruneTimer;
let vrAlertTimer;
const selectEnhancers = new Map();

init();

async function init() {
  overlay.classList.remove("vr-capture");
  enhanceSelectControls();
  window.vrChat.onMessage(addMessage);
  window.vrChat.onAlert(showAlertPreview);
  window.vrChat.onStatus(updateStatus);
  window.vrChat.onReset(() => {
    messages.replaceChildren();
    emptyChat.hidden = false;
    closeMessageActions();
    selectedModerationTarget = undefined;
    selectedModerationElement = undefined;
    for (const source of [...statuses.keys()]) {
      if (isChatStatusSource(source)) {
        statuses.delete(source);
      }
    }
    renderStatuses();
  });

  config = await window.vrChat.getConfig();
  hydrateForm(config);
  applyConfig(config);
  await refreshVersionLabel();

  const initialStatuses = await window.vrChat.getStatuses();
  for (const item of initialStatuses) {
    updateStatus(item);
  }
  refreshYouTubeCookieStatus();
  refreshAccountStatuses();
  refreshOAuthStatuses();
  hydrateAuthModeUi();
  refreshAlertUrl();
  refreshControlProviderHint();
  refreshProviderState();
  window.vrChat.onClickThrough((enabled) => {
    config.clickThrough = enabled;
    document.body.classList.toggle("click-through", enabled);
  });
  window.vrChat.onConfigUpdated((value) => {
    config = value;
    hydrateForm(config);
    applyConfig(config);
    refreshOAuthStatuses();
    hydrateAuthModeUi();
    refreshAlertUrl();
    refreshControlProviderHint();
    refreshProviderState();
    renderStatuses();
  });

  document.getElementById("settingsButton").addEventListener("click", () => settingsPanel.classList.toggle("open"));
  document.getElementById("hideSettingsButton").addEventListener("click", () => settingsPanel.classList.remove("open"));
  document.getElementById("minimizeButton").addEventListener("click", () => window.vrChat.minimize());
  document.getElementById("closeButton").addEventListener("click", () => window.vrChat.close());
  document.getElementById("lockButton").addEventListener("click", async () => {
    config.clickThrough = await window.vrChat.toggleClickThrough();
  });
  document.getElementById("saveButton").addEventListener("click", () => save({ closePanel: false, label: "Reconnecting", rehydrate: true }));
  document.getElementById("chatScrollUpButton").addEventListener("click", () => {
    closeMessageActions();
    messages.scrollBy({ top: -Math.max(120, messages.clientHeight * 0.65), behavior: "smooth" });
  });
  document.getElementById("chatScrollDownButton").addEventListener("click", () => {
    closeMessageActions();
    messages.scrollBy({ top: Math.max(120, messages.clientHeight * 0.65), behavior: "smooth" });
  });
  document.getElementById("checkForUpdatesButton").addEventListener("click", () => runSuiteAction(() => window.vrChat.checkForUpdates()));
  fields.alertMode.addEventListener("change", refreshAlertModeUi);
  document.getElementById("refreshProviderStateButton").addEventListener("click", () => runSuiteAction(() => refreshProviderState()));
  document.getElementById("connectObsButton").addEventListener("click", () => runSuiteAction(async () => {
    await window.vrChat.connectObs();
    await refreshProviderState();
  }));
  document.getElementById("disconnectObsButton").addEventListener("click", () => runSuiteAction(async () => {
    await window.vrChat.disconnectObs();
    refreshControlProviderHint();
  }));
  document.querySelectorAll("[data-auth-session-login]").forEach((button) => {
    button.addEventListener("click", () => runSuiteAction(async () => {
      await window.vrChat.signInToService(button.dataset.authSessionLogin);
      await refreshAccountStatuses();
    }));
  });
  document.querySelectorAll("[data-auth-session-logout]").forEach((button) => {
    button.addEventListener("click", () => runSuiteAction(async () => {
      await window.vrChat.signOutService(button.dataset.authSessionLogout);
      await refreshAccountStatuses();
    }));
  });
  document.querySelectorAll("[data-oauth-login]").forEach((button) => {
    button.addEventListener("click", () => runSuiteAction(async () => {
      await save({ closePanel: false, label: "Saving", rehydrate: true });
      await window.vrChat.startOAuthLogin(button.dataset.oauthLogin);
      config = await window.vrChat.getConfig();
      hydrateForm(config);
      await refreshOAuthStatuses();
    }));
  });
  document.querySelectorAll("[data-oauth-logout]").forEach((button) => {
    button.addEventListener("click", () => runSuiteAction(async () => {
      await window.vrChat.logoutOAuth(button.dataset.oauthLogout);
      config = await window.vrChat.getConfig();
      hydrateForm(config);
      await refreshOAuthStatuses();
    }));
  });
  document.querySelectorAll("[data-dashboard-link]").forEach((button) => {
    button.addEventListener("click", () => {
      window.vrChat.openExternal(button.dataset.dashboardLink);
    });
  });
  document.querySelectorAll("[data-obs-action]").forEach((button) => {
    button.addEventListener("click", () => runSuiteAction(() => window.vrChat.runObsAction(button.dataset.obsAction)));
  });
  document.querySelectorAll("[data-mod-action]").forEach((button) => {
    button.addEventListener("click", () => runSuiteAction(() => window.vrChat.runModerationAction(button.dataset.modAction, selectedModerationTarget)));
  });
  document.querySelectorAll("[data-inline-mod-action]").forEach((button) => {
    button.addEventListener("click", () => runSuiteAction(async () => {
      if (!selectedModerationTarget) {
        throw new Error("Select a message in chat first");
      }
      await window.vrChat.runModerationAction(button.dataset.inlineModAction, selectedModerationTarget);
      removeSelectedModeratedMessage();
      closeMessageActions();
    }));
  });
  document.getElementById("closeMessageActionsButton").addEventListener("click", closeMessageActions);
  document.querySelectorAll(".mode-tab").forEach((button) => {
    button.addEventListener("click", () => setSuiteMode(button.dataset.mode, { saveMode: false }));
  });
  document.querySelectorAll(".settings-tab").forEach((button) => {
    button.addEventListener("click", () => setSettingsTab(button.dataset.settingsTab));
  });
  fields.youtubeAuthMode.addEventListener("change", () => {
    localStorage.setItem("youtubeAuthMode", fields.youtubeAuthMode.value);
    refreshYouTubeAuthModeUi();
  });
  statusTrack.addEventListener("click", toggleOpenVrFromStatus);
  window.addEventListener("resize", scheduleStatusAutoScroll);
  fields.opacity.addEventListener("input", () => {
    overlay.style.setProperty("--overlay-opacity", fields.opacity.value);
    scheduleAutoSave(500);
  });
  fields.fontScale.addEventListener("input", () => {
    overlay.style.setProperty("--font-scale", fields.fontScale.value);
    scheduleAutoSave(500);
  });

  for (const field of Object.values(fields)) {
    if (field === fields.opacity || field === fields.fontScale) continue;
    const delay = field.tagName === "TEXTAREA" ? 900 : 450;
    field.addEventListener(field.type === "checkbox" ? "change" : "input", () => scheduleAutoSave(delay));
  }

  startMessagePruner();
}

function hydrateForm(value) {
  fields.twitchChannels.value = value.twitchChannels.join(", ");
  fields.youtubeLiveIds.value = value.youtubeLiveIds.join(", ");
  fields.kickChannels.value = value.kickChannels.join(", ");
  fields.opacity.value = value.opacity;
  fields.fontScale.value = value.fontScale;
  fields.compactMode.checked = value.compactMode;
  fields.showBadges.checked = value.showBadges;
  fields.showTimestamps.checked = value.showTimestamps;
  fields.alwaysOnTop.checked = value.alwaysOnTop;
  fields.updatesCheckOnStartup.checked = value.updates?.checkOnStartup !== false;
  fields.youtubeAuthMode.value = value.youtubeAuthMode || getStoredYouTubeAuthMode(value);
  fields.alertsEnabled.checked = value.alerts.enabled;
  fields.alertPort.value = value.alerts.browserSourcePort;
  fields.alertDuration.value = value.alerts.durationMs;
  fields.alertMode.value = value.alerts.mode || "custom";
  fields.streamlabsAlertUrl.value = value.alerts.streamlabsAlertUrl || "";
  fields.alertOverlayPosition.value = value.alerts.overlayPosition || "banner";
  fields.alertOverlayScale.value = value.alerts.overlayScale || 1;
  fields.controlProvider.value = value.controlProvider || "obs";
  fields.obsHost.value = value.obs.host;
  fields.obsPort.value = value.obs.port;
  fields.obsPassword.value = value.obs.password;
  fields.obsAutoConnect.checked = value.obs.autoConnect;
  fields.twitchOAuthClientId.value = value.oauth?.twitch?.clientId || "";
  fields.twitchOAuthClientSecret.value = value.oauth?.twitch?.clientSecret || "";
  fields.youtubeOAuthClientId.value = value.oauth?.youtube?.clientId || "";
  fields.youtubeOAuthClientSecret.value = value.oauth?.youtube?.clientSecret || "";
  fields.kickOAuthClientId.value = value.oauth?.kick?.clientId || "";
  fields.kickOAuthClientSecret.value = value.oauth?.kick?.clientSecret || "";
  fields.modTwitchUser.value = value.moderation.twitchUsername;
  fields.modTwitchToken.value = value.moderation.twitchOAuthToken;
  fields.modTimeout.value = value.moderation.timeoutSeconds;
  fields.modReason.value = value.moderation.reason;
  hydrateOpenVrFields(value);
  setSuiteMode(value.suiteMode || "chat", { saveMode: false });
  setSettingsTab(document.querySelector(".settings-tab.active")?.dataset.settingsTab || "sources");
  refreshControlProviderHint();
  refreshAlertModeUi();
  refreshYouTubeAuthModeUi();
  refreshEnhancedSelectControls();
}

function hydrateOpenVrFields(value) {
  fields.openVrEnabled.checked = value.openVrOverlay.enabled;
  fields.openVrWorldGrab.checked = value.openVrOverlay.worldGrabMode;
  fields.openVrWorldLocked.checked = value.openVrOverlay.worldLocked;
  fields.openVrAnchor.value = value.openVrOverlay.anchor;
  fields.openVrPreset.value = value.openVrOverlay.controllerPreset;
  fields.openVrWidth.value = value.openVrOverlay.widthMeters;
  fields.openVrAlpha.value = value.openVrOverlay.alpha;
  fields.openVrX.value = value.openVrOverlay.x;
  fields.openVrY.value = value.openVrOverlay.y;
  fields.openVrZ.value = value.openVrOverlay.z;
  fields.openVrPitch.value = value.openVrOverlay.pitch;
  fields.openVrYaw.value = value.openVrOverlay.yaw;
  fields.openVrRoll.value = value.openVrOverlay.roll;
  fields.openVrInterval.value = value.openVrOverlay.frameIntervalMs;
}

function readForm() {
  return {
    ...config,
    twitchChannels: splitList(fields.twitchChannels.value),
    youtubeLiveIds: splitList(fields.youtubeLiveIds.value),
    kickChannels: splitList(fields.kickChannels.value),
    opacity: Number(fields.opacity.value),
    fontScale: Number(fields.fontScale.value),
    compactMode: fields.compactMode.checked,
    showBadges: fields.showBadges.checked,
    showTimestamps: fields.showTimestamps.checked,
    alwaysOnTop: fields.alwaysOnTop.checked,
    updates: {
      ...(config.updates || {}),
      checkOnStartup: fields.updatesCheckOnStartup.checked
    },
    youtubeUseCookies: config.youtubeUseCookies,
    youtubeAuthMode: fields.youtubeAuthMode.value,
    suiteMode: config.suiteMode || "chat",
    alerts: {
      enabled: fields.alertsEnabled.checked,
      browserSourcePort: Number(fields.alertPort.value),
      durationMs: Number(fields.alertDuration.value),
      mode: fields.alertMode.value,
      streamlabsAlertUrl: fields.streamlabsAlertUrl.value.trim(),
      overlayPosition: fields.alertOverlayPosition.value,
      overlayScale: Number(fields.alertOverlayScale.value)
    },
    controlProvider: fields.controlProvider.value,
    obs: {
      host: fields.obsHost.value,
      port: Number(fields.obsPort.value),
      password: fields.obsPassword.value,
      autoConnect: fields.obsAutoConnect.checked
    },
    streamDeck: {
      ...(config.streamDeck || {})
    },
    oauth: {
      ...config.oauth,
      twitch: {
        ...(config.oauth?.twitch || {}),
        clientId: fields.twitchOAuthClientId.value.trim(),
        clientSecret: fields.twitchOAuthClientSecret.value.trim()
      },
      youtube: {
        ...(config.oauth?.youtube || {}),
        clientId: fields.youtubeOAuthClientId.value.trim(),
        clientSecret: fields.youtubeOAuthClientSecret.value.trim()
      },
      kick: {
        ...(config.oauth?.kick || {}),
        clientId: fields.kickOAuthClientId.value.trim(),
        clientSecret: fields.kickOAuthClientSecret.value.trim()
      }
    },
    moderation: {
      twitchUsername: fields.modTwitchUser.value,
      twitchOAuthToken: fields.modTwitchToken.value,
      timeoutSeconds: Number(fields.modTimeout.value),
      reason: fields.modReason.value
    },
    openVrOverlay: {
      enabled: fields.openVrEnabled.checked,
      worldGrabMode: fields.openVrWorldGrab.checked,
      worldLocked: fields.openVrWorldLocked.checked,
      anchor: fields.openVrAnchor.value,
      controllerPreset: fields.openVrPreset.value,
      widthMeters: Number(fields.openVrWidth.value),
      alpha: Number(fields.openVrAlpha.value),
      x: Number(fields.openVrX.value),
      y: Number(fields.openVrY.value),
      z: Number(fields.openVrZ.value),
      pitch: Number(fields.openVrPitch.value),
      yaw: Number(fields.openVrYaw.value),
      roll: Number(fields.openVrRoll.value),
      frameIntervalMs: Number(fields.openVrInterval.value)
    }
  };
}

function scheduleAutoSave(delay = 700) {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => save({ closePanel: false, label: "Auto-saving", rehydrate: false }), delay);
}

async function save({ closePanel = false, label = "Saving", rehydrate = false } = {}) {
  if (saveInFlight) {
    scheduleAutoSave(350);
    return;
  }

  saveInFlight = true;
  const saveButton = document.getElementById("saveButton");
  saveButton.textContent = label;

  try {
    config = await window.vrChat.saveConfig(readForm());
    applyConfig(config);
    if (rehydrate) {
      hydrateForm(config);
    }
    await refreshYouTubeCookieStatus();
    await refreshAlertUrl();
    refreshControlProviderHint();
    await refreshAccountStatuses();
    await refreshOAuthStatuses();
    await refreshProviderState();
    if (closePanel) {
      settingsPanel.classList.remove("open");
    }
  } catch (error) {
    console.error(error);
  } finally {
    saveButton.textContent = "Reconnect now";
    saveInFlight = false;
  }
}

function setSuiteMode(mode, { saveMode = false } = {}) {
  const nextMode = ["chat", "deck"].includes(mode) ? mode : "chat";
  config.suiteMode = nextMode;
  document.querySelectorAll(".mode-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === nextMode);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.dataset.view === nextMode);
  });

  if (saveMode) {
    scheduleAutoSave(350);
  }
}

function setSettingsTab(tab) {
  const nextTab = ["sources", "integrations", "accounts", "vr", "moderation"].includes(tab) ? tab : "sources";
  document.querySelectorAll(".settings-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.settingsTab === nextTab);
  });
  document.querySelectorAll(".settings-page").forEach((page) => {
    page.classList.toggle("active", page.dataset.settingsPage === nextTab);
  });
}

async function refreshAlertUrl() {
  try {
    const provider = fields.controlProvider.value === "streamlabs-desktop" ? "Streamlabs Desktop" : "OBS";
    const primary = await window.vrChat.getPrimaryAlertSource();
    const fallbackUrl = await window.vrChat.getAlertUrl();
    const url = primary?.url || fallbackUrl;
    if (alertProviderHint) {
      alertProviderHint.textContent = `Add this browser source URL to ${provider} if you want to use the built-in alert page there too.`;
    }
    if (fields.alertMode.value === "streamlabs" && !fields.streamlabsAlertUrl.value.trim()) {
      if (alertModeHint) {
        alertModeHint.textContent = "Add your Streamlabs Alert Box URL to use real Streamlabs follows, subs, and donations. The app browser source stays available for testing.";
      }
      if (alertBrowserUrl) {
        alertBrowserUrl.textContent = fallbackUrl;
        alertBrowserUrl.title = fallbackUrl;
      }
      updateVrAlertOverlay(fallbackUrl);
      return;
    }
    if (alertModeHint) {
      alertModeHint.textContent = primary?.mode === "streamlabs"
        ? "Primary alerts come from Streamlabs Alert Box. Test alerts below still use the app source."
        : "Primary alerts come from the app browser source.";
    }
    if (alertBrowserUrl) {
      alertBrowserUrl.textContent = url;
      alertBrowserUrl.title = url;
    }
    updateVrAlertOverlay(url);
  } catch {
    if (alertProviderHint) {
      alertProviderHint.textContent = "Alert browser source unavailable";
    }
    if (alertModeHint) {
      alertModeHint.textContent = "Primary alert source unavailable";
    }
    if (alertBrowserUrl) {
      alertBrowserUrl.textContent = "Alert browser source unavailable";
    }
    updateVrAlertOverlay("");
  }
}

function updateVrAlertOverlay(url) {
  const nextUrl = String(url || "").trim();
  const enabled = Boolean(fields.alertsEnabled.checked && nextUrl);
  vrAlertLayer.hidden = !enabled;
  if (!enabled) {
    vrAlertFrame.removeAttribute("src");
    return;
  }
  if (vrAlertFrame.getAttribute("src") !== nextUrl) {
    vrAlertFrame.setAttribute("src", nextUrl);
  }
}

function applyAlertOverlayPreferences(value) {
  const alerts = value?.alerts || {};
  captureSurface.dataset.alertPosition = alerts.overlayPosition || "banner";
  captureSurface.style.setProperty("--vr-alert-scale", String(alerts.overlayScale || 1));
}

function pulseVrAlertLayer(durationMs) {
  if (vrAlertLayer.hidden) return;
  clearTimeout(vrAlertTimer);
  vrAlertLayer.classList.remove("show");
  void vrAlertLayer.offsetWidth;
  vrAlertLayer.classList.add("show");
  vrAlertTimer = setTimeout(() => {
    vrAlertLayer.classList.remove("show");
  }, Math.max(1200, Number(durationMs) || Number(fields.alertDuration.value) || 6000));
}

function refreshControlProviderHint() {
  const usingStreamlabs = fields.controlProvider.value === "streamlabs-desktop";
  const provider = usingStreamlabs ? "Streamlabs Desktop" : "OBS";
  controlProviderHint.textContent = `Current provider: ${provider}`;
  document.getElementById("connectObsButton").textContent = usingStreamlabs ? "Connect Streamlabs" : "Connect OBS";
  document.getElementById("obsHostLabel").hidden = usingStreamlabs;
  document.getElementById("obsPortLabel").hidden = usingStreamlabs;
  document.getElementById("obsPasswordLabel").hidden = usingStreamlabs;
  document.querySelectorAll("[data-obs-action]").forEach((button) => {
    const action = button.dataset.obsAction;
    const unsupported = usingStreamlabs && ![].includes(action);
    button.disabled = unsupported;
    button.title = unsupported ? "This action is not wired for Streamlabs Desktop yet." : "";
  });
  document.getElementById("streamTransportGrid").hidden = usingStreamlabs;
  refreshAlertModeUi();
  refreshAlertUrl();
}

function refreshAlertModeUi() {
  const usingStreamlabsAlerts = fields.alertMode.value === "streamlabs";
  document.getElementById("streamlabsAlertUrlLabel").hidden = !usingStreamlabsAlerts;
  applyAlertOverlayPreferences(config);
}

async function refreshProviderState() {
  try {
    providerStateCache = await window.vrChat.getProviderState();
    renderStreamControlLists();
  } catch (error) {
    streamCurrentScene.textContent = "No scene selected";
    streamAudioHint.textContent = "Connect provider to load audio devices";
    streamScenesList.replaceChildren();
    streamAudioList.replaceChildren();
  }
}

function renderStreamControlLists() {
  const currentScene = providerStateCache.currentScene || "No scene selected";
  streamCurrentScene.textContent = currentScene;
  streamScenesList.replaceChildren();
  streamAudioList.replaceChildren();

  const scenes = providerStateCache.scenes || [];
  const audioInputs = providerStateCache.audioInputs || [];

  if (!scenes.length) {
    const empty = document.createElement("span");
    empty.className = "stream-empty";
    empty.textContent = "No scenes loaded";
    streamScenesList.append(empty);
  } else {
    for (const scene of scenes) {
      const button = document.createElement("button");
      button.className = "stream-chip";
      if (scene.name === providerStateCache.currentScene) {
        button.classList.add("active");
      }
      button.textContent = scene.name;
      button.title = scene.name;
      button.addEventListener("click", () => runSuiteAction(async () => {
        await window.vrChat.setProviderScene(scene.name);
        await refreshProviderState();
      }));
      streamScenesList.append(button);
    }
  }

  streamAudioHint.textContent = audioInputs.length ? `${audioInputs.length} device${audioInputs.length === 1 ? "" : "s"} loaded` : "No audio devices loaded";
  if (!audioInputs.length) {
    const empty = document.createElement("span");
    empty.className = "stream-empty";
    empty.textContent = "No audio devices loaded";
    streamAudioList.append(empty);
    return;
  }

  for (const input of audioInputs) {
    const row = document.createElement("div");
    row.className = "stream-audio-row";
    const name = document.createElement("span");
    name.className = "stream-audio-name";
    name.textContent = input.name || input.id || "Audio Device";
    const button = document.createElement("button");
    button.className = input.muted ? "secondary" : "primary";
    button.textContent = input.muted ? "Unmute" : "Mute";
    button.title = `${input.muted ? "Unmute" : "Mute"} ${name.textContent}`;
    button.addEventListener("click", () => runSuiteAction(async () => {
      await window.vrChat.toggleProviderAudio(input.name || input.id);
      await refreshProviderState();
    }));
    row.append(name, button);
    streamAudioList.append(row);
  }
}

function enhanceSelectControls() {
  document.querySelectorAll("select").forEach((select) => {
    if (selectEnhancers.has(select)) return;

    select.classList.add("native-select-hidden");

    const control = document.createElement("div");
    control.className = "select-cycle";

    const prevButton = document.createElement("button");
    prevButton.type = "button";
    prevButton.className = "select-cycle-button";
    prevButton.textContent = "<";
    prevButton.setAttribute("aria-label", "Previous option");

    const value = document.createElement("button");
    value.type = "button";
    value.className = "select-cycle-value";
    value.setAttribute("aria-label", "Current option");

    const nextButton = document.createElement("button");
    nextButton.type = "button";
    nextButton.className = "select-cycle-button";
    nextButton.textContent = ">";
    nextButton.setAttribute("aria-label", "Next option");

    control.append(prevButton, value, nextButton);
    select.insertAdjacentElement("afterend", control);

    const update = () => {
      const options = [...select.options];
      const current = options.find((option) => option.value === select.value) || options[select.selectedIndex] || options[0];
      const currentLabel = current?.textContent?.trim() || "No options";
      value.textContent = currentLabel;
      value.title = currentLabel;
      const disabled = select.disabled || options.length <= 1;
      prevButton.disabled = disabled;
      nextButton.disabled = disabled;
      value.disabled = disabled;
    };

    const move = (direction) => {
      const options = [...select.options];
      if (options.length <= 1) {
        update();
        return;
      }
      const currentIndex = Math.max(0, options.findIndex((option) => option.value === select.value));
      const start = currentIndex < 0 ? 0 : currentIndex;
      let nextIndex = start;
      for (let step = 0; step < options.length; step += 1) {
        nextIndex = (nextIndex + direction + options.length) % options.length;
        const option = options[nextIndex];
        if (!option.disabled) {
          select.value = option.value;
          select.dispatchEvent(new Event("input", { bubbles: true }));
          select.dispatchEvent(new Event("change", { bubbles: true }));
          break;
        }
      }
      update();
    };

    prevButton.addEventListener("click", () => move(-1));
    nextButton.addEventListener("click", () => move(1));
    value.addEventListener("click", () => move(1));
    select.addEventListener("change", update);
    select.addEventListener("input", update);

    const observer = new MutationObserver(update);
    observer.observe(select, { childList: true, subtree: true, attributes: true, characterData: true });

    selectEnhancers.set(select, { update, observer });
    update();
  });
}

function refreshEnhancedSelectControls() {
  for (const select of selectEnhancers.keys()) {
    refreshEnhancedSelectControl(select);
  }
}

function refreshEnhancedSelectControl(select) {
  const enhancer = selectEnhancers.get(select);
  enhancer?.update();
}

async function refreshAccountStatuses() {
  await Promise.allSettled(["twitch", "youtube", "kick"].map(async (platform) => {
    const summary = await window.vrChat.getAuthStatus(platform);
    setAccountStatus(platform, summary);
  }));
}

async function refreshVersionLabel() {
  const target = document.getElementById("currentVersionLabel");
  if (!target) return;

  try {
    const version = await window.vrChat.getAppVersion();
    target.textContent = `Version ${version} checks GitHub releases for updates. "Update now" opens the latest installer or release page.`;
  } catch {
    target.textContent = "Version information unavailable.";
  }
}

async function refreshOAuthStatuses() {
  await Promise.all([
    setOAuthStatus("twitch", "oauthTwitchApiStatus"),
    setOAuthStatus("youtube", "oauthYoutubeApiStatus"),
    setOAuthStatus("kick", "oauthKickApiStatus")
  ]);
}

async function setOAuthStatus(platform, elementId) {
  const target = document.getElementById(elementId);
  if (!target) return;

  try {
    const summary = await window.vrChat.getOAuthStatus(platform);
    target.textContent = summary?.detail || `${platformNames[platform] || platform} status unavailable`;
  } catch (error) {
    const label = platformNames[platform] || platform;
    target.textContent = `${label} API status check failed`;
  }
}

function setAccountStatus(platform, summary) {
  const id = `oauth${platform[0].toUpperCase()}${platform.slice(1)}Status`;
  const target = document.getElementById(id);
  if (!target) return;

  if (platform === "youtube") {
    target.textContent = summary?.signedIn ? `Browser fallback ready (${summary.count} cookies)` : "Browser fallback not signed in";
    return;
  }

  if (!summary?.signedIn) {
    target.textContent = "Browser not signed in";
    return;
  }

  target.textContent = `Browser signed in (${summary.count} cookies)`;
}

async function runSuiteAction(action) {
  try {
    await action();
  } catch (error) {
    console.error(error);
    let detail = error?.message || "";
    if (!detail && error && typeof error === "object") {
      try {
        detail = JSON.stringify(error);
      } catch {
      }
    }
    updateStatus({ source: "Suite", state: "error", detail: detail || String(error) });
  }
}

function splitList(value) {
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

function applyConfig(value) {
  overlay.style.setProperty("--overlay-opacity", value.opacity);
  overlay.style.setProperty("--font-scale", value.fontScale);
  document.body.classList.toggle("compact", value.compactMode);
  document.body.classList.toggle("hide-badges", !value.showBadges);
  document.body.classList.toggle("show-time", value.showTimestamps);
  applyAlertOverlayPreferences(value);
}

function hydrateAuthModeUi() {
  fields.youtubeAuthMode.value = config?.youtubeAuthMode || getStoredYouTubeAuthMode(config);
  refreshYouTubeAuthModeUi();
}

function getStoredYouTubeAuthMode(value) {
  const stored = localStorage.getItem("youtubeAuthMode");
  if (stored === "oauth" || stored === "browser") {
    return stored;
  }

  if (value?.oauth?.youtube?.accessToken || value?.oauth?.youtube?.clientId) {
    return "oauth";
  }

  return "browser";
}

function refreshYouTubeAuthModeUi() {
  const oauthMode = fields.youtubeAuthMode.value !== "browser";
  document.getElementById("youtubeOAuthSection").hidden = !oauthMode;
  document.getElementById("youtubeOAuthActions").hidden = !oauthMode;
  document.getElementById("youtubeBrowserActions").hidden = oauthMode;
}

async function refreshYouTubeCookieStatus() {
  const target = document.getElementById("youtubeCookieStatus");
  if (!target) return;
  const summary = await window.vrChat.getYouTubeCookieStatus();
  target.textContent = summary.signedIn ? `Signed in (${summary.count} cookies)` : "Not signed in";
}

async function toggleOpenVrFromStatus(event) {
  const item = event.target.closest(".status[data-source='OpenVR']");
  if (!item) return;

  try {
    config = await window.vrChat.toggleOpenVrOverlay();
    hydrateForm(config);
    applyConfig(config);
    renderStatuses();
  } catch (error) {
    console.error(error);
  }
}

function addMessage(item) {
  const shouldAutoScroll = shouldStickToBottom();
  const element = document.createElement("article");
  element.className = `message ${item.platform}`;
  element.dataset.createdAt = String(Date.now());
  if (item.platform !== "system") {
    element.tabIndex = 0;
    element.addEventListener("click", () => selectMessageForModeration(item, element));
  }

  const meta = document.createElement("div");
  meta.className = "meta";

  const platform = document.createElement("span");
  platform.className = "platform";
  platform.textContent = platformNames[item.platform] || item.platform;

  const author = document.createElement("span");
  author.className = "author";
  author.textContent = item.author;
  if (item.color) author.style.setProperty("--author-color", item.color);

  const channel = document.createElement("span");
  channel.className = "channel";
  channel.textContent = item.channel;

  const time = document.createElement("time");
  time.dateTime = item.timestamp;
  time.textContent = new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  meta.append(platform, author, channel, time);

  const text = document.createElement("p");
  text.className = "message-text";
  renderMessageParts(text, item.parts, item.text);

  const badges = document.createElement("div");
  badges.className = "badges";
  for (const badge of item.badges || []) {
    const badgeElement = document.createElement("span");
    badgeElement.textContent = badge;
    badges.append(badgeElement);
  }

  const row = document.createElement("div");
  row.className = "message-row";
  row.append(meta, text, badges);
  element.append(row);
  messages.append(element);
  emptyChat.hidden = true;
  scheduleMessageExpiry(element);

  while (messages.querySelectorAll(".message").length > config.maxMessages) {
    messages.querySelector(".message")?.remove();
  }

  pruneExpiredMessages();
  if (shouldAutoScroll) {
    scrollMessagesToBottom();
  }
}

function selectMessageForModeration(item, element) {
  selectedModerationTarget = {
    platform: item.platform,
    channel: item.channel,
    author: item.author,
    platformMessageId: item.platformMessageId,
    platformAuthorId: item.platformAuthorId,
    text: item.text,
    moderationContext: item.moderationContext || {}
  };
  selectedModerationElement = element;
  document.querySelectorAll(".message.selected").forEach((message) => message.classList.remove("selected"));
  element.classList.add("selected");
  openMessageActions(item);
}

function openMessageActions(item) {
  messageActionsTitle.textContent = `${platformNames[item.platform] || item.platform} moderation`;
  messageActionsDetail.textContent = `${item.author}: ${item.text || ""}`;
  document.querySelectorAll("[data-inline-mod-action]").forEach((button) => {
    const action = button.dataset.inlineModAction;
    const supported = getInlineModerationSupport(item.platform, action);
    const visible = isInlineModerationVisible(item.platform, action);
    button.hidden = !visible;
    button.disabled = !supported;
    button.title = supported ? "" : `${platformNames[item.platform] || item.platform} ${action} is not wired yet.`;
  });
  const unsupported = [...document.querySelectorAll("[data-inline-mod-action]")].filter((button) => !button.hidden).every((button) => button.disabled);
  if (unsupported) {
    messageActionsDetail.textContent += " Actions for this platform are not wired yet.";
  }
  messageActions.hidden = false;
}

function getInlineModerationSupport(platform, action) {
  if (platform === "twitch") return ["timeout", "delete", "ban"].includes(action);
  if (platform === "youtube") return ["delete", "timeout"].includes(action);
  if (platform === "kick") return ["timeout", "ban"].includes(action);
  return false;
}

function isInlineModerationVisible(platform, action) {
  if (platform === "youtube" && action === "ban") {
    return false;
  }
  if (platform === "kick" && action === "delete") {
    return false;
  }
  return true;
}

function closeMessageActions() {
  messageActions.hidden = true;
}

function removeSelectedModeratedMessage() {
  if (!selectedModerationElement?.isConnected) {
    selectedModerationElement = undefined;
    selectedModerationTarget = undefined;
    return;
  }

  selectedModerationElement.remove();
  selectedModerationElement = undefined;
  selectedModerationTarget = undefined;
  if (!messages.querySelector(".message")) {
    emptyChat.hidden = false;
  }
}

function showAlertPreview(value) {
  if (!alertPreview) {
    pulseVrAlertLayer(Number(value.durationMs) || 3000);
    return;
  }
  alertPreview.replaceChildren();
  const type = document.createElement("span");
  type.textContent = value.type || "Alert";
  const title = document.createElement("strong");
  title.textContent = value.title || "Stream alert";
  const text = document.createElement("small");
  text.textContent = value.message || "";
  alertPreview.append(type, title, text);
  alertPreview.classList.add("flash");
  setTimeout(() => alertPreview.classList.remove("flash"), Number(value.durationMs) || 3000);
  pulseVrAlertLayer(Number(value.durationMs) || 3000);
}

function shouldStickToBottom() {
  const distanceFromBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight;
  return distanceFromBottom < 48;
}

function scrollMessagesToBottom() {
  requestAnimationFrame(() => {
    messages.scrollTop = messages.scrollHeight;
  });
}

function startMessagePruner() {
  clearInterval(messagePruneTimer);
  messagePruneTimer = setInterval(pruneExpiredMessages, MESSAGE_PRUNE_INTERVAL_MS);
}

function scheduleMessageExpiry(element) {
  const createdAt = Number(element.dataset.createdAt) || Date.now();
  const delay = Math.max(0, createdAt + MESSAGE_LIFETIME_MS - Date.now());
  setTimeout(() => {
    if (!element.isConnected) return;
    element.remove();
    updateEmptyChatState();
  }, delay + 250);
}

function pruneExpiredMessages() {
  const cutoff = Date.now() - MESSAGE_LIFETIME_MS;
  for (const element of messages.querySelectorAll(".message")) {
    const createdAt = Number(element.dataset.createdAt) || 0;
    if (createdAt && createdAt <= cutoff) {
      element.remove();
    }
  }
  updateEmptyChatState();
}

function updateEmptyChatState() {
  emptyChat.hidden = Boolean(messages.querySelector(".message"));
}

function renderMessageParts(target, parts, fallbackText) {
  target.replaceChildren();

  const safeParts = normalizeRendererParts(parts, fallbackText);

  for (const part of safeParts) {
    if (part?.type === "emote" && isSafeImageUrl(part.url)) {
      const image = document.createElement("img");
      image.className = `chat-emote ${part.platform || ""}`.trim();
      image.alt = part.name || "emote";
      image.title = part.name || "emote";
      image.loading = "lazy";
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";

      const urls = [part.url, ...(Array.isArray(part.fallbackUrls) ? part.fallbackUrls : [])].filter(isSafeImageUrl);
      let index = 0;
      image.src = urls[index];
      image.addEventListener("load", scrollMessagesToBottom);
      image.addEventListener("error", () => {
        index += 1;
        if (urls[index]) {
          image.src = urls[index];
        } else {
          image.replaceWith(document.createTextNode(part.name || ""));
          scrollMessagesToBottom();
        }
      });
      target.append(image);
    } else {
      target.append(document.createTextNode(part?.text || ""));
    }
  }
}

function normalizeRendererParts(parts, fallbackText) {
  const safeParts = Array.isArray(parts) && parts.length
    ? parts
    : [{ type: "text", text: fallbackText || "" }];

  if (safeParts.length === 1 && safeParts[0]?.type === "text" && /\[emote:\d+:[^\]]+\]/.test(safeParts[0].text || fallbackText || "")) {
    return parseKickEmoteText(safeParts[0].text || fallbackText || "");
  }

  return safeParts;
}

function parseKickEmoteText(text) {
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

  return parts.length ? parts : [{ type: "text", text: value }];
}

function isSafeImageUrl(value) {
  if (!value) return false;

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function updateStatus(value) {
  statuses.set(value.source, value);
  renderStatuses();
}

function isChatStatusSource(source) {
  return source.startsWith("Twitch") || source.startsWith("YouTube") || source.startsWith("Kick");
}

function renderStatuses() {
  statusTrack.replaceChildren();

  const items = buildStatusSummary();
  if (!items.length) {
    const empty = document.createElement("span");
    empty.className = "status muted";
    empty.textContent = "Add channels in settings";
    statusTrack.append(empty);
    return;
  }

  for (const status of items) {
    const item = document.createElement("span");
    item.className = `status ${status.state}`;
    item.dataset.source = status.source;
    item.title = status.detail || status.state;
    item.textContent = status.label;
    if (status.toggleable) {
      item.classList.add("toggleable");
    }
    statusTrack.append(item);
  }

  scheduleStatusAutoScroll();
}

function buildStatusSummary() {
  return [
    ...["Twitch", "YouTube", "Kick"]
    .map((platform) => summarizePlatformStatus(platform))
    .filter(Boolean),
    summarizeProviderStatus(),
    summarizeOverlayStatus()
  ].filter(Boolean);
}

function summarizePlatformStatus(platform) {
  const entries = [...statuses.values()].filter((status) => status.source === platform || status.source.startsWith(`${platform} `));
  if (!entries.length) {
    return null;
  }

  const details = entries.map((entry) => `${entry.source}: ${entry.detail || entry.state}`);
  const states = entries.map((entry) => String(entry.state || "").toLowerCase());
  let state = "idle";
  if (states.some((entry) => entry === "error" || entry === "disconnected" || entry === "disabled")) {
    state = "error";
  } else if (states.some((entry) => entry === "connected")) {
    state = "connected";
  } else if (states.some((entry) => entry === "connecting" || entry === "retrying" || entry === "idle")) {
    state = "idle";
  }

  return {
    source: platform,
    label: platform,
    state,
    detail: details.join("\n")
  };
}

function summarizeProviderStatus() {
  const providerSource = fields.controlProvider.value === "streamlabs-desktop" ? "Streamlabs" : "OBS";
  const entry = statuses.get(providerSource);
  if (!entry) {
    return null;
  }

  return {
    source: providerSource,
    label: providerSource,
    state: normalizeStatusState(entry.state),
    detail: entry.detail || entry.state
  };
}

function summarizeOverlayStatus() {
  const enabled = Boolean(config?.openVrOverlay?.enabled);
  const entry = statuses.get("OpenVR") || {
    state: enabled ? "idle" : "disabled",
    detail: enabled ? "Starting native overlay" : "Native overlay is off"
  };

  const detail = `${entry.detail || entry.state} | Click to turn SteamOverlay ${enabled ? "off" : "on"}`;
  return {
    source: "OpenVR",
    label: "SteamOverlay",
    state: normalizeStatusState(entry.state),
    detail,
    toggleable: true
  };
}

function normalizeStatusState(value) {
  const state = String(value || "").toLowerCase();
  if (state === "connected") return "connected";
  if (state === "error" || state === "disconnected" || state === "disabled") return "error";
  return "idle";
}

function scheduleStatusAutoScroll() {
  requestAnimationFrame(() => {
    const maxScroll = statusTrack.scrollWidth - statusStrip.clientWidth;
    statusStrip.classList.toggle("auto-scroll", maxScroll > 2);

    if (maxScroll <= 2) {
      stopStatusAutoScroll();
      return;
    }

    const duration = Math.max(5, Math.min(22, maxScroll / 22));
    statusTrack.style.setProperty("--status-scroll-distance", `${Math.ceil(maxScroll)}px`);
    statusTrack.style.setProperty("--status-scroll-duration", `${duration}s`);
    statusTrack.classList.add("scrolling");
  });
}

function stopStatusAutoScroll() {
  statusTrack.classList.remove("scrolling");
  statusTrack.style.removeProperty("--status-scroll-distance");
  statusTrack.style.removeProperty("--status-scroll-duration");
}
