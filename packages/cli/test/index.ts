import {createSecp256k1PeerId} from "@libp2p/peer-id-factory";

const originalExt = process.memoryUsage().external;
const times = 1e9;

const test = async (): Promise<void> => {
  for (let i = 0; i < times; i++) {
    for (let j = 0; j < 1000; j++) {
      await createSecp256k1PeerId();
    }
    console.log("New memory", i, toMem(process.memoryUsage().external - originalExt));
  }
};

function toMem(n: number): string {
  const bytes = Math.abs(n);
  const sign = n > 0 ? "+" : "-";
  if (bytes < 1e6) return sign + Math.floor(bytes / 10) / 100 + " KB";

  if (bytes < 1e9) return sign + Math.floor(bytes / 1e4) / 100 + " MB";

  return sign + Math.floor(bytes / 1e7) / 100 + " GB";
}

// main
test()
  .then(() => console.log("done"))
  .catch((e) => console.log("got error", e));
