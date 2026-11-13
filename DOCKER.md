# Running DnsConf UI with Docker

A complete, copy-paste guide. No Node.js, no npm, nothing else to install — only Docker.

> **Нужна инструкция на русском?** Она ниже: [Запуск на русском](#запуск-на-русском).

---

## Step 1 — install Docker

Download and install **Docker Desktop**: <https://www.docker.com/products/docker-desktop/>

Start it and wait until it reports that the engine is **running** (the whale icon
in the system tray / menu bar stops animating). Docker Desktop must stay open
while you use the app.

## Step 2 — a GitHub Client ID (optional, skip it the first time)

The app signs you in through GitHub Device Flow, and it already ships with the
Client ID of this project's own OAuth App — so there is **nothing to do here**.

Two things are worth knowing about that shared app:

- GitHub's authorization screen shows the **project owner's name**, not an app of yours.
- GitHub allows **50 verification-code submissions per hour per app**, shared by
  everyone using it. Under load, sign-in can fail for a while; retry later, or
  switch to your own app as described below.

Your GitHub token is unaffected either way: it stays in the browser tab and is
never sent to or stored by this app.

To use your own OAuth App instead — a one-time, one-minute setup:

1. open <https://github.com/settings/developers> → **OAuth Apps** → **New OAuth App**
2. fill in anything you like, e.g.
   - *Application name:* `DnsConf UI`
   - *Homepage URL:* `http://localhost:3000`
   - *Authorization callback URL:* `http://localhost:3000`
3. click **Register application**
4. on the app page tick **Enable Device Flow** and press **Update application**
5. copy the **Client ID** (it looks like `Ov23li...`)

The Client ID is not a secret — it is meant to be visible in the browser.
Do **not** create a client secret; this app never uses one.

Put it into `.env` as shown in Step 3, and remember to rebuild afterwards.

## Step 3 — start the app

### The easy way

| Your system | What to do |
|---|---|
| **Windows** | double-click **`docker-start.cmd`** |
| **macOS / Linux** | run **`./docker-start.sh`** in a terminal |

The script checks that Docker is running, creates the `.env` file for you, then
builds and starts everything. It asks nothing.

### The manual way

From the folder that contains `docker-compose.yml`:

```bash
docker compose up --build
```

No `.env` file is required. If you did Step 2 and have a Client ID of your own,
create one and paste the ID into it before building:

```bash
cp .env.example .env     # on Windows: copy .env.example .env
```

```ini
NEXT_PUBLIC_GITHUB_CLIENT_ID=Ov23liYourClientIdHere
```

The first build takes a few minutes (it downloads Node.js and compiles the app).
Later starts take a couple of seconds.

## Step 4 — open the app

<http://localhost:3000>

That's it.

---

## Everyday commands

Run these from the project folder.

Start (and rebuild if anything changed):

```bash
docker compose up --build -d
```

Stop and remove the container:

```bash
docker compose down
```

Watch the logs:

```bash
docker compose logs -f
```

Check that it is alive:

```bash
docker compose ps
```

Update to a newer version of the code:

```bash
git pull
docker compose up --build -d
```

---

## Changing the configuration

Everything lives in `.env`:

| Variable | Required | Meaning |
|---|---|---|
| `NEXT_PUBLIC_GITHUB_CLIENT_ID` | no | Client ID of your own GitHub OAuth App (Device Flow enabled); empty means the project's shared app |
| `HOST_PORT` | no | port on your machine; default `3000` |

**After editing `.env`, always restart with `--build`:**

```bash
docker compose up --build -d
```

The Client ID is compiled into the browser bundle by Next.js, so a plain restart
without `--build` would keep serving the previous value.

### Port 3000 is already taken

Set another port in `.env`:

```ini
HOST_PORT=8080
```

then `docker compose up --build -d` and open <http://localhost:8080>.

---

## Troubleshooting

**Sign-in keeps failing with a rate-limit or "too many codes" error**
GitHub allows 50 verification-code submissions per hour per OAuth App, and the
app shipped with this project is shared by all of its users. Retry later, or do
Step 2 and use your own Client ID.

**`Cannot connect to the Docker daemon` / `error during connect`**
Docker Desktop is not running. Start it, wait until it says *running*, try again.

**`port is already allocated` / `address already in use`**
Something else occupies the port. Set a different `HOST_PORT` in `.env` (see above).

**The page asks for a developer setup / says the Client ID is required**
Nothing is configured and the built-in fallback is unavailable — most likely the
image was built from modified sources. Put a Client ID of your own into `.env`
and rebuild: `docker compose up --build -d`.

**Your own Client ID is in `.env` but the warning about the shared app is still shown**
The image still holds the old value. Next.js compiles the Client ID into the
browser bundle, so rebuild: `docker compose up --build -d`.

**GitHub says the device flow is not enabled**
Go back to your OAuth App page and tick **Enable Device Flow**.

**Build fails with a network error**
Docker needs internet access to download the base image and npm packages.
Check your connection/VPN/proxy and run the command again.

**Start completely from scratch**

```bash
docker compose down
docker image rm dnsconf-ui:local
docker compose up --build
```

---

## What Docker actually runs

- `Dockerfile` builds in three stages: install dependencies → `next build` →
  a small runtime image containing only Next.js' `standalone` output.
- The app runs as the unprivileged user `nextjs`, not as root.
- There are **no volumes and no database**: this app stores nothing on disk.
  Your GitHub token lives in the browser tab's memory only, exactly as it does
  without Docker.
- The container serves plain HTTP on port 3000 for `localhost` use. If you ever
  expose it to a network, put it behind a reverse proxy with HTTPS.

---

## Запуск на русском

**Коротко:** нужен только Docker. Node.js и npm устанавливать не надо.

### 1. Установите Docker

Скачайте **Docker Desktop**: <https://www.docker.com/products/docker-desktop/>
Запустите его и дождитесь состояния **running**. Docker Desktop должен быть
запущен всё время, пока вы пользуетесь приложением.

### 2. GitHub Client ID (необязательно, можно пропустить)

Вход выполняется через GitHub Device Flow, и в приложение уже встроен Client ID
OAuth App этого проекта — **делать ничего не нужно**.

Про это общее приложение стоит знать две вещи:

- на странице подтверждения GitHub будет показано **имя владельца проекта**, а не вашего приложения;
- GitHub разрешает **50 отправок кода подтверждения в час на одно приложение**
  суммарно для всех его пользователей. При нагрузке вход может временно не
  удаваться — повторите попытку позже или перейдите на своё приложение.

На GitHub-токен это не влияет: он остаётся во вкладке браузера, приложение его
не видит и не сохраняет.

Чтобы использовать своё OAuth App (делается один раз, занимает минуту):

1. откройте <https://github.com/settings/developers> → **OAuth Apps** → **New OAuth App**
2. заполните произвольно, например имя `DnsConf UI`, Homepage URL `http://localhost:3000`
3. нажмите **Register application**
4. на странице приложения поставьте галочку **Enable Device Flow** и сохраните
5. скопируйте **Client ID** (вида `Ov23li...`)

Client ID не является секретом — он и так виден в браузере. Client secret
создавать не нужно, приложение его не использует.

### 3. Запустите

- **Windows:** двойной клик по файлу **`docker-start.cmd`**
- **macOS / Linux:** в терминале **`./docker-start.sh`**

Скрипт сам проверит Docker, создаст файл `.env` и всё соберёт. Ничего спрашивать
он не будет.

Или вручную — файл `.env` не обязателен:

```bash
docker compose up --build
```

Если вы сделали шаг 2 и у вас есть свой Client ID, сначала скопируйте
`.env.example` в `.env` и впишите его в строку `NEXT_PUBLIC_GITHUB_CLIENT_ID=`.

Первая сборка занимает несколько минут, последующие запуски — пару секунд.

### 4. Откройте приложение

<http://localhost:3000>

### Нужные команды

```bash
docker compose up --build -d   # запустить (и пересобрать при изменениях)
docker compose down            # остановить
docker compose logs -f         # посмотреть логи
```

### Частые проблемы

- **Вход постоянно не удаётся из-за лимита** — GitHub разрешает 50 отправок кода
  подтверждения в час на одно приложение, а встроенное приложение проекта общее
  для всех. Повторите позже или сделайте шаг 2 и укажите свой Client ID.
- **`Cannot connect to the Docker daemon`** — не запущен Docker Desktop.
- **`port is already allocated`** — порт занят. Укажите в `.env` другой,
  например `HOST_PORT=8080`, и снова выполните `docker compose up --build -d`.
- **Страница просит настройку разработчика / Client ID** — ничего не настроено и
  встроенное значение недоступно (скорее всего образ собран из изменённых
  исходников). Впишите свой Client ID в `.env` и пересоберите:
  `docker compose up --build -d`.
- **После правки `.env` ничего не изменилось** — перезапускайте обязательно
  с ключом `--build`: Next.js вшивает Client ID в сборку.
