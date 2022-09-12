import path from "path";
import {createFromProtobuf, createSecp256k1PeerId} from "@libp2p/peer-id-factory";
import {Multiaddr} from "@multiformats/multiaddr";
import {Connection} from "@libp2p/interface-connection";
import {Libp2p} from "libp2p";
import {BitArray, fromHexString} from "@chainsafe/ssz";
import {createNodeJsLibp2p, RegistryMetricCreator} from "@lodestar/beacon-node";
import {BareGossipsub} from "@lodestar/beacon-node/network";
import {ILogger, sleep} from "@lodestar/utils";
import {phase0, ssz} from "@lodestar/types";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {HttpMetricsServer} from "@lodestar/beacon-node";
import {collectNodeJSMetrics, defaultMetricsOptions} from "@lodestar/beacon-node/metrics";
import {getBeaconConfigFromArgs} from "../../config/beaconParams.js";
import {IGlobalArgs} from "../../options/index.js";
import {getCliLogger} from "../../util/index.js";
import {getBeaconPaths} from "../beacon/paths.js";
import {IGossipSubArgs} from "./options.js";

const topic = "beacon-attestation";
const metricsTopicStrToLabel = new Map([[topic, topic]]);
const receiverPeerIdHexes = [
  "0x0a27002508021221030c511d117134b5a4d64715049fb92b3f6a1ced53fec11e55e3f8cde0ac438ca7122508021221030c511d117134b5a4d64715049fb92b3f6a1ced53fec11e55e3f8cde0ac438ca71a2408021220718a5440e10882bdad489822036b3e034faa7c8b42555901d6654ef18c466e0b",
  "0x0a27002508021221026270da62887090205d91328034efe39b97f629bd7d861e7f914f00781a4b518b122508021221026270da62887090205d91328034efe39b97f629bd7d861e7f914f00781a4b518b1a2408021220bc5559437e11e8b5c4ca170da5f78910bf3ffb7dba90c575f6590b9c27e87313",
  "0x0a27002508021221034eb4fbf6f7779b5dbcdb3aeed8d2ddce830f5c67e79a7eb6015590c2648f151f122508021221034eb4fbf6f7779b5dbcdb3aeed8d2ddce830f5c67e79a7eb6015590c2648f151f1a24080212200f373937d9ab5eb71a2b8d9c33447a45fc2e180b047c85dbde8ecf6b05783dd1",
  "0x0a27002508021221033212bc65669c4c9c78b1a744cb719c5a711b22d350176b2bff698fc2113c46d8122508021221033212bc65669c4c9c78b1a744cb719c5a711b22d350176b2bff698fc2113c46d81a24080212206cb0b9e8f366068474c6f418efc9a3cdde830304ca6ee438f96a28051c1e280b",
  "0x0a2700250802122102c9cfc70b1ba27d4953420c088fb20cec0b5974cea1429d3d42863c36c4ac9e5912250802122102c9cfc70b1ba27d4953420c088fb20cec0b5974cea1429d3d42863c36c4ac9e591a24080212207f530381b46828bbe145e25ec022a32ba37b06590f4bedea33601f9d3fe576fc",
  "0x0a2700250802122103f507b945567edf8c8023cf22df425bd64e963a9b0cf804e32532e6d60e3ad85212250802122103f507b945567edf8c8023cf22df425bd64e963a9b0cf804e32532e6d60e3ad8521a2408021220dff4835b2c8be3c1278838bdaf01672d026146a9e8e80f5c55433482420e38da",
  "0x0a270025080212210252e2fd2bf3ef3ff69ead49f9cc09a59ea3640b1d8730a4cf1d200f730137204a1225080212210252e2fd2bf3ef3ff69ead49f9cc09a59ea3640b1d8730a4cf1d200f730137204a1a24080212206815d08d9d8a66c5d90826b1ddcddc30bcb61213785f545bc6911bce3dca7e73",
  "0x0a2700250802122103cbf3ab00b41c96b20737b49e6c73897bdf66476ccd0f44651bb91b0e974cbb1612250802122103cbf3ab00b41c96b20737b49e6c73897bdf66476ccd0f44651bb91b0e974cbb161a24080212205bec39cebdcffc92780f2609ffd4eca57b9c28b0c1f986ee6682cf4cdce6f5c4",
  "0x0a27002508021221035a3e59b3bd40f2424b102df9c5d2a0b14f4072268100fcfb1ea8beff73ad8d64122508021221035a3e59b3bd40f2424b102df9c5d2a0b14f4072268100fcfb1ea8beff73ad8d641a2408021220677b34cff5b91733255fdd42245175f88cbbb7edc4ea1297bbc956dc91d9819f",
  "0x0a27002508021221028f44117705f60ced91257888e4933298eb2f538f639bc8469a8f4433b1e737cf122508021221028f44117705f60ced91257888e4933298eb2f538f639bc8469a8f4433b1e737cf1a240802122008757514ab96dc36b037220551079105f466eb680456ea409f9223863be21885",
  "0x0a27002508021221020781a7820c7c8a8a6b4d5b446a6084726e9330dab0693115bd81179673672bb7122508021221020781a7820c7c8a8a6b4d5b446a6084726e9330dab0693115bd81179673672bb71a24080212205ade693ff7ce7fe3d99c64585b29127468bac9cd6e5897c4b5c129bdc9440a0d",
  "0x0a27002508021221020bf4ec1e6df49577172ac33c1b06206be3f5bff7c74543123967222f2d2d3fdd122508021221020bf4ec1e6df49577172ac33c1b06206be3f5bff7c74543123967222f2d2d3fdd1a24080212201603148a44273d15e652e895ea12c5b1794da02da818caa1f57befcb5fec3526",
  "0x0a270025080212210240c520e535164f8e4d0758c8b66fdb96f9d44b6c8a86d698783c347a9d690f3d1225080212210240c520e535164f8e4d0758c8b66fdb96f9d44b6c8a86d698783c347a9d690f3d1a240802122076188a9f4dbebc449f06b477954797257e11025d76c491c635090ee85d224f32",
  "0x0a2700250802122102f2cbeb78c8a4e3918eb14f5f0337e56a45af6b247343854081c553b953595a8412250802122102f2cbeb78c8a4e3918eb14f5f0337e56a45af6b247343854081c553b953595a841a2408021220fef1676e1529f3756031f9cf7b05043ccf065c4470012554287aa092acacc289",
  "0x0a27002508021221034cc4e355279839853edc5ffd5b8b3fef0e08380b230d37b11243589bc0704575122508021221034cc4e355279839853edc5ffd5b8b3fef0e08380b230d37b11243589bc07045751a2408021220b7788635930507080b628e78d141c8461a25acdac0632e02cde6b51fe8d719db",
];
const receiverMultiAddrStrTemplate = "/ip4/0.0.0.0/tcp/100";
const senderMultiAddr = "/ip4/0.0.0.0/tcp/9999";

