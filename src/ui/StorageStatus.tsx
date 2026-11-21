import { useFlowStore } from '../state/store';

const LABELS = {
  saved: 'Saved on this device',
  saving: 'Saving…',
  error: 'Save failed — changes may be lost',
} as const;

export function StorageStatus() {
  const saveState = useFlowStore((state) => state.saveState);
  const storageKind = useFlowStore((state) => state.storageKind);
  const persistent = useFlowStore((state) => state.persistent);

  return (
    <div className="storage-block" data-guide="storage">
      <div className={`storage-status is-${saveState}`} role="status" aria-live="polite">
        <span className="status-dot" aria-hidden />
        <span>{LABELS[saveState]}</span>
      </div>
      <div className="storage-kind">
        {storageKind} · {persistent ? 'local only' : 'not persistent'}
      </div>
    </div>
  );
}
