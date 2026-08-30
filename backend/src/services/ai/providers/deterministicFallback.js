// Pure-JS fallback "reasoner". Each template exports its own buildFallback(input);
// this file exists so the aiService can wire an alternate provider if needed.
// Kept intentionally thin: real logic lives in promptTemplates.js next to each
// template's shape so system prompt and fallback stay in sync.

import { TEMPLATES } from "../promptTemplates.js";

export function fallback(templateName, input) {
  const tpl = TEMPLATES[templateName];
  if (!tpl?.buildFallback) throw new Error(`No fallback for template: ${templateName}`);
  return tpl.buildFallback(input);
}
