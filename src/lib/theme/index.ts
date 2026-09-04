export const themeModes = ['light', 'dark', 'system'] as const;
export type ThemeMode = (typeof themeModes)[number];
export type ResolvedTheme = Exclude<ThemeMode, 'system'>;

export function isThemeMode(value: unknown): value is ThemeMode {
	return typeof value === 'string' && themeModes.includes(value as ThemeMode);
}

export function resolveTheme(mode: ThemeMode, systemPrefersDark = false): ResolvedTheme {
	if (mode === 'system') return systemPrefersDark ? 'dark' : 'light';
	return mode;
}
