export const ALLOWED_FONTS: string[];
export const NAME_EXPRESSION: unknown[];
export function mapFont(font: string): string;
export function transformStyle(
  base: Record<string, unknown>,
  opts: { theme: 'light' | 'dark'; sovereignty: Record<string, unknown> },
): Record<string, unknown> & { layers: Record<string, unknown>[] };
export function fillTemplate(templateJson: string, values: Record<string, string>): string;
