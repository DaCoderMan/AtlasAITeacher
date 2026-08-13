# Atlas AI Teacher

## Project X automatic Neon → Notion sync

Neon `workitu-db / neondb` is the canonical structured project store. The endpoint `GET|POST /api/project-x-sync` reads non-deleted projects in `active`, `waiting`, or `later` state, normalizes duplicate names, orders them by priority, and replaces the contents of a dedicated Notion mirror page.

### Required environment variables

- `DATABASE_URL` — Neon connection string.
- `NOTION_TOKEN` — Notion integration token with access to the mirror page.
- `PROJECT_X_NOTION_PAGE_ID` — dedicated mirror page ID. Current page: `3bbf67e61d9d81838205c6e20f9bb037`.
- `PROJECT_X_SYNC_SECRET` — strong random secret required by the endpoint.
- `ATLAS_USER_ID` — optional; defaults to `default`.
- `NOTION_VERSION` — optional; defaults to `2022-06-28`.

### Safety

The sync writes only to the dedicated `Project X — Live Mirror` page. It does not overwrite the broader Projects & Systems history page. Neon remains canonical; the Notion page is generated output.

### Test

Call `/api/project-x-sync?dryRun=1` with `Authorization: Bearer <PROJECT_X_SYNC_SECRET>`. A dry run queries Neon and returns the generated project set without changing Notion.

Then call `/api/project-x-sync` with the same authorization to update the mirror.

### Schedule

`vercel.json` requests an hourly sync. The deployment must have the required environment variables configured. If the hosting plan or cron authentication behavior differs, invoke the protected endpoint from an external scheduler instead.
