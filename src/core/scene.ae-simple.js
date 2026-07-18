// Simple AE Integration - Replace orb with your After Effects animation
// Choose ONE of these three methods based on your export format

/* global gsap */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { getAccentHex } from '../config/theme.js';

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
export function getAnomalyObject() { return null; } // AE replaces orb
export function getClock() { return clock; }

// 取得 Orb 在螢幕上的 2D 投影座標 (now points to AE container)
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
  // Not used with AE animation
}

export function setResolution(val) {
  resolution = val;
  // Not used with AE animation
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
  // Keep background particles for depth
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

// === AE ANIMATION INTEGRATION - CHOOSE ONE METHOD ===

let aeContainer = null;

// METHOD 1: Lottie/Bodymovin JSON (RECOMMENDED for AE)
// Export from After Effects using Bodymovin plugin → creates data.json
function initLottieAE() {
  // Create container for AE animation
  aeContainer = document.createElement('div');
  aeContainer.id = 'ae-animation-container';
  aeContainer.style.position = 'absolute';
  aeContainer.style.top = '50%';
  aeContainer.style.left = '50%';
  aeContainer.style.transform = 'translate(-50%, -50%)';
  aeContainer.style.width = '200px';  // Adjust size as needed
  aeContainer.style.height = '200px';
  aeContainer.style.pointerEvents = 'none'; // Let clicks pass through to UI
  aeContainer.style.zIndex = '10';
  
  // Add to DOM
  const threeContainer = document.getElementById('three-container');
  if (threeContainer && threeContainer.parentElement) {
    threeContainer.parentElement.appendChild(aeContainer);
  } else {
    document.body.appendChild(aeContainer);
  }
  
  // Load Lottie animation (uncomment when you have the JSON)
  /*
  import('lottie-web').then(lottie => {
    const anim = lottie.loadAnimation({
      container: aeContainer,
      renderer: 'svg',
      loop: true,
      autoplay: true,
      path: '/ae-animation/data.json' // CHANGE THIS PATH
    });
    
    // Store for audio reactivity
    aeContainer.lottie = anim;
  }).catch(err => {
    console.error('Lottie load failed:', err);
    aeContainer.innerHTML = '<div style="color:#00A86B; text-align:center; padding:20px;">AE Animation Loading...</div>';
  });
  */
  
  // Placeholder for now
  aeContainer.innerHTML = `
    <div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; 
                background:radial-gradient(circle, rgba(0,168,107,0.1) 0%, transparent 70%); 
                border:2px solid rgba(0,168,107,0.3); border-radius:50%;">
      <div style="width:60px; height:60px; border:2px solid #00A86B; border-radius:50%; 
                  border-top-color:transparent; animation:spin 2s linear infinite;"></div>
    </div>
    <style>
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    </style>
  `;
}

// METHOD 2: Image Sequence (PNG sequence with alpha)
// Export from AE as PNG sequence
function initImageSequenceAE() {
  aeContainer = document.createElement('div');
  aeContainer.id = 'ae-animation-container';
  aeContainer.style.position = 'absolute';
  aeContainer.style.top = '50%';
  aeContainer.style.left = '50%';
  aeContainer.style.transform = 'translate(-50%, -50%)';
  aeContainer.style.width = '200px';
  aeContainer.style.height = '200px';
  aeContainer.style.pointerEvents = 'none';
  aeContainer.style.zIndex = '10';
  
  const threeContainer = document.getElementById('three-container');
  if (threeContainer && threeContainer.parentElement) {
    threeContainer.parentElement.appendChild(aeContainer);
  } else {
    document.body.appendChild(aeContainer);
  }
  
  aeContainer.innerHTML = `
    <div style="width:100%; height:100%; position:relative;">
      <img src="/ae-animation/frame_0001.png" style="width:100%; height:100%; object-fit:contain;">
    </div>
  `;
  
  aeContainer.currentFrame = 1;
  aeContainer.totalFrames = 30; // SET TO YOUR FRAME COUNT
  aeContainer.frameInterval = setInterval(() => {
    aeContainer.currentFrame = (aeContainer.currentFrame % aeContainer.totalFrames) + 1;
    const frameStr = String(aeContainer.currentFrame).padStart(4, '0');
    aeContainer.querySelector('img').src = `/ae-animation/frame_${frameStr}.png`;
  }, 1000 / 30); // 30 FPS
}

// METHOD 3: Video (WebM with alpha)
// Export from AE as WebM with transparency
function initVideoAE() {
  aeContainer = document.createElement('div');
  aeContainer.id = 'ae-animation-container';
  aeContainer.style.position = 'absolute';
  aeContainer.style.top = '50%';
  aeContainer.style.left = '50%';
  aeContainer.style.transform = 'translate(-50%, -50%)';
  aeContainer.style.width = '200px';
  aeContainer.style.height = '200px';
  aeContainer.style.pointerEvents = 'none';
  aeContainer.style.zIndex = '10';
  
  const threeContainer = document.getElementById('three-container');
  if (threeContainer && threeContainer.parentElement) {
    threeContainer.parentElement.appendChild(aeContainer);
  } else {
    document.body.appendChild(aeContainer);
  }
  
  aeContainer.innerHTML = `
    <video autoplay loop muted playsinline style="width:100%; height:100%; object-fit:contain;">
      <source src="/ae-animation/animation.webm" type="video/webm">
      Your browser does not support WebM video.
    </video>
  `;
}

// Initialize your chosen method
function initAEAnimation() {
  // UNCOMMENT ONE OF THESE BASED ON YOUR EXPORT:
  initLottieAE();           // For Bodymovin JSON export
  // initImageSequenceAE();  // For PNG sequence export  
  // initVideoAE();          // For WebM video export
}

export function updateAEAnimation(audioLevel, agentState) {
  if (!aeContainer) return;
  
  // Apply audio reactivity to AE animation
  switch (aeContainer.dataset.method || 'lottie') {
    case 'lottie':
      if (aeContainer.lottie) {
        // Adjust playback speed based on audio and agent state
        let speed = 1.0;
        speed += audioLevel * 0.5; // Audio reactivity
        
        if (agentState === 1) { // thinking
          speed *= 1.5;
          // Add subtle wiggle
        } else if (agentState === 2) { // responding
          speed *= 1.2;
        } else { // idle
          speed *= 0.8;
        }
        
        aeContainer.lottie.setSpeed(speed);
      }
      break;
      
    case 'image-sequence':
      // Could adjust frame skipping based on audio
      break;
      
    case 'video':
      if (aeContainer.querySelector('video')) {
        const video = aeContainer.querySelector('video');
        // Adjust playback rate: 0.5x to 2x based on audio
        video.playbackRate = 0.5 + audioLevel * 1.5;
        
        // Optional: adjust opacity based on state
        if (agentState === 0) video.style.opacity = '0.8';
        else video.style.opacity = '1.0';
      }
      break;
  }
}

function setupAnomalyDragging() {
  // Disabled - AE container lets events pass through
}

function updateAnomalyPosition() {
  // No-op - AE stays centered via CSS
}

export function resetAnomaly() {
  distortionAmount = 1.0;
  resolution = 32;
  updateGlow = createBackgroundParticles();
  // AE animation state handled by its own playback
}

export function animateScene(audioLevel, rotationSpeed, audioReactivity) {
  controls.update();
  const time = clock.getElapsedTime();
  
  // Update background particles
  if (updateParticles) updateParticles(time);
  
  // Estimate agent state from audio level (simplified)
  const agentState = audioLevel > 0.7 ? 2 : (audioLevel > 0.3 ? 1 : 0);
  
  // Update AE animation with audio reactivity
  updateAEAnimation(audioLevel, agentState);
  
  // Render scene (background particles only - AE is HTML/CSS overlay)
  renderer.render(scene, camera);
}

export function onWindowResize(resizeCanvasCallback) {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);

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

  // Initialize background particles
  updateGlow = createBackgroundParticles();
  
  // Initialize AE Animation
  initAEAnimation();
  
  // Initialize theme colors
  updateThemeColors();
  
  // Listen for theme changes
  window.addEventListener('theme-change', () => {
    updateThemeColors();
    const lights = scene.children.filter(child => child instanceof THREE.PointLight);
    if (lights[0]) lights[0].color.setHex(themeColors.primary);
    if (lights[1]) lights[1].color.setHex(themeColors.secondary);
  });
}