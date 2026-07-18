// ── Three.js 場景 + AE Animation Replacement ──

/* global gsap */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { getAccentHex } from '../config/theme.js';

// Lottie import (if using JSON export)
// import lottie from 'lottie-web'; // Uncomment if using Lottie JSON

let scene, camera, renderer, controls;
let distortionAmount = 1.0;
let resolution = 32;
let clock = new THREE.Clock();
let isDraggingAnomaly = false;
let anomalyVelocity = new THREE.Vector2(0, 0);
let anomalyTargetPosition = new THREE.Vector3(0, 0, 0);
let anomalyOriginalPosition = new THREE.Vector3(0, 0, 0);
let defaultCameraPosition = new THREE.Vector3(0, window.innerWidth <= 768 ? 1.2 : 0, window.innerWidth <= 768 ? 14 : 10);
let zoomedCameraPosition = new THREE.Vector3(0, 0, 7);
let updateGlow = null;

// 主題顏色（動態從 CSS 變數取得）
let themeColors = {
  primary: 0xff4e42,
  secondary: 0xc2362f,
  tertiary: 0xffb3ab
};

function updateThemeColors() {
  const style = getComputedStyle(document.documentElement);
  const primary = style.getPropertyValue('--accent-primary').trim();
  const secondary = style.getPropertyValue('--accent-secondary').trim();
  const tertiary = style.getPropertyValue('--accent-tertiary').trim();
  
  // 將 HSL 轉為 hex 供 Three.js 使用
  themeColors.primary = new THREE.Color(primary).getHex();
  themeColors.secondary = new THREE.Color(secondary).getHex();
  themeColors.tertiary = new THREE.Color(tertiary).getHex();
}

// Agent 狀態驅動 動畫 視覺
let agentActivity = 0;
let agentActivitySmooth = 0;  // 平滑過渡
let agentStateStartTime = 0;  // 狀態開始時間
let streamIntensity = 0;      // 串流速度強度
let streamIntensitySmooth = 0;
let doneBloom = 0;            // 完成綻放效果

export function setAgentState(state) {
  const prev = agentActivity;
  if (state === 'thinking') agentActivity = 1;
  else if (state === 'responding') agentActivity = 2;
  else {
    // 回到 idle 時觸發綻放
    if (prev === 2) doneBloom = 1.0;
    agentActivity = 0;
  }
  if (agentActivity !== prev) agentStateStartTime = performance.now();
}

// 串流速度更新（由 chat.js 呼叫）
export function setStreamIntensity(val) {
  streamIntensity = val;
}

// 監聽 chat.js 的狀態事件（避免循環依賴）
window.addEventListener('agent-state', (e) => setAgentState(e.detail));
window.addEventListener('agent-stream', (e) => setStreamIntensity(e.detail || 0));
let updateParticles = null;

export function getScene() { return scene; }
export function getCamera() { return camera; }
export function getControls() { return controls; }
export function getAnomalyObject() { return null; } // AE animation replaces orb
export function getClock() { return clock; }

