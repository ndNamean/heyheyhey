import { useCallback, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { useLang } from '../../i18n';
import { getCroppedImageBlob } from './cropImage';

interface Props {
  imageSrc: string;
  onCancel: () => void;
  onContinue: (blob: Blob) => void;
}

export default function ImageCropEditor({ imageSrc, onCancel, onContinue }: Props) {
  const { t } = useLang();
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);

  const onCropComplete = useCallback((_area: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
  }, []);

  async function handleContinue() {
    if (!croppedAreaPixels) return;
    setBusy(true);
    try {
      const blob = await getCroppedImageBlob(imageSrc, croppedAreaPixels, rotation);
      onContinue(blob);
    } catch (e) {
      alert(e instanceof Error ? e.message : t.profile.avatarCropFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profile-avatar-step">
      <h2 style={{ marginTop: 0 }}>{t.profile.avatarCropTitle}</h2>
      <div className="profile-avatar-crop-wrap">
        <Cropper
          image={imageSrc}
          crop={crop}
          zoom={zoom}
          rotation={rotation}
          aspect={1}
          cropShape="round"
          showGrid={false}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onRotationChange={setRotation}
          onCropComplete={onCropComplete}
        />
      </div>
      <label className="profile-avatar-slider">
        <span>{t.profile.avatarZoom}</span>
        <input
          type="range"
          min={1}
          max={3}
          step={0.05}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
        />
      </label>
      <label className="profile-avatar-slider">
        <span>{t.profile.avatarRotate}</span>
        <input
          type="range"
          min={0}
          max={360}
          step={1}
          value={rotation}
          onChange={(e) => setRotation(Number(e.target.value))}
        />
      </label>
      <div className="capture-actions">
        <button type="button" className="secondary" onClick={onCancel} disabled={busy}>
          {t.common.cancel}
        </button>
        <button type="button" onClick={handleContinue} disabled={busy || !croppedAreaPixels}>
          {busy ? t.common.loading : t.profile.avatarContinue}
        </button>
      </div>
    </div>
  );
}
