import type {
	IBinaryKeyData,
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	INode,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError, sleep } from 'n8n-workflow';

import {
	API_ORIGIN,
	type ApiFailure,
	type CallOptions,
	type DocumentTypeSlug,
	buildMultipartBody,
	DOCUMENT_TYPES,
	headerValue,
	isJsonObject,
	MAX_RETRIES,
	readApiFailure,
	readCallOptions,
	REQUEST_TIMEOUT_MS,
	resolveIdempotencyKey,
	retryDelayMs,
	shouldRetry,
	uploadFileName,
} from './api.js';

const DOCUMENT_TYPE_OPTIONS = [
	{
		name: 'Invoice',
		value: 'invoice',
		description: 'Invoice, ZUGFeRD, Factur-X, XRechnung, or EDIFACT',
	},
	{
		name: 'Credit Note',
		value: 'credit-note',
		description: 'Credit note, UBL CreditNote, or document type 381',
	},
	{
		name: 'Delivery Note',
		value: 'delivery-note',
		description: 'Delivery note or despatch advice',
	},
	{
		name: 'Purchase Order',
		value: 'purchase-order',
		description: 'Purchase order or UBL order',
	},
	{
		name: 'Bank Statement',
		value: 'bank-statement',
		description: 'Bank statement, camt, MT940, or MT942',
	},
	{ name: 'CV', value: 'cv', description: 'Curriculum vitae' },
] as const;

/**
 * Programmatic on purpose. A declarative node cannot wait on Retry-After,
 * upload one multipart file, drop that file afterwards, or place
 * error.detected_type on the item for a Switch node.
 */
