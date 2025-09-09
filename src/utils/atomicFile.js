const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function fsyncFd(fd) {
  try { fs.fsyncSync(fd); } catch (_) {}
}

async function atomicWriteJSON(filePath, obj, { keepBak = true } = {}) {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const tmp = path.join(dir, `.tmp-${path.basename(filePath)}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const data = JSON.stringify(obj, null, 2);
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, data, 'utf8');
    fsyncFd(fd);
  } finally {
    fs.closeSync(fd);
  }
  // optional single .bak rollover
  if (keepBak && fs.existsSync(filePath)) {
    const bak = filePath + '.bak';
    try { if (fs.existsSync(bak)) fs.unlinkSync(bak); } catch (_) {}
    try { fs.copyFileSync(filePath, bak); } catch (_) {}
  }
  fs.renameSync(tmp, filePath);
}

async function atomicWriteText(filePath, text, { keepBak = true } = {}) {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const tmp = path.join(dir, `.tmp-${path.basename(filePath)}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, text, 'utf8');
    fsyncFd(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (keepBak && fs.existsSync(filePath)) {
    const bak = filePath + '.bak';
    try { if (fs.existsSync(bak)) fs.unlinkSync(bak); } catch (_) {}
    try { fs.copyFileSync(filePath, bak); } catch (_) {}
  }
  fs.renameSync(tmp, filePath);
}

// Simple in-process mutex to serialize writes
let writeLock = Promise.resolve();
function withLock(fn) {
  const next = writeLock.then(() => fn()).catch((e) => { throw e; });
  // ensure chain continues even after error
  writeLock = next.catch(() => {});
  return next;
}

module.exports = {
  atomicWriteJSON,
  atomicWriteText,
  withLock,
};

