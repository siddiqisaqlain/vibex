// The Wardrobe: the live stock inside a 3D wardrobe.
// Clothing hangs on the rail, fragrances stand in the drawers, anything else sits on the shelf.
// Every piece is cut out of its own product photo (the plain photo background is flood-filled away),
// so new WhatsApp posts show up here on their own. Tapping a piece opens its details and links to /p/<id>.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const $ = (id) => document.getElementById(id);
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const rupees = (n) => "₹" + Number(n).toLocaleString("en-IN");

// ---------- sizes (metres) ----------
const W = 2.0, H = 2.4, D = 0.62, T = 0.025;      // outer box and board thickness
const PLINTH = 0.08, DRAWER_H = 0.24, DRAWERS_MAX = 3;
const RAIL_Y = 1.98, GARMENT_W = 0.6;
const IN_W = W - 2 * T;

// ---------- renderer, scene, camera ----------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
} catch {
  fail();
}
const PHONE = matchMedia("(max-width: 760px), (pointer: coarse)").matches;
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, PHONE ? 1.75 : 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping; // keeps the products' real colours
renderer.toneMappingExposure = 1.05;
$("stage").appendChild(renderer.domElement);

// A light, gallery-like room: warm plaster, pale oak floor, soft daylight.
const ROOM = 0x8c7e6f; // the room falls off to warm taupe at the edges, like a lit boutique
const scene = new THREE.Scene();
scene.background = new THREE.Color(ROOM);
scene.fog = new THREE.Fog(ROOM, 6, 14);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;

const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 40);

