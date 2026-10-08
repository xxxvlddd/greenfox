'use strict';
/* ============================================================
   ПРИВЕТСТВИЕ: ЛИСА ИЗ ЧАСТИЦ
   ============================================================
   Знак GREENFOX собирается на глазах: тысяча точек слетается к центру
   по спирали со всего окна, оставляя светящиеся следы, и встаёт в
   голову лисы — точками, как растр. По готовому знаку проходит блик.
   Позади во всё окно медленно течёт поле мелких точек: ближние ярче
   и крупнее, дальние — едва видны; у текста поле затихает, чтобы не
   мешать читать. Под курсором точки знака мягко расступаются.
   Уход на шаг 1 — знак рассыпается наружу.

   Почему canvas, а не разметка: тысячи точек в разметке — тысячи
   элементов и пересчёт на каждом кадре. Здесь кадр — два-три десятка
   тысяч простых операций в одном холсте, 1–2 мс; движение текста
   вокруг идёт отдельно, анимациями прозрачности и сдвига.

   Формы знака — те же, что в renderer/fox.svg (исходник — app-icon.svg).
   При «уменьшить движение» — один кадр: собранный знак и неподвижное поле.
   Имена начинаются с obFx / OBFX.
   ============================================================ */
var OBFX_FOX = [
  ['#187367', 'M-1253.16 531.098C-1221.52 532.699 -1192.94 555.325 -1189.72 587.994C-1171.61 570.83 -1152.86 554.031 -1135.04 536.647C-1135.1 553 -1135.67 573.6 -1134.91 589.61L-1134.63 590.367C-1119.72 603.863 -1105.1 618.727 -1090.25 632.566L-1089.42 633.211C-1077.32 633.589 -1062.27 632.392 -1050.81 634.32C-1052.97 646.009 -1057.34 648.912 -1063.18 657.732C-1075.08 682.306 -1093.65 690.819 -1119.78 692.056C-1123.36 692.226 -1132.94 691.651 -1135.85 692.616L-1135.79 748.732C-1145.26 748.696 -1199.36 749.71 -1203.27 747.164C-1203.45 747.039 -1203.65 746.925 -1203.84 746.796C-1203.95 746.718 -1204.06 746.628 -1204.17 746.543C-1205.19 745.443 -1205.73 744.725 -1206.61 743.512C-1225.94 720.985 -1252.76 705.873 -1252.36 674.525C-1252.04 648.942 -1241.19 638.638 -1225.09 622.142C-1229.37 619.988 -1233.27 617.159 -1236.64 613.762C-1253.8 596.745 -1253.2 582.529 -1253.19 560.882L-1253.16 531.098Z'],
  ['#2DD4BF', 'M-1253.16 531.098C-1221.52 532.699 -1192.94 555.325 -1189.72 587.994C-1171.61 570.83 -1152.86 554.031 -1135.04 536.647C-1135.1 553 -1135.67 573.6 -1134.91 589.61C-1144.75 598.684 -1154.36 608.3 -1164.09 617.427C-1187.8 639.665 -1205.03 652.31 -1206.49 687.359C-1206.89 699.479 -1206.97 711.606 -1206.74 723.73C-1206.67 728.443 -1206.22 739.436 -1206.61 743.512C-1225.94 720.985 -1252.76 705.873 -1252.36 674.525C-1252.04 648.942 -1241.19 638.638 -1225.09 622.142C-1229.37 619.988 -1233.27 617.159 -1236.64 613.762C-1253.8 596.745 -1253.2 582.529 -1253.19 560.882L-1253.16 531.098Z'],
  ['#2DD4BF', 'M-1204.17 746.543C-1203.15 745.418 -1202.1 744.31 -1201.04 743.219C-1192.9 734.849 -1184.66 726.572 -1176.33 718.392C-1165.66 707.827 -1152.05 692.913 -1135.85 692.616L-1135.79 748.732C-1145.26 748.696 -1199.36 749.71 -1203.27 747.164C-1203.45 747.039 -1203.65 746.925 -1203.84 746.796C-1203.95 746.718 -1204.06 746.628 -1204.17 746.543Z'],
  ['#2DD4BF', 'M-1134.63 590.367C-1119.72 603.863 -1105.1 618.727 -1090.25 632.566C-1092.3 633.405 -1130.55 633.176 -1134.79 633.211C-1134.64 624.342 -1135.79 597.643 -1134.63 590.367Z'],
  ['#2DD4BF', 'M-1089.42 633.211C-1077.32 633.589 -1062.27 632.392 -1050.81 634.32C-1052.97 646.009 -1057.34 648.912 -1063.18 657.732C-1067.78 654.141 -1074.08 647.259 -1078.69 643.048C-1081.48 640.502 -1087.22 635.609 -1089.42 633.211Z']
];
var OBFX_CELLS = 54;            /* клеток растра по ширине знака */
var obFxScene = null;

