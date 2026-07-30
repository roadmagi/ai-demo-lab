import type { Metadata } from "next";
import { ChatWorkbench } from "@/components/ChatWorkbench";
import { loadCorpus } from "@/lib/corpus";
import { GAP_PROBE_QUESTIONS, SUGGESTED_QUESTIONS } from "@/lib/kestrel";

export const metadata: Metadata = {
  title: "Support agent with real citations — AI Demo Lab",
  description:
    "A support agent that answers from a help center and cites the exact sentence behind every claim.",
};

// Read at request time rather than build time so editing a markdown file shows
// up on the next reload.
export const dynamic = "force-dynamic";

export default function ChatPage() {
  // The corpus is handed to the client so a citation can be resolved to source
  // text without a second round trip. It is public help-center content — there
  // is nothing here worth keeping server-side.
  const corpus = loadCorpus().map((doc) => ({
    id: doc.id,
    title: doc.title,
    text: doc.text,
  }));

  return (
    <div className="mx-auto max-w-6xl px-5 py-5">
      <ChatWorkbench
        corpus={corpus}
        suggested={SUGGESTED_QUESTIONS}
        gapProbes={GAP_PROBE_QUESTIONS}
      />
    </div>
  );
}