// ---------- materials ----------
function woodCanvas(base, grain, w = 512, h = 1024, lines = 140, strength = 1) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < lines; i++) {
    const x0 = Math.random() * w, amp = 2 + Math.random() * 8, freq = 0.002 + Math.random() * 0.004, ph = Math.random() * 6;
    g.strokeStyle = grain; g.globalAlpha = (0.03 + Math.random() * 0.08) * strength; g.lineWidth = 0.5 + Math.random() * 1.8;
    g.beginPath();
    for (let y = 0; y <= h; y += 8) g.lineTo(x0 + Math.sin(y * freq + ph) * amp, y);
    g.stroke();
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
// fluted (reeded) door fronts: a normal map of soft vertical ribs
function fluteNormal(ribs = 26) {
  const c = document.createElement("canvas"); c.width = 512; c.height = 4;
  const g = c.getContext("2d"), im = g.createImageData(512, 4);
  for (let x = 0; x < 512; x++) {
    const t = ((x / 512) * ribs) % 1, nx = Math.sin((t - 0.5) * Math.PI) * 0.75;
    const r = Math.round((nx * 0.5 + 0.5) * 255), b = Math.round(Math.sqrt(1 - nx * nx) * 255);
    for (let y = 0; y < 4; y++) { const k = (y * 512 + x) * 4; im.data[k] = r; im.data[k + 1] = 128; im.data[k + 2] = b; im.data[k + 3] = 255; }
  }
  g.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const charcoal = new THREE.MeshStandardMaterial({ color: 0x2b2a28, roughness: 0.55, metalness: 0.05 });
const fluted = new THREE.MeshStandardMaterial({ color: 0x2b2a28, roughness: 0.5, metalness: 0.05, normalMap: fluteNormal(), normalScale: new THREE.Vector2(1.2, 1.2) });
const shadowGap = new THREE.MeshStandardMaterial({ color: 0x0e0e0d, roughness: 0.9 });
const oak = new THREE.MeshStandardMaterial({ map: woodCanvas("#e2d2bb", "#a88a66", 512, 1024, 120, 0.8), roughness: 0.62 });
const oakDark = new THREE.MeshStandardMaterial({ map: woodCanvas("#d6c3a7", "#9a7b58", 512, 1024, 100, 0.8), roughness: 0.66 });
const bronze = new THREE.MeshStandardMaterial({ color: 0xc9a46e, metalness: 1, roughness: 0.26 });
const brass = bronze;
const chrome = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 1, roughness: 0.2 });
const matteBlack = new THREE.MeshStandardMaterial({ color: 0x161616, metalness: 0.6, roughness: 0.42 });
// suede lining for the drawers and the back of the hanging space
function suedeTexture(base) {
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const g = c.getContext("2d"); g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  const im = g.getImageData(0, 0, 256, 256);
  for (let k = 0; k < im.data.length; k += 4) { const n = (Math.random() - 0.5) * 14; im.data[k] += n; im.data[k + 1] += n; im.data[k + 2] += n; }
  g.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 6); return t;
}
// saddle-stitched cognac leather for the pulls
function leatherTexture() {
  const c = document.createElement("canvas"); c.width = 256; c.height = 256;
  const g = c.getContext("2d"); g.fillStyle = "#7a4526"; g.fillRect(0, 0, 256, 256);
  for (let k = 0; k < 2600; k++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? "30,14,6" : "160,98,58"},${Math.random() * 0.18})`; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
  g.strokeStyle = "rgba(235,215,185,.8)"; g.lineWidth = 3; g.setLineDash([10, 8]);
  for (const x of [26, 230]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); } // the stitch line runs along the pull
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
const velvet = new THREE.MeshStandardMaterial({ map: suedeTexture("#5e3d29"), roughness: 1 }); // cognac suede drawer lining
const suede = new THREE.MeshStandardMaterial({ map: suedeTexture("#b3a08a"), roughness: 1 });   // taupe suede back wall
const leather = new THREE.MeshStandardMaterial({ map: leatherTexture(), roughness: 0.55, metalness: 0 });
const brushedBrass = new THREE.MeshStandardMaterial({ color: 0xc8a165, metalness: 1, roughness: 0.3 });
const hangerWood = new THREE.MeshStandardMaterial({ map: woodCanvas("#4a2f1e", "#1d0f07", 256, 256, 40), roughness: 0.35 }); // lacquered walnut
const ledMat = new THREE.MeshStandardMaterial({ color: 0xfff6ea, emissive: 0xfff0dc, emissiveIntensity: 0 });

function box(w, h, d, mat, x, y, z, parent = scene) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}

// ---------- room: limewashed walls with a pool of light, polished stone floor ----------
function wallTexture() {
  const c = document.createElement("canvas"); c.width = 1024; c.height = 512;
  const g = c.getContext("2d");
  g.fillStyle = "#8c7e6f"; g.fillRect(0, 0, 1024, 512);
  const pool = g.createRadialGradient(512, 230, 20, 512, 260, 520);
  pool.addColorStop(0, "#e2d6c4"); pool.addColorStop(0.45, "#c4b5a1"); pool.addColorStop(1, "#8c7e6f");
  g.fillStyle = pool; g.fillRect(0, 0, 1024, 512);
  // limewash: a fine, even grain (no blotches), plus faint vertical brush strokes
  const im = g.getImageData(0, 0, 1024, 512);
  for (let k = 0; k < im.data.length; k += 4) { const n = (Math.random() - 0.5) * 7; im.data[k] += n; im.data[k + 1] += n; im.data[k + 2] += n; }
  g.putImageData(im, 0, 0);
  for (let k = 0; k < 160; k++) { g.globalAlpha = 0.025; g.fillStyle = Math.random() < 0.5 ? "#fff" : "#4a3c2e"; g.fillRect(Math.random() * 1024, 0, 2 + Math.random() * 10, 512); }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function stoneTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 1024;
  const g = c.getContext("2d");
  g.fillStyle = "#cfc3b2"; g.fillRect(0, 0, 1024, 1024);
  for (let k = 0; k < 40; k++) { // soft travertine veins
    g.strokeStyle = Math.random() < 0.5 ? "#b8a991" : "#e2d8c9"; g.globalAlpha = 0.18 + Math.random() * 0.2; g.lineWidth = 1 + Math.random() * 3;
    g.beginPath(); let x = Math.random() * 1024, y = Math.random() * 1024; g.moveTo(x, y);
    for (let s2 = 0; s2 < 12; s2++) { x += 40 + Math.random() * 60; y += (Math.random() - 0.5) * 40; g.lineTo(x % 1024, y); }
    g.stroke();
  }
  g.globalAlpha = 1; g.strokeStyle = "rgba(90,75,60,.35)"; g.lineWidth = 2; g.strokeRect(1, 1, 1022, 1022); // tile joint
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(25, 25); t.anisotropy = 8;
  return t;
}
{
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshPhysicalMaterial({ map: stoneTexture(), roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.15, envMapIntensity: 0.8 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(14, 7), new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.95 }));
  wall.position.set(0, 3.5, -D / 2 - 0.02); wall.receiveShadow = true; scene.add(wall);
  // slim stone skirting
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(14, 0.08, 0.02), new THREE.MeshStandardMaterial({ color: 0x6f6152, roughness: 0.6 }));
  skirt.position.set(0, 0.04, -D / 2 - 0.01); skirt.receiveShadow = true; scene.add(skirt);
  // a deep wool rug, oval
  const rug = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.012, 72), new THREE.MeshStandardMaterial({ color: 0x8a7b69, roughness: 1 }));
  rug.position.set(0, 0.006, 1.5); rug.scale.set(1.35, 1, 0.72); rug.receiveShadow = true; scene.add(rug);
}

// ---------- lights: a dim room, warm track spots on the wardrobe, its own lights inside ----------
scene.add(new THREE.HemisphereLight(0xfff3e4, 0x6a5a48, 0.42));
const key = new THREE.DirectionalLight(0xfff1e0, 0.55);
key.position.set(-2.4, 4.4, 4.2);
key.castShadow = !PHONE;
key.shadow.mapSize.set(1024, 1024); key.shadow.radius = 8;
Object.assign(key.shadow.camera, { left: -2, right: 2, top: 3, bottom: -0.5, near: 1, far: 12 });
key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
scene.add(key);
// two ceiling spots in front, pooling light on the doors and the floor
const frontSpots = [-0.75, 0.75].map((x, k) => {
  const sp = new THREE.SpotLight(0xffe6c8, 26, 9, 0.42, 0.85, 1.6);
  sp.position.set(x, 3.7, 2.5); sp.target.position.set(x * 0.4, 1.0, 0.2);
  if (k === 0) { sp.castShadow = true; sp.shadow.mapSize.set(PHONE ? 512 : 1024, PHONE ? 512 : 1024); sp.shadow.bias = -0.0005; sp.shadow.radius = 6; }
  scene.add(sp, sp.target); return sp;
});
// inside: three warm spots under the top shelf aimed down the rail, plus a little fill
const railSpots = [-0.6, 0, 0.6].map((x, k) => {
  const sp = new THREE.SpotLight(0xffebd2, 0, 2.6, 0.75, 1, 1.8);
  sp.position.set(x, 2.02, 0.24); sp.target.position.set(x * 0.9, 1.15, -0.12);
  if (k === 1) { sp.castShadow = true; sp.shadow.mapSize.set(PHONE ? 512 : 1024, PHONE ? 512 : 1024); sp.shadow.bias = -0.0008; sp.shadow.radius = 10; sp.shadow.camera.near = 0.05; }
  scene.add(sp, sp.target); return sp;
});
const inside = new THREE.PointLight(0xffdcb0, 0, 3.2, 1.6);
inside.position.set(0, 1.5, 0.5);
scene.add(inside);
const drawerLight = new THREE.PointLight(0xfff0dc, 0, 1.6, 2);
scene.add(drawerLight);

// ---------- the wardrobe carcass: matte charcoal outside, pale oak inside ----------
const wardrobe = new THREE.Group();
scene.add(wardrobe);
box(T, H, D, charcoal, -W / 2 + T / 2, H / 2, 0, wardrobe);              // sides
box(T, H, D, charcoal, W / 2 - T / 2, H / 2, 0, wardrobe);
box(W, T, D, charcoal, 0, H - T / 2, 0, wardrobe);                       // flush top
box(IN_W, PLINTH, D - 0.08, shadowGap, 0, PLINTH / 2, -0.04, wardrobe);  // recessed plinth: it seems to float
box(IN_W, T, D, oak, 0, PLINTH + T / 2, 0, wardrobe);                    // floor board
box(IN_W, H - PLINTH, 0.012, suede, 0, PLINTH + (H - PLINTH) / 2, -D / 2 + 0.006, wardrobe); // suede-lined back
for (const s of [-1, 1]) box(0.006, H - PLINTH - T, D - 0.02, oak, s * (IN_W / 2 - 0.003), PLINTH + (H - PLINTH) / 2, 0, wardrobe); // oak lining

const SHELF_Y = PLINTH + T + DRAWERS_MAX * DRAWER_H + T / 2;               // top of the drawer bank
box(IN_W, T, D - 0.02, oak, 0, SHELF_Y, -0.01, wardrobe);
const TOP_SHELF_Y = 2.06;
box(IN_W, T, D - 0.02, oak, 0, TOP_SHELF_Y, -0.01, wardrobe);
// LED: a strip under the top shelf and one down each side, near the front
const leds = [box(IN_W - 0.06, 0.006, 0.01, ledMat, 0, TOP_SHELF_Y - T / 2 - 0.004, D / 2 - 0.05, wardrobe)];
for (const s of [-1, 1]) leds.push(box(0.006, TOP_SHELF_Y - SHELF_Y - 0.04, 0.01, ledMat, s * (IN_W / 2 - 0.01), (TOP_SHELF_Y + SHELF_Y) / 2, D / 2 - 0.04, wardrobe));
leds.forEach((l) => { l.castShadow = false; });

// a slim matte black oval rail
const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, IN_W - 0.02, 24), brushedBrass);
rail.rotation.z = Math.PI / 2; rail.scale.set(1, 1, 1.5); rail.position.set(0, RAIL_Y, 0); rail.castShadow = true;
wardrobe.add(rail);
for (const s of [-1, 1]) box(0.012, 0.05, 0.03, brushedBrass, s * (IN_W / 2 - 0.012), RAIL_Y + 0.012, 0, wardrobe);

// a pull: a leather-wrapped bar between two brass end caps on brass posts
function leatherPull(len, vertical) {
  const g = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, len, 24), leather);
  g.add(bar);
  for (const e of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0125, 0.016, 24), brushedBrass);
    cap.position.y = e * (len / 2 + 0.008); g.add(cap);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.034, 12), brushedBrass);
    post.rotation.x = Math.PI / 2; post.position.set(0, e * (len / 2 - 0.02), -0.017); g.add(post);
  }
  if (!vertical) g.rotation.z = Math.PI / 2;
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
// a thin brass inlay line framing a panel
function inlay(parent, w, h, cx, cy, z, inset = 0.035) {
  const t = 0.004, d = 0.002, iw = w - 2 * inset, ih = h - 2 * inset;
  box(iw, t, d, brushedBrass, cx, cy + ih / 2, z, parent); box(iw, t, d, brushedBrass, cx, cy - ih / 2, z, parent);
  box(t, ih, d, brushedBrass, cx - iw / 2, cy, z, parent); box(t, ih, d, brushedBrass, cx + iw / 2, cy, z, parent);
}

// the cornice with a brass maker's plaque, the way a house signs its furniture
{
  const cor = box(W + 0.03, 0.075, D + 0.03, charcoal, 0, H + 0.0375, 0.005, wardrobe);
  cor.castShadow = true;
  box(W + 0.04, 0.006, D + 0.04, brushedBrass, 0, H + 0.003, 0.005, wardrobe); // brass shadow line under it
  const c = document.createElement("canvas"); c.width = 512; c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, 128); grad.addColorStop(0, "#d9b77c"); grad.addColorStop(0.5, "#b8915a"); grad.addColorStop(1, "#d2ad72");
  g.fillStyle = grad; g.fillRect(0, 0, 512, 128);
  g.strokeStyle = "rgba(70,45,15,.55)"; g.lineWidth = 3; g.strokeRect(10, 10, 492, 108);
  g.fillStyle = "rgba(55,35,12,.9)"; g.font = "800 58px Archivo, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.letterSpacing = "18px"; g.fillText("VIBE X", 262, 62);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const plaque = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.004), [brushedBrass, brushedBrass, brushedBrass, brushedBrass, new THREE.MeshStandardMaterial({ map: t, metalness: 0.85, roughness: 0.32 }), brushedBrass]);
  plaque.position.set(0, H + 0.0375, (D + 0.03) / 2 + 0.005 + 0.002); scene.add(plaque); plaque.castShadow = true;
}

// ---------- doors: fluted charcoal, slim bronze edge pulls ----------
const doors = [];
function makeDoor(side) { // side -1 = left (hinge on the left), 1 = right
  const pivot = new THREE.Group();
  pivot.position.set(side * W / 2, PLINTH, D / 2 + T / 2);
  const dw = W / 2 - 0.003, dh = H - PLINTH - 0.006;
  const g = new THREE.Group();
  g.position.x = -side * dw / 2;
  pivot.add(g);
  const slab = box(dw, dh, T, [charcoal, charcoal, charcoal, charcoal, fluted, charcoal], 0, dh / 2, 0, g);
  fluted.normalMap.repeat.set(1, 1);
  // oak inside face, so an open door looks finished
  box(dw - 0.01, dh - 0.01, 0.002, charcoal, 0, dh / 2, -T / 2 - 0.001, g); // same charcoal inside: open doors frame the lit interior
  // a tall, thin bronze pull on the meeting edge
  inlay(g, dw, dh, 0, dh / 2, T / 2 + 0.001, 0.06);
  const pull = leatherPull(0.62, true); pull.position.set(side * (dw / 2 - 0.075), dh * 0.52, T / 2 + 0.034); g.add(pull);
  g.traverse((o) => { o.userData.kind = "door"; });
  wardrobe.add(pivot);
  const d = { pivot, side, angle: 0, target: 0 };
  doors.push(d);
  return d;
}
makeDoor(-1); makeDoor(1);
const DOOR_OPEN = 2.1; // swung well past square so they angle out and never cover the inside
let doorsOpen = false;
function setDoors(open) {
  doorsOpen = open;
  for (const d of doors) d.target = open ? DOOR_OPEN : 0;
  if (!open) { closeDrawers(); closePanel(); }
  paintDock();
}

// ---------- photo cut-outs ----------
// Flood-fill the plain photo background from the edges, keep the biggest object, soften the edge.
function cutout(img, maxH) {
  const s = Math.min(1, maxH / img.naturalHeight);
  const w = Math.max(8, Math.round(img.naturalWidth * s)), h = Math.max(8, Math.round(img.naturalHeight * s));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  const im = g.getImageData(0, 0, w, h), px = im.data, N = w * h;
  const bg = new Uint8Array(N), q = new Int32Array(N);
  const dist = (a, b) => { const i = a * 4, j = b * 4; return Math.abs(px[i] - px[j]) + Math.abs(px[i + 1] - px[j + 1]) + Math.abs(px[i + 2] - px[j + 2]); };
  const light = (a) => px[a * 4] + px[a * 4 + 1] + px[a * 4 + 2];
  let qh = 0, qt = 0;
  const seed = (p) => { if (!bg[p] && light(p) > 330) { bg[p] = 1; q[qt++] = p; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (qh < qt) {
    const p = q[qh++], x = p % w;
    const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w];
    for (const n of nb) {
      if (n < 0 || n >= N || bg[n]) continue;
      if (dist(n, p) < 18 && light(n) > 300) { bg[n] = 1; q[qt++] = n; }
    }
  }
  // keep the largest foreground blob (drops corner watermarks and specks)
  const lab = new Int32Array(N); let best = 0, bestId = 0, id = 0;
  for (let p = 0; p < N; p++) {
    if (bg[p] || lab[p]) continue;
    id++; let size = 0; qh = qt = 0; q[qt++] = p; lab[p] = id;
    while (qh < qt) {
      const r = q[qh++], x = r % w; size++;
      for (const n of [x > 0 ? r - 1 : -1, x < w - 1 ? r + 1 : -1, r - w, r + w]) {
        if (n < 0 || n >= N || bg[n] || lab[n]) continue;
        lab[n] = id; q[qt++] = n;
      }
    }
    if (size > best) { best = size; bestId = id; }
  }
  const frac = best / N;
  const ok = frac > 0.05 && frac < 0.93;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  const a = new Uint8Array(N);
  for (let p = 0; p < N; p++) {
    if (ok ? lab[p] === bestId : true) {
      a[p] = 255; const x = p % w, y = (p / w) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  // pull the edge in 2px so no photo-background fringe is left, then soften it
  if (ok) for (let pass = 0; pass < 2; pass++) {
    const src = Uint8Array.from(a);
    for (let p = 0; p < N; p++) {
      if (!src[p]) continue;
      const x = p % w;
      if (x === 0 || x === w - 1 || p < w || p >= N - w || !src[p - 1] || !src[p + 1] || !src[p - w] || !src[p + w]) a[p] = 0;
    }
  }
  // A clean edge: the garment's own colour is carried a few pixels past its outline (no white or
  // dark fringe), and the outline itself is smoothed (two 5x5 box blurs, close to a gaussian) so the
  // cut follows a smooth curve instead of pixel steps.
  const col = new Uint8ClampedArray(px.length); col.set(px);
  if (ok) {
    let have = Uint8Array.from(a, (v) => (v ? 1 : 0));
    for (let it = 0; it < 5; it++) {
      const next = Uint8Array.from(have);
      for (let p = 0; p < N; p++) {
        if (have[p]) continue;
        const x = p % w;
        for (const n of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
          if (n < 0 || n >= N || !have[n]) continue;
          col[p * 4] = col[n * 4]; col[p * 4 + 1] = col[n * 4 + 1]; col[p * 4 + 2] = col[n * 4 + 2];
          next[p] = 1; break;
        }
      }
      have = next;
    }
  }
  let af = Float32Array.from(a);
  const blur = (src) => {
    const tmp = new Float32Array(N), dst = new Float32Array(N), r = 2;
    for (let y = 0; y < h; y++) { let acc = 0; const row = y * w;
      for (let x = -r; x < w + r; x++) {
        const add = x + r < w ? src[row + Math.min(w - 1, Math.max(0, x + r))] : 0, sub = x - r - 1 >= 0 ? src[row + x - r - 1] : 0;
        acc += add - sub; if (x >= 0 && x < w) tmp[row + x] = acc / (2 * r + 1);
      } }
    for (let x = 0; x < w; x++) { let acc = 0;
      for (let y = -r; y < h + r; y++) {
        const add = y + r < h ? tmp[Math.min(h - 1, Math.max(0, y + r)) * w + x] : 0, sub = y - r - 1 >= 0 ? tmp[(y - r - 1) * w + x] : 0;
        acc += add - sub; if (y >= 0 && y < h) dst[y * w + x] = acc / (2 * r + 1);
      } }
    return dst;
  };
  if (ok) af = blur(blur(af));
  const out = document.createElement("canvas");
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  out.width = cw; out.height = ch;
  const og = out.getContext("2d");
  const od = og.createImageData(cw, ch), mask = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const sx = x + x0, sy = y + y0, sp = sy * w + sx;
    const al = ok ? Math.round(af[sp]) : 255, si = sp * 4, di = (y * cw + x) * 4;
    od.data[di] = col[si]; od.data[di + 1] = col[si + 1]; od.data[di + 2] = col[si + 2]; od.data[di + 3] = al;
    mask[y * cw + x] = al;
  }
  og.putImageData(od, 0, 0);
  return { canvas: out, mask, w: cw, h: ch, ok };
}

function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.decoding = "async"; i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
function cutTexture(cut) {
  const t = new THREE.CanvasTexture(cut.canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function cutMaterials(cut) {
  const map = cutTexture(cut);
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.8, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.5, alphaToCoverage: true, transparent: false });
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5 });
  return { mat, depth };
}

// ---------- clothing on hangers ----------
const garments = [];
function makeHanger() {
  const g = new THREE.Group();
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.0035, 8, 32, Math.PI * 1.45), brushedBrass);
  hook.rotation.y = Math.PI / 2; hook.rotation.z = -Math.PI * 0.2; // loops over the rail, opening at the back
  hook.position.y = -0.005;
  g.add(hook);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.06, 8), brushedBrass);
  stem.position.set(0, -0.055, 0.024 * Math.sin(0.2)); g.add(stem);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.012, 0.018, 16), brass);
  neck.position.y = -0.09; g.add(neck);
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.21, -0.15, 0), new THREE.Vector3(-0.12, -0.112, 0), new THREE.Vector3(0, -0.098, 0),
    new THREE.Vector3(0.12, -0.112, 0), new THREE.Vector3(0.21, -0.15, 0)]);
  const bar = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.012, 12, false), hangerWood);
  g.add(bar);
  for (const s of [-1, 1]) { const end = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), hangerWood); end.position.set(s * 0.21, -0.15, 0); g.add(end); }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
// How far each point is from the garment's edge (chamfer distance on a grid), lightly smoothed.
// That distance becomes thickness: edges stay thin, the body puffs up like a filled jacket.
function edgeDistance(cut, GX, GY) {
  const N = GX * GY, d = new Float32Array(N), BIG = 1e6;
  for (let y = 0; y < GY; y++) for (let x = 0; x < GX; x++) {
    const mx = Math.min(cut.w - 1, Math.floor((x / (GX - 1)) * (cut.w - 1))), my = Math.min(cut.h - 1, Math.floor((y / (GY - 1)) * (cut.h - 1)));
    d[y * GX + x] = cut.mask[my * cut.w + mx] > 128 ? BIG : 0;
  }
  const at = (x, y) => (x < 0 || y < 0 || x >= GX || y >= GY ? 0 : d[y * GX + x]);
  for (let y = 0; y < GY; y++) for (let x = 0; x < GX; x++) {
    const k = y * GX + x; if (!d[k]) continue;
    d[k] = Math.min(d[k], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.414, at(x + 1, y - 1) + 1.414);
  }
  for (let y = GY - 1; y >= 0; y--) for (let x = GX - 1; x >= 0; x--) {
    const k = y * GX + x; if (!d[k]) continue;
    d[k] = Math.min(d[k], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.414, at(x - 1, y + 1) + 1.414);
  }
  for (let pass = 0; pass < 4; pass++) {
    const c = Float32Array.from(d);
    for (let y = 1; y < GY - 1; y++) for (let x = 1; x < GX - 1; x++) {
      const k = y * GX + x; if (!c[k]) continue;
      d[k] = (c[k] * 4 + c[k - 1] + c[k + 1] + c[k - GX] + c[k + GX]) / 8;
    }
  }
  return d;
}
// grey relief from the photo: the quilting lines and seams become real bumps under the light
function reliefTexture(cut) {
  const c = document.createElement("canvas"); c.width = cut.w; c.height = cut.h;
  const g = c.getContext("2d"); g.drawImage(cut.canvas, 0, 0);
  const im = g.getImageData(0, 0, cut.w, cut.h), px = im.data;
  // outside the garment, use the garment's own average brightness, so the edge has no false ridge
  let sum = 0, n = 0;
  for (let k = 0; k < px.length; k += 4) if (px[k + 3] > 200) { sum += px[k] * 0.3 + px[k + 1] * 0.59 + px[k + 2] * 0.11; n++; }
  const mid = n ? sum / n : 128;
  for (let k = 0; k < px.length; k += 4) {
    const a = px[k + 3] / 255, l = px[k] * 0.3 + px[k + 1] * 0.59 + px[k + 2] * 0.11;
    px[k] = px[k + 1] = px[k + 2] = l * a + mid * (1 - a); px[k + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  return new THREE.CanvasTexture(c);
}
function addGarment(p, cut) {
  const gw = GARMENT_W, gh = gw * (cut.h / cut.w);
  const GX = PHONE ? 80 : 128, GY = Math.max(20, Math.round(GX * (cut.h / cut.w)));
  const dist = edgeDistance(cut, GX, GY);
  const R = GX * 0.2; // cells over which the edge rolls round
  // smoothstep: the padding rises gently from the outline, so the edge isn't shaded as a hard dark rim
  const thick = (k) => { const t = Math.min(dist[k] / R, 1); return t * t * (3 - 2 * t); };
  const build = (front) => {
    const geo = new THREE.PlaneGeometry(gw, gh, GX - 1, GY - 1);
    const pos = geo.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const u = pos.getX(k) / (gw / 2);
      const body = 1 - 0.35 * u * u;                       // a chest inside: middle fuller than the sleeves
      const z = thick(k) * body * (front ? 0.065 : 0.045);
      pos.setZ(k, front ? z : -z);
    }
    geo.computeVertexNormals();
    return geo;
  };
  const map = cutTexture(cut), bump = reliefTexture(cut);
  const frontMat = new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0.16, bumpMap: bump, bumpScale: 0.7, roughness: 0.78, envMapIntensity: 0.3, side: THREE.DoubleSide, alphaTest: 0.5, alphaToCoverage: true });
  const backMat = new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0.08, bumpMap: bump, bumpScale: 0.45, color: 0xa29b94, roughness: 0.82, envMapIntensity: 0.25, side: THREE.DoubleSide, alphaTest: 0.5, alphaToCoverage: true });
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5 });
  const cloth = new THREE.Group();
  const front = new THREE.Mesh(build(true), frontMat), back = new THREE.Mesh(build(false), backMat);
  back.scale.set(0.985, 0.99, 1); back.position.y = 0.002; // tucked just inside the front's outline
  for (const m of [front, back]) { m.customDepthMaterial = depth; m.castShadow = m.receiveShadow = true; m.userData = { kind: "garment", cut }; cloth.add(m); }
  cloth.position.set(0, -0.085 - gh / 2, 0.012);

  const yaw = new THREE.Group(), swing = new THREE.Group();
  yaw.add(swing); swing.add(makeHanger()); swing.add(cloth);
  wardrobe.add(yaw);
  const it = { p, cut, mesh: front, meshes: [front, back], yaw, swing, x: 0, tx: 0, vx: 0, z: 0, y: RAIL_Y, ry: -0.65, a: 0, av: 0, b: 0, bv: 0, gh, out: 0 };
  front.userData.item = back.userData.item = it;
  garments.push(it);
  return it;
}
let hovered = null, focusIdx = -1;
function layoutRail() {
  const n = garments.length; if (!n) return;
  const span = Math.min(IN_W - GARMENT_W * 0.7, 0.24 * (n - 1));
  const step = n > 1 ? span / (n - 1) : 0;
  garments.forEach((g, i) => {
    let x = -span / 2 + i * step;
    if (focusIdx >= 0 && i !== focusIdx) x += (i < focusIdx ? -1 : 1) * Math.min(0.12, step * 0.6);
    g.tx = clamp(x, -IN_W / 2 + 0.2, IN_W / 2 - 0.2);
  });
}

// ---------- drawers with fragrances ----------
const drawers = [];   // the ones holding fragrances (the dock and dots use these)
const allDrawers = []; // every drawer, so an empty one still opens
function makeDrawer(i, count) {
  const y = PLINTH + T + i * DRAWER_H; // bottom of this drawer slot
  const g = new THREE.Group();
  g.position.set(0, y, 0);
  wardrobe.add(g);
  const fw = IN_W - 0.01, fh = DRAWER_H - 0.006, depth = D - 0.08;
  const front = box(fw, DRAWER_H - 0.004, T, charcoal, 0, (DRAWER_H - 0.004) / 2 + 0.002, D / 2 - T / 2 - 0.002, g); // fronts meet with a hairline gap
  front.userData.kind = "drawer";
  // a brass inlay frame and a centred leather pull; no labels, the way a good chest of drawers looks
  inlay(g, fw, fh - 0.006, 0, (fh - 0.006) / 2 + 0.004, D / 2 - 0.0015, 0.028);
  const pullD = leatherPull(0.34, false); pullD.position.set(0, (fh - 0.006) / 2 + 0.004, D / 2 + 0.032); g.add(pullD);
  pullD.traverse((o) => { o.userData.kind = "drawer"; });
  // the box: sides, back, velvet floor
  const bx = new THREE.Group(); g.add(bx);
  const bw = fw - 0.03, bh = fh - 0.05, bz = D / 2 - T - depth / 2;
  box(bw, 0.01, depth, oakDark, 0, 0.012, bz, bx);
  const felt = box(bw - 0.03, 0.004, depth - 0.03, velvet, 0, 0.019, bz, bx); felt.castShadow = false;
  box(0.012, bh, depth, oakDark, -bw / 2, bh / 2 + 0.01, bz, bx);
  box(0.012, bh, depth, oakDark, bw / 2, bh / 2 + 0.01, bz, bx);
  box(bw, bh, 0.012, oakDark, 0, bh / 2 + 0.01, bz - depth / 2, bx);
  g.traverse((o) => { if (o.isMesh && !o.userData.kind) o.userData.kind = "drawerbox"; o.userData.drawer = i; });
  const dr = { i, g, open: 0, target: 0, y, floorY: 0.021, depth, bz, bottles: [], count };
  drawers.push(dr); allDrawers.push(dr);
  return dr;
}
const OPEN_DEPTH = 0.56; // full-extension runners: the whole tray comes clear of the shelf above
// Fragrances stand in the drawer as boxes with the real photo on the front, leaning back like
// records in a crate. (Perfume photos are often hand-held or on busy tables, so they aren't cut out.)
function photoFace(img) {
  const c = document.createElement("canvas"); c.width = 384; c.height = 512;
  const g = c.getContext("2d");
  const ar = img.naturalWidth / img.naturalHeight, tr = 3 / 4;
  let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
  if (ar > tr) { sw = sh * tr; sx = (img.naturalWidth - sw) / 2; } else { sh = sw / tr; sy = (img.naturalHeight - sh) / 2; }
  g.drawImage(img, sx, sy, sw, sh, 0, 0, 384, 512);
  const d = g.getImageData(0, 0, 384, 512).data; let r = 0, gg = 0, b = 0, n = 0;
  for (let k = 0; k < d.length; k += 4 * 97) { r += d[k]; gg += d[k + 1]; b += d[k + 2]; n++; }
  // a thin white printed border, like a label
  g.strokeStyle = "rgba(255,255,255,.85)"; g.lineWidth = 10; g.strokeRect(5, 5, 374, 502);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const tone = new THREE.Color().setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace).multiplyScalar(0.3);
  // the bottle's own colours: the middle of the photo is the glass, a little above it the cap
  const avg = (x0, y0, x1, y1) => {
    const im = g.getImageData(x0, y0, x1 - x0, y1 - y0).data; const v = [];
    for (let k = 0; k < im.length; k += 4 * 7) v.push([im[k], im[k + 1], im[k + 2]]);
    v.sort((a, b2) => a[0] + a[1] + a[2] - (b2[0] + b2[1] + b2[2]));
    const m = v[v.length >> 1];
    return new THREE.Color().setRGB(m[0] / 255, m[1] / 255, m[2] / 255, THREE.SRGBColorSpace);
  };
  return { map: t, tone, glass: avg(150, 250, 234, 380), cap: avg(165, 120, 219, 190) };
}
const BOX_W = 0.13, BOX_H = 0.17, BOX_D = 0.05, LEAN = 0.42, LEAN_OUT = 0.7;
const hash = (str) => { let h = 2166136261; for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
// A glass bottle with liquid, a collar, a cap and a printed label. Its tint and cap colour come from the photo;
// the shape is one of a few classic bottle forms (the photo can't tell us the real one).
function makeBottle(p, face) {
  const g = new THREE.Group(), h = hash(p.id), shape = h % 3;
  const tint = face.glass.clone(), hsl = {}; tint.getHSL(hsl, THREE.SRGBColorSpace);
  const liquid = new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 1.2 + 0.08), clamp(hsl.l, 0.12, 0.7), THREE.SRGBColorSpace);
  // dark bottles in the photo are painted or smoked glass: nearly opaque, glossy; light ones are clear tinted glass
  const painted = hsl.l < 0.32;
  const glass = painted
    ? new THREE.MeshPhysicalMaterial({ color: tint.clone().multiplyScalar(0.8), roughness: 0.1, metalness: 0, transparent: true, opacity: 0.96, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.1 })
    : new THREE.MeshPhysicalMaterial({ color: new THREE.Color().setHSL(hsl.h, hsl.s * 0.5, 0.82, THREE.SRGBColorSpace), roughness: 0.04, metalness: 0, transparent: true, opacity: 0.34, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 2.4, depthWrite: false });
  const juice = new THREE.MeshPhysicalMaterial({ color: liquid, roughness: 0.15, transparent: true, opacity: 0.88, clearcoat: 0.6, envMapIntensity: 1.2 });
  const base = new THREE.MeshPhysicalMaterial({ color: liquid.clone().multiplyScalar(0.6), roughness: 0.05, transparent: true, opacity: 0.9, clearcoat: 1 });
  const capC = face.cap.clone(), ch = {}; capC.getHSL(ch, THREE.SRGBColorSpace);
  const metallic = ch.s < 0.25 || (ch.h > 0.08 && ch.h < 0.17); // greys, silvers, golds read as metal
  const capMat = new THREE.MeshStandardMaterial({ color: ch.l < 0.12 ? new THREE.Color(0x111111) : capC, metalness: metallic ? 0.9 : 0.2, roughness: metallic ? 0.22 : 0.35 });
  let bw, bh, bd, body, inner;
  if (shape === 0) { bw = 0.085; bh = 0.095; bd = 0.04; body = new RoundedBoxGeometry(bw, bh, bd, 5, 0.012); inner = new RoundedBoxGeometry(bw - 0.012, bh * 0.82, bd - 0.012, 4, 0.008); }
  else if (shape === 1) { bw = bd = 0.06; bh = 0.11; body = new THREE.CylinderGeometry(0.03, 0.03, bh, 40); inner = new THREE.CylinderGeometry(0.025, 0.025, bh * 0.82, 32); }
  else { bw = bd = 0.055; bh = 0.115; body = new RoundedBoxGeometry(bw, bh, bd, 5, 0.009); inner = new RoundedBoxGeometry(bw - 0.01, bh * 0.82, bd - 0.01, 4, 0.006); }
  const thick = new THREE.Mesh(shape === 1 ? new THREE.CylinderGeometry(0.03, 0.03, 0.012, 40) : new RoundedBoxGeometry(bw, 0.012, bd, 3, 0.004), base);
  thick.position.y = 0.006; g.add(thick);
  const liq = new THREE.Mesh(inner, juice); liq.position.y = 0.012 + (bh * 0.82) / 2; liq.renderOrder = 1; g.add(liq);
  const shell = new THREE.Mesh(body, glass); shell.position.y = bh / 2; shell.renderOrder = 2; g.add(shell);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.012, 0.012, 24), chrome); collar.position.y = bh + 0.006; g.add(collar);
  const cap = h % 2
    ? new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.032, 32), capMat)
    : new THREE.Mesh(new RoundedBoxGeometry(Math.min(bw * 0.6, 0.045), 0.034, Math.min(bd * 0.9, 0.04), 3, 0.004), capMat);
  cap.position.y = bh + 0.012 + 0.017; g.add(cap);
  // label: brand and name, printed on the front
  const lc = document.createElement("canvas"); lc.width = 256; lc.height = 256;
  const lg = lc.getContext("2d"), dark = hsl.l > 0.55;
  lg.fillStyle = dark ? "#151310" : "#f4efe6"; lg.textAlign = "center"; lg.textBaseline = "middle";
  const brand = String(p.brand || "").toUpperCase().slice(0, 16);
  const name = String(p.name || "").replace(new RegExp(String(p.brand || "^$").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "").replace(/fragrance|perfume|edp|edt|for men|for women|"/gi, "").trim().split(/\s+/).slice(0, 3).join(" ").toUpperCase();
  lg.font = "800 34px Archivo, sans-serif"; lg.fillText(brand, 128, 108, 236);
  lg.font = "500 20px 'IBM Plex Mono', monospace"; lg.fillText(name, 128, 150, 236);
  lg.fillRect(98, 178, 60, 2);
  const lt = new THREE.CanvasTexture(lc); lt.colorSpace = THREE.SRGBColorSpace; lt.anisotropy = 8;
  const labelW = Math.min(bw * 0.92, 0.07);
  const label = new THREE.Mesh(new THREE.PlaneGeometry(labelW, labelW), new THREE.MeshStandardMaterial({ map: lt, transparent: true, roughness: 0.4, depthWrite: false }));
  label.position.set(0, bh * 0.5, (shape === 1 ? 0.0302 : bd / 2 + 0.0006)); label.renderOrder = 3;
  if (shape === 1) { label.geometry = new THREE.CylinderGeometry(0.0302, 0.0302, labelW, 32, 1, true, -0.6, 1.2); label.rotation.y = 0; label.position.z = 0; label.material.side = THREE.FrontSide; }
  g.add(label);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = o !== label; o.receiveShadow = true; } });
  return { group: g, height: bh + 0.05 };
}
function addBottle(dr, p, face, slot, slots) {
  const oneRow = slots <= 4; // a few pieces: one calm row, spaced like a display
  const cols = oneRow ? slots : Math.ceil(slots / 2), row = oneRow || slot < cols ? 0 : 1, col = row ? slot - cols : slot;
  const rowCount = oneRow ? slots : row ? slots - cols : cols;
  const side = new THREE.MeshStandardMaterial({ color: face.tone, roughness: 0.5, metalness: 0.1 });
  const top = new THREE.MeshStandardMaterial({ color: face.tone.clone().multiplyScalar(1.4), roughness: 0.5 });
  const front = new THREE.MeshStandardMaterial({ map: face.map, roughness: 0.35 });
  const m = new THREE.Mesh(new THREE.BoxGeometry(BOX_W, BOX_H, BOX_D), [side, side, top, side, front, side]);
  m.castShadow = true; m.receiveShadow = true;
  m.position.set(0, BOX_H / 2, -BOX_D / 2);
  const boxPivot = new THREE.Group(); boxPivot.position.set(-0.06, 0, -0.02); boxPivot.add(m);
  const usable = oneRow ? Math.min(IN_W - 0.34, slots * 0.42) : IN_W - 0.34, step = usable / Math.max(cols, 1);
  const stagger = oneRow ? 0 : rowCount < cols ? (row ? step / 2 : 0) : (row ? step / 4 : -step / 4);
  const x = -usable / 2 + step * (col + 0.5) + stagger;
  const z = dr.bz + (oneRow ? -0.02 : row ? -0.15 : 0.04); // clear of the tall drawer front
  const holder = new THREE.Group();
  holder.position.set(clamp(x, -usable / 2, usable / 2), dr.floorY, z);
  holder.rotation.y = (Math.random() - 0.5) * 0.12;
  holder.add(boxPivot);
  const bottle = makeBottle(p, face);
  bottle.group.scale.setScalar(1.3);
  bottle.group.position.set(0.075, 0, 0.045);
  bottle.group.rotation.y = -0.12 + (Math.random() - 0.5) * 0.08; // facing you, just off square
  holder.add(bottle.group);
  dr.g.add(holder);
  const it = { p, mesh: m, holder, boxPivot, bottle: bottle.group, home: holder.position.clone(), homeRy: holder.rotation.y, lift: 0, hover: 0, out: 0, dr, box: true, face };
  m.userData = { kind: "bottle", item: it };
  bottle.group.traverse((o) => { if (o.isMesh) o.userData = { kind: "bottle", item: it }; });
  dr.bottles.push(it);
  return it;
}
const blobTex = (() => {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"), r = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  r.addColorStop(0, "rgba(0,0,0,.7)"); r.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
let openDrawer = -1;
function toggleDrawer(i) {
  if (!doorsOpen) return setDoors(true);
  closePanel();
  openDrawer = openDrawer === i ? -1 : i;
  allDrawers.forEach((d) => { d.target = d.i === openDrawer ? 1 : 0; });
  view = openDrawer >= 0 ? `drawer${openDrawer}` : "all";
  paintDock();
  if (openDrawer >= 0 && !allDrawers.find((d) => d.i === openDrawer).bottles.length) return flashHint("This drawer is being curated");
  if (openDrawer >= 0 && camera.aspect < 0.8) flashHint("← Swipe along the drawer →");
}
function closeDrawers() { openDrawer = -1; allDrawers.forEach((d) => { d.target = 0; }); if (view.startsWith("drawer")) view = "all"; }

// ---------- shelf: anything that isn't clothing or a fragrance ----------
const shelfItems = [];
function addShelfItem(p, cut, i, n) {
  const hh = 0.22, ww = hh * (cut.w / cut.h);
  const { mat, depth } = cutMaterials(cut);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(ww, hh), mat);
  m.customDepthMaterial = depth; m.castShadow = true;
  const holder = new THREE.Group();
  const usable = IN_W - 0.3;
  holder.position.set(n > 1 ? -usable / 2 + (usable * (i + 0.5)) / n : 0, SHELF_Y + T / 2, 0.05);
  m.position.y = hh / 2; holder.add(m); wardrobe.add(holder);
  const it = { p, cut, mesh: m, holder, home: holder.position.clone(), homeRy: 0, lift: 0, hover: 0, out: 0 };
  m.userData = { kind: "shelf", item: it, cut };
  shelfItems.push(it);
}

// The top cubby: two lidded rigid gift boxes and a paper shopping bag, each with a small VIBE X mark,
// like the packaging shelf in a boutique. Each logo is drawn at its face's own proportions so it never stretches.
function logoTexture(wM, hM, bg, ink, size = 0.32) {
  const px = 600, c = document.createElement("canvas");
  c.width = px; c.height = Math.max(32, Math.round(px * (hM / wM)));
  const g = c.getContext("2d");
  g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  const fh = Math.round(c.height * size);
  g.font = `900 ${fh}px Archivo, sans-serif`; g.textBaseline = "middle";
  const wV = g.measureText("VIBE").width, gap = fh * 0.18, wX = g.measureText("X").width;
  let x = (c.width - (wV + gap + wX)) / 2; const y = c.height / 2 + fh * 0.04;
  g.fillStyle = ink; g.fillText("VIBE", x, y); g.fillStyle = "#e2382c"; g.fillText("X", x + wV + gap, y);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function giftBox(w, h, d, colour, ink, x, y, z, ry) {
  const grp = new THREE.Group();
  const plain = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.55 });
  const baseH = h * 0.78, lidH = h * 0.3;
  const front = new THREE.MeshStandardMaterial({ map: logoTexture(w, baseH, `#${new THREE.Color(colour).getHexString(THREE.SRGBColorSpace)}`, ink, 0.3), roughness: 0.55 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(w, baseH, d), [plain, plain, plain, plain, front, plain]);
  base.position.y = baseH / 2; grp.add(base);
  const lid = new THREE.Mesh(new RoundedBoxGeometry(w + 0.008, lidH, d + 0.008, 2, 0.003), plain);
  lid.position.y = h - lidH / 2; grp.add(lid);
  // a thin foil ring round the lid's bottom edge (four strips, so nothing sits on the lid's underside)
  const by = -lidH / 2 + 0.003, bw2 = w + 0.0095, bd2 = d + 0.0095, th = 0.004, depthB = 0.0012;
  for (const [bx2, bz2, sw, sd] of [[0, bd2 / 2, bw2, depthB], [0, -bd2 / 2, bw2, depthB], [bw2 / 2, 0, depthB, bd2], [-bw2 / 2, 0, depthB, bd2]]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(sw, th, sd), bronze); strip.position.set(bx2, by, bz2); lid.add(strip);
  }
  // crumpled tissue just under the lid, seen when it lifts
  const tg = new THREE.PlaneGeometry(w - 0.01, d - 0.01, 12, 10), tp = tg.attributes.position;
  for (let k = 0; k < tp.count; k++) { const x = tp.getX(k), y = tp.getY(k); tp.setZ(k, 0.006 + 0.005 * Math.sin(x * 38 + y * 9) * Math.cos(y * 31 - x * 5)); }
  tg.computeVertexNormals();
  const tissue = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.9, side: THREE.DoubleSide }));
  tissue.rotation.x = -Math.PI / 2; tissue.position.y = baseH - 0.006; grp.add(tissue);
  grp.position.set(x, y, z); grp.rotation.y = ry;
  grp.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  wardrobe.add(grp);
  lid.receiveShadow = false; // no shadow speckle inside the lifted lid
  return { grp, lid, lidY: lid.position.y };
}
function shoppingBag(w, h, d, x, y, z, ry) {
  const grp = new THREE.Group();
  const paper = new THREE.MeshStandardMaterial({ color: 0xf1ebe1, roughness: 0.85 });
  const face = new THREE.MeshStandardMaterial({ map: logoTexture(w, h, "#f1ebe1", "#161514", 0.12), roughness: 0.85 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [paper, paper, paper, paper, face, paper]);
  body.position.y = h / 2; grp.add(body);
  const rope = new THREE.MeshStandardMaterial({ color: 0x161514, roughness: 0.7 });
  for (const zz of [d / 2 - 0.004, -d / 2 + 0.004]) {
    const handle = new THREE.Mesh(new THREE.TorusGeometry(w * 0.2, 0.003, 8, 32, Math.PI), rope);
    handle.position.set(0, h - 0.004, zz); grp.add(handle);
  }
  grp.position.set(x, y, z); grp.rotation.y = ry;
  grp.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  wardrobe.add(grp);
  return { grp };
}
// The packaging on the top shelf is tappable too: the boxes open, the bag shows what's in yours.
const decos = [];
let allProducts = [];
function addDeco(obj, info, type, stackedOn) {
  obj.grp.traverse((o) => { if (o.isMesh) { o.receiveShadow = false; o.castShadow = o.parent === obj.grp && o !== obj.lid; } });
  const it = { ...obj, type, info, deco: true, home: obj.grp.position.clone(), homeRy: obj.grp.rotation.y, out: 0, outS: 0, hover: 0, hoverS: 0, stackedOn };
  obj.grp.traverse((o) => { if (o.isMesh) o.userData = { kind: "deco", item: it }; });
  decos.push(it);
  return it;
}
{
  const base = TOP_SHELF_Y + T / 2;
  const B = { address: "3rd Floor, Mustafa Mini Complex, Khanyaar, Srinagar" }; // as on the Contact page (shop.json)
  addDeco(giftBox(0.44, 0.13, 0.34, 0x151413, "#f4efe6", -0.5, base, 0, 0.04), () => {
    const pieces = [...garments, ...drawers.flatMap((d) => d.bottles), ...shelfItems].sort((a, b) => (b.p.price || 0) - (a.p.price || 0));
    return {
      eyebrow: "The Vibe X Edit", title: `${pieces.length} pieces, chosen by the store`,
      text: "Everything in this wardrobe, in one place. Tap a piece to go straight to it.",
      facts: ["Originals", "Khanyaar, Srinagar", "Courier across India"],
      list: pieces.map((it) => ({ p: it.p, go: () => goTo(it) })),
      cta: "Visit the store →", href: "/#visit",
    };
  }, "box");
  addDeco(giftBox(0.3, 0.1, 0.26, 0xe9e1d4, "#161514", -0.08, base, 0.02, -0.08), () => {
    const fresh = allProducts.filter((p) => p.image && p.status !== "sold").sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 6);
    return {
      eyebrow: "Just in", title: "Newest at the store",
      text: "The latest pieces on the shop, beyond the wardrobe.",
      facts: [], list: fresh.map((p) => ({ p, href: `/p/${encodeURIComponent(p.id)}?utm_source=wardrobe` })),
      cta: "See today's drops →", href: "/#rack",
    };
  }, "box");
  addDeco(shoppingBag(0.3, 0.24, 0.11, 0.48, base, 0.04, -0.12), async () => {
    const lines = await bagLines();
    const rows = lines.map((l) => ({ l, p: allProducts.find((p) => p.id === l.id) })).filter((r) => r.p);
    const n = rows.reduce((k, r) => k + (r.l.qty || 1), 0);
    const priceOf = (r) => (r.p.options || []).find((o) => o.size === r.l.size)?.price ?? r.p.price;
    const total = rows.reduce((k, r) => k + priceOf(r) * (r.l.qty || 1), 0);
    if (!n) {
      const start = [...garments, ...drawers.flatMap((d) => d.bottles)].sort((a, b) => (b.p.price || 0) - (a.p.price || 0)).slice(0, 3);
      return {
        eyebrow: "Your bag", title: "Your bag is empty",
        text: "A good place to start, from the wardrobe:", facts: [],
        list: start.map((it) => ({ p: it.p, go: () => goTo(it) })),
        cta: "Browse the shop →", href: "/#rack",
      };
    }
    return {
      eyebrow: "Your bag", title: `${n} piece${n === 1 ? "" : "s"} · ${rupees(total)}`,
      text: "Waiting for you. Check out whenever you're ready.", facts: [],
      list: rows.map((r) => ({ p: r.p, price: priceOf(r), meta: [r.l.size, (r.l.qty || 1) > 1 ? `× ${r.l.qty}` : ""].filter(Boolean).join(" "), href: `/p/${encodeURIComponent(r.p.id)}?utm_source=wardrobe` })),
      cta: "Open your bag →", href: "/bag",
    };
  }, "bag");
}
// jump from a card to a piece in the wardrobe: open its drawer if it has one, then pick it
function goTo(it) {
  closePanel();
  if (it.dr) {
    if (openDrawer !== it.dr.i) toggleDrawer(it.dr.i);
    setTimeout(() => openPanel(it), 650);
  } else {
    if (openDrawer >= 0) { closeDrawers(); paintDock(); }
    setTimeout(() => openPanel(it), 250);
  }
}
async function bagLines() {
  try { const m = await (await fetch("/api/account/me", { cache: "no-store" })).json(); if (m.signedIn) return m.bag || []; } catch { /* offline */ }
  try { return JSON.parse(localStorage.getItem("vx-bag") || "[]"); } catch { return []; }
}
// the same count the shop header shows: the phone's account once it has ordered, else this browser
async function bagCount() {
  const sum = (list) => (list || []).reduce((k, l) => k + (l.qty || 1), 0);
  try { const m = await (await fetch("/api/account/me", { cache: "no-store" })).json(); if (m.signedIn) return sum(m.bag); } catch { /* offline: use this browser */ }
  try { return sum(JSON.parse(localStorage.getItem("vx-bag") || "[]")); } catch { return 0; }
}

