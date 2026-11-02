# Operations, fields, and options

This page describes what each operation sends to Parser API KI+ and what it returns to the next node.

## Document types

| Node option    | API address      | Schema in the response |
| -------------- | ---------------- | ---------------------- |
| Invoice        | `invoice`        | `invoice.v1`           |
| Credit Note    | `credit-note`    | `creditnote.v1`        |
| Delivery Note  | `delivery-note`  | `deliverynote.v1`      |
| Purchase Order | `purchase-order` | `purchaseorder.v1`     |
| Bank Statement | `bank-statement` | `bankstatement.v1`     |
| CV             | `cv`             | `cv.v1`                |

Accepted file formats: PDF, JPG, PNG, WEBP, TIFF, HEIC, DOCX, ODT, TXT, STA, MT940, XML, and EDI. Size and page limits are listed in the [API reference](https://parser-api.micro-ki.de/doku).

## Parse Document

`POST /api/v1/{type}` with the file as multipart form field `file`.

The response JSON is passed through unchanged. New fields that the API adds to a schema appear in n8n without a new version of this node.

Shortened example for an invoice:

```json
{
	"schema": "invoice.v1",
	"source": "xrechnung",
	"document": { "type": "invoice", "page_count": 0, "currency": "EUR" },
	"vendor": { "name": "Fixture GmbH", "vat_id": "DE123456789", "iban": "DE02120300000000202051" },
	"invoice": { "number": "RE-TEST-1", "date": "2024-03-15", "due_date": "2024-04-14" },
	"totals": { "net": 100.0, "vat": 19.0, "gross": 119.0, "due": 119.0 },
	"request_id": "…"
}
```

The full field list per schema is in the [API reference](https://parser-api.micro-ki.de/doku).

The same file within 15 minutes returns the stored answer and costs 0 credits, unless **Force a Fresh Read** is on.

## Get Quote

`POST /api/v1/quote` with the same file plus the form field `type`. The node fills `type` from the document type, for example `credit-note`. Schema names such as `invoice.v1` are rejected by the server.

| Field            | Meaning                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `request_id`     | This request                                                                                 |
| `needed`         | Credits the parse would cost                                                                 |
| `available`      | Credits usable right now                                                                     |
| `billable_units` | Files or pages charged                                                                       |
| `kind`           | `file` (one price per file) or `page` (price per page)                                       |
| `page_count`     | Pages of a PDF or TIFF, 1 for an image, 0 otherwise                                          |
| `source_hint`    | What the file looks like, for example `xrechnung` or `camt`. `null` if the AI has to read it |
| `pricing.rule`   | `structured`, `office`, or `pdf_ocr`                                                         |
| `pricing.label`  | The same rate as a sentence                                                                  |

**Read Lines with OCR** and **Force a Fresh Read** change the price, so the quote takes them into account.

The default workflow does not need a quote. If credits run out, **Parse Document** answers `402 insufficient_credits` before any AI runs.

## Get Account Balance

`GET /api/v1/account`. Costs 0 credits.

| Field             | Meaning                                                            |
| ----------------- | ------------------------------------------------------------------ |
| `credits`         | Balance of the account                                             |
| `available`       | Usable right away. Credits reserved for running calls are deducted |
| `alert_threshold` | Balance below which the account sends an e-mail reminder           |
| `alert_enabled`   | Whether the reminder is on                                         |
| `live_key_prefix` | Start of your API key                                              |
| `test_key_prefix` | Start of the test key                                              |
| `mail`            | E-mail of the account                                              |
| `test`            | `true` when the test key was used                                  |

## Get Recent Usage

`GET /api/v1/usage`, optionally filtered by document type with the same words as the API address (`credit-note`, not `credit_note`).

The response has `request_id` and `entries[]`: the calls of today and yesterday, at most 50, newest first. Each entry has `request_id`, `ts` (ISO time, Europe/Berlin), `type`, `status`, `source`, `cache`, `billed`, `pages`, `error_code`, `fingerprint`, and `lines_ocr`.

## Node fields

| Field                      | Shown for    | Default | Effect                                                                                                             |
| -------------------------- | ------------ | ------- | ------------------------------------------------------------------------------------------------------------------ |
| Document Type              | parse, quote | Invoice | Chooses the API address and the quote `type`                                                                       |
| Document Type (filter)     | usage        | All     | Filters recent usage                                                                                               |
| Input Binary Field         | parse, quote | `data`  | Binary field that holds the file. Uploaded with its original file name and extension                               |
| Remove the File Afterwards | parse, quote | on      | Removes that binary field after a successful call. Other binary fields stay. On failure the file stays on the item |
| Retry on a Short Outage    | all          | on      | See [Errors, retries, and idempotency](errors-and-retries.md)                                                      |

## Options

| Option              | Shown for                  | Effect                                                                                                                                                   |
| ------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Force a Fresh Read  | parse, quote               | Sends `X-Parser-Force: 1`. Skips the stored answer from the last 15 minutes and spends credits again                                                     |
| Idempotency Key     | parse                      | Replaces the automatic key. See [Errors, retries, and idempotency](errors-and-retries.md#idempotency-key)                                                |
| Read Lines with OCR | parse, quote; Invoice only | Sends `X-Parser-Lines: ocr`. For ZUGFeRD or Factur-X PDFs whose XML has no line items, the AI reads them from the visible page. Costs the per-page price |

## Files from a URL

The node does not download links. Put an **HTTP Request** node in front:

1. Method **GET**
2. Response format **File**
3. Output field **`data`**

Keep the login for that address on the HTTP Request node. Never put it into the Parser API KI+ credential.

If a service first returns JSON with a download link, use two HTTP Request nodes: one for the JSON, one to download the file into `data`.

## Use as an AI tool

The node can be attached to an AI Agent as a tool. **Get Account Balance** and **Get Recent Usage** work there directly. **Parse Document** and **Get Quote** need a file in a binary field, which an agent usually cannot provide; use them in the main workflow instead.
