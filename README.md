# Wallet Analytics

[![CI](https://github.com/MERSEI/Dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/MERSEI/Dashboard/actions/workflows/ci.yml)

Read-only analytics for any Ethereum address — token balance, transfer flows and
balance history — with an optional, gated transfer panel.

Built with Next.js 14 (App Router), TypeScript, Tailwind 4 and ethers v6.

```bash
npm install
cp .env.example .env.local   # fill in RPC_URL, ETHERSCAN_API_KEY, addresses
npm run dev                  # http://localhost:3000
npm test                     # 175 tests
npm run typecheck
npm run build
```

---

## Security & Correctness Audit

This repository was audited before the redesign. The findings below are fixed;
each one names the observable consequence, because a finding without a failure mode
is not a finding.

### Critical

| # | Finding | Consequence | Fix |
|---|---|---|---|
| 1 | `withdrawFunds(toAddress, amount)` was an unauthenticated Server Action that signed a token transfer with `WALLET_PRIVATE_KEY` to a **caller-supplied** address | A Next.js Server Action is a public HTTP endpoint — the framework compiles it into a POST route addressed by an id that ships in the client bundle, so any caller can invoke it with arguments of their choosing. The UI is not an access boundary. Deployed, this was a public "send the wallet anywhere" endpoint. | Three independent controls: an HMAC-signed httpOnly session required before any key is touched, per-client rate limiting, and a **withdrawal allowlist** — an empty allowlist disables withdrawals rather than permitting everything. |
| 2 | `src/app/` duplicated `app/`, and `src/app/layout.tsx` was syntactically invalid (`</body>body>`, `</html>html>`) | `npm run build` failed outright. The published repository did not compile. | Dead directory removed; the build is green. |
| 3 | Etherscan **v1** endpoints (`api.etherscan.io/api?module=…`, `api-goerli.etherscan.io`) | v1 is deprecated and answers every request with `NOTOK / "You are using a deprecated V1 endpoint"`; the Goerli host no longer resolves. Because `getTransactionHistory` swallowed failures into `return []`, history was permanently empty and looked like a quiet wallet. | Rewritten against **v2** (one host, `chainid` parameter). "No transactions found" is distinguished from a genuine failure, which now surfaces as a visible warning. |
| 4 | `generateEmptyChart` returned a flat line of `value: 1000` whenever history was missing | Which, given #3, was always — so the dashboard rendered **fabricated data as the user's portfolio history**. | Removed. With nothing to plot the chart says so. No invented points anywhere. |
| 5 | The route was statically prerendered | Balances were frozen at build time; when the environment was missing, the *error* page was the artefact that got cached, so fixing the variable did not fix the page. | `export const dynamic = 'force-dynamic'`, and configuration is reported as data instead of thrown at module scope. |

### High

| # | Finding | Consequence | Fix |
|---|---|---|---|
| 6 | `parseUnits(amount, 6)` hardcoded six decimals while the real `decimals()` was read elsewhere | Against an 18-decimal token every transfer is scaled by 10¹². | Decimals always come from the contract; `toBaseUnits` also refuses more precision than the token has instead of silently truncating value. |
| 7 | Address validation was `startsWith('0x') && length === 42` | Accepts any 40 hex-ish characters, including a mistyped address whose EIP-55 checksum fails — on the withdrawal path. | Validation goes through `ethers.isAddress`, and everything is compared in checksummed form. |
| 8 | `tx.to.toLowerCase()` called unconditionally | `to` is `null` for contract creations, so one such transaction threw and took down the entire history render. | Defensive normalisation; a null `to` is a valid, labelled row. |
| 9 | `profitPercent: 100` returned whenever more had been withdrawn than deposited | A fabricated number presented as performance. | `computePerformance` returns `null` for a non-positive basis and the UI says *"more was withdrawn than deposited, so a percentage would be meaningless"*. Also renamed: without prices at transfer time there is no cost basis, so this is "vs deposits", never "profit". |
| 10 | The logger printed the RPC URL (which embeds the provider key), the address derived from the private key, and full stack traces — at `info`, in production | Hosting logs are readable by anyone with dashboard access; that is a credential leak with extra steps. | A redacting logger: sensitive keys masked, 32-byte hex masked, URL paths and `apikey` query values stripped, `debug` off unless explicitly enabled, no stacks in production. |
| 11 | Upstream error text was rendered into the page | Provider URLs and infrastructure detail leaked to any visitor. | Errors are mapped to stable user-facing sentences; detail goes to the log only. |

### Medium

| # | Finding | Consequence | Fix |
|---|---|---|---|
| 12 | ETH price silently fell back to `3000` | A hardcoded price presented as a valuation. | No price feed at all. Every figure is a token amount, stated as such — a made-up rate is worse than no rate. |
| 13 | Failed (reverted) transactions counted towards flow totals | They appear in history but moved nothing, corrupting every derived figure. | Excluded from totals, still listed and labelled *"reverted — moved nothing"*. |
| 14 | Only `out_msgs[0]`-style single-value handling; unbounded `slice(0, 10)`/`slice(0, 20)` mixing | Under-reported amounts and an arbitrary history depth. | Explicit `offset` per request and consistent normalisation. |
| 15 | A module-level `Map` cache inside a server action | Per-instance on serverless, so effectively ineffective, while reading as a cache. | Removed. Caching a money read-out invites staleness; the route is dynamic and the numbers are live. Rate limiting protects the upstream keys instead. |
| 16 | No tests, no `typecheck` script | Nothing above was catchable. | Vitest with **175 tests** across the auth, address, money, portfolio and Etherscan layers, plus `npm run typecheck`. |
| 17 | `axios`, `framer-motion`, `@number-flow/react` shipped but unused after the rewrite | Dead weight in the bundle. | Removed. First Load JS for `/` fell from 135 kB to 97.5 kB. |

### Residual risk — stated, not solved

You chose to keep the transfer panel, so the honest limits are:

- **`WALLET_PRIVATE_KEY` still lives on the server.** A leak of the environment is a
  loss of funds. The password, the rate limit and the allowlist bound *who* can
  spend and *where to*; they do not protect the key itself. Client-side signing
  (MetaMask) is the design that removes this risk.
- **Rate limiting is per-process.** On a single server that is a real cap; on
  serverless each instance keeps its own counter, so the effective limit is
  `limit × instances`. A deployment that needs a hard cap wants a shared store.
- **A single password is a single factor.** There is no account model, no rotation
  and no audit trail beyond the log.

---

## Architecture

```
app/
  actions.ts    # Server Actions: login/logout, read path, guarded write path
  page.tsx      # dynamic server component; config notice / error states
  layout.tsx    # self-hosted fonts, metadata
  globals.css   # design tokens (Tailwind 4 @theme) + component classes
lib/
  address.ts    # EIP-55 validation, normalisation, allowlist parsing
  money.ts      # strict decimal parsing, base-unit conversion, formatting
  auth.ts       # password check, HMAC session tokens, cookie policy
  ratelimit.ts  # fixed-window limiter, client key derivation
  etherscan.ts  # v2 client, error taxonomy, chain metadata
  portfolio.ts  # pure transforms: normalise, flows, performance, series
  config.ts     # environment validation as data, never thrown
  logger.ts     # redaction, public vs internal error messages
components/     # BalanceChart, StatTile, TransferLedger, TransferPanel, DashboardClient
```

Everything in `lib/` is a pure function of its arguments, which is what makes it
testable without a chain, a network or a browser — and the reason the audit findings
above are now regression-tested. The previous implementation mixed fetching, maths
and formatting inside one server action, so none of it could be tested at all.

**Layers:** `lib/` knows nothing about React or Next. `app/actions.ts` is the only
place that touches `cookies()`, `headers()`, the RPC provider or a signing key.
Components receive data and render it.

---

## Security model

| Control | Where | What it does |
|---|---|---|
| Session required | `requireSession()` at the top of every write action | HMAC-SHA256 signed token in an httpOnly, `SameSite=Strict` cookie; 2-hour expiry. The signature is verified **before** the payload is trusted, including its own `exp`. |
| Password policy | `readAuthConfig()` | Refuses to run with a missing, placeholder or short `DASHBOARD_PASSWORD`/`SESSION_SECRET`. A weak secret is worse than no login: the page looks protected while anyone can mint a session. |
| Constant-time compare | `safeEqual()` | Compares digests, so neither the value nor its length is a timing oracle. |
| Rate limiting | `login`, `depositFunds`, `withdrawFunds`, `getDashboardData` | 5 password attempts / 15 min, 10 transfers / hour, 60 reads / min, keyed on `x-real-ip` then the left-most `x-forwarded-for`. |
| Withdrawal allowlist | `withdrawFunds` | Destination must be on `WITHDRAW_ALLOWLIST`. Empty list = withdrawals disabled. Invalid entries are dropped, never treated as wildcards. |
| Read-only by default | `getSigner()` | With no `WALLET_PRIVATE_KEY` the write path is unavailable and the UI says so. |
| Log redaction | `lib/logger.ts` | Secrets, 32-byte hex, URL paths and API-key query values masked. |

---

## Design

Shares its visual language with the TON wallet in this portfolio, so the two read as
one body of work: warm blacks, bone text, one acid accent, hairlines instead of
shadows, **Instrument Serif** for the single figure that matters and **IBM Plex
Mono** for every other number. Fonts are self-hosted (66 KB, latin subsets) — no
third-party font request. Committed to one dark scheme deliberately.

### The chart

One measure against time → a line with a supporting area fill. Decisions worth
naming:

- **Single series, so no legend** — the panel title names it.
- The mark uses a step *below* the UI accent. `#D4FF4F` sits at OKLCH L 0.94 and
  blooms as a thin stroke on near-black. The categorical lightness band does not
  apply here — that check exists to stop one series out-shouting another, and there
  is only one series — but the glare problem it points at is real.
- Area fill capped at 10 % opacity so it supports the line instead of competing.
- Hairline gridlines, four of them, no vertical clutter.
- **Crosshair + tooltip**, which a line chart gets by default; the value shown is
  read from the data, never interpolated.
- A direct label on the final point only — never a number on every point.
- Sign carries meaning before colour does (`+`/`−` on every signed figure), and the
  ledger table is the text companion to everything plotted.
- **Flows are stat tiles, not a chart.** A lone magnitude reads faster as a number,
  and a two-bar chart of in/out communicates nothing the two numbers do not.

---

## What I would do next

1. **Client-side signing** (MetaMask / WalletConnect) to remove the server-held key
   entirely — the one change that eliminates the residual risk above.
2. **Shared-store rate limiting** (Upstash/Redis) for a real cap across instances.
3. **Component tests** for `BalanceChart` hover and `TransferPanel` states; the pure
   layer is covered, the interactive layer is not yet.
4. **Price feed, clearly labelled** — with a timestamp and a visible source, so a
   fiat figure is never mistaken for a fact about the chain.
5. **Pagination** beyond the current per-request `offset`.

---

## License

MIT — see [LICENSE](LICENSE).
