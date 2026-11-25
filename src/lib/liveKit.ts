let initialization: Promise<void> | null = null;

export function initializeLiveKit(): Promise<void> {
  if (!initialization) {
    initialization = import("@livekit/react-native").then(({ registerGlobals }) => {
      registerGlobals();
    });
  }
  return initialization;
}
