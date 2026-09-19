# Security

## Reporting a vulnerability

Report it privately, through
[GitHub's private vulnerability reporting](https://github.com/MaroonedSoftware/rhapsode/security/advisories/new),
and not in a public issue, discussion or pull request. A report is seen only by the maintainers
until an advisory is published.

Say what an attacker can do, against which package and version, and how to reproduce it. A fix ships as a patch release of every package, because
every package carries one version, and the advisory credits you unless you would rather it did not.

## Supported versions

Only the latest release is supported. Before 1.0 a fix is not backported to an earlier minor line.

## What is in scope

The server (`@rhapsode/core`, `rhapsode`), the Python worker SDK (`rhapsode-worker`), the engines in
this repository, the SDK and contract packages, the web page and the published Docker images.

The management API installs and runs code, which is its purpose. Its guard is the management token
and the origin check in `docs/protocol.md` § 10; a way around either is in scope, while "a caller
holding the token can install an engine" is not. The same goes for the weights an engine downloads:
the catalog records where they come from, and a model behaving as its publisher trained it is not a
vulnerability in Rhapsode.
