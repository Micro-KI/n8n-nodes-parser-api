import type {
	ICredentialDataDecryptedObject,
	ICredentialTestRequest,
	ICredentialType,
	Icon,
	IHttpRequestOptions,
	INodeProperties,
} from 'n8n-workflow';

import { API_ORIGIN, isParserApiRequest } from '../nodes/ParserApiKi/api.js';

export class ParserApiKiApi implements ICredentialType {
	name = 'parserApiKiApi';

	displayName = 'Parser API KI+ API';

	documentationUrl = 'https://github.com/Micro-KI/n8n-nodes-parser-api-ki#credentials';

	icon: Icon = {
		light: 'file:parser-api.svg',
		dark: 'file:parser-api.dark.svg',
	};

	/**
	 * The loader records this node as the only consumer.
	 * The HTTP Request node then cannot send the key to another host.
	 * The ~/.n8n/custom loader drops that list, so this line is removed
	 * for local testing and put back before a release. See docs/development.md.
	 */
	restrictToSupportedNodes = true as const;

	hideDomainRestrictionFields = true;

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			placeholder: 'e.g. pak_live_…',
			description:
				'The API key from your Parser API KI+ account (pak_live_…). The public test key pak_test_X0001 ignores the file: no AI runs, and the response is always the sample JSON. Parsing a real file spends credits.',
		},
	];

	async authenticate(
		credentials: ICredentialDataDecryptedObject,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> {
		if (!isParserApiRequest(requestOptions.url, requestOptions.baseURL)) {
			throw new Error(`This credential only sends the API key to ${API_ORIGIN}.`);
		}
		const apiKey = typeof credentials.apiKey === 'string' ? credentials.apiKey : '';
		return {
			...requestOptions,
			headers: {
				...requestOptions.headers,
				Authorization: `Bearer ${apiKey}`,
			},
		};
	}

	test: ICredentialTestRequest = {
		request: {
			baseURL: API_ORIGIN,
			url: '/api/v1/account',
			method: 'GET',
		},
	};
}
