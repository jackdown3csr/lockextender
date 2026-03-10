import { useState, useEffect, useCallback } from "react";
import { BrowserProvider, JsonRpcProvider, Contract, formatEther } from "ethers";
import Head from "next/head";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VEGNET_ADDRESS = "0xdFbE5AC59027C6f38ac3E2eDF6292672A8eCffe4";
const GALACTICA_CHAIN_ID = 613419;
const GALACTICA_CHAIN_ID_HEX = "0x95e7b";
const RPC_URL = "https://galactica-mainnet.g.alchemy.com/public";
const WEEK = 7n * 86400n;

const VEGNET_ABI = [
  "function MAXTIME() view returns (uint256)",
  "function locked(address addr) view returns (uint256)",
  "function lockEnd(address addr) view returns (uint256)",
  "function balanceOf(address addr) view returns (uint256)",
  "function increaseUnlockTime(uint256 newUnlockTime)",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tsToDate(ts: bigint): string {
  if (ts === 0n) return "—";
  return new Date(Number(ts) * 1000).toUTCString().replace(" GMT", " UTC");
}

function daysBetween(a: bigint, b: bigint): number {
  if (b <= a) return 0;
  return Math.floor(Number(b - a) / 86400);
}

function daysFromNow(ts: bigint): number {
  if (ts === 0n) return 0;
  const now = BigInt(Math.floor(Date.now() / 1000));
  return daysBetween(now, ts);
}

function calcMaxNewTs(maxTime: bigint): bigint {
  const now = BigInt(Math.floor(Date.now() / 1000));
  return ((now + maxTime) / WEEK) * WEEK;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function calcSelectedNewTs(lockEnd: bigint, selectedDays: number, maxNewTs: bigint): bigint {
  const requestedTs = lockEnd + BigInt(selectedDays) * 86400n;
  const roundedTs = (requestedTs / WEEK) * WEEK;

  if (roundedTs <= lockEnd) {
    return lockEnd;
  }

  return roundedTs > maxNewTs ? maxNewTs : roundedTs;
}

// ---------------------------------------------------------------------------
// Read-only provider for fallback reads
// ---------------------------------------------------------------------------

function getReadProvider() {
  return new JsonRpcProvider(RPC_URL);
}

function getReadContract() {
  return new Contract(VEGNET_ADDRESS, VEGNET_ABI, getReadProvider());
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LockState {
  lockedAmount: bigint;
  veBalance: bigint;
  lockEnd: bigint;
  maxTime: bigint;
  maxNewTs: bigint;
  canExtend: boolean;
}

type TxStatus =
  | { kind: "idle" }
  | { kind: "pending"; hash: string }
  | { kind: "success"; hash: string }
  | { kind: "error"; message: string };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ExtendLock() {
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [lock, setLock] = useState<LockState | null>(null);
  const [selectedDays, setSelectedDays] = useState(0);
  const [txStatus, setTxStatus] = useState<TxStatus>({ kind: "idle" });
  const [readError, setReadError] = useState<string | null>(null);

  const hasMetaMask = typeof window !== "undefined" && typeof window.ethereum !== "undefined";
  const isCorrectNetwork = chainId === GALACTICA_CHAIN_ID;
  const hasActiveLock = lock !== null && lock.lockedAmount > 0n;

  // -----------------------------------------------------------------------
  // Detect chain and account from MetaMask
  // -----------------------------------------------------------------------

  const syncChainAndAccount = useCallback(async () => {
    if (!hasMetaMask) return;
    try {
      const chainHex: string = await window.ethereum!.request({ method: "eth_chainId" });
      setChainId(parseInt(chainHex, 16));
      const accounts: string[] = await window.ethereum!.request({ method: "eth_accounts" });
      setAccount(accounts.length > 0 ? accounts[0] : null);
    } catch {
      /* ignore */
    }
  }, [hasMetaMask]);

  useEffect(() => {
    syncChainAndAccount();
    if (!hasMetaMask) return;
    const onChain = (hex: string) => setChainId(parseInt(hex, 16));
    const onAccounts = (accs: string[]) => setAccount(accs.length > 0 ? accs[0] : null);
    window.ethereum!.on("chainChanged", onChain);
    window.ethereum!.on("accountsChanged", onAccounts);
    return () => {
      window.ethereum!.removeListener("chainChanged", onChain);
      window.ethereum!.removeListener("accountsChanged", onAccounts);
    };
  }, [hasMetaMask, syncChainAndAccount]);

  // -----------------------------------------------------------------------
  // Connect wallet
  // -----------------------------------------------------------------------

  const connect = async () => {
    if (!hasMetaMask) return;
    try {
      const accounts: string[] = await window.ethereum!.request({ method: "eth_requestAccounts" });
      setAccount(accounts.length > 0 ? accounts[0] : null);
      const chainHex: string = await window.ethereum!.request({ method: "eth_chainId" });
      setChainId(parseInt(chainHex, 16));
    } catch {
      /* user rejected */
    }
  };

  // -----------------------------------------------------------------------
  // Read lock state
  // -----------------------------------------------------------------------

  const fetchLockState = useCallback(async (addr: string) => {
    setReadError(null);
    try {
      const c = getReadContract();
      const [lockedAmount, veBalance, lockEndVal, maxTime] = await Promise.all([
        c.locked(addr) as Promise<bigint>,
        c.balanceOf(addr) as Promise<bigint>,
        c.lockEnd(addr) as Promise<bigint>,
        c.MAXTIME() as Promise<bigint>,
      ]);
      const maxNewTs = calcMaxNewTs(maxTime);
      setLock({
        lockedAmount,
        veBalance,
        lockEnd: lockEndVal,
        maxTime,
        maxNewTs,
        canExtend: maxNewTs > lockEndVal && lockedAmount > 0n,
      });
    } catch (err: any) {
      setReadError(err?.message ?? "Failed to read contract state");
      setLock(null);
    }
  }, []);

  useEffect(() => {
    if (account && isCorrectNetwork) {
      fetchLockState(account);
    } else {
      setLock(null);
      setReadError(null);
    }
  }, [account, isCorrectNetwork, fetchLockState]);

  useEffect(() => {
    if (!lock || !lock.canExtend) {
      setSelectedDays(0);
      return;
    }

    setSelectedDays(daysBetween(lock.lockEnd, lock.maxNewTs));
  }, [lock]);

  // -----------------------------------------------------------------------
  // Extend lock
  // -----------------------------------------------------------------------

  const extendLock = async () => {
    if (!account || !lock || !canSubmitSelected || txStatus.kind === "pending") return;
    try {
      setTxStatus({ kind: "idle" });
      const provider = new BrowserProvider(window.ethereum!);
      const signer = await provider.getSigner();
      const contract = new Contract(VEGNET_ADDRESS, VEGNET_ABI, signer);
      const tx = await contract.increaseUnlockTime(selectedNewTs);
      setTxStatus({ kind: "pending", hash: tx.hash });
      await tx.wait();
      setTxStatus({ kind: "success", hash: tx.hash });
      await fetchLockState(account);
    } catch (err: any) {
      if (err?.code === "ACTION_REJECTED" || err?.code === 4001) {
        setTxStatus({ kind: "error", message: "Transaction rejected by user." });
      } else {
        setTxStatus({ kind: "error", message: err?.message ?? "Transaction failed." });
      }
    }
  };

  // -----------------------------------------------------------------------
  // Derived UI state
  // -----------------------------------------------------------------------

  const maxSelectableDays = lock ? daysBetween(lock.lockEnd, lock.maxNewTs) : 0;
  const safeSelectedDays = clamp(selectedDays, 0, maxSelectableDays);
  const selectedNewTs = lock
    ? calcSelectedNewTs(lock.lockEnd, safeSelectedDays, lock.maxNewTs)
    : 0n;
  const effectiveExtensionDays = lock ? daysBetween(lock.lockEnd, selectedNewTs) : 0;
  const canSubmitSelected = lock ? selectedNewTs > lock.lockEnd && lock.lockedAmount > 0n : false;

  const submitDisabled =
    !account ||
    !isCorrectNetwork ||
    !hasActiveLock ||
    !canSubmitSelected ||
    txStatus.kind === "pending";

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <>
      <Head>
        <title>veGNET Lock Extender</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/LOGO_PNG.png" />
      </Head>
      <style jsx global>{`
        html, body, #__next {
          margin: 0;
          padding: 0;
          min-height: 100%;
          background: #0d1117;
        }

        * {
          box-sizing: border-box;
        }

        .page-wrap {
          min-height: 100vh;
          display: flex;
          justify-content: center;
          align-items: flex-start;
          padding: 60px 16px 40px;
          background: #0d1117;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          color: #e6edf3;
        }

        .card-wrap {
          background: #161b22;
          border: 1px solid #30363d;
          border-radius: 12px;
          padding: 32px 36px;
          max-width: 520px;
          width: 100%;
        }

        @media (max-width: 560px) {
          .page-wrap {
            padding: 0;
            align-items: flex-start;
          }

          .card-wrap {
            border-radius: 0;
            border-left: none;
            border-right: none;
            padding: 24px 16px;
            max-width: 100%;
          }
        }
      `}</style>
      <div className="page-wrap">
        <div className="card-wrap">
          <div style={styles.titleRow}>
            <img src="/LOGO_PNG.png" alt="veGNET logo" style={styles.logo} />
            <h1 style={styles.title}>veGNET Lock Extender</h1>
          </div>

          {/* MetaMask check */}
          {!hasMetaMask && (
            <p style={styles.warning}>MetaMask is not installed. Please install MetaMask to use this page.</p>
          )}

          {/* Connect */}
          {hasMetaMask && !account && (
            <button style={styles.btn} onClick={connect}>
              Connect Wallet
            </button>
          )}

          {/* Account & network */}
          {account && (
            <div style={styles.section}>
              <Row label="Wallet" value={account} />
              <Row
                label="Network"
                value={
                  isCorrectNetwork ? (
                    <span style={{ color: "#27ae60" }}>Galactica Mainnet ✓</span>
                  ) : (
                    <span style={{ color: "#e74c3c" }}>
                      Wrong network (chain {chainId}) — switch to Galactica Mainnet (613419)
                    </span>
                  )
                }
              />
            </div>
          )}

          {/* Read error */}
          {readError && <p style={styles.error}>Read error: {readError}</p>}

          {/* Lock data */}
          {lock && isCorrectNetwork && (
            <div style={styles.section}>
              <Row label="Locked GNET" value={formatEther(lock.lockedAmount) + " GNET"} />
              <Row label="veGNET Balance" value={formatEther(lock.veBalance) + " veGNET"} />
              <Row label="Current Lock End" value={tsToDate(lock.lockEnd)} />
              <Row label="Days Remaining" value={String(daysFromNow(lock.lockEnd))} />
              <Row label="Max Possible End" value={tsToDate(lock.maxNewTs)} />
              <Row label="Max Extendable By" value={maxSelectableDays + " days"} />
              <Row
                label="Selected Target End"
                value={tsToDate(selectedNewTs)}
              />
              <Row
                label="Selected Extension"
                value={
                  canSubmitSelected ? effectiveExtensionDays + " days" : "0 days"
                }
              />
            </div>
          )}

          {lock && isCorrectNetwork && lock.canExtend && (
            <div style={styles.sliderWrap}>
              <label htmlFor="extend-days" style={styles.sliderLabel}>
                Target extension: {safeSelectedDays} day{safeSelectedDays === 1 ? "" : "s"}
              </label>
              <input
                id="extend-days"
                type="range"
                min={0}
                max={maxSelectableDays}
                step={1}
                value={safeSelectedDays}
                onChange={(event) => setSelectedDays(Number(event.target.value))}
                style={styles.slider}
              />
              <div style={styles.sliderScale}>
                <span>Current</span>
                <span>Max</span>
              </div>
              {!canSubmitSelected && safeSelectedDays > 0 && (
                <p style={styles.info}>
                  The selected day count still rounds to the current lock week. Move the slider further to reach the next valid week boundary.
                </p>
              )}
            </div>
          )}

          {/* Status messages */}
          {account && isCorrectNetwork && !hasActiveLock && lock !== null && (
            <p style={styles.warning}>No active lock found for this wallet.</p>
          )}

          {account && isCorrectNetwork && hasActiveLock && !lock!.canExtend && (
            <p style={styles.info}>
              Lock is already at the current week-max. You must wait before another extension becomes possible.
            </p>
          )}

          {/* Extend button */}
          {account && isCorrectNetwork && (
            <button style={submitDisabled ? styles.btnDisabled : styles.btn} disabled={submitDisabled} onClick={extendLock}>
              {txStatus.kind === "pending" ? "Extending…" : "Extend Lock"}
            </button>
          )}

          {/* Tx status */}
          {txStatus.kind === "pending" && (
            <p style={styles.info}>
              Transaction pending…<br />
              <span style={styles.mono}>{txStatus.hash}</span>
            </p>
          )}
          {txStatus.kind === "success" && (
            <p style={{ ...styles.info, color: "#27ae60" }}>
              Transaction confirmed ✓<br />
              <span style={styles.mono}>{txStatus.hash}</span>
            </p>
          )}
          {txStatus.kind === "error" && (
            <p style={styles.error}>{txStatus.message}</p>
          )}

          {/* Notices */}
          <p style={styles.note}>
            This sends a transaction from the connected wallet and only extends the unlock date of the existing veGNET lock. It does not add more GNET.
          </p>
          <p style={styles.note}>
            Lock extension uses week rounding, so sometimes you must wait before another extension becomes possible.
          </p>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Tiny row component
// ---------------------------------------------------------------------------

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={styles.row}>
      <span style={styles.label}>{label}</span>
      <span style={styles.value}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  titleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginBottom: 24,
  },
  logo: {
    width: 36,
    height: 36,
    objectFit: "contain",
    flexShrink: 0,
  },
  title: {
    fontSize: 22,
    fontWeight: 600,
    margin: 0,
  },
  section: {
    marginBottom: 20,
  },
  sliderWrap: {
    marginBottom: 20,
  },
  sliderLabel: {
    display: "block",
    marginBottom: 8,
    fontSize: 14,
    color: "#c9d1d9",
  },
  slider: {
    width: "100%",
    accentColor: "#238636",
  },
  sliderScale: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 12,
    color: "#8b949e",
    marginTop: 6,
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    padding: "7px 0",
    borderBottom: "1px solid #21262d",
    fontSize: 14,
    gap: 12,
  },
  label: {
    color: "#8b949e",
    flexShrink: 0,
  },
  value: {
    textAlign: "right",
    wordBreak: "break-all",
  },
  btn: {
    width: "100%",
    padding: "12px 0",
    fontSize: 15,
    fontWeight: 600,
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    background: "#238636",
    color: "#fff",
    marginTop: 8,
    marginBottom: 8,
  },
  btnDisabled: {
    width: "100%",
    padding: "12px 0",
    fontSize: 15,
    fontWeight: 600,
    border: "none",
    borderRadius: 8,
    cursor: "not-allowed",
    background: "#21262d",
    color: "#484f58",
    marginTop: 8,
    marginBottom: 8,
  },
  warning: {
    color: "#e74c3c",
    fontSize: 14,
    padding: "8px 12px",
    background: "#2d1215",
    borderRadius: 6,
    marginBottom: 12,
  },
  error: {
    color: "#f85149",
    fontSize: 13,
    marginTop: 8,
  },
  info: {
    fontSize: 13,
    color: "#8b949e",
    marginTop: 8,
  },
  note: {
    fontSize: 12,
    color: "#6e7681",
    marginTop: 16,
    marginBottom: 0,
    lineHeight: 1.5,
  },
  mono: {
    fontFamily: "monospace",
    fontSize: 12,
    wordBreak: "break-all",
  },
};

// ---------------------------------------------------------------------------
// Global type for window.ethereum
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: any[] }) => Promise<any>;
      on: (event: string, cb: (...args: any[]) => void) => void;
      removeListener: (event: string, cb: (...args: any[]) => void) => void;
    };
  }
}
