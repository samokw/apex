# Apex

A [Next.js](https://nextjs.org) application with Prisma and a Docker-based scanner.

## Prerequisites

- **Node.js** 20+
- **Docker** (for the scanner)
- **npm**, **yarn**, **pnpm**, or **bun**

## Quick start

Follow these steps in order to run the app locally.

### 1. Install dependencies

```bash
npm install
```

### 2. Set up the database (Prisma)

Generate the Prisma client (required before running the app):

```bash
npx prisma generate
```

Optional: if you need a fresh database or schema changes, run migrations:

```bash
npx prisma migrate dev
```

Ensure a `.env` file exists in the project root. At minimum:

```env
DATABASE_URL="file:./dev.db"
```

**For paying for scans (Wallet tab):** Apex needs a wallet to receive XRP. Set `XRPL_WALLET_SEED` (or `APEX_XRPL_SEED`) to that wallet’s secret in `.env` or `.env.local`. Optionally set `XRPL_WALLET_ADDRESS` for reference. Restart the dev server after changing.

### 3. Build the scanner Docker image

The app uses a scanner service that runs in Docker. **From the project root** run:

**PowerShell (Windows):**
```powershell
docker build -f docker/Dockerfile.scanner -t apex-scanner:latest . --progress=plain
```
Or: `.\docker\build-scanner.ps1`

**Bash (Linux/macOS):**
```bash
docker build -f docker/Dockerfile.scanner -t apex-scanner:latest . --progress=plain
```

The image is based on the official Playwright image (Chromium pre-installed), so the first build is usually **2–5 minutes**. If the build fails, ensure Docker Desktop is running and you have enough disk space.

### 4. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Scanning repos

Scans run in the **apex-scanner** Docker container. Ensure **Docker Desktop is running** before you start a scan. The app connects to Docker automatically (Windows: named pipe; Linux/macOS: Unix socket). To use a custom Docker endpoint, set `DOCKER_SOCKET` in your environment.

If you see **connect ENOENT /var/run/docker.sock** on Windows (or when running from WSL), add to `.env.local`:
```env
DOCKER_SOCKET=//./pipe/docker_engine
```
Then restart the dev server.

---

## Summary checklist

| Step | Command |
|------|--------|
| Install deps | `npm install` |
| Prisma client | `npx prisma generate` |
| Scanner image | `docker build -f docker/Dockerfile.scanner -t apex-scanner:latest .` |
| Start app | `npm run dev` |

## Learn more

- [Next.js Documentation](https://nextjs.org/docs)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Next.js deployment (e.g. Vercel)](https://nextjs.org/docs/app/building-your-application/deploying)
