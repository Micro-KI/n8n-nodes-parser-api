# Changelog

All notable changes to this package are listed here. Versions follow [Semantic Versioning](https://semver.org/).

## 1.0.0

First public release.

- Operations: Parse Document, Get Quote, Get Account Balance, Get Recent Usage.
- Six document types: invoice, credit note, delivery note, purchase order, bank statement, CV.
- Fixed host credential with a free credential test.
- Automatic idempotency key per execution and item.
- Retry on `409 parse_in_progress`, `409 account_busy`, `429`, and `5xx`, paced by `Retry-After`.
- Error fields on the item with Continue, including `error.detected_type`.
