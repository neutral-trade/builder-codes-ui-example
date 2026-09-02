import { ConnectWallet } from "@/components/ConnectWallet";
import { FlowTabs } from "@/components/FlowTabs";
import { WalletProvider } from "@/lib/wallet";
import type { PublicConfig } from "@/config";

function getErrorMessage(thrownObject: unknown): string {
  return thrownObject instanceof Error
    ? thrownObject.message
    : `Unexpected configuration failure: ${String(thrownObject)}`;
}

type ConfigResult =
  | { config: PublicConfig }
  | { errorMessage: string };

async function loadConfig(): Promise<ConfigResult> {
  try {
    const { config } = await import("@/config");
    return { config };
  } catch (thrownObject) {
    return { errorMessage: getErrorMessage(thrownObject) };
  }
}

export default async function Home() {
  const configResult = await loadConfig();
  if ("errorMessage" in configResult) {
    return (
      <main className="configuration-page">
        <section className="configuration-error" role="alert">
          <p className="eyebrow">Configuration error</p>
          <h1>{configResult.errorMessage}</h1>
          <p>
            Check <code>.env.example</code>, update <code>.env.local</code>, and
            restart the development server.
          </p>
        </section>
      </main>
    );
  }

  const { config } = configResult;
  return (
    <WalletProvider cluster={config.cluster}>
      <main className="app-shell">
        <header className="header">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              N
            </span>
            <div>
              <p className="brand-name">Neutral Autopilot</p>
              <p className="vault-name">{config.vault.name}</p>
            </div>
          </div>
          <div className="header-actions">
            <span className={`cluster-badge ${config.cluster}`}>
              {config.cluster}
            </span>
            <ConnectWallet />
          </div>
        </header>

        <div className="page-intro">
          <p className="eyebrow">Builder reference</p>
          <h1>Choose how your users deposit.</h1>
          <p>
            Three integration paths, one connected wallet, and the same Neutral
            Autopilot vault.
          </p>
        </div>

        <div className="dashboard-grid">
          <aside className="sidebar" aria-label="Vault overview">
            <section className="info-card">
              <div className="card-heading">
                <span>Vault</span>
                <span className="status-pill">Registry</span>
              </div>
              <h2>{config.vault.name}</h2>
              <dl>
                <div>
                  <dt>Deposit token</dt>
                  <dd>{config.vault.depositToken.symbol}</dd>
                </div>
                <div>
                  <dt>Decimals</dt>
                  <dd>{config.vault.depositToken.decimals}</dd>
                </div>
              </dl>
              <p className="address-line" title={config.vault.address}>
                {config.vault.address}
              </p>
            </section>

            <section className="info-card muted-card">
              <div className="card-heading">
                <span>Your position</span>
                <span className="status-pill">Wallet</span>
              </div>
              <h2>Connect to view</h2>
              <p>Position balances and pending activity appear here.</p>
            </section>
          </aside>

          <FlowTabs config={config} />
        </div>
      </main>
    </WalletProvider>
  );
}
