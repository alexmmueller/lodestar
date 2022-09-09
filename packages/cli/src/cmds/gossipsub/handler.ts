import {createFromProtobuf, createSecp256k1PeerId} from "@libp2p/peer-id-factory";
import {Multiaddr} from "@multiformats/multiaddr";
import {Connection} from "@libp2p/interface-connection";
import {fromHexString} from "@chainsafe/ssz";
import {createNodeJsLibp2p, RegistryMetricCreator} from "@lodestar/beacon-node";
import {BareGossipsub} from "@lodestar/beacon-node/network";
import {ILogger, sleep} from "@lodestar/utils";
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
const senderMultiAddrStr = "/ip4/0.0.0.0/tcp/10001";

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

  const result = await gossip.publish(topic, Buffer.from([1, 2, 3]));
  logger.info("Sent peers", {sentPeers: result.recipients.length});
}
