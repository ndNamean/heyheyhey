import { useLang } from '../../i18n';
import CommunityPostCard, { type CommunityPostCardProps } from './CommunityPostCard';

export default function FamousPost(props: Omit<CommunityPostCardProps, 'variant'>) {
  const { t } = useLang();
  return (
    <section className="community-famous-wrap" aria-label={t.community.famousBadge}>
      <div className="community-famous-label">{t.community.famousBadge}</div>
      <CommunityPostCard {...props} variant="famous" />
    </section>
  );
}
