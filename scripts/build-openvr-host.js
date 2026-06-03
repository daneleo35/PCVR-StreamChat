const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const project = path.join(root, "native", "VrChatScreen.OpenVRHost", "VrChatScreen.OpenVRHost.csproj");
const output = path.join(root, "native", "OpenVRHost");
const steamVrDll = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\SteamVR\\bin\\win64\\openvr_api.dll";

fs.mkdirSync(output, { recursive: true });

const publish = spawnSync("dotnet", [
  "publish",
  project,
  "--configuration",
  "Release",
  "--runtime",
  "win-x64",
  "--self-contained",
  "false",
  "--output",
  output,
  "--source",
  "https://api.nuget.org/v3/index.json"
], {
  stdio: "inherit"
});

if (publish.status !== 0) {
  process.exit(publish.status || 1);
}

if (fs.existsSync(steamVrDll)) {
  const targetDll = path.join(output, "openvr_api.dll");
  try {
    fs.copyFileSync(steamVrDll, targetDll);
  } catch (error) {
    if (error?.code === "EBUSY" && fs.existsSync(targetDll)) {
      console.warn(`SteamVR openvr_api.dll is busy, keeping existing copy at ${targetDll}.`);
    } else {
      throw error;
    }
  }
} else {
  console.warn(`SteamVR openvr_api.dll was not found at ${steamVrDll}. Install SteamVR or copy openvr_api.dll beside the OpenVR host before enabling native overlays.`);
}