// ---------- camera views ----------
const VIEWS = {
  all: { target: [0, 1.22, 0], size: [2.25, 2.55], phoneW: 2.04, dir: [0, 0.06, 1] },
  rail: { target: [0, 1.55, 0.05], size: [2.0, 1.25], phoneW: 1.0, dir: [0, 0.02, 1] },
  top: { target: [0, 2.21, 0.12], size: [1.9, 0.5], phoneW: 0.8, dir: [0, -0.05, 1] },
};
for (let i = 0; i < DRAWERS_MAX; i++) VIEWS[`drawer${i}`] = { target: [0, PLINTH + T + i * DRAWER_H + 0.1, OPEN_DEPTH + 0.02], size: [1.75, 0.62], phoneW: 0.85, dir: [0, 0.85, 1], drawer: i }; // looking in at about 40°, like standing at the drawer
let view = "all";
const camPos = new THREE.Vector3(0, 1.4, 9), camLook = new THREE.Vector3(0, 1.2, 0);
const parallax = { x: 0, y: 0, tx: 0, ty: 0 };
let panX = 0, panView = "all";
function viewWidth(v) { return camera.aspect < 0.8 && v.phoneW ? v.phoneW : v.size[0]; }
function viewPose(name) {
  const v = VIEWS[name];
  const target = new THREE.Vector3(...v.target);
  if (panView !== name) { panView = name; panX = 0; }
  if (name === "top" && selected?.deco && camera.aspect < 0.8) panX = selected.home.x; // phones: centre the picked box
  const w = viewWidth(v), maxPan = Math.max(0, (v.size[0] - w) / 2);
  panX = clamp(panX, -maxPan, maxPan);
  target.x += panX;
  const dir = new THREE.Vector3(...v.dir).normalize();
  const fov = THREE.MathUtils.degToRad(camera.fov), aspect = camera.aspect;
  const dist = Math.max(v.size[1] / 2 / Math.tan(fov / 2), w / 2 / (Math.tan(fov / 2) * aspect)) * 1.04;
  return { pos: target.clone().addScaledVector(dir, dist), look: target };
}

