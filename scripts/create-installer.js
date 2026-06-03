const fs = require("fs");
const path = require("path");
const { createWindowsInstaller } = require("electron-winstaller");
const packageJson = require(path.join(__dirname, "..", "package.json"));

const root = path.resolve(__dirname, "..");
const outputDirectory = path.join(root, "installer");
const appDirectory = path.join(root, "dist", "VR Chat Screen-win32-x64");
const iconPath = path.join(root, "assets", "icon.ico");

async function main() {
  if (!fs.existsSync(appDirectory)) {
    throw new Error(`Packaged app not found: ${appDirectory}`);
  }

  fs.rmSync(outputDirectory, { recursive: true, force: true });
  fs.mkdirSync(outputDirectory, { recursive: true });

  await createWindowsInstaller({
    appDirectory,
    outputDirectory,
    authors: "VR Chat Screen",
    exe: "VR Chat Screen.exe",
    setupExe: `VRChatScreen_Setup_${packageJson.version}.exe`,
    setupIcon: iconPath,
    noMsi: true
  });

  console.log(`Created installer in ${outputDirectory}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
