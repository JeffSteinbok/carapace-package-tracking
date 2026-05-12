import { defineConfig } from "tsup";
import { definePluginConfig } from "carapace-plugin-sdk/tsup";

export default defineConfig([
  // Core entries with type declarations
  definePluginConfig({
    entry: ["src/plugin.ts", "src/index.ts", "src/status.ts"],
    dts: true,
  }),
  // Mail action (optional dep on carapace-mail-runtime, no dts)
  definePluginConfig({
    entry: ["src/mail-action.ts"],
    dts: false,
    clean: false,
  }),
]);
