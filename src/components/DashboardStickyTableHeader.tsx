import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';

interface DashboardStickyTableHeaderProps {
  labels: string[];
  tableRef: RefObject<HTMLTableElement | null>;
  scrollerRef: RefObject<HTMLElement | null>;
  topOffset?: number;
}

/**
 * Visual sticky table-header clone for dashboard tables that must keep
 * overflow-x on the scroller. Hidden while the real <thead> is still visible
 * so it does not overlay the first rows at rest.
 */
export default function DashboardStickyTableHeader({
  labels,
  tableRef,
  scrollerRef,
  topOffset = 0,
}: DashboardStickyTableHeaderProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [columnWidths, setColumnWidths] = useState<number[]>([]);
  const [pinned, setPinned] = useState(false);
  const [desktopStickyTitle, setDesktopStickyTitle] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 801px)').matches : true,
  );

  // Desktop may stack under a sticky section title; ≤800px titles are static so pin at 0.
  const safeTopOffset = desktopStickyTitle ? Math.max(0, Math.round(topOffset)) : 0;

  useEffect(() => {
    const media = window.matchMedia('(min-width: 801px)');
    const onChange = () => setDesktopStickyTitle(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const topStyle = useMemo(
    () =>
      ({
        '--dash-sticky-top': `${safeTopOffset}px`,
      }) as CSSProperties,
    [safeTopOffset],
  );

  useEffect(() => {
    const table = tableRef.current;
    const scroller = scrollerRef.current;
    if (!table || !scroller) return;

    let rafId = 0;
    const updateHorizontalOffset = () => {
      rafId = requestAnimationFrame(() => {
        if (!trackRef.current) return;
        trackRef.current.style.transform = `translate3d(${-scroller.scrollLeft}px, 0, 0)`;
      });
    };

    const readHeaderWidths = () => {
      const headRow = table.tHead?.rows?.[0];
      if (!headRow) return;
      const nextWidths = Array.from(headRow.cells).map((cell) =>
        Math.round((cell as HTMLTableCellElement).offsetWidth),
      );
      setColumnWidths(nextWidths);
      updateHorizontalOffset();
    };

    const resizeObserver = new ResizeObserver(() => {
      readHeaderWidths();
    });
    resizeObserver.observe(table);
    readHeaderWidths();

    const onScroll = () => {
      updateHorizontalOffset();
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      scroller.removeEventListener('scroll', onScroll);
      resizeObserver.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [scrollerRef, tableRef]);

  useEffect(() => {
    const table = tableRef.current;
    const thead = table?.tHead;
    if (!thead) return;

    // Shrink the observation root from the top by the sticky offset so the
    // clone appears only after the real thead has passed the pin line.
    const observer = new IntersectionObserver(
      ([entry]) => {
        setPinned(!entry.isIntersecting);
      },
      {
        root: null,
        rootMargin: `-${safeTopOffset + 1}px 0px 0px 0px`,
        threshold: 0,
      },
    );
    observer.observe(thead);
    return () => observer.disconnect();
  }, [tableRef, safeTopOffset, labels.length]);

  if (!labels.length) return null;

  return (
    <div
      className={`dash-sticky-thead-slot${pinned ? ' is-pinned' : ''}`}
      style={topStyle}
    >
      <div className="dash-sticky-thead" aria-hidden="true">
        <div className="dash-sticky-thead-track" ref={trackRef}>
          {labels.map((label, index) => (
            <div
              key={`${label}-${index}`}
              className="dash-sticky-thead-cell"
              style={columnWidths[index] ? { width: `${columnWidths[index]}px` } : undefined}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
