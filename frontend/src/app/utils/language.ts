const EXT_TO_LANGUAGE: Record<string, string> = {
  js: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  py: 'python',
  java: 'java',
  go: 'go',
  rs: 'rust',
  rb: 'ruby',
  php: 'php',
  cs: 'csharp',
  cpp: 'cpp',
  c: 'c',
  h: 'c',
  swift: 'swift',
  kt: 'kotlin',
  scala: 'scala',
  vue: 'markup',
  sql: 'sql',
  sh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  json: 'json',
};

/**
 * Map a file path to a language identifier for syntax highlighting.
 * Returns "text" when no mapping is found.
 */
export function languageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  return EXT_TO_LANGUAGE[ext ?? ''] || 'text';
}
