import { AsyncLocalStorage } from 'node:async_hooks';
import { trace } from '@opentelemetry/api';
import pino from 'pino';

type RequestContext = { correlationId: string; userId?: string; platformRole?: string };
const requestStorage = new AsyncLocalStorage<RequestContext>();
const zeros = { traceId: '00000000000000000000000000000000', spanId: '0000000000000000' };
const baseLogger = pino({
	level: process.env.LOG_LEVEL ?? 'info',
	base: {
		appVersion: process.env.APP_VERSION ?? '0.0.0-dev',
		environment: process.env.NODE_ENV ?? 'development',
		containerName: process.env.HOSTNAME ?? 'local'
	},
	formatters: { level: (label) => ({ level: label }) },
	timestamp: pino.stdTimeFunctions.isoTime
});

function telemetryContext() {
	const span = trace.getActiveSpan()?.spanContext();
	return { traceId: span?.traceId ?? zeros.traceId, spanId: span?.spanId ?? zeros.spanId };
}

export function withRequestContext<T>(context: RequestContext, callback: () => T): T {
	return requestStorage.run(context, callback);
}

export const logger = {
	info(fields: Record<string, unknown>, message: string) {
		baseLogger.info({ ...telemetryContext(), ...requestStorage.getStore(), ...fields }, message);
	},
	error(fields: Record<string, unknown>, message: string) {
		baseLogger.error({ ...telemetryContext(), ...requestStorage.getStore(), ...fields }, message);
	}
};
