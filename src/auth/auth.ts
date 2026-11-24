import type { User } from "@supabase/supabase-js";
import { supabaseAuth } from "../lib/supabaseClient";

export type AuthUser = User;
export type AuthFormMode = "sign-in" | "sign-up";
export type EmailSignupResult = "confirmation-required" | void;

function requireAuth() {
  if (!supabaseAuth) {
    throw new Error(
      "Supabase Auth is not configured. Set the public Supabase URL and anon key in the client environment.",
    );
  }
  return supabaseAuth;
}

export async function createEmailAccount(
  email: string,
  password: string,
): Promise<EmailSignupResult> {
  const { data, error } = await requireAuth().signUp({
    email: email.trim(),
    password,
  });
  if (error) throw error;
  if (!data.session) return "confirmation-required";
}

export async function signInWithEmail(
  email: string,
  password: string,
): Promise<void> {
  const { error } = await requireAuth().signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw error;
}

export async function signInWithGoogleIdToken(idToken: string): Promise<void> {
  const { error } = await requireAuth().signInWithIdToken({
    provider: "google",
    token: idToken,
  });
  if (error) throw error;
}

export async function signInWithAppleToken(
  identityToken: string,
  rawNonce: string,
): Promise<void> {
  const { error } = await requireAuth().signInWithIdToken({
    provider: "apple",
    token: identityToken,
    nonce: rawNonce,
  });
  if (error) throw error;
}

export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await requireAuth().resetPasswordForEmail(email.trim());
  if (error) throw error;
}

export async function resendSignupConfirmation(email: string): Promise<void> {
  const { error } = await requireAuth().resend({
    type: "signup",
    email: email.trim(),
  });
  if (error) throw error;
}

export async function signOutFromAuth(): Promise<void> {
  const { error } = await requireAuth().signOut();
  if (error) throw error;
}
