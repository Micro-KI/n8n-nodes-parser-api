import assert from 'node:assert/strict';
import test from 'node:test';

import { API_ORIGIN, buildMultipartBody } from '../dist/nodes/ParserApiKi/api.js';

// Public key from https://parser-api.micro-ki.de/doku. It ignores the file and returns fixtures.
const KEY = 'pak_test_X0001';
const file = { filename: 'note.txt', contentType: 'text/plain', data: Buffer.from('Test file.\n') };

async function api(path, init = {}) {
	const response = await fetch(`${API_ORIGIN}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${KEY}`,
			Accept: 'application/json',
			...init.headers,
		},
	});
	const text = await response.text();
	let body = text;
	try {
		body = JSON.parse(text);
	} catch {
		body = text;
	}
	return { status: response.status, body };
}

async function postFile(path, fields = {}, headers = {}) {
	const multipart = buildMultipartBody(file, fields);
	return api(path, {
		method: 'POST',
		headers: { 'Content-Type': multipart.contentType, ...headers },
		body: multipart.body,
	});
}

test('account answers the public test key', { timeout: 30_000 }, async () => {
	const { status, body } = await api('/api/v1/account');
	assert.equal(status, 200, JSON.stringify(body));
	assert.equal(body.test, true);
	assert.equal(typeof body.credits, 'number');
	assert.ok(typeof body.request_id === 'string' && body.request_id !== '');
});

test('parse accepts the multipart body and returns the fixture', { timeout: 30_000 }, async () => {
	const { status, body } = await postFile(
		'/api/v1/invoice',
		{},
		{ 'Idempotency-Key': 'live-0001' },
	);
	assert.equal(status, 200, JSON.stringify(body));
	assert.equal(body.schema, 'invoice.v1');
	assert.equal(body.invoice.number, 'RE-TEST-1');
});

test('every document type has an address', { timeout: 60_000 }, async () => {
	const schemas = {
		'credit-note': 'creditnote.v1',
		'delivery-note': 'deliverynote.v1',
		'purchase-order': 'purchaseorder.v1',
		'bank-statement': 'bankstatement.v1',
		cv: 'cv.v1',
	};
	for (const [slug, schema] of Object.entries(schemas)) {
		const { status, body } = await postFile(`/api/v1/${slug}`);
		assert.equal(status, 200, `${slug}: ${JSON.stringify(body)}`);
		assert.equal(body.schema, schema);
	}
});

test('quote prices the same multipart file', { timeout: 30_000 }, async () => {
	const { status, body } = await postFile('/api/v1/quote', { type: 'credit-note' });
	assert.equal(status, 200, JSON.stringify(body));
	assert.equal(typeof body.needed, 'number');
	assert.equal(typeof body.available, 'number');
});

test('quote rejects a schema name as type', { timeout: 30_000 }, async () => {
	const { status, body } = await postFile('/api/v1/quote', { type: 'invoice.v1' });
	assert.equal(status, 422, JSON.stringify(body));
	assert.equal(body.error.code, 'invalid_type');
});

test('a wrong key answers 401 with an English message', { timeout: 30_000 }, async () => {
	const response = await fetch(`${API_ORIGIN}/api/v1/account`, {
		headers: { Authorization: 'Bearer pak_live_wrong', Accept: 'application/json' },
	});
	const body = await response.json();
	assert.equal(response.status, 401, JSON.stringify(body));
	assert.equal(typeof body.error.code, 'string');
	assert.equal(typeof body.error.message, 'string');
});

test('usage lists recent calls', { timeout: 30_000 }, async () => {
	const { status, body } = await api('/api/v1/usage?type=invoice');
	assert.equal(status, 200, JSON.stringify(body));
	assert.ok(Array.isArray(body.entries));
});
