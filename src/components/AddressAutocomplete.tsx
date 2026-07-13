import { useEffect, useRef, useState } from 'react';
import { useLang } from '../i18n';
import { searchNominatim, type NominatimResult } from '../lib/nominatim';

const DEBOUNCE_MS = 400;
const MIN_QUERY_LEN = 3;

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSelect: (result: NominatimResult) => void;
  placeholder?: string;
}

export default function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder,
}: Props) {
  const { t } = useLang();
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const skipSearchRef = useRef(false);
  const requestSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastUserInputRef = useRef(value);

  function closeDropdown() {
    setOpen(false);
    setResults([]);
    setActiveIndex(-1);
  }

  function pickResult(r: NominatimResult) {
    skipSearchRef.current = true;
    lastUserInputRef.current = r.display_name;
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    closeDropdown();
    setSearching(false);
    onSelect(r);
  }

  useEffect(() => {
    if (skipSearchRef.current) {
      skipSearchRef.current = false;
      return;
    }

    if (value !== lastUserInputRef.current) return;

    const q = value.trim();
    if (q.length < MIN_QUERY_LEN) {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      closeDropdown();
      setSearching(false);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const seq = ++requestSeqRef.current;
      setSearching(true);

      const hits = await searchNominatim(q, controller.signal);

      if (seq !== requestSeqRef.current) return;
      setSearching(false);
      setResults(hits);
      setOpen(hits.length > 0);
      setActiveIndex(-1);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value]);

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) {
      if (e.key === 'Escape') closeDropdown();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i < results.length - 1 ? i + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i > 0 ? i - 1 : results.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const idx = activeIndex >= 0 ? activeIndex : 0;
      pickResult(results[idx]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeDropdown();
    }
  }

  return (
    <div className="map-search-wrap" style={{ marginTop: 4 }}>
      <input
        value={value}
        onChange={(e) => {
          lastUserInputRef.current = e.target.value;
          onChange(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        style={{ width: '100%' }}
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
      />
      {searching && (
        <span className="small address-autocomplete-loading">{t.common.searching}</span>
      )}

      {open && results.length > 0 && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 399 }}
            onClick={closeDropdown}
          />
          <div className="map-search-dropdown">
            {results.map((r, i) => (
              <button
                key={r.place_id}
                type="button"
                className={`map-search-item${i === activeIndex ? ' active' : ''}`}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => pickResult(r)}
              >
                {r.display_name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
