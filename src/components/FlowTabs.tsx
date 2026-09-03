"use client";

import { useState } from "react";

import type { PublicConfig } from "@/config";
import { ApiFlow } from "@/components/flows/ApiFlow";
import { SdkFlow } from "@/components/flows/SdkFlow";
import { WidgetFlow } from "@/components/flows/WidgetFlow";

const flows = [
  { id: "widget", label: "Widget" },
  { id: "api", label: "REST API" },
  { id: "sdk", label: "SDK" },
] as const;

type FlowId = (typeof flows)[number]["id"];

export function FlowTabs({ config }: { config: PublicConfig }) {
  const [activeFlowId, setActiveFlowId] = useState<FlowId>("widget");
  const activeFlow =
    flows.find((flow) => flow.id === activeFlowId) ?? flows[0];

  const activeComponent =
    activeFlow.id === "api" ? (
      <ApiFlow config={config} />
    ) : activeFlow.id === "sdk" ? (
      <SdkFlow />
    ) : (
      <WidgetFlow />
    );

  return (
    <section className="flow-card" aria-label="Vault integration flows">
      <div className="tabs" role="tablist" aria-label="Vault integration flow">
        {flows.map((flow) => (
          <button
            aria-controls={`${flow.id}-panel`}
            aria-selected={activeFlowId === flow.id}
            className="tab"
            id={`${flow.id}-tab`}
            key={flow.id}
            onClick={() => setActiveFlowId(flow.id)}
            role="tab"
            type="button"
          >
            {flow.label}
          </button>
        ))}
      </div>
      <div
        aria-labelledby={`${activeFlow.id}-tab`}
        className="flow-panel"
        id={`${activeFlow.id}-panel`}
        role="tabpanel"
      >
        {activeComponent}
      </div>
    </section>
  );
}
