import { useEffect, useState, type RefObject } from 'react';

export type DashContextLevel = 'h1' | 'h2' | 'h3';

export interface DashContextSection {
  id: string;
  label: string;
  level: DashContextLevel;
  parentId?: string;
}

export interface DashboardSectionSpyResult {
  sections: DashContextSection[];
  activeId: string | null;
  trailIds: string[];
  stackBottom: number;
}

function readLevel(el: Element): DashContextLevel {
  const raw = el.getAttribute('data-dash-level');
  if (raw === 'h1' || raw === 'h2' || raw === 'h3') return raw;
  const tag = el.tagName.toLowerCase();
  if (tag === 'h1' || tag === 'h2' || tag === 'h3') return tag;
  return 'h2';
}

function collectSections(root: HTMLElement): { sections: DashContextSection[]; nodes: HTMLElement[] } {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>('[data-dash-context]')).filter(
    (el) => Boolean(el.id),
  );
  const sections = nodes.map((el) => {
    const parentId = el.getAttribute('data-dash-parent') || undefined;
    const label =
      el.getAttribute('data-dash-label')?.trim() ||
      el.textContent?.replace(/\s+/g, ' ').trim() ||
      el.id;
    return {
      id: el.id,
      label,
      level: readLevel(el),
      parentId,
    };
  });
  return { sections, nodes };
}

function computeActive(
  nodes: HTMLElement[],
  stackBottom: number,
): { activeId: string | null; trailIds: string[] } {
  if (!nodes.length) return { activeId: null, trailIds: [] };

  let activeIndex = -1;
  for (let i = 0; i < nodes.length; i++) {
    const top = nodes[i].getBoundingClientRect().top;
    const nextTop =
      i + 1 < nodes.length
        ? nodes[i + 1].getBoundingClientRect().top
        : Number.POSITIVE_INFINITY;
    // Section ends at the next heading (or document end). Active while the
    // heading has crossed the stack bottom and its section has not fully left.
    if (top <= stackBottom && nextTop > stackBottom) {
      activeIndex = i;
    }
  }

  // Past the last section entirely — keep the last heading as active.
  if (activeIndex < 0) {
    const last = nodes[nodes.length - 1];
    if (last.getBoundingClientRect().top <= stackBottom) {
      activeIndex = nodes.length - 1;
    } else {
      activeIndex = 0;
    }
  }

  const trailIds = nodes.slice(0, activeIndex + 1).map((n) => n.id);
  return { activeId: nodes[activeIndex]?.id ?? null, trailIds };
}

/**
 * IntersectionObserver-driven section spy for the Operation Dashboard context stack.
 * Active + trail are derived from geometry (both scroll directions), not click history.
 */
export function useDashboardSectionSpy(
  pageRef: RefObject<HTMLElement | null>,
  stackHeight: number,
): DashboardSectionSpyResult {
  const [sections, setSections] = useState<DashContextSection[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [trailIds, setTrailIds] = useState<string[]>([]);

  const stackBottom = Math.max(0, Math.round(stackHeight));

  useEffect(() => {
    const root = pageRef.current;
    if (!root) return;

    let observer: IntersectionObserver | null = null;
    let nodes: HTMLElement[] = [];
    let rafId = 0;

    const reconnect = () => {
      observer?.disconnect();
      const collected = collectSections(root);
      nodes = collected.nodes;
      setSections(collected.sections);

      observer = new IntersectionObserver(
        () => {
          const { activeId: nextActive, trailIds: nextTrail } = computeActive(nodes, stackBottom);
          setActiveId(nextActive);
          setTrailIds(nextTrail);
        },
        {
          root: null,
          rootMargin: `-${stackBottom}px 0px 0px 0px`,
          threshold: [0, 1],
        },
      );
      for (const node of nodes) observer.observe(node);
      const { activeId: nextActive, trailIds: nextTrail } = computeActive(nodes, stackBottom);
      setActiveId(nextActive);
      setTrailIds(nextTrail);
    };

    const scheduleReconnect = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        reconnect();
      });
    };

    reconnect();

    const mutationObserver = new MutationObserver(scheduleReconnect);
    mutationObserver.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-dash-context', 'id', 'data-dash-level', 'data-dash-parent'],
    });

    return () => {
      observer?.disconnect();
      mutationObserver.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [pageRef, stackBottom]);

  return { sections, activeId, trailIds, stackBottom };
}