function obFxStart(pane, opts){
  obFxStop();
  try { obFxScene = new ObFxScene(pane, opts || {}); }
  catch (e) { obFxScene = null; pane.classList.remove('is-fx'); }
  return obFxScene;
}
function obFxStop(){
  if (obFxScene) obFxScene.stop();
  obFxScene = null;
}
/* Уход с приветствия: знак рассыпается, поле гаснет — за полсекунды. */
function obFxLeave(){
  if (obFxScene) obFxScene.leave();
}

function ObFxScene(pane, opts){
  this.pane = pane;
  this.still = !!opts.still;
  /* Темп: 1 — как в мастере (знак собирается почти три секунды); заставка
     при запуске идёт быстрее. Сборка заканчивается через assembled мс. */
  this.speed = opts.speed || 1;
  this.assembled = Math.round(2800 / this.speed);
  this.anchor = pane.querySelector('.wl-fox');
  this.hero = pane.querySelector('.wl');
  this.cv = document.createElement('canvas');
  this.cv.className = 'wl-fx';
  this.cv.setAttribute('aria-hidden', 'true');
  pane.insertBefore(this.cv, pane.firstChild);
  /* Прозрачный холст: при уходе точки разлетаются поверх следующего шага. */
  this.ctx = this.cv.getContext('2d');
  pane.classList.add('is-fx');
  this.mx = -1e5; this.my = -1e5;
  this.dead = false;
  this.phase = 'wait';
  this.measure();
  this.buildFox();
  this.buildField();
  var self = this;
  this.onMove = function(e){ var r = self.pane.getBoundingClientRect(); self.mx = e.clientX - r.left; self.my = e.clientY - r.top; };
  this.onOut = function(){ self.mx = -1e5; self.my = -1e5; };
  pane.addEventListener('mousemove', this.onMove);
  pane.addEventListener('mouseleave', this.onOut);
  this.ro = new ResizeObserver(function(){ if (!self.dead) self.resize(); });
  this.ro.observe(pane);
  this.loop = this.frame.bind(this);
  if (this.still){ this.phase = 'idle'; this.settleAll(); this.draw(performance.now(), 16); return; }
  /* До старта холст пуст. */
  this.draw(performance.now(), 16);
}

/* Старт по команде: когда окно показано и шрифты на месте. */
ObFxScene.prototype.play = function(){
  if (this.dead || this.still || this.phase !== 'wait') return;
  this.phase = 'intro';
  this.t0 = performance.now();
  this.last = this.t0;
  requestAnimationFrame(this.loop);
};

ObFxScene.prototype.measure = function(){
  var r = this.pane.getBoundingClientRect(), a = this.anchor.getBoundingClientRect();
  this.W = Math.max(1, r.width); this.H = Math.max(1, r.height);
  this.dpr = Math.min(2, window.devicePixelRatio || 1);
  this.cv.width = Math.round(this.W * this.dpr); this.cv.height = Math.round(this.H * this.dpr);
  this.cv.style.width = this.W + 'px'; this.cv.style.height = this.H + 'px';
  this.cx = a.left - r.left + a.width / 2; this.cy = a.top - r.top + a.height / 2;
  this.S = Math.max(40, a.width);
  var hr = this.hero ? this.hero.getBoundingClientRect() : a;
  /* Зона текста — эллипс вокруг колонки приветствия: там поле затихает. */
  this.hx = hr.left - r.left + hr.width / 2; this.hy = hr.top - r.top + hr.height / 2;
  this.hrx = Math.max(160, hr.width * 0.62); this.hry = Math.max(160, hr.height * 0.6);
  var cs = getComputedStyle(this.pane);
  this.bg = cs.backgroundColor || '#0e0e0e';
  this.accent = (cs.getPropertyValue('--accent') || '').trim() || '#2DD4BF';
  var m = /(\d+)\D+(\d+)\D+(\d+)/.exec(this.bg) || [0, 14, 14, 14];
  this.darkBg = (Number(m[1]) * 0.3 + Number(m[2]) * 0.59 + Number(m[3]) * 0.11) < 128;
};

