import {createFromProtobuf, createSecp256k1PeerId} from "@libp2p/peer-id-factory";
import {Multiaddr} from "@multiformats/multiaddr";
import {Connection} from "@libp2p/interface-connection";
import {BitArray, fromHexString, toHexString} from "@chainsafe/ssz";
import {createNodeJsLibp2p, RegistryMetricCreator} from "@lodestar/beacon-node";
import {BareGossipsub} from "@lodestar/beacon-node/network";
import {ILogger, sleep} from "@lodestar/utils";
import {getBeaconConfigFromArgs} from "../../config/beaconParams.js";
import {IGlobalArgs} from "../../options/index.js";
import {getCliLogger} from "../../util/index.js";
import {getBeaconPaths} from "../beacon/paths.js";
import {IGossipSubArgs} from "./options.js";
import { phase0, ssz } from "@lodestar/types";
import { computeEpochAtSlot } from "@lodestar/state-transition";
import { gossipsub } from "./index.js";
import { ATTESTATION_SUBNET_COUNT } from "@lodestar/params";

const topic = "beacon-attestation";
const metricsTopicStrToLabel = new Map([[topic, topic]]);
const receiverPeerIdHex =
  "0x0a270025080212210201c61201644b110fc63b5db207ab4918674c6e92d1a5f06e97c5abd5444542961225080212210201c61201644b110fc63b5db207ab4918674c6e92d1a5f06e97c5abd5444542961a2408021220386e4f870e321735cb25d738b5739033fb565f803ceb6a6795a0f638fed83e12";
const receiverMultiAddrStr = "/ip4/0.0.0.0/tcp/10000";
const senderMultiAddrStr = "/ip4/0.0.0.0/tcp/10001";
const seedAttestation: phase0.Attestation = {
  aggregationBits: BitArray.fromBoolArray(Array.from({length: 180}, () => false)),
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
  signature: fromHexString("0xa0a09d4d138a959fc3513289feefb2e65c4339fe7a505d8ba794b48eb1bc6f359e6a3e7643a4a5717ec5c64e32b6666d02d69b5cff4487d2fc76e67dedb79ebf0500e2c844d8ceff5c29d2d1c73c7e61fb369075a09abdaece4a2657846a500a"),
};

/**
 * A 1-validator node receives 100 attestations per second, 30% of that are accepted.
 * Make it 4x
 */
const messagesPerSecond = 30 * 4;

const duplicateFactor = 4;

// goerli on Sep 02 2022 at around 08:00am UTC
const startSlot = 3849723;

export async function gossipsubHandler(args: IGossipSubArgs & IGlobalArgs): Promise<void> {
  const {config, network} = getBeaconConfigFromArgs(args);

  const beaconPaths = getBeaconPaths(args, network);
  const logger = getCliLogger(args, beaconPaths, config);
  const {receiver} = args;
  const receiverPeerId = await createFromProtobuf(fromHexString(receiverPeerIdHex));

  const peerId = receiver ? receiverPeerId : await createSecp256k1PeerId();
  // console.log("peerId protobuf", toHexString(exportToProtobuf(peerId)));
  const libp2p = await createNodeJsLibp2p(
    peerId,
    {
      localMultiaddrs: receiver ? [receiverMultiAddrStr] : [senderMultiAddrStr],
    },
    {
      peerStoreDir: beaconPaths.peerStoreDir,
      metrics: false,
    }
  );

  logger.info("Initialized libp2p", {listener: receiver});

  const metricRegister = new RegistryMetricCreator();
  const gossip = new BareGossipsub({logger, metricRegister}, {metricsTopicStrToLabel});

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
  void gossip.init((libp2p as any).components).catch((e) => logger.error(e));

  logger.info("Initialized gossipsub", {receiver});

  await libp2p.start();
  await gossip.start();

  logger.info("Started libp2p and gossipsub", {receiver});
  gossip.subscribe(topic);
  logger.info("Subscribed to topic", {topic});

  libp2p.connectionManager.addEventListener("peer:connect", (evt: CustomEvent<Connection>) => {
    const libp2pConnection = evt.detail;
    const peer = libp2pConnection.remotePeer;
    logger.info("Peer connected", {peerId: peer.toString()});
  });

  if (!receiver) {
    // same to connectToPeer
    await libp2p.peerStore.addressBook.add(receiverPeerId, [new Multiaddr(senderMultiAddrStr)]);
    await libp2p.dial(receiverPeerId);
    await sendMessages(gossip, logger);
  }
}

async function sendMessages(gossip: BareGossipsub, logger: ILogger): Promise<void> {
  while (gossip.peers.size <= 0) {
    logger.info("No peer, retry in 5s");
    await sleep(5 * 1000);
  }
  const [peer] = gossip.peers;
  logger.info("Found peers", {peer, numPeer: gossip.peers.size});

  let slot = startSlot;
  // send to receiver per 100ms
  const timesPerSec = 10;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // 1 / 10 of 1 second
    await sleep(1000 / timesPerSec);
    const epoch = computeEpochAtSlot(slot);

    const promises: Promise<unknown>[] = [];
    for (let i = 0; i < messagesPerSecond / timesPerSec; i++) {
      const attestation: phase0.Attestation = {
        ...seedAttestation,
      };
      attestation.data.slot = slot;
      attestation.data.index = i % ATTESTATION_SUBNET_COUNT;
      attestation.data.source.epoch = epoch - 1;
      attestation.data.target.epoch = epoch;

      const bytes = ssz.phase0.Attestation.serialize(attestation);
      // make sure it's unique
      bytes[bytes.length - 1] = i;
      // cannot send duplicate messages from same gossipsub
      promises.push(gossip.publish(topic, bytes));
    }
    await Promise.all(promises);

    slot++;
  }
}
