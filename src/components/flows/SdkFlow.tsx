"use client";

/*
 * This direct SDK path needs a Solana Kit signer and an RPC that supports
 * getAccountInfo, getMultipleAccounts, simulateTransaction, and sendTransaction.
 * It talks to the onchain program directly, so the API attribution flag is not
 * part of this flow.
 */

import type { FormEvent } from "react";
import type { Address, Instruction, TransactionSigner } from "@solana/kit";
import {
  BuilderDepositAmountTooLowError,
  buildAttributedDepositTx,
  buildDepositInstructions,
  buildRequestWithdrawInstruction,
  fetchBundle,
  fetchMaybeUserBundleAccount,
  fetchUserBundleBalance,
  findUserBundleAccountPda,
} from "@neutral-trade/sdk";
import { address } from "@solana/kit";
import { useMemo, useState } from "react";

import { config } from "@/config";
import {
  AmountExceedsBalanceError,
  assertAmountWithinBalance,
  formatRawAmount,
  parsePositiveTokenAmount,
  TokenAmountError,
} from "@/lib/amount";
import { getCreateAssociatedTokenIdempotentInstruction } from "@/lib/ata";
import {
  createReferrerCodeResolver,
  type ReferrerCodeResolver,
} from "@/lib/code-resolver";
import { refreshPosition } from "@/lib/position-refresh";
import { rpc } from "@/lib/rpc";
import {
  sendInstructions,
  type SendTransactionUpdate,
  TransactionSimulationError,
} from "@/lib/send";
import { createWalletSignerAdapter } from "@/lib/signer";
import { useWallet } from "@/lib/wallet";

type ActiveOperation =
  | "attributed-deposit"
  | "unattributed-deposit"
  | "withdraw";

interface DisplayedError {
  canDepositWithoutAttribution?: boolean;
  code: string;
  logs?: ReadonlyArray<string>;
  message: string;
}

interface TransactionResult {
  action: string;
  attributedTo?: Address;
  signature: string;
  verificationMessage?: string;
}

interface AvailableBalance {
  amountRaw: bigint;
  owner: Address;
}

const ATTRIBUTION_ERROR_MEANINGS: Record<string, string> = {
  INVALID_REFERRER:
    "The configured builder cannot refer this wallet or this vault.",
  REFERRAL_ALREADY_SET:
    "Attribution is one-shot on the first deposit, and this wallet already has a referrer.",
  REFERRALS_DISABLED: "This vault does not accept builder referrals.",
  REFERRER_DEACTIVATED:
    "The configured builder registration is currently deactivated.",
  REFERRER_DEPOSIT_TOO_LOW:
    "The configured builder has not met this vault's deposit requirement.",
  REFERRER_NOT_REGISTERED:
    "The configured builder is not registered for this vault.",
  USER_BUNDLE_ACCOUNT_HAS_ACTIVITY:
    "Attribution is one-shot on the first deposit, and this wallet already has vault activity.",
};

const ATTRIBUTION_FALLBACK_CODES = new Set([
  "INVALID_REFERRER",
  "REFERRAL_ALREADY_SET",
  "REFERRALS_DISABLED",
  "REFERRER_DEACTIVATED",
  "REFERRER_DEPOSIT_TOO_LOW",
  "REFERRER_NOT_REGISTERED",
  "USER_BUNDLE_ACCOUNT_HAS_ACTIVITY",
]);

const WITHDRAW_ERROR_MEANINGS: Record<string, string> = {
  BUNDLE_ACCOUNT_NOT_FOUND: "The configured vault account was not found.",
  ORACLE_DATA_NOT_FOUND:
    "Current vault price data is unavailable, so withdrawal shares cannot be calculated.",
  USER_BUNDLE_ACCOUNT_NOT_FOUND:
    "This wallet does not have a position in the configured vault.",
  ZERO_WITHDRAWAL_SHARES:
    "That amount is smaller than one share at the current price per share.",
};

