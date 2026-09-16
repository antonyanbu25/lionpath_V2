import { resolveKaiaForPrepInput } from "../kaia/prepKaia";
import { mergeContextAttachments } from "./context-attachments";
import type { PrepInput } from "./types";

/**
 * The single string every downstream prompt treats as "SE context": the typed note,
 * plus text extracted from attached files, plus Kaia meeting context.
 */
export async function resolveMergedAdditionalContext(input: PrepInput): Promise<{
  text: string;
  kaiaFetched: boolean;
}> {
  let text = mergeContextAttachments(input.additionalContext, input.contextAttachments);
  const { researchContext } = await resolveKaiaForPrepInput(input);
  let kaiaFetched = false;

  if (researchContext) {
    kaiaFetched = true;
    const block = `Kaia meeting context:\n${researchContext}`;
    text = text ? `${text}\n\n${block}` : block;
  }

  return { text, kaiaFetched };
}
