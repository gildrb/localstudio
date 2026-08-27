import net from "node:net";
import { Schema } from "effect";

const PortAddressSchema = Schema.Struct({ port: Schema.Number });

export async function isPortAvailable(port: number, host = "127.0.0.1"): Promise<boolean> {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return false;
  return new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}

export async function resolveStablePort(preferred?: number, host = "127.0.0.1"): Promise<number> {
  if (preferred && (await isPortAvailable(preferred, host))) return preferred;
  return allocatePort(host);
}

export async function allocatePort(host = "127.0.0.1"): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();

    server.once("error", (error) => {
      reject(error);
    });

    server.listen(0, host, () => {
      const address = Schema.decodeUnknownOption(PortAddressSchema)(server.address());
      if (address._tag === "Some") {
        const { port } = address.value;
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(port);
        });
        return;
      }

      server.close(() => reject(new Error("Unable to allocate local port")));
    });
  });
}
