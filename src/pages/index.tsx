import { useState, useEffect, useCallback } from "react";
import { BrowserProvider, JsonRpcProvider, Contract, formatEther } from "ethers";
import Head from "next/head";
import { useRouter } from "next/router";

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

type Locale = "en" | "fr";

const translations = {
  en: {
    metaMaskMissing: "MetaMask is not installed. Please install MetaMask to use this page.",
    connectWallet: "Connect Wallet",
    wallet: "Wallet",
    network: "Network",
    networkOk: "Galactica Mainnet",
    wrongNetwork: (chainId: number | null) =>
      `Wrong network (chain ${chainId ?? "unknown"}) - switch to Galactica Mainnet (613419)`,
    readErrorPrefix: "Read error:",
    lockedGnet: "Locked GNET",
    veBalance: "veGNET Balance",
    currentLockEnd: "Current Lock End",
    daysRemaining: "Days Remaining",
    maxPossibleEnd: "Max Possible End",
    maxExtendableBy: "Max Extendable By",
    selectedTargetEnd: "Selected Target End",
    selectedExtension: "Selected Extension",
    targetExtension: (days: number) => `Target extension: ${formatDays("en", days)}`,
    current: "Current",
    max: "Max",
    roundingInfo:
      "The selected day count still rounds to the current lock week. Move the slider further to reach the next valid week boundary.",
    noActiveLock: "No active lock found for this wallet.",
    alreadyMax:
      "Lock is already at the current week-max. You must wait before another extension becomes possible.",
    extending: "Extending...",
    extendLock: "Extend Lock",
    txPending: "Transaction pending...",
    txConfirmed: "Transaction confirmed",
    userRejected: "Transaction rejected by user.",
    txFailed: "Transaction failed.",
    readFailed: "Failed to read contract state",
    noteOne:
      "This sends a transaction from the connected wallet and only extends the unlock date of the existing veGNET lock. It does not add more GNET.",
    noteTwo:
      "Lock extension uses week rounding, so sometimes you must wait before another extension becomes possible.",
    language: "Language",
    english: "English",
    french: "Francais",
    gnetUnit: "GNET",
    vegnetUnit: "veGNET",
  },
  fr: {
    metaMaskMissing: "MetaMask n'est pas installe. Veuillez installer MetaMask pour utiliser cette page.",
    connectWallet: "Connecter le portefeuille",
    wallet: "Portefeuille",
    network: "Reseau",
    networkOk: "Galactica Mainnet",
    wrongNetwork: (chainId: number | null) =>
      `Mauvais reseau (chain ${chainId ?? "inconnue"}) - passez sur Galactica Mainnet (613419)`,
    readErrorPrefix: "Erreur de lecture :",
    lockedGnet: "GNET verrouilles",
    veBalance: "Solde veGNET",
    currentLockEnd: "Fin actuelle du verrouillage",
    daysRemaining: "Jours restants",
    maxPossibleEnd: "Fin maximale possible",
    maxExtendableBy: "Extension maximale",
    selectedTargetEnd: "Nouvelle fin selectionnee",
    selectedExtension: "Extension selectionnee",
    targetExtension: (days: number) => `Extension cible : ${formatDays("fr", days)}`,
    current: "Actuel",
    max: "Max",
    roundingInfo:
      "Le nombre de jours choisi s'arrondit encore a la semaine actuelle du verrouillage. Deplacez davantage le curseur pour atteindre la prochaine limite hebdomadaire valide.",
    noActiveLock: "Aucun verrouillage actif trouve pour ce portefeuille.",
    alreadyMax:
      "Le verrouillage est deja au maximum de la semaine en cours. Vous devez attendre avant qu'une nouvelle extension soit possible.",
    extending: "Extension en cours...",
    extendLock: "Etendre le verrouillage",
    txPending: "Transaction en attente...",
    txConfirmed: "Transaction confirmee",
    userRejected: "Transaction refusee par l'utilisateur.",
    txFailed: "Echec de la transaction.",
    readFailed: "Impossible de lire l'etat du contrat",
    noteOne:
      "Cette action envoie une transaction depuis le portefeuille connecte et ne fait qu'etendre la date de deblocage du verrouillage veGNET existant. Elle n'ajoute pas de GNET.",
    noteTwo:
      "L'extension du verrouillage utilise un arrondi a la semaine, il faut donc parfois attendre avant qu'une nouvelle extension soit possible.",
    language: "Langue",
    english: "English",
    french: "Francais",
    gnetUnit: "GNET",
    vegnetUnit: "veGNET",
  },
} satisfies Record<Locale, Record<string, string | ((value: any) => string)>>;

function formatDays(locale: Locale, days: number): string {
  if (locale === "fr") {
    return `${days} jour${days > 1 ? "s" : ""}`;
  }

  return `${days} day${days === 1 ? "" : "s"}`;
}

