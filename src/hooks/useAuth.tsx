"use client"
import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { isAuthRetryableFetchError, type User, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/services/supabase';
import { useConfig, ConfigStatus } from '@/services/config';

type AuthResult = { error: string | null };
// needsEmailConfirmation: the password was right but the signup code was never
// entered — the caller should resend the code and show the verify screen
type SignInResult = AuthResult & { needsEmailConfirmation?: boolean };

interface AuthContextType {
  user: User | null;
  // False until the remote config provides Supabase credentials
  isConfigured: boolean;
  configStatus: ConfigStatus;
  isLoading: boolean;
  // Signup: create account with a password, then confirm via emailed 6-digit code
  signUp: (email: string, password: string) => Promise<AuthResult>;
  verifySignupOtp: (email: string, code: string) => Promise<AuthResult>;
  resendSignupOtp: (email: string) => Promise<AuthResult>;
  // Signin: email + password only
  signInWithPassword: (email: string, password: string) => Promise<SignInResult>;
  // Reset: emailed 6-digit code, then set a new password
  requestPasswordReset: (email: string) => Promise<AuthResult>;
  verifyRecoveryOtp: (email: string, code: string) => Promise<AuthResult>;
  updatePassword: (password: string) => Promise<AuthResult>;
  // Fails (and stays signed in) if the server can't be reached. Clears the
  // device's watchlist and watch history unless keepDeviceData is set.
  signOut: (opts?: { keepDeviceData?: boolean }) => Promise<AuthResult>;
  // Permanently deletes the signed-in account and its synced data (and the
  // device's copy)
  deleteAccount: () => Promise<AuthResult>;
  // Increments after each sign-out that should clear the device's watchlist
  // and watch history; useSyncAccount does the clearing. Only signOut and
  // deleteAccount bump it: a session that ends without the user signing out
  // here (password changed, signed out elsewhere, refresh token revoked)
  // leaves the device's data in place.
  deviceDataClearSignal: number;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const NOT_CONFIGURED: AuthResult = { error: "Sign-in isn't available right now. Check your connection and try again." };

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  // The client whose saved session has been read. Tracking the client (not a
  // boolean) means there's no render, right after the client appears, that
  // claims "loaded, nobody signed in" before the session has actually been read.
  const [restoredFor, setRestoredFor] = useState<SupabaseClient | null>(null);
  // Bumped only by a sign-out the user asked for (see AuthContextType); an
  // involuntary session end must not clear the device
  const [deviceDataClearSignal, setDeviceDataClearSignal] = useState(0);
  const { config, status: configStatus, revalidated } = useConfig();
  // Credentials are only used once this launch's config fetch has settled, so a
  // cached key that was rotated meanwhile never touches the saved session
  const supabaseUrl = revalidated ? config.supabase?.url : undefined;
  const supabaseAnonKey = revalidated ? config.supabase?.anonKey : undefined;
  // Null until the remote config provides credentials (may arrive after startup)
  const supabase = useMemo(
    () => supabaseUrl && supabaseAnonKey ? getSupabaseClient({ url: supabaseUrl, anonKey: supabaseAnonKey }) : null,
    [supabaseUrl, supabaseAnonKey]
  );

  useEffect(() => {
    if (!supabase) { setUser(null); return; }
    let cancelled = false;
    supabase.auth.getSession()
      .then(({ data }) => { if (!cancelled) setUser(data.session?.user ?? null); })
      .catch(() => { if (!cancelled) setUser(null); })
      .finally(() => { if (!cancelled) setRestoredFor(supabase); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, [supabase]);

  // Still loading while this launch's config fetch is pending, then while the session restores
  const isLoading = supabase ? restoredFor !== supabase : !revalidated;

  const signUp = async (email: string, password: string): Promise<AuthResult> => {
    if (!supabase) return NOT_CONFIGURED;
    // Password is stored by Supabase as a bcrypt hash in auth.users; with
    // "Confirm email" enabled the account activates after OTP verification.
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: error.message };
    // Anti-enumeration: for an already-registered email Supabase returns a
    // placeholder user with no identities and sends no email — surface that
    // instead of letting the user wait for a code that never arrives.
    if (data.user && (data.user.identities?.length ?? 0) === 0) {
      return { error: 'An account with this email already exists. Sign in, or use "Forgot password?".' };
    }
    return { error: null };
  };

  const verifySignupOtp = async (email: string, code: string): Promise<AuthResult> => {
    if (!supabase) return NOT_CONFIGURED;
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'signup' });
    return { error: error?.message ?? null };
  };

  const resendSignupOtp = async (email: string): Promise<AuthResult> => {
    if (!supabase) return NOT_CONFIGURED;
    const { error } = await supabase.auth.resend({ type: 'signup', email });
    return { error: error?.message ?? null };
  };

  const signInWithPassword = async (email: string, password: string): Promise<SignInResult> => {
    if (!supabase) return NOT_CONFIGURED;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    // Supabase only reports this after the password matched (a wrong password is
    // invalid_credentials), so it doesn't reveal whether an email is registered.
    if (error?.code === 'email_not_confirmed') {
      return { error: error.message, needsEmailConfirmation: true };
    }
    return { error: error?.message ?? null };
  };

  const requestPasswordReset = async (email: string): Promise<AuthResult> => {
    if (!supabase) return NOT_CONFIGURED;
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    return { error: error?.message ?? null };
  };

  const verifyRecoveryOtp = async (email: string, code: string): Promise<AuthResult> => {
    if (!supabase) return NOT_CONFIGURED;
    // Establishes a session on success so updatePassword can run right after
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'recovery' });
    return { error: error?.message ?? null };
  };

  const updatePassword = async (password: string): Promise<AuthResult> => {
    if (!supabase) return NOT_CONFIGURED;
    const { error } = await supabase.auth.updateUser({ password });
    return { error: error?.message ?? null };
  };

  const signOut = async (opts?: { keepDeviceData?: boolean }): Promise<AuthResult> => {
    if (!supabase) return NOT_CONFIGURED;
    // scope 'local' ends only this device's session; other devices stay signed in.
    // supabase-js revokes the session on the server first; if that request
    // fails it returns the error and keeps the session, so report it rather
    // than letting the user believe they're signed out.
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (!error) {
      // The account keeps the synced copy; the device's copy goes with the session
      if (!opts?.keepDeviceData) setDeviceDataClearSignal(n => n + 1);
      return { error: null };
    }
    // Retryable = the request never got through (status 0) or the server
    // answered 5xx; either way the session is still valid and kept
    if (isAuthRetryableFetchError(error)) {
      return {
        error: error.status === 0
          ? "Couldn't sign out — no connection to the server. Check your connection and try again."
          : "Couldn't sign out — the server had a problem. Please try again in a moment.",
      };
    }
    return { error: `Couldn't sign out: ${error.message}` };
  };

  const deleteAccount = async (): Promise<AuthResult> => {
    if (!supabase) return NOT_CONFIGURED;
    if (!user) return { error: 'You need to be signed in to delete your account.' };
    // delete_own_account() (see SUPABASE_SETUP.md) deletes only the caller's row
    // in auth.users; their sessions and synced rows go with it via ON DELETE CASCADE.
    const { error } = await supabase.rpc('delete_own_account');
    if (error) {
      if (error.code === 'PGRST202') return { error: "Account deletion isn't set up on the server yet. Please try again later." };
      return { error: error.message };
    }
    // The account and its sessions are gone; drop the local copy of the session.
    // Server sign-out answers 401/404 for a deleted user, which supabase-js treats
    // as signed out. If it fails anyway (e.g. connection lost right now), supabase-js
    // keeps the dead session, so remove its stored copy (the default storage keys
    // sb-<project ref>-auth-token, -code-verifier and -user) so it isn't restored at
    // the next launch, and clear the user here; the in-memory copy is discarded at
    // the next refresh, which fails for a deleted user.
    const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
    if (signOutError) {
      try {
        const storage = window.localStorage;
        const sessionKeys: string[] = [];
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (key && /^sb-.*-auth-token(-code-verifier|-user)?$/.test(key)) sessionKeys.push(key);
        }
        sessionKeys.forEach(key => storage.removeItem(key));
      } catch {}
      setUser(null);
    }
    setDeviceDataClearSignal(n => n + 1);
    return { error: null };
  };

  return (
    <AuthContext.Provider value={{
      user, isConfigured: supabase !== null, configStatus, isLoading,
      signUp, verifySignupOtp, resendSignupOtp,
      signInWithPassword,
      requestPasswordReset, verifyRecoveryOtp, updatePassword,
      signOut, deleteAccount, deviceDataClearSignal,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
