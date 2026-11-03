# SpendWise API

Standalone Express and MongoDB API for SpendWise.

## Local Development

1. Install Node.js 22 or later and MongoDB.
2. Copy `.env.example` to `.env` and set both JWT secrets to random values at least 32 characters long.
3. Install dependencies and start the API:

```sh
npm ci
npm run dev
```

The API listens on `http://localhost:4000`; health is available at `/api/v1/health`.

## Deploy On Render

Create a new Web Service from this repository and use `render.yaml` as the Blueprint configuration. The Dockerfile is at the repository root, and the Docker build context is `.`. If configuring the service manually, set the Dockerfile path to `./Dockerfile` and the Docker context directory to `.`; do not set a nested `Backend` root directory. Set these environment variables in Render:

- `MONGODB_URI`: MongoDB connection string. Use a replica set because transaction endpoints require MongoDB transactions.
- `CORS_ORIGIN`: Comma-separated frontend origin(s), without a trailing slash.

Render generates the JWT secrets from the Blueprint configuration. The Dockerfile builds and starts the API and configures `/api/v1/health` as its container health check.

## Scripts

- `npm run dev`: Start the development server.
- `npm run build`: Compile TypeScript into `dist/`.
- `npm start`: Start the compiled production server.
- `npm test`: Run backend tests.
- `npm run lint`: Type-check the backend.

Do not commit `.env`; use the deployment platform's secret environment-variable store.