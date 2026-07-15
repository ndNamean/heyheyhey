import { usePwaInstall } from '../hooks/usePwaInstall';
import { useLang } from '../i18n';

export default function InstallAppCard({
  compact = false,
  onContinue,
}: {
  compact?: boolean;
  onContinue?: () => void;
}) {
  const { t } = useLang();
  const install = usePwaInstall();

  if (install.installed || install.standalone) {
    return (
      <div className="alert-success" style={{ marginTop: compact ? 0 : 12 }}>
        <p className="small" style={{ margin: 0 }}>{t.invite.installedReady}</p>
        {onContinue && (
          <button className="btn-gold" style={{ width: '100%', marginTop: 12 }} onClick={onContinue}>
            {t.invite.openApp}
          </button>
        )}
      </div>
    );
  }

  if (!install.showInstallCard) {
    return onContinue ? (
      <button className="btn-gold" style={{ width: '100%', marginTop: 12 }} onClick={onContinue}>
        {t.invite.continueInBrowser}
      </button>
    ) : null;
  }

  return (
    <div className="alert-info" style={{ marginTop: compact ? 0 : 12 }}>
      <p className="small alert-info-title" style={{ margin: '0 0 8px' }}>
        {t.invite.installTitle}
      </p>
      <p className="small" style={{ margin: '0 0 12px' }}>
        {install.isEmbeddedBrowser
          ? t.invite.embeddedBrowserHint
          : install.showIosGuide
            ? t.invite.iosHint
            : install.canNativeInstall
              ? t.invite.androidHint
              : t.invite.installUnavailableHint}
      </p>

      {install.showIosGuide && (
        <ol className="small" style={{ margin: '0 0 12px', paddingLeft: 18 }}>
          <li>{t.invite.iosStep1}</li>
          <li>{t.invite.iosStep2}</li>
          <li>{t.invite.iosStep3}</li>
          <li>{t.invite.iosStep4}</li>
        </ol>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {install.canNativeInstall && (
          <button
            className="btn-gold"
            onClick={() => void install.promptInstall()}
          >
            {install.isAndroid ? t.invite.installApp : t.invite.installDesktop}
          </button>
        )}
        {install.showIosGuide && (
          <button className="secondary" onClick={install.dismissGuidance}>
            {t.invite.iosDone}
          </button>
        )}
        <button
          className="secondary"
          onClick={() => {
            install.dismissGuidance();
            onContinue?.();
          }}
        >
          {t.invite.continueInBrowser}
        </button>
      </div>
    </div>
  );
}