function getReceiverMultiAddrStr(i: number): string {
  return receiverMultiAddrStrTemplate + (i < 10 ? "0" + i : i);
}

const committeeSize = 200;

const seedAttestation: phase0.Attestation = {
  aggregationBits: BitArray.fromBoolArray(Array.from({length: committeeSize}, () => false)),
  data: {
    slot: 3849723,
    index: 51,
    beaconBlockRoot: fromHexString("0x336304cc19cc0cfacb234c52ba4c12d73be9e581fba26d6da401f16dc685dc23"),
    source: {
      epoch: 120302,
      root: fromHexString("0xe312659945be76a65a8bc9288246eb555073056664733a9313b4615e08a0d18b"),
    },
    target: {
      epoch: 120303,
      root: fromHexString("0x467997e91dec5b8f4b2cc4e67d82a761cfddecbcb6a3b1abc5d46646203b2512"),
    },
  },
  signature: fromHexString(
    "0xa0a09d4d138a959fc3513289feefb2e65c4339fe7a505d8ba794b48eb1bc6f359e6a3e7643a4a5717ec5c64e32b6666d02d69b5cff4487d2fc76e67dedb79ebf0500e2c844d8ceff5c29d2d1c73c7e61fb369075a09abdaece4a2657846a500a"
  ),
};

/**
 * Assuming there are 500000 validators, per slot = 15625 messages
 * per subnet = per slot / 64 ~= 2441, make it 2500
 */
const messagesPerSecond = 2500;

const numSenders = 1;
const numReceivers = 15;

// goerli on Sep 02 2022 at around 08:00am UTC
const startSlot = 3849723;

