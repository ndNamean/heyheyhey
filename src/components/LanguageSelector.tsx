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
    <div className="lang-selector">
      <button
        className={`lang-btn${lang === 'vi' ? ' active' : ''}`}
        onClick={() => setLang('vi')}
        title="Tiếng Việt"
      >
        {lang === 'vi' ? '●' : '○'} 🇻🇳 VI
      </button>

      <button
        className={`lang-btn${lang === 'en' ? ' active' : ''}`}
        onClick={() => setLang('en')}
        title="English"
      >
        {lang === 'en' ? '●' : '○'} 🇬🇧 EN
      </button>

      <button
        ref={btnRef}
        className={`lang-btn${othersActive ? ' active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={t.lang.others}
      >
        {othersActive ? '●' : '○'}{' '}
        {othersActive ? `${activeMeta?.flag} ${lang.toUpperCase()}` : t.lang.others}
        {' '}▾
      </button>

      {open && (
        <>
          <div className="lang-backdrop" onClick={() => setOpen(false)} />
          <div className="lang-dropdown">
            {OTHERS.map((code) => {
              const meta = LANGUAGES.find((l) => l.code === code)!;
              const active = lang === code;
              return (
                <button
                  key={code}
                  className={`lang-dropdown-item${active ? ' active' : ''}`}
                  onClick={() => { setLang(code); setOpen(false); }}
                >
                  <span style={{ fontSize: 18 }}>{meta.flag}</span>
                  <span style={{ flex: 1 }}>{meta.label}</span>
                  <span className="lang-dropdown-item-meta">{meta.english}</span>
                  {active && <span className="lang-dropdown-item-dot">●</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
