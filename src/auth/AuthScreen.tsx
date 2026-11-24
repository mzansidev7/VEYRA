import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Dimensions,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import { Eye, EyeOff } from "lucide-react-native";
import type { AuthFormMode, EmailSignupResult } from "./auth";
import { BirthdayField } from "./BirthdayField";
import { isAdultBirthday } from "../data/localProfile";
import { systemColors } from "../systemColors";

WebBrowser.maybeCompleteAuthSession();

const SCREEN_HEIGHT = Dimensions.get("screen").height;

type Props = {
  error?: string;
  notice?: string;
  onGoogle: (idToken: string) => Promise<void>;
  onApple: (identityToken: string, rawNonce: string) => Promise<void>;
  onEmail: (
    email: string,
    password: string,
    mode: AuthFormMode,
  ) => Promise<EmailSignupResult>;
  onResetPassword: (email: string) => Promise<void>;
  onResendConfirmation: (email: string) => Promise<void>;
};

export function AuthScreen({
  error: externalError,
  notice: externalNotice,
  onGoogle,
  onApple,
  onEmail,
  onResetPassword,
  onResendConfirmation,
}: Props) {
  const [mode, setMode] = useState<AuthFormMode>("sign-in");
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [birthday, setBirthday] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [canResendConfirmation, setCanResendConfirmation] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const processingResponse = useRef(false);

  const [googleRequest, googleResponse, promptGoogle] =
    Google.useIdTokenAuthRequest(
      {
        iosClientId:
          process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ??
          "not-configured.apps.googleusercontent.com",
        androidClientId:
          process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ??
          "not-configured.apps.googleusercontent.com",
        webClientId:
          process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ??
          "not-configured.apps.googleusercontent.com",
        selectAccount: true,
      },
      { scheme: "veyra" },
    );

  const googleAvailable =
    Platform.OS === "ios"
      ? Boolean(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID)
      : Platform.OS === "android"
        ? Boolean(process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID)
        : Boolean(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID);

  useEffect(() => {
    if (googleRequest) {
      console.log("VEYRA GOOGLE OAUTH:", {
        clientId: googleRequest.clientId,
        redirectUri: googleRequest.redirectUri,
        responseType: googleRequest.responseType,
      });
    }
  }, [googleRequest]);

  useEffect(() => {
    let active = true;
    AppleAuthentication.isAvailableAsync()
      .then((available) => {
        if (active) setAppleAvailable(available);
      })
      .catch(() => {
        if (active) setAppleAvailable(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (googleResponse?.type !== "success" || processingResponse.current) {
      return;
    }

    const idToken = googleResponse.params.id_token;
    if (!idToken) {
      setError("Google sign-in did not return an ID token. Please try again.");
      return;
    }

    processingResponse.current = true;
    setIsBusy(true);
    setError("");
    onGoogle(idToken)
      .catch((cause: unknown) => setError(toMessage(cause)))
      .finally(() => {
        processingResponse.current = false;
        setIsBusy(false);
      });
  }, [googleResponse, onGoogle]);

  const run = async (action: () => Promise<EmailSignupResult>) => {
    setIsBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await action();
      if (result === "confirmation-required") {
        setNotice(
          "Account created. Check your email to confirm it, then log in.",
        );
        setCanResendConfirmation(true);
      }
    } catch (cause) {
      setError(toMessage(cause));
      setCanResendConfirmation(isEmailNotConfirmed(cause));
    } finally {
      setIsBusy(false);
    }
  };

  const submitEmail = () => {
    if (!email.trim() || !password) {
      setError("Enter your email and password to continue.");
      return;
    }
    if (mode === "sign-up" && !isAdultBirthday(birthday)) {
      setError(
        "VEYRA is for adults 18 and older. Choose a birthday showing that you’re at least 18.",
      );
      return;
    }
    if (mode === "sign-up" && password.length < 8) {
      setError("Choose a password with at least 8 characters.");
      return;
    }
    void run(() => onEmail(email.trim(), password, mode));
  };

  const sendPasswordReset = () => {
    if (!email.trim()) {
      setError("Enter your email address and we’ll send you a reset link.");
      return;
    }
    void run(async () => {
      await onResetPassword(email.trim());
      setNotice(
        "If an account exists for that email, a reset link is on its way.",
      );
    });
  };

  const resendConfirmation = () => {
    if (!email.trim()) {
      setError("Enter your email address so we can resend the confirmation.");
      return;
    }
    void run(async () => {
      await onResendConfirmation(email.trim());
      setNotice("If an account needs confirmation, a new email is on its way.");
      setCanResendConfirmation(true);
    });
  };

  const continueWithApple = () => {
    void run(async () => {
      const rawNonce = Array.from(Crypto.getRandomBytes(32))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        rawNonce,
      );
      const result = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        ],
        nonce: hashedNonce,
      });
      if (!result.identityToken) {
        throw new Error("Apple sign-in did not return an identity token.");
      }
      await onApple(result.identityToken, rawNonce);
    });
  };

  const showError = error || externalError;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <ImageBackground
        source={{
          uri: "https://images.unsplash.com/photo-1516589178581-6cd7833ae3b2?auto=format&fit=crop&w=1200&q=88",
        }}
        resizeMode="cover"
        style={[styles.background, { height: SCREEN_HEIGHT }]}
        pointerEvents="none"
      >
        <View
          style={[styles.photoShade, showEmailForm && styles.photoShadeForm]}
        />
        {!showEmailForm ? (
          <LinearGradient
            colors={[
              "rgba(10, 8, 8, 0)",
              "rgba(10, 8, 8, 0.58)",
              "rgba(10, 8, 8, 0)",
            ]}
            locations={[0, 0.48, 1]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.topFade}
          />
        ) : null}

        <LinearGradient
          colors={[
            "rgba(247, 240, 240, 0)",
            "rgb(231, 17, 17)",
            "rgb(255, 0, 0)",
          ]}
          locations={[0, 0.48, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.bottomGlow}
        />
      </ImageBackground>

      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={
            showEmailForm ? styles.formContent : styles.landingContent
          }
          keyboardShouldPersistTaps="handled"
        >
          {showEmailForm ? (
            <>
              <View style={styles.formTop}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setShowEmailForm(false);
                    setError("");
                    setNotice("");
                  }}
                  style={styles.backButton}
                >
                  <Text style={styles.backText}>‹ Back</Text>
                </Pressable>
                <Text style={styles.formWordmark}>VEYRA</Text>
              </View>
              <View style={styles.formHero}>
                <Text style={styles.eyebrow}>MEET WITH INTENTION</Text>
                <Text style={styles.formTitle}>
                  {mode === "sign-up"
                    ? "Your story starts here."
                    : "Welcome back."}
                </Text>
                <Text style={styles.formSubtitle}>
                  {mode === "sign-up"
                    ? "Create your account. Your next chapter is waiting."
                    : "Sign in to pick up where your story left off."}
                </Text>
              </View>
              <View style={styles.form}>
                <Text style={styles.inputLabel}>EMAIL ADDRESS</Text>
                <TextInput
                  accessibilityLabel="Email address"
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  onChangeText={(value) => {
                    setEmail(value);
                    setCanResendConfirmation(false);
                  }}
                  placeholder="you@example.com"
                  placeholderTextColor="#C3B7B8"
                  style={styles.input}
                  value={email}
                />
                <Text style={styles.inputLabel}>PASSWORD</Text>
                <View style={styles.passwordInput}>
                  <TextInput
                    accessibilityLabel="Password"
                    autoCapitalize="none"
                    autoComplete={
                      mode === "sign-up" ? "new-password" : "current-password"
                    }
                    onChangeText={setPassword}
                    onSubmitEditing={submitEmail}
                    placeholder="At least 8 characters"
                    placeholderTextColor="#C3B7B8"
                    secureTextEntry={!showPassword}
                    style={styles.passwordTextInput}
                    value={password}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      showPassword ? "Hide password" : "Show password"
                    }
                    accessibilityState={{ selected: showPassword }}
                    onPress={() => setShowPassword((visible) => !visible)}
                    style={styles.passwordVisibilityButton}
                  >
                    {showPassword ? (
                      <EyeOff color="#E8D8D6" size={19} />
                    ) : (
                      <Eye color="#E8D8D6" size={19} />
                    )}
                  </Pressable>
                </View>
                {mode === "sign-up" ? (
                  <>
                    <BirthdayField
                      value={birthday}
                      onChange={setBirthday}
                      colors={systemColors.dark}
                    />
                    <Text style={styles.ageRequirement}>
                      VEYRA is an adults-only dating platform. You must be 18
                      or older to create an account.
                    </Text>
                  </>
                ) : null}
                {mode === "sign-in" ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={sendPasswordReset}
                    style={styles.forgotButton}
                  >
                    <Text style={styles.forgotText}>Forgot password?</Text>
                  </Pressable>
                ) : null}
                <PrimaryButton
                  disabled={isBusy}
                  label={mode === "sign-up" ? "Sign Up" : "Login with Email"}
                  loading={isBusy}
                  onPress={submitEmail}
                />
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setMode(mode === "sign-in" ? "sign-up" : "sign-in");
                    setError("");
                    setNotice("");
                  }}
                  style={styles.switchMode}
                >
                  <Text style={styles.switchModeText}>
                    {mode === "sign-in"
                      ? "You don't have an account? "
                      : "Already have an account? "}
                    <Text style={styles.switchModeAccent}>
                      {mode === "sign-in" ? "Sign Up" : "Login"}
                    </Text>
                  </Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <View style={styles.landingHero}>
                <View style={styles.heroEyebrow}>
                  <View style={styles.heroEyebrowDot} />
                  <Text style={styles.welcomeText}>
                    A MORE INTENTIONAL WAY TO MEET
                  </Text>
                  <View style={styles.heroEyebrowDot} />
                </View>
                <Text accessibilityRole="header" style={styles.welcomeWordmark}>
                  veyra
                </Text>
                <View style={styles.heroAccent} />
                <Text style={styles.tagline}>For lives already built.</Text>
              </View>

              <View style={styles.landingActions}>
                {/* <PrimaryButton
                  disabled={isBusy}
                  label="Login with Google"
                  loading={isBusy}
                  onPress={() => {
                    if (!googleAvailable) {
                      setError(
                        "Add this platform’s Google OAuth client ID to .env to enable Google sign-in.",
                      );
                      return;
                    }
                    if (!googleRequest) {
                      setError(
                        "Google sign-in is still loading. Please try again.",
                      );
                      return;
                    }
                    void run(async () => {
                      const result = await promptGoogle();
                      if (result.type === "error") {
                        throw new Error(
                          result.params.error_description ||
                            "Google sign-in could not be completed.",
                        );
                      }
                    });
                  }}
                  leading={<Text style={styles.googleMark}>G</Text>}
                /> */}
                {Platform.OS === "ios" && appleAvailable ? (
                  <SecondaryButton
                    disabled={isBusy}
                    label="Login with Apple Account"
                    onPress={continueWithApple}
                    leading={<Text style={styles.appleMark}></Text>}
                  />
                ) : null}
                <SecondaryButton
                  disabled={isBusy}
                  label="Login with Email"
                  onPress={() => {
                    setMode("sign-in");
                    setShowEmailForm(true);
                    setError("");
                    setNotice("");
                  }}
                  leading={null}
                />
              </View>

              <View style={styles.landingFooter}>
                <Text style={styles.adultsOnlyNotice}>
                  18+ ONLY · A DATING PLATFORM FOR ADULTS
                </Text>
                <Text style={styles.signupPrompt}>
                  You don't have an account?
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setMode("sign-up");
                    setShowEmailForm(true);
                    setError("");
                    setNotice("");
                  }}
                  style={({ pressed }) => [
                    styles.signupButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.signupText}>Sign Up</Text>
                </Pressable>
                <Text style={styles.terms}>
                  By clicking Login, you agree with our{" "}
                  <Text style={styles.termsAccent}>Terms</Text>.{"\n"}
                  Learn how we process your data in our{" "}
                  <Text style={styles.termsAccent}>Privacy Policy</Text>
                  {"\nand "}
                  <Text style={styles.termsAccent}>Cookies Policy</Text>.
                </Text>
              </View>
            </>
          )}

          {showError ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {showError}
            </Text>
          ) : null}
          {notice || externalNotice ? (
            <Text style={styles.notice}>{notice || externalNotice}</Text>
          ) : null}
          {canResendConfirmation ? (
            <Pressable
              accessibilityRole="button"
              disabled={isBusy}
              onPress={resendConfirmation}
              style={({ pressed }) => [
                styles.resendConfirmation,
                (pressed || isBusy) && styles.resendConfirmationPressed,
              ]}
            >
              <Text style={styles.resendConfirmationText}>
                Resend confirmation email
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function PrimaryButton({
  disabled,
  label,
  loading,
  onPress,
  leading,
}: {
  disabled: boolean;
  label: string;
  loading: boolean;
  onPress: () => void;
  leading?: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.loginButton,
        disabled && styles.disabledButton,
        pressed && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color="#171315" />
      ) : (
        <View style={styles.buttonContents}>
          <View style={styles.buttonIcon}>{leading}</View>
          <Text style={styles.loginButtonText}>{label}</Text>
          <View style={styles.buttonIcon} />
        </View>
      )}
    </Pressable>
  );
}

