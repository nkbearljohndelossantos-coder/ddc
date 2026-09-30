import { DccBackgroundAgent } from '../../dcc-background-agent/src/daemon.js';

export { DccBackgroundAgent };

// Auto-run if executed directly via CLI
if (
  process.argv[1]?.includes('daemon.ts') ||
  process.argv[1]?.includes('daemon.js') ||
  import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`
) {
  const daemon = new DccBackgroundAgent();
  daemon.start().catch((err) => {
    console.error('Fatal DCC Agent Error:', err);
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    await daemon.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await daemon.stop();
    process.exit(0);
  });
}
