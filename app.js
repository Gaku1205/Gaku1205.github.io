(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const STORAGE_KEY = 'casino-roulette.v1';
  const START_COINS = 1000;
  const HISTORY_LIMIT = 20;

  // ヨーロピアン式の並び(時計回り)
  const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
    5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  const N = ORDER.length;
  const SEG = TAU / N;
  const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const colorOf = (n) => (n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black');

  const CHIPS = [
    { v: 1, bg: '#f2f0ea', edge: '#3a6ad1', fg: '#1d2b4f' },
    { v: 5, bg: '#c62f2f', edge: '#fff', fg: '#fff' },
    { v: 10, bg: '#2f5fc6', edge: '#fff', fg: '#fff' },
    { v: 50, bg: '#2e8b4e', edge: '#fff', fg: '#fff' },
    { v: 100, bg: '#1b1b1b', edge: '#d4af37', fg: '#f6dc84' },
  ];

  const OUTSIDE = [
    { key: 'low', label: '1-18', test: (n) => n >= 1 && n <= 18 },
    { key: 'even', label: '偶数', test: (n) => n > 0 && n % 2 === 0 },
    { key: 'red', label: '赤', test: (n) => REDS.has(n), cls: 'red' },
    { key: 'black', label: '黒', test: (n) => n > 0 && !REDS.has(n), cls: 'black' },
    { key: 'odd', label: '奇数', test: (n) => n % 2 === 1 },
    { key: 'high', label: '19-36', test: (n) => n >= 19 },
  ];

  // 払い戻し倍率(賭け金込み)
  const returnOf = (key) => (key.startsWith('n:') ? 36 : 2);
  const wins = (key, n) => {
    if (key.startsWith('n:')) return Number(key.slice(2)) === n;
    const o = OUTSIDE.find((x) => x.key === key);
    return o ? o.test(n) : false;
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    scene: $('scene'), wrap: $('wheelWrap'), fallback: $('fallback'),
    badge: $('resultBadge'), resultText: $('resultText'), spin: $('spinBtn'),
    wheelSpeed: $('wheelSpeed'), ballSpeed: $('ballSpeed'), wheelOut: $('wheelOut'), ballOut: $('ballOut'),
    sound: $('soundBtn'), balance: $('balance'), staked: $('staked'), delta: $('delta'),
    announce: $('announce'), announceNum: $('announceNum'), announceSub: $('announceSub'),
    coinLayer: $('coinLayer'), historyStats: $('historyStats'),
    chips: $('chips'), grid: $('grid'), outside: $('outside'),
    undo: $('undoBtn'), clear: $('clearBtn'), rebet: $('rebetBtn'), refill: $('refillBtn'), hint: $('hint'),
    history: $('history'), historyEmpty: $('historyEmpty'),
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
      if (Array.isArray(s.bets)) state.bets = new Map(s.bets.filter((b) => Number(b[1]) > 0));
      if (Array.isArray(s.lastBets)) state.lastBets = s.lastBets;
      if (Array.isArray(s.history)) state.history = s.history.slice(0, HISTORY_LIMIT);
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
  const DISC_R = 0.84; // 回転盤の半径
  const TRACK_R = 1.0; // ボールが周回する半径
  const REST_R = DISC_R * 0.66; // ポケットに入ったときの半径
  const BALL_R = 0.032;

  let renderer, scene, camera, wheel, ballMesh;
  let phi = 0; // 盤の回転角(時計回り)

  const ball = {
    phase: 'rest', // rest | orbit | drop
    theta: 0, // ワールド上の角度(時計回り、奥が0)
    r: REST_R,
    hop: 0,
    psi: 0.5 * SEG, // 盤から見た角度(rest / drop 中)
    t: 0,
    w0: 0,
    drop: null,
  };

  function wheelTexture() {
    const S = 1024;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d');
    const c = S / 2;
    const R = c - 2;

    const wood = g.createRadialGradient(c, c, 0, c, c, R);
    wood.addColorStop(0, '#4a2c17');
    wood.addColorStop(1, '#1d110a');
    g.fillStyle = wood;
    g.beginPath();
    g.arc(c, c, R, 0, TAU);
    g.fill();

    const band = (r0, r1, a0, a1, color) => {
      g.beginPath();
      g.arc(c, c, r1, a0, a1);
      g.arc(c, c, r0, a1, a0, true);
      g.closePath();
      g.fillStyle = color;
      g.fill();
    };

    const face = { red: '#b3202a', black: '#16191d', green: '#0f7a3d' };
    const well = { red: '#7a1219', black: '#0a0c0e', green: '#0a522a' };

    for (let i = 0; i < N; i++) {
      const a0 = -Math.PI / 2 + i * SEG;
      const col = colorOf(ORDER[i]);
      band(0.76 * R, 0.96 * R, a0, a0 + SEG, face[col]);
      band(0.56 * R, 0.76 * R, a0, a0 + SEG, well[col]);
    }

    // 仕切り(金)
    g.strokeStyle = '#d9b65a';
    g.lineWidth = 3;
    for (let i = 0; i < N; i++) {
      const a = -Math.PI / 2 + i * SEG;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * 0.56 * R, c + Math.sin(a) * 0.56 * R);
      g.lineTo(c + Math.cos(a) * 0.96 * R, c + Math.sin(a) * 0.96 * R);
      g.stroke();
    }
    [0.56, 0.76, 0.96].forEach((f, i) => {
      g.lineWidth = i === 1 ? 2 : 5;
      g.beginPath();
      g.arc(c, c, f * R, 0, TAU);
      g.stroke();
    });

    // 数字
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 38px Georgia, "Times New Roman", serif';
    for (let i = 0; i < N; i++) {
      g.save();
      g.translate(c, c);
      g.rotate((i + 0.5) * SEG);
      g.fillText(String(ORDER[i]), 0, -0.86 * R);
      g.restore();
    }

    // 中央の装飾
    g.strokeStyle = 'rgba(217,182,90,0.6)';
    g.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * 0.18 * R, c + Math.sin(a) * 0.18 * R);
      g.lineTo(c + Math.cos(a) * 0.52 * R, c + Math.sin(a) * 0.52 * R);
      g.stroke();
    }

    return new THREE.CanvasTexture(cv);
  }

  function trackTexture() {
    const S = 512;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d');
    const grad = g.createRadialGradient(S / 2, S / 2, S * 0.33, S / 2, S / 2, S / 2);
    grad.addColorStop(0, '#2a170c');
    grad.addColorStop(0.5, '#6b3f1f');
    grad.addColorStop(0.85, '#8a5a2e');
    grad.addColorStop(1, '#3a2312');
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
    return new THREE.CanvasTexture(cv);
  }

  function shadowTexture() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const g = cv.getContext('2d');
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(0.7, 'rgba(0,0,0,0.25)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(cv);
  }

  const gold = () => new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.3, metalness: 0.85 });

  function initScene() {
    try {
      renderer = new THREE.WebGLRenderer({ canvas: els.scene, antialias: true, alpha: true });
    } catch (e) {
      els.fallback.hidden = false;
      return false;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(32, 1.25, 0.1, 50);
    camera.position.set(0, 3.5, 2.9);
    camera.lookAt(0, -0.1, 0.12);

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const key = new THREE.DirectionalLight(0xfff4e0, 0.9);
    key.position.set(1.5, 4, 2.5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.25);
    fill.position.set(-3, 2, -1);
    scene.add(fill);

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.0, 3.0),
      new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0.08, -0.2, 0.15);
    scene.add(shadow);

    // 外枠(木)
    const bowl = new THREE.Mesh(
      new THREE.CylinderGeometry(1.22, 1.28, 0.24, 128, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x4a2a14, roughness: 0.45, metalness: 0.1, side: THREE.DoubleSide })
    );
    bowl.position.y = -0.03;
    scene.add(bowl);

    const lip = new THREE.Mesh(new THREE.TorusGeometry(1.22, 0.035, 16, 128), gold());
    lip.rotation.x = Math.PI / 2;
    lip.position.y = 0.09;
    scene.add(lip);

    // ボールが走る溝
    const track = new THREE.Mesh(
      new THREE.RingGeometry(DISC_R, 1.22, 128, 1),
      new THREE.MeshStandardMaterial({ map: trackTexture(), roughness: 0.3, metalness: 0.15 })
    );
    track.rotation.x = -Math.PI / 2;
    track.position.y = 0.085;
    scene.add(track);

    // 菱形のディフレクター
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + Math.PI / 8;
      const d = new THREE.Mesh(new THREE.OctahedronGeometry(0.035), gold());
      d.scale.set(0.6, 0.5, 1.4);
      d.position.set(Math.sin(a) * 1.1, 0.1, -Math.cos(a) * 1.1);
      d.rotation.y = -a;
      scene.add(d);
    }

    const innerLip = new THREE.Mesh(new THREE.TorusGeometry(DISC_R, 0.014, 12, 128), gold());
    innerLip.rotation.x = Math.PI / 2;
    innerLip.position.y = 0.085;
    scene.add(innerLip);

    // 回転盤
    wheel = new THREE.Group();
    scene.add(wheel);

    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(DISC_R, 128),
      new THREE.MeshStandardMaterial({ map: wheelTexture(), roughness: 0.45, metalness: 0.05 })
    );
    disc.material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.075;
    wheel.add(disc);

    // 中央のタレット
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.17, 0.16, 48), gold());
    cone.position.y = 0.15;
    wheel.add(cone);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 32, 16), gold());
    knob.position.y = 0.25;
    wheel.add(knob);
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.36, 12), gold());
      arm.rotation.z = Math.PI / 2;
      arm.rotation.y = (i * Math.PI) / 4;
      arm.position.y = 0.21;
      wheel.add(arm);
      if (i % 2 === 0) {
        [-1, 1].forEach((s) => {
          const tip = new THREE.Mesh(new THREE.SphereGeometry(0.025, 16, 8), gold());
          const a = (i * Math.PI) / 4;
          tip.position.set(Math.cos(a) * 0.18 * s, 0.21, -Math.sin(a) * 0.18 * s);
          wheel.add(tip);
        });
      }
    }

    ballMesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_R, 32, 16),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.12, metalness: 0.1 })
    );
    scene.add(ballMesh);

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
    camera.updateProjectionMatrix();
  }

  // ---------- ボールの動き ----------
  const DECAY = 0.3; // 周回速度の減衰率(/秒)
  const DROP_SPEED = 0.9; // この速さ(回転/秒)まで落ちたら内側へ落ちる
  const DROP_DUR = 2.4;

  function launch() {
    ball.phase = 'orbit';
    ball.t = 0;
    ball.theta = Math.random() * TAU;
    ball.w0 = state.ballSpeed * (0.92 + Math.random() * 0.16);
    ball.r = TRACK_R;
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
    ball.drop = { psi0, delta, target, lastIdx: -1, lastHop: 0 };
  }

  function updateBall(dt) {
    if (ball.phase === 'orbit') {
      ball.t += dt;
      const w = ball.w0 * Math.exp(-DECAY * ball.t);
      ball.theta -= w * TAU * dt;
      ball.r = TRACK_R + 0.06 * Math.min(1, w / 3) - 0.04 * (1 - Math.min(1, w / ball.w0));
      if ((ball.t >= 2 && w <= DROP_SPEED) || ball.t > 14) startDrop();
    } else if (ball.phase === 'drop') {
      ball.t += dt;
      const d = ball.drop;
      const u = Math.min(1, ball.t / DROP_DUR);
      const eased = 1 - Math.pow(1 - u, 3);
      ball.psi = d.psi0 - d.delta * eased;
      ball.theta = phi + ball.psi;

      const inward = Math.min(1, u / 0.45);
      const smooth = inward * inward * (3 - 2 * inward);
      ball.r = TRACK_R + (REST_R - TRACK_R) * smooth;

      // 弾む
      const hops = u * 6;
      ball.hop = u > 0.2 ? Math.abs(Math.sin(hops * Math.PI)) * 0.09 * Math.pow(1 - u, 1.6) : 0;
      const hopIdx = Math.floor(hops);
      if (u > 0.2 && hopIdx !== d.lastHop && u < 0.85) sfx.clack();
      d.lastHop = hopIdx;

      const idx = Math.floor(mod(ball.psi) / SEG);
      if (idx !== d.lastIdx && u > 0.3) sfx.tick();
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

  let lastTime = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    phi += state.wheelSpeed * TAU * dt;
    updateBall(dt);

    if (!renderer) return;
    wheel.rotation.y = -phi;
    const y = (ball.r > DISC_R ? 0.085 : 0.075) + BALL_R + ball.hop;
    ballMesh.position.set(Math.sin(ball.theta) * ball.r, y, -Math.cos(ball.theta) * ball.r);
    renderer.render(scene, camera);
  }

  // ---------- 回す ----------
  function spin() {
    if (state.spinning) return;
    audio(); // ユーザー操作の中で初期化
    state.spinning = true;
    state.lastBets = [...state.bets];
    clearHits();
    hideAnnounce(true);
    els.badge.hidden = true;
    els.resultText.className = 'result-text';
    els.resultText.textContent = 'ノー・モア・ベット…';
    renderAll();
    launch();

    // スマホなどで盤が画面外にあるときは見える位置までスクロール
    const rect = els.wrap.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      els.wrap.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    }
  }

  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function finish(n) {
    const staked = totalStaked();
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
    els.badge.hidden = false;
    els.badge.className = `ball-badge ${col}`;
    els.badge.textContent = String(n);
    void els.badge.offsetWidth;
    els.badge.classList.add('pop');

    const colName = { red: '赤', black: '黒', green: '緑' }[col];
    let sub;
    if (staked === 0) {
      els.resultText.className = 'result-text';
      els.resultText.textContent = `${n}(${colName})`;
      sub = colName;
      sfx.clack();
    } else if (payout > 0) {
      const net = payout - staked;
      els.resultText.className = `result-text${net > 0 ? ' win' : ''}`;
      if (net > 0) {
        els.resultText.textContent = `当たり! ${payout} 枚獲得(+${net})`;
        sub = `WIN +${net}`;
        coinRain(net);
      } else if (net === 0) {
        els.resultText.textContent = `${payout} 枚戻り(±0)`;
        sub = 'EVEN ±0';
      } else {
        els.resultText.textContent = `${payout} 枚戻り(−${-net})`;
        sub = `−${-net}`;
      }
      sfx.win();
      bump();
      showDelta(net);
    } else {
      els.resultText.className = 'result-text lose';
      els.resultText.textContent = `ハズレ… −${staked} 枚`;
      sub = `LOSE −${staked}`;
      sfx.lose();
      showDelta(-staked);
    }

    showAnnounce(n, col, sub, payout > 0);
    markHits(n);
    save();
    renderAll(true);
  }

  // ---------- 演出 ----------
  let announceTimer = 0;

  function showAnnounce(n, col, sub, win) {
    clearTimeout(announceTimer);
    els.announceNum.className = `announce-num ${col}`;
    els.announceNum.textContent = String(n);
    els.announceSub.textContent = sub;
    els.announceSub.className = `announce-sub${win ? ' win' : ''}`;
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

  // ---------- ベット ----------
  const cellEls = new Map(); // key -> button

  function makeCell(key, label, numCls, cellCls, vars) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `cell ${cellCls || ''}`;
    b.dataset.key = key;
    const num = document.createElement('span');
    num.className = `num ${numCls || ''}`;
    num.textContent = label;
    b.append(num);
    Object.entries(vars || {}).forEach(([k, v]) => b.style.setProperty(`--${k}`, v));
    const stake = document.createElement('span');
    stake.className = 'stake';
    b.append(stake);
    b.addEventListener('click', () => placeBet(key));
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      removeBet(key);
    });
    cellEls.set(key, b);
    return b;
  }

  function buildTable() {
    els.grid.append(makeCell('n:0', '0', 'green', '', { c: 1, r: 1, rs: 3, mc: 1, mcs: 3, mr: 1 }));
    for (let n = 1; n <= 36; n++) {
      const vars = {
        c: 2 + Math.floor((n - 1) / 3), r: 3 - ((n - 1) % 3),
        mc: ((n - 1) % 3) + 1, mr: 2 + Math.floor((n - 1) / 3),
      };
      els.grid.append(makeCell(`n:${n}`, String(n), colorOf(n), '', vars));
    }
    OUTSIDE.forEach((o) => els.outside.append(makeCell(o.key, o.label, o.cls, 'outside-cell')));

    CHIPS.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', `${c.v}枚`);
      b.style.setProperty('--chip', c.bg);
      b.style.setProperty('--edge', c.edge);
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

  function hint(text, warn) {
    els.hint.textContent = text;
    els.hint.classList.toggle('warn', !!warn);
  }

  const DEFAULT_HINT = 'マスをタップして選んだコインを置けます。数字は36倍、赤黒・偶奇・1-18/19-36は2倍で戻ります。';

  function placeBet(key) {
    if (state.spinning) return;
    clearHits();
    const amount = state.chip;
    if (state.balance < amount) {
      hint('コインが足りません。小さいコインを選ぶか、賭けを戻してください。', true);
      return;
    }
    state.balance -= amount;
    state.bets.set(key, (state.bets.get(key) || 0) + amount);
    state.placed.push([key, amount]);
    hint(DEFAULT_HINT);
    sfx.coin();
    save();
    renderAll();
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
      hint('前回と同じ賭けをするにはコインが足りません。', true);
      return;
    }
    clearHits();
    state.lastBets.forEach(([key, amount]) => {
      state.bets.set(key, amount);
      state.placed.push([key, amount]);
    });
    state.balance -= need;
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

  function bump() {
    els.balance.classList.remove('bump');
    void els.balance.offsetWidth;
    els.balance.classList.add('bump');
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
    els.balance.textContent = String(state.balance);
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
      const label = el.firstChild.textContent;
      el.setAttribute('aria-label', amount ? `${label} に ${amount} 枚` : `${label} に賭ける`);
    });

    els.chips.querySelectorAll('.chip').forEach((b) => {
      b.setAttribute('aria-checked', String(Number(b.dataset.v) === state.chip));
      b.disabled = state.spinning;
    });

    els.spin.disabled = state.spinning;
    els.undo.disabled = state.spinning || !state.placed.length;
    els.clear.disabled = state.spinning || staked === 0;
    els.rebet.disabled = state.spinning || !state.lastBets.length;
    els.refill.hidden = state.spinning || state.balance + staked > 0;
    els.ballSpeed.disabled = state.spinning;

    els.wheelOut.textContent = `${state.wheelSpeed.toFixed(2)} 回転/秒`;
    els.ballOut.textContent = `${state.ballSpeed.toFixed(1)} 回転/秒`;
    fillSlider(els.wheelSpeed);
    fillSlider(els.ballSpeed);
    els.sound.innerHTML = `${state.sound ? ICON_SOUND_ON : ICON_SOUND_OFF}<span>${state.sound ? 'ON' : 'OFF'}</span>`;
    els.sound.setAttribute('aria-pressed', String(state.sound));
    els.sound.setAttribute('aria-label', state.sound ? '効果音 ON' : '効果音 OFF');

    els.history.textContent = '';
    state.history.forEach((n, i) => {
      const li = document.createElement('li');
      li.className = colorOf(n) + (fresh && i === 0 ? ' new' : '');
      li.textContent = String(n);
      els.history.append(li);
    });
    els.historyEmpty.hidden = state.history.length > 0;

    const count = (c) => state.history.filter((n) => colorOf(n) === c).length;
    els.historyStats.innerHTML = state.history.length
      ? `<b class="s-red">赤 ${count('red')}</b> ・ <b>黒 ${count('black')}</b> ・ <b class="s-green">緑 ${count('green')}</b>`
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
