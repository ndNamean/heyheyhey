type Props = {
  name: string;
  contributionLine: string;
  open: boolean;
};

/**
 * Presentational Builder contribution tip. Visual-only (`aria-hidden`);
 * screen readers use the enriched item `aria-label` instead.
 */
export default function CommunityBuilderTooltip({ name, contributionLine, open }: Props) {
  if (!open) return null;

  return (
    <div
      className="community-builder-tooltip"
      role="tooltip"
      aria-hidden="true"
    >
      <div className="community-builder-tooltip-name">{name}</div>
      <div className="community-builder-tooltip-count">{contributionLine}</div>
    </div>
  );
}
