'use strict';
/* ============================================================
   ПЛАШКА ОБНОВЛЕНИЯ
   ============================================================
   В правом нижнем углу — только когда вышла новая версия. Нет новой — нет
   плашки. Проверяет и ставит главный процесс (main/updates.js): окно
   показывает его состояние и передаёт нажатия.

   Состояния: предложение («Обновить» / «Позже»), скачивание с
   прогрессом, проверка подписи, перезапуск; если поставить самому нельзя
   или не вышло — команда для «Терминала» и страница релиза.
   Пока открыт мастер первого запуска — плашки нет.
   ============================================================ */
var UPD = null;
var updWasOn = false;

var UPD_ICON = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
  '<path d="M8 11V3M4.5 6.5 8 3l3.5 3.5M3 13h10" stroke="currentColor" stroke-width="1.6" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>';

/* «124 МБ»; меньше десяти — с одним знаком: «0,2 МБ». */
function updMb(bytes){
  var n = Number(bytes) / 1048576;
  var t = n < 10 ? n.toFixed(1).replace('.', ',') : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return t + NBSP + 'МБ';
}
/* Что показывать: идёт установка, есть подсказка или ошибка — их;
   иначе предложение, если оно не отложено. */
function updView(s){
  if (!s) return null;
  if (s.run && s.run.phase) return s.run.phase;
  if (s.available && !s.snoozed) return 'offer';
  return null;
}
function updHead(title, sub, close){
  return '<div class="upd-top"><span class="upd-ic">' + UPD_ICON + '</span><span class="upd-t">Обновление</span>' +
    (close ? '<button type="button" class="upd-x" data-upd="' + close + '" aria-label="Закрыть">×</button>' : '') + '</div>' +
    '<div class="upd-h">' + title + '</div>' + (sub ? '<div class="upd-sub">' + sub + '</div>' : '');
}
function updCommandHTML(s){
  return '<code class="upd-cmd">' + esc(s.command) + '</code>' +
    '<div class="upd-btns"><button type="button" class="btn btn-primary btn-sm" data-upd="copy">Скопировать команду</button>' +
    '<button type="button" class="btn btn-quiet btn-sm" data-upd="page">Страница релиза</button></div>';
}
function updHTML(s, view){
  var a = s.available || {};
  var ver = esc(a.version || (s.run && s.run.version) || '');
  if (view === 'offer'){
    return updHead('Вышла версия ' + ver, 'у вас ' + esc(s.current) + (a.size ? ' · ' + updMb(a.size) : ''), 'later') +
      (a.notes && a.notes.length ? '<ul class="upd-notes">' + a.notes.slice(0, 3).map(function(n){
        return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>' : '') +
      '<div class="upd-btns"><button type="button" class="btn btn-primary btn-sm" data-upd="install">Обновить</button>' +
      '<button type="button" class="btn btn-quiet btn-sm" data-upd="later">Позже</button></div>' +
      '<div class="upd-foot">Учёт не трогается. GREENFOX перезапустится.</div>';
  }
  if (view === 'download'){
    var got = s.run.got || 0, total = s.run.total || a.size || 1;
    var pct = Math.max(0, Math.min(100, Math.round(got / total * 100)));
    return updHead('Скачиваю версию ' + ver, updMb(got) + ' из ' + updMb(total)) +
      '<div class="upd-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '">' +
      '<i style="transform:scaleX(' + (pct / 100) + ')"></i></div>';
  }
  if (view === 'verify'){
    return updHead('Проверяю версию ' + ver, '') +
      '<div class="upd-wait"><span class="upd-spin"></span>подпись автора, контрольная сумма, целостность приложения</div>';
  }
  if (view === 'restart'){
    return updHead('Устанавливаю версию ' + ver, '') +
      '<div class="upd-wait"><span class="upd-spin"></span>GREENFOX сейчас закроется и откроется снова</div>';
  }
  if (view === 'manual'){
    return updHead('Вышла версия ' + ver, s.run.reason ? 'Само не обновится: ' + esc(s.run.reason) + '.' : '', 'later') +
      '<div class="upd-txt">Обновите командой в «Терминале» — учёт не трогается:</div>' + updCommandHTML(s);
  }
  if (view === 'error'){
    return updHead('Не получилось обновить', esc(s.run.error) + '.', 'later') +
      '<div class="upd-btns"><button type="button" class="btn btn-primary btn-sm" data-upd="install">Ещё раз</button>' +
      '<button type="button" class="btn btn-quiet btn-sm" data-upd="manual">Обновить командой</button></div>';
  }
  return '';
}
function updRender(){
  var el = document.getElementById('updCard');
  if (!el) return;
  var view = updView(UPD);
  if (typeof obIsOpen !== 'undefined' && obIsOpen) view = null;
  if (!view){ el.hidden = true; el.innerHTML = ''; updWasOn = false; return; }
  el.setAttribute('data-view', view);
  el.innerHTML = updHTML(UPD, view);
  el.hidden = false;
  /* Появление — один раз, когда плашки не было: смена состояния внутри
     неё — на месте, без движения. */
  if (!updWasOn && !REDUCED && el.animate){
    el.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }],
               { duration: 260, easing: 'cubic-bezier(.16, 1, .3, 1)' });
  }
  updWasOn = true;
}
function updInit(){
  var el = document.getElementById('updCard');
  window.api.onUpdate(function(s){
    if (s && s.mode) UPD = s;
    updRender();
    /* Открыт «О программе» — строка «Обновления» там тоже свежая. */
    if (s && s.mode && typeof current !== 'undefined' && current === 'settings' && typeof sgSec !== 'undefined' &&
        sgSec === 'about' && SG && SG.about){ SG.about.update = s; sgRenderBody(false); }
  });
  window.api.updateState().then(function(s){ if (s && s.mode) UPD = s; updRender(); }, function(){});
  el.addEventListener('click', function(e){
    var b = e.target.closest('[data-upd]');
    if (!b || !UPD) return;
    var act = b.getAttribute('data-upd');
    if (act === 'install'){
      b.disabled = true;
      window.api.updateInstall().then(function(r){
        if (r && !r.ok && r.error && !(UPD && UPD.run)) toast('Не обновилось: ' + r.error);
      });
    }
    if (act === 'later') window.api.updateLater().then(function(s){ if (s && s.mode) UPD = s; updRender(); });
    /* После ошибки — тот же путь, что без прав на папку: команда. */
    if (act === 'manual'){ UPD.run = { phase: 'manual', reason: '' }; updRender(); }
    if (act === 'copy') window.api.updateCopy().then(function(){ toast('Команда скопирована — вставьте её в «Терминал»'); });
    if (act === 'page') window.api.updatePage();
  });
}
