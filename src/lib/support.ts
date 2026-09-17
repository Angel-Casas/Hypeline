/**
 * Where the "?" in the rail sends people (2026-09-17): three doors into the GitHub project,
 * each a prefilled new issue so the right template and label open. The repository is
 * `VITE_GITHUB_REPO` (owner/repo); until it exists the links point at a placeholder. Bug
 * reports carry a short, non-personal context block (version, browser, language, theme,
 * what was open) so Angel can reproduce without asking.
 */
export const GITHUB_REPO = (
  (import.meta.env.VITE_GITHUB_REPO as string | undefined) ?? 'Angel-Casas/Hypeline'
).trim();
export const REPO_URL = `https://github.com/${GITHUB_REPO}`;

export type SupportKind = 'feature' | 'bug' | 'question';

export interface SupportContext {
  version: string;
  userAgent: string;
  locale: string;
  theme: 'day' | 'night';
  /** The page and, when one is open, the VOD id — never the URL's query. */
  where: string;
  relay: boolean;
  aiKey: boolean;
}

const TEMPLATE: Record<SupportKind, { file: string; labels: string; title: string }> = {
  feature: { file: 'feature_request.yml', labels: 'enhancement', title: '[Feature] ' },
  bug: { file: 'bug_report.yml', labels: 'bug', title: '[Bug] ' },
  question: { file: 'question.yml', labels: 'question', title: '[Question] ' },
};

/** The context block appended to a bug report (markdown, kept short). */
export function contextBlock(c: SupportContext): string {
  return [
    '',
    '---',
    `Hypeline ${c.version} · ${c.where}`,
    `${c.userAgent}`,
    `language ${c.locale} · ${c.theme} · video relay ${c.relay ? 'set' : 'not set'} · NanoGPT key ${c.aiKey ? 'set' : 'not set'}`,
  ].join('\n');
}

/** A "new issue" URL with the template, label and title prefilled (plus context for bugs). */
export function supportUrl(kind: SupportKind, ctx?: SupportContext): string {
  const t = TEMPLATE[kind];
  const u = new URL(`${REPO_URL}/issues/new`);
  u.searchParams.set('template', t.file);
  u.searchParams.set('labels', t.labels);
  u.searchParams.set('title', t.title);
  // issue forms accept prefilled fields by their id; `context` is a textarea in bug_report.yml
  if (kind === 'bug' && ctx) u.searchParams.set('context', contextBlock(ctx).trim());
  return u.toString();
}