// 取得 Orb 在螢幕上的 2D 投影座標 (now returns AE container position)
export function getOrbScreenPosition() {
  const container = document.getElementById('ae-animation-container');
  if (container) {
    const rect = container.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  }
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

export function setDistortion(val) {
  distortionAmount = val;
  // No longer needed for AE animation
}

export function setResolution(val) {
  resolution = val;
  // No longer needed for AE animation
}

export function zoomCameraForAudio(zoomIn) {
  const targetPosition = zoomIn ? zoomedCameraPosition : defaultCameraPosition;
  gsap.to(camera.position, {
    x: targetPosition.x,
    y: targetPosition.y,
    z: targetPosition.z,
    duration: 1.5,
    ease: 'power2.inOut',
    onUpdate: () => camera.lookAt(0, 0, 0),
  });
}

function createBackgroundParticles() {
  // Keep background particles for visual depth
  const particlesGeometry = new THREE.BufferGeometry();
  const particleCount = window.innerWidth <= 768 ? 1000 : 3000;
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);
  const color1 = new THREE.Color(themeColors.primary);
  const color2 = new THREE.Color(themeColors.secondary);
  const color3 = new THREE.Color(themeColors.tertiary);

  for (let i = 0; i < particleCount; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 100;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 100;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 100;
    let color;
    const colorChoice = Math.random();
    if (colorChoice < 0.33) color = color1;
    else if (colorChoice < 0.66) color = color2;
    else color = color3;
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
    sizes[i] = 0.05;
  }

  particlesGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  particlesGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  particlesGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const particlesMaterial = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: `
      attribute float size;
      varying vec3 vColor;
      uniform float time;
      void main() {
        vColor = color;
        vec3 pos = position;
        pos.x += sin(time * 0.1 + position.z * 0.2) * 0.05;
        pos.y += cos(time * 0.1 + position.x * 0.2) * 0.05;
        pos.z += sin(time * 0.1 + position.y * 0.2) * 0.05;
        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = size * (300.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      void main() {
        float r = distance(gl_PointCoord, vec2(0.5, 0.5));
        if (r > 0.5) discard;
        float glow = 1.0 - (r * 2.0);
        glow = pow(glow, 2.0);
        gl_FragColor = vec4(vColor, glow);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  });

  const particles = new THREE.Points(particlesGeometry, particlesMaterial);
  scene.add(particles);
  return function update(time) {
    particlesMaterial.uniforms.time.value = time;
  };
}

// AE Animation Integration Functions
let aeContainer = null;
let aeAnimation = null;
let aeAnimationType = 'lottie'; // 'lottie', 'sequence', or 'video'
let aeFrameRate = 30; // for image sequence
let aeCurrentFrame = 0;
let aeTotalFrames = 0;
let aeImageBasePath = ''; // for image sequence

export function initAEAnimation(type = 'lottie', options = {}) {
  aeAnimationType = type;
  
  // Create container for AE animation
  aeContainer = document.createElement('div');
  aeContainer.id = 'ae-animation-container';
  aeContainer.style.position = 'absolute';
  aeContainer.style.top = '50%';
  aeContainer.style.left = '50%';
  aeContainer.style.transform = 'translate(-50%, -50%)';
  aeContainer.style.width = '200px';
  aeContainer.style.height = '200px';
  aeContainer.style.pointerEvents = 'none'; // Let clicks pass through to UI underneath
  aeContainer.style.zIndex = '10'; // Above canvas but below UI panels
  
  const threeContainer = document.getElementById('three-container');
  if (threeContainer && threeContainer.parentElement) {
    threeContainer.parentElement.appendChild(aeContainer);
  } else {
    document.body.appendChild(aeContainer);
  }
  
  switch (type) {
    case 'lottie':
      initLottieAnimation(options);
      break;
    case 'sequence':
      initImageSequence(options);
      break;
    case 'video':
      initVideoAnimation(options);
      break;
  }
}

function initLottieAnimation(options) {
  // Import lottie-web dynamically to avoid build issues if not used
  import('lottie-web').then(lottie => {
    aeAnimation = lottie.loadAnimation({
      container: aeContainer,
      renderer: 'svg',
      loop: true,
      autoplay: true,
      path: options.path || '/ae-animation/data.json' // Adjust path as needed
    });
    
    // Store reference for audio reactivity
    aeContainer.lottieInstance = aeAnimation;
  }).catch(err => {
    console.error('Failed to load Lottie animation:', err);
    aeContainer.innerHTML = '<div style="color: white; text-align: center; padding: 20px;">AE Animation Load Error</div>';
  });
}

function initImageSequence(options) {
  aeImageBasePath = options.path || '/ae-animation/sequence/';
  aeTotalFrames = options.frames || 30;
  aeFrameRate = options.framerate || 30;
  
  // Create first frame
  const img = document.createElement('img');
  img.src = `${aeImageBasePath}0001.png`; // Assuming 0001.png format
  img.style.width = '100%';
  img.style.height = '100%';
  img.style.objectFit = 'contain';
  aeContainer.appendChild(img);
  aeContainer.currentImage = img;
}

function initVideoAnimation(options) {
  const video = document.createElement('video');
  video.src = options.path || '/ae-animation/animation.webm';
  video.autoplay = true;
  video.loop = true;
  video.muted = true; // Usually mute for visual effect, audio comes from system
  video.playsInline = true;
  video.style.width = '100%';
  video.style.height = '100%';
  video.style.objectFit = 'contain';
  aeContainer.appendChild(video);
  aeContainer.videoElement = video;
}

export function updateAEAnimation(audioLevel, agentActivityState, streamIntensity) {
  if (!aeContainer) return;
  
  switch (aeAnimationType) {
    case 'lottie':
      if (aeContainer.lottieInstance) {
        // Adjust animation speed based on audio and agent state
        let speed = 1.0;
        
        // Audio reactivity
        speed += audioLevel * 0.5; // 0-0.5 speed increase from audio
        
        // Agent state modifiers
        if (agentActivityState === 1) { // thinking
          speed *= 1.5; // 50% faster when thinking
          // Add some jitter for thinking state
          aeContainer.lottieInstance.goToAndStop(aeContainer.lottieInstance.currentFrame + Math.sin(performance.now() * 0.01) * 2, true);
        } else if (agentActivityState === 2) { // responding
          speed *= 1.2; // 20% faster when responding
        } else { // idle
          speed *= 0.8; // 20% slower when idle
          // Add bloom effect when transitioning from responding
          if (streamIntensity > 0.5) {
            speed *= 1.3; // Brief burst
          }
        }
        
        aeContainer.lottieInstance.setSpeed(speed);
      }
      break;
      
    case 'sequence':
      // Update frame based on audio level and agent state
      const baseFrame = Math.min(Math.floor(audioLevel * aeTotalFrames), aeTotalFrames - 1);
      let frameOffset = 0;
      
      if (agentActivityState === 1) { // thinking - add some randomness
        frameOffset = Math.floor(Math.sin(0.5);
      } else if (agentActivityState === 2) { // responding - pulse
        frameOffset = Math.sin(performance.now() * 0.005) * 3;
      }
      
      const targetFrame = Math.min(Math.max(0, Math.floor(baseFrame + frameOffset)), aeTotalFrames - 1);
      const frameStr = String(targetFrame + 1).padStart(4, '0');
      
      if (aeContainer.currentImage && aeContainer.currentImage.src !== `${aeImageBasePath}${frameStr}.png`) {
        aeContainer.currentImage.src = `${aeImageBasePath}${frameStr}.png`;
      }
      break;
      
    case 'video':
      if (aeContainer.videoElement) {
        // Adjust playback rate based on audio
        const playbackRate = 0.5 + audioLevel * 1.5; // 0.5x to 2.0x speed
        aeContainer.videoElement.playbackRate = playbackRate;
        
        // Optional: adjust opacity based on agent state
        if (agentActivityState === 0) { // idle - slightly transparent
          aeContainer.videoElement.style.opacity = '0.8';
        } else {
          aeContainer.videoElement.style.opacity = '1.0';
        }
      }
      break;
  }
}

// Helper for frame offset calculation
function frame(value) {
  return Math.sin(performance.now() * 0.003) * value;
}

function setupAnomalyDragging() {
  // Disable dragging for AE version - keep UI interactive underneath
  // The AE container has pointer-events: none so clicks pass through
}

function updateAnomalyPosition() {
  // No position updates needed - AE container is fixed center
  // Keep for compatibility but make it a no-op
}

export function resetAnomaly() {
  distortionAmount = 1.0;
  resolution = 32;
  updateGlow = createBackgroundParticles(); // Just particles now
  // AE animation position/state is handled by CSS
}

export function animateScene(audioLevel, rotationSpeed, audioReactivity) {
  controls.update();
  const time = clock.getElapsedTime();
  
  // Update background particles
  if (updateParticles) updateParticles(time);
  
  // Update AE animation with audio/agent state
  // We need to get agent state from somewhere - for now use audio level as proxy
  // In a full implementation, we'd store the latest agent state
  const agentState = audioLevel > 0.7 ? 2 : (audioLevel > 0.3 ? 1 : 0); // rough approximation
  const streamIntensity = audioLevel * 0.8; // derive from audio
  
  updateAEAnimation(audioLevel, agentState, streamIntensity);
  
  // Note: No 3D orb rotation since we replaced it with AE animation
  renderer.render(scene, camera);
}

export function onWindowResize(resizeCanvasCallback) {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);

  // Mobile/Desktop camera adjustment (kept for compatibility)
  const isMobile = window.innerWidth <= 768;
  const newZ = isMobile ? 14 : 10;
  const newY = isMobile ? 1.2 : 0;
  defaultCameraPosition.z = newZ;
  defaultCameraPosition.y = newY;
  if (!isDraggingAnomaly) {
    camera.position.z = newZ;
    camera.position.y = newY;
  }

  if (resizeCanvasCallback) resizeCanvasCallback();
}

export function initScene() {
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a0e17, 0.05);
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.copy(defaultCameraPosition);

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
    stencil: false,
    depth: true,
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(window.devicePixelRatio);
  document.getElementById('three-container').appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.enableRotate = false;
  controls.enablePan = false;
  controls.zoomSpeed = 0.7;
  controls.minDistance = 3;
  controls.maxDistance = 30;
  controls.enableZoom = false;

  const ambientLight = new THREE.AmbientLight(0x404040, 1.5);
  scene.add(ambientLight);
  const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
  directionalLight.position.set(1, 1, 1);
  scene.add(directionalLight);
  const pointLight1 = new THREE.PointLight(themeColors.primary, 1, 10);
  pointLight1.position.set(2, 2, 2);
  scene.add(pointLight1);
  const pointLight2 = new THREE.PointLight(themeColors.secondary, 1, 10);
  pointLight2.position.set(-2, -2, -2);
  scene.add(pointLight2);

  // Initialize background particles (replaces orb glow)
  updateGlow = createBackgroundParticles();
  
  // Initialize AE Animation - DEFAULT TO LOTTIE, ADJUST PATH AS NEEDED
  initAEAnimation('lottie', {
    path: '/ae-animation/data.json' // CHANGE THIS TO YOUR EXPORTED FILE PATH
  });
  
  // Initialize theme colors
  updateThemeColors();
  
  // Listen for theme changes
  window.addEventListener('theme-change', () => {
    updateThemeColors();
    // Update lights
    const lights = scene.children.filter(child => child instanceof THREE.PointLight);
    if (lights[0]) lights[0].color.setHex(themeColors.primary);
    if (lights[1]) lights[1].color.setHex(themeColors.secondary);
  });
}