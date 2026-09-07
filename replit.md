# My Memorizer

My Memorizer helps users practice long-form text and flashcard sets separately with spaced-repetition review reminders.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/my-memorizer/src/App.tsx` — responsive Burmese-first study UI and review flows
- `artifacts/my-memorizer/public/sw.js` — service worker for push notifications while the app is closed
- `artifacts/api-server/src/routes/memorizer.ts` — material CRUD, review scheduling, push subscription, and reminder worker
- `lib/api-spec/openapi.yaml` — source-of-truth API contract
- `lib/db/src/schema/memorizer.ts` — materials, cards, notification settings, push subscriptions, and VAPID config

## Architecture decisions

- Text materials and flashcard sets share a material record but keep separate editing and study flows.
- Review intervals use a practical expanding schedule with a reset-to-one-day path after Forgot.
- Browser-closed reminders use standard Web Push: the service worker receives pushes and the server runs a due-review worker.

## Product

- Create, edit, study, and delete long-form text materials independently.
- Create, edit, study, and delete flashcard sets and individual cards independently.
- Review with Remember/Forgot outcomes and due dates based on an expanding memory curve.
- Configure a daily reminder hour and browser push permission.

## User preferences

- Keep the interface Burmese-first while retaining familiar study terms such as Text, Flashcard, Remember, and Forgot.

## Gotchas

- Browser push requires HTTPS or a supported installed/PWA context and an explicit permission grant.
- After changing `lib/api-spec/openapi.yaml`, run API codegen before typechecking the app.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
