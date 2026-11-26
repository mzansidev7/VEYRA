import React, { useEffect, useRef } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Circle, Defs, LinearGradient, Stop } from "react-native-svg";

type VeyraLoaderProps = {
  size?: number | "small" | "medium" | "large";
  label?: string;
  strokeWidth?: number;
  imageWidth?: number;
  imageHeight?: number;
  imageMarginBottom?: number;
  loaderShown?: boolean;
};

const SIZES = {
  small: 20,
  medium: 36,
  large: 56,
};

export default function VeyraLoader({
  size = 48,
  label,
  strokeWidth = 3,
  imageWidth = 48,
  imageHeight = 48,
  imageMarginBottom = 12,
  loaderShown = true,
}: VeyraLoaderProps) {
  const dimension = typeof size === "number" ? size : SIZES[size];

  // Independent animations
  const rotation = useRef(new Animated.Value(0)).current;
  const flipRotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let mounted = true;
    let animation: Animated.CompositeAnimation | undefined;

    const startAnimations = async () => {
      const reducedMotion = await AccessibilityInfo.isReduceMotionEnabled();

      if (!mounted || reducedMotion) return;

      // Gradient spinner rotation
      const spinnerAnimation = Animated.loop(
        Animated.timing(rotation, {
          toValue: 1,
          duration: 1000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );

      // Heart 3D flip animation
      const heartAnimation = Animated.loop(
        Animated.sequence([
          Animated.timing(flipRotation, {
            toValue: 1,
            duration: 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),

          Animated.delay(500),

          Animated.timing(flipRotation, {
            toValue: 2,
            duration: 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),

          Animated.delay(500),
        ]),
      );

      animation = Animated.parallel([spinnerAnimation, heartAnimation]);

      animation.start();
    };

    startAnimations();

    return () => {
      mounted = false;
      animation?.stop();
      rotation.stopAnimation();
      flipRotation.stopAnimation();
    };
  }, [rotation, flipRotation]);

  // Spinner rotation
  const spinnerStyle = {
    transform: [
      {
        rotate: rotation.interpolate({
          inputRange: [0, 1],
          outputRange: ["0deg", "360deg"],
        }),
      },
    ],
  };

  // 3D horizontal heart flip
  const heartStyle = {
    transform: [
      { perspective: 800 },
      {
        rotateY: flipRotation.interpolate({
          inputRange: [0, 1, 2],
          outputRange: ["0deg", "180deg", "360deg"],
        }),
      },
      {
        scale: flipRotation.interpolate({
          inputRange: [0, 0.5, 1, 1.5, 2],
          outputRange: [1, 0.92, 1, 0.92, 1],
        }),
      },
    ],
  };

  const radius = (dimension - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <View
      style={styles.container}
      accessibilityRole="progressbar"
      accessibilityLabel={label || "Loading"}
    >
      {/* Animated VEYRA heart */}
      <Animated.View style={heartStyle}>
        <Image
          accessible
          accessibilityLabel="VEYRA"
          source={require("../../assets/veyra-heart-transparent.png")}
          resizeMode="contain"
          style={{
            width: imageWidth,
            height: imageHeight,
            marginBottom: imageMarginBottom,
          }}
        />
      </Animated.View>

      {/* Animated gradient spinner */}
      {loaderShown && (
        <Animated.View style={spinnerStyle}>
          <Svg width={dimension} height={dimension}>
            <Defs>
              <LinearGradient
                id="veyraGradient"
                x1="0%"
                y1="0%"
                x2="100%"
                y2="100%"
              >
                <Stop offset="0%" stopColor="#8B00FF" />
                <Stop offset="55%" stopColor="#E000C8" />
                <Stop offset="100%" stopColor="#FF315F" />
              </LinearGradient>
            </Defs>

            {/* Background track */}
            <Circle
              cx={dimension / 2}
              cy={dimension / 2}
              r={radius}
              fill="none"
              stroke="#766A75"
              strokeOpacity={0.2}
              strokeWidth={strokeWidth}
            />

            {/* Gradient progress arc */}
            <Circle
              cx={dimension / 2}
              cy={dimension / 2}
              r={radius}
              fill="none"
              stroke="url(#veyraGradient)"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={`${circumference * 0.72} ${circumference}`}
              rotation="-90"
              origin={`${dimension / 2}, ${dimension / 2}`}
            />
          </Svg>
        </Animated.View>
      )}
      {/* Optional loading label */}
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },

  label: {
    color: "#766A75",
    fontSize: 13,
    fontWeight: "500",
    textAlign: "center",
  },
});
