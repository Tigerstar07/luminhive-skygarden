import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import "./styles.css";

type FlowerPhase = 0 | 1 | 2 | 3;
type LumenMode = "travel" | "harvest" | "idle";
type ChainMode = "idle" | "ready" | "active" | "boost";

interface PhaseVisual {
  name: string;
  yield: number;
  harvestTime: number;
  glow: number;
  openness: number;
  saturation: number;
}

interface Flower {
  id: number;
  group: THREE.Group;
  core: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  petals: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>[];
  aura: THREE.PointLight;
  position: THREE.Vector3;
  phase: FlowerPhase;
  regenTimer: number;
  basePollen: number;
  swayOffset: number;
  color: THREE.Color;
}

interface Lumen {
  id: number;
  group: THREE.Group;
  body: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  wingLeft: THREE.Mesh<THREE.CircleGeometry, THREE.MeshStandardMaterial>;
  wingRight: THREE.Mesh<THREE.CircleGeometry, THREE.MeshStandardMaterial>;
  glow: THREE.PointLight;
  aura: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  targetFlowerId: number | null;
  mode: LumenMode;
  harvestTimer: number;
  harvestDuration: number;
  seed: number;
}

interface Sparkle {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

interface ChainState {
  mode: ChainMode;
  starterId: number | null;
  touchedIds: number[];
  boostedIds: Set<number>;
  nextTriggerTimer: number;
  timer: number;
  boostTimer: number;
  multiplier: number;
  message: string;
  messageTimer: number;
  perfect: boolean;
}

interface HudRefs {
  hps: HTMLElement;
  pollen: HTMLElement;
  nectar: HTMLElement;
  honey: HTMLElement;
  wax: HTMLElement;
  chainText: HTMLElement;
  chainFill: HTMLElement;
  message: HTMLElement;
  weatherLabel: HTMLElement;
  weatherToggle: HTMLButtonElement;
}

const FLOWER_PHASES: PhaseVisual[] = [
  { name: "Exhausted", yield: 0.1, harvestTime: 1.6, glow: 0.1, openness: 0.28, saturation: 0.3 },
  { name: "Drained", yield: 0.33, harvestTime: 1.3, glow: 0.45, openness: 0.52, saturation: 0.58 },
  { name: "Fading", yield: 0.66, harvestTime: 1.15, glow: 0.85, openness: 0.78, saturation: 0.82 },
  { name: "Full Bloom", yield: 1.0, harvestTime: 1.0, glow: 1.35, openness: 1.0, saturation: 1.0 }
];

const regenTimePerPhase = 2.5;
const harvestBaseTime = 0.9;
const tmpObject = new THREE.Object3D();
const tmpColor = new THREE.Color();

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomRange(rand: () => number, min: number, max: number): number {
  return min + (max - min) * rand();
}

function formatNumber(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return value.toFixed(0);
}

function createCanvasTexture(size: number, painter: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not create canvas texture.");
  }
  painter(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function createRockGeometry(topRadius: number, height: number, rings = 8, segments = 56, seed = 1): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  const radialNoise = Array.from({ length: segments }, () => randomRange(rand, 0.86, 1.14));
  const vertices: number[] = [];
  const indices: number[] = [];

  for (let ring = 0; ring <= rings; ring += 1) {
    const t = ring / rings;
    const y = -height * t;
    const taper = Math.pow(1 - t, 1.4);
    const radius = topRadius * (0.15 + 0.85 * taper);

    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      const noise = radialNoise[segment] * (1 - t * 0.35) + Math.sin(t * 8 + segment) * 0.035;
      vertices.push(Math.cos(angle) * radius * noise, y, Math.sin(angle) * radius * noise);
    }
  }

  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const a = ring * segments + segment;
      const b = ring * segments + ((segment + 1) % segments);
      const c = (ring + 1) * segments + segment;
      const d = (ring + 1) * segments + ((segment + 1) % segments);
      indices.push(a, c, b, b, c, d);
    }
  }

  const bottomIndex = vertices.length / 3;
  vertices.push(0, -height - topRadius * 0.35, 0);
  const lastRing = rings * segments;
  for (let segment = 0; segment < segments; segment += 1) {
    indices.push(lastRing + segment, bottomIndex, lastRing + ((segment + 1) % segments));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makeHexMesh(radius: number, material: THREE.Material): THREE.Mesh<THREE.CircleGeometry, THREE.Material> {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 6), material);
  mesh.rotation.z = Math.PI / 6;
  return mesh;
}

