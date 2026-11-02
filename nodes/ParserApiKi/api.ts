import { randomBytes } from 'node:crypto';

export const API_ORIGIN = 'https://parser-api.micro-ki.de';

/** One try plus at most three repeats. */
export const MAX_RETRIES = 3;

/** Same ceiling as the account workflow file. The server works for up to 270 seconds. */
export const REQUEST_TIMEOUT_MS = 280_000;

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._-]{8,128}$/;

const RETRY_AFTER_CAP_MS = 120_000;
const RETRY_AFTER_FALLBACK_MS = 2_000;

export const DOCUMENT_TYPES = [
	'invoice',
	'credit-note',
	'delivery-note',
	'purchase-order',
	'bank-statement',
	'cv',
] as const;

export type DocumentTypeSlug = (typeof DOCUMENT_TYPES)[number];

export interface CallOptions {
	linesOcr: boolean;
	force: boolean;
	dropBinary: boolean;
	retryOnBusy: boolean;
	idempotencyKey: string;
}

export interface ApiFailure {
	code: string;
	message: string;
	detectedType: string;
	requestId: string;
}

export function isParserApiRequest(url: string, baseURL?: string): boolean {
	try {
		const resolved = new URL(url, baseURL || undefined);
		const httpsPort = resolved.port === '' || resolved.port === '443';
		return (
			resolved.protocol === 'https:' && resolved.hostname === 'parser-api.micro-ki.de' && httpsPort
		);
	} catch {
		return false;
	}
}

/**
 * `options` is the Options collection. The two switches sit on the node itself and
 * stay on unless the user turns them off.
 */
export function readCallOptions(
	options: unknown,
	switches: { dropBinary?: unknown; retryOnBusy?: unknown } = {},
): CallOptions {
	const record = asRecord(options);
	return {
		linesOcr: record?.linesOcr === true,
		force: record?.force === true,
		dropBinary: switches.dropBinary !== false,
		retryOnBusy: switches.retryOnBusy !== false,
		idempotencyKey: typeof record?.idempotencyKey === 'string' ? record.idempotencyKey.trim() : '',
	};
}

/**
 * Execution id plus item index, as in the workflow file (`12345-0`).
 * A short execution id is padded so the key still meets the 8-character minimum.
 */
export function automaticIdempotencyKey(executionId: string, itemIndex: number): string {
	const suffix = `-${itemIndex}`;
	let id = executionId.trim().replace(/[^A-Za-z0-9._-]/g, '');
	if (id === '') {
		id = 'exec';
	}
	const minIdLength = Math.max(1, 8 - suffix.length);
	if (id.length < minIdLength) {
		id = id.padStart(minIdLength, '0');
	}
	const key = `${id}${suffix}`;
	return key.length > 128 ? key.slice(0, 128) : key;
}

export function resolveIdempotencyKey(
	custom: string,
	executionId: string,
	itemIndex: number,
): { key: string } | { error: string } {
	if (custom !== '') {
		if (!IDEMPOTENCY_KEY.test(custom)) {
			return {
				error: 'Idempotency-Key: 8–128 characters, A–Z a–z 0–9 . _ - only.',
			};
		}
		return { key: custom };
	}
	return { key: automaticIdempotencyKey(executionId, itemIndex) };
}

export function uploadFileName(
	fileName: string | undefined,
	fileExtension: string | undefined,
): string {
	const cleaned = headerSafe(fileName ?? '').trim();
	if (cleaned !== '') {
		return cleaned;
	}
	const extension = (fileExtension ?? '').replace(/^\./, '').replace(/[^A-Za-z0-9]/g, '');
	return extension !== '' ? `document.${extension}` : 'document';
}

export interface MultipartFile {
	filename: string;
	contentType: string;
	data: Buffer;
}

export interface MultipartBody {
	body: Buffer;
	contentType: string;
}

const CRLF = '\r\n';

/**
 * Hand-built multipart body. n8n forwards a Buffer when Content-Type is already set.
 * Global FormData has no getHeaders(), which the n8n HTTP helper calls on form bodies,
 * and community nodes may not ship the form-data package.
 */
