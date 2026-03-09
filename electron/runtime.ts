import net from 'node:net';

export const DEFAULT_SERVER_PORT = 3001;

function listenForPort(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once('error', (error) => {
      server.close(() => reject(error));
    });

    server.listen(port, () => {
      const address = server.address();
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }

        if (!address || typeof address === 'string') {
          reject(new Error('Failed to determine an available port.'));
          return;
        }

        resolve(address.port);
      });
    });
  });
}

export async function findAvailablePort(preferredPort = DEFAULT_SERVER_PORT): Promise<number> {
  try {
    await listenForPort(preferredPort);
    return preferredPort;
  } catch {
    return listenForPort(0);
  }
}

export function buildLocalUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}