/* Знак растром: рисуем формы в маленький холст, по центру каждой клетки
   смотрим, есть ли там знак и какого он тона. */
ObFxScene.prototype.buildFox = function(){
  var N = OBFX_CELLS, px = 4, side = N * px;
  var c = document.createElement('canvas'); c.width = c.height = side;
  var g = c.getContext('2d', { willReadFrequently: true });
  g.scale(side / 256, side / 256); g.translate(1280, -512);
  OBFX_FOX.forEach(function(f){ g.fillStyle = f[0]; g.fill(new Path2D(f[1])); });
  var d = g.getImageData(0, 0, side, side).data, pts = [];
  for (var j = 0; j < N; j++) for (var i = 0; i < N; i++){
    var k = ((j * px + (px >> 1)) * side + i * px + (px >> 1)) * 4;
    if (d[k + 3] > 150) pts.push(i, j, d[k + 1] > 160 ? 1 : 0);
  }
  var n = pts.length / 3, step = this.S / N, R = Math.hypot(this.W, this.H) * 0.62;
  this.fn = n; this.step = step;
  this.gx = new Float32Array(n); this.gy = new Float32Array(n);       /* место в знаке относительно центра, в клетках */
  this.fx = new Float32Array(n); this.fy = new Float32Array(n);       /* где точка сейчас */
  this.r0 = new Float32Array(n); this.a0 = new Float32Array(n);       /* откуда летит: радиус и угол */
  this.del = new Float32Array(n); this.dur = new Float32Array(n);
  this.col = new Uint8Array(n); this.ph = new Float32Array(n);
  this.vx = new Float32Array(n); this.vy = new Float32Array(n); this.done = new Uint8Array(n);
  for (var q = 0; q < n; q++){
    this.gx[q] = pts[q * 3] + 0.5 - N / 2; this.gy[q] = pts[q * 3 + 1] + 0.5 - N / 2; this.col[q] = pts[q * 3 + 2];
    var tx = this.gx[q] * step, ty = this.gy[q] * step, a1 = Math.atan2(ty, tx);
    /* Спираль: все заходят в одну сторону, на треть-полоборота, с разбросом. */
    this.a0[q] = a1 - 2.1 + (Math.random() - 0.5) * 1.1;
    this.r0[q] = R * (0.55 + Math.random() * 0.6);
    var rr = Math.hypot(tx, ty) / (this.S / 2);
    this.del[q] = 60 + Math.pow(Math.random(), 1.7) * 640 + rr * 140;
    this.dur[q] = 1300 + Math.random() * 700;
    this.ph[q] = Math.random() * 6.283;
    this.fx[q] = this.cx + Math.cos(this.a0[q]) * this.r0[q]; this.fy[q] = this.cy + Math.sin(this.a0[q]) * this.r0[q];
  }
};

/* Поле: мелкие точки во всё окно, у каждой своя глубина. */
ObFxScene.prototype.buildField = function(){
  var n = Math.max(260, Math.min(1300, Math.round(this.W * this.H / 1300)));
  this.an = n;
  this.ax = new Float32Array(n); this.ay = new Float32Array(n); this.az = new Float32Array(n);
  this.ap = new Float32Array(n); this.aw = new Float32Array(n);
  for (var i = 0; i < n; i++){
    this.ax[i] = Math.random() * this.W; this.ay[i] = Math.random() * this.H;
    this.az[i] = Math.pow(Math.random(), 1.5);
    this.ap[i] = Math.random() * 6.283; this.aw[i] = 0.4 + Math.random() * 1.2;
  }
};

ObFxScene.prototype.resize = function(){
  var W = this.W, H = this.H;
  this.measure();
  var sx = this.W / W, sy = this.H / H;
  for (var i = 0; i < this.an; i++){ this.ax[i] *= sx; this.ay[i] *= sy; }
  this.step = this.S / OBFX_CELLS;
  if (this.phase === 'idle' || this.still) this.settleAll();
  if (this.still || this.phase === 'wait') this.draw(performance.now(), 16);
};
ObFxScene.prototype.settleAll = function(){
  for (var q = 0; q < this.fn; q++){
    this.fx[q] = this.cx + this.gx[q] * this.step; this.fy[q] = this.cy + this.gy[q] * this.step; this.done[q] = 1;
  }
};

