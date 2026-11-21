import { useFlowStore } from '../state/store';

export function Toasts() {
  const toast = useFlowStore((state) => state.toast);
  if (!toast) return null;

  return (
    <div className={`toast is-${toast.tone}`} role="status" aria-live="polite" key={toast.id}>
      {toast.message}
    </div>
  );
}
