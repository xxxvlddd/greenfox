'use strict';
/* ============================================================
   ЗАСТАВКА ПРИ ЗАПУСКЕ
   ============================================================
   Каждый раз, когда открывается окно: знак GREENFOX собирается из точек
   (тот же движок, что приветствие мастера, — renderer/onboard-fx.js),
   под ним строка о том, что сейчас происходит. Когда первый экран
   нарисован и знак собран — «Готово», знак рассыпается поверх
   приложения, заставка гаснет.

   Тяжёлая работа — данные и разметка первого экрана — идёт до начала
   движения: точки летят по пустому кадру, без рывков.
   При первом запуске на чистой базе заставки нет — у мастера своё
   приветствие. При «уменьшить движение» — собранный знак без движения.
   ============================================================ */
var SP_SPEED = 1.75;            /* знак собирается за ~1,6 с вместо 2,8 в мастере */
var SP_LIMIT = 8000;            /* что бы ни случилось, заставка не держит окно дольше */
var spScene = null;
var spState = 'wait';           /* wait → play → leave → gone */
var spTimer = null;

function spEl(){ return document.getElementById('splash'); }
function spStatus(text){
  var el = document.getElementById('spStatus');
  if (!el || el.textContent === text) return;
  if (REDUCED || !el.animate){ el.textContent = text; return; }
  var out = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'ease-in', fill: 'forwards' });
  out.onfinish = function(){
    el.textContent = text;
    out.cancel();
    el.animate([{ opacity: 0, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }],
               { duration: 220, easing: 'cubic-bezier(.16, 1, .3, 1)' });
  };
}

/* Сразу при загрузке страницы: холст на месте, пока пустой. */
function spStart(){
  var root = spEl();
  if (!root) return;
  try { spScene = new ObFxScene(root, { still: REDUCED, speed: SP_SPEED }); }
  catch (e) { spScene = null; root.classList.add('is-plain'); }
  /* Прогрев холста — пока на экране только название. */
  if (spScene && spScene.warm) spScene.warm();
  spTimer = setTimeout(spFinish, SP_LIMIT);
}
/* Можно начинать движение: окно на экране, шрифт названия загружен. Окно
   уже видно — не ждём отдельного сигнала о показе. */
function spWait(){
  return new Promise(function(res){
    var go = function(){ requestAnimationFrame(function(){ requestAnimationFrame(res); }); };
    var fonts = document.fonts && document.fonts.load
      ? document.fonts.load('400 34px "Special Gothic Expanded One"').catch(function(){}) : Promise.resolve();
    var shown = obShown || document.visibilityState === 'visible' ? Promise.resolve() : new Promise(function(ok){
      obShownWait.push(ok);
      setTimeout(ok, 900);
    });
    Promise.all([fonts, shown]).then(go);
  });
}
/* Первый экран нарисован: показываем сборку знака, потом уходим. */
function spReady(){
  if (spState !== 'wait' || !spEl()) return;
  spState = 'play';
  /* Подушка: движение — когда первый экран нарисован и браузер свободен. */
  spWait().then(function(){ whenIdle(spGo, 220, 800); });
}
function spGo(){
  if (spState !== 'play') return;
  spStatus('Считаю остатки и лимит на сегодня…');
  if (spScene) spScene.play();
  var hold = spScene && !REDUCED ? spScene.assembled : 450;
  setTimeout(function(){
    if (spState !== 'play') return;
    spStatus('Готово');
    setTimeout(spFinish, REDUCED ? 250 : 420);
  }, hold);
}
/* Уход: знак рассыпается поверх приложения, фон и надписи гаснут. */
function spFinish(){
  var root = spEl();
  if (!root || spState === 'leave' || spState === 'gone') return;
  spState = 'leave';
  clearTimeout(spTimer);
  root.style.pointerEvents = 'none';
  if (spScene) spScene.leave();
  var parts = [root.querySelector('.sp-fill'), root.querySelector('.wl')];
  var anims = parts.map(function(el){
    return el && el.animate && !REDUCED
      ? el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: el.classList.contains('wl') ? 220 : 340, easing: 'ease-out', fill: 'forwards' })
      : null;
  });
  if (REDUCED || !anims[0]) parts.forEach(function(el){ if (el) el.style.opacity = '0'; });
  setTimeout(spRemove, REDUCED ? 0 : 700);
}
/* Без заставки — например, когда открывается мастер на чистой базе. */
function spRemove(){
  var root = spEl();
  clearTimeout(spTimer);
  if (spScene) spScene.stop();
  spScene = null;
  spState = 'gone';
  if (root) root.remove();
}
