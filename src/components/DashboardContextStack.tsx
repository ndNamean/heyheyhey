import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import {
  useDashboardSectionSpy,
  type DashContextSection,
} from '../hooks/useDashboardSectionSpy';

interface Props {
  pageRef: RefObject<HTMLElement | null>;
}

const DESKTOP_VISIBLE_PREVIOUS = 2;
const MOBILE_MQ = '(max-width: 800px)';
const DOCK_SCROLL_DISTANCE = 180;
const DOCK_LIT_THRESHOLD = 0.2;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    block: 'start',
  });
}

function SectionButton({
  section,
  kind,
  onNavigate,
  itemRef,
}: {
  section: DashContextSection;
  kind: 'active' | 'previous' | 'menu';
  onNavigate: (id: string) => void;
  itemRef?: RefObject<HTMLButtonElement | null>;
}) {
  const levelClass =
    section.level === 'h3'
      ? ' is-h3'
      : section.level === 'h1'
        ? ' is-h1'
        : ' is-h2';
  const kindClass = kind === 'active' ? ' is-active' : kind === 'previous' ? ' is-previous' : '';

  return (
    <button
      ref={itemRef}
      type="button"
      className={`dashboard-context-item${kindClass}${levelClass}`}
      aria-current={kind === 'active' ? 'location' : undefined}
      onClick={() => onNavigate(section.id)}
    >
      <span className="dashboard-context-item-label">{section.label}</span>
    </button>
  );
}

