# Errors, retries, and idempotency

## Error shape

Parser API KI+ answers every failure with an HTTP status and this JSON:

```json
{
	"request_id": "req_…",
	"error": {
		"code": "unsupported_document_type",
		"message": "Credit notes go to /api/v1/credit-note.",
		"detected_type": "credit_note"
	}
}
```

`error.code` is a stable snake_case name. `error.message` is always English. `error.detected_type` is only present when the server recognised another document type; it uses underscores (`credit_note`), unlike the API addresses (`credit-note`).

## What the node does with a failure

| n8n setting (node **Settings → On Error**) | Result                                                                                                   |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Stop Workflow (default)                    | The run stops with the English API message, the HTTP status, and the item index                          |
| Continue                                   | The item goes to the regular output with the error fields below. Use a **Switch** or **If** node on them |
| Continue (using error output)              | The item goes to the error output. n8n wraps the error, so `error.detected_type` is not available there  |

Fields on the item with **Continue**:

| Field                 | Example                    |
| --------------------- | -------------------------- |
| `error.code`          | `insufficient_credits`     |
| `error.message`       | English text from the API  |
| `error.detected_type` | `credit_note`, or empty    |
| `request_id`          | Quote this in support mail |
| `httpStatus`          | `402`                      |

The original binary file stays on a failed item, so a later branch can send it elsewhere.

Failures without an API error response use the same fields, usually with `httpStatus` 0:

| `error.code`              | Cause                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| `invalid_idempotency_key` | The custom idempotency key breaks the rules below                      |
| `unknown_document_type`   | The document type came from an expression with an unknown value        |
| `not_json`                | A successful response was not a JSON object                            |
| `unexpected_response`     | The n8n HTTP helper returned no status code                            |
| `request_failed`          | Anything else, for example a missing binary field or a network timeout |

### Typical branches

| `httpStatus` | `error.code`                                  | Suggested branch                                           |
| ------------ | --------------------------------------------- | ---------------------------------------------------------- |
| 402          | `insufficient_credits`                        | Notify someone to top up. Keep the file                    |
| 422          | `unsupported_document_type`, `not_an_invoice` | Route by `error.detected_type`, for example to Credit Note |
| 413, 415     | various                                       | The file cannot be read. Send it to a person               |
| 401          | various                                       | Check the credential                                       |

## Retries

With **Retry on a Short Outage** on (default), the node waits and sends the same call again, at most three more times. It uses the same file, headers, and idempotency key.

| Response                                              | Retried |
| ----------------------------------------------------- | ------- |
| `409 parse_in_progress` (same file still running)     | yes     |
| `409 account_busy`                                    | yes     |
| `429` (rate limit)                                    | yes     |
| `5xx`, except `account_corrupt` and `capture_corrupt` | yes     |
| `409 idempotency_key_conflict`                        | no      |
| `401`, `402`, `413`, `415`, `422`                     | no      |
| Network errors and timeouts                           | no      |

The pause comes from the `Retry-After` header, in seconds or as an HTTP date. Without the header the node waits 2 seconds. A single pause is capped at 120 seconds, so the worst case is about 6 minutes of waiting per item.

Each attempt has a timeout of 280 seconds. The server works for up to 270 seconds per file.

Items run one after another. The API allows 60 calls per minute per key; for many attachments, keep batches small in the workflow (for example **Loop Over Items** with 5 per batch).

## Idempotency key

Every parse sends an `Idempotency-Key`. If the same call reaches the server twice, the server answers once and charges once.

- **Automatic** (default): the execution ID plus the item index, for example `123456-0`, `123456-1`. A short execution ID is padded with zeros so the key has at least 8 characters, for example `000001-0`. Retries inside the same run reuse the key.
- **Custom** (Options → Idempotency Key): 8 to 128 characters, only `A–Z a–z 0–9 . _ -`. Use a value that is unique per file, for example a Gmail message ID plus attachment index.

The same key for two different files answers `409 idempotency_key_conflict`. That is not retried, because waiting does not fix it.

Quotes, the account balance, and recent usage do not send an idempotency key.