ObFxScene.prototype.leave = function(){
  if (this.dead) return;
  if (this.still || this.phase === 'wait'){ this.stop(); return; }
  this.phase = 'leave';
  this.tl = performance.now();
  for (var q = 0; q < this.fn; q++){
    var dx = this.fx[q] - this.cx, dy = this.fy[q] - this.cy, d = Math.hypot(dx, dy) || 1, sp = 3 + Math.random() * 7;
    var tw = 0.35;            /* разлёт с лёгким закручиванием — та же спираль, что при сборке */
    this.vx[q] = (dx / d * Math.cos(tw) - dy / d * Math.sin(tw)) * sp;
    this.vy[q] = (dx / d * Math.sin(tw) + dy / d * Math.cos(tw)) * sp;
  }
};
ObFxScene.prototype.stop = function(){
  if (this.dead) return;
  this.dead = true;
  if (obFxScene === this) obFxScene = null;
  this.pane.removeEventListener('mousemove', this.onMove);
  this.pane.removeEventListener('mouseleave', this.onOut);
  if (this.ro) this.ro.disconnect();
};

ObFxScene.prototype.frame = function(t){
  if (this.dead) return;
  if (!this.cv.isConnected){ this.stop(); return; }
  var dt = Math.min(50, Math.max(1, t - this.last));
  this.last = t;
  this.draw(t, dt);
  if (this.phase === 'leave' && t - this.tl > 620){ this.stop(); return; }
  requestAnimationFrame(this.loop);
};

var obFxEaseR = function(u){ return 1 - Math.pow(1 - u, 4); };
var obFxEaseA = function(u){ return 1 - Math.pow(1 - u, 3); };

