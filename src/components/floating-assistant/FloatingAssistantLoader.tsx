export default function FloatingAssistantLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="fa-loader" role="status" aria-live="polite">
      <span className="fa-loader-spinner" aria-hidden="true" />
      <span className="fa-loader-label">{label}</span>
    </div>
  );
}
