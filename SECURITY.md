# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

The integration needs no account, no key and no password. It stores under
`/data` a single file, `watch.json`: the stops you watch (with their filters)
and the identifiers of the cancellations and traffic messages already
announced. Its only network traffic is outbound HTTPS to `api.entur.io`
(Journey Planner and Geocoder), identified by the `ET-Client-Name` header;
every request has a timeout.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the Entur services the integration reads.
