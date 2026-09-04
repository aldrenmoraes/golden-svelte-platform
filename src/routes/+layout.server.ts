import type { LayoutServerLoad } from './$types';
import { isThemeMode } from '$lib/theme';
import { themeConfig } from '$lib/theme/config';

export const load: LayoutServerLoad = ({ cookies }) => {
	const storedMode = cookies.get(themeConfig.cookieName);
	return { themeMode: isThemeMode(storedMode) ? storedMode : themeConfig.defaultMode };
};
