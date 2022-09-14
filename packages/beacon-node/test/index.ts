const toMem = (n: number): string => {
  const inMB = Math.floor(n / 1e4) / 100;
  if (inMB < 1000) return `${inMB} MB`;

  const inGB = Math.floor(inMB / 10) / 100;
  return `${inGB} GB`;
};

const originalHeap = process.memoryUsage().heapUsed;
const originalExt = process.memoryUsage().external;
let ext = originalExt;
const times = 1e3;
const buffers: Uint8Array[] = [];
const strs: string[] = [];
for (let n = 0; n < times; n++) {
  for (let i = 0; i < 1000; i++) {
    // Buffer.allocUnsafe(32)
    // 0 MB
    new Uint8Array(32)
    // with subarray: 1.51 MB ext, 8.16 heap used
    // new Uint8Array(32).subarray()
    // 1 MB
    // Buffer.from(new Uint8Array(32))
  }
  // const tmp = process.memoryUsage().external;
  // console.log("new Uint8Array(32).subarray external", n, toMem(tmp - ext));
  // ext = tmp;
}

console.log(
  "@@@  Buffer.from(new Uint8Array(32)) final ext",
  times,
  toMem(process.memoryUsage().external - originalExt),
  "heap used",
  toMem(process.memoryUsage().heapUsed - originalHeap)
);
