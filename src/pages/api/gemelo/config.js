export const prerender = false;

export async function GET() {
  const workerUrl = (
    import.meta.env.PUBLIC_GEMELO_WORKER_URL ||
    import.meta.env.GEMELO_WORKER_URL ||
    ''
  )
    .toString()
    .replace(/\/+$/, '');

  return new Response(
    JSON.stringify({
      workerUrl,
      minFotos: 5,
      maxFotos: 100,
      maxVideoMb: 300,
      modo: import.meta.env.GEMELO_MODO || 'auto',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}