// ---------- panel ----------
let selected = null;
const panel = $("panel");
async function openInfo(it) {
  if (selected && selected !== it) selected.out = 0;
  selected = it; it.out = 1;
  if (it.type === "bag") it.av = (it.av || 0) + 1.6; // a little swing as it's picked up
  const card = await it.info();
  if (selected !== it) return;
  $("brand").textContent = card.eyebrow;
  $("name").textContent = card.title;
  $("price").textContent = "";
  const facts = $("facts"); facts.textContent = "";
  for (const t of card.facts) { const li = document.createElement("li"); li.textContent = t; facts.appendChild(li); }
  $("desc").textContent = card.text;
  $("note").hidden = true;
  const list = $("list"); list.textContent = "";
  for (const row of card.list || []) {
    const a = document.createElement("a"); a.className = "wd-row";
    a.href = row.href || `/p/${encodeURIComponent(row.p.id)}`;
    if (row.go) a.addEventListener("click", (e) => { e.preventDefault(); row.go(); });
    const im = document.createElement("img"); im.src = row.p.image; im.alt = ""; im.loading = "lazy";
    const t = document.createElement("span"); t.className = "t";
    const b = document.createElement("small"); b.textContent = row.p.brand || row.p.category || "";
    const nm = document.createElement("b"); nm.textContent = row.p.name;
    t.append(b, nm);
    if (row.meta) { const m = document.createElement("small"); m.textContent = row.meta; t.append(m); }
    const pr = document.createElement("span"); pr.className = "pr"; pr.textContent = rupees(row.price ?? row.p.price);
    a.append(im, t, pr); list.appendChild(a);
  }
  list.hidden = !list.children.length;
  $("photos").textContent = ""; $("photos").hidden = true;
  const order = $("order"); order.href = card.href; order.textContent = card.cta; order.classList.add("sold");
  $("scroll").scrollTop = 0; panel.style.transform = "";
  panel.classList.add("open", "info"); panel.setAttribute("aria-hidden", "false");
  document.body.classList.add("has-panel");
  hideHint();
}
function openPanel(it) {
  if (it.deco) return openInfo(it);
  $("list").hidden = true;
  $("photos").hidden = false; panel.classList.remove("info");
  if (selected && selected !== it) selected.out = 0;
  selected = it;
  it.out = 1;
  const p = it.p;
  $("brand").textContent = p.brand || p.category || "";
  $("name").textContent = p.name;
  const price = $("price"); price.textContent = "";
  const b = document.createElement("b"); b.textContent = rupees(p.price); price.appendChild(b);
  if (p.mrp && p.mrp > p.price) {
    const s = document.createElement("s"); s.textContent = "MRP " + rupees(p.mrp); price.appendChild(s);
    const e = document.createElement("em"); e.textContent = Math.round((1 - p.price / p.mrp) * 100) + "% off"; price.appendChild(e);
  }
  const facts = $("facts"); facts.textContent = "";
  const add = (t, cls) => { const li = document.createElement("li"); li.textContent = t; if (cls) li.className = cls; facts.appendChild(li); };
  if (p.sizes) add(p.sizes);
  if (p.subcategory) add(p.subcategory);
  if (p.status === "sold") add("Sold", "sold");
  else if (p.status === "hold" || p.status === "held") add("On hold", "sold");
  else if (p.quantity === 1) add("Only 1 left");
  $("desc").textContent = p.description || p.caption || "";
  $("note").hidden = /pick it up|courier/i.test($("desc").textContent);
  const photos = $("photos"); photos.textContent = "";
  for (const src of [p.image, ...(p.images || [])].filter(Boolean)) {
    const im = document.createElement("img"); im.src = src; im.alt = p.name; im.loading = "lazy"; photos.appendChild(im);
  }
  const order = $("order");
  order.href = `/p/${encodeURIComponent(p.id)}?utm_source=wardrobe`;
  order.textContent = p.status === "sold" ? "See the piece →" : "View and order →";
  order.classList.toggle("sold", p.status === "sold");
  $("scroll").scrollTop = 0; $("photos").scrollLeft = 0; panel.style.transform = "";
  panel.classList.add("open"); panel.setAttribute("aria-hidden", "false");
  document.body.classList.add("has-panel");
  hideHint();
}
function closePanel() {
  panel.style.transform = "";
  if (selected) selected.out = 0;
  selected = null;
  panel.classList.remove("open"); panel.setAttribute("aria-hidden", "true");
  document.body.classList.remove("has-panel");
}
$("close").addEventListener("click", closePanel);
{
  let sy0 = null, dy = 0;
  const start = (e) => {
    if (innerWidth > 760) return;
    if (e.currentTarget.id === "scroll" && $("scroll").scrollTop > 0) return;
    sy0 = e.clientY; dy = 0; panel.classList.add("dragging");
  };
  const move = (e) => {
    if (sy0 == null) return;
    dy = Math.max(0, e.clientY - sy0);
    if (dy > 4) { panel.style.transform = `translateY(${dy}px)`; e.preventDefault?.(); }
  };
  const end = () => {
    if (sy0 == null) return;
    panel.classList.remove("dragging"); sy0 = null;
    if (dy > 90) closePanel(); else panel.style.transform = "";
    dy = 0;
  };
  for (const id of ["grab", "scroll"]) {
    $(id).addEventListener("pointerdown", start);
    $(id).addEventListener("pointermove", move, { passive: false });
  }
  addEventListener("pointerup", end); addEventListener("pointercancel", end);
}
addEventListener("keydown", (e) => { if (e.key === "Escape") { if (selected) closePanel(); else if (openDrawer >= 0) toggleDrawer(openDrawer); } });

