/* eslint-disable @typescript-eslint/naming-convention */
import {GossipSub, GossipsubEvents} from "@chainsafe/libp2p-gossipsub";
import {SignaturePolicy} from "@chainsafe/libp2p-gossipsub/types";
import {MetricsRegister} from "@chainsafe/libp2p-gossipsub/metrics";
import {ILogger} from "@lodestar/utils";

import {RegistryMetricCreator} from "../../metrics/index.js";
import {GOSSIP_MAX_SIZE} from "../../constants/network.js";
import {DataTransformSnappy, fastMsgIdFn, simpleMsgIdFn} from "./encoding.js";

import {gossipScoreThresholds, GOSSIP_D, GOSSIP_D_HIGH, GOSSIP_D_LOW} from "./scoringParameters.js";

/* eslint-disable @typescript-eslint/naming-convention */
/** As specified in https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md */
const GOSSIPSUB_HEARTBEAT_INTERVAL = 0.7 * 1000;

const MAX_OUTBOUND_BUFFER_SIZE = 2 ** 24; // 16MB

export type Eth2GossipsubModules = {
  metricRegister: RegistryMetricCreator;
  logger: ILogger;
};

/**
 * Similar to Eth2Gossipsub to reproduce the external memory issue.
 */
export class BareGossipsub extends GossipSub {
  private readonly logger: ILogger;
  constructor(modules: Eth2GossipsubModules, opts: {metricsTopicStrToLabel: Map<string, string>}) {
    const {metricRegister, logger} = modules;
    // Gossipsub parameters defined here:
    // https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md#the-gossip-domain-gossipsub
    super({
      globalSignaturePolicy: SignaturePolicy.StrictNoSign,
      allowPublishToZeroPeers: false,
      D: GOSSIP_D,
      Dlo: GOSSIP_D_LOW,
      Dhi: GOSSIP_D_HIGH,
      Dlazy: 6,
      heartbeatInterval: GOSSIPSUB_HEARTBEAT_INTERVAL,
      fanoutTTL: 60 * 1000,
      mcacheLength: 6,
      mcacheGossip: 3,
      seenTTL: 550 * GOSSIPSUB_HEARTBEAT_INTERVAL,
      scoreThresholds: gossipScoreThresholds,
      // the default in gossipsub is 3s is not enough since lodestar suffers from I/O lag
      gossipsubIWantFollowupMs: 12 * 1000, // 12s
      fastMsgIdFn: fastMsgIdFn,
      msgIdFn: simpleMsgIdFn,
      // Use the bellatrix max size if the merge is configured. pre-merge using this size
      // could only be an issue on outgoing payloads, its highly unlikely we will send out
      // a chunk bigger than GOSSIP_MAX_SIZE pre merge even on mainnet network.
      //
      // TODO: figure out a way to dynamically transition to the size
      dataTransform: new DataTransformSnappy(GOSSIP_MAX_SIZE),
      metricsRegister: (metricRegister as unknown) as MetricsRegister,
      metricsTopicStrToLabel: opts.metricsTopicStrToLabel,
      asyncValidation: true,

      maxOutboundBufferSize: MAX_OUTBOUND_BUFFER_SIZE,
    });
    this.logger = logger;

    this.addEventListener("gossipsub:message", this.onGossipsubMessage.bind(this));

    // Having access to this data is CRUCIAL for debugging. While this is a massive log, it must not be deleted.
    // Scoring issues require this dump + current peer score stats to re-calculate scores.
    this.logger.debug("Finish Gossipsub constructor");
  }

  private onGossipsubMessage(event: GossipsubEvents["gossipsub:message"]): void {
    const {propagationSource, msgId, msg} = event.detail;
    this.logger.info("onGossipsubMessage", {
      propagationSource: propagationSource.toString(),
      msgId,
      msg: msg.data.length,
    });
  }
}