class LuminhiveGame {
  private readonly rand = mulberry32(24052026);
  private readonly app: HTMLElement;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.08, 520);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  private readonly composer: EffectComposer;
  private readonly clock = new THREE.Clock();
  private readonly keys = new Set<string>();
  private readonly flowers: Flower[] = [];
  private readonly lumens: Lumen[] = [];
  private readonly sparkles: Sparkle[] = [];
  private readonly player = {
    group: new THREE.Group(),
    position: new THREE.Vector3(-9.1, 0.45, 8.2),
    velocity: new THREE.Vector3()
  };
  private readonly resources = {
    pollen: 420,
    nectar: 180,
    honey: 980,
    wax: 90,
    hps: 0
  };
  private readonly honeySamples: { time: number; honey: number }[] = [];
  private readonly chain: ChainState = {
    mode: "idle",
    starterId: null,
    touchedIds: [],
    boostedIds: new Set<number>(),
    nextTriggerTimer: 4.5,
    timer: 0,
    boostTimer: 0,
    multiplier: 1,
    message: "",
    messageTimer: 0,
    perfect: false
  };
  private readonly chainLine: THREE.Line;
  private readonly hud: HudRefs;
  private readonly moteGeometry = new THREE.BufferGeometry();
  private readonly moteOffsets: number[] = [];
  private readonly moteBaseY: number[] = [];
  private readonly islandRadius = 12.5;
  private cameraYaw = -0.72;
  private cameraPitch = 0.28;
  private isDragging = false;
  private lastPointer = new THREE.Vector2();
  private elapsed = 0;
  private isNight = false;
  private auroraGroup = new THREE.Group();

  constructor(app: HTMLElement) {
    this.app = app;
    this.hud = this.createHud();
    this.setupRenderer();
    const renderPass = new RenderPass(this.scene, this.camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.28, 0.48, 0.58);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(renderPass);
    this.composer.addPass(bloomPass);

    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0xffdd71,
      transparent: true,
      opacity: 0.92
    });
    this.chainLine = new THREE.Line(new THREE.BufferGeometry(), lineMaterial);
    this.chainLine.frustumCulled = false;
    this.chainLine.visible = false;
    this.scene.add(this.chainLine);

    this.createWorld();
    this.createPlayer();
    this.createFlowers();
    this.createLumens();
    this.setupInput();
    this.updateHud();
    this.renderer.setAnimationLoop(() => this.update());
  }

  private setupRenderer(): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.86;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.app.appendChild(this.renderer.domElement);

    window.addEventListener("resize", () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.composer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  private createHud(): HudRefs {
    const hud = document.createElement("div");
    hud.className = "hud";
    hud.innerHTML = `
      <div class="top-left">
        <div class="brand">
          <div class="crest">⬢</div>
          <div>
            <div class="title">Luminhive</div>
            <div class="subtitle">Skygarden</div>
          </div>
        </div>
        <div class="resource-panel">
          <div class="hps-row"><span>HPS</span><span data-hps>0/s</span></div>
          <div class="store-title">Storage</div>
          <div class="resource"><span>✹</span><b>Pollen</b><span data-pollen>0</span></div>
          <div class="resource"><span>●</span><b>Nectar</b><span data-nectar>0</span></div>
          <div class="resource"><span>⬣</span><b>Honey</b><span data-honey>0</span></div>
          <div class="resource"><span>◆</span><b>Wax</b><span data-wax>0</span></div>
        </div>
      </div>
      <div class="top-right">
        <div class="location">Glowpetal Fields</div>
        <div class="mini-map"></div>
        <button type="button" class="weather" data-weather-toggle aria-label="Toggle day and night"><span class="sun"></span><span data-weather>Day · Clear</span></button>
      </div>
      <div class="center-message" data-message></div>
      <div class="chain-status">
        <strong data-chain-text>Bloom Chain dormant</strong>
        <div class="chain-meter"><div class="chain-fill" data-chain-fill></div></div>
      </div>
      <div class="bottom-nav" aria-label="Game controls">
        <div class="nav-button"><kbd>WASD</kbd><span>Move</span></div>
        <div class="nav-button"><kbd>Drag</kbd><span>Orbit</span></div>
        <div class="nav-button"><kbd>N</kbd><span>Night</span></div>
        <div class="nav-button"><kbd>Auto</kbd><span>Gather</span></div>
      </div>
    `;
    this.app.appendChild(hud);

    const refs = {
      hps: hud.querySelector("[data-hps]"),
      pollen: hud.querySelector("[data-pollen]"),
      nectar: hud.querySelector("[data-nectar]"),
      honey: hud.querySelector("[data-honey]"),
      wax: hud.querySelector("[data-wax]"),
      chainText: hud.querySelector("[data-chain-text]"),
      chainFill: hud.querySelector("[data-chain-fill]"),
      message: hud.querySelector("[data-message]"),
      weatherLabel: hud.querySelector("[data-weather]"),
      weatherToggle: hud.querySelector("[data-weather-toggle]")
    };

    for (const [key, value] of Object.entries(refs)) {
      if (!value) {
        throw new Error(`Missing HUD element: ${key}`);
      }
    }

    return refs as HudRefs;
  }

  private createWorld(): void {
    this.scene.background = new THREE.Color(0x79c9ff);
    this.scene.fog = new THREE.FogExp2(0x8dd9ff, 0.0065);

    const hemi = new THREE.HemisphereLight(0xcff5ff, 0x7f6b44, 1.6);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff0bf, 3.2);
    sun.position.set(-18, 32, 16);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -36;
    sun.shadow.camera.right = 36;
    sun.shadow.camera.top = 36;
    sun.shadow.camera.bottom = -36;
    this.scene.add(sun);

    this.createSkyDome();
    this.createSunbeams();
    this.createCloudLayer();
    this.createAurora();
    this.createSkyIsland(new THREE.Vector3(0, 0, 0), 13.2, 9.5, 1001, true);
    this.createSkyIsland(new THREE.Vector3(18.5, -0.8, -7.5), 5.4, 6.5, 1002, false);
    this.createSkyIsland(new THREE.Vector3(-20, -2.5, -13), 5.8, 7.2, 1003, false);
    this.createSkyIsland(new THREE.Vector3(26, 2.6, 17), 4.7, 6.1, 1004, false);
    this.createSkyIsland(new THREE.Vector3(-31, 4, 11), 4.4, 5.4, 1005, false);
    this.createBridge(new THREE.Vector3(10.8, 0.34, -3.7), new THREE.Vector3(15.1, -0.42, -6.3), 17);
    this.createWorldTree();
    this.createForegroundFlowers();
    this.createDecorativeBeeSwarm();
    this.createMotes();
  }

  private createSkyDome(): void {
    const skyTexture = createCanvasTexture(1024, (ctx, size) => {
      const gradient = ctx.createLinearGradient(0, 0, 0, size);
      gradient.addColorStop(0, "#176fc4");
      gradient.addColorStop(0.45, "#76d5ff");
      gradient.addColorStop(1, "#eefbff");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 180; i += 1) {
        const x = randomRange(this.rand, 0, size);
        const y = randomRange(this.rand, 0, size * 0.62);
        const r = randomRange(this.rand, 0.6, 2.1);
        ctx.fillStyle = `rgba(255,255,255,${randomRange(this.rand, 0.2, 0.7)})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(260, 48, 32),
      new THREE.MeshBasicMaterial({ map: skyTexture, side: THREE.BackSide, fog: false })
    );
    this.scene.add(sky);
  }

  private createCloudLayer(): void {
    const cloudMaterial = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.78,
      depthWrite: false
    });
    for (let i = 0; i < 44; i += 1) {
      const group = new THREE.Group();
      const angle = this.rand() * Math.PI * 2;
      const distance = randomRange(this.rand, 38, 95);
      group.position.set(Math.cos(angle) * distance, randomRange(this.rand, -14, 3), Math.sin(angle) * distance);
      const puffCount = Math.floor(randomRange(this.rand, 4, 8));
      for (let p = 0; p < puffCount; p += 1) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(randomRange(this.rand, 1.8, 4.8), 12, 8), cloudMaterial);
        puff.position.set(randomRange(this.rand, -5, 5), randomRange(this.rand, -0.6, 0.8), randomRange(this.rand, -2.8, 2.8));
        puff.scale.set(randomRange(this.rand, 1.3, 3.2), randomRange(this.rand, 0.28, 0.75), randomRange(this.rand, 0.7, 1.7));
        group.add(puff);
      }
      this.scene.add(group);
    }
  }

  private createSunbeams(): void {
    const material = new THREE.MeshBasicMaterial({
      color: 0xfff1b5,
      transparent: true,
      opacity: 0.11,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
    for (let i = 0; i < 7; i += 1) {
      const beam = new THREE.Mesh(new THREE.PlaneGeometry(randomRange(this.rand, 3.5, 7.5), randomRange(this.rand, 28, 45)), material.clone());
      beam.position.set(randomRange(this.rand, -20, 16), randomRange(this.rand, 11, 20), randomRange(this.rand, -26, 10));
      beam.rotation.set(randomRange(this.rand, 0.8, 1.2), randomRange(this.rand, -0.55, -0.15), randomRange(this.rand, -0.45, 0.12));
      this.scene.add(beam);
    }
  }

  private createAurora(): void {
    this.auroraGroup.visible = false;
    const colors = [0x7cf5ff, 0xa981ff, 0xffd86c];
    for (let i = 0; i < 5; i += 1) {
      const geometry = new THREE.PlaneGeometry(46, 8, 32, 1);
      const material = new THREE.MeshBasicMaterial({
        color: colors[i % colors.length],
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      const ribbon = new THREE.Mesh(geometry, material);
      ribbon.position.set(randomRange(this.rand, -38, 38), randomRange(this.rand, 25, 38), randomRange(this.rand, -70, -48));
      ribbon.rotation.set(randomRange(this.rand, -0.25, 0.2), randomRange(this.rand, -0.55, 0.55), randomRange(this.rand, -0.14, 0.14));
      this.auroraGroup.add(ribbon);
    }
    this.scene.add(this.auroraGroup);
  }

  private createSkyIsland(position: THREE.Vector3, radius: number, height: number, seed: number, main: boolean): void {
    const grassTexture = createCanvasTexture(512, (ctx, size) => {
      ctx.fillStyle = "#5f9f45";
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 720; i += 1) {
        const hue = randomRange(this.rand, 77, 112);
        ctx.fillStyle = `hsla(${hue}, ${randomRange(this.rand, 38, 66)}%, ${randomRange(this.rand, 28, 50)}%, 0.58)`;
        ctx.fillRect(randomRange(this.rand, 0, size), randomRange(this.rand, 0, size), randomRange(this.rand, 1, 7), randomRange(this.rand, 1, 8));
      }
    });
    grassTexture.repeat.set(5, 5);

    const rock = new THREE.Mesh(
      createRockGeometry(radius, height, 9, main ? 72 : 48, seed),
      new THREE.MeshStandardMaterial({
        color: 0x6e7070,
        roughness: 0.92,
        metalness: 0.02
      })
    );
    rock.position.copy(position);
    rock.castShadow = true;
    rock.receiveShadow = true;
    this.scene.add(rock);

    const grass = new THREE.Mesh(
      new THREE.CircleGeometry(radius * 1.01, main ? 96 : 56),
      new THREE.MeshStandardMaterial({
        map: grassTexture,
        color: main ? 0x6fb847 : 0x69aa44,
        roughness: 0.74,
        metalness: 0.02
      })
    );
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(position.x, position.y + 0.06, position.z);
    grass.receiveShadow = true;
    this.scene.add(grass);

    for (let i = 0; i < (main ? 34 : 15); i += 1) {
      const angle = this.rand() * Math.PI * 2;
      const dist = randomRange(this.rand, radius * 0.75, radius * 1.02);
      const boulder = new THREE.Mesh(
        new THREE.DodecahedronGeometry(randomRange(this.rand, 0.28, 0.9), 1),
        new THREE.MeshStandardMaterial({ color: 0x7f8279, roughness: 0.95 })
      );
      boulder.position.set(position.x + Math.cos(angle) * dist, position.y + randomRange(this.rand, 0.04, 0.28), position.z + Math.sin(angle) * dist);
      boulder.scale.set(1, randomRange(this.rand, 0.5, 1.2), randomRange(this.rand, 0.8, 1.6));
      boulder.rotation.set(this.rand() * Math.PI, this.rand() * Math.PI, this.rand() * Math.PI);
      boulder.castShadow = true;
      boulder.receiveShadow = true;
      this.scene.add(boulder);
    }

    this.createWaterfalls(position, radius, main ? 5 : 2);
    this.createGrassField(position, radius, main ? 1350 : 180);
    if (main) {
      this.createMeadowCarpet(position, radius, 760);
    }

    if (!main) {
      this.createMiniTree(position.clone().add(new THREE.Vector3(randomRange(this.rand, -1.2, 1.2), 0.15, randomRange(this.rand, -1.2, 1.2))), randomRange(this.rand, 0.6, 1.1));
      this.createHiveHut(position.clone().add(new THREE.Vector3(randomRange(this.rand, -2, 2), 0.18, randomRange(this.rand, -2, 2))), randomRange(this.rand, 0.45, 0.72));
    }
  }

  private createWaterfalls(center: THREE.Vector3, radius: number, count: number): void {
    const material = new THREE.MeshBasicMaterial({
      color: 0xbff8ff,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    for (let i = 0; i < count; i += 1) {
      const angle = randomRange(this.rand, 0, Math.PI * 2);
      const width = randomRange(this.rand, 0.75, 1.55);
      const height = randomRange(this.rand, 5.5, 11);
      const fall = new THREE.Mesh(new THREE.PlaneGeometry(width, height, 1, 8), material);
      const outward = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      fall.position.set(center.x + outward.x * radius * 0.95, center.y - height * 0.46, center.z + outward.z * radius * 0.95);
      fall.lookAt(fall.position.clone().add(outward));
      this.scene.add(fall);
    }
  }

  private createGrassField(center: THREE.Vector3, radius: number, count: number): void {
    const geometry = new THREE.PlaneGeometry(0.12, 0.7, 1, 2);
    geometry.translate(0, 0.35, 0);
    const material = new THREE.MeshBasicMaterial({
      color: 0xb3e466,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92
    });
    const grass = new THREE.InstancedMesh(geometry, material, count);
    grass.castShadow = true;
    grass.receiveShadow = true;

    for (let i = 0; i < count; i += 1) {
      const angle = this.rand() * Math.PI * 2;
      const dist = Math.sqrt(this.rand()) * radius * 0.96;
      const bladeHeight = randomRange(this.rand, 0.45, 1.25);
      tmpObject.position.set(center.x + Math.cos(angle) * dist, center.y + 0.08, center.z + Math.sin(angle) * dist);
      tmpObject.rotation.set(randomRange(this.rand, -0.08, 0.08), this.rand() * Math.PI, randomRange(this.rand, -0.12, 0.12));
      tmpObject.scale.set(randomRange(this.rand, 0.85, 1.95), bladeHeight, 1);
      tmpObject.updateMatrix();
      grass.setMatrixAt(i, tmpObject.matrix);
    }
    this.scene.add(grass);
  }

  private createMeadowCarpet(center: THREE.Vector3, radius: number, count: number): void {
    const geometry = new THREE.CircleGeometry(0.06, 7);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: 0.96,
      side: THREE.DoubleSide
    });
    const carpet = new THREE.InstancedMesh(geometry, material, count);
    const palette = [0xfff2a7, 0xffa8dc, 0xb9e5ff, 0xc7afff, 0xffffff, 0xffc06a];
    for (let i = 0; i < count; i += 1) {
      const angle = this.rand() * Math.PI * 2;
      const dist = Math.sqrt(this.rand()) * radius * 0.88;
      const awayFromTree = dist > 2.8;
      tmpObject.position.set(center.x + Math.cos(angle) * dist, center.y + 0.105, center.z + Math.sin(angle) * dist);
      tmpObject.rotation.set(0, this.rand() * Math.PI, 0);
      const size = awayFromTree ? randomRange(this.rand, 0.75, 1.7) : randomRange(this.rand, 0.35, 0.75);
      tmpObject.scale.set(size, size, size);
      tmpObject.updateMatrix();
      carpet.setMatrixAt(i, tmpObject.matrix);
      tmpColor.set(palette[Math.floor(this.rand() * palette.length)]);
      carpet.setColorAt(i, tmpColor);
    }
    if (carpet.instanceColor) {
      carpet.instanceColor.needsUpdate = true;
    }
    this.scene.add(carpet);
  }

  private createBridge(start: THREE.Vector3, end: THREE.Vector3, planks: number): void {
    const direction = end.clone().sub(start);
    const length = direction.length();
    const angle = Math.atan2(direction.x, direction.z);
    const wood = new THREE.MeshStandardMaterial({ color: 0x8c6132, roughness: 0.78 });
    const rope = new THREE.MeshStandardMaterial({ color: 0x71512d, roughness: 0.92 });

    for (let i = 0; i < planks; i += 1) {
      const t = i / (planks - 1);
      const pos = start.clone().lerp(end, t);
      pos.y += Math.sin(t * Math.PI) * 0.35;
      const plank = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.12, length / planks * 0.65), wood);
      plank.position.copy(pos);
      plank.rotation.y = angle;
      plank.rotation.z = randomRange(this.rand, -0.04, 0.04);
      plank.castShadow = true;
      this.scene.add(plank);
    }

    for (const offset of [-0.72, 0.72]) {
      const curve = new THREE.CatmullRomCurve3([
        start.clone().add(new THREE.Vector3(Math.cos(angle) * offset, 0.25, -Math.sin(angle) * offset)),
        start.clone().lerp(end, 0.5).add(new THREE.Vector3(Math.cos(angle) * offset, 0.75, -Math.sin(angle) * offset)),
        end.clone().add(new THREE.Vector3(Math.cos(angle) * offset, 0.25, -Math.sin(angle) * offset))
      ]);
      const rail = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.045, 6), rope);
      rail.castShadow = true;
      this.scene.add(rail);
    }
  }

  private createWorldTree(): void {
    const bark = new THREE.MeshStandardMaterial({
      color: 0x665039,
      roughness: 0.86,
      metalness: 0.02
    });
    const darkBark = new THREE.MeshStandardMaterial({ color: 0x3f3428, roughness: 0.94 });
    const leafMaterials = [
      new THREE.MeshStandardMaterial({ color: 0x78b94b, roughness: 0.7 }),
      new THREE.MeshStandardMaterial({ color: 0x9cca57, roughness: 0.68 }),
      new THREE.MeshStandardMaterial({ color: 0xd3d16b, roughness: 0.74 })
    ];

    const tree = new THREE.Group();
    this.scene.add(tree);

    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 2.25, 18, 28, 7), bark);
    trunk.position.set(0, 9.0, 0);
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    tree.add(trunk);

    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2;
      const rootCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(Math.cos(angle) * 1.0, 0.18, Math.sin(angle) * 1.0),
        new THREE.Vector3(Math.cos(angle) * 3.4, 0.26, Math.sin(angle) * 3.4),
        new THREE.Vector3(Math.cos(angle + 0.24) * 5.7, 0.12, Math.sin(angle + 0.24) * 5.7)
      ]);
      const root = new THREE.Mesh(new THREE.TubeGeometry(rootCurve, 20, randomRange(this.rand, 0.23, 0.42), 8), darkBark);
      root.castShadow = true;
      root.receiveShadow = true;
      tree.add(root);
    }

    for (let i = 0; i < 18; i += 1) {
      const angle = (i / 18) * Math.PI * 2 + randomRange(this.rand, -0.22, 0.22);
      const startY = randomRange(this.rand, 7.2, 16.8);
      const reach = randomRange(this.rand, 4.4, 10.6);
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(Math.cos(angle) * 0.9, startY, Math.sin(angle) * 0.9),
        new THREE.Vector3(Math.cos(angle) * reach * 0.44, startY + randomRange(this.rand, 1.4, 3.2), Math.sin(angle) * reach * 0.44),
        new THREE.Vector3(Math.cos(angle) * reach, startY + randomRange(this.rand, 1.9, 4.9), Math.sin(angle) * reach)
      ]);
      const branch = new THREE.Mesh(new THREE.TubeGeometry(curve, 28, randomRange(this.rand, 0.13, 0.36), 8), bark);
      branch.castShadow = true;
      branch.receiveShadow = true;
      tree.add(branch);
    }

    const leafGeo = new THREE.IcosahedronGeometry(1, 2);
    for (let i = 0; i < 96; i += 1) {
      const angle = this.rand() * Math.PI * 2;
      const radius = randomRange(this.rand, 2.8, 10.8);
      const y = randomRange(this.rand, 16.6, 23.8) - Math.max(0, radius - 8) * 0.3;
      const leaf = new THREE.Mesh(leafGeo, leafMaterials[Math.floor(this.rand() * leafMaterials.length)]);
      leaf.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
      leaf.scale.set(randomRange(this.rand, 1.8, 4.8), randomRange(this.rand, 0.8, 2.4), randomRange(this.rand, 1.4, 3.8));
      leaf.rotation.set(this.rand() * Math.PI, this.rand() * Math.PI, this.rand() * Math.PI);
      leaf.castShadow = true;
      leaf.receiveShadow = true;
      tree.add(leaf);
    }

    this.createCanopyLeafSprites(tree);
    this.createTreePlatforms(tree);
    this.createHoneycombs(tree);
    this.createHoneyStreams(tree);
    this.createHangingVines(tree);
    this.createHangingLanterns(tree);
    this.createHiveHut(new THREE.Vector3(4.7, 0.24, 3.6), 0.9);
    this.createHiveHut(new THREE.Vector3(-6.7, 0.22, -2.4), 0.67);
    this.createHiveHut(new THREE.Vector3(6.7, 0.18, -6.1), 0.58);
  }

  private createCanopyLeafSprites(tree: THREE.Group): void {
    const leafTexture = createCanvasTexture(96, (ctx, size) => {
      ctx.clearRect(0, 0, size, size);
      const gradient = ctx.createRadialGradient(size * 0.42, size * 0.42, 2, size * 0.5, size * 0.5, size * 0.48);
      gradient.addColorStop(0, "rgba(255,248,142,0.98)");
      gradient.addColorStop(0.5, "rgba(138,203,76,0.95)");
      gradient.addColorStop(1, "rgba(42,112,58,0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(size * 0.5, size * 0.5, size * 0.44, size * 0.26, -0.5, 0, Math.PI * 2);
      ctx.fill();
    });
    const material = new THREE.MeshBasicMaterial({
      map: leafTexture,
      transparent: true,
      alphaTest: 0.08,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const leaves = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.72, 0.42), material, 900);
    for (let i = 0; i < 900; i += 1) {
      const angle = this.rand() * Math.PI * 2;
      const dist = randomRange(this.rand, 3.8, 11.7);
      const y = randomRange(this.rand, 16.0, 24.7) - Math.max(0, dist - 8.4) * 0.25;
      tmpObject.position.set(Math.cos(angle) * dist, y, Math.sin(angle) * dist);
      tmpObject.rotation.set(randomRange(this.rand, -0.8, 0.8), randomRange(this.rand, 0, Math.PI * 2), randomRange(this.rand, -0.5, 0.5));
      const scale = randomRange(this.rand, 0.55, 1.85);
      tmpObject.scale.set(scale, scale, scale);
      tmpObject.updateMatrix();
      leaves.setMatrixAt(i, tmpObject.matrix);
    }
    tree.add(leaves);
  }

  private createTreePlatforms(tree: THREE.Group): void {
    const wood = new THREE.MeshStandardMaterial({ color: 0x9a6b34, roughness: 0.76 });
    const gold = new THREE.MeshStandardMaterial({
      color: 0xf5c355,
      emissive: 0x9f6500,
      emissiveIntensity: 0.4,
      roughness: 0.34,
      metalness: 0.25
    });
    const platformData = [
      { y: 5.4, r: 3.3, a: 0.2 },
      { y: 8.4, r: 4.2, a: 2.4 },
      { y: 11.8, r: 3.7, a: 4.2 },
      { y: 15.1, r: 3.0, a: 1.4 }
    ];
    for (const data of platformData) {
      const x = Math.cos(data.a) * 2.2;
      const z = Math.sin(data.a) * 2.2;
      const deck = new THREE.Mesh(new THREE.CylinderGeometry(data.r, data.r * 0.92, 0.22, 32), wood);
      deck.position.set(x, data.y, z);
      deck.castShadow = true;
      deck.receiveShadow = true;
      tree.add(deck);

      for (let i = 0; i < 12; i += 1) {
        const angle = (i / 12) * Math.PI * 2;
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 0.72, 8), gold);
        post.position.set(x + Math.cos(angle) * data.r * 0.88, data.y + 0.42, z + Math.sin(angle) * data.r * 0.88);
        tree.add(post);
      }
    }
  }

  private createHoneycombs(tree: THREE.Group): void {
    const glow = new THREE.MeshBasicMaterial({ color: 0xffd46f, transparent: true, opacity: 0.94 });
    const rim = new THREE.MeshBasicMaterial({ color: 0x8b5b18, transparent: true, opacity: 0.72 });
    const panels = [
      { position: new THREE.Vector3(-0.95, 3.8, 1.88), normal: new THREE.Vector3(-0.55, 0, 0.9).normalize(), rows: 5, cols: 5, r: 0.32 },
      { position: new THREE.Vector3(-1.12, 7.4, 1.52), normal: new THREE.Vector3(-0.65, 0, 0.76).normalize(), rows: 4, cols: 4, r: 0.34 },
      { position: new THREE.Vector3(0, 6.9, -1.66), normal: new THREE.Vector3(0, 0, -1), rows: 4, cols: 4, r: 0.36 },
      { position: new THREE.Vector3(1.18, 10.8, 1.05), normal: new THREE.Vector3(1, 0, 1).normalize(), rows: 3, cols: 3, r: 0.3 },
      { position: new THREE.Vector3(-1.4, 14.0, 0.55), normal: new THREE.Vector3(-1, 0, 0.4).normalize(), rows: 3, cols: 4, r: 0.28 },
      { position: new THREE.Vector3(0.9, 17.2, -0.85), normal: new THREE.Vector3(0.6, 0, -1).normalize(), rows: 2, cols: 4, r: 0.25 }
    ];

    for (const panel of panels) {
      const group = new THREE.Group();
      group.position.copy(panel.position);
      group.lookAt(panel.position.clone().add(panel.normal));

      for (let row = 0; row < panel.rows; row += 1) {
        for (let col = 0; col < panel.cols; col += 1) {
          const x = (col - (panel.cols - 1) / 2) * panel.r * 1.55 + (row % 2) * panel.r * 0.78;
          const y = (row - (panel.rows - 1) / 2) * panel.r * 1.33;
          const outer = makeHexMesh(panel.r * 1.08, rim);
          outer.position.set(x, y, -0.01);
          group.add(outer);
          const inner = makeHexMesh(panel.r * 0.78, glow);
          inner.position.set(x, y, 0.01);
          group.add(inner);
        }
      }
      const light = new THREE.PointLight(0xffc766, 2.2, 8);
      light.position.set(0, 0, 0.6);
      group.add(light);
      tree.add(group);
    }
  }

  private createHoneyStreams(tree: THREE.Group): void {
    const material = new THREE.MeshStandardMaterial({
      color: 0xffbd3f,
      emissive: 0xff8d12,
      emissiveIntensity: 0.9,
      roughness: 0.28,
      metalness: 0.05
    });
    const streams = [
      { a: 1.15, y: 13.5, h: 5.2 },
      { a: 2.55, y: 10.2, h: 3.6 },
      { a: 4.18, y: 8.1, h: 4.4 },
      { a: 5.4, y: 16.3, h: 3.1 }
    ];
    for (const stream of streams) {
      const r = 1.28;
      const x = Math.cos(stream.a) * r;
      const z = Math.sin(stream.a) * r;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(x, stream.y, z),
        new THREE.Vector3(x + Math.cos(stream.a + 0.4) * 0.16, stream.y - stream.h * 0.45, z + Math.sin(stream.a + 0.4) * 0.16),
        new THREE.Vector3(x + Math.cos(stream.a - 0.3) * 0.2, stream.y - stream.h, z + Math.sin(stream.a - 0.3) * 0.2)
      ]);
      const honey = new THREE.Mesh(new THREE.TubeGeometry(curve, 18, 0.035, 8), material);
      tree.add(honey);
      const drip = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), material);
      drip.position.copy(curve.points[curve.points.length - 1]);
      drip.scale.set(0.8, 1.35, 0.8);
      tree.add(drip);
    }
  }

  private createHangingVines(tree: THREE.Group): void {
    const material = new THREE.MeshStandardMaterial({
      color: 0x3f7e3f,
      roughness: 0.86
    });
    for (let i = 0; i < 34; i += 1) {
      const angle = this.rand() * Math.PI * 2;
      const radius = randomRange(this.rand, 4.2, 10.8);
      const topY = randomRange(this.rand, 14.0, 20.8);
      const length = randomRange(this.rand, 1.5, 4.2);
      const start = new THREE.Vector3(Math.cos(angle) * radius, topY, Math.sin(angle) * radius);
      const curve = new THREE.CatmullRomCurve3([
        start,
        start.clone().add(new THREE.Vector3(randomRange(this.rand, -0.28, 0.28), -length * 0.48, randomRange(this.rand, -0.28, 0.28))),
        start.clone().add(new THREE.Vector3(randomRange(this.rand, -0.45, 0.45), -length, randomRange(this.rand, -0.45, 0.45)))
      ]);
      const vine = new THREE.Mesh(new THREE.TubeGeometry(curve, 10, randomRange(this.rand, 0.011, 0.026), 5), material);
      tree.add(vine);
    }
  }

  private createHangingLanterns(tree: THREE.Group): void {
    const chainMaterial = new THREE.MeshStandardMaterial({ color: 0x5d4a2e, roughness: 0.85 });
    const lanternMaterial = new THREE.MeshBasicMaterial({ color: 0xffcf6a });
    for (let i = 0; i < 28; i += 1) {
      const angle = this.rand() * Math.PI * 2;
      const radius = randomRange(this.rand, 2.8, 9.7);
      const y = randomRange(this.rand, 11.2, 18.8);
      const top = new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
      const bottom = top.clone().add(new THREE.Vector3(0, -randomRange(this.rand, 0.75, 1.8), 0));
      const chain = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([top, bottom]), 6, 0.012, 5), chainMaterial);
      tree.add(chain);
      const lantern = new THREE.Mesh(new THREE.SphereGeometry(randomRange(this.rand, 0.08, 0.17), 10, 8), lanternMaterial);
      lantern.position.copy(bottom);
      tree.add(lantern);
      const light = new THREE.PointLight(0xffd27b, 0.65, 4);
      light.position.copy(bottom);
      tree.add(light);
    }
  }

  private createHiveHut(position: THREE.Vector3, scale: number): void {
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xe8c176, roughness: 0.62 });
    const roofMaterial = new THREE.MeshStandardMaterial({
      color: 0xd69d34,
      roughness: 0.52,
      metalness: 0.1
    });
    const windowMaterial = new THREE.MeshBasicMaterial({ color: 0xffd974 });
    const hut = new THREE.Group();
    hut.position.copy(position);
    hut.scale.setScalar(scale);

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 1.08, 1.25, 18), bodyMaterial);
    body.position.y = 0.72;
    body.castShadow = true;
    body.receiveShadow = true;
    hut.add(body);

    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.2, 0.9, 18), roofMaterial);
    roof.position.y = 1.7;
    roof.castShadow = true;
    hut.add(roof);

    for (let i = 0; i < 3; i += 1) {
      const angle = (i / 3) * Math.PI * 2 + 0.2;
      const window = makeHexMesh(0.2, windowMaterial);
      window.position.set(Math.cos(angle) * 1.02, 0.9, Math.sin(angle) * 1.02);
      window.lookAt(window.position.clone().multiplyScalar(2));
      hut.add(window);
    }

    const light = new THREE.PointLight(0xffcb60, 1.2, 7);
    light.position.set(0, 1.1, 0);
    hut.add(light);
    this.scene.add(hut);
  }

  private createMiniTree(position: THREE.Vector3, scale: number): void {
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16 * scale, 0.28 * scale, 2.4 * scale, 8),
      new THREE.MeshStandardMaterial({ color: 0x5d4934, roughness: 0.85 })
    );
    trunk.position.copy(position).add(new THREE.Vector3(0, 1.2 * scale, 0));
    trunk.castShadow = true;
    this.scene.add(trunk);

    const leafMaterial = new THREE.MeshStandardMaterial({ color: 0x7fbe4d, roughness: 0.72 });
    for (let i = 0; i < 5; i += 1) {
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.95 * scale, 1), leafMaterial);
      const angle = (i / 5) * Math.PI * 2;
      leaf.position.copy(position).add(new THREE.Vector3(Math.cos(angle) * 0.52 * scale, (2.35 + this.rand() * 0.42) * scale, Math.sin(angle) * 0.52 * scale));
      leaf.scale.set(1.5, 0.75, 1.2);
      leaf.castShadow = true;
      this.scene.add(leaf);
    }
  }

  private createForegroundFlowers(): void {
    const petalColors = [0xf8e878, 0xff9fe0, 0x9ad3ff, 0xcaa2ff, 0xffffff];
    for (let i = 0; i < 180; i += 1) {
      const angle = randomRange(this.rand, -2.6, -0.15);
      const distance = randomRange(this.rand, 6.8, 12.3);
      const pos = new THREE.Vector3(Math.cos(angle) * distance, 0.09, Math.sin(angle) * distance);
      const flower = new THREE.Mesh(
        new THREE.SphereGeometry(randomRange(this.rand, 0.05, 0.12), 8, 6),
        new THREE.MeshStandardMaterial({
          color: petalColors[Math.floor(this.rand() * petalColors.length)],
          emissive: 0x7b5510,
          emissiveIntensity: randomRange(this.rand, 0.04, 0.15),
          roughness: 0.72
        })
      );
      flower.position.copy(pos);
      flower.scale.set(randomRange(this.rand, 1.4, 2.8), randomRange(this.rand, 0.35, 0.8), randomRange(this.rand, 1.4, 2.8));
      flower.castShadow = true;
      this.scene.add(flower);
    }
  }

  private createDecorativeBeeSwarm(): void {
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0xffc948,
      emissive: 0xffa41d,
      emissiveIntensity: 0.45,
      roughness: 0.34
    });
    const wingMaterial = new THREE.MeshBasicMaterial({
      color: 0xdffcff,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    for (let i = 0; i < 30; i += 1) {
      const bee = new THREE.Group();
      const angle = this.rand() * Math.PI * 2;
      const radius = randomRange(this.rand, 8, 24);
      bee.position.set(Math.cos(angle) * radius, randomRange(this.rand, 3.5, 18), Math.sin(angle) * radius);
      bee.scale.setScalar(randomRange(this.rand, 0.18, 0.42));
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 10), bodyMaterial);
      body.scale.set(1.45, 0.8, 0.8);
      bee.add(body);
      const wingA = new THREE.Mesh(new THREE.CircleGeometry(0.46, 18), wingMaterial);
      wingA.position.set(-0.1, 0.38, 0.35);
      wingA.rotation.set(0.7, 0, -0.38);
      bee.add(wingA);
      const wingB = wingA.clone();
      wingB.position.z = -0.35;
      wingB.rotation.set(-0.7, 0, 0.38);
      bee.add(wingB);
      const light = new THREE.PointLight(0xffcf55, 0.22, 3);
      bee.add(light);
      this.scene.add(bee);
    }
  }

  private createMotes(): void {
    const positions: number[] = [];
    const colors: number[] = [];
    const color = new THREE.Color();
    for (let i = 0; i < 460; i += 1) {
      const angle = this.rand() * Math.PI * 2;
      const dist = randomRange(this.rand, 2, 32);
      const y = randomRange(this.rand, 1.2, 23);
      positions.push(Math.cos(angle) * dist, y, Math.sin(angle) * dist);
      this.moteOffsets.push(this.rand() * Math.PI * 2);
      this.moteBaseY.push(y);
      color.setHSL(randomRange(this.rand, 0.11, 0.18), 0.95, randomRange(this.rand, 0.62, 0.82));
      colors.push(color.r, color.g, color.b);
    }
    this.moteGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    this.moteGeometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: 0.09,
      vertexColors: true,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const motes = new THREE.Points(this.moteGeometry, material);
    this.scene.add(motes);
  }

  private createPlayer(): void {
    const group = this.player.group;
    group.position.copy(this.player.position);

    const coat = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.34, 0.72, 6, 14),
      new THREE.MeshStandardMaterial({ color: 0xf2dfb6, roughness: 0.54 })
    );
    coat.position.y = 0.82;
    coat.castShadow = true;
    group.add(coat);

    const cape = new THREE.Mesh(
      new THREE.ConeGeometry(0.46, 1.15, 5, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0xf6c75f,
        emissive: 0x6f4a08,
        emissiveIntensity: 0.12,
        roughness: 0.62,
        side: THREE.DoubleSide
      })
    );
    cape.position.set(0, 0.72, 0.22);
    cape.rotation.x = -0.18;
    group.add(cape);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 18, 12), new THREE.MeshStandardMaterial({ color: 0xffe1bd, roughness: 0.58 }));
    head.position.y = 1.48;
    head.castShadow = true;
    group.add(head);

    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.25, 18, 12), new THREE.MeshStandardMaterial({ color: 0xf4d58e, roughness: 0.68 }));
    hair.position.set(0, 1.57, 0.03);
    hair.scale.set(1.08, 0.82, 1.0);
    hair.castShadow = true;
    group.add(hair);

    const satchel = new THREE.Mesh(
      new THREE.BoxGeometry(0.23, 0.28, 0.15),
      new THREE.MeshStandardMaterial({
        color: 0x2a2530,
        emissive: 0xffc34a,
        emissiveIntensity: 0.28,
        roughness: 0.55
      })
    );
    satchel.position.set(0.32, 0.73, 0.08);
    group.add(satchel);

    const aura = new THREE.PointLight(0xffc967, 0.55, 4);
    aura.position.y = 0.9;
    group.add(aura);

    this.scene.add(group);
  }

  private createFlowers(): void {
    const colors = [0xffee86, 0xff8fd0, 0x9edfff, 0xbba5ff, 0xffb76d];
    for (let i = 0; i < 42; i += 1) {
      const angle = randomRange(this.rand, 0, Math.PI * 2);
      const dist = randomRange(this.rand, 4.2, 10.8);
      if (Math.abs(Math.cos(angle) * dist) < 2.5 && Math.abs(Math.sin(angle) * dist) < 2.8) {
        i -= 1;
        continue;
      }
      const position = new THREE.Vector3(Math.cos(angle) * dist, 0.08, Math.sin(angle) * dist);
      const flower = this.createFlower(i, position, new THREE.Color(colors[i % colors.length]));
      this.flowers.push(flower);
      this.scene.add(flower.group);
    }
  }

  private createFlower(id: number, position: THREE.Vector3, color: THREE.Color): Flower {
    const group = new THREE.Group();
    group.position.copy(position);
    const stemMaterial = new THREE.MeshStandardMaterial({ color: 0x4f9f45, roughness: 0.82 });
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.044, 0.48, 7), stemMaterial);
    stem.position.y = 0.25;
    stem.castShadow = true;
    group.add(stem);

    const petalMaterial = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.22,
      roughness: 0.58
    });
    const petals: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>[] = [];
    const petalCount = 5 + (id % 3);
    for (let i = 0; i < petalCount; i += 1) {
      const petal = new THREE.Mesh(new THREE.SphereGeometry(0.145, 12, 8), petalMaterial.clone());
      const angle = (i / petalCount) * Math.PI * 2;
      petal.position.set(Math.cos(angle) * 0.16, 0.54, Math.sin(angle) * 0.16);
      petal.scale.set(0.82, 0.18, 1.32);
      petal.rotation.set(0.34, angle, 0);
      petal.castShadow = true;
      petals.push(petal);
      group.add(petal);
    }

    const coreMaterial = new THREE.MeshStandardMaterial({
      color: 0xffdf65,
      emissive: 0xffb800,
      emissiveIntensity: 1.1,
      roughness: 0.34
    });
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), coreMaterial);
    core.position.y = 0.55;
    group.add(core);

    const aura = new THREE.PointLight(color, 0.55, 2.4);
    aura.position.y = 0.6;
    group.add(aura);

    return {
      id,
      group,
      core,
      petals,
      aura,
      position: position.clone(),
      phase: 3,
      regenTimer: randomRange(this.rand, 0, regenTimePerPhase),
      basePollen: randomRange(this.rand, 8, 14),
      swayOffset: this.rand() * Math.PI * 2,
      color
    };
  }

  private createLumens(): void {
    const colors = [0xffce55, 0x7edfff, 0xff8b47, 0xc58cff, 0xfff0af, 0x9ee87a, 0xff9fd8, 0xffce55];
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2;
      const position = new THREE.Vector3(Math.cos(angle) * 2.6, 1.45 + this.rand() * 0.9, Math.sin(angle) * 2.6);
      const lumen = this.createLumen(i, position, new THREE.Color(colors[i % colors.length]));
      this.lumens.push(lumen);
      this.scene.add(lumen.group);
    }
  }

  private createLumen(id: number, position: THREE.Vector3, color: THREE.Color): Lumen {
    const group = new THREE.Group();
    group.position.copy(position);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.5,
      roughness: 0.37,
      metalness: 0.05
    });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.28, 22, 16), bodyMaterial);
    body.scale.set(1.28, 0.78, 0.78);
    body.castShadow = true;
    group.add(body);

    const stripeMaterial = new THREE.MeshBasicMaterial({ color: 0x3a2811 });
    for (const x of [-0.14, 0.08]) {
      const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.022, 6, 20), stripeMaterial);
      stripe.position.x = x;
      stripe.rotation.y = Math.PI / 2;
      group.add(stripe);
    }

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 10), bodyMaterial.clone());
    head.position.x = 0.32;
    head.castShadow = true;
    group.add(head);

    const wingMaterial = new THREE.MeshStandardMaterial({
      color: 0xd8fbff,
      emissive: 0x8feeff,
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.55,
      roughness: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const wingLeft = new THREE.Mesh(new THREE.CircleGeometry(0.25, 24), wingMaterial);
    wingLeft.position.set(-0.05, 0.23, 0.22);
    wingLeft.scale.set(0.7, 1.2, 1);
    wingLeft.rotation.set(0.6, 0.15, -0.45);
    group.add(wingLeft);

    const wingRight = new THREE.Mesh(new THREE.CircleGeometry(0.25, 24), wingMaterial.clone());
    wingRight.position.set(-0.05, 0.23, -0.22);
    wingRight.scale.set(0.7, 1.2, 1);
    wingRight.rotation.set(-0.6, -0.15, 0.45);
    group.add(wingRight);

    const auraMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const aura = new THREE.Mesh(new THREE.SphereGeometry(0.58, 20, 12), auraMaterial);
    group.add(aura);

    const glow = new THREE.PointLight(color, 1.15, 4.4);
    group.add(glow);

    return {
      id,
      group,
      body,
      wingLeft,
      wingRight,
      glow,
      aura,
      position: position.clone(),
      velocity: new THREE.Vector3(),
      targetFlowerId: null,
      mode: "idle",
      harvestTimer: 0,
      harvestDuration: 0,
      seed: this.rand() * Math.PI * 2
    };
  }

  private setupInput(): void {
    this.hud.weatherToggle.addEventListener("click", () => this.toggleNight());

    window.addEventListener("keydown", (event: KeyboardEvent) => {
      this.keys.add(event.code);
      if (event.code === "KeyN") {
        this.toggleNight();
      }
    });
    window.addEventListener("keyup", (event: KeyboardEvent) => this.keys.delete(event.code));

    this.renderer.domElement.addEventListener("pointerdown", (event: PointerEvent) => {
      this.isDragging = true;
      this.lastPointer.set(event.clientX, event.clientY);
      this.renderer.domElement.setPointerCapture(event.pointerId);
    });
    this.renderer.domElement.addEventListener("pointerup", (event: PointerEvent) => {
      this.isDragging = false;
      this.renderer.domElement.releasePointerCapture(event.pointerId);
    });
    this.renderer.domElement.addEventListener("pointermove", (event: PointerEvent) => {
      if (!this.isDragging) {
        return;
      }
      const dx = event.clientX - this.lastPointer.x;
      const dy = event.clientY - this.lastPointer.y;
      this.lastPointer.set(event.clientX, event.clientY);
      this.cameraYaw -= dx * 0.006;
      this.cameraPitch = THREE.MathUtils.clamp(this.cameraPitch + dy * 0.0035, 0.12, 0.9);
    });
  }

  private toggleNight(): void {
    this.isNight = !this.isNight;
    this.auroraGroup.visible = this.isNight;
    this.hud.weatherLabel.textContent = this.isNight ? "Night · Aurora" : "Day · Clear";
    this.scene.background = new THREE.Color(this.isNight ? 0x0d1e55 : 0x79c9ff);
    this.scene.fog = new THREE.FogExp2(this.isNight ? 0x18255f : 0x8dd9ff, this.isNight ? 0.009 : 0.0065);
  }

  private update(): void {
    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, 0.033);
    this.elapsed += dt;
    this.updatePlayer(dt);
    this.updateCamera(dt);
    this.updateFlowers(dt);
    this.updateLumens(dt);
    this.updateBloomChain(dt);
    this.updateSparkles(dt);
    this.updateMotes();
    this.updateHud();
    this.composer.render();
  }

  private updatePlayer(dt: number): void {
    const forward = new THREE.Vector3(-Math.sin(this.cameraYaw), 0, -Math.cos(this.cameraYaw));
    const right = new THREE.Vector3(Math.cos(this.cameraYaw), 0, -Math.sin(this.cameraYaw));
    const input = new THREE.Vector3();
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) input.add(forward);
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) input.sub(forward);
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) input.add(right);
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) input.sub(right);

    if (input.lengthSq() > 0) {
      input.normalize();
      this.player.velocity.lerp(input.multiplyScalar(5.8), 1 - Math.exp(-dt * 12));
      const angle = Math.atan2(this.player.velocity.x, this.player.velocity.z);
      this.player.group.rotation.y = angle;
    } else {
      this.player.velocity.lerp(new THREE.Vector3(), 1 - Math.exp(-dt * 8));
    }

    this.player.position.addScaledVector(this.player.velocity, dt);
    const radius = Math.sqrt(this.player.position.x * this.player.position.x + this.player.position.z * this.player.position.z);
    if (radius > this.islandRadius - 1.0) {
      const scale = (this.islandRadius - 1.0) / radius;
      this.player.position.x *= scale;
      this.player.position.z *= scale;
      this.player.velocity.multiplyScalar(0.25);
    }
    this.player.position.y = 0.45 + Math.sin(this.elapsed * 6) * (this.player.velocity.length() > 0.2 ? 0.025 : 0.006);
    this.player.group.position.copy(this.player.position);
  }

  private updateCamera(dt: number): void {
    const toTree = new THREE.Vector3(-this.player.position.x, 0, -this.player.position.z);
    if (toTree.lengthSq() > 0.001) {
      toTree.normalize();
    }
    const target = this.player.position.clone().add(new THREE.Vector3(0, 5.6, 0)).addScaledVector(toTree, 4.4);
    const distance = 23.5;
    const horizontal = Math.cos(this.cameraPitch) * distance;
    const desired = new THREE.Vector3(
      target.x + Math.sin(this.cameraYaw) * horizontal,
      target.y + Math.sin(this.cameraPitch) * distance + 1.2,
      target.z + Math.cos(this.cameraYaw) * horizontal
    );
    this.camera.position.lerp(desired, 1 - Math.exp(-dt * 4.8));
    this.camera.lookAt(target);
  }

  private updateFlowers(dt: number): void {
    for (const flower of this.flowers) {
      if (flower.phase < 3) {
        flower.regenTimer += dt;
        while (flower.regenTimer >= regenTimePerPhase && flower.phase < 3) {
          flower.regenTimer -= regenTimePerPhase;
          flower.phase = (flower.phase + 1) as FlowerPhase;
        }
      } else {
        flower.regenTimer = 0;
      }

      const visual = FLOWER_PHASES[flower.phase];
      const recoveryPulse = flower.phase < 3 ? (Math.sin(this.elapsed * 4.8 + flower.swayOffset) + 1) * 0.08 : 0;
      const sway = Math.sin(this.elapsed * 1.2 + flower.swayOffset) * 0.055;
      flower.group.rotation.z = sway;
      flower.group.rotation.x = Math.cos(this.elapsed * 1.0 + flower.swayOffset) * 0.035;
      flower.core.material.emissiveIntensity = visual.glow + recoveryPulse;
      flower.core.scale.setScalar(0.85 + visual.openness * 0.35 + recoveryPulse);
      flower.aura.intensity = visual.glow * 0.52 + recoveryPulse;
      flower.aura.distance = 1.5 + visual.openness * 1.7;

      for (let i = 0; i < flower.petals.length; i += 1) {
        const petal = flower.petals[i];
        const angle = (i / flower.petals.length) * Math.PI * 2;
        petal.material.emissiveIntensity = 0.08 + visual.glow * 0.18;
        petal.material.color.copy(flower.color).lerp(new THREE.Color(0x8d897a), 1 - visual.saturation);
        const openRadius = 0.09 + visual.openness * 0.12;
        petal.position.set(Math.cos(angle) * openRadius, 0.48 + visual.openness * 0.08, Math.sin(angle) * openRadius);
        petal.scale.set(0.52 + visual.openness * 0.36, 0.12 + visual.openness * 0.06, 0.78 + visual.openness * 0.52);
        petal.rotation.set(0.75 - visual.openness * 0.46, angle, 0);
      }
    }
  }

  private updateLumens(dt: number): void {
    for (const lumen of this.lumens) {
      if (lumen.mode === "idle" || lumen.targetFlowerId === null) {
        this.assignLumenTarget(lumen);
      }

      const targetFlower = lumen.targetFlowerId === null ? null : this.flowers[lumen.targetFlowerId];
      if (targetFlower && lumen.mode === "travel") {
        const target = targetFlower.position.clone().add(new THREE.Vector3(0, 1.02 + Math.sin(this.elapsed * 2 + lumen.seed) * 0.16, 0));
        const toTarget = target.sub(lumen.position);
        const distance = toTarget.length();
        if (distance < 0.34) {
          lumen.mode = "harvest";
          lumen.harvestTimer = 0;
          lumen.harvestDuration = harvestBaseTime * FLOWER_PHASES[targetFlower.phase].harvestTime;
        } else {
          toTarget.normalize();
          const speed = 3.15 + Math.sin(lumen.seed) * 0.25;
          lumen.velocity.lerp(toTarget.multiplyScalar(speed), 1 - Math.exp(-dt * 7));
          lumen.position.addScaledVector(lumen.velocity, dt);
        }
      } else if (targetFlower && lumen.mode === "harvest") {
        lumen.velocity.multiplyScalar(0.88);
        lumen.harvestTimer += dt * (this.getLumenMultiplier(lumen) > 1 ? 1.12 : 1);
        if (lumen.harvestTimer >= lumen.harvestDuration) {
          this.harvestFlower(lumen, targetFlower);
          lumen.targetFlowerId = null;
          lumen.mode = "idle";
        }
      }

      const bob = Math.sin(this.elapsed * 9 + lumen.seed) * 0.055;
      lumen.group.position.copy(lumen.position).add(new THREE.Vector3(0, bob, 0));
      if (lumen.velocity.lengthSq() > 0.01) {
        const look = lumen.position.clone().add(lumen.velocity);
        lumen.group.lookAt(look);
      }
      const flap = Math.sin(this.elapsed * 38 + lumen.seed) * 0.48;
      lumen.wingLeft.rotation.z = -0.45 + flap;
      lumen.wingRight.rotation.z = 0.45 - flap;

      const chainGlow = this.isLumenConnected(lumen.id) ? 1 : 0;
      lumen.body.material.emissiveIntensity = 0.48 + chainGlow * 1.6 + Math.sin(this.elapsed * 3 + lumen.seed) * 0.05;
      lumen.glow.intensity = 1.05 + chainGlow * 2.2;
      lumen.aura.material.opacity = chainGlow ? 0.22 + Math.sin(this.elapsed * 8) * 0.08 : 0;
      lumen.aura.scale.setScalar(this.chain.mode === "ready" && this.chain.starterId === lumen.id ? 1.2 + Math.sin(this.elapsed * 8) * 0.25 : 1);
    }
  }

  private assignLumenTarget(lumen: Lumen): void {
    let bestFlower: Flower | null = null;
    let bestScore = -Infinity;
    for (const flower of this.flowers) {
      const alreadyTargeted = this.lumens.some((other) => other.id !== lumen.id && other.targetFlowerId === flower.id && other.mode === "travel");
      const dist = lumen.position.distanceTo(flower.position);
      const score = flower.phase * 3.8 - dist * 0.14 - (alreadyTargeted ? 2.5 : 0) + this.rand() * 0.85;
      if (score > bestScore) {
        bestScore = score;
        bestFlower = flower;
      }
    }
    if (bestFlower) {
      lumen.targetFlowerId = bestFlower.id;
      lumen.mode = "travel";
    }
  }

  private harvestFlower(lumen: Lumen, flower: Flower): void {
    const phase = FLOWER_PHASES[flower.phase];
    const multiplier = this.getLumenMultiplier(lumen);
    const pollen = flower.basePollen * phase.yield * multiplier;
    const nectar = pollen * 0.36;
    const honey = nectar * 0.48;
    this.resources.pollen += pollen;
    this.resources.nectar += nectar;
    this.resources.honey += honey;
    this.resources.wax += honey * 0.018;
    this.spawnSparkles(flower.position.clone().add(new THREE.Vector3(0, 0.75, 0)), flower.color, 12 + Math.floor(multiplier * 2));
    flower.phase = Math.max(0, flower.phase - 1) as FlowerPhase;
  }

  private updateBloomChain(dt: number): void {
    if (this.chain.messageTimer > 0) {
      this.chain.messageTimer -= dt;
    }

    if (this.chain.mode === "idle") {
      this.chain.nextTriggerTimer -= dt;
      if (this.chain.nextTriggerTimer <= 0 && this.lumens.length >= 3) {
        this.startChainReady();
      }
    } else if (this.chain.mode === "ready") {
      const starter = this.chain.starterId === null ? null : this.lumens[this.chain.starterId];
      if (starter && starter.position.distanceTo(this.player.position) < 1.55) {
        this.chain.mode = "active";
        this.chain.touchedIds = [starter.id];
        this.chain.boostedIds = new Set([starter.id]);
        this.chain.timer = 5;
        this.chain.multiplier = 1.5;
        this.chain.message = "BLOOM CHAIN";
        this.chain.messageTimer = 1.2;
        this.spawnSparkles(starter.position, new THREE.Color(0xffdf77), 18);
      }
    } else if (this.chain.mode === "active") {
      this.chain.timer -= dt;
      for (const lumen of this.lumens) {
        if (!this.chain.touchedIds.includes(lumen.id) && lumen.position.distanceTo(this.player.position) < 1.48) {
          this.chain.touchedIds.push(lumen.id);
          this.chain.boostedIds.add(lumen.id);
          this.chain.timer = 5;
          this.chain.multiplier = 1 + 0.5 * this.chain.touchedIds.length;
          this.spawnSparkles(lumen.position, new THREE.Color(0xffec91), 18);
        }
      }

      if (this.chain.touchedIds.length === this.lumens.length) {
        this.finishChain(true);
      } else if (this.chain.timer <= 0) {
        this.finishChain(false);
      }
    } else if (this.chain.mode === "boost") {
      this.chain.boostTimer -= dt;
      if (this.chain.boostTimer <= 0) {
        this.chain.mode = "idle";
        this.chain.boostedIds.clear();
        this.chain.touchedIds = [];
        this.chain.starterId = null;
        this.chain.multiplier = 1;
        this.chain.nextTriggerTimer = randomRange(this.rand, 8, 14);
        this.chain.perfect = false;
      }
    }

    this.updateChainLine();
  }

  private startChainReady(): void {
    const harvesting = this.lumens.filter((lumen) => lumen.mode === "harvest" || lumen.mode === "travel");
    const pool = harvesting.length >= 3 ? harvesting : this.lumens;
    const starter = pool[Math.floor(this.rand() * pool.length)];
    this.chain.mode = "ready";
    this.chain.starterId = starter.id;
    this.chain.touchedIds = [];
    this.chain.boostedIds.clear();
    this.chain.multiplier = 1;
    this.chain.timer = 0;
    this.chain.message = "";
    this.chain.messageTimer = 0;
  }

  private finishChain(perfect: boolean): void {
    this.chain.mode = "boost";
    this.chain.perfect = perfect;
    if (perfect) {
      this.chain.boostedIds = new Set(this.lumens.map((lumen) => lumen.id));
      this.chain.multiplier = 1 + 0.5 * this.lumens.length;
      this.chain.boostTimer = 20;
      this.chain.message = "PERFECT";
      this.chain.messageTimer = 1.8;
      this.spawnSparkles(this.player.position.clone().add(new THREE.Vector3(0, 1.2, 0)), new THREE.Color(0xfff2a5), 44);
    } else {
      this.chain.boostedIds = new Set(this.chain.touchedIds);
      this.chain.boostTimer = 10;
      this.chain.message = "FAILED";
      this.chain.messageTimer = 1.45;
    }
  }

  private updateChainLine(): void {
    const visible = this.chain.touchedIds.length > 1 && (this.chain.mode === "active" || this.chain.mode === "boost");
    this.chainLine.visible = visible;
    if (!visible) {
      return;
    }
    const points = this.chain.touchedIds
      .map((id) => this.lumens[id])
      .filter(Boolean)
      .map((lumen) => lumen.position.clone());
    this.chainLine.geometry.dispose();
    this.chainLine.geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = this.chainLine.material as THREE.LineBasicMaterial;
    material.color.set(this.chain.perfect ? 0xffef8a : 0x84f8ff);
    material.opacity = this.chain.mode === "boost" ? 0.68 : 0.95;
  }

  private getLumenMultiplier(lumen: Lumen): number {
    if (this.chain.mode === "active" && this.chain.touchedIds.includes(lumen.id)) {
      return this.chain.multiplier;
    }
    if (this.chain.mode === "boost" && this.chain.boostedIds.has(lumen.id)) {
      return this.chain.multiplier;
    }
    return 1;
  }

  private isLumenConnected(id: number): boolean {
    return (
      (this.chain.mode === "ready" && this.chain.starterId === id) ||
      (this.chain.mode === "active" && this.chain.touchedIds.includes(id)) ||
      (this.chain.mode === "boost" && this.chain.boostedIds.has(id))
    );
  }

  private spawnSparkles(position: THREE.Vector3, color: THREE.Color, count: number): void {
    for (let i = 0; i < count; i += 1) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(randomRange(this.rand, 0.025, 0.07), 8, 6),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 1,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      );
      mesh.position.copy(position);
      this.scene.add(mesh);
      this.sparkles.push({
        mesh,
        velocity: new THREE.Vector3(randomRange(this.rand, -0.75, 0.75), randomRange(this.rand, 0.7, 1.9), randomRange(this.rand, -0.75, 0.75)),
        life: randomRange(this.rand, 0.45, 0.9),
        maxLife: 0.9
      });
    }
  }

  private updateSparkles(dt: number): void {
    for (let i = this.sparkles.length - 1; i >= 0; i -= 1) {
      const sparkle = this.sparkles[i];
      sparkle.life -= dt;
      sparkle.velocity.y -= dt * 0.55;
      sparkle.mesh.position.addScaledVector(sparkle.velocity, dt);
      sparkle.mesh.material.opacity = Math.max(0, sparkle.life / sparkle.maxLife);
      sparkle.mesh.scale.setScalar(0.75 + (1 - sparkle.life / sparkle.maxLife) * 1.8);
      if (sparkle.life <= 0) {
        sparkle.mesh.geometry.dispose();
        sparkle.mesh.material.dispose();
        this.scene.remove(sparkle.mesh);
        this.sparkles.splice(i, 1);
      }
    }
  }

  private updateMotes(): void {
    const positionAttribute = this.moteGeometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < positionAttribute.count; i += 1) {
      const baseY = this.moteBaseY[i];
      positionAttribute.setY(i, baseY + Math.sin(this.elapsed * 0.9 + this.moteOffsets[i]) * 0.42);
    }
    positionAttribute.needsUpdate = true;
  }

  private updateHud(): void {
    this.honeySamples.push({ time: this.elapsed, honey: this.resources.honey });
    while (this.honeySamples.length > 0 && this.elapsed - this.honeySamples[0].time > 5) {
      this.honeySamples.shift();
    }
    if (this.honeySamples.length > 1) {
      const first = this.honeySamples[0];
      const last = this.honeySamples[this.honeySamples.length - 1];
      this.resources.hps = (last.honey - first.honey) / Math.max(0.1, last.time - first.time);
    }

    this.hud.hps.textContent = `${formatNumber(this.resources.hps)}/s`;
    this.hud.pollen.textContent = formatNumber(this.resources.pollen);
    this.hud.nectar.textContent = formatNumber(this.resources.nectar);
    this.hud.honey.textContent = formatNumber(this.resources.honey);
    this.hud.wax.textContent = formatNumber(this.resources.wax);

    if (this.chain.mode === "ready") {
      this.hud.chainText.textContent = "Bloom Chain ready";
      this.hud.chainFill.style.width = "100%";
    } else if (this.chain.mode === "active") {
      this.hud.chainText.textContent = `x${this.chain.multiplier.toFixed(1)} · ${this.chain.timer.toFixed(1)}s`;
      this.hud.chainFill.style.width = `${THREE.MathUtils.clamp((this.chain.timer / 5) * 100, 0, 100)}%`;
    } else if (this.chain.mode === "boost") {
      this.hud.chainText.textContent = `Boost x${this.chain.multiplier.toFixed(1)} · ${Math.ceil(this.chain.boostTimer)}s`;
      const max = this.chain.perfect ? 20 : 10;
      this.hud.chainFill.style.width = `${THREE.MathUtils.clamp((this.chain.boostTimer / max) * 100, 0, 100)}%`;
    } else {
      this.hud.chainText.textContent = "Bloom Chain dormant";
      this.hud.chainFill.style.width = "0%";
    }

    if (this.chain.messageTimer > 0) {
      this.hud.message.textContent = this.chain.message;
      this.hud.message.classList.add("visible");
      this.hud.message.style.color = this.chain.message === "FAILED" ? "#ff6674" : "#ffef93";
    } else {
      this.hud.message.classList.remove("visible");
    }
  }
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app root.");
}

new LuminhiveGame(app);
