import { useEffect, useRef, useState } from 'react';
import { useLang } from '../i18n';
import { exportTemplateAsExcel } from '../lib/templateExcelTransfer';
import { exportTemplateToFile } from '../lib/templateTransfer';
import type { Store, Template } from '../types';

interface Props {
  template: Template;
  allStores: Store[];
}

export default function TemplateExportMenu({ template, allStores }: Props) {
  const { t } = useLang();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [exporting, setExporting] = useState<'excel' | 'json' | null>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (detailsRef.current && !detailsRef.current.contains(e.target as Node)) {
        detailsRef.current.open = false;
      }
    }
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  function closeMenu() {
    if (detailsRef.current) detailsRef.current.open = false;
  }

  async function handleExcelExport() {
    if (exporting) return;
    setExporting('excel');
    try {
      exportTemplateAsExcel(template, allStores);
    } catch (e) {
      alert(e instanceof Error ? e.message : t.templates.exportFailed);
    } finally {
      setExporting(null);
      closeMenu();
    }
  }

  function handleJsonExport() {
    if (exporting) return;
    setExporting('json');
    try {
      exportTemplateToFile(template);
    } catch (e) {
      alert(e instanceof Error ? e.message : t.templates.exportFailed);
    } finally {
      setExporting(null);
      closeMenu();
    }
  }

  const busy = exporting !== null;

  return (
    <details ref={detailsRef} className="template-export-menu">
      <summary className="secondary template-export-trigger" aria-haspopup="menu">
        {busy ? t.templates.exporting : t.templates.export}
      </summary>
      <div className="template-export-dropdown" role="menu">
        <button
          type="button"
          role="menuitem"
          className="template-export-option"
          onClick={handleExcelExport}
          disabled={busy}
        >
          <span className="template-export-option-label">{t.templates.exportExcel}</span>
          <span className="template-export-option-hint">{t.templates.exportExcelHint}</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className="template-export-option"
          onClick={handleJsonExport}
          disabled={busy}
        >
          <span className="template-export-option-label">{t.templates.exportJsonBackup}</span>
          <span className="template-export-option-hint">{t.templates.exportJsonHint}</span>
        </button>
      </div>
    </details>
  );
}
