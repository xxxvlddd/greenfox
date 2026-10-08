'use strict';
/* ============================================================
   ВЫВОД ЧИСЕЛ
   ============================================================
   Из главного процесса деньги приходят строкой копеек вида
   «-12345.67»: тип BigInt через мост не проходит, а превращать в
   дробное число нельзя — потеряется копейка.
   ============================================================ */
var NBSP = '\u00A0';
/* Знак рубля приклеивается к числу только неразрывным пробелом.
   Отдельной константой — чтобы его нельзя было приписать обычным
   пробелом по невнимательности: именно так «₽» однажды повис на
   следующей строке в «Днях по уровню трат». */
var RUB = NBSP + '₽';
function group(x){ return x.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP); }

/* Наборы шрифтов для подписей внутри графиков. Атрибут font-family у
   SVG повторяет переменные --font-mono и --font-sans из design.css
   буква в букву. В DM Mono и DM Sans нет кириллицы, и русские буквы
   берутся из запасных шрифтов этого набора. Короткий набор
   «'DM Mono', ui-monospace, monospace» при русской локали окна отдавал
   кириллицу шрифту Times — «к» в «100к ₽» выходила с засечками. */
var FONT_MONO = "'DM Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
var FONT_SANS = "'DM Sans', -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif";

/* Копейки строкой → «−12 345,67 ₽».
   На вход всегда приходят КОПЕЙКИ: «-1234567». Рубли с точкой сюда
   попадать не должны — именно смешение двух форматов однажды показало
   лимит карты в сто раз меньше настоящего. */
function money(cents, dec){
  if (cents === null || cents === undefined) return '—';
  var s = String(cents);
  var neg = s.charAt(0) === '-';
  if (neg) s = s.slice(1);
  if (!/^\d+$/.test(s)) return '—';
  while (s.length < 3) s = '0' + s;
  var whole = s.slice(0, -2), frac = s.slice(-2);
  if (dec === 0){
    /* До рубля округляем к ближайшему — так же, как в расчёте. */
    if (Number(frac) >= 50) whole = String(Number(whole) + 1);
    return (neg ? '−' : '') + group(whole) + NBSP + '₽';
  }
  return (neg ? '−' : '') + group(whole) + ',' + frac + NBSP + '₽';
}
function money0(s){ return money(s, 0); }
/* Валютный счёт: та же запись с другим знаком — «500,00 $», «950 €». */
var CUR_SYM = { RUB: '₽', USD: '$', EUR: '€' };
function moneyIn(cents, cur, dec){
  var s = money(cents, dec);
  return cur && cur !== 'RUB' && CUR_SYM[cur] ? s.replace(/₽$/, CUR_SYM[cur]) : s;
}

function plural(n, one, few, many){
  var t = n % 100, o = n % 10;
  if (t >= 11 && t <= 14) return many;
  if (o === 1) return one;
  if (o >= 2 && o <= 4) return few;
  return many;
}
function nDays(n){ return n + NBSP + plural(n, 'день', 'дня', 'дней'); }
function nOps(n){ return n + NBSP + plural(n, 'операция', 'операции', 'операций'); }

var MONTHS = ['января','февраля','марта','апреля','мая','июня',
              'июля','августа','сентября','октября','ноября','декабря'];
function humanDate(iso){
  if (!iso) return '—';
  var p = iso.split('-');
  return Number(p[2]) + NBSP + MONTHS[Number(p[1]) - 1];
}
/* Чинит пробелы в готовой фразе: внутри числа и перед знаком валюты
   они обязаны быть неразрывными. Нужно там, где строка написана
   руками, а не собрана форматировщиком. */
function nbsp(s){
  return String(s)
    .replace(/(\d)\u0020(?=\d)/g, '$1' + NBSP)
    .replace(/\u0020(?=[₽$€])/g, NBSP);
}
function esc(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
                  .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* Копейки строкой → рубли числом. Нужно только там, где число идёт в
   геометрию графика: координаты всё равно дробные. Всё, что человек
   читает как сумму, берётся из точной строки копеек. */
function rub(cents){ return Number(cents) / 100; }

/* Округлённое до рубля, с разделителями и без копеек. */
function fmtR(n){
  return (n < 0 ? '−' : '') + group(Math.abs(Math.round(n)).toString());
}
/* Границы зон запаса прочности в месяцах: ниже первой — критично, ниже
   второй — тонко. Приходят из настроек вместе с данными экрана. Шкала
   полосы — вдвое дальше второй границы, но не короче четырёх месяцев. */
var ZONES = [1, 2];
function setZones(z){ ZONES = z && z.length === 2 && z[0] > 0 && z[1] > z[0] ? z : [1, 2]; }
function zoneMax(){ return Math.max(4, ZONES[1] * 2); }
function zonePct(months){ return months === null ? 0 : Math.max(0, Math.min(100, months / zoneMax() * 100)); }
function zoneBarFill(){
  var a = ZONES[0] / zoneMax() * 100, b = (ZONES[1] - ZONES[0]) / zoneMax() * 100;
  return '<i style="width:' + a.toFixed(1) + '%;background:var(--danger)"></i>' +
         '<i style="width:' + b.toFixed(1) + '%;background:var(--warning)"></i>' +
         '<i style="width:' + (100 - a - b).toFixed(1) + '%;background:var(--positive)"></i>';
}
/* «меньше месяца», «меньше 1,5 месяца» — для подписей критической зоны. */
function zoneCritText(){
  return ZONES[0] === 1 ? 'меньше месяца' : 'меньше ' + String(ZONES[0]).replace('.', ',') + NBSP + 'мес.';
}
/* С копейками. */
function fmtK(n){
  var p = Math.abs(n).toFixed(2).split('.');
  return (n < 0 ? '−' : '') + group(p[0]) + ',' + p[1];
}
var MON_SHORT = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
function cssVar(name){
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/* Сумма без знака валюты — для крупного числа, у которого «₽» стоит
   отдельным элементом меньшего кегля. */
function moneyBare(cents){
  return money(cents).replace(NBSP + '₽', '');
}
function nAcc(n){ return n + NBSP + plural(n, 'счёт', 'счёта', 'счетов'); }
