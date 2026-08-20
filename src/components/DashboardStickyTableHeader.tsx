import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';

interface DashboardStickyTableHeaderProps {
  labels: string[];
  tableRef: RefObject<HTMLTableElement | null>;
  scrollerRef: RefObject<HTMLElement | null>;
  topOffset?: number;
}

export default function DashboardStickyTableHeader({
  labels,
  tableRef,
  scrollerRef,
  topOffset = 0,
}: DashboardStickyTableHeaderProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [columnWidths, setColumnWidths] = useState<number[]>([]);

  const topStyle = useMemo(
    () =>
      ({
        '--dash-sticky-top': `${Math.max(0, Math.round(topOffset))}px`,
      }) as CSSProperties,
    [topOffset],
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

  if (!labels.length) return null;

  return (
    <div className="dash-sticky-thead-slot" style={topStyle}>
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
