import { z } from 'zod';

const localeSchema = z.enum(['pt-BR', 'en', 'fr', 'es']);
const themeSchema = z.enum(['light', 'dark', 'system']);

const requiredFeaturesSchema = z
	.object({
		auth: z.literal(true),
		rbac: z.literal(true),
		postgres: z.literal(true),
		telemetry: z.literal(true),
		docker: z.literal(true),
		i18n: z.literal(true),
		themes: z.literal(true),
		releases: z.literal(true)
	})
	.strict();

export const manifestSchema = z
	.object({
		schemaVersion: z.literal(1),
		project: z
			.object({
				name: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/, 'Use kebab-case com 2 a 63 caracteres.'),
				displayName: z.string().trim().min(2).max(120),
				description: z.string().trim().min(12).max(500)
			})
			.strict(),
		platform: z
			.object({
				scaffoldVersion: z.string().regex(/^\d+\.\d+\.\d+$/, 'Use SemVer, por exemplo 1.4.0.'),
				profile: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/),
				features: requiredFeaturesSchema
			})
			.strict(),
		domain: z
			.object({
				boundedContexts: z
					.array(z.string().regex(/^[a-z][a-z0-9-]{1,60}$/))
					.min(1)
					.max(20),
				roles: z
					.array(
						z
							.object({
								code: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/),
								description: z.string().trim().min(4).max(180)
							})
							.strict()
					)
					.min(1)
					.max(20),
				entities: z
					.array(z.string().regex(/^[a-z][a-z0-9_]{1,60}$/))
					.min(1)
					.max(80)
			})
			.strict(),
		observability: z
			.object({
				serviceName: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/),
				piiFields: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,60}$/)).max(80)
			})
			.strict(),
		delivery: z
			.object({
				dockerComposeProject: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/),
				publicHost: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,251}$/)
			})
			.strict(),
		experience: z
			.object({
				sourceLocale: localeSchema,
				supportedLocales: z.array(localeSchema).length(4),
				publicRouteStrategy: z.literal('localized'),
				privateRouteStrategy: z.literal('user-preference'),
				themeDefault: themeSchema,
				enabledThemes: z.array(themeSchema).min(3).max(3)
			})
			.strict()
			.superRefine((value, context) => {
				const expectedLocales = ['pt-BR', 'en', 'fr', 'es'] as const;
				if (new Set(value.supportedLocales).size !== expectedLocales.length) {
					context.addIssue({
						code: 'custom',
						message: 'supportedLocales contém idiomas duplicados.'
					});
				}
				if (!expectedLocales.every((locale) => value.supportedLocales.includes(locale))) {
					context.addIssue({
						code: 'custom',
						message: 'supportedLocales deve conter pt-BR, en, fr e es.'
					});
				}
				if (!value.supportedLocales.includes(value.sourceLocale)) {
					context.addIssue({
						code: 'custom',
						message: 'sourceLocale deve estar em supportedLocales.'
					});
				}
				if (new Set(value.enabledThemes).size !== 3) {
					context.addIssue({ code: 'custom', message: 'enabledThemes contém temas duplicados.' });
				}
				if (!value.enabledThemes.includes(value.themeDefault)) {
					context.addIssue({
						code: 'custom',
						message: 'themeDefault deve estar em enabledThemes.'
					});
				}
			}),
		release: z
			.object({
				initialVersion: z.string().regex(/^\d+\.\d+\.\d+$/, 'Use SemVer, por exemplo 0.1.0.'),
				channel: z.enum(['stable', 'next', 'beta']),
				commitConvention: z.literal('conventional')
			})
			.strict()
	})
	.strict()
	.superRefine((value, context) => {
		if (value.project.name !== value.delivery.dockerComposeProject) {
			context.addIssue({
				code: 'custom',
				path: ['delivery', 'dockerComposeProject'],
				message:
					'dockerComposeProject deve ser igual a project.name para manter uma identidade operacional única.'
			});
		}
		if (value.project.name !== value.observability.serviceName) {
			context.addIssue({
				code: 'custom',
				path: ['observability', 'serviceName'],
				message:
					'serviceName deve ser igual a project.name para que logs, traces e imagens compartilhem a mesma identidade.'
			});
		}
	});

export type ProjectManifest = z.infer<typeof manifestSchema>;