// In JS it's possible to throw *anything*. A sensible programmer
// will only throw Errors but we must still check to satisfy
// TypeScript (and flag any craziness)
function ensureError(thrownObject: unknown): Error {
  if (thrownObject instanceof Error) {
    return thrownObject;
  }
  return new Error(`Non-Error thrown: ${String(thrownObject)}`);
}

function shortenAddress(value: string): string {
  return `${value.slice(0, 5)}...${value.slice(-5)}`;
}

function getExplorerUrl(signature: string): string {
  const clusterQuery = config.cluster === "devnet" ? "?cluster=devnet" : "";
  return `https://explorer.solana.com/tx/${signature}${clusterQuery}`;
}

function getConfiguredProgramAddress(): Address {
  return address(config.vault.bundleProgramId);
}

function getSimulationError(
  error: TransactionSimulationError,
): DisplayedError {
  return {
    code: "SIMULATION_FAILED",
    logs: error.logs,
    message: `${error.message}. The wallet was not prompted.`,
  };
}

function getDepositError(error: Error, allowFallback: boolean): DisplayedError {
  if (error instanceof TransactionSimulationError) {
    return getSimulationError(error);
  }
  if (error instanceof TokenAmountError) {
    return { code: "INVALID_AMOUNT", message: error.message };
  }
  if (error instanceof BuilderDepositAmountTooLowError) {
    const minimum = formatRawAmount(
      error.requiredGrossDepositAmount,
      config.vault.depositToken.decimals,
    );
    return {
      code: error.message,
      message: `The vault requires a minimum gross deposit of ${minimum} ${config.vault.depositToken.symbol}.`,
    };
  }

  const meaning = ATTRIBUTION_ERROR_MEANINGS[error.message];
  if (meaning) {
    return {
      canDepositWithoutAttribution:
        allowFallback && ATTRIBUTION_FALLBACK_CODES.has(error.message),
      code: error.message,
      message: meaning,
    };
  }

  const resolverErrorMeanings: Record<string, string> = {
    INVALID_REFERRER_CODE: "The configured builder code is empty.",
    INVALID_REFERRER_CODE_RESPONSE:
      "The builder code service returned an invalid referrer address.",
    REFERRER_CODE_NOT_FOUND:
      "The configured builder code does not currently resolve to a builder.",
  };
  const resolverMeaning = resolverErrorMeanings[error.message];
  if (resolverMeaning) {
    return { code: error.message, message: resolverMeaning };
  }

  return {
    code: error.name === "Error" ? "TRANSACTION_ERROR" : error.name,
    message: error.message,
  };
}

function getWithdrawError(error: Error): DisplayedError {
  if (error instanceof TransactionSimulationError) {
    return getSimulationError(error);
  }
  if (error instanceof AmountExceedsBalanceError) {
    const availableBalance = formatRawAmount(
      error.availableBalanceRaw,
      config.vault.depositToken.decimals,
    );
    return {
      code: "AMOUNT_EXCEEDS_BALANCE",
      message: `The requested amount exceeds the current withdrawable balance of ${availableBalance} ${config.vault.depositToken.symbol}. Choose Max or enter a smaller amount.`,
    };
  }
  if (error instanceof TokenAmountError) {
    return { code: "INVALID_AMOUNT", message: error.message };
  }

  const meaning = WITHDRAW_ERROR_MEANINGS[error.message];
  if (meaning) {
    return { code: error.message, message: meaning };
  }

  return {
    code: error.name === "Error" ? "TRANSACTION_ERROR" : error.name,
    message: error.message,
  };
}

function describeSendUpdate(update: SendTransactionUpdate): string {
  switch (update.phase) {
    case "assembling":
      return `Assembling ${update.instructionCount} instruction${update.instructionCount === 1 ? "" : "s"}.`;
    case "simulating":
      return "Simulating against current vault state before opening the wallet.";
    case "signing":
      return `Simulation passed. Review ${update.instructionCount} instruction${update.instructionCount === 1 ? "" : "s"} in your wallet.`;
    case "sending":
      return "Wallet signed. Sending the transaction.";
    case "confirming":
      return "Transaction sent. Waiting for confirmed commitment.";
  }
}

