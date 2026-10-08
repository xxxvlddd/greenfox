'use strict';
/* ============================================================
   ЧТЕНИЕ CSV
   ============================================================
   Нынешние файлы обходятся без кавычек, но приложение будет писать
   описания, введённые человеком, а там запятая появится в первый же
   день. Поэтому разбор полноценный, с кавычками и переносами строк
   внутри поля.
   ============================================================ */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false, i = 0;
  /* Маркер порядка байтов в начале файла — невидимый символ, который
     иначе приклеится к имени первой колонки. */
  if (text.charCodeAt(0) === 0xFEFF) i = 1;
  for (; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/* Строки как объекты по заголовку. Пустые строки в конце файла
   отбрасываем: текстовые редакторы любят дописывать перевод строки. */
function readCsv(text) {
  const rows = parseCsv(text).filter(r => r.length > 1 || (r[0] || '').trim() !== '');
  if (!rows.length) return [];
  const head = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => {
    const o = {};
    head.forEach((h, i) => { o[h] = r[i] === undefined ? '' : unguard(r[i]); });
    return o;
  });
}

/* Текст, который начинается с =, +, −, @ или табуляции, Excel и Numbers
   прочитают как формулу — а описание операции бывает чужим: комментарий
   к входящему переводу из выписки. Такой ячейке выгрузка ставит впереди
   апостроф, загрузка его снимает. Числа («-12345.67») не трогаем. */
const FORMULA = /^[=+\-@\t\r]/;
const NUMBER = /^[+-]?\d[\d\s.,]*$/;
function guard(s) { return FORMULA.test(s) && !NUMBER.test(s) ? "'" + s : s; }
function unguard(s) { return /^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s; }

/* Обратная запись — для выгрузки в CSV. Кавычим поле, только если без
   них его прочитают неправильно. */
function toCsv(head, rows) {
  const esc = v => {
    const s = guard(v === null || v === undefined ? '' : String(v));
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [head.join(',')]
    .concat(rows.map(r => head.map(h => esc(r[h])).join(',')))
    .join('\n') + '\n';
}

module.exports = { parseCsv, readCsv, toCsv, guard, unguard };
