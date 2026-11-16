"use client"
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@/hooks/useAuth';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useProgress } from '@/hooks/useProgress';
import { useModalBackClose } from '@/hooks/useBackButton';
import { useSyncAccount } from '@/hooks/useSyncAccount';

interface AccountModalProps {
  onClose: () => void;
}

type View = 'signin' | 'signup' | 'signup-code' | 'reset-email' | 'reset-code' | 'reset-password' | 'delete-account';

const MIN_PASSWORD_LENGTH = 6;

// Shown when sign-out was refused because changes couldn't be uploaded first;
// "Sign out anyway" is offered while it is the error on screen
const UNSYNCED_ERROR = "Some of your changes haven't reached your account yet, so signing out now would lose them. Check your connection and try again.";

const AccountModal: React.FC<AccountModalProps> = ({ onClose }) => {
  const {
    user, isConfigured, configStatus, isLoading,
    signUp, verifySignupOtp, resendSignupOtp,
    signInWithPassword,
    requestPasswordReset, verifyRecoveryOtp, updatePassword,
    signOut, deleteAccount,
  } = useAuth();
  const { flushToAccount: flushWatchlist } = useWatchlist();
  const { flushToAccount: flushProgress } = useProgress();

  const [view, setView] = useState<View>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  // Where "Verify your email" came from: a fresh signup, or a sign-in attempt
  // on an account whose signup code was never entered
  const [verifyFrom, setVerifyFrom] = useState<'signup' | 'signin'>('signup');

  // While a request is running (e.g. syncing before sign-out) the window can't
  // be closed, so nothing finishes unseen in the background
  const requestClose = () => { if (!isBusy) onClose(); };
  useModalBackClose(true, requestClose);
  // The device's data belongs to another account while that choice is pending
  const { needsChoice } = useSyncAccount();

  const run = async (action: () => Promise<{ error: string | null }>, onSuccess: () => void) => {
    setIsBusy(true);
    setError(null);
    const { error: err } = await action();
    setIsBusy(false);
    if (err) { setError(err); return; }
    onSuccess();
  };

  const goTo = (next: View) => {
    setView(next);
    setError(null);
    setNotice(null);
    setCode('');
  };

  const checkPasswords = (): boolean => {
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return false;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return false;
    }
    return true;
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    setIsBusy(true);
    setError(null);
    setNotice(null);
    const result = await signInWithPassword(address, password);
    if (result.needsEmailConfirmation) {
      // The signup was never verified (e.g. the window was closed before the
      // code was entered): send a fresh code and pick up where it left off.
      const resend = await resendSignupOtp(address);
      setIsBusy(false);
      setCode('');
      setVerifyFrom('signin');
      setView('signup-code');
      if (resend.error) {
        // Usually the per-email rate limit; an earlier code may still be valid
        setError(`Couldn't send a new code: ${resend.error}`);
      } else {
        setNotice('We sent you a new code.');
      }
      return;
    }
    setIsBusy(false);
    if (result.error) setError(result.error);
  };

  const handleSignUp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkPasswords()) return;
    run(() => signUp(email.trim(), password), () => {
      setVerifyFrom('signup');
      setView('signup-code');
    });
  };

  const handleVerifySignup = (e: React.FormEvent) => {
    e.preventDefault();
    run(() => verifySignupOtp(email.trim(), code.trim()), () => setNotice('Account created!'));
  };

  const handleRequestReset = (e: React.FormEvent) => {
    e.preventDefault();
    run(() => requestPasswordReset(email.trim()), () => setView('reset-code'));
  };

  const handleVerifyRecovery = (e: React.FormEvent) => {
    e.preventDefault();
    run(() => verifyRecoveryOtp(email.trim(), code.trim()), () => {
      setPassword('');
      setConfirmPassword('');
      setView('reset-password');
    });
  };

  const handleUpdatePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkPasswords()) return;
    run(() => updatePassword(password), () => {
      setNotice('Password updated.');
      setView('signin'); // user is signed in — account view renders
    });
  };

  const afterSignOut = () => { goTo('signin'); onClose(); };

  // Signing out removes the watchlist and watch history from the device, so
  // first upload whatever hasn't reached the account; if that fails, refuse
  // rather than lose it (the user can still choose "Sign out anyway")
  const handleSignOut = () => {
    run(async () => {
      const [watchlistOk, progressOk] = await Promise.all([flushWatchlist(), flushProgress()]);
      if (!watchlistOk || !progressOk) return { error: UNSYNCED_ERROR };
      return signOut({ keepDeviceData: needsChoice });
    }, afterSignOut);
  };

  const handleSignOutAnyway = () => {
    run(() => signOut({ keepDeviceData: needsChoice }), afterSignOut);
  };

  const handleDeleteAccount = () => {
    run(deleteAccount, () => {
      setView('signin');
      setNotice('Your account has been deleted.');
    });
  };

  const inputClass = "w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-primary text-base text-gray-900 dark:text-white";
  const primaryBtnClass = "w-full py-3 rounded-xl text-sm font-semibold bg-blue-200 dark:bg-blue-800 hover:bg-blue-300 dark:hover:bg-blue-700 text-blue-900 dark:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const linkBtnClass = "text-blue-600 dark:text-blue-400 hover:underline";

  const codeInput = (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      value={code}
      onChange={(e) => setCode(e.target.value)}
      placeholder="123456"
      autoFocus
      required
      className={`${inputClass} tracking-[0.3em] text-center font-semibold`}
    />
  );

  // The delete confirmation only makes sense while signed in; if the session
  // ends (e.g. signed out on another device) fall back to the sign-in form.
  const activeView: View = view === 'delete-account' && !user ? 'signin' : view;
  // After recovery-code verification the user has a session but still needs to
  // set the new password, so that view wins over the signed-in account view.
  const showAccountView = user && activeView !== 'reset-password' && activeView !== 'delete-account';

  // Portal to <body>: the Header has backdrop-blur, and an ancestor with a
  // backdrop-filter becomes the containing block for position:fixed — the
  // overlay would anchor to the header instead of the viewport.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={requestClose}
    >
      <div
        className="relative w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={requestClose}
          disabled={isBusy}
          aria-label="Close"
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/10 dark:bg-black/30 hover:bg-black/20 dark:hover:bg-black/50 flex items-center justify-center transition-colors"
        >
          <svg className="w-4 h-4 text-gray-700 dark:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {!isConfigured ? (
          <div className="text-center py-4">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
              {isLoading ? 'Connecting…' : 'Sign-in unavailable'}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {isLoading
                ? 'Getting things ready — this only takes a moment.'
                : configStatus === 'failed'
                  ? "Couldn't reach the ScreenMate server. Check your connection — it will retry automatically."
                  : "Account sync isn't available right now. Your data is still saved on this device."}
            </p>
          </div>
        ) : showAccountView ? (
          <div className="text-center py-2">
            <div className="w-14 h-14 mx-auto rounded-full bg-blue-200 dark:bg-blue-800 flex items-center justify-center mb-3">
              <svg className="w-7 h-7 text-blue-900 dark:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Signed in</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 break-all">{user.email}</p>
            {notice && <p className="text-sm text-green-600 dark:text-green-400 mt-2">{notice}</p>}
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
              Your watchlist and watch history sync to your account on this and other devices.
            </p>
            {error && <p className="text-red-500 text-sm mt-3">{error}</p>}
            {error === UNSYNCED_ERROR && (
              <button
                onClick={handleSignOutAnyway}
                disabled={isBusy}
                className="mt-2 text-xs text-red-600 dark:text-red-400 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Sign out anyway
              </button>
            )}
            <button
              onClick={handleSignOut}
              disabled={isBusy}
              className="mt-5 w-full py-3 rounded-xl text-sm font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-red-100 dark:hover:bg-red-900/40 hover:text-red-700 dark:hover:text-red-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isBusy ? 'Signing out…' : 'Sign out'}
            </button>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
              Signs out on this device only and removes your watchlist and watch history from it. They stay saved in your account.
            </p>
            <button
              onClick={() => goTo('delete-account')}
              disabled={isBusy}
              className="mt-4 text-xs text-red-600 dark:text-red-400 hover:underline"
            >
              Delete account
            </button>
          </div>
        ) : activeView === 'delete-account' ? (
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Delete account?</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              This permanently deletes the account <span className="font-medium text-gray-700 dark:text-gray-200 break-all">{user?.email}</span> and
              the watchlist and watch history synced to it. This can&apos;t be undone.
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-5">
              Your watchlist and watch history are removed from this device too. You can create a new account with the same email later.
            </p>
            {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
            <button
              onClick={handleDeleteAccount}
              disabled={isBusy}
              className="w-full py-3 rounded-xl text-sm font-semibold bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isBusy ? 'Deleting…' : 'Delete my account'}
            </button>
            <button
              onClick={() => goTo('signin')}
              disabled={isBusy}
              className="mt-3 w-full py-3 rounded-xl text-sm font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        ) : activeView === 'signin' ? (
          <form onSubmit={handleSignIn}>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Sign in</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
              Sync your watchlist and watch history across devices.
            </p>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com" autoFocus required autoComplete="email"
              className={inputClass}
            />
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="Password" required autoComplete="current-password"
              className={`${inputClass} mt-3`}
            />
            {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
            {notice && <p className="text-green-600 dark:text-green-400 text-sm mt-2">{notice}</p>}
            <button type="submit" disabled={isBusy} className={`mt-4 ${primaryBtnClass}`}>
              {isBusy ? 'Signing in…' : 'Sign in'}
            </button>
            <div className="flex justify-between mt-4 text-xs">
              <button type="button" onClick={() => goTo('signup')} className={linkBtnClass}>
                Create account
              </button>
              <button type="button" onClick={() => goTo('reset-email')} className="text-gray-500 dark:text-gray-400 hover:underline">
                Forgot password?
              </button>
            </div>
          </form>
        ) : activeView === 'signup' ? (
          <form onSubmit={handleSignUp}>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Create account</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
              Choose a password, then we'll email you a 6-digit code to verify your address.
            </p>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com" autoFocus required autoComplete="email"
              className={inputClass}
            />
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder={`Password (min ${MIN_PASSWORD_LENGTH} characters)`} required autoComplete="new-password"
              className={`${inputClass} mt-3`}
            />
            <input
              type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm password" required autoComplete="new-password"
              className={`${inputClass} mt-3`}
            />
            {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
            <button type="submit" disabled={isBusy} className={`mt-4 ${primaryBtnClass}`}>
              {isBusy ? 'Creating…' : 'Create account'}
            </button>
            <div className="mt-4 text-xs text-center">
              <span className="text-gray-500 dark:text-gray-400">Already have an account? </span>
              <button type="button" onClick={() => goTo('signin')} className={linkBtnClass}>Sign in</button>
            </div>
          </form>
        ) : activeView === 'signup-code' ? (
          <form onSubmit={handleVerifySignup}>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Verify your email</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
              {verifyFrom === 'signin' ? (
                <>Your email isn&apos;t verified yet. Enter the 6-digit code we emailed to <span className="font-medium text-gray-700 dark:text-gray-200">{email.trim()}</span>.</>
              ) : (
                <>We sent a 6-digit code to <span className="font-medium text-gray-700 dark:text-gray-200">{email.trim()}</span>.</>
              )}
            </p>
            {codeInput}
            {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
            <button type="submit" disabled={isBusy} className={`mt-4 ${primaryBtnClass}`}>
              {isBusy ? 'Verifying…' : 'Verify & sign in'}
            </button>
            <div className="flex justify-between mt-3 text-xs">
              <button type="button" onClick={() => goTo(verifyFrom)} className="text-gray-500 dark:text-gray-400 hover:underline">
                Back
              </button>
              <button
                type="button" disabled={isBusy}
                onClick={() => run(() => resendSignupOtp(email.trim()), () => setNotice('Code resent.'))}
                className={`${linkBtnClass} disabled:opacity-50`}
              >
                Resend code
              </button>
            </div>
            {notice && <p className="text-green-600 dark:text-green-400 text-xs mt-2 text-center">{notice}</p>}
          </form>
        ) : activeView === 'reset-email' ? (
          <form onSubmit={handleRequestReset}>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Reset password</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
              If this email has an account, we'll send it a 6-digit code to reset the password.
            </p>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com" autoFocus required autoComplete="email"
              className={inputClass}
            />
            {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
            <button type="submit" disabled={isBusy} className={`mt-4 ${primaryBtnClass}`}>
              {isBusy ? 'Sending…' : 'Send code'}
            </button>
            <div className="mt-4 text-xs text-center">
              <button type="button" onClick={() => goTo('signin')} className="text-gray-500 dark:text-gray-400 hover:underline">
                Back to sign in
              </button>
            </div>
          </form>
        ) : activeView === 'reset-code' ? (
          <form onSubmit={handleVerifyRecovery}>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Enter code</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
              If <span className="font-medium text-gray-700 dark:text-gray-200">{email.trim()}</span> has
              an account, a 6-digit code is on its way. No email? Double-check the address.
            </p>
            {codeInput}
            {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
            <button type="submit" disabled={isBusy} className={`mt-4 ${primaryBtnClass}`}>
              {isBusy ? 'Verifying…' : 'Verify code'}
            </button>
            <div className="flex justify-between mt-3 text-xs">
              <button type="button" onClick={() => goTo('reset-email')} className="text-gray-500 dark:text-gray-400 hover:underline">
                Change email
              </button>
              <button
                type="button" disabled={isBusy}
                onClick={() => run(() => requestPasswordReset(email.trim()), () => setNotice('Code resent.'))}
                className={`${linkBtnClass} disabled:opacity-50`}
              >
                Resend code
              </button>
            </div>
            {notice && <p className="text-green-600 dark:text-green-400 text-xs mt-2 text-center">{notice}</p>}
          </form>
        ) : (
          <form onSubmit={handleUpdatePassword}>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Set new password</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
              Code verified — choose a new password for <span className="font-medium text-gray-700 dark:text-gray-200">{email.trim()}</span>.
            </p>
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder={`New password (min ${MIN_PASSWORD_LENGTH} characters)`} autoFocus required autoComplete="new-password"
              className={inputClass}
            />
            <input
              type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password" required autoComplete="new-password"
              className={`${inputClass} mt-3`}
            />
            {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
            <button type="submit" disabled={isBusy} className={`mt-4 ${primaryBtnClass}`}>
              {isBusy ? 'Saving…' : 'Save new password'}
            </button>
          </form>
        )}

        {/* TMDB attribution, required by its API terms: shown under every view */}
        <div className="mt-6 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center gap-2.5">
          <img src="/tmdb-logo.svg" alt="TMDB" className="h-5 w-auto shrink-0 opacity-70" />
          <p className="text-[10px] leading-snug text-gray-400 dark:text-gray-500">
            Movie and TV data and images from TMDB. This product uses the TMDB API but is not
            endorsed or certified by TMDB.
            <br />
            Streaming availability from JustWatch
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default AccountModal;
