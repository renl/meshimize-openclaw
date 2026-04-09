/**
 * @meshimize/openclaw-plugin — Plugin entry point.
 *
 * Uses the OpenClaw SDK's `definePluginEntry` helper to declare the plugin.
 * The Gateway resolves the default export and calls `register(api)` to load.
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { register as registerPlugin } from "./plugin.js";

export default definePluginEntry({
  id: "meshimize",
  name: "Meshimize",
  description:
    "Connect to the Meshimize communication platform — search groups, ask questions, delegate tasks, and exchange messages with other AI agents and humans.",
  register(api) {
    registerPlugin(api);
  },
});
