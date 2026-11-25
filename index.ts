import { isRunningInExpoGo, registerRootComponent } from "expo";
import { Platform } from "react-native";

import "./src/data/notificationBackgroundTask";
import App from "./App";
import { initializeLiveKit } from "./src/lib/liveKit";

registerRootComponent(App);

if (Platform.OS !== "web" && !isRunningInExpoGo()) {
  void initializeLiveKit().catch((error: unknown) => {
    console.error("LiveKit initialization failed.", error);
  });
}
