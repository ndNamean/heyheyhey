import AuthGate from './components/AuthGate';
import AppShell from './AppShell';
import { RoleDefinitionsProvider } from './contexts/RoleDefinitionsContext';
import type { Profile } from './types';

export default function App() {
  return (
    <AuthGate>
      {(profile: Profile) => (
        <RoleDefinitionsProvider profile={profile}>
          <AppShell profile={profile} />
        </RoleDefinitionsProvider>
      )}
    </AuthGate>
  );
}
