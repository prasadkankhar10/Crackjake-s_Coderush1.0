// 3D Space Background using Three.js
// Adds a starfield and a rotating planet for a space effect
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.155.0/build/three.module.js';

// Helper: Load texture from URL
function loadTexture(url) {
  return new THREE.TextureLoader().load(url);
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('space-bg').appendChild(renderer.domElement);

// Starfield
function createStars(count) {
  const geometry = new THREE.BufferGeometry();
  const positions = [];
  for (let i = 0; i < count; i++) {
    positions.push((Math.random() - 0.5) * 1000);
    positions.push((Math.random() - 0.5) * 1000);
    positions.push(-Math.random() * 1000);
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color: 0xffffff, size: 1.2 });
  const stars = new THREE.Points(geometry, material);
  scene.add(stars);
}
createStars(1200);


// Solar System: Sun and Planets
const solarSystem = new THREE.Group();


// Sun with glow
const sunGeometry = new THREE.SphereGeometry(22, 40, 40);
const sunTexture = loadTexture('https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/sun.jpg');
const sunMaterial = new THREE.MeshBasicMaterial({ map: sunTexture });
const sun = new THREE.Mesh(sunGeometry, sunMaterial);
// Shift solar system further left so it's half on and half off the screen
const solarOffsetX = -window.innerWidth * 0.33; // about 1/3 of the screen width to the left
const solarScale = 1.25;
sun.position.set(solarOffsetX, -60, -300);
solarSystem.add(sun);

// Sun glow effect
const sunGlowGeometry = new THREE.SphereGeometry(26, 40, 40);
const sunGlowMaterial = new THREE.MeshBasicMaterial({ color: 0xfff7a0, transparent: true, opacity: 0.25 });
const sunGlow = new THREE.Mesh(sunGlowGeometry, sunGlowMaterial);
sunGlow.position.copy(sun.position);
solarSystem.add(sunGlow);


// Planets data: [radius, textureURL, orbitRadius, orbitSpeed, hasRing]
const planetsData = [
  [3,  'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/mercury.jpg', 38, 0.018, false],
  [5,  'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/venus.jpg', 55, 0.014, false],
  [5.5,'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_atmos_2048.jpg', 75, 0.012, false],
  [4.5,'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/mars_1k_color.jpg', 100, 0.010, false],
  [10, 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/jupiter.jpg', 140, 0.007, false],
  [8,  'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/saturn.jpg', 180, 0.005, true],
  [7,  'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/uranus.jpg', 220, 0.003, false],
  [7,  'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/neptune.jpg', 260, 0.002, false]
];

const planetMeshes = [];
const planetAngles = [];
for (let i = 0; i < planetsData.length; i++) {
  const [radius, textureURL, orbitRadius, orbitSpeed, hasRing] = planetsData[i];
  const geometry = new THREE.SphereGeometry(radius * solarScale, 32, 32);
  const texture = loadTexture(textureURL);
  const material = new THREE.MeshPhongMaterial({ map: texture, shininess: 60, emissive: 0x222222, emissiveIntensity: 0.22 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(solarOffsetX + orbitRadius * solarScale, -60, -300);
  solarSystem.add(mesh);
  // Saturn's ring
  if (hasRing) {
    const ringGeometry = new THREE.RingGeometry((radius+2)*solarScale, (radius+5)*solarScale, 64);
    const ringTexture = loadTexture('https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/saturnringcolor.jpg');
    const ringMaterial = new THREE.MeshBasicMaterial({ map: ringTexture, side: THREE.DoubleSide, transparent: true, opacity: 0.7 });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.position.set(0, 0, 0);
    ring.rotation.x = Math.PI / 2.2;
    mesh.add(ring);
  }
  planetMeshes.push({ mesh, orbitRadius: orbitRadius * solarScale, orbitSpeed });
  planetAngles.push(Math.random() * Math.PI * 2);
}

scene.add(solarSystem);


// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 1.1); // brighter ambient for planet visibility
scene.add(ambientLight);
const sunLight = new THREE.PointLight(0xfff7a0, 2.5, 1000);
sunLight.position.copy(sun.position);
scene.add(sunLight);

camera.position.z = 60;


function animate() {
  requestAnimationFrame(animate);
  // Animate planets in orbits
  for (let i = 0; i < planetMeshes.length; i++) {
    planetAngles[i] += planetMeshes[i].orbitSpeed * 0.7;
    const x = solarOffsetX + Math.cos(planetAngles[i]) * planetMeshes[i].orbitRadius;
    const z = Math.sin(planetAngles[i]) * planetMeshes[i].orbitRadius - 300;
    planetMeshes[i].mesh.position.set(x, -60, z);
    // Saturn's ring follows planet
    if (planetMeshes[i].mesh.children.length) {
      planetMeshes[i].mesh.children[0].rotation.z += 0.001;
    }
  }
  // Sun slow rotation
  sun.rotation.y += 0.001;
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
