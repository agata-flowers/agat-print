# AGAT PRINT — независимый технический аудит Stage 1–15

Дата аудита: 2026-10-11  
Аудируемая ветка: `main`  
Аудируемый commit: `89637db22fc7e1aca947eac8693a26e10344a6cb`  
Последний CI: [run #95 / 38128026560](https://github.com/agata-flowers/agat-print/actions/runs/38128026560)

## 1. Итог

Функциональная regression-цепочка Stage 1–15 на указанном SHA подтверждена одним
последовательным GitHub Actions run: `quality` и `infrastructure` завершились
успешно, а infrastructure последовательно выполнил gates Stage 2–15. Это не
устраняет обнаруженный во время настоящего аудита блокирующий security gap:

- `pnpm audit --prod --audit-level=low` завершился с кодом `1`;
- обнаружено **43 известных уязвимости**: 2 Critical, 20 High, 19 Moderate и
  2 Low;
- CI сейчас не запускает dependency audit, поэтому зелёный run #95 эти
  уязвимости не обнаруживает;
- среди Critical находятся Next.js RCE (`GHSA-vcvr-r3jv-pc5j`) и
  `proxy-addr` IP spoofing (`GHSA-jqcg-44mw-7w3h`); upload-путь также содержит
  несколько High DoS advisory для Multer 2.0.2.

**Вердикт: Stage 16 пока начинать небезопасно.** Сначала нужен отдельный
dependency/security remediation, затем полный последовательный Stage 1–15 gate
на одном новом SHA. В рамках этого аудита исправления не выполнялись.

## 2. Методика и границы доказательств

Проверено:

1. Через GitHub Actions API изучены все 95 доступных push-run, начиная с #1.
2. Для каждого из 73 failed-run получены jobs, первый failed step и журналы;
   причины сгруппированы только после чтения фактической ошибки.
3. Проверены последующие commits и успешные runs, которые воспроизводят
   соответствующий gate, а не только изменяют его конфигурацию.
4. Проверены workflow, все `ops/verify/stage*.sh`, opt-in переменные DB-E2E,
   Playwright-конфигурация, миграции и изменения тестов в исправляющих commits.
5. Локально выполнены frozen install, Prisma generate/validate, format, lint,
   typecheck, unit/integration tests и production build.
6. Выполнены dependency audit и ограниченный поиск секретов в tracked-файлах.

Ограничения:

- в текущем workspace нет `docker` executable, поэтому Docker/PostgreSQL/
  Redis/MinIO/ClamAV/processing/backup/restore независимо локально не
  воспроизводились; доказательством служат журнал и artifacts финального CI;
- реальные OTP/SMS, acquiring/payment, fiscal и maps providers не проверялись:
  credentials/contracts отсутствуют, а production-конфигурация должна
  fail-closed;
- аудит не является полноценным penetration test, fuzzing campaign или
  нагрузочным тестом production-инфраструктуры;
- настройки branch protection и внешнего secret store не доказаны содержимым
  репозитория и не оценивались как подтверждённые.

## 3. Состояние Git и соответствие CI

| Проверка                 | Результат                                  | Доказательство            |
| ------------------------ | ------------------------------------------ | ------------------------- |
| HEAD                     | `89637db22fc7e1aca947eac8693a26e10344a6cb` | `git rev-parse HEAD`      |
| Ветка                    | `main`                                     | `git status --branch`     |
| `main == origin/main`    | да                                         | divergence `0/0`          |
| Рабочее дерево до отчёта | clean                                      | `git status --short` пуст |
| SHA run #95              | совпадает с HEAD                           | metadata run #95          |
| `quality`                | success                                    | job `114436350484`        |
| `infrastructure`         | success                                    | job `114436875137`        |

Создание данного файла является единственным изменением рабочего дерева,
сделанным аудитом. Production/domain/test/CI код не менялся.

## 4. Полная сводка GitHub Actions

Всего доступно 95 запусков:

- success — 21;
- failure — 73;
- cancelled — 1.

Run numbers по итоговому статусу:

- **success:** 7, 8, 20, 23, 26, 29, 30, 31, 35, 38, 42, 46, 60, 61,
  66, 67, 78, 79, 81, 88, 95;
- **failure:** 1–6, 9–19, 21–22, 24–25, 27–28, 32–34, 37, 39–41,
  43–45, 47–59, 62–65, 68–77, 80, 82–87, 89–94;
- **cancelled:** [#36](https://github.com/agata-flowers/agat-print/actions/runs/33778622676),
  superseded subsequent runs; его результат не используется как доказательство.

### 4.1 Кластеры исторических ошибок

| Runs                                                                                | Категория                           | Фактическая первопричина                                                                                                             | Исправление/доказательство                                                                             | Статус                                                  |
| ----------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| [#1](https://github.com/agata-flowers/agat-print/actions/runs/32993522587)          | CI/quality                          | Prettier failure                                                                                                                     | Последующий format gate и #7/#8                                                                        | Исправлено                                              |
| [#2–3](https://github.com/agata-flowers/agat-print/actions/runs/33090198660)        | DB/auth                             | Foundation E2E возвращал 500 из-за неинициализированного DB test environment                                                         | `ff65842`; foundation tests в #95                                                                      | Исправлено                                              |
| [#4–6](https://github.com/agata-flowers/agat-print/actions/runs/33091142452)        | CI/infra                            | Nest DI, container health и web bind/restore integrity failures                                                                      | commits `2a4884f`, `db1939e`; Stage 2 в #95                                                            | Исправлено                                              |
| #9–13                                                                               | CI/tooling                          | format failures и pnpm ignored native build policy                                                                                   | policy/lockfile/format commits; frozen install #95                                                     | Исправлено                                              |
| [#14–19](https://github.com/agata-flowers/agat-print/actions/runs/33183173251)      | File pipeline/infra                 | Stage 3 command assembly, EICAR/extension fixture, quota isolation, volume ownership/mode и missing artifact                         | commits `6b48ab0`…; Stage 3 6/6 в #95                                                                  | Исправлено                                              |
| #21–22                                                                              | Backend/DI                          | Stage 4 tests/processing environment provider                                                                                        | `9df6298` follow-up; Stage 4 6/6 #95                                                                   | Исправлено                                              |
| #24–25                                                                              | Commerce/security fixture           | Stage 5 E2E/CSRF session rotation                                                                                                    | `7f83183`; Stage 5 7/7 #95                                                                             | Исправлено                                              |
| #27–28                                                                              | Concurrency/business                | Stage 6 offer accept serialization race returned 500                                                                                 | retry/idempotent recovery; Stage 6 3/3 #95                                                             | Исправлено, recurring class monitored                   |
| [#32](https://github.com/agata-flowers/agat-print/actions/runs/33513933466)         | Supply chain/CI                     | Corrupt lockfile (NUL byte)                                                                                                          | intact lockfile commit; frozen install #95                                                             | Исправлено                                              |
| #33–34                                                                              | Fulfillment/business                | empty courier assignment serialized as `{}` instead of explicit null; Stage 7 gate                                                   | `300c04d`; Stage 7 4 passed/9 intentionally deferred                                                   | Исправлено                                              |
| #37, #39                                                                            | Backup/retention                    | Stage 2 cleanup failed when tombstoned object was already absent                                                                     | idempotent deletion `86a89d1`; Stage 2 restore #95                                                     | Исправлено                                              |
| #40–41                                                                              | Finance/concurrency                 | settlement/refund serializable conflicts and advisory-lock result handling                                                           | Stage 9 fixes; Stage 9 20/20 + 10 config tests #95                                                     | Исправлено, recurring class monitored                   |
| #43–45                                                                              | Partner network                     | foundation env, missing runtime provider, idempotency scope/capacity race                                                            | Stage 10 fixes through `21871dc`; 3/3 #95                                                              | Исправлено                                              |
| [#47–56](https://github.com/agata-flowers/agat-print/actions/runs/34256242988)      | Ordering/concurrency/test isolation | repeated Stage 9 fixture conflicts; Stage 11 stale shared fixtures; concurrent checkout surfaced raw 500 instead of bounded conflict | immutable fixture payloads, scoped IDs, serializable classification; Stage 9 and Stage 11 #95          | Исправлено, high-value regression retained              |
| #57–60                                                                              | Browser/CI                          | Stage 11 selector ambiguity and insufficient safe diagnostics                                                                        | selector fix and bounded diagnostics; Stage 11 DB 4/4/browser 1/1 #95                                  | Исправлено                                              |
| #62–66                                                                              | Browser/infra/concurrency           | Playwright apt conflict, Stage 12 fixture/filters, earlier Stage 8 serializable conflict                                             | isolated apt/source and fixtures, allow-list filters, retry classification; Stage 12 #95               | Исправлено                                              |
| [#68–73](https://github.com/agata-flowers/agat-print/actions/runs/34592978413)      | Stage 13 business/browser           | raw PostgreSQL `40001`, JSON wire ordering assertions, stale UI transition/selector                                                  | production serialization retry plus structural assertion and authoritative UI transition; Stage 13 #95 | Исправлено                                              |
| [#72, #74–75](https://github.com/agata-flowers/agat-print/actions/runs/34705284998) | External registry/infra             | Docker Hub MinIO image denied/unavailable                                                                                            | pinned verified Quay OCI release/build; Stage 2 and all later gates #95                                | Исправлено; registry availability remains external risk |
| #76–77                                                                              | Finance/browser                     | settlement payload/idempotency conflict and Stage 13 browser state mismatch                                                          | immutable payload + browser contract fixes; #78/#79 and #95                                            | Исправлено                                              |
| [#80](https://github.com/agata-flowers/agat-print/actions/runs/37295320599)         | Registry/infra                      | unauthorized backup MinIO image                                                                                                      | deterministic pinned MinIO build; #81/#95                                                              | Исправлено                                              |
| #82                                                                                 | Quality                             | lint: unnecessary type assertion                                                                                                     | `e3e0bf9`; quality #88/#95                                                                             | Исправлено                                              |
| #83                                                                                 | Fulfillment/concurrency             | reprint serializable conflict returned 500                                                                                           | `26390ba`; Stage 7/8/9 #95                                                                             | Исправлено, recurring class monitored                   |
| #84–85                                                                              | Browser/test isolation              | Stage 14 shared fixtures caused RU/UZ timeout                                                                                        | isolated browser fixture `39c9ff2`; Stage 14 browser 2/2 #95                                           | Исправлено                                              |
| #86                                                                                 | Security/config probe               | fail-closed probe attempted approval without creating required synthetic payment                                                     | isolated deterministic fixture; real approval path retained; #88/#95                                   | Исправлено                                              |
| #87                                                                                 | Deployment policy                   | production policy read from wrong path in image                                                                                      | `50d75e2`; #88/#95                                                                                     | Исправлено                                              |
| #89                                                                                 | Legacy regression/concurrency       | Stage 8 reprint hit PostgreSQL serialization conflict                                                                                | fulfillment retry logic; Stage 8/9 #95                                                                 | Исправлено, recurring class monitored                   |
| #90                                                                                 | Stage 15 schema                     | `OrderDraft_locale_check` omitted `en`                                                                                               | forward migration change `8ad333a`; Stage 15 6/6/browser 3/3 #95                                       | Исправлено                                              |
| #91–92                                                                              | Stage 15 concurrency/business       | advisory basket lock result lifetime and item production idempotency scope                                                           | `81606d4`, `535161b`; Stage 15 #95                                                                     | Исправлено                                              |
| #93                                                                                 | Browser fixture                     | Stage 12 UZ discovery reused mutable workload fixture                                                                                | independent moderated fixture `70cecef`; Stage 12 #95                                                  | Исправлено                                              |
| #94                                                                                 | Stage 15 test/lineage               | unordered Prisma relation assertion plus invalid nested lookup in second scenario                                                    | deterministic relation ordering `89637db`; exact final SHA #95                                         | Исправлено                                              |

### 4.2 Повторяющиеся классы

1. **PostgreSQL Serializable (`40001`) / deadlock conflicts.** Проявлялись в
   matching, checkout, fulfillment/reprint и finance. В соответствующих
   production services добавлена bounded retry/classification логика, а final
   gates проходят concurrency cases. Риск не нулевой: тесты в основном создают
   два конкурирующих запроса, а не длительную production-нагрузку.
2. **Shared mutable E2E fixtures.** Повторялись в Stage 11–15 browser/DB gates.
   Исправления изолировали fixtures; финальный run прошёл без retry-сигнатур.
3. **MinIO image/registry availability.** Docker Hub failures устранены pinned
   Quay/build-путём. Это CI-риск, не business defect.
4. **Недостаточная ранняя диагностика.** В ранних runs artifacts отсутствовали
   после падения. `if: always()` и предварительные diagnostic reports теперь
   присутствуют; обязательный step всё равно возвращает исходный non-zero code.

## 5. Финальная regression-цепочка Stage 1–15

Run #95 выполнил gates строго последовательно. Если ранний stage падает,
последующие executable steps не выполняются; artifact upload с `if: always()`
не превращает failure в success.

| Gate                                         | Финальный результат                                            |
| -------------------------------------------- | -------------------------------------------------------------- |
| Frozen install, Prisma generate/validate     | success                                                        |
| Format/lint/typecheck/unit/integration/build | success                                                        |
| Docker Compose config + API/Web image builds | success                                                        |
| Stage 2 recovery                             | success; reported RPO 12s, RTO 4s                              |
| Stage 3 upload/processing                    | 6/6                                                            |
| Stage 4 preflight/layout                     | 6/6                                                            |
| Stage 5 pricing/payment/refund               | 7/7                                                            |
| Stage 6 matching/manual production           | 3/3                                                            |
| Stage 7 fulfillment                          | 4 passed, 9 later-stage cases intentionally deferred           |
| Stage 8 aftercare                            | 13 passed, 7 Stage 9 cases intentionally deferred              |
| Stage 9 finance/config                       | 20/20 DB scenarios + 10/10 config tests                        |
| Stage 10 partner network                     | 3/3 DB + 3/3 policy                                            |
| Stage 11 ordering                            | 4/4 DB + 1/1 Playwright                                        |
| Stage 12 marketplace                         | 4/4 DB + 2/2 Playwright                                        |
| Stage 13 fulfillment commitment              | 5/5 DB + 2/2 Playwright                                        |
| Stage 14 purchase flow                       | 7/7 DB + 2/2 Playwright                                        |
| Stage 15 basket                              | 6/6 DB + 3/3 Playwright, `--retries=0`                         |
| Backup/isolated restore                      | success in stage scripts; Stage 15 multi-item lineage restored |

Все 14 artifacts Stage 2–15 существуют и принадлежат SHA `89637db...`.
Stage 15 artifact:

- artifact id `11698676298`;
- archive digest
  `sha256:b3090a56fee0661cbe049ada565a67a4dd2a82bb7934f56feb60e577ba113f3f`;
- report фиксирует DB/browser passed, locales `uz/ru/en`, browser retries `0`,
  backup/restore и multi-item lineage passed, RPO 6s и RTO 5s.

Важно: CI-значение RPO является интервалом между началом synthetic backup и
restore drill, а не измерением реальной давности последней production-копии.
Оно доказывает механику drill, но не соблюдение production backup schedule.

## 6. Проверка отключённых/ослабленных тестов

### Подтверждено

- В workflow нет `continue-on-error` у обязательных gates.
- `set +e` используется для захвата exit status и записи диагностики; после
  этого workflow делает `exit "$status"`.
- `|| true` в verification scripts относится к cleanup/diagnostic collection,
  а не к acceptance assertions.
- DB-E2E используют `describe.skipIf(!enabled)`, но каждый suite запускается
  своим stage script с соответствующим `RUN_STAGE*_E2E=1`.
- Nested Stage 7/8/9 suites намеренно раскрываются поэтапно: 4/9 skipped,
  затем 13/7 skipped, затем 20/0 skipped. Это подтверждено логом #95.
- Stage 15 Playwright запускается с `--retries=0`; Stage 14 config также
  принудительно задаёт zero retry.
- Исследованные test-fix commits не удаляют assertions: JSON сравнение стало
  структурным, Prisma relation получила явный deterministic `orderBy`, shared
  fixture заменён независимым.

### Оставшиеся слабые места

- Stage 11–13 Playwright используют глобальный `CI ? 1 : 0` retry. В run #95
  признаков фактического retry нет, однако будущий первый failed attempt может
  быть скрыт успешным retry.
- `@agat/contracts` и `@agat/providers` запускают Vitest с
  `--passWithNoTests`; собственных test files у пакетов нет. Их часть поведения
  косвенно покрыта API tests, но отсутствие тестов пакета не ломает CI.
- Нет coverage threshold и публикации coverage. Зелёный gate подтверждает
  заявленные scenarios, но не полноту покрытия.
- Dependency audit/SBOM/container vulnerability scan отсутствуют в CI — именно
  поэтому текущие Critical/High advisory не повлияли на #95.

## 7. Актуальные проблемы и риски

| ID      | Приоритет        | Категория           | Проблема                                                                                                                                                 | Доказательство                                      | Статус                                                           |
| ------- | ---------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------- |
| SEC-01  | **Critical**     | Security/dependency | Next.js 16.3.3 попадает под RCE `GHSA-vcvr-r3jv-pc5j`; исправление >=16.3.6, но для совокупности Next advisories нужен >=16.3.8                          | `pnpm audit --prod`                                 | Открыто                                                          |
| SEC-02  | **Critical**     | Security/dependency | `proxy-addr` 2.0.7 IP spoofing; patched >=2.0.8                                                                                                          | `pnpm audit --prod`                                 | Открыто; reachability требует проверки proxy deployment          |
| SEC-03  | **High**         | Upload/security     | Multer 2.0.2 имеет несколько DoS/resource-exhaustion advisories; patched совокупно >=2.3.0                                                               | production dependency path Nest/Express upload      | Открыто                                                          |
| SEC-04  | **High**         | File processing     | `image-size` 2.0.2 infinite-loop DoS, patched >=2.0.3; вход — пользовательские изображения                                                               | `GHSA-5p2g-fcmc-qvqq`, `GHSA-w3rx-r6r6-pgpr`        | Открыто                                                          |
| SEC-05  | **High**         | Dependencies        | Остальные High: path-to-regexp, lodash, js-yaml, sharp, source-map-js, Prisma optional chain и др.                                                       | audit: всего 20 High                                | Открыто; нужна reachability/upgrade matrix                       |
| CI-01   | **High**         | CI/security         | Нет обязательного SCA/dependency-audit gate                                                                                                              | `.github/workflows/ci.yml`                          | Открыто                                                          |
| CI-02   | Medium           | Test reliability    | Stage 11–13 browser gates допускают 1 retry                                                                                                              | `apps/web/playwright.config.ts`                     | Открыто                                                          |
| TEST-01 | Medium           | Test completeness   | Нет coverage thresholds; два shared package suite проходят без тестов                                                                                    | Turbo/Vitest output                                 | Открыто                                                          |
| OPS-01  | High             | Recovery assurance  | CI имитирует off-host S3 отдельным service/container на том же ephemeral runner; реальный внешний encrypted repository и независимый restore не доказаны | Compose verification design                         | Внешне не подтверждено                                           |
| OPS-02  | Medium           | RPO semantics       | CI RPO — длительность synthetic drill, не возраст последней production backup                                                                            | stage scripts                                       | Открыто как операционная метрика                                 |
| OPS-03  | Medium           | CI reproducibility  | `ubuntu-latest` и GitHub Actions `@v4` не pinned по runner image/commit SHA                                                                              | workflow                                            | Открыто                                                          |
| CONC-01 | Medium           | Concurrency         | Исторически повторялись `40001`; текущие bounded two-request tests проходят, но soak/load test отсутствует                                               | runs #27, #40–41, #52, #55, #58, #64, #68, #83, #89 | Потенциальный остаточный риск                                    |
| EXT-01  | External blocker | Providers           | Real OTP/SMS, acquiring/payment и fiscal integrations не проверены реальными contracts/credentials                                                       | Stage 9 provider boundaries/fail-closed tests       | Реализация boundary подтверждена; production integration blocked |
| EXT-02  | External blocker | Geo/delivery        | Реальный maps/geocoding/courier provider отсутствует; deterministic internal model покрывает MVP                                                         | approved architecture                               | Не дефект текущего MVP; внешний blocker                          |

Дополнительный dependency-audit итог: 43 findings / 295 production+optional
dependencies. Некоторые advisory могут оказаться недостижимыми в текущем коде
(например, `next/og` явно не импортируется), но отсутствие доказанной
reachability не делает уязвимую версию исправленной.

Ограниченный secret scan не нашёл private-key/GitHub/AWS/Slack token markers.
Найденные PostgreSQL URL находятся только в `.env.example`, CI, test/verify и
Compose-файлах и используют явно synthetic/development credentials.

## 8. Подтверждение этапов

### Подтверждены в synthetic/CI среде

- Stage 1–8: auth/RBAC, upload/quarantine/AV, processing isolation,
  preflight/layout, commerce, matching, fulfillment, disputes/reprint/
  retention — финальная последовательная regression зелёная.
- Stage 10–15: partner network, customer ordering, marketplace/preference,
  fulfillment pricing, purchase flow, multi-item basket, RU/UZ/EN UI — DB и
  browser gates зелёные на одном SHA.
- Stage 9 core finance records, raw webhook validation, replay/idempotency,
  ledger/settlement/reconciliation и fail-closed configuration — synthetic
  provider tests зелёные.

### Требуют повторной проверки после исправлений

- **Все Stage 1–15** — после dependency upgrades необходим полный regression,
  потому что обновления Next/Nest/Express/Multer/image parsing затрагивают web,
  auth/routing и file-upload boundaries.
- Stage 11–13 browser acceptance желательно повторить с `retries=0`.
- Backup/restore — на реально отдельном S3-compatible endpoint и отдельном
  restore host/environment.
- Concurrency — нагрузочный/soak сценарий для checkout, matching, fulfillment,
  reprint, settlement/refund.

### Невозможно подтвердить без внешних сервисов

- delivery настоящего SMS OTP;
- реальные acquiring create/confirm/status/webhook/refund;
- реальная фискализация и provider reconciliation;
- внешний maps/geocoding/courier provider;
- фактические production backup schedule, encryption key custody, RPO/RTO и
  ежемесячный restore, пока нет доступа к production/off-host системам.

## 9. План исправлений — только после подтверждения пользователя

### Critical

1. Обновить Next.js минимум до версии, закрывающей весь текущий набор advisory
   (на дату аудита >=16.3.8), пересобрать web image и проверить cache/no-store,
   PWA, RU/UZ/EN browser flows.
2. Обновить Nest/Express dependency tree так, чтобы `proxy-addr >=2.0.8` и
   `multer >=2.3.0`; повторить auth rate-limit/proxy tests и все file upload
   negative cases.

### High

3. Обновить `image-size >=2.0.3` и остальные достижимые High dependencies;
   выполнить crafted-file/DoS regression и processing resource-limit tests.
4. Добавить fail-closed CI SCA gate (`pnpm audit --prod` или эквивалент) с
   versioned exception file, owner, expiry и запретом бессрочных suppressions.
5. Добавить SBOM и container image scan для API/Web/processing/backup/restore.
6. Провести реальный off-host encrypted backup и isolated restore drill;
   измерять backup age/data-loss window отдельно от restore duration.

### Medium

7. Установить `retries=0` для acceptance Playwright Stage 11–13 либо сохранять
   first-attempt failure как обязательный failed gate.
8. Добавить coverage thresholds по критичным модулям и собственные tests для
   `@agat/contracts`/`@agat/providers`; убрать `passWithNoTests` там, где пакет
   содержит production contract logic.
9. Добавить concurrency soak/load suite и fault injection для PostgreSQL
   `40001`, Redis redelivery и provider timeout/replay.
10. Pin GitHub Actions на commit SHA и runner image на контролируемую версию.

### Low

11. Устранить шум `locale: not found`/LibreOffice `javaldx` в CI logs, чтобы
    реальные ошибки не терялись в диагностике.
12. Автоматизировать run-history summary и проверку digest всех artifacts.

## 10. Решение о Stage 16

**Нет, безопасно начинать Stage 16 сейчас нельзя.** Причина — подтверждённые
Critical/High production dependency vulnerabilities и отсутствие CI gate,
который предотвращает их повторное появление. Исторические functional/CI
дефекты, приведшие к runs #1–94, в основном подтверждённо устранены run #95;
они не выглядят скрытыми отключением соответствующих stage suites. Однако
зелёный CI не является достаточным security release signal до выполнения
Critical/High плана выше.

Stage 16 не проектировался и не реализовывался.