export function buildMultipartBody(
	file: MultipartFile,
	fields: Readonly<Record<string, string>> = {},
	boundary?: string,
): MultipartBody {
	const chosen = boundary ?? freshBoundary(file.data);
	const chunks: Buffer[] = [
		Buffer.from(
			`--${chosen}${CRLF}` +
				`Content-Disposition: form-data; name="file"; filename="${headerSafe(file.filename)}"${CRLF}` +
				`Content-Type: ${partContentType(file.contentType)}${CRLF}${CRLF}`,
			'utf8',
		),
		file.data,
		Buffer.from(CRLF, 'utf8'),
	];
	for (const [fieldName, text] of Object.entries(fields)) {
		chunks.push(
			Buffer.from(
				`--${chosen}${CRLF}` +
					`Content-Disposition: form-data; name="${headerSafe(fieldName)}"${CRLF}${CRLF}` +
					`${singleLine(text)}${CRLF}`,
				'utf8',
			),
		);
	}
	chunks.push(Buffer.from(`--${chosen}--${CRLF}`, 'utf8'));
	return {
		body: Buffer.concat(chunks),
		contentType: `multipart/form-data; boundary=${chosen}`,
	};
}

function freshBoundary(data: Buffer): string {
	for (let attempt = 0; attempt < 5; attempt++) {
		const boundary = `ParserApiKi${randomBytes(16).toString('hex')}`;
		if (!data.includes(boundary)) {
			return boundary;
		}
	}
	return `ParserApiKi${randomBytes(24).toString('hex')}`;
}

function headerSafe(value: string): string {
	return value.replace(/[\r\n"\\]/g, '');
}

function singleLine(value: string): string {
	return value.replace(/[\r\n]/g, '');
}

function partContentType(value: string): string {
	const cleaned = singleLine(value).replace(/"/g, '').trim();
	return cleaned === '' ? 'application/octet-stream' : cleaned;
}

export function shouldRetry(status: number, errorCode: string): boolean {
	if (status === 409) {
		return errorCode === 'parse_in_progress' || errorCode === 'account_busy';
	}
	if (status === 429) {
		return true;
	}
	if (status >= 500 && status <= 599) {
		return errorCode !== 'account_corrupt' && errorCode !== 'capture_corrupt';
	}
	return false;
}

export function retryDelayMs(retryAfter: string | undefined, nowMs: number): number {
	const raw = retryAfter?.trim() ?? '';
	let delayMs: number | undefined;
	if (/^\d+$/.test(raw)) {
		delayMs = Number(raw) * 1000;
	} else if (raw !== '') {
		const when = Date.parse(raw);
		if (!Number.isNaN(when)) {
			delayMs = when - nowMs;
		}
	}
	if (delayMs === undefined || delayMs < 1000) {
		delayMs = RETRY_AFTER_FALLBACK_MS;
	}
	return Math.min(delayMs, RETRY_AFTER_CAP_MS);
}

export function readApiFailure(status: number, body: unknown): ApiFailure {
	const record = asRecord(body);
	const error = asRecord(record?.error);
	const code = typeof error?.code === 'string' && error.code !== '' ? error.code : 'http_error';
	const message =
		typeof error?.message === 'string' && error.message !== ''
			? error.message
			: `Request failed with HTTP ${status}.`;
	const detectedType = typeof error?.detected_type === 'string' ? error.detected_type : '';
	const requestId = typeof record?.request_id === 'string' ? record.request_id : '';
	return { code, message, detectedType, requestId };
}

export function headerValue(
	headers: Record<string, unknown> | undefined,
	name: string,
): string | undefined {
	if (!headers) {
		return undefined;
	}
	const wanted = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() !== wanted) {
			continue;
		}
		if (Array.isArray(value)) {
			return value.map((part) => String(part)).join(', ');
		}
		if (typeof value === 'string' || typeof value === 'number') {
			return String(value);
		}
	}
	return undefined;
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return isJsonObject(value) ? value : undefined;
}