export class ParserApiKi implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Parser API KI+',
		name: 'parserApiKi',
		icon: {
			light: 'file:parser-api.svg',
			dark: 'file:parser-api.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle:
			'={{({"parse":"Parse Document","quote":"Get Quote","account":"Get Account Balance","usage":"Get Recent Usage"})[$parameter["operation"]]}}',
		description:
			'Extract invoices, e-invoices, credit notes, delivery notes, purchase orders, bank statements, and CVs into fixed JSON',
		defaults: {
			name: 'Parser API KI+',
		},
		usableAsTool: true,
		builderHint: {
			searchHint:
				'Turns one file in a binary field into fixed JSON: PDF, scan or photo (JPG, PNG, WebP, TIFF, HEIC), DOCX, ODT, text, or an XML e-invoice such as ZUGFeRD, Factur-X, XRechnung, UBL, EDIFACT, camt, or MT940. Use it for invoice data extraction, bank statement import, and CV parsing.',
			relatedNodes: [
				{
					nodeType: 'n8n-nodes-base.gmail',
					relationHint: 'Downloads email attachments into the binary field data',
				},
				{
					nodeType: 'n8n-nodes-base.httpRequest',
					relationHint: 'Downloads a file from a URL with response format File',
				},
				{
					nodeType: 'n8n-nodes-base.switch',
					relationHint: 'Routes the Continue output by error.code or error.detected_type',
				},
			],
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'parserApiKiApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Parse Document',
						value: 'parse',
						description:
							'Read the file and return the fixed JSON. Real files spend credits. The public test key ignores the file and always returns the sample JSON.',
						action: 'Parse document',
					},
					{
						name: 'Get Quote',
						value: 'quote',
						description: 'Ask what the file would cost, without spending credits',
						action: 'Get quote',
					},
					{
						name: 'Get Account Balance',
						value: 'account',
						description: 'Read the credit balance and the alert threshold',
						action: 'Get account balance',
					},
					{
						name: 'Get Recent Usage',
						value: 'usage',
						description: 'Read the latest calls from today and yesterday, at most 50',
						action: 'Get recent usage',
					},
				],
				default: 'parse',
			},
			{
				displayName: 'Document Type',
				name: 'documentType',
				type: 'options',
				default: 'invoice',
				displayOptions: {
					show: {
						operation: ['parse', 'quote'],
					},
				},
				options: [...DOCUMENT_TYPE_OPTIONS],
				description:
					'Where the file is sent. A quote sends the same value as the form field type, for example credit-note.',
			},
			{
				displayName: 'Input Binary Field',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				required: true,
				displayOptions: {
					show: {
						operation: ['parse', 'quote'],
					},
				},
				description:
					'Binary field that holds the file. The workflow file and Gmail usually use data. The file is uploaded as form field file, with its original name and extension. This node does not download a link. If you only have an address, put an HTTP Request node in front: method GET, response format File, output field data. Credentials for that address stay on that node.',
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add filter',
				default: {},
				displayOptions: {
					show: {
						operation: ['usage'],
					},
				},
				options: [
					{
						displayName: 'Document Type',
						name: 'usageDocumentType',
						type: 'options',
						default: 'invoice',
						options: [...DOCUMENT_TYPE_OPTIONS],
						description:
							'Only return calls for this document type. Uses the same words as the document address, such as credit-note.',
					},
				],
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Force a Fresh Read',
						name: 'force',
						type: 'boolean',
						default: false,
						displayOptions: {
							show: {
								'/operation': ['parse', 'quote'],
							},
						},
						description:
							'Whether to send X-Parser-Force: 1. That skips the stored answer from the last 15 minutes and spends credits again. On a quote, the price includes that fresh read. Off unless you add this option.',
					},
					{
						displayName: 'Idempotency Key',
						name: 'idempotencyKey',
						type: 'string',
						default: '',
						displayOptions: {
							show: {
								'/operation': ['parse'],
							},
						},
						placeholder: 'e.g. 000001-0',
						description:
							'Sent only when parsing. 8 to 128 characters: letters, digits, dot, underscore, or hyphen. One value per file. Leave empty to use the execution ID and the item index. A short execution ID is padded with zeros, for example 000001-0.',
					},
					{
						displayName: 'Read Lines with OCR',
						name: 'linesOcr',
						type: 'boolean',
						default: false,
						displayOptions: {
							show: {
								'/operation': ['parse', 'quote'],
								'/documentType': ['invoice'],
							},
						},
						description:
							'Whether to send X-Parser-Lines: ocr on an invoice, so the AI reads line items from the visible page of a ZUGFeRD or Factur-X PDF that has none in its XML. This costs the per-page price. Credit notes have no such switch. Off unless you add this option.',
					},
					{
						displayName: 'Remove the File Afterwards',
						name: 'dropBinary',
						type: 'boolean',
						default: true,
						displayOptions: {
							show: {
								'/operation': ['parse', 'quote'],
							},
						},
						description:
							'Whether to remove the uploaded file from the item after a successful parse or quote. On unless you add this option and turn it off. This keeps a self-hosted n8n from filling up on many attachments.',
					},
					{
						displayName: 'Retry on a Short Outage',
						name: 'retryOnBusy',
						type: 'boolean',
						default: true,
						description:
							'Whether to wait and send the same call again, at most three more times, when the same file is still running, the account is busy, the rate limit answers, or the service returns HTTP 500–599. The pause comes from the Retry-After header. A wrong key, low credits, a rejected file, or an idempotency conflict is not retried. On unless you add this option and turn it off.',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const operation = this.getNodeParameter('operation', itemIndex) as string;
				const sendsFile = operation === 'parse' || operation === 'quote';
				const options = readCallOptions(callOptionsFromNode(this, itemIndex, sendsFile));
				const outcome = await runOperation(this, itemIndex, operation, options);
				if (outcome.ok) {
					returnData.push(
						successItem(outcome.body, items[itemIndex], outcome.dropField, itemIndex),
					);
					continue;
				}
				if (placesErrorOnItem(this)) {
					returnData.push(
						failureItem(outcome.failure, outcome.status, items[itemIndex], itemIndex),
					);
					continue;
				}
				throw apiError(this, outcome.failure, outcome.status, outcome.body, itemIndex);
			} catch (error) {
				if (placesErrorOnItem(this)) {
					returnData.push(unknownFailureItem(error, items[itemIndex], itemIndex));
					continue;
				}
				if (error instanceof NodeOperationError) {
					throw new NodeOperationError(this.getNode(), error, { itemIndex });
				}
				if (error instanceof NodeApiError) {
					error.context.itemIndex = itemIndex;
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject, { itemIndex });
				}
				const message = error instanceof Error ? error.message : NO_ANSWER;
				throw new NodeApiError(this.getNode(), { message }, { itemIndex, message });
			}
		}

		return [returnData];
	}
}

/**
 * Options added in the panel win. A workflow saved before these switches moved
 * into Options still has them on the node itself.
 */
function callOptionsFromNode(
	ctx: IExecuteFunctions,
	itemIndex: number,
	sendsFile: boolean,
): IDataObject {
	const raw = ctx.getNodeParameter('options', itemIndex, {});
	const options: IDataObject = isJsonObject(raw) ? { ...raw } : {};
	const saved = ctx.getNode().parameters;
	if (options.retryOnBusy === undefined && typeof saved.retryOnBusy === 'boolean') {
		options.retryOnBusy = saved.retryOnBusy;
	}
	if (!sendsFile) {
		options.dropBinary = false;
	} else if (options.dropBinary === undefined && typeof saved.dropBinary === 'boolean') {
		options.dropBinary = saved.dropBinary;
	}
	return options;
}

