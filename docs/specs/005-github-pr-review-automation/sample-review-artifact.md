# PR Review — octo-org/web-frontend #482

- **Title:** feat: add OAuth2 login flow
- **Author:** alice
- **Instance:** github.com
- **URL:** https://github.com/octo-org/web-frontend/pull/482
- **Generated:** 2026-07-01T08:00:00.000Z

## Review

**Verdict:** With fixes — solid direction, but two blockers must be resolved before this is mergeable.

### Summary
Adds an OAuth2 authorization-code login flow with an `AuthClient` wrapper and hardens the session cookie. The cookie hardening (`httpOnly`, `secure`) is a genuine improvement.

### Blockers
- **[Blocker]** `src/auth/AuthClient.js:6` — `exchangeCode` returns `res.json()` unconditionally and ignores non-200 responses from the token endpoint. A failed exchange will surface as a malformed token object downstream. Check `res.ok` and throw on failure.
- **[Blocker]** CI is red: `unit-tests` and `lint` are failing on this head. Reviewing green is a precondition — the review below assumes those failures are addressed.

### Should Fix
- **[Should Fix]** `src/auth/AuthClient.js:6` — the POST sends the raw `code` as the body with no content-type; most token endpoints expect `application/x-www-form-urlencoded`. Confirm the provider contract.
- **[Should Fix]** No integration test covers the new cookie flags (`carol` asked for this in the conversation). Add one so a regression to `httpOnly`/`secure` is caught.

### Nice to Have
- **[Nice to Have]** Consider a typed error for token-exchange failures so callers can distinguish transient vs permanent.

### Requirements check
Linked issue #471 ("Support OAuth2 login") and SITES-1234 describe corporate SSO login via OAuth2. The authorization-code flow matches the stated requirement; SSO-provider selection is not addressed here but appears out of scope for this PR.

## Review context

- Changed files: 2 (+49 / -1)
- Failed checks: `unit-tests`, `lint`
- Inline review comments: 1
- Conversation comments: 1
- Linked issues: #471 (Support OAuth2 login)
- Linked JIRA: SITES-1234
