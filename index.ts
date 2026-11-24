import { isRunningInExpoGo, registerRootComponent } from "expo";
import { Platform } from "react-native";

import App from "./App";

async function registerApp() {
  if (Platform.OS !== "web" && !isRunningInExpoGo()) {
    const { registerGlobals } = await import("@livekit/react-native");
    registerGlobals();
  }

  registerRootComponent(App);
}

void registerApp();
