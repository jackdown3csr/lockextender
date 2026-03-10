# veGNET Lock Extender

Minimal Next.js frontend for extending an existing veGNET lock on Galactica Mainnet using MetaMask and ethers.js.

This app is extension-only:
- no private keys
- no backend signer
- no token approvals
- no createLock flow
- no increaseAmount flow

The connected wallet reads its current lock state and can send `increaseUnlockTime(uint256)` directly from MetaMask.

## Network

- Network: Galactica Mainnet
- Chain ID: `613419`
- RPC: `https://galactica-mainnet.g.alchemy.com/public`

## Contract

- veGNET VotingEscrow: `0xdFbE5AC59027C6f38ac3E2eDF6292672A8eCffe4`

## What It Does

- Detects MetaMask in the browser
- Connects wallet with `eth_requestAccounts`
- Verifies the user is on Galactica Mainnet
- Reads:
  - `MAXTIME()`
  - `locked(address)`
  - `lockEnd(address)`
  - `balanceOf(address)`
- Calculates the maximum currently possible unlock timestamp using week rounding
- Lets the user extend to max or choose a shorter target with a day slider
- Sends `increaseUnlockTime(uint256 newUnlockTime)` from MetaMask
- Refreshes lock state after transaction confirmation

## Week Rounding Logic

The app uses the same week-based logic expected by VotingEscrow contracts:

```ts
const WEEK = 7 * 86400;
const maxNewTs = Math.floor((now + maxTime) / WEEK) * WEEK;
```

The slider moves in days for UX, but the actual timestamp sent on-chain is still rounded to a valid week boundary.

Because of that, users can sometimes move the slider a bit without producing a new valid on-chain timestamp yet. The UI explains that case and keeps the action disabled until the selected target reaches the next valid week.

## UI

The page shows:
- Connect Wallet button
- Network status
- Connected address
- Locked GNET amount
- Current veGNET balance
- Current lock end date
- Days remaining
- Max possible end
- Max extendable days
- Selected target end
- Selected extension days
- Extend Lock button
- Transaction status

## Tech Stack

- Next.js
- React
- TypeScript
- ethers.js
- MetaMask only

## Local Development

Install dependencies:

```bash
npm install
```

Run development server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

Build for production:

```bash
npx next build
```

## Important Notes

- This app only extends an existing lock.
- It does not deposit more GNET.
- It does not create a new lock.
- It does not require token approval.
- The user must have MetaMask installed.
- The user must be connected to chain `613419`.
- If the lock is already at the current practical week-max, extension is disabled until more time passes.

## Transaction Flow

1. Connect MetaMask
2. Read current lock state
3. Select desired extension target
4. Confirm transaction in MetaMask
5. Wait for confirmation
6. Refresh on-chain state

## Disclaimer

Use at your own risk. Always verify the connected wallet, network, and target transaction details in MetaMask before confirming.