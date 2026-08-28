import type { Server } from "node:http";
import { Schema } from "effect";

const decodeAddress = Schema.decodeUnknownOption(Schema.Struct({ port: Schema.Number }));

export function listenOnLoopback(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = decodeAddress(server.address());
      if (address._tag === "None") {
        reject(new Error("Loopback listener failed"));
        return;
      }
      resolve(address.value.port);
    });
  });
}
