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
import {ATTESTATION_SUBNET_COUNT} from "@lodestar/params";
import {HttpMetricsServer} from "@lodestar/beacon-node";
import {collectNodeJSMetrics, defaultMetricsOptions} from "@lodestar/beacon-node/metrics";
import {getBeaconConfigFromArgs} from "../../config/beaconParams.js";
import {IGlobalArgs} from "../../options/index.js";
import {getCliLogger} from "../../util/index.js";
import {getBeaconPaths} from "../beacon/paths.js";
import {IGossipSubArgs} from "./options.js";

const topic = "beacon-attestation";
const metricsTopicStrToLabel = new Map([[topic, topic]]);
const receiverPeerIdHex =
  "0x0a270025080212210201c61201644b110fc63b5db207ab4918674c6e92d1a5f06e97c5abd5444542961225080212210201c61201644b110fc63b5db207ab4918674c6e92d1a5f06e97c5abd5444542961a2408021220386e4f870e321735cb25d738b5739033fb565f803ceb6a6795a0f638fed83e12";
const receiverMultiAddrStr = "/ip4/0.0.0.0/tcp/10000";
const senderMultiAddrTemplate = "/ip4/0.0.0.0/tcp/1000";

function getSenderMultiAddrStr(i: number): string {
  return senderMultiAddrTemplate + (i + 1);
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

const numSenders = 50;

// goerli on Sep 02 2022 at around 08:00am UTC
const startSlot = 3849723;

export async function gossipsubHandler(args: IGossipSubArgs & IGlobalArgs): Promise<void> {
  const {config, network} = getBeaconConfigFromArgs(args);

  const beaconPaths = getBeaconPaths(args, network);
  const logger = getCliLogger(args, beaconPaths, config);
  const {receiver} = args;
  const receiverPeerId = await createFromProtobuf(fromHexString(receiverPeerIdHex));

  const numNode = receiver ? 1 : numSenders;

  const promises: Promise<void>[] = [];

  for (let nodeIndex = 0; nodeIndex < numNode; nodeIndex++) {
    const peerId = receiver ? receiverPeerId : await createSecp256k1PeerId();
    // console.log("peerId protobuf", toHexString(exportToProtobuf(peerId)));

    const libp2p = await createNodeJsLibp2p(
      peerId,
      {
        localMultiaddrs: receiver ? [receiverMultiAddrStr] : [getSenderMultiAddrStr(nodeIndex)],
      },
      {
        peerStoreDir: path.join(beaconPaths.peerStoreDir, String(nodeIndex)),
        metrics: false,
      }
    );
    logger.info("Initialized libp2p", {receiver, nodeIndex});

    const metricRegister = receiver ? new RegistryMetricCreator() : undefined;
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

    if (receiver && metricRegister) {
      collectNodeJSMetrics(metricRegister);

      // start metrics http server
      const metricsServer = new HttpMetricsServer(defaultMetricsOptions, {
        register: metricRegister,
        logger: logger.child({module: "metrics"}),
      });
      await metricsServer.start();

      logger.info("Started http metric server");
    } else {
      promises.push(dialAndSend(libp2p, gossip, logger, receiverPeerId, nodeIndex));
    }
  } // end for

  await Promise.all(promises);
}

async function dialAndSend(
  libp2p: Libp2p,
  gossip: BareGossipsub,
  logger: ILogger,
  receiverPeerId: Awaited<ReturnType<typeof createFromProtobuf>>,
  nodeIndex: number
): Promise<void> {
  // same to connectToPeer
  await libp2p.peerStore.addressBook.add(receiverPeerId, [new Multiaddr(receiverMultiAddrStr)]);
  await libp2p.dial(receiverPeerId);
  await sendMessages(gossip, logger, nodeIndex);
}

async function sendMessages(gossip: BareGossipsub, logger: ILogger, nodeIndex: number): Promise<void> {
  while (gossip.peers.size <= 0) {
    logger.info("No peer, retry in 5s", {nodeIndex});
    await sleep(5 * 1000);
  }
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