// ---------- dock ----------
function paintDock() {
  const dock = $("dock"); dock.textContent = "";
  const narrow = innerWidth < 560;
  const btn = (label, n, pressed, fn, aria, cls) => {
    const b = document.createElement("button"); b.type = "button"; b.textContent = label;
    if (cls) b.className = cls;
    if (aria) b.setAttribute("aria-label", aria);
    if (n != null) { const s = document.createElement("span"); s.className = "n"; s.textContent = n; b.appendChild(s); }
    b.setAttribute("aria-pressed", pressed ? "true" : "false"); b.addEventListener("click", fn); dock.appendChild(b);
    return b;
  };
  const sep = () => { const i = document.createElement("i"); i.className = "sep"; dock.appendChild(i); };
  if (!doorsOpen) return btn("Open the wardrobe", null, false, () => setDoors(true));
  btn(narrow ? "All" : "The Wardrobe", null, view === "all", () => { closePanel(); closeDrawers(); view = "all"; paintDock(); }, "The whole wardrobe");
  if (garments.length) btn("Outerwear", narrow ? null : garments.length, view === "rail", () => { closePanel(); closeDrawers(); view = "rail"; paintDock(); if (camera.aspect < 0.8) flashHint("← Swipe along the rail →"); }, `Outerwear, ${garments.length} pieces`);
  if (drawers.length) {
    const total = drawers.reduce((n, d) => n + d.bottles.length, 0);
    btn("Fragrances", narrow ? null : total, openDrawer >= 0, () => toggleDrawer(openDrawer >= 0 ? openDrawer : drawers[0].i), `Fragrances, ${total} pieces`);
    // more than one drawer: quiet dots to move between them, no numbers
    if (openDrawer >= 0 && drawers.length > 1) drawers.forEach((d, k) => {
      const b = btn("", null, openDrawer === d.i, () => { if (openDrawer !== d.i) toggleDrawer(d.i); }, `Drawer ${k + 1} of ${drawers.length}`, "dot");
      b.innerHTML = '<i aria-hidden="true"></i>';
    });
  }
  sep();
  const x = btn("", null, false, () => setDoors(false), "Close the wardrobe");
  x.innerHTML = '<span class="x" aria-hidden="true">×</span>';
}
// nothing picked yet: a quiet note instead of an empty cabinet
function curating() {
  const d = document.createElement("div"); d.className = "wd-fail";
  d.innerHTML = '<div><p style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;opacity:.7">The Wardrobe</p><h2 style="font-weight:800;margin:.3em 0">Being curated</h2><p>New pieces arrive here soon.</p><p><a href="/#rack">See today\'s drops →</a></p></div>';
  document.body.appendChild(d);
}
let lastNarrow = innerWidth < 560;
addEventListener("resize", () => { const n = innerWidth < 560; if (n !== lastNarrow) { lastNarrow = n; paintDock(); } });
let hintTimer;
function hideHint() { $("hint").style.opacity = 0; clearTimeout(hintTimer); }
function flashHint(t) { const h = $("hint"); h.textContent = t; h.style.opacity = 1; clearTimeout(hintTimer); hintTimer = setTimeout(hideHint, 2600); }

