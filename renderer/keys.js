'use strict';
/* ============================================================
   ГОРЯЧИЕ КЛАВИШИ
   ============================================================
   Список — по макету 11-sostoyaniya.html, шпаргалка — по ⌘/ на любом
   экране и в «Настройках». Клавиши узнаются по коду, а не по букве: на
   русской раскладке ⌘N — это ⌘Т, а работать должно одинаково.

   Пока открыто окно ввода, действуют только его клавиши (⌘↵, Esc):
   переход на другой экран за открытым окном сбил бы с толку. В поле
   ввода ⌘Z и ⌘← ⌘→ остаются за полем — отмена набора и переход в
   начало строки. ⌘E, ⌘I, ⌘T и ⌘↵ — в forms.js, ⌘J — в app.js.
   Имена начинаются с key.
   ============================================================ */
var KEYS = [
  ['⌘1 … ⌘7', 'Обзор, Расходы, Капитал, Прогнозы, Планы, Календарь, Платежи'],
  ['⌘N', 'Меню «Добавить»'],
  ['⌘E', 'Расход'],
  ['⌘I', 'Доход'],
  ['⌘T', 'Перевод между своими'],
  ['⌘⇧N', 'Ввод операций текстом — ассистент'],
  ['⌘J', 'Панель ассистента'],
  ['⌘F', 'Поиск по операциям'],
  ['⌘,', 'Настройки'],
  ['⌘← ⌘→', 'Предыдущий и следующий период'],
  ['⌘↵', 'Сохранить в открытом окне'],
  ['Esc', 'Закрыть окно или панель'],
  ['⌘Z', 'Отменить последнюю запись'],
  ['⌘/', 'Эта шпаргалка']
];
var KEY_SCREENS = ['overview', 'expenses', 'capital', 'forecast', 'plans', 'calendar', 'payments'];

function keysHTML(){
  return '<div class="keys">' + KEYS.map(function(k){
    return '<div><span class="k"><span class="kbd">' + k[0] + '</span></span><span class="d">' + k[1] + '</span></div>';
  }).join('') + '</div>';
}
function keyEditable(el){
  return !!(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)));
}
/* Переход с закрытием панели ассистента: иначе новый экран остался бы
   под шторкой. */
function keyGo(screen){
  if (asIsOpen) asToggle(false);
  return goTo(screen);
}
/* ⌘F: поиск по операциям живёт на «Расходах». */
function keySearch(){
  var focus = function(){
    var i = document.getElementById('exOpsSearch');
    if (!i) return;
    i.scrollIntoView({ block: 'center' });
    i.focus(); i.select();
  };
  if (current === 'expenses' && !asIsOpen){ focus(); return; }
  Promise.resolve(keyGo('expenses')).then(focus);
}
/* ⌘⇧N: панель ассистента сразу в режиме «Ввод операций». */
function keyAssistInput(){
  if (!hasAiKey){ openAssistant(); return; }
  Promise.resolve(asIsOpen ? null : asToggle(true)).then(function(){
    asMode = 'input';
    asHead();
    document.getElementById('asInput').focus();
  });
}
function keysInit(){
  document.addEventListener('keydown', function(e){
    if (!(e.metaKey || e.ctrlKey) || e.altKey || fmKind || obIsOpen) return;
    var c = e.code, sh = e.shiftKey;
    var digit = /^Digit([1-7])$/.exec(c);
    if (digit && !sh){ e.preventDefault(); keyGo(KEY_SCREENS[Number(digit[1]) - 1]); return; }
    if (c === 'Slash' && !sh){ e.preventDefault(); fmMenu(false); fmOpen('keys'); return; }
    if (c === 'Comma' && !sh){ e.preventDefault(); keyGo('settings'); return; }
    if (c === 'KeyN' && sh){ e.preventDefault(); keyAssistInput(); return; }
    if (c === 'KeyN'){
      e.preventDefault();
      if (asIsOpen) asToggle(false);
      fmMenu(true);
      var first = document.querySelector('#addMenu [data-open]');
      if (first) first.focus();
      return;
    }
    if (c === 'KeyF' && !sh){ e.preventDefault(); keySearch(); return; }
    if ((c === 'ArrowLeft' || c === 'ArrowRight') && !sh && !keyEditable(e.target) && !asIsOpen){
      var id = { expenses: 'ex', calendar: 'cl' }[current];
      var b = id && document.getElementById(id + (c === 'ArrowLeft' ? 'Prev' : 'Next'));
      if (b && !b.disabled){ e.preventDefault(); b.click(); }
      return;
    }
    if (c === 'KeyZ' && !sh && !keyEditable(e.target)){ e.preventDefault(); fmUndoLast(); }
  });
}
