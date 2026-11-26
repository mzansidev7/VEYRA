import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  LiveKitRoom,
  VideoTrack,
  isTrackReference,
  useLocalParticipant,
  useRemoteParticipants,
  useTracks,
} from "@livekit/react-native";
import { Track } from "livekit-client";
import {
  Camera,
  CameraOff,
  Mic,
  MicOff,
  RefreshCw,
  ShieldCheck,
} from "lucide-react-native";
import {
  confirmVideoDiscoveryCallConnected,
  type VideoCallToken,
} from "../../data/videoDiscovery";
import type { SystemColors } from "../../systemColors";

export type VideoCallRoomProps = {
  token: VideoCallToken;
  colors: SystemColors;
  otherName: string;
  initialCameraEnabled?: boolean;
  initialMicrophoneEnabled?: boolean;
  initialCameraFacing?: "front" | "back";
  onSafety?: () => void;
  fullScreen?: boolean;
  onEnd: () => void;
  onConnected: () => void;
  onError: (error: Error) => void;
};

export function VideoCallRoom(props: VideoCallRoomProps) {
  return (
    <LiveKitRoom
      serverUrl={props.token.serverUrl}
      token={props.token.token}
      connect
      audio={props.initialMicrophoneEnabled ?? true}
      video={(props.initialCameraEnabled ?? true)
        ? {
          facingMode: (props.initialCameraFacing ?? "front") === "front"
            ? "user"
            : "environment",
        }
        : false}
      onError={props.onError}
      options={{ adaptiveStream: { pixelDensity: "screen" } }}
    >
      <CallRoomContent {...props} />
    </LiveKitRoom>
  );
}

