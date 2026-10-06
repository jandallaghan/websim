import { createServer, type Socket } from "node:net";
import { spawn } from "node:child_process";

/** An inbound-only control tunnel. The container never receives a network route to the host. */
export async function openTunnel(
  container: string,
  port: number,
  hostPort = 0,
) {
  const sockets = new Set<Socket>();
  const children = new Set<ReturnType<typeof spawn>>();
  const server = createServer((socket) => {
    sockets.add(socket);
    const child = spawn(
      "docker",
      [
        "exec",
        "-i",
        container,
        "node",
        "-e",
        `const net=require('node:net');const s=net.connect(${port},'127.0.0.1');process.stdin.pipe(s);s.pipe(process.stdout);s.on('error',()=>process.exit(1));s.on('close',()=>process.exit());`,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    child.stderr.resume();
    children.add(child);
    socket.pipe(child.stdin);
    child.stdout.pipe(socket);
    child.stdin.on("error", () => socket.destroy());
    child.on("error", () => socket.destroy());
    child.on("close", () => {
      children.delete(child);
      socket.destroy();
    });
    socket.on("error", () => child.kill());
    socket.on("close", () => {
      sockets.delete(socket);
      child.kill();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(hostPort, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Tunnel did not bind");
  return {
    port: address.port,
    async close() {
      for (const socket of sockets) socket.destroy();
      for (const child of children) child.kill();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
