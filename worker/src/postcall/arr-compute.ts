/**
 * Pass — ARR compute from extracted inputs (task 2.5b).
 * All arithmetic stays in computeArr(); this wires extraction → pure function.
 */

import { defaultArrPriceBooks } from "../arr/books";
import { computeArr, type ArrComputeConfig, type ArrComputeResult } from "../arr/compute";
import { mapArrInputsToComputeInput, type MapArrInputsOptions } from "../arr/map-inputs";
import {
  normalizeArrInputsOutput,
  type ArrInputsDraft,
} from "./arr-inputs";

export interface PostCallArrComputeInput extends Partial<ArrInputsDraft>, MapArrInputsOptions {
  asOf?: string;
  includeDayPasses?: boolean;
  assumptionsConfirmed?: boolean;
}

export interface PostCallArrComputeResult extends ArrComputeResult {
  /** Echo of normalized inputs — reproducible with price book version. */
  inputs: ArrInputsDraft;
  bandFactors: ReturnType<typeof mapArrInputsToComputeInput>["bandFactors"];
}

export function runPostCallArrCompute(
  raw: PostCallArrComputeInput,
): PostCallArrComputeResult {
  const inputs = normalizeArrInputsOutput(raw);
  const mapped = mapArrInputsToComputeInput(inputs, raw);

  if (!mapped.input) {
    throw Object.assign(new Error(mapped.errors.join(" ")), { status: 400 });
  }

  const config: ArrComputeConfig = {
    asOf: raw.asOf,
    includeDayPasses: raw.includeDayPasses,
  };

  const computed = computeArr(mapped.input, defaultArrPriceBooks(), config);

  return {
    ...computed,
    inputs,
    bandFactors: mapped.bandFactors,
  };
}
