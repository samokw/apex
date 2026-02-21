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

Ensure a `.env` file exists in the project root with at least:

```env
DATABASE_URL="file:./dev.db"
```

### 3. Build the scanner Docker image

The app uses a scanner service that runs in Docker. Build the image from the project root:

```bash
docker build -f docker/Dockerfile.scanner -t apex-scanner:latest .
```

### 4. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

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