export async function gossipsubHandler(args: IGossipSubArgs & IGlobalArgs): Promise<void> {
  const {config, network} = getBeaconConfigFromArgs(args);

  const beaconPaths = getBeaconPaths(args, network);
  const logger = getCliLogger(args, beaconPaths, config);
  const {receiver} = args;
  const receiverPeerIds = await Promise.all(
    receiverPeerIdHexes.map((receiverPeerIdHex) => createFromProtobuf(fromHexString(receiverPeerIdHex)))
  );

  const numNode = receiver ? numReceivers : numSenders;

  const promises: Promise<void>[] = [];

  for (let nodeIndex = 0; nodeIndex < numNode; nodeIndex++) {
    const peerId = receiver ? receiverPeerIds[nodeIndex] : await createSecp256k1PeerId();
    // console.log("peerId protobuf", toHexString(exportToProtobuf(peerId)));

    const libp2p = await createNodeJsLibp2p(
      peerId,
      {
        localMultiaddrs: receiver ? [getReceiverMultiAddrStr(nodeIndex)] : [senderMultiAddr],
      },
      {
        peerStoreDir: path.join(beaconPaths.peerStoreDir, String(nodeIndex)),
        metrics: false,
      }
    );
    logger.info("Initialized libp2p", {receiver, nodeIndex});

    const metricRegister = receiver ? undefined : new RegistryMetricCreator();
    const gossip = new BareGossipsub({logger, metricRegister}, {metricsTopicStrToLabel});

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
    void gossip.init((libp2p as any).components).catch((e) => logger.error(e));

    logger.info("Initialized gossipsub", {receiver, nodeIndex});

    await libp2p.start();
    await gossip.start();

    logger.info("Started libp2p and gossipsub", {receiver, nodeIndex});
    gossip.subscribe(topic);
    logger.info("Subscribed to topic", {topic, nodeIndex});

    libp2p.connectionManager.addEventListener("peer:connect", (evt: CustomEvent<Connection>) => {
      const libp2pConnection = evt.detail;
      const peer = libp2pConnection.remotePeer;
      logger.info("Peer connected", {peerId: peer.toString(), nodeIndex});
    });

    if (!receiver && metricRegister) {
      collectNodeJSMetrics(metricRegister);
      // start metrics http server
      const metricsServer = new HttpMetricsServer(defaultMetricsOptions, {
        register: metricRegister,
        logger: logger.child({module: "metrics"}),
      });
      await metricsServer.start();
      logger.info("Started http metric server");
      promises.push(dialAndSend(libp2p, gossip, logger, receiverPeerIds, nodeIndex));
    }
  } // end for

  await Promise.all(promises);
}

async function dialAndSend(
  libp2p: Libp2p,
  gossip: BareGossipsub,
  logger: ILogger,
  receiverPeerIds: Awaited<ReturnType<typeof createFromProtobuf>>[],
  nodeIndex: number
): Promise<void> {
  // same to connectToPeer
  for (const [i, receiverPeerId] of receiverPeerIds.entries()) {
    logger.info("Dialing receiver", {i})
    await libp2p.peerStore.addressBook.add(receiverPeerId, [new Multiaddr(getReceiverMultiAddrStr(i))]);
    await libp2p.dial(receiverPeerId);
  }
  await sendMessages(gossip, logger, nodeIndex, receiverPeerIds.length);
}

async function sendMessages(
  gossip: BareGossipsub,
  logger: ILogger,
  nodeIndex: number,
  expectedPeers: number
): Promise<void> {
  while (gossip.peers.size < expectedPeers) {
    logger.info("Not enough peers, retry in 5s", {nodeIndex, peers: gossip.peers.size, expectedPeers});
    await sleep(5 * 1000);
  }
  logger.info("Found enough peers", {nodeIndex, peers: gossip.peers.size});
  const [peer] = gossip.peers;
  logger.info("Found peers", {peer, numPeer: gossip.peers.size, nodeIndex});

  let slot = startSlot;
  // send to receiver per 100ms
  const timesPerSec = 10;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // 1 / 10 of 1 second
    await sleep(1000 / timesPerSec);
    const epoch = computeEpochAtSlot(slot);
    // each sender sends different set of messages, then it'll gossip to each other
    // including the receiver
    const messagesPerSender = Math.floor(messagesPerSecond / timesPerSec / numSenders);

    for (let i = nodeIndex * messagesPerSender; i < nodeIndex * messagesPerSender + messagesPerSender; i++) {
      const attestation: phase0.Attestation = {
        ...seedAttestation,
      };
      attestation.aggregationBits.set(i % committeeSize, true);
      attestation.data.slot = slot;
      // as in goerli there are 64 committees per slot
      attestation.data.index = nodeIndex;
      attestation.data.source.epoch = epoch - 1;
      attestation.data.target.epoch = epoch;

      const bytes = ssz.phase0.Attestation.serialize(attestation);
      // make sure it's unique
      bytes[bytes.length - 1] = i;
      try {
        await gossip.publish(topic, bytes);
      } catch (e) {
        // messages are unique per gossip but
        // could have duplicate error here due to IWANT/IHAVE
        // this is fine as long as the metrics of receiver shows good result
      }
    }

    slot++;
  }
}
