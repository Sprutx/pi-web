# `patch-pi-ai-subpath-aliases.js`

Расширение Pi, регистрирующее собственного провайдера (например
`pi-opencode-direct` с провайдером `opencode-zen-free`), **молча не
загружается** в Pi Web, и его модели не появляются в селекторе и в
`/api/models`. Этот скрипт чинит это на этапе `postinstall`.

## Симптом

Модели провайдера отсутствуют, а в логах расширений — ошибка загрузки:

```
Failed to load extension: Cannot find module
  '.../pi-ai/dist/compat.js/api/openai-completions.lazy'
```

| | без патча | с патчем |
| --- | --- | --- |
| ошибок загрузки расширений | 1 | 0 |
| зарегистрированные провайдеры | `google-gemini-cli, claude-bridge` | `+ opencode-zen-free` |
| доступно моделей | 34 | 41 |
| моделей `opencode-zen-free` | 0 | 7 |

## Причина

Pi Web импортирует `@earendil-works/pi-coding-agent` как обычный пакет, и
загрузчик расширений работает из `dist/`, а не из bundle. На этом пути
`getAliases()` в `dist/core/extensions/loader.js` сопоставляет
`@earendil-works/pi-ai` → `.../pi-ai/dist/compat.js`, а jiti применяет этот
алиас **по префиксу**. Расширение, импортирующее саб-путь pi-ai, например:

```ts
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
```

получает переписанный путь `.../pi-ai/dist/compat.js/api/openai-completions.lazy`,
которого не существует.

CLI не затронут: он запускается из `dist/bundle/cli.js`, где
`isBundledNode` включает `virtualModules` вместо этих алиасов. Поэтому одно и
то же расширение работает в `pi` и не работает в Pi Web.

Реальный `exports`-манифест pi-ai саб-пути содержит (`"./api/*"` есть) —
 проблема исключительно в prefix-матчинге алиаса.

## Что делает патч

Вставляет в объект алиасов `getAliases()` по одному явному алиасу на каждый
модуль из `pi-ai/dist/api/*.js`, так что точный саб-путь выигрывает у
префиксного:

```js
"@earendil-works/pi-ai/api/openai-completions.lazy": path.join(path.dirname(piAiCompatEntry), "api", "openai-completions.lazy.js"),
```

Модули **перечисляются автоматически**, а не перечислены вручную, поэтому чинятся
и другие расширения с саб-путями pi-ai. Алиасы добавляются и для
`@mariozechner/pi-ai`.

Пути берутся из уже вычисленного `piAiCompatEntry` в той же области видимости.
`resolveWorkspaceOrImport()` здесь непригоден: его fallback через
`import.meta.resolve()` бросает исключение для неустановленного namespace
(`@mariozechner/pi-ai`), что обрушивает построение всей таблицы алиасов и
делает нерабочими **все** расширения.

## Поведение

- Идемпотентен: повторный запуск сообщает `already patched`.
- Всегда завершается с кодом `0` и никогда не роняет `npm install`. Любая
  ошибка логируется в stdout как `skipped`.
- Тихо скипается, если: `loader.js` отсутствует, `pi-ai` не лежит рядом с
  `pi-coding-agent`, в `getAliases()` нет корневого алиаса pi-ai, либо патч уже
  применён. Тогда модели провайдера просто не появятся — остальной UI работает.

## Запуск вручную

```sh
node bin/patch-pi-ai-subpath-aliases.js
node bin/patch-pi-ai-subpath-aliases.js --target <путь-к-pi-coding-agent>
```

`--target` нужен для проверки без полной установки. Обычно скрипт запускается
автоматически из `postinstall`:

```json
"postinstall": "node bin/prepare-terminal.js && node bin/patch-pi-ai-subpath-aliases.js"
```

Требуется, чтобы рядом с `node_modules/@earendil-works/pi-coding-agent`
лежал `pi-ai` — в обычном `node_modules` это так и есть.

## Проверка результата

Запускать из каталога установленного `pi-coding-agent`, иначе пакет не
найдётся. `pi-coding-agent` — ESM-only, поэтому `require()` не подходит:

```sh
cd node_modules/@earendil-works/pi-coding-agent
node --input-type=module -e '
const M = await import("@earendil-works/pi-coding-agent");
const s = await M.createAgentSessionServices({ cwd: process.cwd(), agentDir: M.getAgentDir() });
console.log("errors:", (s.resourceLoader.getExtensions().errors ?? []).length);
console.log("providers:", s.modelRuntime.getRegisteredProviderIds().join(", "));
const a = await s.modelRuntime.getAvailable();
console.log("models:", a.length, a.filter(m => m.provider === "opencode-zen-free").map(m => m.id).join(", "));
'
```

Ожидается `errors: 0`, наличие `opencode-zen-free` в провайдерах и 7
zen-моделей. Без патча тот же код даёт `errors: 1` и пустой список zen-моделей.

## Замечание

Патч правит **только unbundled-путь**, то есть именно Pi Web. Установка Pi в
`~/.pi/agent/install/` патчить не нужно: CLI использует virtual modules и этой
проблемы не имеет. Правки managed-установки следует избегать и вручную —
`pi` обновляется и перезаписывает её.

Если патч не помог, проверьте, что расширение грузится вообще: сначала
`pi /reload`, затем логи загрузки расширений. Отдельная причина отсутствия
моделей — фильтр `enabledModels` в `settings.json`: он сужает список до
паттернов, и `opencode-zen-free/*` нужно добавить вручную.

## Удаление

```sh
git checkout -- bin/patch-pi-ai-subpath-aliases.js   # или удалите файл
npm pkg delete scripts.postinstall                   # если меняли
```

Чтобы снять уже применённый патч, восстановите
`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js`
(достаточно удалить вставленный блок с маркером `pi-web:pi-ai-subpath-aliases`;
проще всего `rm -rf node_modules && npm install`).
