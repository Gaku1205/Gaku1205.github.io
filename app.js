(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const STORAGE_KEY = 'casino-roulette.v1';
  const START_COINS = 1000;
  const HISTORY_LIMIT = 24;
  const reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ヨーロピアン式の並び(時計回り)
  const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
    5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  const N = ORDER.length;
  const SEG = TAU / N;
  const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const colorOf = (n) => (n === 0 ? 'vert' : REDS.has(n) ? 'rouge' : 'noir');

  const CHIPS = [
    { v: 1, bg: '#ece4d3', edge: '#2f4f8f', inlay: '#2f4f8f', fg: '#1d2b4f' },
    { v: 5, bg: '#a8323a', edge: '#ece4d3', inlay: '#ece4d3', fg: '#fff6ea' },
    { v: 10, bg: '#2f4f8f', edge: '#ece4d3', inlay: '#ece4d3', fg: '#fff6ea' },
    { v: 50, bg: '#2a6b55', edge: '#ece4d3', inlay: '#ece4d3', fg: '#fff6ea' },
    { v: 100, bg: '#16181d', edge: '#c8a35a', inlay: '#c8a35a', fg: '#e6cc8f' },
  ];

  // 数字以外の賭け。ret は賭け金込みの払い戻し倍率
  const OUTSIDE = [
    { key: 'low', fr: 'Manque', ja: '1–18', ret: 2, test: (n) => n >= 1 && n <= 18 },
    { key: 'even', fr: 'Pair', ja: '偶数', ret: 2, test: (n) => n > 0 && n % 2 === 0 },
    { key: 'red', fr: 'Rouge', ja: '赤', ret: 2, swatch: 'rouge', test: (n) => REDS.has(n) },
    { key: 'black', fr: 'Noir', ja: '黒', ret: 2, swatch: 'noir', test: (n) => n > 0 && !REDS.has(n) },
    { key: 'odd', fr: 'Impair', ja: '奇数', ret: 2, test: (n) => n % 2 === 1 },
    { key: 'high', fr: 'Passe', ja: '19–36', ret: 2, test: (n) => n >= 19 },
  ];
  const DOZENS = [1, 2, 3].map((k) => ({
    key: `dz${k}`, fr: `${(k - 1) * 12 + 1}–${k * 12}`, ja: ['12P', '12M', '12D'][k - 1], ret: 3,
    test: (n) => n > 0 && Math.ceil(n / 12) === k,
  }));
  const COLUMNS = [1, 2, 3].map((k) => ({
    key: `col${k}`, fr: '2:1', ja: `${k}列目`, ret: 3,
    test: (n) => n > 0 && ((n - 1) % 3) + 1 === k,
  }));
  const SPECIAL = new Map([...OUTSIDE, ...DOZENS, ...COLUMNS].map((b) => [b.key, b]));

  const returnOf = (key) => (key.startsWith('n:') ? 36 : SPECIAL.get(key).ret);
  const wins = (key, n) => (key.startsWith('n:') ? Number(key.slice(2)) === n : SPECIAL.get(key).test(n));
  const isValidKey = (key) => SPECIAL.has(key) || /^n:(\d|[12]\d|3[0-6])$/.test(key);

  const $ = (id) => document.getElementById(id);
  const els = {
    scene: $('scene'), wrap: $('wheelWrap'), fallback: $('fallback'),
    resultText: $('resultText'), spin: $('spinBtn'),
    wheelSpeed: $('wheelSpeed'), ballSpeed: $('ballSpeed'), wheelOut: $('wheelOut'), ballOut: $('ballOut'),
    sound: $('soundBtn'), balance: $('balance'), staked: $('staked'), delta: $('delta'),
    announce: $('announce'), announceNum: $('announceNum'), announceSub: $('announceSub'),
    coinLayer: $('coinLayer'), chips: $('chips'), grid: $('grid'),
    undo: $('undoBtn'), clear: $('clearBtn'), rebet: $('rebetBtn'), refill: $('refillBtn'), hint: $('hint'),
    history: $('history'), historyEmpty: $('historyEmpty'), historyStats: $('historyStats'),
  };

  const state = {
    balance: START_COINS,
    bets: new Map(), // key -> 枚数
    placed: [], // 「ひとつ戻す」用 [key, 枚数]
    lastBets: [],
    history: [],
    chip: 10,
    sound: true,
    wheelSpeed: 0.15, // 回転/秒
    ballSpeed: 3, // 回転/秒
    spinning: false,
  };

  const mod = (a) => ((a % TAU) + TAU) % TAU;
  const totalStaked = () => [...state.bets.values()].reduce((a, b) => a + b, 0);

  // ---------- 保存 ----------
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!s) return;
      if (Number.isFinite(s.balance) && s.balance >= 0) state.balance = Math.floor(s.balance);
      if (Array.isArray(s.bets)) state.bets = new Map(s.bets.filter((b) => isValidKey(b[0]) && Number(b[1]) > 0));
      if (Array.isArray(s.lastBets)) state.lastBets = s.lastBets.filter((b) => isValidKey(b[0]) && Number(b[1]) > 0);
      if (Array.isArray(s.history)) state.history = s.history.filter((n) => Number.isInteger(n) && n >= 0 && n <= 36).slice(0, HISTORY_LIMIT);
      if (CHIPS.some((c) => c.v === s.chip)) state.chip = s.chip;
      if (typeof s.sound === 'boolean') state.sound = s.sound;
      if (Number.isFinite(s.wheelSpeed)) state.wheelSpeed = s.wheelSpeed;
      if (Number.isFinite(s.ballSpeed)) state.ballSpeed = s.ballSpeed;
    } catch (e) { /* 保存なしでも動く */ }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        balance: state.balance, bets: [...state.bets], lastBets: state.lastBets,
        history: state.history, chip: state.chip, sound: state.sound,
        wheelSpeed: state.wheelSpeed, ballSpeed: state.ballSpeed,
      }));
    } catch (e) { /* 無視 */ }
  }

  // ---------- 効果音 ----------
  let ac = null;
  let lastTick = 0;

  function audio() {
    if (!state.sound) return null;
    if (!ac) {
      try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }

  function tone(freq, delay, dur, gain, type, endFreq) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime + delay;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  const sfx = {
    tick() {
      const now = performance.now();
      if (now - lastTick < 30) return;
      lastTick = now;
      tone(2200, 0, 0.03, 0.06, 'square', 1200);
    },
    clack() { tone(900, 0, 0.08, 0.14, 'triangle', 300); },
    coin() { tone(1900, 0, 0.08, 0.08, 'sine'); tone(2600, 0.05, 0.12, 0.07, 'sine'); },
    win() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.11, 0.45, 0.13, 'sine')); },
    lose() { tone(330, 0, 0.35, 0.1, 'triangle', 160); },
  };

  // ---------- 3D ----------
  const ROTOR_R = 0.84; // 回転盤の半径
  const NUM_IN = 0.66; // 数字リングの内側 = ポケットの外側
  const POCKET_IN = 0.5; // ポケットの内側
  const REST_R = 0.58; // ポケットに入ったボールの半径
  const BALL_R = 0.03;
  const POCKET_Y = 0.04;

  // ボウル(静止部)の断面 [半径, 高さ]。内側から外へ、すり鉢状に上がる
  const TRACK = [[0.85, 0.095], [0.93, 0.12], [1.0, 0.15], [1.06, 0.185], [1.11, 0.225],
    [1.15, 0.265], [1.175, 0.31], [1.19, 0.36], [1.2, 0.385]];
  const RIM = [[1.2, 0.385], [1.215, 0.4], [1.26, 0.405], [1.31, 0.4], [1.35, 0.385], [1.375, 0.35],
    [1.38, 0.3], [1.385, 0.05], [1.4, -0.05], [1.44, -0.14], [1.47, -0.2], [1.47, -0.3]];

  const numberY = (r) => 0.07 + ((r - NUM_IN) / (ROTOR_R - NUM_IN)) * 0.025;
  const coneY = (r) => 0.07 + Math.pow((POCKET_IN - r) / (POCKET_IN - 0.12), 1.4) * 0.11;

  function interp(points, r) {
    if (r <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) {
      const [r1, y1] = points[i];
      if (r <= r1) {
        const [r0, y0] = points[i - 1];
        return y0 + ((r - r0) / (r1 - r0)) * (y1 - y0);
      }
    }
    return points[points.length - 1][1];
  }

  // その半径での盤面の高さ
  function surfaceY(r) {
    if (r >= 0.85) return interp(TRACK, r);
    if (r >= ROTOR_R) return 0.095;
    if (r >= NUM_IN) return numberY(r);
    if (r >= POCKET_IN) return POCKET_Y;
    return coneY(r);
  }

  let renderer, scene, camera, wheel, ballMesh;
  let phi = 0; // 盤の回転角(時計回り)
  const ghosts = []; // 速いときのボールの残像
  let glow = null; // 当たりポケットの光
  let glowT = 0;

  // カメラ演出。zoom 0 = 通常、正で寄り、負で引き。yaw は水平方向の回り込み
  const rig = { zoom: reducedMotion ? 0 : -0.8, yaw: reducedMotion ? 0 : 0.6, targetZoom: 0, targetYaw: 0, speed: 1.1, release: 0 };

  function camTo(zoom, yaw, speed) {
    clearTimeout(rig.release);
    if (reducedMotion) return;
    rig.targetZoom = zoom;
    rig.targetYaw = yaw;
    rig.speed = speed;
  }

  const ball = {
    phase: 'rest', // rest | orbit | drop
    theta: 0, // ワールド上の角度(時計回り、奥が0)
    r: REST_R,
    hop: 0,
    psi: 0.5 * SEG, // 盤から見た角度(rest / drop 中)
    t: 0,
    w0: 0,
    w: 0, // 現在の周回速度(回転/秒)
    drop: null,
  };

  const srgb = (hex) => new THREE.Color(hex).convertSRGBToLinear();

  function canvasTexture(cv) {
    const t = new THREE.CanvasTexture(cv);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  }

  // 円周方向に木目が走るテクスチャ
  function woodTexture(base, dark, light, repeat) {
    const cv = document.createElement('canvas');
    cv.width = 1024;
    cv.height = 256;
    const g = cv.getContext('2d');
    g.fillStyle = base;
    g.fillRect(0, 0, 1024, 256);
    for (let i = 0; i < 260; i++) {
      const y = Math.random() * 256;
      const amp = 1 + Math.random() * 4;
      const freq = 0.004 + Math.random() * 0.01;
      const ph = Math.random() * TAU;
      g.strokeStyle = Math.random() < 0.65 ? dark : light;
      g.globalAlpha = 0.05 + Math.random() * 0.16;
      g.lineWidth = 0.5 + Math.random() * 2.5;
      g.beginPath();
      for (let x = 0; x <= 1024; x += 16) {
        const yy = y + Math.sin(x * freq * TAU + ph) * amp;
        if (x === 0) g.moveTo(x, yy); else g.lineTo(x, yy);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
    const t = canvasTexture(cv);
    t.wrapS = THREE.RepeatWrapping;
    t.repeat.set(repeat, 1);
    return t;
  }

  // 回転盤の上面(数字・ポケット・中央の木部)
  function rotorTexture() {
    const S = 2048;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d');
    const c = S / 2;
    const R = c; // = ROTOR_R
    const f = (rw) => (rw / ROTOR_R) * R;

    const wood = g.createRadialGradient(c, c, 0, c, c, R);
    wood.addColorStop(0, '#6a3d1e');
    wood.addColorStop(0.6, '#4a2914');
    wood.addColorStop(1, '#2c180b');
    g.fillStyle = wood;
    g.fillRect(0, 0, S, S);

    // 中央の木部に放射状の木目
    for (let i = 0; i < 900; i++) {
      const a = Math.random() * TAU;
      const r0 = f(0.12) + Math.random() * f(0.3);
      g.strokeStyle = Math.random() < 0.6 ? '#2a1509' : '#8a5a30';
      g.globalAlpha = 0.04 + Math.random() * 0.08;
      g.lineWidth = 1 + Math.random() * 2;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
      g.lineTo(c + Math.cos(a) * (r0 + f(0.08)), c + Math.sin(a) * (r0 + f(0.08)));
      g.stroke();
    }
    g.globalAlpha = 1;

    const band = (r0, r1, a0, a1, color) => {
      g.beginPath();
      g.arc(c, c, r1, a0, a1);
      g.arc(c, c, r0, a1, a0, true);
      g.closePath();
      g.fillStyle = color;
      g.fill();
    };

    const face = { rouge: '#b3262e', noir: '#17191e', vert: '#1d7a55' };
    const well = { rouge: '#7c161c', noir: '#0c0d10', vert: '#105a3c' };

    for (let i = 0; i < N; i++) {
      const a0 = -Math.PI / 2 + i * SEG;
      const col = colorOf(ORDER[i]);
      band(f(NUM_IN), f(0.835), a0, a0 + SEG, face[col]);
      band(f(POCKET_IN), f(NUM_IN), a0, a0 + SEG, well[col]);
    }

    // 数字リングの仕切り線
    g.strokeStyle = '#d9bd7a';
    g.lineWidth = 3;
    for (let i = 0; i < N; i++) {
      const a = -Math.PI / 2 + i * SEG;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * f(NUM_IN), c + Math.sin(a) * f(NUM_IN));
      g.lineTo(c + Math.cos(a) * f(0.835), c + Math.sin(a) * f(0.835));
      g.stroke();
    }
    [[NUM_IN, 6], [POCKET_IN, 6], [0.835, 8]].forEach(([rw, w]) => {
      g.lineWidth = w;
      g.beginPath();
      g.arc(c, c, f(rw), 0, TAU);
      g.stroke();
    });

    // 数字
    g.fillStyle = '#f3ecdc';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '600 74px "Helvetica Neue", Arial, sans-serif';
    for (let i = 0; i < N; i++) {
      g.save();
      g.translate(c, c);
      g.rotate((i + 0.5) * SEG);
      g.fillText(String(ORDER[i]), 0, -f(0.75));
      g.restore();
    }

    // 中央の象嵌(真鍮の線)
    g.strokeStyle = 'rgba(217,189,122,0.75)';
    g.lineWidth = 4;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + Math.PI / 4;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * f(0.16), c + Math.sin(a) * f(0.16));
      g.lineTo(c + Math.cos(a) * f(0.46), c + Math.sin(a) * f(0.46));
      g.stroke();
    }
    g.lineWidth = 3;
    g.beginPath();
    g.arc(c, c, f(0.46), 0, TAU);
    g.stroke();

    return canvasTexture(cv);
  }

  // 平面のリングを高さ関数 h(r) で曲げたジオメトリ。UVは回転盤テクスチャ全体に合わせる
  function shapedRing(r0, r1, segs, rings, h) {
    const pos = [];
    const uv = [];
    const idx = [];
    for (let j = 0; j <= rings; j++) {
      const r = r0 + ((r1 - r0) * j) / rings;
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * TAU;
        const x = r * Math.cos(a);
        const y = r * Math.sin(a);
        pos.push(x, h(r), -y);
        uv.push((x / ROTOR_R + 1) / 2, (y / ROTOR_R + 1) / 2);
      }
    }
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < segs; i++) {
        const a = j * (segs + 1) + i;
        const b = a + segs + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  const lathe = (points, segs) => new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segs);

  function environment() {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = new THREE.Scene();
    env.add(new THREE.Mesh(
      new THREE.SphereGeometry(10, 32, 16),
      new THREE.MeshBasicMaterial({ color: 0x1c1a1c, side: THREE.BackSide })
    ));
    const panel = (w, h, color, x, y, z) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      env.add(m);
    };
    panel(7, 3, new THREE.Color(5, 4.5, 3.8), 0, 7, 1.5);
    panel(3, 6, new THREE.Color(1.2, 1.4, 1.9), -7, 2.5, -2);
    panel(4, 3, new THREE.Color(2.2, 1.9, 1.5), 6, 2, 5);
    const tex = pmrem.fromScene(env, 0.03).texture;
    pmrem.dispose();
    return tex;
  }

  function initScene() {
    try {
      renderer = new THREE.WebGLRenderer({ canvas: els.scene, antialias: true, alpha: true });
    } catch (e) {
      els.fallback.hidden = false;
      return false;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    scene = new THREE.Scene();
    scene.environment = environment();

    camera = new THREE.PerspectiveCamera(30, 1.1, 0.1, 50);
    camera.position.set(0, 4.3, 3.55);
    camera.lookAt(0, -0.12, 0.12);

    scene.add(new THREE.HemisphereLight(0xfff1dc, 0x101418, 0.35));
    const key = new THREE.DirectionalLight(0xfff0d8, 2.1);
    key.position.set(1.3, 6, 1.6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -1.9, right: 1.9, top: 1.9, bottom: -1.9, near: 1, far: 12 });
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.01;
    key.shadow.radius = 3;
    scene.add(key);
    const rimLight = new THREE.DirectionalLight(0xbcd2ff, 0.45);
    rimLight.position.set(-3, 2.5, -2.5);
    scene.add(rimLight);

    // 卓に落ちる影だけを描く床
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({ opacity: 0.5 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.3;
    ground.receiveShadow = true;
    scene.add(ground);

    const brass = new THREE.MeshStandardMaterial({ color: srgb('#c9a45c'), roughness: 0.28, metalness: 1 });
    const darkWood = new THREE.MeshStandardMaterial({
      color: srgb('#ffffff'), map: woodTexture('#3b1f0f', '#1c0d05', '#6a3a1c', 6),
      roughness: 0.38, metalness: 0, side: THREE.DoubleSide,
    });
    const trackWood = new THREE.MeshStandardMaterial({
      color: srgb('#ffffff'), map: woodTexture('#5a2e15', '#2a1307', '#83502a', 8),
      roughness: 0.2, metalness: 0, side: THREE.DoubleSide,
    });

    // ---- ボウル(静止部) ----
    const track = new THREE.Mesh(lathe(TRACK, 192), trackWood);
    track.receiveShadow = true;
    scene.add(track);

    const rim = new THREE.Mesh(lathe(RIM, 192), darkWood);
    rim.castShadow = true;
    rim.receiveShadow = true;
    scene.add(rim);

    const ring = (r, y, tube) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 12, 192), brass);
      m.rotation.x = Math.PI / 2;
      m.position.y = y;
      scene.add(m);
    };
    ring(1.205, 0.393, 0.009);
    ring(1.386, 0.05, 0.012);
    ring(0.852, 0.097, 0.006);

    // 回転盤との隙間の内壁
    const well = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.2, 192, 1, true), darkWood);
    well.position.y = -0.005;
    scene.add(well);

    // ディフレクター(菱形の障害物)。縦向きと横向きを交互に
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + Math.PI / 8;
      const r = 1.0;
      const d = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), brass);
      d.scale.set(0.016, 0.014, 0.05);
      if (i % 2) d.scale.set(0.05, 0.014, 0.016);
      d.position.set(Math.sin(a) * r, surfaceY(r) + 0.01, -Math.cos(a) * r);
      d.rotation.y = -a;
      d.castShadow = true;
      scene.add(d);
    }

    // ---- 回転盤 ----
    wheel = new THREE.Group();
    scene.add(wheel);

    const top = rotorTexture();
    const faceMat = new THREE.MeshStandardMaterial({ map: top, roughness: 0.4, metalness: 0, side: THREE.DoubleSide });

    const add = (mesh, cast) => {
      mesh.receiveShadow = true;
      if (cast) mesh.castShadow = true;
      wheel.add(mesh);
      return mesh;
    };

    add(new THREE.Mesh(shapedRing(NUM_IN, ROTOR_R, 222, 2, numberY), faceMat));
    add(new THREE.Mesh(shapedRing(POCKET_IN, NUM_IN, 222, 1, () => POCKET_Y), faceMat));
    add(new THREE.Mesh(shapedRing(0.12, POCKET_IN, 222, 8, coneY), faceMat), true);

    // ポケットの内壁と外壁
    const pocketWall = new THREE.MeshStandardMaterial({ color: srgb('#2a170b'), roughness: 0.5, side: THREE.DoubleSide });
    const outerWall = new THREE.Mesh(new THREE.CylinderGeometry(NUM_IN, NUM_IN, 0.03, 222, 1, true), pocketWall);
    outerWall.position.y = POCKET_Y + 0.015;
    add(outerWall);
    const innerWall = new THREE.Mesh(new THREE.CylinderGeometry(POCKET_IN, POCKET_IN, 0.03, 222, 1, true), pocketWall);
    innerWall.position.y = POCKET_Y + 0.015;
    add(innerWall);

    // 回転盤の側面
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(ROTOR_R, ROTOR_R, 0.14, 222, 1, true), darkWood);
    skirt.position.y = 0.025;
    add(skirt);

    // ポケットの仕切り(フレット)
    const fretGeo = new THREE.BoxGeometry(0.008, 0.038, NUM_IN - POCKET_IN);
    for (let i = 0; i < N; i++) {
      const a = i * SEG;
      const r = (NUM_IN + POCKET_IN) / 2;
      const fret = new THREE.Mesh(fretGeo, brass);
      fret.position.set(Math.sin(a) * r, POCKET_Y + 0.019, -Math.cos(a) * r);
      fret.rotation.y = -a;
      add(fret, true);
    }

    // 中央のスピンドルと十字のハンドル
    const turretProfile = [[0.12, 0.178], [0.1, 0.19], [0.06, 0.205], [0.04, 0.225], [0.032, 0.26],
      [0.03, 0.3], [0.042, 0.315], [0.048, 0.33], [0.04, 0.345], [0.022, 0.36], [0.008, 0.372], [0, 0.375]];
    add(new THREE.Mesh(lathe(turretProfile, 64), brass), true);
    const armGeo = new THREE.CylinderGeometry(0.009, 0.009, 0.36, 16);
    const tipGeo = new THREE.SphereGeometry(0.02, 20, 12);
    [0, Math.PI / 2].forEach((rot) => {
      const arm = new THREE.Mesh(armGeo, brass);
      arm.rotation.set(0, rot, Math.PI / 2);
      arm.position.y = 0.33;
      add(arm, true);
      [-1, 1].forEach((s) => {
        const tip = new THREE.Mesh(tipGeo, brass);
        tip.position.set(Math.cos(rot) * 0.18 * s, 0.33, -Math.sin(rot) * 0.18 * s);
        add(tip, true);
      });
    });

    // ボール
    ballMesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_R, 32, 20),
      new THREE.MeshStandardMaterial({ color: srgb('#f4f0e6'), roughness: 0.16, metalness: 0 })
    );
    ballMesh.castShadow = true;
    scene.add(ballMesh);

    for (let k = 1; k <= 7; k++) {
      const g = new THREE.Mesh(ballMesh.geometry, new THREE.MeshBasicMaterial({
        color: srgb('#f4f0e6'), transparent: true, opacity: 0, depthWrite: false,
      }));
      g.scale.setScalar(1 - k * 0.07);
      g.visible = false;
      scene.add(g);
      ghosts.push(g);
    }

    resize();
    return true;
  }

  function resize() {
    if (!renderer) return;
    const w = els.wrap.clientWidth;
    const h = els.wrap.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // 縦長の画面でも盤の左右が切れないように画角を広げる
    camera.fov = camera.aspect < 1.12 ? 30 * (1.12 / camera.aspect) ** 0.85 : 30;
    camera.updateProjectionMatrix();
  }

  // ---------- ボールの動き ----------
  const DECAY = 0.3; // 周回速度の減衰率(/秒)
  const DROP_SPEED = 0.9; // この速さ(回転/秒)まで落ちたら内側へ落ちる
  const DROP_DUR = 2.6;

  // 周回中の半径。速いほど外壁に押し付けられる
  const orbitR = (w) => 1.065 + 0.08 * Math.min(1, w / 3);

  function launch() {
    ball.phase = 'orbit';
    ball.t = 0;
    ball.theta = Math.random() * TAU;
    ball.w0 = state.ballSpeed * (0.92 + Math.random() * 0.16);
    ball.w = ball.w0;
    ball.r = orbitR(ball.w0);
    ball.hop = 0;
  }

  function startDrop() {
    const psi0 = mod(ball.theta - phi);
    const target = Math.floor(Math.random() * N);
    const center = (target + 0.5) * SEG;
    // 盤から見ると、ボールは反時計回り(角度が減る向き)に進み続ける
    let delta = mod(psi0 - center);
    if (delta < Math.PI) delta += TAU;
    ball.phase = 'drop';
    ball.t = 0;
    ball.drop = { psi0, delta, target, r0: ball.r, lastIdx: -1, lastHop: 0 };
    ball.w = 0;
    camTo(0.62, -0.14, 1.4);
  }

  function updateBall(dt) {
    if (ball.phase === 'orbit') {
      ball.t += dt;
      const w = ball.w0 * Math.exp(-DECAY * ball.t);
      ball.theta -= w * TAU * dt;
      ball.w = w;
      ball.r = orbitR(w);
      if ((ball.t >= 2 && w <= DROP_SPEED) || ball.t > 14) startDrop();
    } else if (ball.phase === 'drop') {
      ball.t += dt;
      const d = ball.drop;
      const u = Math.min(1, ball.t / DROP_DUR);
      const eased = 1 - Math.pow(1 - u, 3);
      ball.psi = d.psi0 - d.delta * eased;
      ball.theta = phi + ball.psi;

      // 斜面を転がり落ちてから、ポケットの上で弾む
      const inward = Math.min(1, u / 0.42);
      const smooth = inward * inward * (3 - 2 * inward);
      ball.r = d.r0 + (REST_R - d.r0) * smooth;

      const hops = u * 6;
      ball.hop = u > 0.3 ? Math.abs(Math.sin(hops * Math.PI)) * 0.085 * Math.pow(1 - u, 1.5) : 0;
      const hopIdx = Math.floor(hops);
      if (u > 0.3 && hopIdx !== d.lastHop && u < 0.85) sfx.clack();
      d.lastHop = hopIdx;

      const idx = Math.floor(mod(ball.psi) / SEG);
      if (idx !== d.lastIdx && u > 0.35) sfx.tick();
      d.lastIdx = idx;

      if (u >= 1) {
        ball.phase = 'rest';
        ball.psi = (d.target + 0.5) * SEG;
        ball.hop = 0;
        ball.r = REST_R;
        finish(ORDER[d.target]);
      }
    } else {
      ball.theta = phi + ball.psi;
    }
  }

  // 速く回っているボールの後ろに残像を並べる(ボールは角度が減る向きに進む)
  function updateGhosts() {
    const blur = ball.phase === 'orbit' && !reducedMotion ? Math.min(1, Math.max(0, (ball.w - 0.6) / 2.5)) : 0;
    const step = Math.min(0.045, ball.w * 0.012);
    ghosts.forEach((g, i) => {
      const k = i + 1;
      g.visible = blur > 0.01;
      if (!g.visible) return;
      const a = ball.theta + k * step;
      g.position.set(Math.sin(a) * ball.r, ballMesh.position.y, -Math.cos(a) * ball.r);
      g.material.opacity = blur * 0.5 * (1 - k / 8);
    });
  }

  // 盤から見て i 番目のポケットの扇形
  function sectorGeometry(i, r0, r1) {
    const segs = 8;
    const rings = 3;
    const pos = [];
    const idx = [];
    for (let j = 0; j <= rings; j++) {
      const r = r0 + ((r1 - r0) * j) / rings;
      for (let s = 0; s <= segs; s++) {
        const a = (i + s / segs) * SEG;
        pos.push(Math.sin(a) * r, surfaceY(r) + 0.003, -Math.cos(a) * r);
      }
    }
    for (let j = 0; j < rings; j++) {
      for (let s = 0; s < segs; s++) {
        const a = j * (segs + 1) + s;
        const b = a + segs + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    return geo;
  }

  function showGlow(i) {
    clearGlow();
    if (!renderer) return;
    const mat = new THREE.MeshBasicMaterial({
      color: srgb('#ffd98a'), transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    glow = new THREE.Group();
    glow.add(new THREE.Mesh(sectorGeometry(i, POCKET_IN + 0.004, NUM_IN - 0.004), mat));
    glow.add(new THREE.Mesh(sectorGeometry(i, NUM_IN + 0.002, ROTOR_R - 0.006), mat));
    glow.userData.mat = mat;
    wheel.add(glow);
    glowT = 0;
  }

  function clearGlow() {
    if (!glow) return;
    wheel.remove(glow);
    glow.children.forEach((m) => m.geometry.dispose());
    glow.userData.mat.dispose();
    glow = null;
  }

  function updateGlow(dt) {
    if (!glow) return;
    glowT += dt;
    const pulse = reducedMotion ? 0.4 : 0.32 + 0.18 * Math.sin(glowT * 5);
    glow.userData.mat.opacity = Math.min(1, glowT * 2.5) * pulse;
  }

  function updateCamera(dt) {
    const k = 1 - Math.exp(-dt * rig.speed);
    rig.zoom += (rig.targetZoom - rig.zoom) * k;
    rig.yaw += (rig.targetYaw - rig.yaw) * k;
    const z = rig.zoom;
    const near = Math.max(0, z);
    const lookY = -0.12 + 0.12 * near;
    const lookZ = 0.12 - 0.1 * near;
    const scale = 1 - 0.3 * z;
    const oy = 4.42 * scale * (1 - 0.1 * near);
    const oz = 3.43 * scale;
    camera.position.set(Math.sin(rig.yaw) * oz, lookY + oy, lookZ + Math.cos(rig.yaw) * oz);
    camera.lookAt(0, lookY, lookZ);
  }

  let lastTime = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    phi += state.wheelSpeed * TAU * dt;
    updateBall(dt);

    if (!renderer) return;
    wheel.rotation.y = -phi;
    const y = surfaceY(ball.r) + BALL_R + ball.hop;
    ballMesh.position.set(Math.sin(ball.theta) * ball.r, y, -Math.cos(ball.theta) * ball.r);
    updateGhosts();
    updateGlow(dt);
    updateCamera(dt);
    renderer.render(scene, camera);
  }

  // ---------- 状況の表示 ----------
  const COLOR_JA = { rouge: '赤', noir: '黒', vert: '緑' };

  function describe(n) {
    const parts = [COLOR_JA[colorOf(n)]];
    if (n > 0) parts.push(n % 2 ? '奇数' : '偶数', n <= 18 ? '1–18' : '19–36');
    return parts;
  }

  function setStatus(text, tone) {
    els.resultText.textContent = text;
    els.resultText.className = `call-ja${tone ? ` ${tone}` : ''}`;
    const box = els.resultText.parentElement;
    box.classList.remove('swap');
    void box.offsetWidth;
    box.classList.add('swap');
  }

  // ---------- 回す ----------
  function spin() {
    if (state.spinning) return;
    audio(); // ユーザー操作の中で初期化
    state.spinning = true;
    if (state.bets.size) state.lastBets = [...state.bets];
    clearHits();
    clearGlow();
    hideAnnounce(true);
    camTo(0.3, 0, 1.0);
    setStatus('ボールが回っています。賭けは締め切りです');
    renderAll();
    launch();

    // 盤が画面外にあるときは見える位置までスクロール
    const rect = els.wrap.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      els.wrap.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    }
  }

  function finish(n) {
    const staked = totalStaked();
    const prevBalance = state.balance;
    // 片付けの演出用に、賭けていたマスの位置を先に控えておく
    const winRects = [];
    const loseRects = [];
    for (const key of state.bets.keys()) {
      const r = cellEls.get(key).querySelector('.stake').getBoundingClientRect();
      if (r.width) (wins(key, n) ? winRects : loseRects).push(r);
    }
    let payout = 0;
    for (const [key, amount] of state.bets) {
      if (wins(key, n)) payout += amount * returnOf(key);
    }
    state.balance += payout;
    state.bets.clear();
    state.placed = [];
    state.history.unshift(n);
    state.history = state.history.slice(0, HISTORY_LIMIT);
    state.spinning = false;

    const col = colorOf(n);
    const head = `${n}(${describe(n).join('・')})`;
    const net = payout - staked;
    let line;
    if (staked === 0) {
      setStatus(`${head}。チップを置くと賭けられます`);
      line = describe(n).join(' · ');
      sfx.clack();
    } else if (payout === 0) {
      setStatus(`${head}。外れ、${staked}枚を失いました`, 'lose');
      line = `−${staked}`;
      sfx.lose();
      showDelta(-staked);
    } else {
      if (net > 0) {
        setStatus(`${head}。当たり、${payout}枚が戻り${net}枚の勝ちです`, 'win');
        line = `+${net}`;
        coinRain(net);
      } else if (net === 0) {
        setStatus(`${head}。${payout}枚が戻り、差し引きゼロです`);
        line = '±0';
      } else {
        setStatus(`${head}。${payout}枚が戻り、差し引き${-net}枚の負けです`, 'lose');
        line = `−${-net}`;
      }
      sfx.win();
      showDelta(net);
      tweenBalance(prevBalance, state.balance, 650);
    }

    showAnnounce(n, col, line, net > 0 && staked > 0);
    showGlow(ORDER.indexOf(n));
    if (!reducedMotion) rig.release = setTimeout(() => camTo(0, 0, 0.9), 2400);
    markHits(n);
    save();
    renderAll(true);
    animateSettlement(winRects, loseRects);
  }

  // ---------- チップとコインの動き ----------
  function fly(node, from, to, { scale = 1, arc = 0, duration = 500, delay = 0, fade = false } = {}) {
    node.classList.add('flyer');
    Object.assign(node.style, {
      left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`,
    });
    document.body.append(node);
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const anim = node.animate([
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: `translate(${dx / 2}px, ${dy / 2 - arc}px) scale(${(1 + scale) / 2})`, opacity: 1, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: fade ? 0 : 1 },
    ], { duration, delay, easing: 'ease-in-out', fill: 'both' });
    return anim.finished.then(() => node.remove(), () => node.remove());
  }

  // 選んだチップがマスへ飛んでいく
  function flyChipTo(key, amount) {
    if (reducedMotion) return;
    const src = els.chips.querySelector(`.chip[data-v="${amount}"]`);
    const stake = cellEls.get(key).querySelector('.stake');
    const to = stake.getBoundingClientRect();
    if (!src || !to.width) return;
    const node = src.cloneNode(true);
    node.setAttribute('aria-hidden', 'true');
    node.setAttribute('aria-checked', 'false');
    node.tabIndex = -1;
    stake.classList.add('pending');
    fly(node, src.getBoundingClientRect(), to, { scale: to.height / src.offsetHeight, arc: 70, duration: 420 })
      .then(() => stake.classList.remove('pending'));
  }

  // 負けたチップは回収され、勝ったマスからはコインが手持ちへ飛ぶ
  function animateSettlement(winRects, loseRects) {
    if (reducedMotion) return;
    const bank = els.balance.getBoundingClientRect();
    loseRects.forEach((r, i) => {
      const chip = document.createElement('span');
      chip.className = 'rake-chip';
      const to = { left: r.left, top: r.top - 60, width: r.width, height: r.height };
      fly(chip, r, to, { scale: 0.6, duration: 600, delay: 250 + i * 40, fade: true });
    });
    winRects.forEach((r, i) => {
      for (let j = 0; j < 4; j++) {
        const coin = document.createElement('span');
        coin.className = 'fly-coin';
        fly(coin, r, bank, { scale: 0.7, arc: 90 + j * 12, duration: 700, delay: 150 + i * 90 + j * 60, fade: true });
      }
    });
  }

  // 手持ちの数字をカウントアップ
  const balanceTween = { raf: 0, active: false };

  function tweenBalance(from, to, delay) {
    if (reducedMotion || from === to) {
      bump();
      return;
    }
    cancelAnimationFrame(balanceTween.raf);
    balanceTween.active = true;
    els.balance.textContent = String(from);
    const t0 = performance.now() + delay;
    const dur = 800;
    const step = (now) => {
      const u = Math.min(1, Math.max(0, (now - t0) / dur));
      const e = 1 - Math.pow(1 - u, 3);
      els.balance.textContent = String(Math.round(from + (to - from) * e));
      if (u < 1) {
        balanceTween.raf = requestAnimationFrame(step);
      } else {
        balanceTween.active = false;
        els.balance.textContent = String(state.balance);
        bump();
      }
    };
    balanceTween.raf = requestAnimationFrame(step);
  }

  // ---------- 演出 ----------
  let announceTimer = 0;

  function showAnnounce(n, col, line, win) {
    clearTimeout(announceTimer);
    els.announceNum.className = `medal ${col}`;
    els.announceNum.textContent = String(n);
    els.announceSub.textContent = line;
    els.announceSub.className = `announce-line${win ? ' win' : ''}`;
    els.announce.classList.remove('out');
    els.announce.hidden = false;
    announceTimer = setTimeout(() => hideAnnounce(false), 2600);
  }

  function hideAnnounce(now) {
    clearTimeout(announceTimer);
    if (now || reducedMotion) {
      els.announce.hidden = true;
      return;
    }
    els.announce.classList.add('out');
    announceTimer = setTimeout(() => { els.announce.hidden = true; }, 400);
  }

  function showDelta(v) {
    if (!v) return;
    els.delta.textContent = v > 0 ? `+${v}` : `−${-v}`;
    els.delta.className = `delta ${v > 0 ? 'plus' : 'minus'}`;
    void els.delta.offsetWidth;
    els.delta.classList.add('show');
  }

  function coinRain(amount) {
    if (reducedMotion) return;
    const count = Math.min(36, 10 + Math.floor(amount / 15));
    const h = els.wrap.clientHeight;
    for (let i = 0; i < count; i++) {
      const c = document.createElement('span');
      c.className = 'falling-coin';
      c.style.left = `${Math.random() * 96}%`;
      c.style.setProperty('--delay', `${Math.random() * 0.7}s`);
      c.style.setProperty('--d', `${1.2 + Math.random() * 0.9}s`);
      c.style.setProperty('--fall', `${h + 40}px`);
      const s = 14 + Math.random() * 12;
      c.style.width = c.style.height = `${s}px`;
      c.addEventListener('animationend', () => c.remove());
      els.coinLayer.append(c);
    }
  }

  function bump() {
    els.balance.classList.remove('bump');
    void els.balance.offsetWidth;
    els.balance.classList.add('bump');
  }

  // ---------- ベット ----------
  const cellEls = new Map(); // key -> button

  function makeCell(key, label, build, vars) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cell';
    b.dataset.key = key;
    b.dataset.label = label;
    build(b);
    Object.entries(vars).forEach(([k, v]) => b.style.setProperty(`--${k}`, v));
    const stake = document.createElement('span');
    stake.className = 'stake';
    b.append(stake);
    b.addEventListener('click', () => placeBet(key));
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      removeBet(key);
    });
    cellEls.set(key, b);
    els.grid.append(b);
  }

  const span = (cls, text) => {
    const s = document.createElement('span');
    s.className = cls;
    if (text != null) s.textContent = text;
    return s;
  };

  function buildTable() {
    // PC: 0 | 12列 x 3段 | 2:1、その下にダズンと外側の賭け。スマホ: 3列 x 12段の縦置き
    makeCell('n:0', '0', (b) => b.append(span('pill vert', '0')), { c: 1, r: 1, rs: 3, mc: 1, mcs: 3, mr: 1 });
    for (let n = 1; n <= 36; n++) {
      makeCell(`n:${n}`, String(n), (b) => b.append(span(`pill ${colorOf(n)}`, String(n))), {
        c: 2 + Math.floor((n - 1) / 3), r: 3 - ((n - 1) % 3),
        mc: ((n - 1) % 3) + 1, mr: 2 + Math.floor((n - 1) / 3),
      });
    }
    COLUMNS.forEach((d, i) => {
      makeCell(d.key, `${d.ja} ${d.fr}`, (b) => b.append(span('fr', d.fr), span('ja', d.ja)), {
        c: 14, r: 3 - i, mc: i + 1, mr: 14,
      });
    });
    DOZENS.forEach((d, i) => {
      makeCell(d.key, `${d.fr}`, (b) => b.append(span('fr', d.fr), span('ja', d.ja)), {
        c: 2 + i * 4, cs: 4, r: 4, mc: i + 1, mr: 15,
      });
    });
    OUTSIDE.forEach((d, i) => {
      makeCell(d.key, d.ja, (b) => {
        b.append(d.swatch ? span(`rhombus ${d.swatch}`) : span('fr', d.fr), span('ja', d.swatch ? `${d.fr} ${d.ja}` : d.ja));
      }, { c: 2 + i * 2, cs: 2, r: 5, mc: (i % 3) + 1, mr: 16 + Math.floor(i / 3) });
    });

    CHIPS.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', `${c.v}枚のチップ`);
      b.style.setProperty('--chip', c.bg);
      b.style.setProperty('--edge', c.edge);
      b.style.setProperty('--inlay', c.inlay);
      b.style.setProperty('--chip-text', c.fg);
      b.textContent = String(c.v);
      b.dataset.v = String(c.v);
      b.addEventListener('click', () => {
        state.chip = c.v;
        save();
        renderAll();
      });
      els.chips.append(b);
    });
  }

  const DEFAULT_HINT = 'マスをタップすると、選んだチップが置かれます。右クリックでそのマスの賭けを戻せます。';

  function hint(text, warn) {
    els.hint.textContent = text;
    els.hint.classList.toggle('warn', !!warn);
  }

  function placeBet(key) {
    if (state.spinning) return;
    clearHits();
    const amount = state.chip;
    if (state.balance < amount) {
      hint(`手持ちが${state.balance}枚なので、${amount}枚のチップは置けません。小さいチップを選ぶか、賭けを戻してください。`, true);
      return;
    }
    state.balance -= amount;
    state.bets.set(key, (state.bets.get(key) || 0) + amount);
    state.placed.push([key, amount]);
    hint(DEFAULT_HINT);
    sfx.coin();
    save();
    renderAll();
    flyChipTo(key, amount);
  }

  function removeBet(key) {
    if (state.spinning || !state.bets.has(key)) return;
    state.balance += state.bets.get(key);
    state.bets.delete(key);
    state.placed = state.placed.filter((p) => p[0] !== key);
    save();
    renderAll();
  }

  function undo() {
    if (state.spinning) return;
    const last = state.placed.pop();
    if (!last) return;
    const [key, amount] = last;
    const left = (state.bets.get(key) || 0) - amount;
    if (left > 0) state.bets.set(key, left);
    else state.bets.delete(key);
    state.balance += amount;
    save();
    renderAll();
  }

  function clearBets() {
    if (state.spinning) return;
    state.balance += totalStaked();
    state.bets.clear();
    state.placed = [];
    save();
    renderAll();
  }

  function rebet() {
    if (state.spinning || !state.lastBets.length) return;
    clearBets();
    const need = state.lastBets.reduce((a, b) => a + b[1], 0);
    if (need > state.balance) {
      hint(`前回と同じ賭けには${need}枚必要です。手持ちは${state.balance}枚です。`, true);
      return;
    }
    clearHits();
    state.lastBets.forEach(([key, amount]) => {
      state.bets.set(key, amount);
      state.placed.push([key, amount]);
    });
    state.balance -= need;
    hint(DEFAULT_HINT);
    sfx.coin();
    save();
    renderAll();
  }

  function refill() {
    state.balance = START_COINS;
    hint(DEFAULT_HINT);
    save();
    bump();
    renderAll();
  }

  function markHits(n) {
    cellEls.forEach((el, key) => el.classList.toggle('hit', wins(key, n)));
  }

  function clearHits() {
    cellEls.forEach((el) => el.classList.remove('hit'));
  }

  // ---------- 描画 ----------
  const short = (v) => (v >= 10000 ? `${Math.floor(v / 1000)}k` : String(v));

  const ICON_SOUND_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
  const ICON_SOUND_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 6 6"/><path d="m22 9-6 6"/></svg>';

  function fillSlider(input) {
    const min = Number(input.min);
    const max = Number(input.max);
    input.style.setProperty('--p', `${((Number(input.value) - min) / (max - min)) * 100}%`);
  }

  function renderAll(fresh) {
    const staked = totalStaked();
    if (!balanceTween.active) els.balance.textContent = String(state.balance);
    els.staked.textContent = String(staked);

    cellEls.forEach((el, key) => {
      const amount = state.bets.get(key) || 0;
      const stake = el.querySelector('.stake');
      const text = amount ? short(amount) : '';
      if (stake.textContent !== text) {
        stake.textContent = text;
        stake.classList.toggle('wide', text.length >= 3);
      }
      el.disabled = state.spinning;
      el.setAttribute('aria-label', amount ? `${el.dataset.label} に ${amount} 枚` : `${el.dataset.label} に賭ける`);
    });

    els.chips.querySelectorAll('.chip').forEach((b) => {
      b.setAttribute('aria-checked', String(Number(b.dataset.v) === state.chip));
      b.disabled = state.spinning;
    });

    els.spin.disabled = state.spinning;
    els.spin.classList.toggle('ready', !state.spinning && staked > 0);
    els.undo.disabled = state.spinning || !state.placed.length;
    els.clear.disabled = state.spinning || staked === 0;
    els.rebet.disabled = state.spinning || !state.lastBets.length;
    els.refill.hidden = state.spinning || state.balance + staked > 0;
    els.ballSpeed.disabled = state.spinning;

    els.wheelOut.textContent = `${state.wheelSpeed.toFixed(2)} 回転/秒`;
    els.ballOut.textContent = `${state.ballSpeed.toFixed(1)} 回転/秒`;
    fillSlider(els.wheelSpeed);
    fillSlider(els.ballSpeed);
    els.sound.innerHTML = `${state.sound ? ICON_SOUND_ON : ICON_SOUND_OFF}<span>${state.sound ? '音あり' : '音なし'}</span>`;
    els.sound.setAttribute('aria-pressed', String(state.sound));

    // 出目ボード:新しいものが左。赤は上段、0は中段、黒は下段
    els.history.textContent = '';
    state.history.forEach((n, i) => {
      const li = document.createElement('li');
      li.className = colorOf(n) + (i === 0 ? ' latest' : '') + (fresh && i === 0 ? ' new' : '');
      li.style.gridColumn = String(i + 1);
      li.textContent = String(n);
      els.history.append(li);
    });
    els.history.hidden = state.history.length === 0;
    els.historyEmpty.hidden = state.history.length > 0;

    const count = (c) => state.history.filter((n) => colorOf(n) === c).length;
    els.historyStats.innerHTML = state.history.length
      ? `直近${state.history.length}回 <span class="s-rouge">赤 ${count('rouge')}</span> · 黒 ${count('noir')} · <span class="s-vert">0 ${count('vert')}</span>`
      : '';
  }

  // ---------- 起動 ----------
  load();
  buildTable();
  els.wheelSpeed.value = String(state.wheelSpeed);
  els.ballSpeed.value = String(state.ballSpeed);
  renderAll();

  els.spin.addEventListener('click', spin);
  els.scene.addEventListener('click', spin);
  els.undo.addEventListener('click', undo);
  els.clear.addEventListener('click', clearBets);
  els.rebet.addEventListener('click', rebet);
  els.refill.addEventListener('click', refill);
  els.wheelSpeed.addEventListener('input', () => {
    state.wheelSpeed = Number(els.wheelSpeed.value);
    save();
    renderAll();
  });
  els.ballSpeed.addEventListener('input', () => {
    state.ballSpeed = Number(els.ballSpeed.value);
    save();
    renderAll();
  });
  els.sound.addEventListener('click', () => {
    state.sound = !state.sound;
    save();
    renderAll();
  });

  if (initScene()) {
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(els.wrap);
    else window.addEventListener('resize', resize);
  } else {
    els.spin.disabled = true;
  }
  requestAnimationFrame(frame);
})();
