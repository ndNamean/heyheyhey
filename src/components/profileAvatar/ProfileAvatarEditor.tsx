import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLang } from '../../i18n';
import { useNativeBack, BACK_PRIORITY } from '../../lib/nativeBack';
import {
  AVATAR_ACCEPT,
  removeAvatar,
  removeBackground,
  uploadAvatar,
  validateAvatarFile,
} from '../../lib/avatarClient';
import {
  type AvatarBackgroundChoice,
  canvasToPngBlob,
  composeAvatarCanvas,
  loadFileAsImage,
  pickBestContrastPreset,
  resolveBackgroundChoice,
  sampleAverageLuminance,
} from '../../lib/avatarCompose';
import type { Profile } from '../../types';
import ProfileAvatar from './ProfileAvatar';
import ImageCropEditor from './ImageCropEditor';
import AvatarBackgroundSelector from './AvatarBackgroundSelector';

type Step = 'idle' | 'source' | 'crop' | 'compose' | 'ai_preview';

interface Props {
  profile: Profile;
}

export default function ProfileAvatarEditor({ profile }: Props) {
  const { t } = useLang();
  const [step, setStep] = useState<Step>('idle');
  const [rawSrc, setRawSrc] = useState<string | null>(null);
  const [croppedBlob, setCroppedBlob] = useState<Blob | null>(null);
  const [croppedUrl, setCroppedUrl] = useState<string | null>(null);
  const [portraitUrl, setPortraitUrl] = useState<string | null>(null);
  const [originalPortraitUrl, setOriginalPortraitUrl] = useState<string | null>(null);
  const [aiUrl, setAiUrl] = useState<string | null>(null);
  const [usingAi, setUsingAi] = useState(false);
  const [bgChoice, setBgChoice] = useState<AvatarBackgroundChoice>({ kind: 'best_contrast' });
  const [resolvedPreset, setResolvedPreset] = useState(() => pickBestContrastPreset(128));
  const [logoEnabled, setLogoEnabled] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<string | null>(null);

  const open = step !== 'idle';

  useNativeBack(
    () => {
      if (step === 'idle') return false;
      handleBack();
      return true;
    },
    open,
    BACK_PRIORITY.MODAL,
  );

  function revoke(url: string | null) {
    if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
  }

  function setPreview(next: string | null) {
    if (previewRef.current && previewRef.current !== next) {
      revoke(previewRef.current);
    }
    previewRef.current = next;
    setPreviewUrl(next);
  }

  function resetFlow() {
    revoke(rawSrc);
    revoke(croppedUrl);
    if (originalPortraitUrl && originalPortraitUrl !== croppedUrl) revoke(originalPortraitUrl);
    if (aiUrl && aiUrl !== portraitUrl) revoke(aiUrl);
    setPreview(null);
    setRawSrc(null);
    setCroppedBlob(null);
    setCroppedUrl(null);
    setPortraitUrl(null);
    setOriginalPortraitUrl(null);
    setAiUrl(null);
    setUsingAi(false);
    setBgChoice({ kind: 'best_contrast' });
    setLogoEnabled(true);
    setAiError(null);
    setErrorMsg(null);
    setUploadProgress(0);
    setStep('idle');
  }

  function handleBack() {
    if (step === 'ai_preview') {
      setStep('compose');
      return;
    }
    if (step === 'compose') {
      setStep('crop');
      return;
    }
    if (step === 'crop') {
      revoke(rawSrc);
      setRawSrc(null);
      setStep('source');
      return;
    }
    resetFlow();
  }

  function openEditor() {
    setSuccessMsg(null);
    setErrorMsg(null);
    setStep('source');
  }

  async function onFilePicked(file: File | undefined) {
    if (!file) return;
    const err = validateAvatarFile(file);
    if (err === 'unsupportedType') {
      setErrorMsg(t.profile.avatarUnsupportedType);
      return;
    }
    if (err === 'fileTooLarge') {
      setErrorMsg(t.profile.avatarFileTooLarge);
      return;
    }
    setErrorMsg(null);
    revoke(rawSrc);
    const url = URL.createObjectURL(file);
    setRawSrc(url);
    setStep('crop');
  }

  async function onCropped(blob: Blob) {
    revoke(croppedUrl);
    if (aiUrl) revoke(aiUrl);
    const url = URL.createObjectURL(blob);
    setCroppedBlob(blob);
    setCroppedUrl(url);
    setOriginalPortraitUrl(url);
    setPortraitUrl(url);
    setAiUrl(null);
    setUsingAi(false);
    setStep('compose');
  }

  useEffect(() => {
    if (step !== 'compose' || !portraitUrl) return;
    let cancelled = false;

    (async () => {
      setComposing(true);
      try {
        const img = await loadFileAsImage(await (await fetch(portraitUrl)).blob());
        const probe = document.createElement('canvas');
        probe.width = 64;
        probe.height = 64;
        const pctx = probe.getContext('2d');
        if (!pctx) return;
        pctx.drawImage(img, 0, 0, 64, 64);
        const lum = sampleAverageLuminance(pctx.getImageData(0, 0, 64, 64));
        const best = pickBestContrastPreset(lum);
        if (!cancelled) setResolvedPreset(best);

        const resolved = resolveBackgroundChoice(bgChoice, lum);
        const canvas = await composeAvatarCanvas({
          portrait: img,
          background: resolved,
          logoEnabled,
        });
        const blob = await canvasToPngBlob(canvas);
        if (cancelled) return;
        setPreview(URL.createObjectURL(blob));
      } catch (e) {
        if (!cancelled) {
          setErrorMsg(e instanceof Error ? e.message : t.profile.avatarComposeFailed);
        }
      } finally {
        if (!cancelled) setComposing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [step, portraitUrl, bgChoice, logoEnabled, t.profile.avatarComposeFailed]);

  async function runAiRemoval() {
    if (!croppedBlob) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const result = await removeBackground(croppedBlob, croppedBlob.type || 'image/png');
      if (aiUrl) revoke(aiUrl);
      setAiUrl(URL.createObjectURL(result.blob));
      setStep('ai_preview');
    } catch (e) {
      setAiError(e instanceof Error ? e.message : t.profile.avatarAiFailed);
    } finally {
      setAiBusy(false);
    }
  }

  function useAiResult() {
    if (!aiUrl) return;
    setPortraitUrl(aiUrl);
    setUsingAi(true);
    setStep('compose');
  }

  function restoreOriginal() {
    if (!originalPortraitUrl) return;
    setPortraitUrl(originalPortraitUrl);
    setUsingAi(false);
    setAiError(null);
    setStep('compose');
  }

  async function handleSave() {
    if (!previewUrl || uploading) return;
    setUploading(true);
    setUploadProgress(20);
    setErrorMsg(null);
    try {
      const blob = await (await fetch(previewUrl)).blob();
      setUploadProgress(60);
      await uploadAvatar(blob, 'image/png');
      setUploadProgress(100);
      setSuccessMsg(t.profile.avatarUpdated);
      resetFlow();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : t.profile.avatarUploadFailed);
      setUploadProgress(0);
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove() {
    if (!profile.avatarUrl?.trim()) return;
    if (!window.confirm(t.profile.avatarRemoveConfirm)) return;
    setUploading(true);
    setErrorMsg(null);
    try {
      await removeAvatar();
      setSuccessMsg(t.profile.avatarRemoved);
      resetFlow();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : t.profile.avatarRemoveFailed);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="card profile-avatar-card">
      <div className="profile-avatar-hero">
        <div className="profile-avatar-hero-photo">
          <ProfileAvatar profile={profile} size={96} />
          <button
            type="button"
            className="profile-avatar-edit-fab"
            onClick={openEditor}
            aria-label={t.profile.editProfilePhoto}
          >
            ✎
          </button>
        </div>
        <div>
          <button type="button" className="secondary" onClick={openEditor} style={{ fontSize: 13 }}>
            {t.profile.editProfilePhoto}
          </button>
        </div>
      </div>
      {successMsg && <div className="alert-success" style={{ marginTop: 12 }}>{successMsg}</div>}

      {open && createPortal(
        <div className="profile-avatar-overlay" role="dialog" aria-modal="true">
          <div className="profile-avatar-sheet">
            <div className="profile-avatar-sheet-header">
              <button type="button" className="secondary" onClick={handleBack} disabled={uploading || aiBusy}>
                {step === 'source' ? t.common.cancel : t.common.back}
              </button>
              <strong>{t.profile.editProfilePhoto}</strong>
              <span style={{ width: 72 }} />
            </div>

            {errorMsg && <div className="alert-info" style={{ marginBottom: 8 }}>{errorMsg}</div>}

            {step === 'source' && (
              <div className="profile-avatar-source-actions">
                <button type="button" onClick={() => cameraRef.current?.click()}>
                  {t.profile.avatarTakePhoto}
                </button>
                <button type="button" className="secondary" onClick={() => fileRef.current?.click()}>
                  {t.profile.avatarChooseDevice}
                </button>
                {!!profile.avatarUrl?.trim() && (
                  <button type="button" className="danger" onClick={handleRemove} disabled={uploading}>
                    {t.profile.avatarRemove}
                  </button>
                )}
              </div>
            )}

            {step === 'crop' && rawSrc && (
              <ImageCropEditor imageSrc={rawSrc} onCancel={handleBack} onContinue={onCropped} />
            )}

            {step === 'compose' && (
              <div className="profile-avatar-step profile-avatar-compose">
                <div className="profile-avatar-previews">
                  <div>
                    <div className="small">{t.profile.avatarCircularPreview}</div>
                    <div className="profile-avatar-preview-circle">
                      {previewUrl
                        ? <img src={previewUrl} alt="" />
                        : <div className="small">{composing ? t.common.loading : '—'}</div>}
                    </div>
                  </div>
                  <div>
                    <div className="small">{t.profile.avatarSquarePreview}</div>
                    <div className="profile-avatar-preview-square">
                      {previewUrl
                        ? <img src={previewUrl} alt="" />
                        : <div className="small">{composing ? t.common.loading : '—'}</div>}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  className="secondary"
                  onClick={runAiRemoval}
                  disabled={aiBusy || !croppedBlob || uploading}
                  style={{ width: '100%', marginBottom: 8 }}
                >
                  {aiBusy ? t.profile.avatarAiProcessing : t.profile.avatarRemoveBgAi}
                </button>
                {aiError && <p className="small" style={{ color: 'var(--danger)' }}>{aiError}</p>}
                {usingAi && (
                  <button type="button" className="secondary" onClick={restoreOriginal} style={{ width: '100%', marginBottom: 8 }}>
                    {t.profile.avatarUseOriginal}
                  </button>
                )}

                <AvatarBackgroundSelector
                  value={bgChoice}
                  resolvedPreset={resolvedPreset}
                  onChange={setBgChoice}
                  previewUrl={portraitUrl}
                />

                <label className="profile-avatar-logo-toggle">
                  <input
                    type="checkbox"
                    checked={logoEnabled}
                    onChange={(e) => setLogoEnabled(e.target.checked)}
                  />
                  {t.profile.avatarIncludeLogo}
                </label>

                {uploading && (
                  <div className="profile-avatar-progress">
                    <div className="profile-avatar-progress-bar" style={{ width: `${uploadProgress}%` }} />
                    <span className="small">{t.profile.avatarUploading}</span>
                  </div>
                )}

                <div className="capture-actions">
                  <button type="button" className="secondary" onClick={resetFlow} disabled={uploading}>
                    {t.profile.avatarReset}
                  </button>
                  <button type="button" onClick={handleSave} disabled={uploading || composing || !previewUrl}>
                    {uploading ? t.profile.avatarUploading : t.profile.avatarSave}
                  </button>
                </div>
              </div>
            )}

            {step === 'ai_preview' && (
              <div className="profile-avatar-step">
                <h2 style={{ marginTop: 0 }}>{t.profile.avatarAiPreviewTitle}</h2>
                <div className="profile-avatar-ai-compare">
                  <div>
                    <div className="small">{t.profile.avatarBefore}</div>
                    {originalPortraitUrl && <img src={originalPortraitUrl} alt="" />}
                  </div>
                  <div>
                    <div className="small">{t.profile.avatarAfter}</div>
                    {aiUrl && <img src={aiUrl} alt="" className="profile-avatar-checkerboard" />}
                  </div>
                </div>
                <div className="capture-actions" style={{ flexWrap: 'wrap' }}>
                  <button type="button" className="secondary" onClick={() => setStep('compose')}>
                    {t.common.cancel}
                  </button>
                  <button type="button" className="secondary" onClick={runAiRemoval} disabled={aiBusy}>
                    {t.common.retry}
                  </button>
                  <button type="button" className="secondary" onClick={restoreOriginal}>
                    {t.profile.avatarUseOriginal}
                  </button>
                  <button type="button" onClick={useAiResult} disabled={!aiUrl}>
                    {t.profile.avatarUseAiResult}
                  </button>
                </div>
              </div>
            )}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept={AVATAR_ACCEPT}
            hidden
            onChange={(e) => {
              void onFilePicked(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <input
            ref={cameraRef}
            type="file"
            accept={AVATAR_ACCEPT}
            capture="user"
            hidden
            onChange={(e) => {
              void onFilePicked(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>,
        document.body,
      )}
    </div>
  );
}
