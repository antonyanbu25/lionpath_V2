// Re-exports for backward compatibility — pipeline lives in ./prep/

export {
  generatePrep,
  runPrepResearch,
  runPrepSynthesize,
  resolveProspectEmails,
  deriveDomain,
  normalizePrepInput,
  computeInputHash,
  deriveCompanyNameFromEmail,
  deriveCompanyNameFromDomain,
  resolveCompanyName,
  type PrepInput,
  type PrepResult,
  type ResearchOnlyResult,
  type Env,
} from "./prep/index";
