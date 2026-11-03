# n8n-nodes-parser-api-ki

[n8n](https://n8n.io/) community node for [Parser API KI+](https://parser-api.micro-ki.de). It sends a document to `https://parser-api.micro-ki.de` and returns fixed JSON. It can also ask for a quote, the credit balance, or recent usage.

Supported documents: invoices (including ZUGFeRD, Factur-X, XRechnung, EDIFACT), credit notes, delivery notes, purchase orders, bank statements (camt, MT940, MT942), and CVs.

Supported files: PDF, scans and photos (JPG, PNG, WebP, TIFF, HEIC), DOCX, ODT, plain text, and XML e-invoices.

Typical workflows:

- Read invoice attachments from Gmail or Outlook and pass the totals, line items, and IBAN to your accounting tool.
- Import bank statements as a list of transactions, whether they arrive as PDF, camt, or MT940.
- Send a file to the right document type with a Switch node on `error.detected_type`, for example a credit note that arrived as an invoice.
- Turn incoming CVs into structured candidate records.

The node is free and MIT-licensed. Parser API KI+ is a paid service: reading a real file spends credits from your account.

## Installation

On a self-hosted n8n instance, open **Settings → Community nodes → Install** and enter:

```text
n8n-nodes-parser-api-ki
```

On n8n Cloud, the node appears in the nodes panel once n8n has verified the package. See the [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) if the setting is missing.

## Credentials

Create a credential of type **Parser API KI+ API** and paste one API key.

| Key              | Use                                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `pak_live_…`     | Your own key from the Parser API KI+ account. Real files spend credits.                                                 |
| `pak_test_X0001` | Public test key. It ignores the file: no AI runs, and the response is always the sample JSON. Use it to build the flow. |

Saving the credential calls `GET /api/v1/account`, which costs 0 credits. The server address is fixed, so the key is only ever sent to `parser-api.micro-ki.de`. A request to any other host is rejected before the key is attached.

## Quick start

1. Add a node that produces a file in the binary field `data`, for example **Gmail** (attachments) or **Read/Write Files from Disk**.
2. Add **Parser API KI+**, choose **Parse Document** and the document type.
3. Run the workflow. The output item is the API JSON, for example `invoice.v1`.

Only have a URL? Put an **HTTP Request** node in front: method **GET**, response format **File**, output field **`data`**.

## Operations

| Operation                    | API call              | Output                                                   |
| ---------------------------- | --------------------- | -------------------------------------------------------- |
| **Parse Document** (default) | `POST /api/v1/{type}` | The fixed JSON for that document type, unchanged         |
| **Get Quote**                | `POST /api/v1/quote`  | What the file would cost. Spends no credits              |
| **Get Account Balance**      | `GET /api/v1/account` | Credits, available credits, alert threshold              |
| **Get Recent Usage**         | `GET /api/v1/usage`   | Calls from today and yesterday, at most 50, newest first |

## Documentation

- [Operations, fields, and options](https://github.com/Micro-KI/n8n-nodes-parser-api-ki/blob/main/docs/operations.md)
- [Errors, retries, and idempotency](https://github.com/Micro-KI/n8n-nodes-parser-api-ki/blob/main/docs/errors-and-retries.md)
- [Development and releases](https://github.com/Micro-KI/n8n-nodes-parser-api-ki/blob/main/docs/development.md)
- [Parser API KI+ API reference](https://parser-api.micro-ki.de/doku) (German page; each document type has an English Markdown and PDF download)

## Compatibility

Built for n8n 2.x with `n8nNodesApiVersion` 1. Self-hosted instances need community nodes enabled.

## Support

- Node issues: [GitHub issues](https://github.com/Micro-KI/n8n-nodes-parser-api-ki/issues)
- Security reports: see [SECURITY.md](https://github.com/Micro-KI/n8n-nodes-parser-api-ki/blob/main/SECURITY.md)

## License

[MIT](LICENSE). The license covers this node's code, not the Parser API KI+ service.
