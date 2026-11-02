import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	automaticIdempotencyKey,
	buildMultipartBody,
	headerValue,
	isParserApiRequest,
	readApiFailure,
	readCallOptions,
	resolveIdempotencyKey,
	retryDelayMs,
	shouldRetry,
	uploadFileName,
} from '../dist/nodes/ParserApiKi/api.js';

test('automatic idempotency key pads a short execution id', () => {
	assert.equal(automaticIdempotencyKey('123456', 0), '123456-0');
	assert.equal(automaticIdempotencyKey('12345', 0), '012345-0');
	assert.equal(automaticIdempotencyKey('1', 0), '000001-0');
	assert.equal(automaticIdempotencyKey('1', 0).length >= 8, true);
});

test('custom idempotency key is checked and not padded', () => {
	assert.deepEqual(resolveIdempotencyKey('lauf-1-0', '1', 0), { key: 'lauf-1-0' });
	assert.deepEqual(resolveIdempotencyKey('', '12 3456', 1), { key: '123456-1' });
	assert.deepEqual(resolveIdempotencyKey('', '!!!', 0), { key: '00exec-0' });
	assert.equal('error' in resolveIdempotencyKey('short', '1', 0), true);
	assert.equal('error' in resolveIdempotencyKey('has space!', '1', 0), true);
	assert.equal('error' in resolveIdempotencyKey('a'.repeat(7), '1', 0), true);
	assert.deepEqual(resolveIdempotencyKey('a'.repeat(8), '1', 0), { key: 'a'.repeat(8) });
	assert.deepEqual(resolveIdempotencyKey('a'.repeat(128), '1', 0), { key: 'a'.repeat(128) });
	assert.equal('error' in resolveIdempotencyKey('a'.repeat(129), '1', 0), true);
});

test('retry matrix matches the API cases', () => {
	assert.equal(shouldRetry(409, 'parse_in_progress'), true);
	assert.equal(shouldRetry(409, 'account_busy'), true);
	assert.equal(shouldRetry(409, 'idempotency_key_conflict'), false);
	assert.equal(shouldRetry(429, 'rate_limited'), true);
	assert.equal(shouldRetry(503, 'ai_unavailable'), true);
	assert.equal(shouldRetry(500, 'account_corrupt'), false);
	assert.equal(shouldRetry(500, 'capture_corrupt'), false);
	assert.equal(shouldRetry(401, 'unauthorized'), false);
	assert.equal(shouldRetry(402, 'insufficient_credits'), false);
	assert.equal(shouldRetry(413, 'document_too_large'), false);
	assert.equal(shouldRetry(415, 'upload_missing'), false);
	assert.equal(shouldRetry(422, 'not_an_invoice'), false);
});

test('retry delay uses Retry-After and stays bounded', () => {
	assert.equal(retryDelayMs('5', 0), 5000);
	assert.equal(retryDelayMs(undefined, 0), 2000);
	assert.equal(retryDelayMs('0', 0), 2000);
	assert.equal(retryDelayMs('9999', 0), 120_000);
	const now = Date.parse('2026-10-30T18:00:00Z');
	assert.equal(retryDelayMs('Thu, 30 Oct 2026 18:00:10 GMT', now), 10_000);
});

test('error body keeps detected_type and request id', () => {
	const failure = readApiFailure(422, {
		request_id: 'req-1',
		error: {
			code: 'unsupported_document_type',
			message: 'Credit notes go to /api/v1/credit-note.',
			detected_type: 'credit_note',
		},
	});
	assert.deepEqual(failure, {
		code: 'unsupported_document_type',
		message: 'Credit notes go to /api/v1/credit-note.',
		detectedType: 'credit_note',
		requestId: 'req-1',
	});
});

test('missing error fields become empty or a generic code', () => {
	const failure = readApiFailure(500, 'nope');
	assert.equal(failure.code, 'http_error');
	assert.equal(failure.detectedType, '');
	assert.equal(failure.requestId, '');
	assert.match(failure.message, /HTTP 500/);
});

