'use strict';
/* ============================================================
   КОММЕНТАРИЙ АССИСТЕНТА НА ЭКРАНЕ
   ============================================================
   Строка над числами «Обзора», «Расходов», «Прогнозов» и «Планов»:
   короткая оценка ассистента с пометкой «решение». Подсказки и
   предупреждения экрана — правила приложения, они остаются как были.

   Комментарии приходят из главного процесса сами: после записей —
   когда человек закончил вносить, при открытии экрана — если данные
   изменились. Пока комментарий обновляется, прежний текст стоит на
   месте и тускнеет — высота блока не прыгает. Это справка, а не кнопка:
   нажимается только «Обновить».

   Без ключа и при «не показывать» в настройках блока нет. Имена
   начинаются с cm.
   ============================================================ */
var CM = null;                 /* состояние: режим, комментарии, идёт ли обновление */
var CM_SCREENS = ['overview', 'expenses', 'forecast', 'plans'];
var cmAsked = false;           /* обновление по кнопке — ждём ответа */

var CM_ICON = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 1.5l1.6 4.2 ' +
  '4.4 1.3-4.4 1.3L8 12.5 6.4 8.3 2 7l4.4-1.3z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';

/* «обновлён в 10:42», «вчера в 18:05», «30 сентября». */
function cmAgo(at){
  var t = new Date(at);
  if (isNaN(t)) return '';
  var now = new Date(), hm = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
  var day = function(x){ return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
  var diff = Math.round((day(now) - day(t)) / 864e5);
  if (diff === 0) return 'обновлён в ' + hm;
  if (diff === 1) return 'обновлён вчера в ' + hm;
  return 'обновлён ' + t.getDate() + NBSP + MONTHS[t.getMonth()];
}
function cmHTML(screen){
  if (!CM || CM.error && !CM.items || CM.mode === 'off' || CM.gate === 'nokey' || CM.gate === 'nomodel') return '';
  var it = CM.items[screen], busy = CM.busy || cmAsked;
  /* Данных на экране нет (пустая база) — и комментировать нечего. */
  if (!it && (CM.stale || []).indexOf(screen) < 0) return '';
  var text;
  if (it) text = '<p class="cm-text' + (busy ? ' is-dim' : '') + '">' + asInline(it.text) + '</p>';
  else if (busy) text = '<p class="cm-text cm-wait"><span class="x">Смотрю данные экрана…</span></p>';
  else if (CM.gate === 'limit') text = '<p class="cm-text cm-muted">Месячный лимит расходов на ассистента исчерпан — ' +
    'комментарий появится, когда он сбросится или вы его поднимете.</p>';
  else if (CM.mode === 'manual') text = '<p class="cm-text cm-muted">Комментарий пишется по кнопке «Обновить».</p>';
  else text = '<p class="cm-text cm-muted">Комментарий появится через минуту.</p>';
  var meta = busy
    ? '<span class="spin"></span><span class="cm-at">обновляю…</span>'
    : (it ? '<span class="cm-at">' + (it.fresh ? cmAgo(it.at) : 'данные изменились') + '</span>' : '') +
      (CM.gate === 'limit' ? '' : '<button type="button" class="link-btn" data-cmact="refresh">Обновить</button>');
  var err = CM.error && !busy ? '<p class="cm-err">Не обновился: ' + esc(CM.error) + '</p>' : '';
  return '<section class="cm" id="cmBox" data-cm="' + screen + '">' +
    '<div class="cm-head"><span class="cm-ic">' + CM_ICON + '</span><span class="cm-t">Комментарий ассистента</span>' +
      /* На «Расходах» можно листать периоды, а комментарий — о текущем месяце. */
      (screen === 'expenses' ? '<span class="cm-at">о текущем месяце</span>' : '') +
      (it && it.judgment ? '<span class="badge badge--decision">решение</span>' : '') +
      '<span class="spacer"></span>' + meta + '</div>' + text + err + '</section>';
}
/* Поставить блок на экран: на «Обзоре» — под предупреждениями, на
   остальных — первым. Новый текст проявляется, первый показ — без
   движения. */
function cmPlace(screen, animate){
  var host = document.getElementById('screen');
  if (!host || CM_SCREENS.indexOf(screen) < 0) return;
  var html = cmHTML(screen), box = document.getElementById('cmBox');
  if (!html){ if (box) box.remove(); return; }
  if (box){
    var before = box.querySelector('.cm-text') ? box.querySelector('.cm-text').textContent : '';
    box.outerHTML = html;
    var p = document.querySelector('#cmBox .cm-text');
    if (animate && booted && !REDUCED && p && p.textContent !== before && !p.classList.contains('is-dim')) p.classList.add('is-in');
    return;
  }
  var alerts = host.querySelector(':scope > .alerts');
  if (alerts) alerts.insertAdjacentHTML('afterend', html);
  else host.insertAdjacentHTML('afterbegin', html);
}
/* После отрисовки экрана: блок из того, что уже известно, — сразу, без
   сдвига; свежее состояние — следом. */
function cmMount(screen){
  if (CM_SCREENS.indexOf(screen) < 0) return;
  cmPlace(screen, false);
  window.api.comments().then(function(s){
    if (!s || s.error) return;
    CM = s;
    if (current === screen) cmPlace(screen, false);
  });
}
function cmInit(){
  window.api.onComments(function(s){
    /* Обновление по кнопке дорисует сам ответ на запрос. */
    if (!s || s.error || cmAsked) return;
    CM = s;
    if (CM_SCREENS.indexOf(current) >= 0) cmPlace(current, true);
  });
  document.getElementById('screen').addEventListener('click', function(e){
    var b = e.target.closest ? e.target.closest('[data-cmact="refresh"]') : null;
    if (!b) return;
    cmAsked = true;
    cmPlace(current, false);
    var screen = current;
    window.api.commentsRefresh(screen).then(function(s){
      cmAsked = false;
      if (s && !s.error) CM = s;
      if (current === screen) cmPlace(screen, true);
    });
  });
}
