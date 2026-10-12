import { connection } from 'next/server';
import { Suspense } from 'react';
import { AgentApp } from '@/components/agent-app';
import { Header } from '@/components/header';
import { liveModelId } from '@/lib/config';

export default function Page() {
  return (
    <>
      <Header />
      {/* useChat creates ids with Math.random(), which a prerendered page may not hold: it renders on request. */}
      <Suspense>
        <Agent />
      </Suspense>
    </>
  );
}

async function Agent() {
  // Read the environment on each request, not when the page is built: set OPENAI_API_KEY, restart, and live mode is there.
  await connection();
  return <AgentApp liveModel={liveModelId()} />;
}
