import { createInterface } from 'node:readline/promises';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { extractLogoSeed } from './lib/logo';
import { defaultPalettePath, generateTheme } from './extract-logo-theme';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
	applyAnswersToManifest,
	buildDatabaseUrl,
	buildPublicHost,
	fillProductBrief,
	isSupportedLocale,
	readEnvValue,
	slugify,
	supportedLocales,
	toDatabaseName,
	upsertEnv,
	validate,
	type BootstrapAnswers,
	type SupportedLocale
} from './lib/bootstrap';

type BootstrapOptions = { root: string; dryRun: boolean; assumeYes: boolean; activate: boolean };

type Defaults = {
	slug: string;
	displayName: string;
	description: string;
	databaseName: string;
	databasePort: number;
	sourceLocale: SupportedLocale;
};

function usage(): string {
	return `Uso:
  bun run bootstrap [--dry-run] [--yes] [--no-activate]

Opções:
  --dry-run       Mostra as alterações sem escrever nada e sem ativar o scaffold.
  --yes           Aceita todos os padrões sem perguntar (modo não interativo).
  --no-activate   Escreve os arquivos, mas não executa a ativação ao final.
  --help          Exibe esta ajuda.`;
}

function parseArgs(argv: string[]): BootstrapOptions {
	const options: BootstrapOptions = {
		root: process.cwd(),
		dryRun: false,
		assumeYes: false,
		activate: true
	};
	for (const argument of argv) {
		if (argument === '--help' || argument === '-h') {
			console.log(usage());
			process.exit(0);
		} else if (argument === '--dry-run') options.dryRun = true;
		else if (argument === '--yes' || argument === '-y') options.assumeYes = true;
		else if (argument === '--no-activate') options.activate = false;
		else throw new Error(`Opção desconhecida: ${argument}`);
	}
	options.root = resolve(options.root);
	return options;
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

/** The current manifest seeds every default, so pressing Enter keeps the project as it is. */
async function readDefaults(manifestPath: string): Promise<Defaults> {
	const manifest = parseYaml(await readFile(manifestPath, 'utf8')) as {
		project?: { name?: string; displayName?: string; description?: string };
		experience?: { sourceLocale?: string };
	};
	const slug = manifest.project?.name ?? 'my-app';
	const locale = manifest.experience?.sourceLocale ?? 'pt-BR';
	return {
		slug,
		displayName: manifest.project?.displayName ?? slug,
		description: manifest.project?.description ?? '',
		databaseName: toDatabaseName(slug),
		databasePort: 5432,
		sourceLocale: isSupportedLocale(locale) ? locale : 'pt-BR'
	};
}

/**
 * Where answers come from. A terminal is asked question by question; a pipe is read up front,
 * because Bun's readline drops the lines still queued when the input stream ends; `--yes`
 * answers nothing and every default is taken.
 */
type AnswerSource = {
	next(prompt: string): Promise<string | undefined>;
	close(): void;
};

function terminalSource(): AnswerSource {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	let closed = false;
	rl.on('close', () => {
		closed = true;
	});
	return {
		next(prompt) {
			if (closed) return Promise.resolve(undefined);
			// The question is raced against `close` because a question already in flight when the
			// input ends never settles on its own, which would hang the CLI.
			return new Promise((resolve) => {
				const onClose = () => {
					closed = true;
					resolve(undefined);
				};
				rl.once('close', onClose);
				rl.question(prompt)
					.then((answer) => {
						rl.off('close', onClose);
						resolve(answer);
					})
					.catch(() => {
						rl.off('close', onClose);
						closed = true;
						resolve(undefined);
					});
			});
		},
		close: () => rl.close()
	};
}

function pipedSource(input: string): AnswerSource {
	const lines = input.replace(/\r\n/g, '\n').split('\n');
	if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
	return {
		async next(prompt) {
			if (lines.length === 0) return undefined;
			const answer = lines.shift() as string;
			// Echo so a scripted run reads like an interactive one.
			console.log(`${prompt}${answer}`);
			return answer;
		},
		close: () => {}
	};
}

function defaultsSource(): AnswerSource {
	return { next: async () => undefined, close: () => {} };
}

class Prompter {
	constructor(private readonly source: AnswerSource) {}

	/** Asks until the answer validates; falls back to the default once the input runs out. */
	async ask(
		question: string,
		fallback: string,
		check: (value: string) => string | null = () => null
	): Promise<string> {
		for (;;) {
			const answer = await this.source.next(`${question} [${fallback}]: `);
			if (answer === undefined) {
				const problem = check(fallback);
				if (problem) {
					throw new Error(`Sem resposta para "${question}" e o padrão é inválido: ${problem}`);
				}
				return fallback;
			}
			const value = answer.trim().length === 0 ? fallback : answer.trim();
			const problem = check(value);
			if (!problem) return value;
			console.log(`  ! ${problem}`);
		}
	}

	/** Asks a question with no default; an empty answer means the step is skipped. */
	async askOptional(question: string): Promise<string> {
		const answer = await this.source.next(`${question} `);
		return (answer ?? '').trim();
	}

	async choose(question: string, choices: readonly string[], fallback: string): Promise<string> {
		const list = choices.map((choice, index) => `  ${index + 1}) ${choice}`).join('\n');
		for (;;) {
			const raw = await this.source.next(`${question}\n${list}\n  Escolha [${fallback}]: `);
			if (raw === undefined) return fallback;
			const answer = raw.trim();
			if (answer.length === 0) return fallback;
			const byIndex = choices[Number(answer) - 1];
			if (byIndex) return byIndex;
			if (choices.includes(answer)) return answer;
			console.log('  ! Escolha um número da lista ou o valor exato.');
		}
	}

	async confirm(question: string, fallback: boolean): Promise<boolean> {
		const raw = await this.source.next(`${question} [${fallback ? 'S/n' : 's/N'}]: `);
		if (raw === undefined) return fallback;
		const answer = raw.trim().toLowerCase();
		if (answer.length === 0) return fallback;
		return answer === 's' || answer === 'sim' || answer === 'y' || answer === 'yes';
	}

	close(): void {
		this.source.close();
	}
}

async function collectAnswers(prompter: Prompter, defaults: Defaults): Promise<BootstrapAnswers> {
	const displayName = await prompter.ask(
		'Nome de exibição do projeto',
		defaults.displayName,
		validate.displayName
	);
	const slug = await prompter.ask(
		'Slug do projeto (kebab-case)',
		slugify(displayName) || defaults.slug,
		validate.slug
	);
	const description = await prompter.ask(
		'Descrição do produto',
		defaults.description,
		validate.description
	);
	const primaryUser = await prompter.ask(
		'Usuário-alvo principal',
		'Equipe interna de operações',
		validate.primaryUser
	);
	const databaseName = await prompter.ask(
		'Nome do banco de dados',
		toDatabaseName(slug),
		validate.databaseName
	);
	const databasePort = await prompter.ask(
		'Porta do PostgreSQL publicada no host',
		String(defaults.databasePort),
		validate.databasePort
	);
	let logoPath: string | undefined;
	let seedColor: string | undefined;
	for (;;) {
		const answer = await prompter.askOptional(
			'Caminho da imagem do logo (PNG/SVG) ou pressione Enter para pular:'
		);
		if (answer.length === 0) break;
		const problem = validate.logoPath(answer);
		if (problem) {
			console.log(`  ! ${problem}`);
			continue;
		}
		try {
			const seed = extractLogoSeed(answer, await readFile(answer));
			logoPath = answer;
			seedColor = seed.hex;
			console.log(
				`  ✓ Cor da marca ${seed.hex} (${seed.source.toUpperCase()}, ${seed.sampled} amostras)`
			);
			break;
		} catch (error) {
			console.log(`  ! ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	const sourceLocale = await prompter.choose(
		'Idioma principal (sourceLocale)',
		supportedLocales,
		defaults.sourceLocale
	);

	return {
		slug,
		displayName,
		description,
		primaryUser,
		databaseName,
		databasePort: Number(databasePort),
		sourceLocale: isSupportedLocale(sourceLocale) ? sourceLocale : defaults.sourceLocale,
		logoPath,
		seedColor
	};
}

function summarize(answers: BootstrapAnswers): string {
	return [
		`  Nome de exibição : ${answers.displayName}`,
		`  Slug             : ${answers.slug}`,
		`  Descrição        : ${answers.description}`,
		`  Usuário-alvo     : ${answers.primaryUser}`,
		`  Banco de dados   : ${answers.databaseName} (porta ${answers.databasePort})`,
		`  Idioma principal : ${answers.sourceLocale}`,
		`  Logo             : ${answers.logoPath ? `${answers.logoPath} → ${answers.seedColor}` : 'não informado'}`
	].join('\n');
}

async function run(options: BootstrapOptions): Promise<void> {
	const manifestPath = join(options.root, 'project.manifest.yaml');
	const briefPath = join(options.root, 'docs', 'product-brief.md');
	if (!(await exists(manifestPath))) {
		throw new Error(`Manifesto não encontrado: ${manifestPath}`);
	}

	let source: AnswerSource;
	if (options.assumeYes) source = defaultsSource();
	else if (process.stdin.isTTY) source = terminalSource();
	else source = pipedSource(await Bun.stdin.text());
	const prompter = new Prompter(source);

	try {
		console.log('Golden Svelte Platform — bootstrap\n');
		const defaults = await readDefaults(manifestPath);
		const answers = await collectAnswers(prompter, defaults);

		console.log(`\nResumo:\n${summarize(answers)}\n`);
		if (!(await prompter.confirm('Aplicar estas respostas?', true))) {
			console.log('Bootstrap cancelado. Nenhum arquivo foi alterado.');
			return;
		}

		const actions: string[] = [];
		const manifestYaml = await readFile(manifestPath, 'utf8');
		const { yaml } = applyAnswersToManifest(manifestYaml, answers);
		actions.push('atualizar project.manifest.yaml');

		// The brief template is captured before activation because `activate --force` rewrites
		// docs/product-brief.md; the filled version is written afterwards so the answers survive.
		const briefTemplate = (await exists(briefPath)) ? await readFile(briefPath, 'utf8') : '';
		const brief = fillProductBrief(briefTemplate, answers, new Date().toISOString().slice(0, 10));
		if (briefTemplate.length > 0) actions.push('preencher docs/product-brief.md');

		const envDevPath = join(options.root, '.env.dev');
		const envPath = join(options.root, '.env');
		actions.push(`${(await exists(envDevPath)) ? 'atualizar' : 'criar'} .env.dev`);
		actions.push(`${(await exists(envPath)) ? 'atualizar' : 'criar'} .env`);
		if (answers.logoPath)
			actions.push(`gerar ${defaultPalettePath} a partir de ${answers.logoPath}`);

		if (options.dryRun) {
			console.log(
				`Plano do bootstrap (nenhum arquivo foi escrito):\n${actions.map((a) => `  • ${a}`).join('\n')}`
			);
			return;
		}

		await writeFile(manifestPath, yaml, 'utf8');
		console.log(`Plano do bootstrap:\n${actions.map((a) => `  • ${a}`).join('\n')}`);

		if (options.activate) {
			// A cloned scaffold already carries .scaffold/project.json, so activation only runs
			// with --force. `bun run activate` is the documented entry point for a fresh clone.
			const activated = await exists(join(options.root, '.scaffold', 'project.json'));
			const command = activated ? ['bun', 'run', 'scaffold:refresh'] : ['bun', 'run', 'activate'];
			console.log(`\nExecutando ${command.join(' ')} …`);
			const child = Bun.spawn(command, {
				cwd: options.root,
				stdout: 'inherit',
				stderr: 'inherit'
			});
			if ((await child.exited) !== 0) throw new Error('A ativação falhou.');
		}

		// Written after activation: it regenerates .env.dev.example from the new manifest, and the
		// identity keys below have to match the project the manifest now describes.
		const envDevSource = (await exists(envDevPath))
			? envDevPath
			: join(options.root, '.env.dev.example');
		const envDevContent = (await exists(envDevSource)) ? await readFile(envDevSource, 'utf8') : '';
		const envDev = upsertEnv(envDevContent, {
			COMPOSE_PROJECT_NAME: answers.slug,
			APP_NAME: answers.slug,
			PUBLIC_APP_URL: `http://${buildPublicHost(answers.slug)}`,
			PUBLIC_HOST: buildPublicHost(answers.slug),
			OTEL_SERVICE_NAME: answers.slug,
			POSTGRES_DB: answers.databaseName,
			POSTGRES_PORT: String(answers.databasePort)
		});
		await writeFile(envDevPath, envDev, 'utf8');

		const envSource = (await exists(envPath)) ? envPath : join(options.root, '.env.example');
		const envContent = (await exists(envSource)) ? await readFile(envSource, 'utf8') : '';
		const env = upsertEnv(envContent, {
			DATABASE_URL: `"${buildDatabaseUrl({
				user: readEnvValue(envDev, 'POSTGRES_USER') ?? 'app',
				password: readEnvValue(envDev, 'POSTGRES_PASSWORD') ?? 'change-me-locally',
				host: 'localhost',
				port: answers.databasePort,
				database: answers.databaseName
			})}"`,
			ORIGIN: `"http://localhost:5173"`
		});
		await writeFile(envPath, env, 'utf8');
		console.log('\n.env.dev e .env atualizados com a identidade e o banco do projeto.');

		if (answers.logoPath) {
			const theme = await generateTheme({
				logo: answers.logoPath,
				out: defaultPalettePath,
				root: options.root,
				dryRun: false
			});
			console.log(`\nTema da marca gerado em ${defaultPalettePath} (cor ${theme.seedHex}).`);
		}

		if (brief.content.length > 0) {
			await writeFile(briefPath, brief.content, 'utf8');
			console.log(`\ndocs/product-brief.md preenchido: ${brief.filled.join(', ') || 'nada'}`);
			if (brief.skipped.length > 0) {
				console.log(`Seções não encontradas (preencha à mão): ${brief.skipped.join(', ')}`);
			}
		}

		console.log(
			[
				'\nPróximos passos:',
				'  1. Revise project.manifest.yaml e docs/product-brief.md.',
				'  2. Defina BETTER_AUTH_SECRET em .env e .env.dev (32+ caracteres).',
				'  3. bun run dev:containers   # sobe app, PostgreSQL e OpenTelemetry',
				'  4. bun run verify           # portão agregado, precisa terminar com zero erros'
			].join('\n')
		);
	} finally {
		prompter.close();
	}
}

try {
	await run(parseArgs(Bun.argv.slice(2)));
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`Falha no bootstrap: ${message}`);
	process.exit(1);
}
