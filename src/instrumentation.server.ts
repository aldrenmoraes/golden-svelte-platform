import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const sdk = new NodeSDK({
	...(endpoint ? { traceExporter: new OTLPTraceExporter({ url: endpoint }) } : {}),
	instrumentations: [getNodeAutoInstrumentations()]
});

sdk.start();
