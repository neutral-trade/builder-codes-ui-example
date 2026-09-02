"use client";

import { useState } from "react";

import { ApiFlow } from "@/components/flows/ApiFlow";
import { SdkFlow } from "@/components/flows/SdkFlow";
import { WidgetFlow } from "@/components/flows/WidgetFlow";

const flows = [
  { id: "widget", label: "Widget", Component: WidgetFlow },
  { id: "api", label: "REST API", Component: ApiFlow },
  { id: "sdk", label: "SDK", Component: SdkFlow },
] as const;

type FlowId = (typeof flows)[number]["id"];

export function FlowTabs() {
  const [activeFlowId, setActiveFlowId] = useState<FlowId>("widget");
  const activeFlow =
    flows.find((flow) => flow.id === activeFlowId) ?? flows[0];

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
        <activeFlow.Component />
      </div>
    </section>
  );
}
