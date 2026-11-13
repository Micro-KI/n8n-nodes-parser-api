# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub: open the **Security** tab of this repository and choose **Report a vulnerability**. Do not open a public issue.

Include the node version, the n8n version, and steps to reproduce. We aim to answer within five working days.

## Scope

In scope: this node and its credential, for example a way to send the API key to a host other than `parser-api.micro-ki.de`.

Issues in the Parser API KI+ service itself can be reported the same way; we forward them internally.

## How the node protects the API key

- The key is stored as an n8n password field.
- The credential only signs requests to `https://parser-api.micro-ki.de` and rejects every other host.
- Each request is limited to that domain, so a redirect cannot carry the key elsewhere.
- The credential sets `restrictToSupportedNodes = true`, so only this node can use it (not the generic HTTP Request node).