function selectedUsageType(ctx: IExecuteFunctions, itemIndex: number): string {
	const filters = ctx.getNodeParameter('filters', itemIndex, {});
	if (isJsonObject(filters) && typeof filters.usageDocumentType === 'string') {
		const selected = filters.usageDocumentType.trim();
		if (selected !== '') {
			return selected;
		}
	}
	const saved = ctx.getNode().parameters.usageDocumentType;
	if (typeof saved === 'string' && saved.trim() !== '') {
		return saved.trim();
	}
	return 'all';
}

interface SuccessOutcome {
	ok: true;
	body: IDataObject;
	dropField?: string;
}

interface FailureOutcome {
	ok: false;
	status: number;
	body: unknown;
	failure: ApiFailure;
}

async function runOperation(
	ctx: IExecuteFunctions,
	itemIndex: number,
	operation: string,
	options: CallOptions,
): Promise<SuccessOutcome | FailureOutcome> {
	if (operation === 'account') {
		return callJson(ctx, itemIndex, options, {
			method: 'GET',
			url: `${API_ORIGIN}/api/v1/account`,
		});
	}
	if (operation === 'usage') {
		const usageType = selectedUsageType(ctx, itemIndex);
		const qs: IDataObject = {};
		if (usageType !== '' && usageType !== 'all') {
			qs.type = usageType;
		}
		return callJson(ctx, itemIndex, options, {
			method: 'GET',
			url: `${API_ORIGIN}/api/v1/usage`,
			qs,
		});
	}

	const documentType = ctx.getNodeParameter('documentType', itemIndex) as DocumentTypeSlug;
	if (!DOCUMENT_TYPES.includes(documentType)) {
		throw inputError(
			ctx,
			itemIndex,
			'unknown_document_type',
			`Choose a document type from the list. "${documentType}" is not one of them.`,
		);
	}
	const binaryPropertyName = ctx.getNodeParameter('binaryPropertyName', itemIndex) as string;
	const binary = ctx.helpers.assertBinaryData(itemIndex, binaryPropertyName);
	const buffer = await ctx.helpers.getBinaryDataBuffer(itemIndex, binaryPropertyName);
	const file = {
		filename: uploadFileName(binary.fileName, binary.fileExtension),
		contentType: binary.mimeType || 'application/octet-stream',
		data: buffer,
	};

	const headers: IDataObject = {};
	if (documentType === 'invoice' && options.linesOcr) {
		headers['X-Parser-Lines'] = 'ocr';
	}
	if (options.force) {
		headers['X-Parser-Force'] = '1';
	}

	if (operation === 'quote') {
		const multipart = buildMultipartBody(file, { type: documentType });
		headers['Content-Type'] = multipart.contentType;
		const outcome = await callJson(ctx, itemIndex, options, {
			method: 'POST',
			url: `${API_ORIGIN}/api/v1/quote`,
			headers,
			body: multipart.body,
		});
		return outcome.ok
			? { ...outcome, dropField: options.dropBinary ? binaryPropertyName : undefined }
			: outcome;
	}

	if (operation !== 'parse') {
		throw inputError(
			ctx,
			itemIndex,
			'unknown_operation',
			'Choose Parse Document, Get Quote, Get Account Balance, or Get Recent Usage.',
		);
	}

	const resolved = resolveIdempotencyKey(options.idempotencyKey, ctx.getExecutionId(), itemIndex);
	if ('error' in resolved) {
		throw inputError(ctx, itemIndex, 'invalid_idempotency_key', resolved.error);
	}
	headers['Idempotency-Key'] = resolved.key;
	const multipart = buildMultipartBody(file);
	headers['Content-Type'] = multipart.contentType;
	const outcome = await callJson(ctx, itemIndex, options, {
		method: 'POST',
		url: `${API_ORIGIN}/api/v1/${documentType}`,
		headers,
		body: multipart.body,
	});
	return outcome.ok
		? { ...outcome, dropField: options.dropBinary ? binaryPropertyName : undefined }
		: outcome;
}

