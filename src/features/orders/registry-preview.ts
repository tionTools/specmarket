export function reapplyRegistryPreview<T>(
  isDraft: boolean,
  entries: T[],
  apply: (entries: T[]) => void,
) {
  if (isDraft && entries.length) apply(entries)
}
