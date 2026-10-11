# AGAT PRINT — Security Remediation Report

Статус: локальная реализация завершена, полная branch-CI проверка ожидается.

- Дата: 2026-10-11
- Ветка: `codex/security-remediation-stage15`
- Исходный baseline: `89637db22fc7e1aca947eac8693a26e10344a6cb`
  Baseline CI: [38128026560](https://github.com/agata-flowers/agat-print/actions/runs/38128026560)

## 1. Результат remediation

Исходный `pnpm audit --prod --audit-level=low` обнаруживал 43 advisory:
2 Critical, 20 High, 19 Moderate и 2 Low. После совместимых обновлений и
ограниченных dependency resolutions:

- `pnpm audit --prod --audit-level=high` — успешно, **0 Critical / 0 High**;
- полный production audit — **3 Moderate**, все три относятся к одной
  неиспользуемой приложением цепочке `minio@8.0.7 → stream-json@1.9.1`;
- устранено 40 из 43 исходных findings, включая все применимые Critical/High;
- принудительный несовместимый переход `stream-json` с CommonJS 1.x на ESM 3.x
  намеренно не выполнен: MinIO 8.0.7 импортирует старый CJS subpath, а безопасной
  новой версии MinIO SDK пока нет;
- security audit теперь является обязательным blocking-шагом CI;
- обязательные browser acceptance-тесты Stage 11–13 имеют `retries=0`.

Полный audit, включая developer toolchain, дополнительно обнаружил 32 findings
(3 Critical, 12 High, 14 Moderate, 3 Low), опубликованных для исходных версий
Vitest/Tinypool, Nest CLI, ESLint, TypeScript ESLint, Turbo и их зависимостей.
После обновлений осталось 0 Critical, 1 High и 3 Moderate. Единственный High —
`braces` `GHSA-vfj7-8cjw-p6xm`: patched release отсутствует, пакет используется
только lint-инструментами со статическими repository-controlled patterns.
Security gate допускает его только по точному GHSA, имени пакета, `dev=true` и
ограниченному списку dependency-path prefixes; любое отклонение блокирует CI.

## 2. Полная матрица 43 исходных findings

Обозначения применимости: **runtime** — достижимый production-код; **bounded** —
пакет присутствует, но конкретный уязвимый API не вызывается; **tooling** —
сборка/CI. Пути сокращены относительно workspace.

|   № | Severity | Пакет / advisory                               | Исходный путь                                  | Итоговая версия | Применимость                                            | Устранение / статус                                                                      |
| --: | -------- | ---------------------------------------------- | ---------------------------------------------- | --------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
|   1 | Critical | `next` / `GHSA-vcvr-r3jv-pc5j`                 | `web → next`                                   | 16.3.8          | runtime                                                 | Обновлён Next; PWA tests/build пройдены — fixed                                          |
|   2 | High     | `next` / `GHSA-cjq9-62q9-8jv4`                 | `web → next`                                   | 16.3.8          | runtime                                                 | То же обновление — fixed                                                                 |
|   3 | Moderate | `next` / `GHSA-3w37-wq28-93x`                  | `web → next`                                   | 16.3.8          | runtime                                                 | То же обновление — fixed                                                                 |
|   4 | Moderate | `next` / `GHSA-4jqv-mc3x-m676`                 | `web → next`                                   | 16.3.8          | runtime                                                 | То же обновление — fixed                                                                 |
|   5 | Moderate | `next` / `GHSA-f87g-xv8r-7p7x`                 | `web → next`                                   | 16.3.8          | runtime                                                 | То же обновление — fixed                                                                 |
|   6 | Moderate | `next` / `GHSA-mcj8-r9mp-w47p`                 | `web → next`                                   | 16.3.8          | runtime                                                 | То же обновление — fixed                                                                 |
|   7 | Low      | `next` / `GHSA-39w2-rjm5-chcv`                 | `web → next`                                   | 16.3.8          | runtime                                                 | То же обновление — fixed                                                                 |
|   8 | Critical | `proxy-addr` / `GHSA-jqcg-44mw-7w3h`           | `api → Nest platform → express → proxy-addr`   | 2.0.8           | runtime                                                 | Узкий Express resolution; API явно задаёт `trust proxy=false` и fail-closed test — fixed |
|   9 | High     | `deepmerge-ts` / `GHSA-ggr8-5vv4-36mx`         | `api → prisma → @prisma/config → deepmerge-ts` | 8.0.2           | tooling                                                 | Prisma 6.19.3 + scoped resolution; generate/validate/build пройдены — fixed              |
|  10 | High     | `effect` / `GHSA-38f7-945m-qr2g`               | `api → prisma → @prisma/config → effect`       | 3.21.0          | tooling                                                 | Prisma 6.19.3 — fixed                                                                    |
|  11 | High     | `image-size` / `GHSA-5p2g-fcmc-qvqq`           | `api → image-size`                             | 2.0.4           | runtime, untrusted image                                | Direct patch + malformed/oversized PNG/JPEG tests — fixed                                |
|  12 | High     | `image-size` / `GHSA-w3rx-r6r6-pgpr`           | `api → image-size`                             | 2.0.4           | runtime, untrusted image                                | Direct patch + malformed/oversized PNG/JPEG tests — fixed                                |
|  13 | High     | `js-yaml` / `GHSA-2883-xcg3-v3hh`              | `api → Swagger → js-yaml`                      | 5.4.3           | bounded, generated OpenAPI                              | Swagger patch + scoped resolution — fixed                                                |
|  14 | High     | `js-yaml` / `GHSA-52cp-r559-cp3m`              | `api → Swagger → js-yaml`                      | 5.4.3           | bounded, generated OpenAPI                              | То же — fixed                                                                            |
|  15 | High     | `js-yaml` / `GHSA-5p4m-2wfm-xmqj`              | `api → Swagger → js-yaml`                      | 5.4.3           | bounded, generated OpenAPI                              | То же — fixed                                                                            |
|  16 | Moderate | `js-yaml` / `GHSA-h67p-54hq-rp68`              | `api → Swagger → js-yaml`                      | 5.4.3           | bounded, generated OpenAPI                              | То же — fixed                                                                            |
|  17 | Moderate | `js-yaml` / `GHSA-mh29-5h37-fv8m`              | `api → Swagger → js-yaml`                      | 5.4.3           | bounded, generated OpenAPI                              | То же — fixed                                                                            |
|  18 | High     | `lodash` / `GHSA-r5fr-rjxr-66jc`               | `api → Nest config/Swagger/MinIO → lodash`     | 4.18.1          | runtime                                                 | Swagger patch + scoped Nest config resolution — fixed                                    |
|  19 | Moderate | `lodash` / `GHSA-f23m-r3pf-42rh`               | тот же                                         | 4.18.1          | runtime                                                 | То же — fixed                                                                            |
|  20 | Moderate | `lodash` / `GHSA-xxjr-mmjv-4gpg`               | тот же                                         | 4.18.1          | runtime                                                 | То же — fixed                                                                            |
|  21 | High     | `multer` / `GHSA-535w-7cp7-47q4`               | `api → Nest platform-express → multer`         | 2.4.0           | bounded; uploads use custom bounded raw reader          | Scoped resolution + upload regressions — fixed                                           |
|  22 | High     | `multer` / `GHSA-5528-5vmv-3xc2`               | тот же                                         | 2.4.0           | bounded                                                 | То же — fixed                                                                            |
|  23 | High     | `multer` / `GHSA-72gw-mp4g-v24j`               | тот же                                         | 2.4.0           | bounded                                                 | То же — fixed                                                                            |
|  24 | High     | `multer` / `GHSA-v52c-386h-88mc`               | тот же                                         | 2.4.0           | bounded                                                 | То же — fixed                                                                            |
|  25 | High     | `multer` / `GHSA-wc9g-mqfw-jrwm`               | тот же                                         | 2.4.0           | bounded                                                 | То же — fixed                                                                            |
|  26 | High     | `multer` / `GHSA-xf7r-hgr6-v32p`               | тот же                                         | 2.4.0           | bounded                                                 | То же — fixed                                                                            |
|  27 | Moderate | `multer` / `GHSA-3p4h-7m6x-2hcm`               | тот же                                         | 2.4.0           | bounded                                                 | То же — fixed                                                                            |
|  28 | Low      | `multer` / `GHSA-qvfw-j98x-7q72`               | тот же                                         | 2.4.0           | bounded                                                 | То же — fixed                                                                            |
|  29 | High     | `path-to-regexp` / `GHSA-j3q9-mxjg-w52f`       | `api → express/router`                         | 8.4.2           | runtime routing                                         | Nest patch + scoped router resolution — fixed                                            |
|  30 | Moderate | `path-to-regexp` / `GHSA-27v5-c462-wpq7`       | тот же                                         | 8.4.2           | runtime routing                                         | То же — fixed                                                                            |
|  31 | High     | `playwright` / `GHSA-7mvr-c777-76hp`           | `web → @playwright/test → playwright`          | 1.55.1          | tooling/acceptance                                      | Patch; mandatory acceptance retries disabled — fixed                                     |
|  32 | High     | `sharp` / `GHSA-rgj7-g3m4-5g8c`                | `web → next → sharp`                           | 0.35.5          | runtime Next image dependency                           | Next patch resolved safe Sharp — fixed                                                   |
|  33 | High     | `sharp` / `GHSA-wq5f-xc86-pv6w`                | тот же                                         | 0.35.5          | runtime Next image dependency                           | То же — fixed                                                                            |
|  34 | High     | `source-map-js` / `GHSA-68fv-2mgg-jv7q`        | `web/api tooling → postcss → source-map-js`    | 1.2.2           | build/runtime CSS processing                            | Scoped compatible resolution — fixed                                                     |
|  35 | Moderate | `@nestjs/core` / `GHSA-36xv-jgw5-4q75`         | `api → @nestjs/core`                           | 11.1.18         | runtime                                                 | Все связанные Nest-пакеты обновлены согласованно — fixed                                 |
|  36 | Moderate | `decode-uri-component` / `GHSA-vcc3-ghjq-m6fr` | `api → minio → query-string`                   | 0.5.0           | bounded MinIO query encoding                            | Scoped query-string resolution; MinIO verification требуется в CI — fixed                |
|  37 | Moderate | `file-type` / `GHSA-5v7r-6r5c-r473`            | `api → @nestjs/common → file-type`             | 21.3.4          | transitive runtime                                      | Nest patch — fixed                                                                       |
|  38 | Moderate | `file-type` / `GHSA-j47w-4g3g-c36v`            | тот же                                         | 21.3.4          | transitive runtime                                      | Nest patch — fixed                                                                       |
|  39 | Moderate | `qs` / `GHSA-4mjr-xmp4-gh2g`                   | `api → express/body-parser → qs`               | 6.16.0          | runtime request parsing                                 | Scoped Express/body-parser resolution — fixed                                            |
|  40 | Moderate | `qs` / `GHSA-x5fp-wj9c-mxmx`                   | тот же                                         | 6.16.0          | runtime request parsing                                 | То же — fixed                                                                            |
|  41 | Moderate | `stream-json` / `GHSA-528h-pc64-c93x`          | `api → minio → stream-json`                    | 1.9.1           | bounded: MinIO bucket-notification parser is not called | Upstream blocked; monitor/upgrade MinIO SDK, no unsafe major override                    |
|  42 | Moderate | `stream-json` / `GHSA-hqr4-qq8f-hg3x`          | тот же                                         | 1.9.1           | bounded: notification JSONC parser is not called        | Upstream blocked; same disposition                                                       |
|  43 | Moderate | `stream-json` / `GHSA-mjw6-4jj6-33hc`          | тот же                                         | 1.9.1           | bounded: notification assembler is not called           | Upstream blocked; same disposition                                                       |

### Дополнительный toolchain remediation

| Компонент                  | Было                    | Стало                 | Результат                                                     |
| -------------------------- | ----------------------- | --------------------- | ------------------------------------------------------------- |
| Vitest / Tinypool          | 3.2.4 / vulnerable path | 4.1.11 / patched path | 3 Critical устранены; 59 API, 16 web и 2 agent tests проходят |
| Nest CLI                   | 11.0.10                 | 11.0.24               | Обновлены Glob, Webpack и Angular Devkit paths                |
| ESLint / TypeScript ESLint | 9.34.0 / 8.41.0         | 9.39.5 / 8.71.1       | Patched parser/glob dependency tree                           |
| Turbo                      | 2.5.6                   | 2.11.7                | Moderate/Low advisories устранены                             |
| Supertest                  | 7.1.4                   | 7.3.1                 | Dev request parser обновлён; `qs` закреплён на 6.16.0         |
| `braces`                   | 3.0.3                   | 3.0.3                 | No patched release; bounded explicit non-runtime exception    |

## 3. Изменения и security invariants

- Next.js `16.3.8`, Playwright `1.55.1`, aligned Nest `11.1.18`, Swagger
  `11.4.7`, Prisma `6.19.3`, `image-size` `2.0.4`.
- Узкие resolutions находятся в `pnpm-workspace.yaml`; каждый имеет конкретную
  advisory-причину и проверяемую итоговую версию. Глобального force-update нет.
- API при запуске явно устанавливает Express `trust proxy=false`. Заголовки
  `X-Forwarded-*` не становятся источником доверенного client IP.
- Upload остаётся raw-stream pipeline с ограничением размера до накопления
  тела; разрешены только PDF, DOCX, JPEG и PNG, сохраняются MIME/signature,
  PDF page, decoded pixel, DOCX archive/path и quarantine/AV проверки.
- Добавлены tests для malformed JPEG/PNG, oversized decoded image, request size
  и fail-closed proxy policy. Существующие CSRF, Origin, auth, RBAC, ownership,
  OTP TTL/attempt/replay, upload quota и redaction tests не отключались.
- `pnpm security:audit` входит в `pnpm run ci` и отдельный quality step GitHub
  Actions; новые production Critical/High блокируют pipeline.
- Playwright config и Stage 11–13 scripts используют zero retries. Ошибка
  acceptance-теста не скрывается повторной попыткой.

## 4. Commits

- `ae1b56d` — baseline независимого аудита и remediation matrix;
- `feaffa2` — Next.js/Playwright security patches;
- `3dab32a` — API/Nest/Prisma/upload/transitive security patches;
- `4b95f3d` — mandatory security gate и security regressions.
- `a33146b` — dev-toolchain Critical/High remediation и full-tree audit policy.

## 5. Локальная проверка

На remediation tree успешно выполнены:

- `pnpm install --frozen-lockfile`;
- `pnpm security:audit` — 0 applicable Critical/High, exit code 0; одна
  ограниченная и явно выводимая dev-only advisory без patched release;
- `pnpm run ci`: format, lint, typecheck, tests, Prisma validate, production
  build;
- tests: API 59 passed, web 16 passed, printer-agent 2 passed;
- отдельные security tests: 7/7 passed;
- Prisma Client generate `6.19.3` и schema validate;
- Next production build (27 routes) и Nest production build.

Docker executable отсутствует в локальном Windows workspace. Поэтому
PostgreSQL clean/repeated migrations, Redis/BullMQ, MinIO, ClamAV/processing,
Stage 1–15 DB/browser regression и backup/restore должны быть доказаны branch
CI, а не помечены локально успешными.

## 6. CI, residual risk и merge policy

Полная проверка ветки доступна на
[GitHub Actions](https://github.com/agata-flowers/agat-print/actions/workflows/ci.yml?query=branch%3Acodex%2Fsecurity-remediation-stage15).
Итоговый run ID и точный SHA фиксируются после завершения branch pipeline.

Оставшиеся риски:

1. Три Moderate `stream-json` advisory находятся в неиспользуемом MinIO
   notification API. Требуется upstream-совместимый MinIO SDK; подмена ESM
   major через override способна сломать CJS runtime и поэтому запрещена.
2. Реальные OTP/SMS, acquiring/payment, fiscal и maps credentials/contracts
   отсутствуют; production остаётся fail-closed, реальная интеграция внешне
   заблокирована.
3. Реальный off-host backup backend и production secret store не могут быть
   доказаны ephemeral CI; CI проверяет шифрованный backup/isolated restore на
   синтетических данных.

Ветка не должна merge-иться в `main` без отдельного разрешения владельца.
Stage 16 в remediation не входит.
