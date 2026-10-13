import type { ScoutId } from '../engine/types';
import type { KnowledgeView } from '../rendering/projection';

export interface InspectionState {
  readonly selected: ScoutId;
  readonly inspected: ScoutId | null;
  readonly knowledge: KnowledgeView;
  readonly lastGlobalView: Exclude<KnowledgeView, 'scout'>;
}

export const initialInspection: InspectionState = {
  selected: 'scout-a', inspected: null, knowledge: 'fleet', lastGlobalView: 'fleet',
};

export type InspectionAction =
  | { readonly type: 'inspect'; readonly scout: ScoutId }
  | { readonly type: 'dismiss' }
  | { readonly type: 'knowledge'; readonly view: KnowledgeView };

/** Keep scout knowledge contextual to an open inspector. */
export function inspectionReducer(state: InspectionState, action: InspectionAction): InspectionState {
  switch (action.type) {
    case 'inspect': return { ...state, selected: action.scout, inspected: action.scout };
    case 'dismiss': return { ...state, inspected: null,
      knowledge: state.knowledge === 'scout' ? state.lastGlobalView : state.knowledge };
    case 'knowledge':
      if (action.view === 'scout') return state.inspected === null ? state : { ...state, knowledge: 'scout' };
      return { ...state, knowledge: action.view, lastGlobalView: action.view };
  }
}
