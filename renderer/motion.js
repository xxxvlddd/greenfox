'use strict';
/* ============================================================
   ДВИЖЕНИЕ — тот же набор, что в макетах
   ============================================================
   Наборы кадров и классы-переключатели лежат в design.css; здесь —
   служебная часть на JS. Длительности и кривая берутся из токенов,
   поэтому темп приложения меняется в одном месте.
   ============================================================ */
var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/* Пока экран собирается в первый раз, движения нет: на первой
   отрисовке ещё ничего не изменилось, и сообщать нечего. Докрутка
   чисел на загрузке — украшение, а не сведения. */
var booted = false;

/* Докрутка числа: величина пересчиталась, и видно, из чего она выросла.
   Метка счёта нужна на случай, если за время докрутки пришло новое
   значение: старый цикл обязан замолчать, иначе два цикла пишут в одну
   строку. */
function countUp(el, to, fmt){
  if (!el) return;
  var from = parseFloat(el.getAttribute('data-v'));
  if (!isFinite(from)) from = 0;
  el.setAttribute('data-v', to);
  if (REDUCED || !booted || from === to){ el.textContent = fmt(to); return; }
  var token = (parseInt(el.getAttribute('data-tok'), 10) || 0) + 1;
  el.setAttribute('data-tok', token);
  var t0 = null;
  function tick(t){
    if ((parseInt(el.getAttribute('data-tok'), 10) || 0) !== token) return;
    if (t0 === null) t0 = t;
    var p = Math.min(1, (t - t0) / 620);
    el.textContent = fmt(from + (to - from) * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
/* Мгновенная подстановка — для значений, которые меняются, пока человек
   печатает: докручивать на каждое нажатие клавиши нельзя. */
function setNow(el, to, fmt){
  if (!el) return;
  el.setAttribute('data-v', to);
  el.setAttribute('data-tok', (parseInt(el.getAttribute('data-tok'), 10) || 0) + 1);
  el.textContent = fmt(to);
}
/* Вспышка цветом на изменившемся значении. Размер не трогаем — он
   сдвинул бы соседние строки. */
function bump(el){
  if (!el || REDUCED || !booted) return;
  el.classList.remove('is-bump');
  void el.offsetWidth;   /* пересчёт стилей: иначе снятый и возвращённый
                            в одном кадре класс останется незамеченным */
  el.classList.add('is-bump');
}
/* Лестница: строки списка появляются по очереди, а не пачкой. */
function stagger(root, sel){
  if (REDUCED || !booted || !root) return;
  var kids = root.querySelectorAll(sel);
  /* Только начало списка: на длинной таблице волна перестаёт читаться
     как порядок и начинает читаться как рябь. */
  var n = Math.min(kids.length, 7);
  for (var i = 0; i < n; i++){
    kids[i].classList.add('is-rise');
    kids[i].style.animationDelay = (i * 40) + 'ms';
  }
}
/* Появление блока на месте предыдущего. */
function appear(el){
  if (!el || REDUCED || !booted) return;
  el.classList.remove('is-in');
  void el.offsetWidth;
  el.classList.add('is-in');
}
