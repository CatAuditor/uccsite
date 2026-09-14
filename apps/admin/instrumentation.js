// Runs once at server start (Next.js instrumentation hook). Surfaces the
// wrong-AWS-account error in the terminal immediately instead of on the
// first gated page; the same check gates every DB use in lib/data.js.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { assertAwsAccount } = await import('./lib/aws-account');
  await assertAwsAccount().catch((err) => console.error(`[admin] ${err.message}`));
}
