import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const TEST_DIR = path.join(ROOT_DIR, '.pack-test');

async function run() {
  console.log('📦 1. Building and Packing...');
  execSync('npm run build', { stdio: 'inherit', cwd: ROOT_DIR });
  const packOutput = execSync('npm pack', { cwd: ROOT_DIR }).toString().trim();
  // npm pack outputs the filename at the end, e.g., react-ai-voice-avatar-0.2.1.tgz
  const tarballName = packOutput.split('\n').pop().trim();
  const tarballPath = path.join(ROOT_DIR, tarballName);
  
  console.log(`📦 Created tarball: ${tarballPath}`);

  console.log('🏗️ 2. Scaffolding Bare Vite App...');
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });
  
  // Use npm create vite without prompts
  execSync('npm create vite@latest app -- --template react-ts', { stdio: 'inherit', cwd: TEST_DIR });
  const APP_DIR = path.join(TEST_DIR, 'app');
  
  console.log('📥 3. Installing dependencies & the packed tarball...');
  execSync('npm install', { stdio: 'inherit', cwd: APP_DIR });
  // Install required peer dependencies
  execSync('npm install three@^0.167.0 @react-three/fiber@^9.0.0 @react-three/drei@^10.7.7', { stdio: 'inherit', cwd: APP_DIR });
  // Install the absolute path to the tarball
  execSync(`npm install ${tarballPath}`, { stdio: 'inherit', cwd: APP_DIR });

  console.log('✍️ 4. Writing Test App.tsx & vite.config.ts...');
  
  const viteConfigCode = `
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom', 'three', '@react-three/fiber', '@react-three/drei']
  },
  optimizeDeps: {
    exclude: ['react-ai-voice-avatar', 'kokoro-js', 'phonemizer'],
    include: ['@ricky0123/vad-web', 'three', '@react-three/fiber', '@react-three/drei']
  },
  worker: {
    format: 'es'
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  }
});
  `;
  fs.writeFileSync(path.join(APP_DIR, 'vite.config.ts'), viteConfigCode);

  const appCode = `
import React, { useEffect, useState } from 'react';
import { useAiVoiceAvatar } from 'react-ai-voice-avatar';

export default function App() {
  console.log('🚀 APP_MOUNTED 🚀');
  const lastPctRef = React.useRef(-1);
  const { speak, isReady, status, currentAudioDurationRef } = useAiVoiceAvatar({
    ttsEngine: 'kokoro',
    ttsVoice: 'af_heart',
    asrModel: 'onnx-community/whisper-tiny.en',
    onSubmit: (text) => {
      console.log('MOCK_ON_SUBMIT:', text);
      return 'Mock reply';
    },
    onSpeechStart: () => {
      console.log('SPEECH_STARTED');
    },
    loadingProgress: (pct, label) => {
      if (pct !== lastPctRef.current) {
        console.log('PROGRESS:' + label + ':' + pct);
        lastPctRef.current = pct;
      }
    }
  });

  useEffect(() => {
    if (isReady && status === 'idle') {
      console.log('HOOK_READY');
      speak("Hello world, this is a test of the packaging system. If the espeak dictionary is broken, this will be silent.");
    }
  }, [isReady, status, speak]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (currentAudioDurationRef.current > 0) {
        console.log('AUDIO_DURATION:' + currentAudioDurationRef.current);
      }
    }, 100);
    return () => clearInterval(interval);
  }, []);

  return <div><h1>Testing Pack</h1><p>Status: {status}</p></div>;
}
  `;
  fs.writeFileSync(path.join(APP_DIR, 'src', 'App.tsx'), appCode);

  console.log('🚀 5. Booting Vite Dev Server...');
  // We use a background process for Vite so Playwright can connect
  const { spawn } = await import('child_process');
  const viteProcess = spawn('npm', ['run', 'dev', '--', '--port', '5174'], {
    cwd: APP_DIR,
    stdio: 'pipe'
  });

  let serverUrl = 'http://localhost:5174';
  // Wait for Vite to be ready
  await new Promise((resolve) => {
    viteProcess.stderr.on('data', data => {
      console.error('[Vite Error]', data.toString());
    });
    viteProcess.stdout.on('data', (data) => {
      const output = data.toString();
      const match = output.match(/Local:\s+(http:\/\/localhost:\d+\/?)/);
      if (match) {
        serverUrl = match[1];
        resolve();
      }
    });
  });

  console.log('🤖 6. Launching Headless Playwright...');
  const userDataDir = path.join(ROOT_DIR, '.playwright-profile');
  const browserContext = await chromium.launchPersistentContext(userDataDir, {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required'
    ],
    permissions: ['microphone'],
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = browserContext.pages()[0] || await browserContext.newPage();
  
  let success = false;
  let testFailed = false;
  
  page.on('pageerror', err => {
    console.error('❌ [Page Error / Uncaught Exception]', err);
    testFailed = true;
  });
  
  page.on('console', msg => {
    const text = msg.text();
    console.log('[Browser]', text);
    if (text.startsWith('AUDIO_DURATION:')) {
      const duration = parseFloat(text.split(':')[1]);
      console.log(`⏱️ Recorded Audio Duration: ${duration}s`);
      // The espeak error bug usually results in ~0.53s of silence instead of a real 2-3s audio clip
      if (duration < 1.5) {
        console.error('❌ FAILED: Audio duration is too short! This indicates a broken espeak/phoneme dictionary packaging issue (0.53s bug).');
        testFailed = true;
      } else {
        console.log('✅ SUCCESS: Audio duration is healthy ( > 1.5s ). Packaging is verified!');
        success = true;
      }
    } else if (text.includes('Kokoro engine failed') || text.includes('falling back to MMS')) {
      console.error('❌ FAILED: Kokoro engine failed and fell back to MMS. The packaging test must verify Kokoro directly!');
      testFailed = true;
    } else if (text.includes('HOOK_READY')) {
      console.log('🧠 ML Models downloaded and initialized successfully.');
    } else if (text.includes('error') || text.includes('failed')) {
      console.error('[Browser Error]', text);
    }
  });

  try {
    console.log('Navigating to ' + serverUrl + ' ... (waiting up to 600s for model download)');
    await page.goto(serverUrl);
    
    // Wait until we get a success or failure, or timeout after 600 seconds (ML models take time)
    for (let i = 0; i < 600; i++) {
      if (success || testFailed) break;
      await new Promise(r => setTimeout(r, 1000));
    }
    
    if (!success && !testFailed) {
      console.error('❌ FAILED: Timeout waiting for audio duration.');
      testFailed = true;
    }
  } finally {
    console.log('📸 Taking debug screenshot...');
    await page.screenshot({ path: path.join(ROOT_DIR, 'debug-timeout.png') });
    await browserContext.close();
    // Do not delete profile directory locally so cache is preserved
    if (process.env.CI) {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
    viteProcess.kill();
    fs.rmSync(tarballPath, { force: true });
    
    if (testFailed) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }
}

run().catch(err => {
  console.error('Fatal Script Error:', err);
  process.exit(1);
});
