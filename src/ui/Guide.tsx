import { useEffect, useState } from 'react';
import { useOnViewportChange } from '@xyflow/react';
import { GUIDE_STEPS } from '../guide/steps';
import { useGuideStore } from '../state/guideStore';
import { useFlowStore } from '../state/store';

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

/** Tracks the first visible element among the step's `data-guide` targets. */
function useTargetRect(targets: string[]): SpotlightRect | null {
  const [rect, setRect] = useState<SpotlightRect | null>(null);
  const key = targets.join('|');

  useEffect(() => {
    const measure = () => {
      let found: SpotlightRect | null = null;
      for (const target of targets) {
        const element = document.querySelector(`[data-guide="${target}"]`);
        if (!element) continue;
        const box = element.getBoundingClientRect();
        if (box.width > 0 && box.height > 0) {
          found = {
            top: box.top,
            left: box.left,
            width: box.width,
            height: box.height,
            right: box.right,
            bottom: box.bottom,
          };
          break;
        }
      }
      setRect((previous) => {
        if (previous === null && found === null) return previous;
        if (
          previous &&
          found &&
          previous.top === found.top &&
          previous.left === found.left &&
          previous.width === found.width &&
          previous.height === found.height
        ) {
          return previous;
        }
        return found;
      });
    };

    measure();
    const timer = window.setInterval(measure, 250);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return rect;
}

/** Reports pan/zoom so the "move around the canvas" step can complete. */
function ViewportWatcher() {
  useOnViewportChange({
    onEnd: () => useGuideStore.getState().notifyViewportMoved(),
  });
  return null;
}

export function Guide() {
  const status = useGuideStore((state) => state.status);
  const stepIndex = useGuideStore((state) => state.stepIndex);
  const finish = useGuideStore((state) => state.finish);
  const next = useGuideStore((state) => state.next);
  const flowStatus = useFlowStore((state) => state.status);

  const step = GUIDE_STEPS[stepIndex];
  const rect = useTargetRect(status === 'active' && step ? step.targets : []);

  // React to every workspace change: completing an action advances the tour.
  useEffect(() => {
    return useFlowStore.subscribe(() => {
      useGuideStore.getState().evaluate();
    });
  }, []);

  useEffect(() => {
    if (flowStatus === 'ready') useGuideStore.getState().maybeAutoStart();
  }, [flowStatus]);

  if (status !== 'active' || !step) return null;

  const total = GUIDE_STEPS.length;

  return (
    <div className="guide-layer" role="dialog" aria-modal="true" aria-label="Flow guided tour">
      {rect ? (
        <>
          <div
            className="guide-block"
            style={{ left: 0, right: 0, top: 0, height: Math.max(0, rect.top) }}
          />
          <div
            className="guide-block"
            style={{ left: 0, right: 0, top: rect.bottom, bottom: 0 }}
          />
          <div
            className="guide-block"
            style={{ left: 0, top: rect.top, width: Math.max(0, rect.left), height: rect.height }}
          />
          <div
            className="guide-block"
            style={{ left: rect.right, right: 0, top: rect.top, height: rect.height }}
          />
          <div
            className="guide-spotlight"
            style={{
              top: rect.top - 6,
              left: rect.left - 6,
              width: rect.width + 12,
              height: rect.height + 12,
            }}
          />
        </>
      ) : (
        <div className="guide-block guide-block-full" />
      )}

      <ViewportWatcher />

      <div className={`guide-card${rect ? '' : ' is-centered'}`}>
        <div className="guide-card-head">
          <span className="eyebrow">
            STEP {stepIndex + 1} OF {total}
          </span>
          <div className="guide-progress" aria-hidden>
            {GUIDE_STEPS.map((entry, index) => (
              <span
                key={entry.id}
                className={index <= stepIndex ? 'is-done' : undefined}
              />
            ))}
          </div>
        </div>
        <h2>{step.title}</h2>
        <p>{step.body}</p>
        {step.tips && step.tips.length > 0 && (
          <ul className="guide-tips">
            {step.tips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        )}
        <div className="guide-actions">
          <button type="button" className="link-btn" onClick={finish}>
            Skip tour
          </button>
          {step.requirement === null && (
            <button type="button" className="btn btn-primary" onClick={next}>
              {step.nextLabel ?? 'Next'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
