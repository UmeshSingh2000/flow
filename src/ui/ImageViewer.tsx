import { useEffect } from 'react';
import { useActiveProject, useFlowStore } from '../state/store';
import { IconX } from './icons';

/** Full-screen lightbox for an attached image. */
export function ImageViewer() {
  const viewer = useFlowStore((state) => state.imageViewer);
  const close = useFlowStore((state) => state.closeImageViewer);
  const project = useActiveProject();

  useEffect(() => {
    if (!viewer) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [viewer, close]);

  if (!viewer) return null;
  const node = project?.nodes.find((candidate) => candidate.id === viewer.nodeId);
  const image = node?.images.find((candidate) => candidate.id === viewer.imageId);
  if (!node || !image) return null;

  return (
    <div className="image-viewer" role="dialog" aria-modal="true" aria-label={image.name}>
      <div className="image-viewer-scrim" onClick={close} />
      <figure className="image-viewer-frame">
        <img src={image.dataUrl} alt={image.name} />
        <figcaption>
          <span className="image-viewer-name">{image.name}</span>
          <span className="image-viewer-meta">
            attached to “{node.title}”
            {image.width > 0 ? ` · ${image.width}×${image.height}` : ''}
          </span>
        </figcaption>
      </figure>
      <button
        type="button"
        className="image-viewer-close"
        aria-label="Close image"
        onClick={close}
      >
        <IconX size={16} />
      </button>
    </div>
  );
}
