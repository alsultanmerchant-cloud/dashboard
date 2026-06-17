import "server-only";

// Worker-pool: run `worker` over `items` with at most `limit` in flight.
//
// The Google-Sheet sync used to await every per-row DB call serially, which on
// a few hundred rows turned into hundreds of round-trips and tripped Vercel's
// FUNCTION_INVOCATION_TIMEOUT. Bounded concurrency keeps the exact same per-row
// logic but overlaps the network latency. The cap stays modest so we don't
// exhaust the Supabase connection pool.
export async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (index < items.length) {
        const i = index++;
        await worker(items[i]);
      }
    },
  );
  await Promise.all(runners);
}
