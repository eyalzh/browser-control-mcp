import * as net from 'net';

export function isPortInUse(port: number) {
    return new Promise((resolve) => {
      const server = net.createServer();
      
      server.once('error', (err: NodeJS.ErrnoException) => {
        // If the error is because the port is already in use
        if (err.code === 'EADDRINUSE') {
          resolve(true);
        } else {
          // Some other error occurred
          console.error('Error checking port:', err);
          resolve(false);
        }
      });
      
      server.once('listening', () => {
        // If we get here, the port is free
        // Close the server and resolve with false (port not in use)
        server.close(() => {
          resolve(false);
        });
      });
      
      // Try to listen on the port (bind to localhost)
      server.listen(port, 'localhost');
    });
  }