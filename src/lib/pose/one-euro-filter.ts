export interface OneEuroFilterParams {
  minCutoff: number;
  beta: number;
  derivativeCutoff: number;
}

export interface OneEuroScalarState {
  filtered: number;
  filteredDerivative: number;
  initialized: boolean;
}

const MIN_DT_SECONDS = 0.001;
const MIN_CUTOFF_HZ = 0.001;

const getAlpha = (cutoffHz: number, dtSeconds: number) => {
  const safeCutoff = Math.max(MIN_CUTOFF_HZ, cutoffHz);
  const safeDtSeconds = Math.max(MIN_DT_SECONDS, dtSeconds);
  const tau = 1 / (2 * Math.PI * safeCutoff);
  return 1 / (1 + (tau / safeDtSeconds));
};

export const createOneEuroScalarState = (): OneEuroScalarState => ({
  filtered: 0,
  filteredDerivative: 0,
  initialized: false,
});

export const resetOneEuroScalarState = (state: OneEuroScalarState) => {
  state.filtered = 0;
  state.filteredDerivative = 0;
  state.initialized = false;
};

export const updateOneEuroScalar = (
  state: OneEuroScalarState,
  value: number,
  dtMs: number,
  params: OneEuroFilterParams
) => {
  const dtSeconds = Math.max(MIN_DT_SECONDS, dtMs / 1000);

  if (!state.initialized) {
    state.filtered = value;
    state.filteredDerivative = 0;
    state.initialized = true;
    return value;
  }

  const rawDerivative = (value - state.filtered) / dtSeconds;
  const derivativeAlpha = getAlpha(params.derivativeCutoff, dtSeconds);
  state.filteredDerivative += derivativeAlpha * (rawDerivative - state.filteredDerivative);

  const adaptiveCutoff = params.minCutoff + (params.beta * Math.abs(state.filteredDerivative));
  const valueAlpha = getAlpha(adaptiveCutoff, dtSeconds);
  state.filtered += valueAlpha * (value - state.filtered);

  return state.filtered;
};