async function buildAttributedDeposit(
  signer: TransactionSigner,
  amountRaw: bigint,
  resolveCode: ReferrerCodeResolver,
): Promise<{
  expectedReferrer: Address;
  instructions: Array<Instruction>;
}> {
  const vault = address(config.vault.address);
  const programAddress = getConfiguredProgramAddress();

  if (config.attribution.kind === "address") {
    const expectedReferrer = address(config.attribution.address);
    const instructions = await buildAttributedDepositTx(rpc, {
      amount: amountRaw,
      referrer: expectedReferrer,
      user: signer,
      vault,
      programAddress,
    });
    return { expectedReferrer, instructions };
  }

  const expectedReferrer = await resolveCode(config.attribution.code);
  const instructions = await buildAttributedDepositTx(rpc, {
    amount: amountRaw,
    code: config.attribution.code,
    resolveCode: () => expectedReferrer,
    user: signer,
    vault,
    programAddress,
  });
  return { expectedReferrer, instructions };
}

async function buildUnattributedDeposit(
  signer: TransactionSigner,
  amountRaw: bigint,
): Promise<Array<Instruction>> {
  const programAddress = getConfiguredProgramAddress();
  return await buildDepositInstructions(rpc, {
    amountRaw,
    bundleAccount: address(config.vault.address),
    user: signer,
    programAddress,
  });
}

async function fetchAttribution(user: Address): Promise<Address | undefined> {
  const bundleAccount = address(config.vault.address);
  const programAddress = getConfiguredProgramAddress();
  const [userBundleAccount] = await findUserBundleAccountPda(
    { bundleAccount, userBundleAccountOwner: user },
    { programAddress },
  );
  const account = await fetchMaybeUserBundleAccount(rpc, userBundleAccount);
  return account.exists ? account.data.referrer : undefined;
}

async function fetchWithdrawableBalance(
  user: Address,
): Promise<bigint | undefined> {
  const programAddress = getConfiguredProgramAddress();
  const balance = await fetchUserBundleBalance(rpc, {
    bundleAccount: address(config.vault.address),
    user,
    programAddress,
  });
  return balance?.balanceRaw;
}

async function buildWithdrawal(
  signer: TransactionSigner,
  amountRaw: bigint,
): Promise<Array<Instruction>> {
  const bundleAccountAddress = address(config.vault.address);
  const programAddress = getConfiguredProgramAddress();
  const bundleAccount = await fetchBundle(rpc, bundleAccountAddress);

  if (bundleAccount.programAddress !== programAddress) {
    throw new Error("BUNDLE_ACCOUNT_PROGRAM_MISMATCH");
  }

  const [associatedTokenInstruction, withdrawalInstruction] =
    await Promise.all([
      getCreateAssociatedTokenIdempotentInstruction({
        mint: bundleAccount.data.assetAddress,
        owner: signer.address,
        payer: signer,
      }),
      buildRequestWithdrawInstruction(rpc, {
        amountRaw,
        bundleAccount: bundleAccountAddress,
        user: signer,
        programAddress,
      }),
    ]);

  return [associatedTokenInstruction, withdrawalInstruction];
}