function SecondaryButton({
  disabled,
  label,
  onPress,
  leading,
}: {
  disabled: boolean;
  label: string;
  onPress: () => void;
  leading: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.loginButton,
        disabled && styles.disabledButton,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.buttonContents}>
        <View style={styles.buttonIcon}>{leading}</View>
        <Text style={styles.loginButtonText}>{label}</Text>
        <View style={styles.buttonIcon} />
      </View>
    </Pressable>
  );
}

function toMessage(error: unknown): string {
  if (!(error instanceof Error))
    return "Something went wrong. Please try again.";
  if (
    error.message.includes("DEVELOPER_ERROR") ||
    ("code" in error && error.code === "10")
  ) {
    return "Google Sign-In could not be completed. Check the Google provider and OAuth client settings in Supabase.";
  }
  const message = error.message.toLowerCase();
  if (
    message.includes("email not confirmed") ||
    message.includes("email_not_confirmed")
  ) {
    return "Please confirm your email before logging in. Check your inbox or resend the confirmation email below.";
  }
  if (
    message.includes("invalid login credentials") ||
    message.includes("auth/invalid-credential")
  ) {
    return "That email or password doesn’t look right.";
  }
  if (
    message.includes("already exists") ||
    message.includes("user already registered") ||
    message.includes("auth/email-already-in-use")
  ) {
    return "An account already uses this email. Sign in with your existing method.";
  }
  if (
    message.includes("weak password") ||
    message.includes("password should be") ||
    message.includes("auth/weak-password")
  ) {
    return "Choose a stronger password with at least 8 characters.";
  }
  if (
    message.includes("network request failed") ||
    message.includes("failed to fetch") ||
    message.includes("auth/network-request-failed")
  ) {
    return "Unable to connect. Check your internet connection and try again.";
  }
  if (
    message.includes("too many requests") ||
    message.includes("rate limit") ||
    message.includes("auth/too-many-requests")
  ) {
    return "Too many attempts. Please wait a moment and try again.";
  }
  return error.message || "Something went wrong. Please try again.";
}

