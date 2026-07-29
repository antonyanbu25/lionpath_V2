import { resolveKaiaForPrepInput } from "../kaia/prepKaia";
import type { PrepInput } from "./types";

export async function resolveMergedAdditionalContext(input: PrepInput): Promise<{
  text: string;
  kaiaFetched: boolean;
}> {
  let text = String(input.additionalContext || "").trim();
  const { researchContext } = await resolveKaiaForPrepInput(input);
  let kaiaFetched = false;

  if (researchContext) {
    kaiaFetched = true;
    const block = `Kaia meeting context:\n${researchContext}`;
    text = text ? `${text}\n\n${block}` : block;
  }

  return { text, kaiaFetched };
}
