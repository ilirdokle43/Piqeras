import { useEffect } from 'react';
import { useI18n, useT } from './i18n';
import { useAuth } from './state/auth';
import { useRouter } from './lib/router';
import { WelcomeScreen } from './screens/WelcomeScreen';
import { SignInScreen } from './screens/SignInScreen';
import { PendingScreen } from './screens/PendingScreen';
import { LinkAccountScreen } from './screens/LinkAccountScreen';
import { HomeScreen } from './screens/HomeScreen';
import { MyResponseScreen } from './screens/MyResponseScreen';
import { GroupResponsesScreen } from './screens/GroupResponsesScreen';
import { OrganizerScreen } from './screens/OrganizerScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { TripDetailScreen } from './screens/TripDetailScreen';
import { Background } from './components/Background';
import { Banner, Spinner } from './components/ui';
import { touchExistingToken } from './lib/push';

function Splash({ label }: { label: string }) {
  return (
    <>
      <Background imageUrl={null} />
      <main className="screen">
        <div className="column" style={{ justifyContent: 'center' }}>
          <Spinner label={label} />
        </div>
      </main>
    </>
  );
}

export function App() {
  const t = useT();
  const { locale } = useI18n();
  const { status, uid, isOrganizer, error, retry } = useAuth();
  const { route, navigate, back } = useRouter();

  // Keep an already-granted push registration fresh, without ever prompting:
  // a token can be rotated by the browser and would otherwise go stale.
  useEffect(() => {
    if (status === 'ready' && uid) void touchExistingToken(uid, locale);
  }, [status, uid, locale]);

  switch (status) {
    case 'loading':
      return <Splash label={t('loading')} />;

    // The page is about to unload on its way to Google.
    case 'redirecting':
      return <Splash label={t('redirecting')} />;

    case 'error':
      return (
        <>
          <Background imageUrl={null} />
          <main className="screen">
            <div className="column" style={{ justifyContent: 'center', gap: 'var(--sp-4)' }}>
              <Banner tone="error">
                {error && typeof error === 'object' && 'code' in error
                  ? `${t('genericError')} (${String((error as { code?: string }).code)})`
                  : t('genericError')}
              </Banner>
              <button type="button" className="btn btn--primary btn--block" onClick={retry}>
                {t('retryAction')}
              </button>
            </div>
          </main>
        </>
      );

    // Nothing about the trip is reachable from here down.
    case 'signedOut':
      return <SignInScreen />;

    case 'needsLink':
      return <LinkAccountScreen />;

    case 'needsName':
      return <WelcomeScreen />;

    case 'pending':
      return <PendingScreen />;

    // Terminal. Access initialization stops rather than continuing as whichever
    // account the link ended on.
    case 'linkMismatch':
      return (
        <>
          <Background imageUrl={null} />
          <main className="screen">
            <div className="column" style={{ justifyContent: 'center', gap: 'var(--sp-4)' }}>
              <div className="panel stack">
                <p className="modal__title">{t('linkMismatchTitle')}</p>
                <Banner tone="error">{t('linkMismatchBody')}</Banner>
                <p className="body">{t('linkMismatchHelp')}</p>
              </div>
            </div>
          </main>
        </>
      );

    case 'ready':
      break;
  }

  // An organizer route reached by a member — by a stale deep link, or because
  // their role was just revoked — falls back to home rather than rendering a
  // dashboard whose every write the server would reject anyway.
  if (route.name === 'organizer' && !isOrganizer) {
    return <HomeScreen navigate={navigate} />;
  }

  switch (route.name) {
    case 'respond':
      return <MyResponseScreen onBack={back} />;
    case 'responses':
      return <GroupResponsesScreen onBack={back} />;
    case 'organizer':
      return <OrganizerScreen onBack={back} />;
    case 'history':
      return (
        <HistoryScreen
          onBack={back}
          onOpenTrip={(tripId) => navigate({ name: 'trip', tripId })}
        />
      );
    case 'trip':
      return <TripDetailScreen tripId={route.tripId} onBack={back} />;
    default:
      return <HomeScreen navigate={navigate} />;
  }
}