function tsToDate(ts: bigint, locale: Locale): string {
  if (ts === 0n) return "—";
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(Number(ts) * 1000)) + " UTC";
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
  const router = useRouter();
  const locale: Locale = router.locale === "fr" ? "fr" : "en";
  const t = translations[locale];
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

  const switchLocale = async (nextLocale: Locale) => {
    if (nextLocale === locale) return;
    await router.push(router.pathname, router.asPath, { locale: nextLocale });
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
      setReadError(err?.message ?? t.readFailed);
      setLock(null);
    }
  }, [t.readFailed]);

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
        setTxStatus({ kind: "error", message: t.userRejected });
      } else {
        setTxStatus({ kind: "error", message: err?.message ?? t.txFailed });
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
        <title>lockextend</title>
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
            <h1 style={styles.title}>lockextend</h1>
          </div>

          <div style={styles.localeRow}>
            <span style={styles.localeLabel}>{t.language}</span>
            <div style={styles.localeButtons}>
              <button
                type="button"
                style={locale === "en" ? styles.localeBtnActive : styles.localeBtn}
                onClick={() => void switchLocale("en")}
              >
                {t.english}
              </button>
              <button
                type="button"
                style={locale === "fr" ? styles.localeBtnActive : styles.localeBtn}
                onClick={() => void switchLocale("fr")}
              >
                {t.french}
              </button>
            </div>
          </div>

          {/* MetaMask check */}
          {!hasMetaMask && (
            <p style={styles.warning}>{t.metaMaskMissing}</p>
          )}

          {/* Connect */}
          {hasMetaMask && !account && (
            <button style={styles.btn} onClick={connect}>
              {t.connectWallet}
            </button>
          )}

          {/* Account & network */}
          {account && (
            <div style={styles.section}>
              <Row label={t.wallet} value={account} />
              <Row
                label={t.network}
                value={
                  isCorrectNetwork ? (
                    <span style={{ color: "#27ae60" }}>{t.networkOk} ✓</span>
                  ) : (
                    <span style={{ color: "#e74c3c" }}>
                      {t.wrongNetwork(chainId)}
                    </span>
                  )
                }
              />
            </div>
          )}

          {/* Read error */}
          {readError && <p style={styles.error}>{t.readErrorPrefix} {readError}</p>}

          {/* Lock data */}
          {lock && isCorrectNetwork && (
            <div style={styles.section}>
              <Row label={t.lockedGnet} value={formatEther(lock.lockedAmount) + " " + t.gnetUnit} />
              <Row label={t.veBalance} value={formatEther(lock.veBalance) + " " + t.vegnetUnit} />
              <Row label={t.currentLockEnd} value={tsToDate(lock.lockEnd, locale)} />
              <Row label={t.daysRemaining} value={String(daysFromNow(lock.lockEnd))} />
              <Row label={t.maxPossibleEnd} value={tsToDate(lock.maxNewTs, locale)} />
              <Row label={t.maxExtendableBy} value={formatDays(locale, maxSelectableDays)} />
              <Row
                label={t.selectedTargetEnd}
                value={tsToDate(selectedNewTs, locale)}
              />
              <Row
                label={t.selectedExtension}
                value={
                  formatDays(locale, canSubmitSelected ? effectiveExtensionDays : 0)
                }
              />
            </div>
          )}

          {lock && isCorrectNetwork && lock.canExtend && (
            <div style={styles.sliderWrap}>
              <label htmlFor="extend-days" style={styles.sliderLabel}>
                {t.targetExtension(safeSelectedDays)}
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
                <span>{t.current}</span>
                <span>{t.max}</span>
              </div>
              {!canSubmitSelected && safeSelectedDays > 0 && (
                <p style={styles.info}>
                  {t.roundingInfo}
                </p>
              )}
            </div>
          )}

          {/* Status messages */}
          {account && isCorrectNetwork && !hasActiveLock && lock !== null && (
            <p style={styles.warning}>{t.noActiveLock}</p>
          )}

          {account && isCorrectNetwork && hasActiveLock && !lock!.canExtend && (
            <p style={styles.info}>
              {t.alreadyMax}
            </p>
          )}

          {/* Extend button */}
          {account && isCorrectNetwork && (
            <button style={submitDisabled ? styles.btnDisabled : styles.btn} disabled={submitDisabled} onClick={extendLock}>
              {txStatus.kind === "pending" ? t.extending : t.extendLock}
            </button>
          )}

          {/* Tx status */}
          {txStatus.kind === "pending" && (
            <p style={styles.info}>
              {t.txPending}<br />
              <span style={styles.mono}>{txStatus.hash}</span>
            </p>
          )}
          {txStatus.kind === "success" && (
            <p style={{ ...styles.info, color: "#27ae60" }}>
              {t.txConfirmed} ✓<br />
              <span style={styles.mono}>{txStatus.hash}</span>
            </p>
          )}
          {txStatus.kind === "error" && (
            <p style={styles.error}>{txStatus.message}</p>
          )}

          {/* Notices */}
          <p style={styles.note}>
            {t.noteOne}
          </p>
          <p style={styles.note}>
            {t.noteTwo}
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
  localeRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    marginBottom: 20,
  },
  localeLabel: {
    color: "#8b949e",
    fontSize: 13,
  },
  localeButtons: {
    display: "flex",
    gap: 8,
  },
  localeBtn: {
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid #30363d",
    background: "transparent",
    color: "#c9d1d9",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
  },
  localeBtnActive: {
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid #238636",
    background: "#15351f",
    color: "#e6edf3",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
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
