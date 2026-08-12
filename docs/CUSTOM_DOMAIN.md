# kubespade.com — GitHub Pages + Cloudflare Registrar

Перенос того, что уже есть в репо (`privacy.html`, `terms.html`, `legal.css`, `README`) с  
`https://kubespade.github.io/kubespade/` на **`https://kubespade.com`**.

GitHub по-прежнему **хостит** файлы (бесплатно). Cloudflare — только **DNS** (домен ты уже купил там).

---

## Что получится

| Было | Станет |
|------|--------|
| `https://kubespade.github.io/kubespade/privacy.html` | `https://kubespade.com/privacy.html` |
| `https://kubespade.github.io/kubespade/terms.html` | `https://kubespade.com/terms.html` |
| `https://kubespade.github.io/kubespade/` | `https://kubespade.com/` (нужен `index.html`, см. шаг 6) |

Старый `github.io` URL после привязки домена обычно **редиректит** на custom domain (GitHub делает сам).

---

## Предусловия

- [ ] Репо **https://github.com/kubespade/kubespade** — public
- [ ] Домен **kubespade.com** в Cloudflare Registrar (Active)
- [ ] Доступ к GitHub org **kubespade** (Settings → Pages)

---

## Шаг 1 — GitHub Pages (если ещё не включены)

1. Открой **https://github.com/kubespade/kubespade/settings/pages**
2. **Build and deployment → Source:** Deploy from a branch
3. **Branch:** `main` → folder **`/ (root)`** → Save
4. Подожди 1–3 мин, проверь что работает:
   - https://kubespade.github.io/kubespade/privacy.html
   - https://kubespade.github.io/kubespade/terms.html

Если 404 — убедись что `privacy.html` / `terms.html` в **корне** ветки `main`.

---

## Шаг 2 — Custom domain в GitHub

1. На той же странице **Settings → Pages → Custom domain**
2. Введи: **`kubespade.com`** → Save
3. GitHub предложит создать файл **`CNAME`** в репо — согласись (или добавь вручную, см. шаг 3)
4. Опционально добавь **`www.kubespade.com`** (GitHub → Pages → Add domain) — удобно для пользователей

Не включай **Enforce HTTPS** пока DNS не станет зелёным (шаг 5).

---

## Шаг 3 — Файл `CNAME` в репо

В корне репо должен быть файл **`CNAME`** (одна строка, без `https://`):

```
kubespade.com
```

Если используешь только `www` как основной — тогда `www.kubespade.com`.  
Рекомендация: **apex** `kubespade.com` в CNAME + DNS для `www` → тот же сайт.

```bash
cd kubespade   # локальный clone
echo 'kubespade.com' > CNAME
git add CNAME
git commit -m "Add CNAME for kubespade.com"
git push origin main
```

---

## Шаг 4 — DNS в Cloudflare

Cloudflare Dashboard → **kubespade.com** → **DNS** → **Records**.

### Важно: прокси выключить

Для записей на GitHub Pages ставь **DNS only** (серое облако ☁️, не оранжевое).  
Иначе часто ломается выпуск HTTPS на стороне GitHub.

### Вариант A — apex + www (рекомендуется)

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| **CNAME** | `@` | `kubespade.github.io` | DNS only |
| **CNAME** | `www` | `kubespade.github.io` | DNS only |

Cloudflare умеет **CNAME flattening** на apex (`@`) — это нормально.

### Вариант B — только apex через A-записи

Если CNAME на `@` не даёт сохранить, используй **A** (актуальный список — в [доках GitHub](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site#configuring-an-apex-domain)):

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| A | `@` | `185.199.108.153` | DNS only |
| A | `@` | `185.199.109.153` | DNS only |
| A | `@` | `185.199.110.153` | DNS only |
| A | `@` | `185.199.111.153` | DNS only |
| CNAME | `www` | `kubespade.github.io` | DNS only |

### Удалить лишнее

Убери старые **A/CNAME** на parking / placeholder, если Cloudflare добавил их при покупке.

---

## Шаг 5 — Дождаться DNS и HTTPS

1. GitHub → **Settings → Pages** — статус домена должен стать **DNS check successful**
2. Включи **Enforce HTTPS** (галочка появится когда сертификат готов)
3. Проверка с Mac:

```bash
dig kubespade.com +short
dig www.kubespade.com +short

curl -I https://kubespade.com/privacy.html
curl -I https://kubespade.com/terms.html
```

Ожидай **200** и редирект `http://` → `https://`.

Типичное время: **10 мин – 24 ч** (чаще < 1 ч).

---

## Шаг 6 — Главная страница (опционально, но лучше сразу)

Сейчас в корне нет `index.html` — на `https://kubespade.com/` может быть 404.

Минимальный **`index.html`** (можно заменить полноценным лендингом позже):

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>KubeSpade</title>
  <link rel="stylesheet" href="legal.css" />
</head>
<body>
  <main class="legal-doc">
    <h1>KubeSpade</h1>
    <p>Kubernetes client for macOS, Windows, Linux, and iPad.</p>
    <ul>
      <li><a href="privacy.html">Privacy Policy</a></li>
      <li><a href="terms.html">Terms of Use</a></li>
      <li><a href="https://github.com/kubespade/kubespade/issues">Support &amp; bugs</a></li>
    </ul>
  </main>
</body>
</html>
```

---

## Шаг 7 — Обновить ссылки в проекте

После того как `https://kubespade.com/privacy.html` открывается в браузере:

| Файл | Поле |
|------|------|
| `kubespade-ios/src/lib/billingConfig.ts` | `LEGAL_URLS.privacy`, `LEGAL_URLS.terms` |
| `kubespade-ios/docs/APP_STORE.md` | Privacy / Terms URLs для App Store Connect |
| `kubespade/README.md` | таблица Legal |
| `kubespade/.github/ISSUE_TEMPLATE/config.yml` | contact links |

Новые значения:

```
https://kubespade.com/privacy.html
https://kubespade.com/terms.html
```

В **App Store Connect** (когда будешь submit):

- **Privacy Policy URL:** `https://kubespade.com/privacy.html`
- **Marketing URL** (опционально): `https://kubespade.com`

---

## Шаг 8 — Проверочный чеклист

- [ ] https://kubespade.com/privacy.html — открывается, стили `legal.css`
- [ ] https://kubespade.com/terms.html — открывается
- [ ] https://kubespade.com/ — не 404 (если добавил `index.html`)
- [ ] https://www.kubespade.com/ — работает или редирект на apex
- [ ] Старый URL `github.io/kubespade/...` редиректит на `kubespade.com`
- [ ] **Enforce HTTPS** включён в GitHub Pages
- [ ] Paywall / Settings в iPad app открывают новые legal URLs

---

## Troubleshooting

| Проблема | Решение |
|----------|---------|
| GitHub: «Domain's DNS record could not be verified» | Проверь записи, подожди; proxy Cloudflare = **off** |
| Certificate pending | До 24 ч; DNS only; не включай orange cloud |
| 404 на `/privacy.html` | Pages source = `main` / root; файл в корне репо |
| Mixed content / SSL error | Grey cloud; Enforce HTTPS только после green check |
| `www` не работает | Добавь CNAME `www` + домен в GitHub Pages |

---

## Дальше (не этот шаг)

- Полноценный лендинг (Astro/static) в этом же репо
- Desktop download links → GitHub Releases
- App Store badge когда listing live

См. также обсуждение в чате (Aug 2026): GitHub Pages vs S3+CloudFront — для legal + лендинга достаточно текущей схемы.
