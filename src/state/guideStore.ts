import { create } from 'zustand';
import {
  GUIDE_STEPS,
  isRequirementMet,
  nodesSignature,
  projectMaxDepth,
  stepNeedsSelection,
} from '../guide/steps';
import type { GuideContext, GuideStep } from '../guide/steps';
import { useFlowStore } from './store';

/** Browser-specific completion flag; the tour is a UI concern, not domain data. */
const COMPLETED_KEY = 'flow-guide-completed';

function readCompleted(): boolean {
  try {
    return window.localStorage.getItem(COMPLETED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCompleted(completed: boolean): void {
  try {
    if (completed) window.localStorage.setItem(COMPLETED_KEY, '1');
    else window.localStorage.removeItem(COMPLETED_KEY);
  } catch {
    /* storage unavailable — the tour simply runs again next time */
  }
}

export function guideContext(): GuideContext {
  const { projects, activeProjectId } = useFlowStore.getState();
  const project = projects.find((candidate) => candidate.id === activeProjectId) ?? null;
  return {
    projectCount: projects.length,
    nodeCount: project?.nodes.length ?? 0,
    maxDepth: project ? projectMaxDepth(project) : 0,
    connectionCount: project?.connections.length ?? 0,
    hasMarkdown: project?.nodes.some((node) => node.markdown.trim().length > 0) ?? false,
    nodesSignature: project ? nodesSignature(project) : '',
  };
}

interface GuideStore {
  status: 'idle' | 'active';
  /** Mirrors the stored completion flag so Settings can label the entry point. */
  completed: boolean;
  stepIndex: number;
  baselineSignature: string;
  viewportMoved: boolean;
  autoStartChecked: boolean;

  /** Starts (or restarts) the tour from the first step. */
  start(): void;
  /** Ends the tour and remembers that it is finished. */
  finish(): void;
  /** Advances an explanatory step, or the current step, if possible. */
  next(): void;
  notifyViewportMoved(): void;
  /** Re-checks whether the current step's action has been performed. */
  evaluate(): void;
  /** Starts the tour automatically for a brand-new workspace. */
  maybeAutoStart(): void;
}

export const useGuideStore = create<GuideStore>()((set, get) => {
  /** Makes sure the step's target control is actually on screen. */
  const prepare = (step: GuideStep) => {
    const flow = useFlowStore.getState();
    if (!flow.sidebarOpen) flow.setSidebarOpen(true);
    // Steps that act on the graph need the canvas view, whatever the user had open.
    if (step.id === 'connect' || step.id === 'canvas-nav') flow.setView('canvas');
    if (!stepNeedsSelection(step)) return;
    if (flow.selectedNodeId) return;
    const project = flow.projects.find(
      (candidate) => candidate.id === flow.activeProjectId,
    );
    const fallback =
      [...(project?.nodes ?? [])].reverse().find((node) => node.parentId !== null) ??
      project?.nodes[0];
    if (fallback) flow.selectNode(fallback.id);
  };

  const enterStep = (index: number) => {
    const step = GUIDE_STEPS[index];
    if (!step) {
      get().finish();
      return;
    }
    prepare(step);
    set({
      stepIndex: index,
      baselineSignature: guideContext().nodesSignature,
      viewportMoved: false,
    });
    // A step may already be satisfied (for example when restarting the tour).
    get().evaluate();
  };

  return {
    status: 'idle',
    completed: readCompleted(),
    stepIndex: 0,
    baselineSignature: '',
    viewportMoved: false,
    autoStartChecked: false,

    start() {
      writeCompleted(false);
      set({ status: 'active', completed: false, stepIndex: 0, viewportMoved: false });
      enterStep(0);
    },

    finish() {
      writeCompleted(true);
      set({ status: 'idle', completed: true, stepIndex: 0, viewportMoved: false });
    },

    next() {
      if (get().status !== 'active') return;
      enterStep(get().stepIndex + 1);
    },

    notifyViewportMoved() {
      if (get().status !== 'active' || get().viewportMoved) return;
      set({ viewportMoved: true });
      get().evaluate();
    },

    evaluate() {
      const state = get();
      if (state.status !== 'active') return;
      const step = GUIDE_STEPS[state.stepIndex];
      if (!step || step.requirement === null) return;
      const met = isRequirementMet(
        step.requirement,
        guideContext(),
        state.baselineSignature,
        state.viewportMoved,
      );
      if (met) enterStep(state.stepIndex + 1);
    },

    maybeAutoStart() {
      if (get().autoStartChecked) return;
      set({ autoStartChecked: true });
      const flow = useFlowStore.getState();
      if (flow.status !== 'ready') return;
      if (flow.projects.length > 0 || readCompleted()) return;
      get().start();
    },
  };
});

export const GUIDE_STEP_COUNT = GUIDE_STEPS.length;