function TransactionFeedback({
  error,
  onDepositWithoutAttribution,
  progressMessage,
  result,
  submittedSignature,
}: {
  error: DisplayedError | undefined;
  onDepositWithoutAttribution(): void;
  progressMessage: string | undefined;
  result: TransactionResult | undefined;
  submittedSignature: string | undefined;
}) {
  if (!error && !progressMessage && !result && !submittedSignature) {
    return null;
  }

  return (
    <div
      aria-live="polite"
      className={`transaction-feedback${error ? " error" : result ? " success" : ""}`}
    >
      {progressMessage ? <p>{progressMessage}</p> : null}

      {submittedSignature && !result ? (
        <p>
          Submitted: {" "}
          <a
            href={getExplorerUrl(submittedSignature)}
            rel="noreferrer"
            target="_blank"
          >
            {shortenAddress(submittedSignature)}
          </a>
        </p>
      ) : null}

      {error ? (
        <div role="alert">
          <p className="error-code">{error.code}</p>
          <p>{error.message}</p>
          {error.logs !== undefined ? (
            <details open>
              <summary>Simulation logs</summary>
              <pre className="simulation-logs">
                {error.logs.length > 0
                  ? error.logs.join("\n")
                  : "The RPC returned no program logs."}
              </pre>
            </details>
          ) : null}
          {error.canDepositWithoutAttribution ? (
            <button
              className="secondary-button fallback-button"
              onClick={onDepositWithoutAttribution}
              type="button"
            >
              Deposit without attribution
            </button>
          ) : null}
        </div>
      ) : null}

      {result ? (
        <div>
          <p>{result.action} confirmed.</p>
          <p>
            Signature: {" "}
            <a
              href={getExplorerUrl(result.signature)}
              rel="noreferrer"
              target="_blank"
            >
              {shortenAddress(result.signature)}
            </a>
          </p>
          {result.attributedTo ? (
            <p className="attribution-result">
              Attributed to <span>{result.attributedTo}</span>
            </p>
          ) : null}
          {result.verificationMessage ? (
            <p className="verification-message">
              {result.verificationMessage}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function SdkFlow() {
  const { account, wallet } = useWallet();
  const signer = useMemo(
    () =>
      wallet && account
        ? createWalletSignerAdapter(
            wallet,
            account,
            config.cluster,
          ).createKitSigner()
        : undefined,
    [account, wallet],
  );
  const resolveCode = useMemo(
    () => createReferrerCodeResolver(config.neutralApiUrl),
    [],
  );

  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [activeOperation, setActiveOperation] =
    useState<ActiveOperation>();
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [availableBalance, setAvailableBalance] =
    useState<AvailableBalance>();
  const [displayedError, setDisplayedError] = useState<DisplayedError>();
  const [progressMessage, setProgressMessage] = useState<string>();
  const [submittedSignature, setSubmittedSignature] = useState<string>();
  const [transactionResult, setTransactionResult] =
    useState<TransactionResult>();

  const isBusy = activeOperation !== undefined;
  const currentAvailableBalance =
    signer && availableBalance?.owner === signer.address
      ? availableBalance.amountRaw
      : undefined;

  function clearTransactionFeedback(): void {
    setDisplayedError(undefined);
    setProgressMessage(undefined);
    setSubmittedSignature(undefined);
    setTransactionResult(undefined);
  }

  function handleSendUpdate(update: SendTransactionUpdate): void {
    setProgressMessage(describeSendUpdate(update));
    if (update.signature) {
      setSubmittedSignature(update.signature);
    }
  }

  async function executeDeposit(withAttribution: boolean): Promise<void> {
    if (!signer) {
      setDisplayedError({
        code: "WALLET_NOT_CONNECTED",
        message: "Connect a wallet before building a deposit.",
      });
      return;
    }

    const operation: ActiveOperation = withAttribution
      ? "attributed-deposit"
      : "unattributed-deposit";
    setActiveOperation(operation);
    clearTransactionFeedback();
    setProgressMessage(
      withAttribution
        ? "Reading live vault and builder referral state."
        : "Reading live vault state for an unattributed deposit.",
    );

    try {
      const amountRaw = parsePositiveTokenAmount(
        depositAmount,
        config.vault.depositToken.decimals,
      );
      const attributedDeposit = withAttribution
        ? await buildAttributedDeposit(signer, amountRaw, resolveCode)
        : undefined;
      const instructions = attributedDeposit
        ? attributedDeposit.instructions
        : await buildUnattributedDeposit(signer, amountRaw);
      const signature = await sendInstructions({
        instructions,
        onUpdate: handleSendUpdate,
        signer,
      });
      const confirmedResult: TransactionResult = {
        action: withAttribution
          ? "Attributed deposit request"
          : "Unattributed deposit request",
        signature,
      };

      setTransactionResult(confirmedResult);
      refreshPosition();

      if (attributedDeposit) {
        try {
          const attributedTo = await fetchAttribution(signer.address);
          setTransactionResult({
            ...confirmedResult,
            attributedTo,
            verificationMessage:
              attributedTo === attributedDeposit.expectedReferrer
                ? undefined
                : attributedTo
                  ? `The account reports ${attributedTo}, but ${attributedDeposit.expectedReferrer} was expected.`
                  : "The confirmed user bundle account is not readable yet.",
          });
        } catch (thrownObject) {
          const error = ensureError(thrownObject);
          setTransactionResult({
            ...confirmedResult,
            verificationMessage: `The transaction confirmed, but attribution could not be read back: ${error.message}`,
          });
        }
      }
    } catch (thrownObject) {
      setDisplayedError(
        getDepositError(ensureError(thrownObject), withAttribution),
      );
    } finally {
      setActiveOperation(undefined);
      setProgressMessage(undefined);
    }
  }

  async function handleDepositSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    await executeDeposit(true);
  }

  async function loadMaximumWithdrawal(): Promise<void> {
    if (!signer) {
      setDisplayedError({
        code: "WALLET_NOT_CONNECTED",
        message: "Connect a wallet before reading its position.",
      });
      return;
    }

    setIsLoadingBalance(true);
    setDisplayedError(undefined);
    try {
      const amountRaw = await fetchWithdrawableBalance(signer.address);
      if (amountRaw === undefined || amountRaw <= 0n) {
        throw new TokenAmountError(
          "This wallet has no withdrawable balance in the configured vault.",
        );
      }
      setAvailableBalance({ amountRaw, owner: signer.address });
      setWithdrawAmount(
        formatRawAmount(amountRaw, config.vault.depositToken.decimals),
      );
    } catch (thrownObject) {
      setDisplayedError(getWithdrawError(ensureError(thrownObject)));
    } finally {
      setIsLoadingBalance(false);
    }
  }

  async function handleWithdrawSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (!signer) {
      setDisplayedError({
        code: "WALLET_NOT_CONNECTED",
        message: "Connect a wallet before building a withdrawal.",
      });
      return;
    }

    setActiveOperation("withdraw");
    clearTransactionFeedback();
    setProgressMessage("Reading live balance and price-per-share state.");

    try {
      const amountRaw = parsePositiveTokenAmount(
        withdrawAmount,
        config.vault.depositToken.decimals,
      );
      const availableBalanceRaw = await fetchWithdrawableBalance(
        signer.address,
      );
      if (availableBalanceRaw === undefined) {
        throw new Error("USER_BUNDLE_ACCOUNT_NOT_FOUND");
      }
      setAvailableBalance({
        amountRaw: availableBalanceRaw,
        owner: signer.address,
      });
      assertAmountWithinBalance(amountRaw, availableBalanceRaw);

      const instructions = await buildWithdrawal(signer, amountRaw);
      const signature = await sendInstructions({
        instructions,
        onUpdate: handleSendUpdate,
        signer,
      });
      setTransactionResult({
        action: `Withdrawal request for ${formatRawAmount(amountRaw, config.vault.depositToken.decimals)} ${config.vault.depositToken.symbol}`,
        signature,
      });
      setAvailableBalance(undefined);
      refreshPosition();
    } catch (thrownObject) {
      setDisplayedError(getWithdrawError(ensureError(thrownObject)));
    } finally {
      setActiveOperation(undefined);
      setProgressMessage(undefined);
    }
  }

  const attributionLabel =
    config.attribution.kind === "address"
      ? shortenAddress(config.attribution.address)
      : `code: ${config.attribution.code}`;

  return (
    <div className="flow-content sdk-flow">
      <p className="eyebrow">Direct onchain integration</p>
      <h2>Deposit and withdraw with the Neutral SDK</h2>
      <p>
        The SDK derives accounts from live RPC state. This path bypasses the
        Neutral API attribution flag, simulates before every wallet prompt, and
        submits with Solana Kit.
      </p>

      <div className="sdk-panels">
        <form className="transaction-panel" onSubmit={handleDepositSubmit}>
          <div className="panel-title-row">
            <div>
              <p className="panel-kicker">First deposit</p>
              <h3>Deposit</h3>
            </div>
            <span className="status-pill">Attributed</span>
          </div>

          <label className="sdk-amount-field">
            <span>Amount ({config.vault.depositToken.symbol})</span>
            <input
              autoComplete="off"
              disabled={isBusy}
              inputMode="decimal"
              maxLength={40}
              onChange={(event) => {
                setDepositAmount(event.target.value);
                if (displayedError?.canDepositWithoutAttribution) {
                  setDisplayedError(undefined);
                }
              }}
              placeholder="10.00"
              spellCheck={false}
              type="text"
              value={depositAmount}
            />
          </label>

          <dl className="sdk-transaction-summary">
            <div>
              <dt>Cluster</dt>
              <dd>{config.cluster}</dd>
            </div>
            <div>
              <dt>Fee payer</dt>
              <dd>{signer ? shortenAddress(signer.address) : "Connect wallet"}</dd>
            </div>
            <div>
              <dt>Builder</dt>
              <dd>{attributionLabel}</dd>
            </div>
            <div>
              <dt>Vault</dt>
              <dd>{shortenAddress(config.vault.address)}</dd>
            </div>
          </dl>

          <button
            className="primary-button action-button"
            disabled={isBusy || !signer}
            type="submit"
          >
            {activeOperation === "attributed-deposit"
              ? "Processing deposit..."
              : "Simulate & deposit"}
          </button>
          <p className="panel-note">
            Builder attribution can only be attached to the wallet&apos;s first
            vault deposit.
          </p>
        </form>

        <form className="transaction-panel" onSubmit={handleWithdrawSubmit}>
          <div className="panel-title-row">
            <div>
              <p className="panel-kicker">Live share price</p>
              <h3>Withdraw</h3>
            </div>
            <span className="status-pill">Keeper settled</span>
          </div>

          <label className="sdk-amount-field">
            <span>Amount ({config.vault.depositToken.symbol})</span>
            <div className="amount-with-max">
              <input
                autoComplete="off"
                disabled={isBusy}
                inputMode="decimal"
                maxLength={40}
                onChange={(event) => setWithdrawAmount(event.target.value)}
                placeholder="5.00"
                spellCheck={false}
                type="text"
                value={withdrawAmount}
              />
              <button
                className="max-button"
                disabled={isBusy || isLoadingBalance || !signer}
                onClick={() => void loadMaximumWithdrawal()}
                type="button"
              >
                {isLoadingBalance ? "Loading" : "Max"}
              </button>
            </div>
          </label>

          <dl className="sdk-transaction-summary">
            <div>
              <dt>Available</dt>
              <dd>
                {currentAvailableBalance === undefined
                  ? "Use Max to fetch"
                  : `${formatRawAmount(currentAvailableBalance, config.vault.depositToken.decimals)} ${config.vault.depositToken.symbol}`}
              </dd>
            </div>
            <div>
              <dt>Cluster</dt>
              <dd>{config.cluster}</dd>
            </div>
            <div>
              <dt>Fee payer</dt>
              <dd>{signer ? shortenAddress(signer.address) : "Connect wallet"}</dd>
            </div>
            <div>
              <dt>Destination</dt>
              <dd>User token account</dd>
            </div>
          </dl>

          <button
            className="primary-button action-button"
            disabled={isBusy || !signer}
            type="submit"
          >
            {activeOperation === "withdraw"
              ? "Processing withdrawal..."
              : "Simulate & request withdrawal"}
          </button>
          <p className="panel-note">
            Requests above the live available balance are rejected. Settlement
            follows the vault cooldown and the next keeper cycle.
          </p>
        </form>
      </div>

      <TransactionFeedback
        error={displayedError}
        onDepositWithoutAttribution={() =>
          void executeDeposit(false)
        }
        progressMessage={progressMessage}
        result={transactionResult}
        submittedSignature={submittedSignature}
      />
    </div>
  );
}
