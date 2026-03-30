const { spawn } = require("child_process");
const path = require("path");

const cwd = path.resolve(__dirname, "..");
const nextBin = path.join(cwd, "node_modules", "next", "dist", "bin", "next");

const child = spawn(process.execPath, [nextBin, "dev", "--hostname", "0.0.0.0", "--port", "3001"], {
  cwd,
  detached: true,
  stdio: "ignore",
  windowsHide: true,
});

child.unref();
console.log(`started pid=${child.pid}`);