export default function DashboardContextStack({ pageRef }: Props) {
  const stackRef = useRef<HTMLElement | null>(null);
  const activeItemRef = useRef<HTMLButtonElement | null>(null);
  const [stackHeight, setStackHeight] = useState(0);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(MOBILE_MQ).matches : false,
  );
  const [collapsedOpen, setCollapsedOpen] = useState(false);
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const collapsePanelId = useId();
  const sectionsPanelId = useId();
  const collapseWrapRef = useRef<HTMLDivElement | null>(null);
  const sectionsWrapRef = useRef<HTMLDivElement | null>(null);

  const { sections, activeId, trailIds } = useDashboardSectionSpy(pageRef, stackHeight);

  const sectionById = useMemo(() => {
    const map = new Map<string, DashContextSection>();
    for (const s of sections) map.set(s.id, s);
    return map;
  }, [sections]);

  const trailSections = useMemo(
    () => trailIds.map((id) => sectionById.get(id)).filter(Boolean) as DashContextSection[],
    [trailIds, sectionById],
  );

  const activeSection = activeId ? sectionById.get(activeId) ?? null : null;
  const previousSections = trailSections.filter((s) => s.id !== activeId);

  const overflowPrevious =
    previousSections.length > DESKTOP_VISIBLE_PREVIOUS
      ? previousSections.slice(0, previousSections.length - DESKTOP_VISIBLE_PREVIOUS)
      : [];
  const visiblePrevious =
    previousSections.length > DESKTOP_VISIBLE_PREVIOUS
      ? previousSections.slice(-DESKTOP_VISIBLE_PREVIOUS)
      : previousSections;

  const publishHeight = useCallback(() => {
    const page = pageRef.current;
    const stack = stackRef.current;
    if (!page || !stack) return;
    const height = Math.round(stack.getBoundingClientRect().height);
    setStackHeight(height);
    page.style.setProperty('--dash-context-height', `${height}px`);
  }, [pageRef]);

  useEffect(() => {
    const stack = stackRef.current;
    if (!stack) return;
    publishHeight();
    const ro = new ResizeObserver(() => publishHeight());
    ro.observe(stack);
    return () => ro.disconnect();
  }, [publishHeight, isMobile, collapsedOpen, sectionsOpen, trailIds.length, activeId]);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_MQ);
    const onChange = () => {
      setIsMobile(media.matches);
      setCollapsedOpen(false);
      setSectionsOpen(false);
    };
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const navigate = useCallback((id: string) => {
    setCollapsedOpen(false);
    setSectionsOpen(false);
    scrollToSection(id);
  }, []);

  useEffect(() => {
    if (!collapsedOpen && !sectionsOpen) return;

    const onPointerDown = (event: MouseEvent | PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (collapsedOpen && collapseWrapRef.current && !collapseWrapRef.current.contains(target)) {
        setCollapsedOpen(false);
      }
      if (sectionsOpen && sectionsWrapRef.current && !sectionsWrapRef.current.contains(target)) {
        setSectionsOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCollapsedOpen(false);
        setSectionsOpen(false);
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [collapsedOpen, sectionsOpen]);

  useEffect(() => {
    const item = activeItemRef.current;
    if (!activeId || !item) return;

    let rafId = 0;
    const reducedMq = window.matchMedia('(prefers-reduced-motion: reduce)');

    const clearDock = (el: HTMLButtonElement) => {
      el.style.removeProperty('--dock-progress');
      el.style.removeProperty('--dock-max-shift');
      el.classList.remove('is-dock-lit');
    };

    const writeDockVars = () => {
      const el = activeItemRef.current;
      if (!el) return;

      const label = el.querySelector<HTMLElement>('.dashboard-context-item-label');
      const styles = getComputedStyle(el);
      const padL = parseFloat(styles.paddingLeft) || 0;
      const padR = parseFloat(styles.paddingRight) || 0;
      const available = Math.max(0, el.clientWidth - padL - padR);
      const labelWidth = label?.getBoundingClientRect().width ?? 0;
      const maxShift = Math.max(0, (available - labelWidth) / 2);
      el.style.setProperty('--dock-max-shift', `${maxShift}px`);

      if (reducedMq.matches) {
        el.style.setProperty('--dock-progress', '1');
        el.classList.add('is-dock-lit');
        return;
      }

      const heading = document.getElementById(activeId);
      if (!heading) {
        el.style.setProperty('--dock-progress', '0');
        el.classList.remove('is-dock-lit');
        return;
      }

      const stuckLine = Math.max(0, Math.round(stackHeight));
      const raw = stuckLine - heading.getBoundingClientRect().top;
      const progress = Math.min(1, Math.max(0, raw / DOCK_SCROLL_DISTANCE));
      el.style.setProperty('--dock-progress', String(progress));
      el.classList.toggle('is-dock-lit', progress >= DOCK_LIT_THRESHOLD);
    };

    const schedule = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        writeDockVars();
      });
    };

    writeDockVars();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    reducedMq.addEventListener('change', schedule);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      reducedMq.removeEventListener('change', schedule);
      if (activeItemRef.current) clearDock(activeItemRef.current);
    };
  }, [activeId, stackHeight]);

  if (!sections.length) return null;

  return (
    <nav
      ref={stackRef}
      className="dashboard-context-stack"
      aria-label="Dashboard sections"
    >
      {isMobile ? (
        <div className="dashboard-context-mobile">
          <div className="dashboard-context-sections-wrap" ref={sectionsWrapRef}>
            <button
              type="button"
              className="dashboard-context-sections-trigger"
              aria-expanded={sectionsOpen}
              aria-controls={sectionsPanelId}
              onClick={() => setSectionsOpen((v) => !v)}
            >
              Sections ▾
            </button>
            {sectionsOpen && (
              <div id={sectionsPanelId} className="dashboard-context-menu">
                {sections.map((section) => (
                  <SectionButton
                    key={section.id}
                    section={section}
                    kind={section.id === activeId ? 'active' : 'menu'}
                    onNavigate={navigate}
                  />
                ))}
              </div>
            )}
          </div>
          {activeSection && (
            <SectionButton
              section={activeSection}
              kind="active"
              onNavigate={navigate}
              itemRef={activeItemRef}
            />
          )}
        </div>
      ) : (
        <div className="dashboard-context-desktop">
          {overflowPrevious.length > 0 && (
            <div className="dashboard-context-collapse-wrap" ref={collapseWrapRef}>
              <button
                type="button"
                className="dashboard-context-collapse-trigger"
                aria-expanded={collapsedOpen}
                aria-controls={collapsePanelId}
                onClick={() => setCollapsedOpen((v) => !v)}
              >
                ↑ {overflowPrevious.length} previous section
                {overflowPrevious.length === 1 ? '' : 's'}
              </button>
              {collapsedOpen && (
                <div id={collapsePanelId} className="dashboard-context-menu">
                  {overflowPrevious.map((section) => (
                    <SectionButton
                      key={section.id}
                      section={section}
                      kind="menu"
                      onNavigate={navigate}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
          {visiblePrevious.map((section) => (
            <SectionButton
              key={section.id}
              section={section}
              kind="previous"
              onNavigate={navigate}
            />
          ))}
          {activeSection && (
            <SectionButton
              section={activeSection}
              kind="active"
              onNavigate={navigate}
              itemRef={activeItemRef}
            />
          )}
        </div>
      )}
    </nav>
  );
}