ObFxScene.prototype.draw = function(t, dt){
  var ctx = this.ctx, W = this.W, H = this.H, k60 = dt / 16.667;
  var e = this.still ? 1e9 : this.phase === 'wait' ? -1 : (t - this.t0) * this.speed;
  if (this.phase === 'intro' && e > 2800) this.phase = 'idle';
  var leave = this.phase === 'leave' ? Math.min(1, (t - this.tl) / 560) : 0;
  ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

  /* Пока знак собирается и рассыпается — следы: прошлый кадр не
     стирается, а гаснет. Потом — чистый кадр. */
  var trail = this.phase === 'leave' ? 0.3 : e < 0 ? 1 : e < 1900 ? 0.2 : e < 2700 ? 0.2 + (e - 1900) / 800 * 0.8 : 1;
  if (trail >= 1){ ctx.clearRect(0, 0, W, H); }
  else {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 1 - Math.pow(1 - trail, k60);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }
  if (e < 0){ ctx.globalAlpha = 1; return; }

  /* Поле. */
  var fieldIn = this.still ? 1 : Math.min(1, e / 1100) * (1 - leave);
  var theme = this.darkBg ? 1 : 0.75, tt = this.still ? 0 : t;
  ctx.fillStyle = this.accent;
  var mxo = this.mx > -1e4 ? (this.mx - W / 2) : 0, myo = this.my > -1e4 ? (this.my - H / 2) : 0;
  for (var i = 0; i < this.an; i++){
    var z = this.az[i];
    if (!this.still){
      /* Течение: поле направлений медленно меняется во времени, общий
         снос — вправо и вверх, как у графика роста. */
      var ang = 0.65 * Math.sin(this.ay[i] * 0.0042 + tt * 0.00021) + 0.55 * Math.cos(this.ax[i] * 0.0031 - tt * 0.00017) - 0.42;
      var sp = (0.12 + z * 0.38) * k60 * (1 + leave * 6);
      this.ax[i] += Math.cos(ang) * sp; this.ay[i] += Math.sin(ang) * sp;
      if (this.ax[i] > W + 4) this.ax[i] -= W + 8; else if (this.ax[i] < -4) this.ax[i] += W + 8;
      if (this.ay[i] > H + 4) this.ay[i] -= H + 8; else if (this.ay[i] < -4) this.ay[i] += H + 8;
    }
    var x = this.ax[i] - mxo * z * 0.018, y = this.ay[i] - myo * z * 0.018;
    var ex = (x - this.hx) / this.hrx, ey = (y - this.hy) / this.hry, ed = ex * ex + ey * ey;
    var calm = ed < 0.55 ? 0.22 : ed > 1.3 ? 1 : 0.22 + (ed - 0.55) / 0.75 * 0.78;
    var tw = 0.62 + 0.38 * Math.sin(tt * 0.0011 * this.aw[i] + this.ap[i]);
    var al = (0.07 + z * 0.4) * theme * calm * tw * fieldIn;
    if (al < 0.012) continue;
    ctx.globalAlpha = Math.round(al * 24) / 24;
    var s = 0.8 + z * 1.5;
    ctx.fillRect(x - s / 2, y - s / 2, s, s);
  }

  /* Знак. */
  var step = this.step, size = Math.max(1.3, step * 0.66), half = size / 2;
  var rep = this.S * 0.3, rep2 = rep * rep, push = this.S * 0.075;
  var follow = 1 - Math.pow(0.8, k60), fr = Math.pow(0.955, k60);
  var lastA = -1;
  /* Блик — диагональная волна по знаку: после сборки и потом раз в девять секунд. */
  var g0 = e - 2350, gc = g0 > 0 ? g0 % 9000 : -1, front = gc >= 0 && gc < 950 ? (gc / 950) * 2.4 - 1.2 : 99;
  for (var c = 0; c < 2; c++){
    ctx.fillStyle = c ? '#2DD4BF' : '#187367';
    for (var q = 0; q < this.fn; q++){
      if (this.col[q] !== c) continue;
      var tx = this.cx + this.gx[q] * step, ty = this.cy + this.gy[q] * step, a = 1;
      if (this.phase === 'leave'){
        this.fx[q] += this.vx[q] * k60; this.fy[q] += this.vy[q] * k60;
        this.vx[q] *= fr; this.vy[q] *= fr;
        a = 1 - leave;
      } else if (!this.done[q]){
        var u = (e - this.del[q]) / this.dur[q];
        if (u <= 0){ a = 0; }
        else if (u >= 1){ this.done[q] = 1; this.fx[q] = tx; this.fy[q] = ty; }
        else {
          var a1 = Math.atan2(ty - this.cy, tx - this.cx), r1 = Math.hypot(tx - this.cx, ty - this.cy);
          var ang2 = this.a0[q] + (a1 - this.a0[q]) * obFxEaseA(u), rad = this.r0[q] + (r1 - this.r0[q]) * obFxEaseR(u);
          this.fx[q] = this.cx + Math.cos(ang2) * rad; this.fy[q] = this.cy + Math.sin(ang2) * rad;
          a = Math.min(1, u / 0.28);
        }
      } else {
        /* Готовый знак дышит на полпикселя, под курсором — расступается. */
        var gxp = tx + Math.sin(tt * 0.0013 + this.ph[q]) * 0.45, gyp = ty + Math.cos(tt * 0.0011 + this.ph[q]) * 0.45;
        var dx = tx - this.mx, dy = ty - this.my, d2 = dx * dx + dy * dy;
        if (d2 < rep2){ var d = Math.sqrt(d2) || 1, f = 1 - d / rep; f *= f * push; gxp += dx / d * f; gyp += dy / d * f; }
        this.fx[q] += (gxp - this.fx[q]) * follow; this.fy[q] += (gyp - this.fy[q]) * follow;
      }
      if (a <= 0.01) continue;
      a = Math.round(a * 16) / 16;
      if (a !== lastA){ ctx.globalAlpha = a; lastA = a; }
      ctx.fillRect(this.fx[q] - half, this.fy[q] - half, size, size);
    }
    lastA = -1;
  }
  if (front < 99 && this.phase !== 'leave'){
    ctx.fillStyle = '#ffffff';
    var wv = 0.16;
    for (var p = 0; p < this.fn; p++){
      var pr = (this.gx[p] + this.gy[p] * 0.55) / (OBFX_CELLS * 0.78);
      var b = Math.exp(-Math.pow((pr - front) / wv, 2));
      if (b < 0.06) continue;
      ctx.globalAlpha = Math.round(b * (this.darkBg ? 0.55 : 0.4) * 12) / 12;
      ctx.fillRect(this.fx[p] - half, this.fy[p] - half, size, size);
    }
  }
  ctx.globalAlpha = 1;
};
