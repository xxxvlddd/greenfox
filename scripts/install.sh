#!/bin/bash
# ============================================================
#  GREENFOX — установка и обновление одной командой
# ============================================================
#  curl -fsSL https://raw.githubusercontent.com/xxxvlddd/greenfox/main/scripts/install.sh | bash
#
#  Что делает:
#   1. проверяет, что это Mac на Apple Silicon с macOS 12 или новее;
#   2. скачивает последнюю версию со страницы релизов на GitHub;
#   3. сверяет контрольную сумму SHA-256 — файл не испорчен и не подменён;
#   4. закрывает GREENFOX, если он открыт, и кладёт новую версию в
#      «Программы» (если туда нельзя писать — в ~/Applications).
#  Учёт не трогает: он лежит отдельно, в ~/Library/Application Support/GREENFOX.
#  Пароль администратора не спрашивает.
# ============================================================
set -euo pipefail

REPO="xxxvlddd/greenfox"
APP="GREENFOX.app"
BUNDLE_ID="ru.local.finances"
ASSET="GREENFOX-arm64.dmg"
# Адреса и папку можно подменить — так скрипт проверяют без сети.
URL="${GREENFOX_DMG_URL:-https://github.com/${REPO}/releases/latest/download/${ASSET}}"
SUM_URL="${GREENFOX_SUM_URL:-${URL}.sha256}"
DEST="${GREENFOX_APP_DIR:-/Applications}"

say()  { printf '%s\n' "$*"; }
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die()  { printf '\n\033[31mНе получилось:\033[0m %s\n' "$*" >&2; exit 1; }

step "GREENFOX — установка"

# ── Подходит ли компьютер ──────────────────────────────────
[ "$(uname -s)" = "Darwin" ] || die "GREENFOX работает только на macOS."
# В «Терминале» под Rosetta uname говорит x86_64 и на Apple Silicon —
# спрашиваем сам процессор.
[ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ] ||
  die "нужен Mac на Apple Silicon (M1 и новее). На Mac с процессором Intel GREENFOX пока не работает."
MAJOR="$(sw_vers -productVersion | cut -d. -f1)"
[ "${MAJOR}" -ge 12 ] || die "нужна macOS 12 Monterey или новее, а у вас $(sw_vers -productVersion)."
for c in curl shasum hdiutil ditto; do command -v "${c}" >/dev/null || die "в системе нет команды ${c}."; done

TMP="$(mktemp -d "${TMPDIR:-/tmp}/greenfox.XXXXXX")"
MNT="${TMP}/mnt"
cleanup() {
  if [ -d "${MNT}" ]; then hdiutil detach "${MNT}" -quiet -force >/dev/null 2>&1 || true; fi
  rm -rf "${TMP}"
}
trap cleanup EXIT

# ── Скачать и проверить ────────────────────────────────────
step "Скачиваю последнюю версию…"
curl -fL --retry 3 --progress-bar -o "${TMP}/${ASSET}" "${URL}" ||
  die "не удалось скачать ${URL}. Проверьте интернет и попробуйте ещё раз."
curl -fsSL --retry 3 -o "${TMP}/sum" "${SUM_URL}" ||
  die "не удалось скачать контрольную сумму ${SUM_URL}."
WANT="$(awk '{print $1; exit}' "${TMP}/sum" | tr 'A-F' 'a-f')"
GOT="$(shasum -a 256 "${TMP}/${ASSET}" | awk '{print $1}')"
[ -n "${WANT}" ] && [ "${WANT}" = "${GOT}" ] ||
  die "контрольная сумма не совпала — файл повреждён или подменён. Ничего не установлено."
say "Контрольная сумма совпала."

# ── Установить ─────────────────────────────────────────────
mkdir -p "${MNT}"
hdiutil attach "${TMP}/${ASSET}" -nobrowse -readonly -noautoopen -mountpoint "${MNT}" -quiet ||
  die "не удалось открыть образ диска."
[ -d "${MNT}/${APP}" ] || die "в образе нет ${APP}."
VERSION="$(defaults read "${MNT}/${APP}/Contents/Info" CFBundleShortVersionString 2>/dev/null || echo '?')"

# Нет прав писать в «Программы» — ставим в свою папку программ.
if [ ! -w "${DEST}" ]; then
  DEST="${HOME}/Applications"
  mkdir -p "${DEST}"
fi
TARGET="${DEST}/${APP}"

if [ -e "${TARGET}" ]; then
  OLD_ID="$(defaults read "${TARGET}/Contents/Info" CFBundleIdentifier 2>/dev/null || true)"
  [ "${OLD_ID}" = "${BUNDLE_ID}" ] || die "в ${DEST} уже есть другое приложение с именем ${APP} — не трогаю его."
  if pgrep -f "${TARGET}/Contents/MacOS/" >/dev/null 2>&1; then
    say "Закрываю открытый GREENFOX…"
    osascript -e 'tell application id "'"${BUNDLE_ID}"'" to quit' >/dev/null 2>&1 || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -f "${TARGET}/Contents/MacOS/" >/dev/null 2>&1 || break; sleep 1; done
    pgrep -f "${TARGET}/Contents/MacOS/" >/dev/null 2>&1 && die "GREENFOX не закрылся — закройте его сами и запустите установку ещё раз."
  fi
fi

step "Устанавливаю GREENFOX ${VERSION} в ${DEST}…"
# Сначала копия рядом, потом подмена: прерванная установка не оставит
# половину приложения.
rm -rf "${TARGET}.new"
ditto "${MNT}/${APP}" "${TARGET}.new" || die "не удалось скопировать приложение в ${DEST}."
rm -rf "${TARGET}"
mv "${TARGET}.new" "${TARGET}"
# Скачанное через curl macOS карантином не помечает; снимаем на всякий
# случай — иначе при первом запуске было бы предупреждение о разработчике.
xattr -dr com.apple.quarantine "${TARGET}" 2>/dev/null || true

step "Готово."
say "GREENFOX ${VERSION} — в ${DEST}."
say "Открыть: open -a \"${TARGET}\"   (или найдите GREENFOX в Launchpad)"
say "Ваш учёт хранится в ~/Library/Application Support/GREENFOX и при обновлении не меняется."
