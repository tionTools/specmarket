export type Appearance = 'system' | 'light' | 'dark'
export const appearanceStorageKey = 'specmarket:appearance'
export function parseAppearance(value: string | null): Appearance {
  return value === 'light' || value === 'dark' ? value : 'system'
}
export function resolvedAppearance(value: Appearance, systemDark: boolean) {
  return value === 'dark' || (value === 'system' && systemDark) ? 'dark' : 'light'
}
export function applyAppearance(
  value: Appearance,
  systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches,
) {
  const resolved = resolvedAppearance(value, systemDark)
  document.documentElement.dataset.theme = resolved
  document.documentElement.style.colorScheme = resolved
}
