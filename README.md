# dd2l

A discovery project for a customizable, promptable Brightspace companion, starting with one student's Queen's onQ account.

Before building the interface, establish which information the account can actually read, how complete it is, and which gaps need another source.

See [the capability map and access test plan](docs/brightspace-discovery.md) and [the direct connector design](docs/direct-connector.md). The application will own its Brightspace integration; the existing MCP server is a reference implementation. No UI, application runtime, or dependencies have been added.

Do not commit credentials, session cookies, access tokens, downloaded coursework, grades, or classmates' personal information. Discovery evidence should contain access outcomes and field names rather than private payloads.
