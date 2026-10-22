"use client";
import { use } from "react";
import { AgentDossier } from "@/components/dossier";

export default function TombPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = use(params);
  return <AgentDossier agentId={decodeURIComponent(agentId)} from="graveyard" />;
}
