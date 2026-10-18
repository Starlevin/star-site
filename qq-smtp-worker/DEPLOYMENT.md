# Deployment verification — 2026-10-18 (Asia/Shanghai)

- Formal Cloudflare OAuth account confirmed with `wrangler whoami`: `levinluo2005@gmail.com`, account `7c4db00da8528f2c88fb9073a3c60e1d`. No temporary account or paid-plan upgrade.
- Base URL: https://qinghan-qq-mail-sender.qq-smtp-worker.workers.dev
- Sending endpoint: `POST /send`; login-only probe: `POST /probe`.
- Worker version: `5fe7ec29-87d1-48fc-80eb-79bc2d8dc6b0`.
- Secrets: `QQ_EMAIL_ACCOUNT`, `QQ_EMAIL_AUTH_CODE`, `RELAY_TOKEN`. User mailbox credentials were entered in masked native inputs and uploaded from process memory through stdin. No secret values are included here.
- Production probe: HTTP 200, `tlsVerified:true`, `smtpAuthenticated:true`.
- Unauthorized request: HTTP 401. Malformed recipient: HTTP 400, before SMTP.
- Authorized test recipient: `levinluo2005@gmail.com`.
- Test marker/request ID: `QQ-MAIL-PROD-20261018T032648253-ea5ad678`.
- QQ SMTP accepted once at 2026-10-18 11:27:06 +08:00. Gmail delivery confirmed approximately 11:27:08 +08:00.
- Gmail message ID: `1a14d0c83b682356`. Gmail placed the message in **SPAM**, not Inbox. Authentication-Results confirmed SPF, DKIM and DMARC all pass. No mailbox labels were modified.
- Replay with the same request/content returned `deduplicated:true`, the same original Message-ID and acceptance timestamp; no second SMTP attempt. Gmail search still found one matching message.
- Six Worker behavior tests and four Site integration tests passed. Tests cover validation, concurrency, persistent restart deduplication, interruption, SMTP ambiguity, post-acceptance storage failure, authentication and unchanged read routing.

## Existing Site / plugin

- Site: https://qq-mail-assistant.levinluo2005.chatgpt.site
- Project: `appgprj_6ad3a3cfe4f88191931d5c666037afdf`.
- Published version: **8**, deployment `appgdep_6ad43c36a88c81918c6c9a4beae815a6`, terminal status `succeeded`, `has_mcp:true`, runtime environment revision 2.
- Source commit: `14720693fac64eef681e7143fa59c8cc8e09f899` in the Site-managed source repository.
- Existing plugin: `plugin_asdk_app_sites_490f85d1ae888191aea62637b4ce9470`.
- Existing App: `asdk_app_sites_490f85d1ae888191aea62637b4ce9470`.
- Site remains private to the single owner; ChatGPT authentication, existing IMAP relay credentials and the three read tools are preserved. No delete tool, no duplicate Site or plugin.
- Site source adds `send_email(request_id,to,subject,text)`, forwarding only through server Secrets `QQ_SMTP_URL` and `QQ_SMTP_TOKEN`.
- Native installed-plugin `list_emails` succeeded after deployment.
- Verification limitation: the current Codex chat still exposes the original three tool schemas; `send_email` could not be invoked through the installed plugin in this session. Refresh/reopen the plugin in a new chat to load its updated tool list. Raw `/mcp` requests with the Site service-access bypass credential receive 401 at the MCP authentication boundary, so no identity headers or auth bypasses were introduced to force that test. SMTP sending and actual delivery were verified directly through the formal authenticated Worker.

The native Sites publishing flow refreshes the linked plugin's tools. Confirm `send_email` appears in a refreshed chat before treating the installed-plugin sending path as fully verified. Do not send a second test just to check discovery; tools/list is sufficient, or reuse the exact already-completed request ID and content if an explicit replay test is needed.