async function callJson(
	ctx: IExecuteFunctions,
	itemIndex: number,
	options: CallOptions,
	request: IHttpRequestOptions,
): Promise<SuccessOutcome | FailureOutcome> {
	let attempt = 0;
	for (;;) {
		const response = await send(ctx, itemIndex, request);
		if (response.statusCode >= 200 && response.statusCode < 300) {
			if (!isJsonObject(response.body)) {
				throw inputError(
					ctx,
					itemIndex,
					'not_json',
					'Parser API KI+ answered with something other than a JSON object. Run the node again.',
				);
			}
			return { ok: true, body: response.body as IDataObject };
		}
		const failure = readApiFailure(response.statusCode, response.body);
		if (
			options.retryOnBusy &&
			attempt < MAX_RETRIES &&
			shouldRetry(response.statusCode, failure.code)
		) {
			attempt += 1;
			await sleep(retryDelayMs(headerValue(response.headers, 'retry-after'), Date.now()));
			continue;
		}
		return { ok: false, status: response.statusCode, body: response.body, failure };
	}
}

interface ApiResponse {
	statusCode: number;
	body: unknown;
	headers?: Record<string, unknown>;
}

async function send(
	ctx: IExecuteFunctions,
	itemIndex: number,
	request: IHttpRequestOptions,
): Promise<ApiResponse> {
	const response: unknown = await ctx.helpers.httpRequestWithAuthentication.call(
		ctx,
		'parserApiKiApi',
		{
			...request,
			json: true,
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
			timeout: REQUEST_TIMEOUT_MS,
			allowedDomains: 'parser-api.micro-ki.de',
		},
	);
	if (!isJsonObject(response) || typeof response.statusCode !== 'number') {
		throw inputError(
			ctx,
			itemIndex,
			'unexpected_response',
			'Parser API KI+ answered without an HTTP status. Run the node again. If it keeps happening, update n8n.',
		);
	}
	const headers = isJsonObject(response.headers) ? response.headers : undefined;
	return {
		statusCode: response.statusCode,
		body: response.body,
		headers,
	};
}

function placesErrorOnItem(ctx: IExecuteFunctions): boolean {
	return ctx.continueOnFail() && ctx.getNode().onError !== 'continueErrorOutput';
}

function successItem(
	body: IDataObject,
	item: INodeExecutionData,
	dropField: string | undefined,
	itemIndex: number,
): INodeExecutionData {
	const output: INodeExecutionData = {
		json: body,
		pairedItem: { item: itemIndex },
	};
	if (!item.binary) {
		return output;
	}
	if (!dropField) {
		output.binary = item.binary;
		return output;
	}
	const remaining: IBinaryKeyData = { ...item.binary };
	delete remaining[dropField];
	if (Object.keys(remaining).length > 0) {
		output.binary = remaining;
	}
	return output;
}

function failureItem(
	failure: ApiFailure,
	status: number,
	item: INodeExecutionData,
	itemIndex: number,
): INodeExecutionData {
	return {
		json: {
			error: {
				code: failure.code,
				message: failure.message,
				detected_type: failure.detectedType,
			},
			request_id: failure.requestId,
			httpStatus: status,
		},
		binary: item.binary,
		pairedItem: { item: itemIndex },
	};
}

function unknownFailureItem(
	error: unknown,
	item: INodeExecutionData,
	itemIndex: number,
): INodeExecutionData {
	const message = error instanceof Error ? error.message : NO_ANSWER;
	const httpCode = error instanceof NodeApiError ? Number(error.httpCode) : 0;
	return failureItem(
		{
			code: error instanceof ParserInputError ? error.code : 'request_failed',
			message,
			detectedType: '',
			requestId: '',
		},
		Number.isFinite(httpCode) ? httpCode : 0,
		item,
		itemIndex,
	);
}

const NO_ANSWER = 'Parser API KI+ did not answer. Check the connection and run the node again.';

/** Carries a stable snake_case code to the Continue output, like the API's error.code. */
class ParserInputError extends NodeOperationError {
	readonly code: string;

	constructor(node: INode, code: string, message: string, itemIndex: number) {
		super(node, message, { itemIndex });
		this.code = code;
	}
}

function inputError(
	ctx: IExecuteFunctions,
	itemIndex: number,
	code: string,
	message: string,
): ParserInputError {
	return new ParserInputError(ctx.getNode(), code, message, itemIndex);
}

function apiError(
	ctx: IExecuteFunctions,
	failure: ApiFailure,
	status: number,
	body: unknown,
	itemIndex: number,
): NodeApiError {
	const errorResponse: JsonObject = isJsonObject(body)
		? (body as JsonObject)
		: { message: failure.message, code: failure.code };
	return new NodeApiError(ctx.getNode(), errorResponse, {
		message: failure.message,
		httpCode: String(status),
		itemIndex,
	});
}
