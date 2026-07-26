// Diagnostic script for Madrador Remote V6
const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

function httpGet(url, timeout = 5000) {
  const lib = url.startsWith('https://') ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, data }));
    });
    req.on('error', (err) => reject(err));
    req.setTimeout(timeout, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

async function runDiagnostics() {
  console.log('=== Madrador Remote V6 Diagnostic ===\n');
  const results = {};

  // Node version
  try {
    results.node = process.version;
    console.log(`Node version: ${process.version}`);
  } catch (e) {
    results.node = 'unknown';
  }

  // Environment variables
  const signalUrl = process.env.MADRADOR_SIGNAL_URL || '';
  const turnUrl = process.env.MADRADOR_TURN_URL || '';
  const turnUser = process.env.MADRADOR_TURN_USERNAME || '';
  const turnPass = process.env.MADRADOR_TURN_CREDENTIAL || '';
  results.env = {
    MADRADOR_SIGNAL_URL: signalUrl || '(not set)',
    MADRADOR_TURN_URL: turnUrl || '(not set)',
    MADRADOR_TURN_USERNAME: turnUser || '(not set)',
    MADRADOR_TURN_CREDENTIAL: turnPass ? '(set)' : '(not set)'
  };
  console.log('\nEnvironment:');
  for (const [k, v] of Object.entries(results.env)) {
    console.log(`  ${k}: ${v}`);
  }

  // Signal URL reachability
  if (signalUrl) {
    // Convert wss:// or ws:// to https:// / http:// for health endpoint
    let base = signalUrl;
    if (base.startsWith('wss://')) base = 'https://' + base.slice(6);
    else if (base.startsWith('ws://')) base = 'http://' + base.slice(5);
    const healthUrl = new URL('/api/health', base).href;
    try {
      console.log(`\nTesting signal server at ${healthUrl}...`);
      const start = Date.now();
      const res = await httpGet(healthUrl, 7000);
      const latency = Date.now() - start;
      results.signalReachable = true;
      results.signalLatencyMs = latency;
      console.log(`✅ Reachable (${latency} ms) – HTTP ${res.statusCode}`);
      if (res.data) {
        try {
          const json = JSON.parse(res.data);
          console.log('   Response:', JSON.stringify(json, null, 2));
        } catch (_) {
          console.log('   Response (non‑JSON):', res.data.substring(0, 200));
        }
      }
    } catch (err) {
      results.signalReachable = false;
      results.signalError = err.message;
      console.log(`❌ Unreachable: ${err.message}`);
    }
  } else {
    console.log('\n⚠️  MADRADOR_SIGNAL_URL not set – skipping connectivity test.');
  }

  // Code generation test (same as server)
  function randomDigits(length) {
    let value = '';
    for (let i = 0; i < length; i++) {
      value += Math.floor(Math.random() * 10);
    }
    return value;
  }
  const testCode = randomDigits(9);
  results.codeGenerator = /^\d{9}$/.test(testCode);
  console.log(`\nCode generation: ${results.codeGenerator ? '✅ PASS' : '❌ FAIL'} (${testCode})`);

  // Check if packaged (electron‑updater relevance)
  const resourcesPath = process.resourcesPath || '';
  const asarPath = path.join(resourcesPath, 'app.asar');
  const packaged = fs.existsSync(asarPath);
  results.packaged = packaged;
  console.log(`\nPackaged for electron‑updater: ${packaged ? '✅ YES' : '❌ NO'}`);
  if (!packaged) {
    console.log('   (running from source – auto‑updater will not activate)');
  }

  // Summary
  console.log('\n=== Summary ===');
  console.log(`Node: ${results.node}`);
  console.log(`Signal URL set: ${!!signalUrl}`);
  if (signalUrl) {
    console.log(`Signal reachable: ${results.signalReachable ? 'Yes' : 'No'}`);
    if (results.signalReachable) console.log(`Latency: ${results.signalLatencyMs} ms`);
  }
  console.log(`Code generation OK: ${results.codeGenerator}`);
  console.log(`Packaged: ${results.packaged}`);

  // Exit code: 0 if essential checks pass
  const essentialOk = (!!signalUrl ? results.signalReachable : true) && results.codeGenerator;
  process.exit(essentialOk ? 0 : 1);
}

runDiagnostics().catch((err) => {
  console.error('\nUnexpected error during diagnostics:', err);
  process.exit(1);
});