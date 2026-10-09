// market-today 模块的网页部分：侧边栏入口、首页顶部条与 QQQ 主题页部件。
import { IconBolt, IconClock } from "../../apps/web/app/components/icons.tsx";
import { defineWebModule } from "@aihot/web/modules";

export default defineWebModule({
  name: "market-today",
  sidebar: {
    section: "市场",
    items: [
      { to: "/today", label: "今日市场", icon: IconBolt },
      { to: "/calendar", label: "经济日历", icon: IconClock },
    ],
  },
  home: () => import("./web/home-brief.tsx"),
  topicPage: () => import("./web/qqq-block.tsx"),
});
