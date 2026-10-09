// The market-today module's addresses: its public pages and the API paths the api process answers.
// Listed in site/modules/index.ts; see docs/architecture.md “模块”.
import { defineModule } from "@aihot/contracts/modules";

export default defineModule({
  name: "market-today",
  pages: [
    { path: "today", file: "web/today.tsx" },
    { path: "calendar", file: "web/calendar-page.tsx" },
  ],
  apiPaths: [/^\/api\/market-today\//],
});
