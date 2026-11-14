# Running DnsConf UI with Docker

A complete, copy-paste guide. No Node.js, no npm, nothing else to install — only Docker.

> **Нужна инструкция на русском?** Она ниже: [Запуск на русском](#запуск-на-русском).

---

## Step 1 — install Docker

Download and install **Docker Desktop**: <https://www.docker.com/products/docker-desktop/>

Start it and wait until it reports that the engine is **running** (the whale icon
in the system tray / menu bar stops animating). Docker Desktop must stay open
while you use the app.

## Step 2 — start the app

### Without downloading anything

If you only want to run the app, one command is the whole of it — no copy of this
repository, no build:

```bash
docker run -d -p 3000:3000 --name dnsconf-ui --restart unless-stopped ghcr.io/novibe/dnsconfui
```

Then skip to Step 3. Everyday commands for this way of running it:

```bash
docker logs -f dnsconf-ui              # logs
docker rm -f dnsconf-ui                # stop and remove
docker pull ghcr.io/novibe/dnsconfui   # update, then run the first command again
```

Port 3000 already taken? Use `-p 8080:3000` and open <http://localhost:8080>.

The rest of this page is for running it from a copy of the repository, which is
what you want if you intend to change the code.

### The easy way

| Your system | What to do |
|---|---|
| **Windows** | double-click **`docker-start.cmd`** |
| **macOS / Linux** | run **`./docker-start.sh`** in a terminal |

The script checks that Docker is running, then builds and starts everything.
It asks nothing and creates nothing.

### The manual way

From the folder that contains `docker-compose.yml`:

```bash
docker compose up --build
```

No `.env` file is required, and there is nothing to configure before building.

The first build takes a few minutes (it downloads Node.js and compiles the app).
Later starts take a couple of seconds.

## Step 3 — open the app

<http://localhost:3000>

That's it. Nothing to sign in to and nothing to fill in: the app opens on the
DNS monitor, and the GitHub part is behind a button at the bottom.

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

## Using your own GitHub OAuth App

The app signs you in through GitHub Device Flow and already ships with the Client
ID of this project's own OAuth App, so **there is nothing to set up**. Two things
are worth knowing about that shared app:

- GitHub's authorization screen shows the **project owner's name**, not an app of yours.
- GitHub allows **50 verification-code submissions per hour per app**, shared by
  everyone using it. Under load, sign-in can fail for a while; retry later, or
  use your own app.

Your GitHub token is unaffected either way: it stays in the browser tab and is
never sent to or stored by this app.

To use an OAuth App of your own — a one-time, one-minute setup:

1. open <https://github.com/settings/developers> → **OAuth Apps** → **New OAuth App**
2. fill in anything you like, e.g.
   - *Application name:* `DnsConf UI`
   - *Homepage URL:* `http://localhost:3000`
   - *Authorization callback URL:* `http://localhost:3000`
3. click **Register application**
4. on the app page tick **Enable Device Flow** and press **Update application**
5. copy the **Client ID** (it looks like `Ov23li...`)
6. in this app, open **"Signing in with the project's shared key"** on the start
   screen, paste the Client ID into the field and apply it

That is the whole of it — no file to edit, no rebuild, no restart. The running
container keeps the ID, so every browser that opens the app uses your OAuth App,
not just the one you typed it into. Stopping the container forgets it and the
app goes back to the shared key; the field takes an empty value to forget it
sooner.

The Client ID is not a secret — it is meant to be visible in the browser.
Do **not** create a client secret; this app never uses one.

## Changing the configuration

There is one setting, and only if you need it:

| Variable | Required | Meaning |
|---|---|---|
| `HOST_PORT` | no | port on your machine; default `3000` |

### Port 3000 is already taken

Create `.env` if you have none, and set another port in it:

```bash
cp .env.example .env     # on Windows: copy .env.example .env
```

```ini
HOST_PORT=8080
```

then `docker compose up -d` and open <http://localhost:8080>.

---

## Troubleshooting

**Sign-in keeps failing with a rate-limit or "too many codes" error**
GitHub allows 50 verification-code submissions per hour per OAuth App, and the
app shipped with this project is shared by all of its users. Retry later, or use
your own Client ID (see *Using your own GitHub OAuth App* above).

**`Cannot connect to the Docker daemon` / `error during connect`**
Docker Desktop is not running. Start it, wait until it says *running*, try again.

**`port is already allocated` / `address already in use`**
Something else occupies the port. Set a different `HOST_PORT` in `.env` (see above).

**The page asks for a developer setup / says the Client ID is required**
The client ID that ships with the app is missing — most likely the image was
built from modified sources. Paste a Client ID of your own into the field the
page is offering; nothing has to be rebuilt.

**The app still signs in through the shared key after you applied your own ID**
The container was restarted, which forgets it. Apply it again on the start
screen.

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

### 2. Запустите

#### Ничего не скачивая

Если вы просто хотите пользоваться приложением, достаточно одной команды — без
копии репозитория и без сборки:

```bash
docker run -d -p 3000:3000 --name dnsconf-ui --restart unless-stopped ghcr.io/novibe/dnsconfui
```

Дальше переходите к шагу 3. Нужные команды при таком запуске:

```bash
docker logs -f dnsconf-ui              # логи
docker rm -f dnsconf-ui                # остановить и удалить
docker pull ghcr.io/novibe/dnsconfui   # обновить, затем снова выполнить первую команду
```

Занят порт 3000? Укажите `-p 8080:3000` и откройте <http://localhost:8080>.

Ниже — запуск из копии репозитория, он нужен, если вы собираетесь менять код.

#### Из копии репозитория

- **Windows:** двойной клик по файлу **`docker-start.cmd`**
- **macOS / Linux:** в терминале **`./docker-start.sh`**

Скрипт сам проверит Docker и всё соберёт. Ничего спрашивать он не будет и
никаких файлов не создаст.

Или вручную — файл `.env` не обязателен:

```bash
docker compose up --build
```

Настраивать перед сборкой ничего не нужно.

Первая сборка занимает несколько минут, последующие запуски — пару секунд.

### 3. Откройте приложение

<http://localhost:3000>

Это всё: ни входа, ни настроек. Приложение открывается на DNS-мониторе, а часть
про GitHub спрятана за кнопкой внизу.

### Своё GitHub OAuth App

В приложение уже встроен Client ID OAuth App этого проекта — **настраивать
ничего не нужно**. Про это общее приложение стоит знать две вещи:

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
6. в приложении на начальном экране раскройте **«Вход по общему ключу проекта»**,
   впишите Client ID в поле и нажмите «Применить»

Это всё — ни файлов править, ни пересобирать, ни перезапускать. Запущенный
контейнер хранит этот ID, поэтому через ваше OAuth App входят все браузеры, а не
только тот, где вы его вписали. После остановки контейнера ID забывается и
приложение снова использует общий ключ; чтобы забыть раньше, очистите поле.

Client ID не является секретом — он и так виден в браузере. Client secret
создавать не нужно, приложение его не использует.

### Нужные команды

```bash
docker compose up --build -d   # запустить (и пересобрать при изменениях)
docker compose down            # остановить
docker compose logs -f         # посмотреть логи
```

### Частые проблемы

- **Вход постоянно не удаётся из-за лимита** — GitHub разрешает 50 отправок кода
  подтверждения в час на одно приложение, а встроенное приложение проекта общее
  для всех. Повторите позже или укажите свой Client ID (см. «Своё GitHub OAuth App»).
- **`Cannot connect to the Docker daemon`** — не запущен Docker Desktop.
- **`port is already allocated`** — порт занят. Скопируйте `.env.example` в
  `.env`, укажите другой порт, например `HOST_PORT=8080`, и снова выполните
  `docker compose up -d`.
- **Страница просит настройку разработчика / Client ID** — встроенного значения
  нет (скорее всего образ собран из изменённых исходников). Впишите свой Client
  ID прямо в поле на странице, пересобирать ничего не нужно.
- **После применения своего ID приложение снова входит по общему ключу** —
  контейнер перезапускали, он забыл ID. Впишите его заново на начальном экране.
