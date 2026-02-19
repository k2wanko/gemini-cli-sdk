export type SkillRef = { type: "dir"; path: string };

/**
 * Create a reference to a directory containing skills.
 */
export function skillDir(path: string): SkillRef {
  return { type: "dir", path };
}
