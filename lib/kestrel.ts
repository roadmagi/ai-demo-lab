/**
 * The fictional company all three demos are built around. Keeping it in one
 * place means the whole lab can be re-skinned for a client pitch by editing
 * this file.
 */
export const COMPANY = {
  name: "Kestrel",
  product: "Kestrel",
  tagline: "project management for software teams",
  supportEmail: "support@kestrel.example",
} as const;

/** Questions the help center genuinely answers. */
export const SUGGESTED_QUESTIONS = [
  "How do I export all my project data?",
  "What happens to my data when I cancel?",
  "Can I use SAML SSO on the Team plan?",
  "Why did my Slack integration stop posting updates?",
  "How many automation runs do I get per month?",
] as const;

/**
 * Questions the corpus deliberately does not cover. Surfaced in the UI so a
 * visitor can watch the agent decline instead of inventing an answer — the
 * behaviour that actually matters in production, and the hardest thing to
 * show with a scripted demo.
 */
export const GAP_PROBE_QUESTIONS = [
  "Do you have a mobile app?",
  "Can I self-host Kestrel on my own servers?",
] as const;
