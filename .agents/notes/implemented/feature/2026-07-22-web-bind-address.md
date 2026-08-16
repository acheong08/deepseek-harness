# Agent Note: Explicit web bind address

Status: implemented

English | [中文](2026-07-22-web-bind-address.zh.md)

## Problem

`dsh web` binds every network interface even when its browser runs on the same machine. Local use therefore exposes an unauthenticated development server without an explicit operator choice, while remote-container and LAN-browser use still needs a supported way to accept non-loopback connections.

The HTTP carrier also hides the bind address inside `startWebServer()`, so alternate shells cannot state their own network policy at the package boundary.

## Decision

`dsh web` binds `127.0.0.1` by default. The CLI accepts `--host 127.0.0.1` and explicit internal IPv4 literals (RFC1918 or `100.64.0.0/10`), while still rejecting `--host 0.0.0.0`, so ordinary local use stays loopback-only and mesh or LAN access names one deliberate address instead of every interface.

`WebServerOptions.host` is required. The HTTP carrier passes that value to `node:http` without supplying a fallback, leaving each shell responsible for its bind policy. Programmatic carrier consumers may still select `0.0.0.0` or another supported bind address directly.

## Alternatives considered

**Keep `0.0.0.0` as the default.** Rejected because ordinary same-machine use does not need network-wide reachability and should not acquire it implicitly.

**Use a boolean exposure flag.** Rejected because choosing a bind host names the resulting socket behavior directly and matches the underlying server option without introducing a second term.

**Default inside `startWebServer()`.** Rejected because the carrier has multiple possible shells and no basis for choosing their deployment policy. Requiring `host` makes the choice visible at every assembly call.

## Consequences

Local `dsh web` starts remain reachable at `http://127.0.0.1:3080`; a browser on another machine must opt in with `dsh web --host <internal-ipv4>`. The CLI still does not expose `0.0.0.0` or IPv6 modes, while programmatic carrier consumers retain broader flexibility. Server tests pin loopback, wildcard, and explicit internal-IPv4 validation into the Node listen boundary, and the web smoke continues to exercise the default CLI path.
