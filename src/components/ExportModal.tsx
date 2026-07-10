import { useState } from 'react';
import { useLang } from '../i18n';
import {
  ackExportDownload,
  runExportFlow,
  triggerDownload,
  type CreateExportJobParams,
} from '../lib/exportClient';
import type { ExportFormat } from '../types';

export type ExportScopeOption = {
  value: string;
  label: string;
};

interface Props {
  open: boolean;
  onClose: () => void;
  exportType: CreateExportJobParams['exportType'];
  defaultFormat?: ExportFormat;
  scopeOptions: ExportScopeOption[];
  defaultScope: string;
  buildParams: (format: ExportFormat, scope: string, daysBack?: number) => CreateExportJobParams;
  showDaysBack?: boolean;
  defaultDaysBack?: number;
  title?: string;
}

type Phase = 'idle' | 'creating' | 'generating' | 'ready' | 'failed';

export default function ExportModal({
  open,
  onClose,
  exportType,
  defaultFormat = 'csv',
  scopeOptions,
  defaultScope,
  buildParams,
  showDaysBack = false,
  defaultDaysBack = 30,
  title,
}: Props) {
  const { t } = useLang();
  const [format, setFormat] = useState<ExportFormat>(defaultFormat);
  const [scope, setScope] = useState(defaultScope);
  const [daysBack, setDaysBack] = useState(defaultDaysBack);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [rowCount, setRowCount] = useState(0);
  const [truncated, setTruncated] = useState(false);

  if (!open) return null;

  async function handleExport() {
    setError('');
    setPhase('creating');

    try {
      const params = buildParams(format, scope, daysBack);
      const result = await runExportFlow(params, (p) => {
        if (p === 'creating') setPhase('creating');
        else if (p === 'generating') setPhase('generating');
        else if (p === 'ready') setPhase('ready');
        else if (p === 'failed') setPhase('failed');
      });

      setRowCount(result.rowCount);
      setTruncated(result.truncated);

      if (result.downloadUrl) {
        const ext = format === 'pdf' ? 'pdf' : 'csv';
        const prefix = exportType === 'dashboard' ? 'dashboard' : 'review-status';
        triggerDownload(result.downloadUrl, `${prefix}-export.${ext}`);
        await ackExportDownload(result.jobId);
      }

      setPhase('ready');
    } catch (e) {
      setPhase('failed');
      setError(e instanceof Error ? e.message : t.export.exportFailed);
    }
  }

  function handleClose() {
    setPhase('idle');
    setError('');
    onClose();
  }

  const busy = phase === 'creating' || phase === 'generating';

  return (
    <div className="export-modal-overlay" role="dialog" aria-modal="true">
      <div className="export-modal card">
        <h2 style={{ marginTop: 0 }}>{title ?? t.export.export}</h2>

        <div className="export-media-warning" role="alert">
          {t.export.mediaExpiryWarning}
        </div>

        <label>
          {t.export.formatLabel}
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as ExportFormat)}
            disabled={busy}
          >
            <option value="csv">{t.export.downloadCsv}</option>
            <option value="pdf">{t.export.downloadPdf}</option>
          </select>
        </label>

        {format === 'pdf' && (
          <p className="small">{t.export.pdfMayTakeLonger}</p>
        )}

        <label>
          {t.export.scopeLabel}
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            disabled={busy}
          >
            {scopeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        {showDaysBack && (
          <label>
            {t.export.daysBackLabel}
            <input
              type="number"
              min={1}
              max={365}
              value={daysBack}
              onChange={(e) => setDaysBack(Number(e.target.value) || 30)}
              disabled={busy}
            />
          </label>
        )}

        {phase === 'creating' || phase === 'generating' ? (
          <p className="export-status">{t.export.generating}</p>
        ) : null}

        {phase === 'ready' ? (
          <div className="export-status export-status-ready">
            <p>{t.export.fileReady}</p>
            {rowCount > 0 && (
              <p className="small">
                {t.export.rowCountLabel}: {rowCount}
                {truncated ? ` — ${t.export.truncatedWarning}` : ''}
              </p>
            )}
          </div>
        ) : null}

        {phase === 'failed' && error ? (
          <p className="export-status export-status-error">{error}</p>
        ) : null}

        <div className="export-modal-actions">
          <button type="button" className="secondary" onClick={handleClose} disabled={busy}>
            {t.export.close}
          </button>
          {phase === 'failed' ? (
            <button type="button" onClick={handleExport}>
              {t.export.retry}
            </button>
          ) : (
            <button type="button" onClick={handleExport} disabled={busy}>
              {busy ? t.export.generating : t.export.startExport}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
