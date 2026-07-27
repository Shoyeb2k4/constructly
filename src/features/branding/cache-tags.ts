/** Cache tag for a company's shell branding (SSR layout cache). Plain module —
 *  safe to import from both server-only and testable code. */
export const brandingTag = (companyId: string) => `branding-${companyId}`;