function CallRoomContent({
  token,
  colors,
  otherName,
  initialCameraFacing,
  onSafety,
  fullScreen = false,
  onEnd,
  onConnected,
  onError,
}: VideoCallRoomProps) {
  const tracks = useTracks([Track.Source.Camera]);
  const remoteParticipants = useRemoteParticipants();
  const { localParticipant, isCameraEnabled, isMicrophoneEnabled } =
    useLocalParticipant();
  const [mediaError, setMediaError] = useState("");
  const [cameraFacing, setCameraFacing] = useState(
    initialCameraFacing ?? "front",
  );
  const isVerifying = useRef(false);
  const hasConfirmedConnection = useRef(false);

  const confirmConnection = useCallback(async () => {
    if (
      remoteParticipants.length === 0 ||
      isVerifying.current ||
      hasConfirmedConnection.current
    ) {
      return;
    }
    isVerifying.current = true;
    try {
      if (await confirmVideoDiscoveryCallConnected(token.sessionId)) {
        hasConfirmedConnection.current = true;
        onConnected();
      }
    } catch (error) {
      onError(
        error instanceof Error
          ? error
          : new Error("Could not confirm the video connection."),
      );
    } finally {
      isVerifying.current = false;
    }
  }, [onConnected, onError, remoteParticipants.length, token.sessionId]);

  useEffect(() => {
    if (remoteParticipants.length === 0) return;
    void confirmConnection();
    const interval = setInterval(() => void confirmConnection(), 2_000);
    return () => clearInterval(interval);
  }, [confirmConnection, remoteParticipants.length]);

  const toggleCamera = async () => {
    try {
      await localParticipant.setCameraEnabled(!isCameraEnabled);
      setMediaError("");
    } catch (error) {
      setMediaError(
        error instanceof Error ? error.message : "Could not change camera state.",
      );
    }
  };

  const toggleMicrophone = async () => {
    try {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
      setMediaError("");
    } catch (error) {
      setMediaError(
        error instanceof Error
          ? error.message
          : "Could not change microphone state.",
      );
    }
  };

  const switchCamera = async () => {
    const nextFacing = cameraFacing === "front" ? "back" : "front";
    try {
      await localParticipant.setCameraEnabled(false);
      await localParticipant.setCameraEnabled(true, {
        facingMode: nextFacing === "front" ? "user" : "environment",
      });
      setCameraFacing(nextFacing);
      setMediaError("");
    } catch (error) {
      setMediaError(
        error instanceof Error ? error.message : "Could not switch camera.",
      );
    }
  };

  const remoteTrack = tracks.find(
    (track) =>
      isTrackReference(track) &&
      !track.participant.isLocal &&
      track.source === Track.Source.Camera,
  );
  const localTrack = tracks.find(
    (track) =>
      isTrackReference(track) &&
      track.participant.isLocal &&
      track.source === Track.Source.Camera,
  );

  return (
    <View style={[styles.call, fullScreen && styles.fullScreenCall]}>
      <View
        style={[
          styles.remoteVideo,
          fullScreen && styles.fullScreenRemoteVideo,
          { backgroundColor: colors.primary },
        ]}
      >
        {remoteTrack && isTrackReference(remoteTrack) ? (
          <VideoTrack
            trackRef={remoteTrack}
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <View style={styles.videoPlaceholder}>
            <Text style={styles.placeholderInitial}>
              {otherName.trim().charAt(0).toUpperCase() || "V"}
            </Text>
            <Text style={styles.placeholderText}>
              {remoteParticipants.length > 0
                ? `${otherName} has their camera off`
                : `Connecting with ${otherName}…`}
            </Text>
          </View>
        )}
        {localTrack && isTrackReference(localTrack) ? (
          <View style={styles.localVideo}>
            <VideoTrack
              trackRef={localTrack}
              style={StyleSheet.absoluteFill}
              mirror
            />
          </View>
        ) : null}
        <View style={styles.topLabel}>
          <Text style={styles.callName}>{otherName}</Text>
          <Text style={styles.callStatus}>
            {remoteParticipants.length > 0 ? "You’re connected" : "Joining call"}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Switch camera"
          onPress={() => void switchCamera()}
          disabled={!isCameraEnabled}
          style={({ pressed }) => [
            styles.switchCameraButton,
            pressed && styles.pressed,
            !isCameraEnabled && styles.disabledControl,
          ]}
        >
          <RefreshCw color="#FFFFFF" size={19} />
        </Pressable>
      </View>

      <View style={styles.callControls}>
        {mediaError ? (
          <Text style={styles.mediaError}>{mediaError}</Text>
        ) : null}
        <View style={styles.controlRow}>
          <ControlButton
            label={isMicrophoneEnabled ? "Mute microphone" : "Unmute microphone"}
            active={isMicrophoneEnabled}
            colors={colors}
            onPress={() => void toggleMicrophone()}
          >
            {isMicrophoneEnabled ? (
              <Mic color={colors.text} size={22} />
            ) : (
              <MicOff color={colors.error} size={22} />
            )}
          </ControlButton>
          <ControlButton
            label={isCameraEnabled ? "Turn camera off" : "Turn camera on"}
            active={isCameraEnabled}
            colors={colors}
            onPress={() => void toggleCamera()}
          >
            {isCameraEnabled ? (
              <Camera color={colors.text} size={22} />
            ) : (
              <CameraOff color={colors.error} size={22} />
            )}
          </ControlButton>
          {onSafety ? (
            <ControlButton
              label="Report or block"
              active
              colors={colors}
              onPress={onSafety}
            >
              <ShieldCheck color={colors.text} size={22} />
            </ControlButton>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="End video call"
            onPress={onEnd}
            style={({ pressed }) => [
              styles.endButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.endButtonText}>End</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function ControlButton({
  label,
  active,
  colors,
  onPress,
  children,
}: {
  label: string;
  active: boolean;
  colors: SystemColors;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.controlButton,
        { backgroundColor: colors.surface, borderColor: colors.border },
        !active && { backgroundColor: colors.surfaceSecondary },
        pressed && styles.pressed,
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  call: {
    flex: 1,
    minHeight: 420,
    borderRadius: 28,
    overflow: "hidden",
    backgroundColor: "#160F18",
  },
  remoteVideo: {
    flex: 1,
    minHeight: 350,
    overflow: "hidden",
  },
  fullScreenCall: {
    minHeight: 0,
    borderRadius: 0,
  },
  fullScreenRemoteVideo: {
    minHeight: 0,
  },
  videoPlaceholder: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    padding: 28,
  },
  placeholderInitial: {
    color: "#FAF7F4",
    fontSize: 64,
    fontWeight: "700",
  },
  placeholderText: {
    color: "#FAF7F4",
    fontSize: 15,
    textAlign: "center",
  },
  topLabel: {
    position: "absolute",
    top: 16,
    left: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: "rgba(25, 16, 27, 0.72)",
  },
  switchCameraButton: {
    position: "absolute",
    top: 18,
    right: 18,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(25, 16, 27, 0.72)",
  },
  disabledControl: {
    opacity: 0.45,
  },
  callName: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  callStatus: {
    color: "#E8DCE7",
    fontSize: 12,
    marginTop: 2,
  },
  localVideo: {
    position: "absolute",
    right: 14,
    bottom: 14,
    width: 104,
    height: 148,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.65)",
    backgroundColor: "#493A4A",
  },
  callControls: {
    paddingHorizontal: 18,
    paddingVertical: 20,
    backgroundColor: "#1D1720",
  },
  controlRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  controlButton: {
    width: 54,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 27,
    borderWidth: 1,
  },
  endButton: {
    minWidth: 70,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#C75D68",
  },
  endButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  mediaError: {
    color: "#E58A91",
    textAlign: "center",
    marginBottom: 12,
    fontSize: 12,
  },
  pressed: {
    opacity: 0.75,
  },
});
