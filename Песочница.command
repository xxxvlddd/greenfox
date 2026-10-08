#!/bin/bash
# Песочница GREENFOX: то же приложение со своей отдельной базой.
# Настоящий учёт не меняется — песочница каждый раз начинается заново.
# Переменная, при которой приложение запускается как консольная программа, — не нужна.
unset ELECTRON_RUN_AS_NODE
APP="$(cd "$(dirname "$0")" && pwd)/release/mac-arm64/GREENFOX.app"
if [ ! -d "$APP" ]; then echo "Не нашёл приложение: $APP"; read -p "Enter — закрыть"; exit 1; fi
echo ""
echo "  Песочница GREENFOX — ваш настоящий учёт не меняется."
echo ""
echo "  1 — пустая база, как при первом запуске"
echo "  2 — копия ваших данных: можно пробовать что угодно"
echo "  3 — пример ошибки расчёта"
echo "  4 — пример медленного расчёта (заглушка загрузки)"
echo ""
read -p "  Номер и Enter: " n
case "$n" in
  1) open -n -a "$APP" --args --sandbox ;;
  2) open -n -a "$APP" --args --sandbox=copy ;;
  3) open -n -a "$APP" --args --sandbox=copy --simulate=error ;;
  4) open -n -a "$APP" --args --sandbox=copy --simulate=slow ;;
  *) echo "  Ничего не запускаю." ;;
esac
