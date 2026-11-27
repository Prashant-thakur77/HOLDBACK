import { Redirect } from 'expo-router';

/**
 * Landing route for `holdback://auth`, the redirect of Pollar's social login.
 * The Pollar client finishes the login by itself; this only sends the user
 * back into the app instead of showing a "not found" page.
 */
export default function AuthRedirect() {
  return <Redirect href="/" />;
}
