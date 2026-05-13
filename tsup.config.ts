import { defineConfig } from "tsup";
import { definePluginConfig } from "carapace-plugin-sdk/tsup";

export default defineConfig([
  definePluginConfig({
    entry: [
      "src/plugin.ts",
      "src/index.ts",
      "src/status.ts",
      "src/mail-action.ts",
    ],
    dts: true,
  }),
]);
