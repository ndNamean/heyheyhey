import AuthGate from './components/AuthGate';
import AppShell from './AppShell';
import type { Profile } from './types';

export default function App() {
  return (
    <AuthGate>{(profile: Profile) => <AppShell profile={profile} />}</AuthGate>
  );
}
