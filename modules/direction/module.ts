// direction 模块的地址：影子阶段没有公开页面与 API，只挂模块名（server.ts 提供队列与钩子）。
import { defineModule } from "@aihot/contracts/modules";

export default defineModule({
  name: "direction",
});
