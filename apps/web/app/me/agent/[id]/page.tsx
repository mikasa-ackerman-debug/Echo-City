"use client";
import { use } from "react";
import { AgentDossier } from "@/components/dossier";

export default function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <AgentDossier agentId={decodeURIComponent(id)} from="me" />;
}