test('options default the file drop and the retry to on', () => {
	assert.deepEqual(readCallOptions({}), {
		linesOcr: false,
		force: false,
		dropBinary: true,
		retryOnBusy: true,
		idempotencyKey: '',
	});
	const off = readCallOptions({}, { dropBinary: false, retryOnBusy: false });
	assert.equal(off.dropBinary, false);
	assert.equal(off.retryOnBusy, false);
	const picked = readCallOptions({ linesOcr: true, force: true, idempotencyKey: ' run-0001 ' });
	assert.equal(picked.linesOcr, true);
	assert.equal(picked.force, true);
	assert.equal(picked.idempotencyKey, 'run-0001');
});

test('upload name keeps the original file name', () => {
	assert.equal(uploadFileName('invoice.pdf', 'pdf'), 'invoice.pdf');
	assert.equal(uploadFileName('', 'xml'), 'document.xml');
	assert.equal(uploadFileName(undefined, undefined), 'document');
});

test('credential stays locked to this node', () => {
	const source = readFileSync(
		new URL('../dist/credentials/ParserApiKiApi.credentials.js', import.meta.url),
		'utf8',
	);
	assert.match(source, /restrictToSupportedNodes = true/);
});

test('credential host check allows only the API host', () => {
	assert.equal(isParserApiRequest('/api/v1/account', 'https://parser-api.micro-ki.de'), true);
	assert.equal(isParserApiRequest('https://parser-api.micro-ki.de/api/v1/quote'), true);
	assert.equal(isParserApiRequest('https://parser-api.micro-ki.de:443/api/v1/account'), true);
	assert.equal(isParserApiRequest('https://parser-api.micro-ki.de:444/api/v1/account'), false);
	assert.equal(isParserApiRequest('https://parser-api.micro-ki.de.evil.com/api/v1/account'), false);
	assert.equal(isParserApiRequest('http://parser-api.micro-ki.de/api/v1/account'), false);
	assert.equal(isParserApiRequest('https://example.com/api/v1/account'), false);
});

test('header lookup ignores case', () => {
	assert.equal(headerValue({ 'Retry-After': '5' }, 'retry-after'), '5');
	assert.equal(headerValue({ 'Retry-After': ['120', '5'] }, 'retry-after'), '120, 5');
});

test('multipart body keeps the file bytes, name, and quote type', () => {
	const data = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x0a]);
	const built = buildMultipartBody(
		{ filename: 'in"voice.pdf', contentType: 'application/pdf', data },
		{ type: 'credit-note' },
		'ParserApiKiTestBoundary',
	);
	const parts = readParts(built);
	assert.equal(parts.length, 2);
	assert.match(parts[0].headers, /name="file"/);
	assert.match(parts[0].headers, /filename="invoice.pdf"/);
	assert.match(parts[0].headers, /Content-Type: application\/pdf/);
	assert.deepEqual(parts[0].data, data);
	assert.match(parts[1].headers, /name="type"/);
	assert.equal(parts[1].data.toString('utf8'), 'credit-note');
	assert.match(built.contentType, /^multipart\/form-data; boundary=ParserApiKiTestBoundary$/);
});

test('multipart boundary is not taken from the file bytes', () => {
	const data = Buffer.from(`ParserApiKi${'ab'.repeat(40)}`);
	const built = buildMultipartBody({
		filename: 'note.txt',
		contentType: 'text/plain',
		data,
	});
	const boundary = built.contentType.split('boundary=')[1];
	assert.equal(data.includes(boundary), false);
	assert.deepEqual(readParts(built)[0].data, data);
});

function readParts(built) {
	const boundary = built.contentType.split('boundary=')[1];
	const delimiter = Buffer.from(`--${boundary}`);
	const parts = [];
	let start = built.body.indexOf(delimiter);
	while (start !== -1) {
		const after = start + delimiter.length;
		if (built.body.subarray(after, after + 2).toString('utf8') === '--') {
			break;
		}
		const headerEnd = built.body.indexOf(Buffer.from('\r\n\r\n'), after);
		const next = built.body.indexOf(delimiter, headerEnd + 4);
		parts.push({
			headers: built.body.subarray(after + 2, headerEnd).toString('utf8'),
			data: built.body.subarray(headerEnd + 4, next - 2),
		});
		start = next;
	}
	return parts;
}
