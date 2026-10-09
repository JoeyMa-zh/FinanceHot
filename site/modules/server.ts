// The backend of the site's modules, installed by the api and the worker when they start (site/modules/index.ts).
import marketToday from "@aihot/market-today/server";
import type { ServerModule } from "@aihot/backend/modules";

export const SERVER_MODULES: readonly ServerModule[] = [marketToday];
