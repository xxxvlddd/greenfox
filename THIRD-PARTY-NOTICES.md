# Сторонние компоненты

GREENFOX распространяется по лицензии GNU GPL 3.0 или новее (см.
[LICENSE](LICENSE)). Внутри приложения есть чужие компоненты со своими
лицензиями — все они совместимы с GPL и разрешают распространение.

| Компонент | Лицензия | Правообладатель | Где текст лицензии |
|---|---|---|---|
| [Electron](https://www.electronjs.org) | MIT | Electron contributors; GitHub Inc. | в приложении: `Contents/Resources/LICENSE.electron.txt` |
| [Chromium](https://www.chromium.org) и его компоненты (в составе Electron) | BSD-3-Clause и другие | The Chromium Authors и другие | в приложении: `Contents/Resources/LICENSES.chromium.html` |
| [Node.js](https://nodejs.org) (в составе Electron) | MIT | OpenJS Foundation and Node.js contributors | там же, в `LICENSES.chromium.html` |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | MIT | Joshua Wise | в приложении: `app.asar.unpacked/node_modules/better-sqlite3/LICENSE` |
| [SQLite](https://sqlite.org) (в составе better-sqlite3) | общественное достояние | — | <https://sqlite.org/copyright.html> |
| [node-addon-api](https://github.com/nodejs/node-addon-api) | MIT | Node.js API collaborators | в составе зависимостей npm |
| [DM Sans](https://github.com/googlefonts/dm-fonts) | SIL OFL 1.1 | The DM Sans Project Authors | [renderer/fonts/LICENSE-DMSans.txt](renderer/fonts/LICENSE-DMSans.txt) |
| [DM Mono](https://github.com/googlefonts/dm-mono) | SIL OFL 1.1 | The DM Mono Project Authors | [renderer/fonts/LICENSE-DMMono.txt](renderer/fonts/LICENSE-DMMono.txt) |
| [Special Gothic Expanded One](https://github.com/AlistairMcCready/Special-Gothic) | SIL OFL 1.1 | The Special Gothic Project Authors | [renderer/fonts/LICENSE-SpecialGothicExpandedOne.txt](renderer/fonts/LICENSE-SpecialGothicExpandedOne.txt) |

Шрифты лежат в приложении как есть, без изменений, и не продаются отдельно
от него — как того требует SIL OFL.

Знак GREENFOX (лиса) и название — часть этого проекта.
