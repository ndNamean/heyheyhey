import { useRef, useState } from 'react';
import { useLang, LANGUAGES, type LangCode } from '../i18n';

const OTHERS: LangCode[] = ['fr', 'zh', 'es', 'ar', 'pt', 'ru', 'ja', 'de', 'hi', 'id'];

export default function LanguageSelector() {
  const { lang, setLang, t } = useLang();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const othersActive = OTHERS.includes(lang);
  const activeMeta = LANGUAGES.find((l) => l.code === lang);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, position: 'relative' }}>
      {/* Vietnamese */}
      <button
        onClick={() => setLang('vi')}
        style={{
          fontSize: 12,
          padding: '5px 10px',
          minHeight: 32,
          borderRadius: 999,
          background: lang === 'vi' ? '#FDC216' : '#e8e8e8',
          color: '#111',
          fontWeight: lang === 'vi' ? 700 : 500,
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          whiteSpace: 'nowrap',
        }}
        title="Tiếng Việt"
      >
        {lang === 'vi' ? '●' : '○'} 🇻🇳 VI
      </button>

      {/* English */}
      <button
        onClick={() => setLang('en')}
        style={{
          fontSize: 12,
          padding: '5px 10px',
          minHeight: 32,
          borderRadius: 999,
          background: lang === 'en' ? '#FDC216' : '#e8e8e8',
          color: '#111',
          fontWeight: lang === 'en' ? 700 : 500,
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          whiteSpace: 'nowrap',
        }}
        title="English"
      >
        {lang === 'en' ? '●' : '○'} 🇬🇧 EN
      </button>

      {/* Others dropdown trigger */}
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        style={{
          fontSize: 12,
          padding: '5px 10px',
          minHeight: 32,
          borderRadius: 999,
          background: othersActive ? '#FDC216' : '#e8e8e8',
          color: '#111',
          fontWeight: othersActive ? 700 : 500,
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          whiteSpace: 'nowrap',
        }}
        title={t.lang.others}
      >
        {othersActive ? '●' : '○'}{' '}
        {othersActive ? `${activeMeta?.flag} ${lang.toUpperCase()}` : t.lang.others}
        {' '}▾
      </button>

      {/* Dropdown */}
      {open && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 199 }}
            onClick={() => setOpen(false)}
          />
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              right: 0,
              zIndex: 200,
              background: '#fff',
              border: '1px solid #eee',
              borderRadius: 14,
              boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
              overflow: 'hidden',
              minWidth: 200,
            }}
          >
            {OTHERS.map((code) => {
              const meta = LANGUAGES.find((l) => l.code === code)!;
              const active = lang === code;
              return (
                <button
                  key={code}
                  onClick={() => { setLang(code); setOpen(false); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    width: '100%',
                    textAlign: 'left',
                    background: active ? '#fff8e1' : 'transparent',
                    border: 'none',
                    borderBottom: '1px solid #f5f5f5',
                    padding: '11px 16px',
                    fontSize: 13,
                    fontWeight: active ? 700 : 400,
                    color: '#111',
                    cursor: 'pointer',
                    minHeight: 0,
                    borderRadius: 0,
                  }}
                >
                  <span style={{ fontSize: 18 }}>{meta.flag}</span>
                  <span style={{ flex: 1 }}>{meta.label}</span>
                  <span style={{ fontSize: 11, color: '#999' }}>{meta.english}</span>
                  {active && <span style={{ color: '#FDC216', fontWeight: 900 }}>●</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
