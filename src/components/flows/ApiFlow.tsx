export function ApiFlow() {
  return (
    <div className="flow-content">
      <p className="eyebrow">Server-assisted</p>
      <h2>Deposit through the REST API</h2>
      <p>
        Request a prepared transaction from your server, verify it in the
        browser, and sign it with the connected wallet.
      </p>
      <div className="flow-placeholder">REST API deposit controls</div>
    </div>
  );
}
