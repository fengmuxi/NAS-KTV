const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const isWin = os.platform() === 'win32';
const downloaderDir = path.join(__dirname, '..');
const venvDir = path.join(downloaderDir, '.venv');

const venvPython = isWin
  ? path.join(venvDir, 'Scripts', 'python.exe')
  : path.join(venvDir, 'bin', 'python');

if (!fs.existsSync(venvPython)) {
  console.error('Error: venv not found. Please run: pnpm --filter @nasktv/downloader run setup');
  process.exit(1);
}

const extraArgs = process.argv.slice(2);
const args = ['-m', 'uvicorn', 'app.main:app', '--host', '0.0.0.0', '--port', '8002', ...extraArgs];

const child = spawn(venvPython, args, {
  cwd: downloaderDir,
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => process.exit(code ?? 1));
child.on('error', (err) => {
  console.error('Failed to start downloader:', err.message);
  process.exit(1);
});
