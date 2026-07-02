import { GoogleLogin } from '@react-oauth/google';
import { db } from '../db';

interface Props {
  onError?: (msg: string) => void;
}

// Renders Google's pre-built sign-in button.
// On success, exchanges the idToken with InstantDB.
// The clientName must match the name you set in the Instant dashboard Auth tab.
export default function GoogleLoginButton({ onError }: Props) {
  return (
    <GoogleLogin
      onSuccess={async ({ credential }) => {
        if (!credential) {
          onError?.('No credential returned from Google.');
          return;
        }
        try {
          await db.auth.signInWithIdToken({
            clientName: 'google-web',
            idToken: credential,
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : 'Sign-in failed.';
          onError?.(msg);
        }
      }}
      onError={() => onError?.('Google sign-in was cancelled or failed.')}
      useOneTap={false}
    />
  );
}
