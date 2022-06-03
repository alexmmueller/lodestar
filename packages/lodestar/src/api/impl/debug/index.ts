import {Multiaddr} from "@multiformats/multiaddr";
import {peerIdFromString} from "@libp2p/peer-id";
import {routes} from "@chainsafe/lodestar-api";
import {resolveStateId} from "../beacon/state/utils.js";
import {ApiModules} from "../types.js";

export function getDebugApi({
  chain,
  config,
  db,
  network,
}: Pick<ApiModules, "chain" | "config" | "db" | "network">): routes.debug.Api {
  return {
    async getHeads() {
      const heads = chain.forkChoice.getHeads();
      return {
        data: heads.map((blockSummary) => ({slot: blockSummary.slot, root: blockSummary.blockRoot})),
      };
    },

    async getState(stateId: string, format?: routes.debug.StateFormat) {
      const state = await resolveStateId(config, chain, db, stateId, {regenFinalizedState: true});
      if (format === "ssz") {
        // Casting to any otherwise Typescript doesn't like the multi-type return
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
        return state.serialize() as any;
      } else {
        return {data: state.toValue()};
      }
    },

    async getStateV2(stateId: string, format?: routes.debug.StateFormat) {
      const state = await resolveStateId(config, chain, db, stateId, {regenFinalizedState: true});
      if (format === "ssz") {
        // Casting to any otherwise Typescript doesn't like the multi-type return
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
        return state.serialize() as any;
      } else {
        return {data: state.toValue(), version: config.getForkName(state.slot)};
      }
    },

    async connectToPeer(peerIdStr, multiaddrStr) {
      const peer = peerIdFromString(peerIdStr);
      const multiaddr = multiaddrStr.map((addr) => new Multiaddr(addr));
      await network.connectToPeer(peer, multiaddr);
    },

    async disconnectPeer(peerIdStr) {
      const peer = peerIdFromString(peerIdStr);
      await network.disconnectPeer(peer);
    },
  };
}
