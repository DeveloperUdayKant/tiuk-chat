// Startup file for cPanel "Setup Node.js App" (Phusion Passenger).
// Passenger loads the startup file with require(), so hand off to the ES module entry point.
import('./server/index.js').catch((err) => {
  console.error('TIUK Chat failed to start:', err);
  process.exit(1);
});
