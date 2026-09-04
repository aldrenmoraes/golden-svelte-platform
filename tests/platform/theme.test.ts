import { describe, expect, test } from 'bun:test';
import { isThemeMode, resolveTheme } from '../../src/lib/theme';

describe('theme platform contract', () => {
	test('resolves a system theme from the system preference', () => {
		expect(resolveTheme('system', true)).toBe('dark');
		expect(resolveTheme('system', false)).toBe('light');
	});

	test('accepts only supported theme modes', () => {
		expect(isThemeMode('light')).toBe(true);
		expect(isThemeMode('unknown')).toBe(false);
	});
});
