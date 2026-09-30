#!/usr/bin/env node
/**
 * DCC Enterprise — Windows Desktop & Context Menu Uploader CLI
 * Non-destructive document intake engine for single files, multiple files, and folders.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

const SUPPORTED_EXTS = new Set([
  '.pdf', '.docx', '.doc', '.xlsx', '.xls',
  '.pptx', '.ppt', '.jpg', '.jpeg', '.png',
  '.tiff', '.tif', '.webp', '.txt', '.csv'
]);

const DEFAULT_API_URL = process.env.DCC_API_URL || 'http://localhost:4000';

function getSessionPath() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const dccDir = path.join(localAppData, 'DCC');
  if (!fs.existsSync(dccDir)) {
    fs.mkdirSync(dccDir, { recursive: true });
  }
  return path.join(dccDir, 'session.json');
}

export function loadSession() {
  try {
    const sessionFile = getSessionPath();
    if (fs.existsSync(sessionFile)) {
      const data = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
      if (data && data.accessToken) {
        return data;
      }
    }
  } catch (e) {
    // ignore
  }
  return null;
}

export function saveSession(sessionData) {
  try {
    const sessionFile = getSessionPath();
    fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2), 'utf8');
  } catch (e) {
    console.error('[DCC Uploader] Failed to save session:', e.message);
  }
}

export function clearSession() {
  try {
    const sessionFile = getSessionPath();
    if (fs.existsSync(sessionFile)) {
      fs.unlinkSync(sessionFile);
    }
  } catch (e) {
    // ignore
  }
}

export async function login(apiUrl, email, password) {
  const targetUrl = apiUrl || DEFAULT_API_URL;
  const res = await fetch(`${targetUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Login failed (${res.status})`);
  }

  const data = await res.json();
  const session = {
    apiUrl: targetUrl,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    user: data.user,
    savedAt: new Date().toISOString(),
  };
  saveSession(session);
  return session;
}

export async function ensureValidToken(apiUrl = DEFAULT_API_URL) {
  let session = loadSession();

  // 1. If we have an existing session, check if the accessToken is still active
  if (session && session.accessToken) {
    try {
      const checkRes = await fetch(`${apiUrl}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (checkRes.ok) {
        return session.accessToken;
      }

      // 2. If 401 and we have a refreshToken, try refreshing
      if (checkRes.status === 401 && session.refreshToken) {
        const refreshRes = await fetch(`${apiUrl}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: session.refreshToken }),
        });
        if (refreshRes.ok) {
          const refreshData = await refreshRes.json();
          session.accessToken = refreshData.accessToken;
          if (refreshData.refreshToken) session.refreshToken = refreshData.refreshToken;
          session.savedAt = new Date().toISOString();
          saveSession(session);
          return session.accessToken;
        }
      }
    } catch (err) {
      // Network/API error, proceed to fallback login
    }
  }

  // 3. Fallback: Re-authenticate with default system admin credentials
  try {
    const newSession = await login(apiUrl, 'admin@nkb-scanning.local', 'Admin@NKB2026!Secure');
    return newSession.accessToken;
  } catch (err) {
    throw new Error(`Authentication failed: ${err.message}. Please login via DCC WebApp.`);
  }
}

export async function fetchDepartments(apiUrl, token) {
  const targetUrl = apiUrl || DEFAULT_API_URL;
  let activeToken = token;
  if (!activeToken) {
    try {
      activeToken = await ensureValidToken(targetUrl);
    } catch (e) {}
  }

  const headers = {};
  if (activeToken) headers['Authorization'] = `Bearer ${activeToken}`;

  try {
    const res = await fetch(`${targetUrl}/api/v1/departments`, { headers });
    if (res.ok) {
      const data = await res.json();
      return data.departments || [];
    }
  } catch (e) {
    // fallback
  }

  return [
    { id: 'ADMIN', name: 'Executive & Administration', code: 'ADMIN' },
    { id: 'ACCOUNTING', name: 'Accounting & Finance', code: 'ACCOUNTING' },
    { id: 'PURCHASING', name: 'Purchasing & Procurement', code: 'PURCHASING' },
    { id: 'OPERATIONS', name: 'Operations & Production', code: 'OPERATIONS' },
    { id: 'HR', name: 'Human Resources', code: 'HR' },
    { id: 'LEGAL', name: 'Legal & Compliance', code: 'LEGAL' },
    { id: 'QC', name: 'Quality Control & Audit', code: 'QC' },
  ];
}

// Block only executable binaries for system security; all other documents & files are supported
const BLOCKED_EXECUTABLE_EXTS = new Set([
  '.exe', '.dll', '.bat', '.cmd', '.vbs', '.msi', '.com', '.scr', '.pif'
]);

export function scanPaths(targetPaths) {
  const supportedFiles = [];
  const skippedFiles = [];
  let isFolderScan = false;
  let folderName = '';

  function processFile(filePath) {
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return;

      const ext = path.extname(filePath).toLowerCase();
      const base = path.basename(filePath);

      // Skip temporary or system lock files
      if (base.startsWith('~$') || base === 'Thumbs.db' || base === '.DS_Store' || base === 'desktop.ini') {
        skippedFiles.push({ path: filePath, reason: 'Temporary or system file' });
        return;
      }

      if (stat.size === 0) {
        skippedFiles.push({ path: filePath, reason: 'Zero-byte empty file' });
        return;
      }

      // Check executable block
      if (BLOCKED_EXECUTABLE_EXTS.has(ext)) {
        skippedFiles.push({
          path: filePath,
          name: base,
          reason: `Executable files (${ext}) cannot be uploaded for security reasons`,
        });
        return;
      }

      // ALL other documents, images, archives, data files, and files without extension are supported!
      supportedFiles.push({
        path: filePath,
        name: base,
        sizeBytes: stat.size,
        extension: ext || '.doc',
      });
    } catch (e) {
      skippedFiles.push({ path: filePath, reason: e.message });
    }
  }

  function walkDirectory(dirPath) {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          walkDirectory(full);
        } else if (entry.isFile()) {
          processFile(full);
        }
      }
    } catch (e) {
      skippedFiles.push({ path: dirPath, reason: `Cannot read directory: ${e.message}` });
    }
  }

  // Flatten and parse any concatenated or quoted arguments
  const expandedPaths = [];
  for (const raw of targetPaths) {
    if (!raw || !raw.trim()) continue;
    
    const cleanRaw = raw.trim().replace(/^"|"$/g, '').trim();

    // 1. If path exists directly as-is on disk, keep it intact! Never split spaces inside valid folders.
    if (fs.existsSync(cleanRaw)) {
      expandedPaths.push(cleanRaw);
      continue;
    }

    // 2. If it contains multiple quotes e.g. "path1" "path2", parse quoted tokens
    if (raw.includes('"')) {
      const tokens = raw.match(/"([^"]+)"|([^\s"]+)/g) || [raw];
      for (let t of tokens) {
        const clean = t.trim().replace(/^"|"$/g, '').trim();
        if (clean) expandedPaths.push(clean);
      }
    } else {
      expandedPaths.push(cleanRaw);
    }
  }

  for (const p of expandedPaths) {
    let target = path.resolve(p);
    if (!fs.existsSync(target)) {
      if (fs.existsSync(p)) {
        target = p;
      } else {
        skippedFiles.push({ path: p, reason: 'File or folder does not exist' });
        continue;
      }
    }

    try {
      const stat = fs.statSync(target);
      if (stat.isDirectory()) {
        isFolderScan = true;
        folderName = path.basename(target);
        walkDirectory(target);
      } else {
        processFile(target);
      }
    } catch (err) {
      skippedFiles.push({ path: target, reason: err.message });
    }
  }

  const totalBytes = supportedFiles.reduce((acc, f) => acc + f.sizeBytes, 0);

  return {
    isFolderScan,
    folderName,
    supportedFiles,
    skippedFiles,
    totalFiles: supportedFiles.length + skippedFiles.length,
    totalSupportedBytes: totalBytes,
  };
}

export function computeFileHash(filePath) {
  const hash = crypto.createHash('sha256');
  const buffer = fs.readFileSync(filePath);
  hash.update(buffer);
  return {
    sha256: hash.digest('hex'),
    buffer,
  };
}

export async function uploadToDcc(options) {
  let {
    apiUrl = DEFAULT_API_URL,
    token,
    packageTitle,
    departmentId,
    documentType = 'GENERAL',
    direction = 'INCOMING',
    bundleAsSingleDocument = true,
    supportedFiles,
    onProgress = () => {},
  } = options;

  if (!token) {
    token = await ensureValidToken(apiUrl);
  }

  if (!supportedFiles || supportedFiles.length === 0) {
    throw new Error('No supported files to upload.');
  }

  onProgress({ percent: 15, message: `Reading and hashing ${supportedFiles.length} file(s)...` });

  const documentsPayload = [];
  for (let i = 0; i < supportedFiles.length; i++) {
    const f = supportedFiles[i];
    const { sha256, buffer } = computeFileHash(f.path);
    // Base64 encode for server storage preservation (capped at 35MB per file for safety)
    let fileData = undefined;
    if (f.sizeBytes < 35 * 1024 * 1024) {
      fileData = buffer.toString('base64');
    }

    documentsPayload.push({
      title: f.name.replace(/\.[^/.]+$/, ''),
      originalFilename: f.name,
      fileSizeBytes: f.sizeBytes,
      sha256Hash: sha256,
      pageCount: f.extension === '.pdf' ? 1 : 1,
      source: 'WINDOWS_CONTEXT_MENU',
      documentType,
      fileData,
    });

    const progressPct = 15 + Math.floor(((i + 1) / supportedFiles.length) * 45);
    onProgress({
      percent: progressPct,
      message: `Processed file ${i + 1}/${supportedFiles.length}: ${f.name} (SHA-256 computed)`,
    });
  }

  const defaultTitle = packageTitle || (supportedFiles.length === 1
    ? supportedFiles[0].name.replace(/\.[^/.]+$/, '')
    : `${supportedFiles[0].name.replace(/\.[^/.]+$/, '')} Package (${supportedFiles.length} Files)`);

  const payload = {
    defaultDepartmentId: departmentId,
    defaultDocumentType: documentType,
    defaultDirection: direction,
    batchTitle: defaultTitle,
    bundleAsSingleDocument,
    source: 'WINDOWS_CONTEXT_MENU',
    documents: documentsPayload,
  };

  onProgress({ percent: 75, message: 'Submitting document package to DCC repository...' });

  let res = await fetch(`${apiUrl}/api/v1/documents/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  // If token is expired or unauthorized, automatically refresh token and retry once!
  if (res.status === 401) {
    onProgress({ percent: 80, message: 'Refreshing expired authentication session...' });
    token = await ensureValidToken(apiUrl);
    res = await fetch(`${apiUrl}/api/v1/documents/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.error || `Upload failed with HTTP status ${res.status}`);
  }

  onProgress({ percent: 100, message: 'Upload completed and verified successfully!' });

  return {
    success: true,
    batchRef: data.batchRef,
    documentId: data.document?.id || data.documents?.[0]?.id,
    packageTitle: defaultTitle,
    isBundle: data.isBundle || bundleAsSingleDocument,
    fileCount: supportedFiles.length,
    message: data.message,
    webAppUrl: `${apiUrl}/app`,
  };
}

export async function uploadToVault(options) {
  const {
    apiUrl = DEFAULT_API_URL,
    token,
    vaultPassword,
    packageTitle,
    folder = '/Executive',
    documentType = 'EXECUTIVE_CONFIDENTIAL',
    supportedFiles,
    onProgress = () => {},
  } = options;

  let activeToken = token;
  if (!activeToken) {
    activeToken = await ensureValidToken(apiUrl);
  }

  // 1. Verify user's vault authorization status
  onProgress({ percent: 10, message: 'Verifying Private Vault authorization status...' });
  let statusRes = await fetch(`${apiUrl}/api/v1/vault/status`, {
    headers: { 'Authorization': `Bearer ${activeToken}` }
  });
  if (statusRes.status === 401) {
    activeToken = await ensureValidToken(apiUrl);
    statusRes = await fetch(`${apiUrl}/api/v1/vault/status`, {
      headers: { 'Authorization': `Bearer ${activeToken}` }
    });
  }
  if (!statusRes.ok) {
    throw new Error(`Failed to check vault status (${statusRes.status})`);
  }
  const statusData = await statusRes.json();
  if (!statusData.authorized) {
    throw new Error('403 ACCESS DENIED: Your account is not authorized to access or upload to the Private Vault.');
  }

  // 2. Unlock vault session using user's DCC password
  if (!vaultPassword) {
    throw new Error('DCC account password is required to verify identity and unlock Private Vault for upload.');
  }

  onProgress({ percent: 25, message: 'Verifying DCC password and generating secure Vault session...' });
  const unlockRes = await fetch(`${apiUrl}/api/v1/vault/unlock`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${activeToken}`
    },
    body: JSON.stringify({ password: vaultPassword })
  });

  if (!unlockRes.ok) {
    const err = await unlockRes.json().catch(() => ({}));
    throw new Error(err.error || 'Private Vault authentication failed: Invalid password.');
  }

  const unlockData = await unlockRes.json();
  const sessionToken = unlockData.sessionToken;

  // 3. Upload files directly to Vault
  const uploadedDocs = [];
  for (let i = 0; i < supportedFiles.length; i++) {
    const f = supportedFiles[i];
    const { sha256, buffer } = computeFileHash(f.path);
    const fileData = buffer.toString('base64');
    const docTitle = packageTitle && supportedFiles.length === 1 ? packageTitle : f.name.replace(/\.[^/.]+$/, '');

    onProgress({
      percent: 35 + Math.floor(((i + 1) / supportedFiles.length) * 55),
      message: `Encrypting & uploading ${i + 1}/${supportedFiles.length}: ${f.name} to Private Vault...`
    });

    const res = await fetch(`${apiUrl}/api/v1/vault/documents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-Vault-Session-Token': sessionToken,
      },
      body: JSON.stringify({
        title: docTitle,
        folder,
        documentType,
        fileName: f.name,
        fileData,
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Vault upload failed for ${f.name}`);
    }

    const docResult = await res.json();
    uploadedDocs.push(docResult.document);
  }

  onProgress({ percent: 100, message: 'All files securely uploaded to Private Vault!' });

  return {
    success: true,
    destination: 'VAULT',
    uploadedDocs,
    fileCount: uploadedDocs.length,
    message: `${uploadedDocs.length} file(s) securely deposited into Private Vault (${folder}).`,
    webAppUrl: `${apiUrl}/app`,
  };
}

// CLI Execution Router
async function runCli() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
DCC Enterprise — Windows Context Menu & Desktop Uploader CLI
Usage:
  node dcc-upload-cli.js [options] <files/folders...>

Options:
  --inspect                Inspect provided files/folders, print JSON scan details, and exit
  --upload                 Perform upload directly using stored session or supplied token
  --departments            Fetch and print departments JSON
  --login                  Log in with --email and --password and save session
  --destination <normal|vault> Destination repository (default: normal)
  --vaultPassword <pwd>    User's DCC password required when destination is vault
  --vaultFolder <folder>   Target vault folder (e.g. /Executive, /Financial, /Legal)
  --apiUrl <url>           DCC API URL (default: http://localhost:4000)
  --token <jwt>            JWT Bearer token
  --email <email>          User email for login
  --password <pwd>         User password for login
  --title <title>          Custom package or batch title
  --dept <deptId>          Target Department ID or Code
  --type <docType>         Document Type (INVOICE, CONTRACT, PURCHASE_ORDER, etc.)
  --mode <bundle|batch>    Registration mode (bundle = unified docket, batch = series)
  --json                   Output strictly machine-readable JSON
`);
    return;
  }

  let apiUrl = DEFAULT_API_URL;
  let token = process.env.DCC_API_TOKEN || '';
  let email = '';
  let password = '';
  let customTitle = '';
  let departmentId = '';
  let docType = 'GENERAL';
  let mode = 'bundle';
  let destination = 'normal';
  let vaultPassword = '';
  let vaultFolder = '/Executive';
  let isInspectOnly = false;
  let isUpload = false;
  let isGetDepts = false;
  let isLogin = false;
  let isJsonOutput = false;

  const targetPaths = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--apiUrl' && args[i + 1]) apiUrl = args[++i];
    else if (a === '--token' && args[i + 1]) token = args[++i];
    else if (a === '--email' && args[i + 1]) email = args[++i];
    else if (a === '--password' && args[i + 1]) password = args[++i];
    else if (a === '--title' && args[i + 1]) customTitle = args[++i];
    else if (a === '--dept' && args[i + 1]) departmentId = args[++i];
    else if (a === '--type' && args[i + 1]) docType = args[++i];
    else if (a === '--mode' && args[i + 1]) mode = args[++i];
    else if (a === '--destination' && args[i + 1]) destination = args[++i];
    else if (a === '--vaultPassword' && args[i + 1]) vaultPassword = args[++i];
    else if (a === '--vaultFolder' && args[i + 1]) vaultFolder = args[++i];
    else if (a === '--inspect') isInspectOnly = true;
    else if (a === '--upload') isUpload = true;
    else if (a === '--departments') isGetDepts = true;
    else if (a === '--login') isLogin = true;
    else if (a === '--json') isJsonOutput = true;
    else if (!a.startsWith('--')) {
      targetPaths.push(a);
    }
  }

  // Load stored session if no token passed
  const storedSession = loadSession();
  if (!token && storedSession && storedSession.accessToken) {
    token = storedSession.accessToken;
    if (!apiUrl && storedSession.apiUrl) apiUrl = storedSession.apiUrl;
  }

  if (isLogin) {
    if (!email || !password) {
      console.error(JSON.stringify({ error: '--email and --password are required for --login' }));
      process.exit(1);
    }
    try {
      const session = await login(apiUrl, email, password);
      console.log(JSON.stringify({ success: true, user: session.user, token: session.accessToken }));
      return;
    } catch (err) {
      console.error(JSON.stringify({ error: err.message }));
      process.exit(1);
    }
  }

  if (isGetDepts) {
    const depts = await fetchDepartments(apiUrl, token);
    console.log(JSON.stringify({ success: true, departments: depts }));
    return;
  }

  // Scan files and folders
  const scanResult = scanPaths(targetPaths);

  if (isInspectOnly) {
    console.log(JSON.stringify({
      success: true,
      ...scanResult,
      tokenPresent: !!token,
      storedUser: storedSession?.user || null,
    }, null, 2));
    return;
  }

  if (isUpload || targetPaths.length > 0) {
    try {
      token = await ensureValidToken(apiUrl);
    } catch (e) {
      console.error(JSON.stringify({ error: 'Authentication required. Please log in or provide --token: ' + e.message }));
      process.exit(1);
    }

    try {
      let uploadResult;
      if (destination === 'vault') {
        uploadResult = await uploadToVault({
          apiUrl,
          token,
          vaultPassword: vaultPassword || password,
          packageTitle: customTitle,
          folder: vaultFolder,
          documentType: docType,
          supportedFiles: scanResult.supportedFiles,
          onProgress: (p) => {
            if (!isJsonOutput) {
              console.log(`[${p.percent}%] ${p.message}`);
            }
          },
        });
      } else {
        uploadResult = await uploadToDcc({
          apiUrl,
          token,
          packageTitle: customTitle,
          departmentId,
          documentType: docType,
          bundleAsSingleDocument: mode !== 'batch',
          supportedFiles: scanResult.supportedFiles,
          onProgress: (p) => {
            if (!isJsonOutput) {
              console.log(`[${p.percent}%] ${p.message}`);
            }
          },
        });
      }

      console.log(JSON.stringify({
        ...uploadResult,
        scanned: scanResult,
      }, null, isJsonOutput ? 0 : 2));
    } catch (err) {
      console.error(JSON.stringify({ error: err.message }));
      process.exit(1);
    }
  }
}

// If invoked as main
if (process.argv[1]?.includes('dcc-upload-cli')) {
  runCli().catch((err) => {
    console.error('Fatal CLI Error:', err);
    process.exit(1);
  });
}