function isEmailNotConfirmed(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const message = "message" in error ? String(error.message).toLowerCase() : "";
  const code = "code" in error ? String(error.code).toLowerCase() : "";
  return (
    code === "email_not_confirmed" ||
    message.includes("email not confirmed") ||
    message.includes("email_not_confirmed")
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#181210",
  },
  background: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
  photoShade: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(10, 8, 8, 0.26)",
  },
  photoShadeForm: {
    backgroundColor: "rgba(10, 8, 8, 0.38)",
  },
  topFade: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "38%",
  },
  bottomGlow: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "43%",
    // backgroundColor: "rgba(139, 43, 48, 0.75)",
  },
  keyboard: {
    flex: 1,
  },
  landingContent: {
    flexGrow: 1,
    justifyContent: "space-between",
    paddingHorizontal: 30,
    paddingTop: 160,
    paddingBottom: 8,
  },
  landingHero: {
    alignItems: "center",
    marginBottom: 28,
  },
  heroEyebrow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginBottom: 12,
  },
  heroEyebrowDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#E9A394",
  },
  welcomeText: {
    color: "#F1C3B9",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 2.4,
  },
  welcomeWordmark: {
    color: "#FFFDFC",
    fontSize: 72,
    fontWeight: "700",
    letterSpacing: -4,
    lineHeight: 80,
  },
  heroAccent: {
    width: 34,
    height: 3,
    borderRadius: 2,
    backgroundColor: "#E98B78",
    marginTop: 6,
  },
  tagline: {
    color: "#FFF4F0",
    fontSize: 15,
    fontWeight: "500",
    letterSpacing: 0.2,
    marginTop: 13,
  },
  landingActions: {
    gap: 9,
    marginBottom: 26,
  },
  loginButton: {
    minHeight: 54,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 28,
    backgroundColor: "#FFFEFD",
  },
  buttonContents: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonIcon: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  loginButtonText: {
    color: "#181719",
    fontSize: 14,
    fontWeight: "700",
  },
  googleMark: {
    color: "#4285F4",
    fontSize: 20,
    fontWeight: "800",
  },
  appleMark: {
    color: "#111111",
    fontSize: 20,
    fontWeight: "800",
  },
  pressed: {
    opacity: 0.78,
  },
  disabledButton: {
    opacity: 0.55,
  },
  landingFooter: {
    alignItems: "center",
  },
  adultsOnlyNotice: {
    color: "#F2DFDC",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.2,
    marginBottom: 14,
  },
  signupPrompt: {
    color: "#F6E8E5",
    fontSize: 12,
    marginBottom: 10,
  },
  signupButton: {
    minHeight: 54,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.82)",
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  signupText: {
    color: "#FFFDFC",
    fontSize: 15,
    fontWeight: "700",
  },
  terms: {
    color: "#F2DFDC",
    fontSize: 11,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 34,
  },
  termsAccent: {
    textDecorationLine: "underline",
  },
  formContent: {
    flexGrow: 1,
    paddingHorizontal: 25,
    paddingTop: 20,
    paddingBottom: 30,
  },
  formTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backButton: {
    minWidth: 65,
    paddingVertical: 10,
  },
  backText: {
    color: "#FFF8F4",
    fontSize: 13,
  },
  formWordmark: {
    color: "#FFF8F4",
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 3,
    marginRight: 4,
  },
  formHero: {
    marginTop: 60,
    marginBottom: 26,
  },
  eyebrow: {
    color: "#F3B1A2",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.8,
    marginBottom: 9,
  },
  formTitle: {
    color: "#FFF8F4",
    fontSize: 31,
    lineHeight: 38,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  formSubtitle: {
    color: "#F0DFDC",
    fontSize: 13,
    lineHeight: 20,
    marginTop: 9,
  },
  form: {
    gap: 9,
    padding: 18,
    borderRadius: 20,
    backgroundColor: "rgba(26, 19, 20, 0.73)",
  },
  inputLabel: {
    color: "#E8D8D6",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.2,
    marginTop: 4,
  },
  input: {
    minHeight: 50,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.34)",
    borderRadius: 12,
    color: "#FFF8F4",
    backgroundColor: "rgba(255,255,255,0.08)",
    fontSize: 14,
  },
  passwordInput: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.34)",
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  passwordTextInput: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 14,
    color: "#FFF8F4",
    fontSize: 14,
  },
  passwordVisibilityButton: {
    minWidth: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  forgotButton: {
    alignSelf: "flex-end",
    paddingVertical: 5,
  },
  forgotText: {
    color: "#F2B7AA",
    fontSize: 11,
    fontWeight: "600",
  },
  switchMode: {
    alignItems: "center",
    paddingVertical: 10,
  },
  switchModeText: {
    color: "#F1E2DF",
    fontSize: 11,
  },
  switchModeAccent: {
    color: "#FFFDFC",
    fontWeight: "700",
    textDecorationLine: "underline",
  },
  error: {
    color: "#FFE5DE",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 12,
    paddingHorizontal: 8,
  },
  notice: {
    color: "#DDF0DF",
    fontSize: 12,
    lineHeight: 18,
  },
  ageRequirement: {
    color: "#F2DFDC",
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
    marginTop: 12,
    paddingHorizontal: 8,
  },
  resendConfirmation: {
    alignSelf: "center",
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginTop: 4,
  },
  resendConfirmationPressed: {
    opacity: 0.7,
  },
  resendConfirmationText: {
    color: "#F2B7AA",
    fontSize: 12,
    fontWeight: "700",
    textDecorationLine: "underline",
  },
});
