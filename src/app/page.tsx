import { ConnectWallet } from "@/components/ConnectWallet";
import { FlowTabs } from "@/components/FlowTabs";
import { PositionCard } from "@/components/PositionCard";
import { VaultCard } from "@/components/VaultCard";
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
          <aside className="sidebar" aria-label="Vault and position overview">
            <VaultCard />
            <PositionCard
              assetDecimals={config.vault.depositToken.decimals}
              assetSymbol={config.vault.depositToken.symbol}
            />
          </aside>

          <FlowTabs />
        </div>
      </main>
    </WalletProvider>
  );
}
