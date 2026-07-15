import { useCallback, useEffect, useState } from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

function matchesStandalone() {
  if (typeof window === 'undefined') return false;
  const mq = window.matchMedia?.('(display-mode: standalone)');
  if (mq?.matches) return true;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return !!nav.standalone;
}

function detectIos() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return iOS;
}

function detectAndroid() {
  return /Android/i.test(navigator.userAgent || '');
}

function detectEmbeddedBrowser() {
  const ua = navigator.userAgent || '';
  return /FBAN|FBAV|Instagram|Line\/|Twitter|MicroMessenger|GSA\/|LinkedInApp|EdgA\//i.test(ua)
    || (/(iPhone|iPod|iPad).*AppleWebKit(?!.*Safari)/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua));
}

const DISMISS_KEY = 'pwaInstallDismissedAt';

export function useStandaloneMode() {
  const [standalone, setStandalone] = useState(matchesStandalone);

  useEffect(() => {
    const mq = window.matchMedia?.('(display-mode: standalone)');
    const onChange = () => setStandalone(matchesStandalone());
    mq?.addEventListener?.('change', onChange);
    window.addEventListener('appinstalled', onChange);
    return () => {
      mq?.removeEventListener?.('change', onChange);
      window.removeEventListener('appinstalled', onChange);
    };
  }, []);

  return {
    standalone,
    isIos: detectIos(),
    isAndroid: detectAndroid(),
    isEmbeddedBrowser: detectEmbeddedBrowser(),
  };
}

export function usePwaInstall() {
  const platform = useStandaloneMode();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(platform.standalone);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return !!localStorage.getItem(DISMISS_KEY);
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onBip);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBip);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  useEffect(() => {
    if (platform.standalone) setInstalled(true);
  }, [platform.standalone]);

  const promptInstall = useCallback(async () => {
    if (!deferred) return { outcome: 'unavailable' as const };
    await deferred.prompt();
    const choice = await deferred.userChoice;
    setDeferred(null);
    if (choice.outcome === 'accepted') setInstalled(true);
    return { outcome: choice.outcome };
  }, [deferred]);

  const dismissGuidance = useCallback(() => {
    try {
      localStorage.setItem(DISMISS_KEY, new Date().toISOString());
    } catch {
      /* ignore */
    }
    setDismissed(true);
  }, []);

  const canNativeInstall = !!deferred && !installed && !platform.standalone;
  const showIosGuide = platform.isIos && !installed && !platform.standalone && !dismissed;
  const showInstallCard = !installed && !platform.standalone && !dismissed;

  return {
    ...platform,
    installed,
    canNativeInstall,
    showIosGuide,
    showInstallCard,
    promptInstall,
    dismissGuidance,
  };
}
