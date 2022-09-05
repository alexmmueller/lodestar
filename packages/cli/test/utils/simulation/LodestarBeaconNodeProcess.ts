import type {SecretKey} from "@chainsafe/bls/types";
import {createKeypairFromPeerId, ENR} from "@chainsafe/discv5";
import {Api, getClient} from "@lodestar/api";
import {nodeUtils} from "@lodestar/beacon-node/node";
import {IChainForkConfig} from "@lodestar/config";
import {ChildProcess} from "node:child_process";
import {mkdir, writeFile} from "node:fs/promises";
import PeerId from "peer-id";
import {IBeaconArgs} from "../../../src/cmds/beacon/options.js";
import {getBeaconConfigFromArgs} from "../../../src/config/beaconParams.js";
import {IGlobalArgs} from "../../../src/options/globalOptions.js";
import {LodestarValidatorProcess} from "./LodestarValidatorProcess.js";
import {BeaconNodeConstructor, BeaconNodeProcess, SimulationParams, ValidatorProcess} from "./types.js";
import {closeChildProcess, spawnProcessAndWait, __dirname} from "./utils.js";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const LodestarBeaconNodeProcess: BeaconNodeConstructor = class LodestarBeaconNodeProcess
  implements BeaconNodeProcess {
  static totalProcessCount = 0;
  readonly params: SimulationParams;
  readonly secretKeys: Record<number, SecretKey[]> = {};
  readonly address: string;
  readonly port: number;
  readonly restPort: number;
  api!: Api;
  enr!: string;
  peerId!: PeerId;
  multiaddrs!: string[];

  private rootDir: string;
  private beaconProcess!: ChildProcess;
  private validatorProcesses: ValidatorProcess[] = [];
  private rcConfig: IBeaconArgs & IGlobalArgs;
  private config!: IChainForkConfig;

  constructor(params: SimulationParams, rootDir: string) {
    this.params = params;
    this.rootDir = rootDir;
    LodestarBeaconNodeProcess.totalProcessCount += 1;

    this.address = "127.0.0.1";
    this.port = 4000 + LodestarBeaconNodeProcess.totalProcessCount;
    this.restPort = 5000 + LodestarBeaconNodeProcess.totalProcessCount;

    this.rcConfig = ({
      network: "dev",
      preset: "minimal",
      dataDir: this.rootDir,
      genesisStateFile: `${this.rootDir}/genesis.ssz`,
      rest: true,
      "rest.address": this.address,
      "rest.port": this.restPort,
      "rest.namespace": "*",
      "sync.isSingleNode": this.params.beaconNodes === 1,
      "network.allowPublishToZeroPeers": true,
      eth1: false,
      discv5: this.params.beaconNodes > 1,
      "network.connectToDiscv5Bootnodes": this.params.beaconNodes > 1,
      listenAddress: this.address,
      port: this.port,
      metrics: false,
      dev: true,
      enrFile: `${this.rootDir}/enr.txt`,
      peerIdFile: `${this.rootDir}/peer-id.json`,
      bootnodes: [],
      "params.SECONDS_PER_SLOT": String(this.params.secondsPerSlot),
      "params.GENESIS_DELAY": String(this.params.genesisSlotsDelay),
      "params.ALTAIR_FORK_EPOCH": String(this.params.altairEpoch),
      "params.BELLATRIX_FORK_EPOCH": String(this.params.bellatrixEpoch),
    } as unknown) as IBeaconArgs & IGlobalArgs;

    for (let clientIndex = 0; clientIndex < this.params.validatorClients; clientIndex++) {
      this.validatorProcesses.push(
        new LodestarValidatorProcess(this.params, {
          rootDir: this.rootDir,
          config: getBeaconConfigFromArgs(this.rcConfig),
          server: `http://${this.address}:${this.restPort}/`,
          clientIndex,
        })
      );
    }
  }

  async start(): Promise<void> {
    const peerId = await PeerId.create({keyType: "secp256k1"});
    const keypair = createKeypairFromPeerId(peerId);
    const enr = ENR.createFromPeerId(peerId);

    this.peerId = peerId;
    this.enr = enr.encodeTxt(keypair.privateKey);
    this.multiaddrs = [`/ip4/${this.address}/tcp/${this.port}`];
    this.config = getBeaconConfigFromArgs(this.rcConfig);
    this.api = getClient({baseUrl: `http://${this.address}:${this.restPort}/`}, {config: this.config});

    const {state} = nodeUtils.initDevState(
      this.config,
      this.params.validatorClients * this.params.validatorsPerClient,
      {
        genesisTime: this.params.genesisTime,
      }
    );

    await mkdir(this.rootDir);
    await writeFile(`${this.rootDir}/peer-id.json`, JSON.stringify(this.peerId.toJSON(), null, 2));
    await writeFile(`${this.rootDir}/enr.txt`, this.enr);
    await writeFile(`${this.rootDir}/genesis.ssz`, state.serialize());
    await writeFile(`${this.rootDir}/rc_config.json`, JSON.stringify(this.rcConfig, null, 2));

    this.beaconProcess = await spawnProcessAndWait(
      `${__dirname}/../../../bin/lodestar.js`,
      ["beacon", "--rcConfig", `${this.rootDir}/rc_config.json`, "--network", "dev", "--dev", "true"],
      async () => this.ready(),
      "Waiting for beacon node to start..."
    );

    for (let clientIndex = 0; clientIndex < this.params.validatorClients; clientIndex++) {
      await this.validatorProcesses[clientIndex].start();
    }
  }

  async stop(): Promise<void> {
    await Promise.all(this.validatorProcesses.map((p) => p.stop()));

    if (this.beaconProcess !== undefined) {
      await closeChildProcess(this.beaconProcess);
    }
  }

  async ready(): Promise<boolean> {
    const health = await this.api.node.getHealth();

    return health === 200 || health === 206;
  }
};