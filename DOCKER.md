# Running DnsConf UI with Docker

A complete, copy-paste guide. No Node.js, no npm, nothing else to install — only Docker.

> **Нужна инструкция на русском?** Она ниже: [Запуск на русском](#запуск-на-русском).

---

## Step 1 — install Docker

Download and install **Docker Desktop**: <https://www.docker.com/products/docker-desktop/>

Start it and wait until it reports that the engine is **running** (the whale icon
in the system tray / menu bar stops animating). Docker Desktop must stay open
while you use the app.

## Step 2 — get a GitHub Client ID

The app signs you in through GitHub Device Flow, which needs a Client ID of your own.
This is a one-time, one-minute setup:

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

## Step 3 — start the app

### The easy way

| Your system | What to do |
|---|---|
| **Windows** | double-click **`docker-start.cmd`** |
| **macOS / Linux** | run **`./docker-start.sh`** in a terminal |

The script checks that Docker is running, creates the `.env` file for you, asks for
the Client ID from Step 2, then builds and starts everything.

### The manual way

```bash
cp .env.example .env     # on Windows: copy .env.example .env
```

Open `.env` in any text editor and paste your Client ID:

```ini
NEXT_PUBLIC_GITHUB_CLIENT_ID=Ov23liYourClientIdHere
```

Then, from the folder that contains `docker-compose.yml`:

```bash
docker compose up --build
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
| `NEXT_PUBLIC_GITHUB_CLIENT_ID` | yes | Client ID of your GitHub OAuth App (Device Flow enabled) |
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

**`Missing NEXT_PUBLIC_GITHUB_CLIENT_ID ...`**
There is no `.env` file, or its `NEXT_PUBLIC_GITHUB_CLIENT_ID=` line is still empty.
Do Step 3 again.

**`Cannot connect to the Docker daemon` / `error during connect`**
Docker Desktop is not running. Start it, wait until it says *running*, try again.

**`port is already allocated` / `address already in use`**
Something else occupies the port. Set a different `HOST_PORT` in `.env` (see above).

**The page loads but says the Client ID is required**
The image was built while `.env` was still empty. Fill it in and rebuild:
`docker compose up --build -d`.

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

### 2. Получите GitHub Client ID

Вход выполняется через GitHub Device Flow, поэтому нужен свой Client ID
(делается один раз, занимает минуту):

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

Скрипт сам проверит Docker, создаст файл `.env`, спросит Client ID и всё соберёт.

Или вручную: скопируйте `.env.example` в `.env`, впишите Client ID в строку
`NEXT_PUBLIC_GITHUB_CLIENT_ID=` и выполните:

```bash
docker compose up --build
```

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

- **`Missing NEXT_PUBLIC_GITHUB_CLIENT_ID`** — нет файла `.env` или в нём пустой
  Client ID. Вернитесь к шагу 3.
- **`Cannot connect to the Docker daemon`** — не запущен Docker Desktop.
- **`port is already allocated`** — порт занят. Укажите в `.env` другой,
  например `HOST_PORT=8080`, и снова выполните `docker compose up --build -d`.
- **Страница просит Client ID** — образ собрался с пустым `.env`. Впишите значение
  и пересоберите: `docker compose up --build -d`.
- **После правки `.env` ничего не изменилось** — перезапускайте обязательно
  с ключом `--build`: Next.js вшивает Client ID в сборку.