// ---------- picking ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
const pickables = () => {
  const list = doors.map((d) => d.pivot);
  if (doorsOpen) { garments.forEach((g) => list.push(...g.meshes)); allDrawers.forEach((d) => list.push(d.g)); shelfItems.forEach((s) => list.push(s.mesh)); decos.forEach((d) => list.push(d.grp)); }
  return list;
};
function alphaAt(cut, uv) {
  if (!cut || !cut.ok) return 255;
  const x = clamp(Math.floor(uv.x * cut.w), 0, cut.w - 1), y = clamp(Math.floor((1 - uv.y) * cut.h), 0, cut.h - 1);
  return cut.mask[y * cut.w + x];
}
function pick(cx, cy) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  for (const h of ray.intersectObjects(pickables(), true)) {
    const u = h.object.userData;
    if (u.cut && h.uv && alphaAt(u.cut, h.uv) < 128) continue; // went through the empty part of a photo
    if (u.kind) return { kind: u.kind, obj: h.object, item: u.item, drawer: u.drawer, point: h.point };
    return null;
  }
  return null;
}

let down = null, last = null;
const el = renderer.domElement;
el.addEventListener("pointermove", (e) => {
  const r = el.getBoundingClientRect();
  parallax.tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
  parallax.ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
  const vx = last ? (e.clientX - last.x) : 0;
  last = { x: e.clientX, y: e.clientY };
  const hit = pick(e.clientX, e.clientY);
  // brushing through the hangers: whatever the pointer passes over swings with it
  if (hit && hit.kind === "garment" && !hit.item.out) {
    const it = hit.item;
    it.av += clamp(vx * (e.pointerType === "touch" ? 0.012 : 0.006), -0.6, 0.6);
    it.bv += clamp(Math.abs(vx) * 0.002, 0, 0.2);
    if (e.pointerType === "mouse" && hovered !== it) { hovered = it; focusIdx = garments.indexOf(it); layoutRail(); }
  } else if (e.pointerType === "mouse" && hovered && !(hit && hit.kind === "garment")) { hovered = null; focusIdx = -1; layoutRail(); }
  bottleHover(hit);
  el.style.cursor = hit && hit.kind !== "drawerbox" ? "pointer" : "default";
  // swiping sideways looks along the rail or the drawer when it doesn't all fit (phones)
  if (down && panView !== "all" && !selected) { const v = VIEWS[panView]; panX -= (e.clientX - down.x) * (viewWidth(v) / innerWidth); }
  if (down) { down.moved += Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y); down.x = e.clientX; down.y = e.clientY; }
});
el.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, moved: 0 }; last = { x: e.clientX, y: e.clientY }; });
el.addEventListener("pointerleave", () => { parallax.tx = parallax.ty = 0; if (hovered) { hovered = null; focusIdx = -1; layoutRail(); } bottleHover(null); });
el.addEventListener("pointerup", (e) => {
  const moved = down ? down.moved : 0; down = null;
  if (moved > 14) return; // that was a brush or a swipe, not a tap
  const hit = pick(e.clientX, e.clientY);
  hideHint();
  if (!hit) { if (selected) closePanel(); return; }
  if (hit.kind === "door") { if (!doorsOpen) return setDoors(true); for (const d of doors) d.v = (d.v || 0) - 0.8; return; } // an open door just gives a little; "Close" is in the dock
  if (hit.kind === "drawer" || (hit.kind === "drawerbox" && openDrawer !== hit.drawer)) return toggleDrawer(hit.drawer);
  if (hit.kind === "garment") {
    if (selected === hit.item) return closePanel();
    if (openDrawer >= 0) { closeDrawers(); paintDock(); }
    hit.item.av += 0.25;
    return openPanel(hit.item);
  }
  if (hit.kind === "bottle" || hit.kind === "shelf" || hit.kind === "deco") {
    if (hit.kind === "deco" && openDrawer >= 0) { closeDrawers(); paintDock(); }
    return selected === hit.item ? closePanel() : openPanel(hit.item);
  }
  if (selected) closePanel();
});
let hoverBottle = null;
function bottleHover(hit) {
  const it = hit && (hit.kind === "bottle" || hit.kind === "shelf" || hit.kind === "deco") ? hit.item : null;
  if (hoverBottle && hoverBottle !== it) hoverBottle.hover = 0;
  hoverBottle = it; if (it) it.hover = 1;
}

