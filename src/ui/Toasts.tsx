import { useFlowStore } from '../state/store';

export function Toasts() {
  const toast = useFlowStore((state) => state.toast);
  const runToastAction = useFlowStore((state) => state.runToastAction);
  if (!toast) return null;

  return (
    <div className={`toast is-${toast.tone}`} role="status" aria-live="polite" key={toast.id}>
      <span>{toast.message}</span>
      {toast.action && (
        <button type="button" className="toast-action" onClick={runToastAction}>
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