// ---------- size ----------
let viewShiftX = 0, viewShiftY = 0;
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

// ---------- the loop ----------
const clock = new THREE.Clock();
let started = false, t0 = 0;
const tmpV = new THREE.Vector3(), tmpW = new THREE.Vector3();
function frame() {
  const dt = Math.min(clock.getDelta(), 1 / 30), now = clock.elapsedTime;

  // doors swing with a little overshoot, like a heavy door on good hinges
  let openAmt = 0;
  for (const d of doors) {
    const k = 9, c = 4.4; // heavy doors: an unhurried swing with a soft settle
    d.v = (d.v || 0) + ((d.target - d.angle) * k - (d.v || 0) * c) * dt;
    d.angle += d.v * dt;
    d.pivot.rotation.y = d.side * d.angle;
    openAmt = Math.max(openAmt, clamp(d.angle / DOOR_OPEN, 0, 1));
  }
  inside.intensity = 0.7 * openAmt;
  for (const sp of railSpots) sp.intensity = 2.6 * openAmt;
  ledMat.emissiveIntensity = 2.6 * openAmt;

  // garments: slide along the rail, swing on the hook, settle like real cloth on a hanger
  for (const g of garments) {
    const prevV = g.vx;
    g.vx += ((g.tx - g.x) * 60 - g.vx * 13) * dt;
    g.x += g.vx * dt;
    const accel = (g.vx - prevV) / Math.max(dt, 1e-4);
    g.av += (-g.a * 38 - g.av * 2.2 - accel * 0.035) * dt;  // pendulum on the hook
    g.a += g.av * dt;
    g.bv += (-g.b * 30 - g.bv * 2.6) * dt;
    g.b += g.bv * dt;
    g.a = clamp(g.a, -0.5, 0.5); g.b = clamp(g.b, -0.35, 0.35);
    if (!REDUCED) g.a += Math.sin(now * 0.9 + g.x * 7) * 0.00025; // the air in the room
    const isFocus = hovered === g;
    const outT = g.out ? 1 : 0;
    g.outS = damp(g.outS || 0, outT, 6, dt);
    const ryT = g.out ? Math.sin(now * 0.6) * 0.18 : isFocus ? -0.12 : -0.65;
    g.ry = damp(g.ry, ryT, 7, dt);
    g.yaw.position.set(g.x * (1 - g.outS), RAIL_Y + g.outS * 0.04, g.outS * 0.32);
    g.yaw.rotation.y = g.ry;
    g.swing.rotation.set(g.b, 0, g.a);
  }

  // drawers: glide out on runners, slight bounce at the stop
  let litDrawer = null;
  for (const d of allDrawers) {
    d.v = (d.v || 0) + ((d.target - d.open) * 70 - (d.v || 0) * 15) * dt;
    d.open += d.v * dt;
    d.g.position.z = d.open * OPEN_DEPTH;
    if (d.open > 0.3) litDrawer = d;
    for (const b of d.bottles) liftItem(b, dt, now);
  }
  for (const s of shelfItems) liftItem(s, dt, now);
  for (const d of decos) {
    d.outS = damp(d.outS, d.out ? 1 : 0, 6, dt);
    d.hoverS = damp(d.hoverS, d.hover ? 1 : 0, 10, dt);
    const lifted = d.stackedOn ? d.stackedOn.outS * 0.04 : 0; // the top box rides up if the one under it opens
    d.grp.position.set(d.home.x, d.home.y + d.hoverS * 0.008 + d.outS * 0.03 + lifted, d.home.z + d.outS * 0.1);
    d.grp.rotation.y = d.homeRy * (1 - d.outS);
    if (d.lid) { // the lid lifts off and tips back
      d.lid.position.y = d.lidY + d.outS * 0.07;
      d.lid.position.z = -d.outS * 0.05;
      d.lid.rotation.x = -d.outS * 0.55;
    }
    if (d.type === "bag") { // swings from its handles
      d.av = (d.av || 0) + (-(d.a || 0) * 40 - (d.av || 0) * 4) * dt;
      d.a = (d.a || 0) + d.av * dt;
      d.grp.rotation.z = d.a * 0.12;
    }
  }
  if (litDrawer) {
    drawerLight.position.set(0, litDrawer.y + 0.55, litDrawer.open * OPEN_DEPTH + 0.35);
    drawerLight.intensity = damp(drawerLight.intensity, 1.4, 6, dt);
  } else drawerLight.intensity = damp(drawerLight.intensity, 0, 6, dt);

  // camera: glide to the chosen view, lean a little with the pointer
  const pose = viewPose(selected?.deco ? "top" : selected && selected.dr == null && garments.includes(selected) ? "rail" : view);
  parallax.x = damp(parallax.x, REDUCED ? 0 : parallax.tx, 3, dt);
  parallax.y = damp(parallax.y, REDUCED ? 0 : parallax.ty, 3, dt);
  tmpV.copy(pose.pos);
  tmpV.x += parallax.x * 0.22; tmpV.y -= parallax.y * 0.12;
  const rate = started ? 2.6 : 1.2;
  camPos.x = damp(camPos.x, tmpV.x, rate, dt); camPos.y = damp(camPos.y, tmpV.y, rate, dt); camPos.z = damp(camPos.z, tmpV.z, rate, dt);
  tmpW.copy(pose.look);
  camLook.x = damp(camLook.x, tmpW.x, rate, dt); camLook.y = damp(camLook.y, tmpW.y, rate, dt); camLook.z = damp(camLook.z, tmpW.z, rate, dt);
  camera.position.copy(camPos);
  camera.lookAt(camLook);

  // keep the picked piece clear of the panel: right side on wide screens, bottom sheet on phones
  const wide = innerWidth > 760;
  const sx = selected && wide ? Math.min(420, innerWidth * 0.32) / 2 : 0;
  const sy = selected && !wide ? Math.min(panel.offsetHeight, innerHeight * 0.64) * 0.5 : 0;
  viewShiftX = damp(viewShiftX, sx, 6, dt); viewShiftY = damp(viewShiftY, sy, 6, dt);
  if (viewShiftX > 0.5 || viewShiftY > 0.5) camera.setViewOffset(innerWidth, innerHeight, viewShiftX, viewShiftY, innerWidth, innerHeight);
  else camera.clearViewOffset();

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
function liftItem(b, dt, now) {
  const tgt = b.out ? 1 : 0;
  b.outS = damp(b.outS || 0, tgt, 6, dt);
  b.hoverS = damp(b.hoverS || 0, b.hover ? 1 : 0, 10, dt);
  if (b.box) {
    // picked: the bottle and its box rise together clear of the drawer front, upright, tipped
    // slightly towards you, and the bottle turns gently in the light. Nothing tumbles or swells.
    b.holder.scale.setScalar(1 + b.outS * 0.3);
    b.holder.position.set(b.home.x * (1 - b.outS), b.home.y + b.hoverS * 0.012 + b.outS * 0.24, b.home.z + b.outS * (0.2 - b.home.z));
    b.holder.rotation.set(b.outS * 0.32, b.homeRy * (1 - b.outS), 0);
    b.boxPivot.rotation.x = -(LEAN * (1 - b.outS) + 0.12 * b.outS) + b.hoverS * 0.1;
    b.bottle.position.set(0.075, b.hoverS * 0.01, 0.045);
    b.bottleRy = b.bottleRy ?? b.bottle.rotation.y;
    b.bottle.rotation.y = b.out ? b.bottleRy + Math.sin(now * 0.6) * 0.4 : damp(b.bottle.rotation.y, b.bottleRy, 4, dt);
    return;
  }
  const s = 1 + b.outS * 0.9;
  b.holder.scale.setScalar(s);
  b.holder.position.set(
    b.home.x * (1 - b.outS),
    b.home.y + b.hoverS * 0.012 + b.outS * 0.06,
    b.home.z + b.outS * (0.3 - b.home.z));
  b.holder.rotation.y = b.homeRy * (1 - b.outS) + (b.out ? Math.sin(now * 0.8) * 0.25 : 0);
}

// ---------- build from the live stock ----------
function fail() {
  const d = document.createElement("div"); d.className = "wd-fail";
  d.innerHTML = '<div><p>This phone can\'t draw the 3D wardrobe.</p><p><a href="/#rack">See everything on the shop page →</a></p></div>';
  document.body.appendChild(d);
  throw new Error("no webgl");
}
async function build() {
  let products = [];
  // (allProducts keeps the whole shop for the 'Just in' box and the bag)
  try { products = await (await fetch("/api/products", { cache: "no-store" })).json(); } catch { /* shows an empty wardrobe */ }
  allProducts = products;
  products = products.filter((p) => p.wardrobe && p.image && p.status !== "sold"); // picked in the portal: Items > The Wardrobe
  if (!products.length) curating();
  const isCloth = (p) => /cloth|apparel|jacket|wear|shirt|hood|coat/i.test(`${p.category} ${p.subcategory}`);
  const isScent = (p) => /fragrance|perfume|scent|attar|cologne/i.test(`${p.category} ${p.subcategory}`);
  const cloth = products.filter(isCloth).slice(0, 12);
  const scents = products.filter((p) => !isCloth(p) && isScent(p)).slice(0, DRAWERS_MAX * 14);
  const other = products.filter((p) => !isCloth(p) && !isScent(p)).slice(0, 6);
  const total = cloth.length + scents.length + other.length;
  let done = 0;
  const tick = () => { done++; $("loadbar").style.width = `${Math.round((done / Math.max(1, total)) * 100)}%`; };
  const cut = async (p, maxH) => { try { const c = cutout(await loadImage(p.image), maxH); tick(); return c; } catch { tick(); return null; } };

  // spread the fragrances over every drawer (7 -> 3, 2, 2) so none opens empty
  const nDrawers = Math.min(DRAWERS_MAX, scents.length);
  // the drawers are always there; the top ones hold scents, the rest stay empty
  const per = nDrawers ? Math.ceil(scents.length / nDrawers) : 0;
  for (let i = 0; i < DRAWERS_MAX; i++) makeDrawer(DRAWERS_MAX - 1 - i, 0);
  drawers.sort((a, b) => b.i - a.i); // top drawer first

  const [clothCuts, scentCuts, otherCuts] = await Promise.all([
    Promise.all(cloth.map((p) => cut(p, 900))),
    Promise.all(scents.map(async (p) => { try { const f = photoFace(await loadImage(p.image)); tick(); return f; } catch { tick(); return null; } })),
    Promise.all(other.map((p) => cut(p, 520))),
  ]);
  cloth.forEach((p, i) => clothCuts[i] && addGarment(p, clothCuts[i]));
  layoutRail();
  for (const g of garments) { g.x = g.tx + (Math.random() - 0.5) * 0.02; g.a = (Math.random() - 0.5) * 0.04; }
  scents.forEach((p, i) => {
    if (!scentCuts[i]) return;
    const base = Math.floor(scents.length / nDrawers), extra = scents.length % nDrawers;
    const size = (k) => base + (k < extra ? 1 : 0);
    let di = 0, start = 0;
    while (i >= start + size(di)) { start += size(di); di++; }
    const slot = i - start, slots = size(di);
    addBottle(drawers[di], p, scentCuts[i], slot, slots);
  });
  // drawers with nothing in them get no button
  for (let i = drawers.length - 1; i >= 0; i--) if (!drawers[i].bottles.length) { drawers[i].empty = true; }
  const filled = drawers.filter((d) => !d.empty);
  drawers.length = 0; drawers.push(...filled);
  other.forEach((p, i) => otherCuts[i] && addShelfItem(p, otherCuts[i], i, other.length));
  if (!garments.length) VIEWS.rail = VIEWS.all;
}

const ready = build().catch((e) => console.error("wardrobe", e));
camera.position.copy(camPos); camera.lookAt(camLook);
requestAnimationFrame(frame);
ready.then(() => {
  $("load").classList.add("gone");
  started = true;
  paintDock();
  // arrive first: the camera glides in to the closed wardrobe, a pause, then the doors open
  $("hint").textContent = "Welcome to The Wardrobe";
  setTimeout(() => {
    setDoors(true);
    setTimeout(() => { $("hint").textContent = PHONE ? "Swipe the hangers · tap anything" : "Brush the hangers · tap anything"; }, 1400);
    hintTimer = setTimeout(hideHint, 9000);
  }, REDUCED ? 0 : 2600);
});

// ?debug: lets the tests find things on screen
if (new URLSearchParams(location.search).has("debug")) {
  const screen = (obj) => { const v = new THREE.Vector3(); obj.getWorldPosition(v); v.project(camera); return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight }; };
  window.__wd = {
    ready: () => started,
    garment: (i) => { const g = garments[i]; const m = g.mesh; const p = screen(m); return p; },
    drawer: (i) => { const d = drawers[i]; const f = d.g.children[0]; return screen(f); },
    bottle: (d, i) => screen(drawers[d].bottles[i].mesh),
    counts: () => ({ garments: garments.length, drawers: drawers.map((d) => d.bottles.length), cuts: garments.filter((x) => x.cut.ok).length }),
    pickAt: (x, y) => { const h = pick(x, y); return h && { kind: h.kind, drawer: h.drawer, name: h.obj.type }; },
    faces: () => drawers.flatMap((d) => d.bottles.map((b) => [b.p.name.slice(0, 22), b.face.glass.getHexString(), b.face.cap.getHexString()])),
    deco: (i) => { const v = new THREE.Vector3(); decos[i].grp.getWorldPosition(v); v.y += 0.05; v.project(camera); return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight }; },
    state: () => ({ doorsOpen, openDrawer, view, selected: selected && (selected.p ? selected.p.name : selected.type), panel: document.getElementById("name").textContent }),
  };
}
